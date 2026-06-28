import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, mkdir, open, readdir, readFile, stat, unlink } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createInterface } from 'node:readline';

import {
  authedFetch,
  getValidBearerToken,
  readAuthStore,
  refreshAccessToken,
} from '@main/services/auth/OpenHermitAuthClient';
import { getProjectsBasePath } from '@main/utils/pathDecoder';
import { loadImOriginEnvelopes, type ImEnvelope } from './ImOriginSessionReader';
import { ImTeamAttributor, type TeamIdentity } from './ImTeamAttributor';
type ConversationUploadTelemetryConfig = {
  enabled?: boolean;
  platform?: UploadPlatform;
  uploadProviders?: UploadPlatform[];
  conversationUploadEnabled?: boolean;
  conversations?: {
    uploadEnabled?: boolean;
    batchSize?: number;
    uploadBatchSize?: number;
  };
};

interface ConversationUploadConfig {
  telemetry?: ConversationUploadTelemetryConfig;
}

const DEFAULT_OPENHERMIT_CLOUD_HOST = '159.75.231.98';
const OPENHERMIT_CONVERSATION_UPLOAD_BASE_URL =
  process.env.OPENHERMIT_CONVERSATION_UPLOAD_BASE_URL ||
  process.env.OPENHERMIT_CLOUD_UPLOAD_BASE_URL ||
  `http://${process.env.OPENHERMIT_CLOUD_HOST || DEFAULT_OPENHERMIT_CLOUD_HOST}:8088`;

const UPLOAD_LOCK_FILE = 'conversation-message-upload.lock';
const UPLOAD_LOG_FILE = 'conversation-upload.log';
const SOURCE = 'openhermit' as const;
const API_TIMEOUT_MS = 8_000;
// Unified upload endpoint (replaces the legacy split /conversation-messages and
// /im-conversation-messages). scene + per-message kind/im/routing carry the
// scene; `mode` stays an internal collection/dedup-channel switch, not an endpoint selector.
const UPLOAD_ENDPOINT = '/api/v1/report/messages';

// Builds the `im` block for an IM-attributed message from the envelope hermit-bridge
// records per conversation (see ImOriginSessionReader): provider/chatId/chatType come
// from the composite key that indexes user_sessions; chat/sender display names from
// user_meta; senderId/messageId from the composite's third segment (ou_/on_/om_);
// tenantKey from the logged-in auth account.
function buildImBlock(envelope: ImEnvelope, tenantKey?: string): NonNullable<UploadMessage['im']> {
  const block: NonNullable<UploadMessage['im']> = {
    provider: envelope.provider,
    channel: envelope.provider,
  };
  if (tenantKey) block.tenantKey = tenantKey;
  if (envelope.chatId) {
    const chat: { id: string; type?: string; name?: string } = { id: envelope.chatId };
    if (envelope.chatType) chat.type = envelope.chatType;
    if (envelope.chatName) chat.name = envelope.chatName;
    block.chat = chat;
  }
  if (envelope.senderId) {
    const sender: { id: string; idType?: string; name?: string } = { id: envelope.senderId };
    // Feishu open_id carries the ou_ prefix; record it so the server can resolve identity.
    if (envelope.senderId.startsWith('ou_')) sender.idType = 'open_id';
    if (envelope.senderName) sender.name = envelope.senderName;
    block.sender = sender;
  }
  if (envelope.messageId) {
    block.message = { id: envelope.messageId };
  }
  return block;
}

// IM routing fact: how this conversation reached the agent. trigger/triggerSource/
// matchedBy are constant for an IM-origin turn; target is the Hermit team that owns
// the agent's workspace (resolved from the session cwd). When no team matches the
// cwd, target is omitted rather than fabricated — the server then has the trigger
// facts without an invented identity.
function buildRoutingBlock(
  envelope: ImEnvelope,
  team: TeamIdentity | null
): NonNullable<UploadMessage['routing']> {
  const routing: NonNullable<UploadMessage['routing']> = {
    schemaVersion: 1,
    source: 'openhermit-router',
    trigger: 'im_message',
    triggerSource: envelope.provider,
    matchedBy: 'chat_id',
  };
  if (team) {
    routing.routeRef = `route-${team.teamSlug}`;
    routing.target = {
      type: 'team',
      teamSlug: team.teamSlug,
      teamName: team.teamName,
    };
  }
  return routing;
}

// tenantKey for the im block: read from the auth store's account (the logged-in
// tenant). Absent when not logged in or when the account lacks a tenant.
async function readTenantKey(home: string): Promise<string | undefined> {
  const store = await readAuthStore(home);
  const account = store?.account as { tenantKey?: unknown } | undefined;
  return typeof account?.tenantKey === 'string' ? account.tenantKey : undefined;
}

export interface ConversationUploadStatus {
  enabled: boolean;
  endpointConfigured: boolean;
  totalDiscovered?: number;
  skippedAlreadyUploaded?: number;
  pending?: number;
  attempted: number;
  accepted: number;
  duplicated: number;
  rejected: number;
  inserted?: number;
  failed?: number;
  queued?: number;
  uploadIds?: string[];
  lastUploadStatus?: string;
  lastReceiptId?: string;
  lastStatusUrl?: string;
  lastError?: string;
}

type UploadPlatform = 'claudecode' | 'codex';
type UploadMode = 'plain' | 'im';
type MessageKind = 'conversation_message' | 'im_conversation_message';

interface UploadMessage {
  kind: MessageKind;
  eventId: string;
  reportedAt: string;
  // Per-message context, kept on each message as collected. Plain messages carry
  // project/conversation; IM messages additionally carry im/routing. The unified
  // contract allows per-message project/conversation (message-level wins over a
  // top-level fallback), so nothing is stripped or hoisted anymore.
  project?: {
    projectRef: string;
    name?: string;
    pathHash?: string;
  };
  conversation?: {
    conversationId: string;
    sessionRef: string;
    claudeSessionRef?: string;
    startedAt?: string;
  };
  // IM-only routing fact (trigger/target team). Plain messages never carry this.
  routing?: Record<string, unknown>;
  message: {
    messageRef: string;
    parentRef: string | null;
    role: 'user' | 'assistant';
    occurredAt?: string;
    modelName?: string;
    content: string;
    contentFormat: 'text' | 'markdown';
    usage?: {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens?: number;
      cacheCreationTokens?: number;
      totalTokens: number;
    };
  };
  im?: Record<string, unknown>;
}

interface CursorFileRange {
  fileKey: string;
  pathHash: string;
  size: number;
  mtimeMs: number;
  fromOffset: number;
  toOffset: number;
}

interface ClientCursor {
  schemaVersion: 1;
  purpose: 'local-jsonl-scan-position';
  transactionId: string;
  baseCursorHash: string;
  targetCursorHash: string;
  fileCount: number;
  messageCount: number;
  generatedAt: string;
  files: CursorFileRange[];
}

interface UploadPayload {
  schemaVersion: 1;
  generatedAt: string;
  reporter: string;
  // `client.tool` declares the producing tool explicitly (claudecode/codex); the
  // server registers it as the channel key with no model→platform inference.
  client: { tool: string; version?: string; instanceId?: string };
  // scene drives server-side routing: coding (plain Claude/Codex turns) vs
  // digital_employee (IM-origin turns).
  scene: 'coding' | 'digital_employee';
  clientCursor?: ClientCursor;
  // Unified contract: project/conversation/im may live per-message (message-level
  // wins) OR at top-level as a fallback. Collected messages always carry their own
  // context, so the payload base leaves these absent.
  project?: UploadMessage['project'];
  conversation?: UploadMessage['conversation'];
  messages: UploadMessage[];
}

interface UploadReceipt {
  ok?: boolean;
  uploadId?: string;
  receiptId?: string;
  status?: string;
  received?: number;
  acceptedForProcessing?: number;
  duplicatedAtReceive?: number;
  rejectedAtReceive?: number;
  statusUrl?: string;
  detailUrl?: string;
  errors?: unknown;
}

interface ServerCursorFileState {
  fileKey: string;
  pathHash: string;
  size: number;
  mtimeMs: number;
  fromOffset?: number;
  toOffset: number;
}

interface ServerCursor {
  schemaVersion?: number;
  purpose?: string;
  transactionId?: string;
  baseCursorHash?: string;
  targetCursorHash?: string;
  fileCount?: number;
  messageCount?: number;
  generatedAt?: string;
  files?: ServerCursorFileState[];
}

interface UsageStatusChannel {
  source?: string;
  platform?: UploadPlatform;
  mode?: UploadMode;
  status?: string;
  lastUploadId?: string | null;
  inFlight?: { count?: number; uploadIds?: string[] } | null;
  currentCursor?: ServerCursor | null;
  lastAttemptedCursor?: ServerCursor | null;
  cursorCommitted?: boolean;
}

interface UsageStatusResponse {
  checkedAt?: string;
  channels?: UsageStatusChannel[];
}

interface CollectedMessages {
  messages: UploadMessage[];
  clientCursor: ClientCursor;
}

function resolveConversationUploadBaseUrl(): string {
  return OPENHERMIT_CONVERSATION_UPLOAD_BASE_URL;
}

function emptyStatus(
  enabled: boolean,
  endpointConfigured: boolean,
  patch: Partial<ConversationUploadStatus> = {}
): ConversationUploadStatus {
  return {
    enabled,
    endpointConfigured,
    totalDiscovered: 0,
    skippedAlreadyUploaded: 0,
    pending: 0,
    attempted: 0,
    accepted: 0,
    duplicated: 0,
    rejected: 0,
    ...patch,
  };
}

function uploadLogPath(hermitHome: string): string {
  return path.join(hermitHome, 'logs', UPLOAD_LOG_FILE);
}

async function appendUploadLog(
  hermitHome: string,
  message: string,
  details: Record<string, unknown> = {}
): Promise<void> {
  try {
    const filePath = uploadLogPath(hermitHome);
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await appendFile(
      filePath,
      `${JSON.stringify({ timestamp: new Date().toISOString(), message, ...details })}\n`,
      { encoding: 'utf-8', mode: 0o600 }
    );
  } catch {
    // Logging must never block upload.
  }
}

function uploadLockPath(hermitHome: string): string {
  return path.join(hermitHome, 'telemetry', UPLOAD_LOCK_FILE);
}

/**
 * Clear a leftover upload lock from a previous (crashed/killed/rebooted) run.
 * Safe to call at worker startup so a stale lock from the previous boot is gone
 * before the first scan, instead of only being cleared on the next acquisition
 * attempt. No-op when there is no lock or it belongs to a live process.
 */
export async function sweepStaleUploadLock(home: string): Promise<boolean> {
  return clearStaleUploadLock(uploadLockPath(home));
}

async function clearStaleUploadLock(filePath: string): Promise<boolean> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    const lock = JSON.parse(raw) as { pid?: number; createdAt?: string };
    const pid = Number(lock.pid);
    const ageMs = Date.now() - Date.parse(lock.createdAt || '');
    const staleByAge = Number.isFinite(ageMs) && ageMs > 30 * 60 * 1000;
    let staleByPid = false;
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
      } catch {
        staleByPid = true;
      }
    }
    if (!staleByPid && !staleByAge) return false;
    await unlink(filePath).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

// Create the lock file, retrying on contention so a manual `usage report` (or
// --full) completes instead of being skipped when the background worker is
// mid-scan. The bg scan holds the lock only briefly between cycles, so waiting
// a short while usually acquires it. Returns true once acquired, false on
// timeout. (Wait read at call time so tests can override via env.)
async function acquireUploadLock(hermitHome: string, filePath: string): Promise<boolean> {
  const deadline = Date.now() + Number(process.env.HERMIT_UPLOAD_LOCK_WAIT_MS ?? '60000');
  let loggedWaiting = false;
  while (Date.now() < deadline) {
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      handle = await open(filePath, 'wx', 0o600);
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })
      );
      return true;
    } catch {
      // contention or transient error — fall through to retry
    } finally {
      await handle?.close().catch(() => undefined);
    }
    const stale = await clearStaleUploadLock(filePath);
    if (!stale) {
      if (!loggedWaiting) {
        loggedWaiting = true;
        await appendUploadLog(hermitHome, 'upload-lock-busy-waiting', {
          lockPath: 'telemetry/conversation-message-upload.lock',
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return false;
}

export async function withUploadLock<T>(
  hermitHome: string,
  fn: () => Promise<T>
): Promise<T | null> {
  const filePath = uploadLockPath(hermitHome);
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const acquired = await acquireUploadLock(hermitHome, filePath);
  if (!acquired) {
    await appendUploadLog(hermitHome, 'upload-lock-busy', {
      lockPath: 'telemetry/conversation-message-upload.lock',
    });
    return null;
  }

  try {
    return await fn();
  } finally {
    await unlink(filePath).catch(() => undefined);
  }
}

function apiUrl(baseUrl: string, apiPath: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (base.endsWith('/api/v1') && apiPath.startsWith('/api/v1/')) {
    return `${base}${apiPath.slice('/api/v1'.length)}`;
  }
  return `${base}${apiPath}`;
}

function statusUrl(baseUrl: string, receipt: UploadReceipt): string | null {
  const url = receipt.statusUrl || receipt.detailUrl;
  if (!url)
    return receipt.uploadId
      ? `/api/v1/hermit/uploads/${encodeURIComponent(receipt.uploadId)}`
      : null;
  return url;
}

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeRef(prefix: string, value: string): string {
  return `${prefix}-${sha(value).slice(0, 24)}`;
}

function cursorHash(cursor: unknown): string {
  return sha(JSON.stringify(cursor ?? null));
}

function fileKey(filePath: string): string {
  return sha(filePath);
}

function hermitHome(): string {
  // os.homedir() (not process.env.HOME) — HOME is undefined on native Windows,
  // which collapsed this to a relative `.hermit` and broke auth/data resolution
  // for the spawned worker. Matches the other ~12 home-resolution sites.
  return process.env.HERMIT_HOME || path.join(os.homedir(), '.hermit');
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    const block = item as Record<string, unknown>;
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join('\n').trim();
}

function usageFromMessage(
  message: Record<string, unknown>
): UploadMessage['message']['usage'] | undefined {
  const usage = message.usage as Record<string, unknown> | undefined;
  if (!usage || typeof usage !== 'object') return undefined;
  const inputTokens = Number(usage.input_tokens ?? usage.inputTokens ?? 0);
  const outputTokens = Number(usage.output_tokens ?? usage.outputTokens ?? 0);
  const cacheReadTokens = Number(usage.cache_read_input_tokens ?? usage.cacheReadTokens ?? 0);
  const cacheCreationTokens = Number(
    usage.cache_creation_input_tokens ?? usage.cacheCreationTokens ?? 0
  );
  const totalTokens = Number(
    usage.total_tokens ??
      usage.totalTokens ??
      inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens
  );
  if (!inputTokens && !outputTokens && !cacheReadTokens && !cacheCreationTokens && !totalTokens) {
    return undefined;
  }
  return { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, totalTokens };
}

async function* walkJsonl(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkJsonl(full);
    else if (entry.isFile() && entry.name.endsWith('.jsonl') && !entry.name.startsWith('agent_')) {
      yield full;
    }
  }
}

async function probeAuthOnce(
  baseUrl: string,
  token: string,
  home: string
): Promise<{ reason: string | null; accessExpired: boolean }> {
  const res = await authedFetch(home, baseUrl, apiUrl(baseUrl, '/api/v1/auth/hermit/me'), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const status = typeof body.status === 'string' ? body.status : `HTTP ${res.status}`;
  const accessExpired = body.access_expired === true;
  const scopes = Array.isArray(body.scopes)
    ? body.scopes.filter((scope) => typeof scope === 'string')
    : null;
  const missingUploadScopes = scopes
    ? ['upload:read', 'upload:write'].filter((scope) => !scopes.includes(scope))
    : [];
  await appendUploadLog(home, 'auth-me-checked', {
    ok:
      res.ok && body.authenticated !== false && status === 'ok' && missingUploadScopes.length === 0,
    status,
    feishuAuthorized: body.feishu_authorized,
    accessExpired,
    scopes,
    missingUploadScopes,
  });
  if (!res.ok || body.authenticated === false || status !== 'ok') {
    return { reason: `授权不可用：${status}`, accessExpired };
  }
  if (missingUploadScopes.length > 0) {
    return { reason: `缺少 ${missingUploadScopes.join('/')} 授权，请重新登录`, accessExpired };
  }
  return { reason: null, accessExpired };
}

async function probeAuth(baseUrl: string, token: string, home: string): Promise<string | null> {
  let result = await probeAuthOnce(baseUrl, token, home);
  // The server may report access_expired as 200 + access_expired:true (not a
  // 401) even when the local expiresAt still looks valid — authedFetch only
  // refreshes on 401. Mirror bin/lib/auth.mjs: refresh and retry /me once.
  if (result.accessExpired) {
    await appendUploadLog(home, 'auth-refresh-attempted', { reason: 'access_expired' });
    const refreshed = await refreshAccessToken(home, baseUrl);
    const nextToken = refreshed?.token?.accessToken;
    if (nextToken) {
      await appendUploadLog(home, 'auth-retry-after-401', {
        endpoint: '/me',
        reason: 'access_expired',
      });
      result = await probeAuthOnce(baseUrl, nextToken, home);
    }
  }
  return result.reason;
}

async function fetchUsageChannel(
  baseUrl: string,
  token: string,
  platform: UploadPlatform,
  mode: UploadMode,
  home?: string
): Promise<UsageStatusChannel | null> {
  const url = apiUrl(baseUrl, `/api/v1/hermit/usage/status?platform=${platform}&mode=${mode}`);
  await (home
    ? appendUploadLog(home, 'usage-status-request', {
        platform,
        mode,
        url: `/api/v1/hermit/usage/status?platform=${platform}&mode=${mode}`,
      })
    : Promise.resolve());
  const res = await authedFetch(home ?? hermitHome(), baseUrl, url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    const diagnostic = responseDiagnosticFromText(res.status, text);
    await (home
      ? appendUploadLog(home, 'usage-status-response', {
          platform,
          mode,
          ok: false,
          status: res.status,
          body: sanitizeDiagnosticText(text),
        })
      : Promise.resolve());
    throw new Error(`usage status ${platform}/${mode} ${diagnostic}`);
  }
  const body = parseJsonObject(text) as UsageStatusResponse;
  const channel =
    body.channels?.find(
      (item) => item.source === SOURCE && item.platform === platform && item.mode === mode
    ) ??
    body.channels?.[0] ??
    null;
  await (home
    ? appendUploadLog(home, 'usage-status-response', {
        platform,
        mode,
        ok: true,
        status: res.status,
        channelStatus: channel?.status,
        inFlightCount: channel?.inFlight?.count ?? 0,
        hasCurrentCursor: Boolean(channel?.currentCursor),
        cursorHash: channel?.currentCursor?.targetCursorHash,
      })
    : Promise.resolve());
  return channel;
}

function cursorOffsetMap(
  cursor: ServerCursor | null | undefined
): Map<string, ServerCursorFileState> {
  const files = Array.isArray(cursor?.files) ? cursor.files : [];
  return new Map(
    files
      .filter(
        (file): file is ServerCursorFileState =>
          Boolean(file?.fileKey) &&
          Number.isFinite(Number(file.toOffset)) &&
          Number(file.toOffset) >= 0
      )
      .map((file) => [file.fileKey, file])
  );
}

function startOffsetFromServerCursor(
  remoteState: ServerCursorFileState | undefined,
  fileStat: Awaited<ReturnType<typeof stat>>
): number {
  if (!remoteState) return 0;
  const offset = Number(remoteState.toOffset);
  if (!Number.isFinite(offset) || offset < 0 || offset > fileStat.size) return 0;
  if (Number(remoteState.size) > fileStat.size) return 0;
  return offset;
}

function buildClientCursor(
  baseCursor: ServerCursor | null | undefined,
  files: CursorFileRange[],
  messageCount: number,
  generatedAt: string
): ClientCursor {
  const targetShape = {
    schemaVersion: 1,
    purpose: 'local-jsonl-scan-position',
    files: files.map((file) => ({
      fileKey: file.fileKey,
      pathHash: file.pathHash,
      size: file.size,
      mtimeMs: file.mtimeMs,
      toOffset: file.toOffset,
    })),
  };
  return {
    schemaVersion: 1,
    purpose: 'local-jsonl-scan-position',
    transactionId: `tx-${generatedAt.replace(/[^0-9A-Za-z]/g, '')}-${sha(`${generatedAt}:${messageCount}:${files.length}`).slice(0, 12)}`,
    baseCursorHash: cursorHash(baseCursor ?? null),
    targetCursorHash: cursorHash(targetShape),
    fileCount: files.length,
    messageCount,
    generatedAt,
    files,
  };
}

function claudeMessageId(obj: Record<string, unknown>, msg: Record<string, unknown>): string {
  return String(obj.uuid ?? msg.uuid ?? obj.messageId ?? msg.id ?? obj.requestId ?? '');
}

function claudeSessionId(filePath: string, obj: Record<string, unknown>): string {
  return String(obj.sessionId ?? obj.session_id ?? path.basename(filePath, '.jsonl'));
}

function parentMessageRef(parent: unknown): string | null {
  return typeof parent === 'string' && parent ? parent : null;
}

function claudeUploadMessage(
  filePath: string,
  obj: Record<string, unknown>,
  reportedAt: string,
  startedAt: string | undefined
): UploadMessage | null {
  const msg = (obj.message && typeof obj.message === 'object' ? obj.message : obj) as Record<
    string,
    unknown
  >;
  const role = msg.role === 'user' || msg.role === 'assistant' ? msg.role : undefined;
  if (!role) return null;

  const content = textFromContent(msg.content ?? obj.content);
  const usage = usageFromMessage(msg);
  // Keep a message if it has readable text OR token usage. Tool-use / tool-result
  // turns carry no text but hold the bulk of token usage — dropping them made the
  // server undercount tokens, and the cursor advances past them so they would
  // never be retried. Textless usage-bearing messages get a placeholder content
  // so their usage is still reported; the server dedupes by eventId.
  if (!content && !usage) return null;
  const reportedContent = content || (role === 'assistant' ? '[tool use]' : '[no text]');

  const sessionId = claudeSessionId(filePath, obj);
  const messageId = claudeMessageId(obj, msg);
  if (!sessionId || !messageId) return null;

  const projectPath = typeof obj.cwd === 'string' ? obj.cwd : path.dirname(filePath);
  const occurredAt =
    typeof obj.timestamp === 'string'
      ? obj.timestamp
      : typeof msg.timestamp === 'string'
        ? msg.timestamp
        : undefined;
  const eventId = `claudecode:${sessionId}:${messageId}`;
  return {
    kind: 'conversation_message',
    eventId,
    reportedAt,
    project: {
      projectRef: safeRef('project', projectPath),
      name: path.basename(projectPath),
      pathHash: `sha256-${sha(projectPath)}`,
    },
    conversation: {
      conversationId: sessionId,
      sessionRef: `claudecode:${sessionId}`,
      claudeSessionRef: sessionId,
      startedAt,
    },
    message: {
      messageRef: messageId,
      parentRef: parentMessageRef(obj.parentUuid ?? obj.parentMessageId),
      role,
      occurredAt,
      modelName: typeof msg.model === 'string' ? msg.model : undefined,
      content: reportedContent,
      contentFormat: 'text',
      usage,
    },
  };
}

async function collectClaudeCodeMessages(
  mode: UploadMode,
  serverCursor: ServerCursor | null | undefined,
  limit: number,
  generatedAt: string
): Promise<CollectedMessages> {
  const messages: UploadMessage[] = [];
  const files: CursorFileRange[] = [];
  const maxMessages = Math.max(0, limit);
  const offsets = cursorOffsetMap(serverCursor);
  // IM attribution: a Claude session is IM-origin iff hermit-bridge recorded it
  // as the agent_session_id it drove (the jsonl filename). Loaded once per call;
  // the hermit-bridge session store is a handful of small JSON files.
  const imEnvelopes = await loadImOriginEnvelopes(hermitHome());
  // IM-only routing context: the team that owns the agent's workspace (resolved
  // from the session cwd) and the logged-in tenant. Loaded only for the IM
  // channel — plain never needs them.
  const teamAttributor = mode === 'im' ? await ImTeamAttributor.load(hermitHome()) : null;
  const tenantKey = mode === 'im' ? await readTenantKey(hermitHome()) : undefined;

  for await (const filePath of walkJsonl(getProjectsBasePath())) {
    if (maxMessages > 0 && messages.length >= maxMessages) break;
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat?.isFile()) continue;

    const key = fileKey(filePath);
    const pathHash = `sha256-${sha(filePath)}`;
    const fromOffset = startOffsetFromServerCursor(offsets.get(key), fileStat);
    const scanEndOffset = fileStat.size;
    if (fromOffset >= scanEndOffset) {
      files.push({
        fileKey: key,
        pathHash,
        size: fileStat.size,
        mtimeMs: Math.trunc(fileStat.mtimeMs),
        fromOffset,
        toOffset: scanEndOffset,
      });
      continue;
    }

    const imEnvelope = imEnvelopes.get(path.basename(filePath, '.jsonl'));
    let consumedOffset = fromOffset;
    let startedAt: string | undefined;
    const stream = createReadStream(filePath, {
      encoding: 'utf-8',
      start: fromOffset,
      end: Math.max(fromOffset, scanEndOffset - 1),
    });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const rawLine of rl) {
      if (maxMessages > 0 && messages.length >= maxMessages) break;
      consumedOffset += Buffer.byteLength(rawLine, 'utf-8') + 1;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(rawLine) as Record<string, unknown>;
      } catch {
        continue;
      }
      const occurredAt = typeof obj.timestamp === 'string' ? obj.timestamp : undefined;
      startedAt ||= occurredAt;
      const baseMessage = claudeUploadMessage(filePath, obj, generatedAt, startedAt);
      if (!baseMessage) continue;
      // Route by session origin: an IM-origin session goes to the IM channel, a
      // plain session goes to the plain channel — never both, never crossed.
      if (imEnvelope) {
        if (mode === 'im') {
          const cwd = typeof obj.cwd === 'string' ? obj.cwd : path.dirname(filePath);
          const team = teamAttributor?.resolveByCwd(cwd) ?? null;
          messages.push({
            ...baseMessage,
            kind: 'im_conversation_message',
            im: buildImBlock(imEnvelope, tenantKey),
            routing: buildRoutingBlock(imEnvelope, team),
          });
        }
      } else if (mode === 'plain') {
        messages.push(baseMessage);
      }
    }

    const toOffset =
      maxMessages > 0 && messages.length >= maxMessages
        ? Math.min(consumedOffset, scanEndOffset)
        : scanEndOffset;
    files.push({
      fileKey: key,
      pathHash,
      size: fileStat.size,
      mtimeMs: Math.trunc(fileStat.mtimeMs),
      fromOffset,
      toOffset,
    });
  }

  return {
    messages,
    clientCursor: buildClientCursor(serverCursor, files, messages.length, generatedAt),
  };
}

function codexHome(): string {
  // See hermitHome(): os.homedir() for Windows parity.
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

function codexTokenUsageFromRecord(
  record: Record<string, unknown>
): UploadMessage['message']['usage'] | undefined {
  const source = (
    record.usage && typeof record.usage === 'object' ? record.usage : record
  ) as Record<string, unknown>;
  const inputTokens = Number(
    source.input_tokens ??
      source.inputTokens ??
      source.input ??
      source.prompt_tokens ??
      source.promptTokens ??
      0
  );
  const cacheReadTokens = Number(
    source.cached_input_tokens ??
      source.cache_read_input_tokens ??
      source.cacheReadTokens ??
      source.cachedInputTokens ??
      0
  );
  const outputTokens = Number(
    source.output_tokens ??
      source.outputTokens ??
      source.output ??
      source.completion_tokens ??
      source.completionTokens ??
      0
  );
  const reasoningTokens = Number(
    source.reasoning_output_tokens ?? source.reasoningTokens ?? source.reasoning_tokens ?? 0
  );
  const totalTokens = Number(
    source.total_tokens ??
      source.totalTokens ??
      inputTokens + cacheReadTokens + outputTokens + reasoningTokens
  );
  if (!inputTokens && !cacheReadTokens && !outputTokens && !reasoningTokens && !totalTokens)
    return undefined;
  return {
    inputTokens,
    outputTokens: outputTokens + reasoningTokens,
    cacheReadTokens,
    cacheCreationTokens: 0,
    totalTokens,
  };
}

function isCodexTokenCountRecord(record: Record<string, unknown>): boolean {
  const type = String(record.type ?? record.event ?? record.event_type ?? record.kind ?? '');
  return type === 'token_count' || type.endsWith('.token_count') || Boolean(record.token_count);
}

async function collectCodexMessages(
  mode: UploadMode,
  serverCursor: ServerCursor | null | undefined,
  limit: number,
  generatedAt: string
): Promise<CollectedMessages> {
  const messages: UploadMessage[] = [];
  const files: CursorFileRange[] = [];
  const maxMessages = Math.max(0, limit);
  const offsets = cursorOffsetMap(serverCursor);
  if (mode === 'im')
    return { messages, clientCursor: buildClientCursor(serverCursor, files, 0, generatedAt) };

  for (const root of [
    path.join(codexHome(), 'sessions'),
    path.join(codexHome(), 'archived_sessions'),
  ]) {
    for await (const filePath of walkJsonl(root)) {
      if (maxMessages > 0 && messages.length >= maxMessages) break;
      const fileStat = await stat(filePath).catch(() => null);
      if (!fileStat?.isFile()) continue;

      const key = fileKey(filePath);
      const pathHash = `sha256-${sha(filePath)}`;
      const fromOffset = startOffsetFromServerCursor(offsets.get(key), fileStat);
      const scanEndOffset = fileStat.size;
      if (fromOffset >= scanEndOffset) {
        files.push({
          fileKey: key,
          pathHash,
          size: fileStat.size,
          mtimeMs: Math.trunc(fileStat.mtimeMs),
          fromOffset,
          toOffset: scanEndOffset,
        });
        continue;
      }

      const sessionId = path.basename(filePath, '.jsonl');
      let consumedOffset = fromOffset;
      let startedAt: string | undefined;
      const stream = createReadStream(filePath, {
        encoding: 'utf-8',
        start: fromOffset,
        end: Math.max(fromOffset, scanEndOffset - 1),
      });
      const rl = createInterface({ input: stream, crlfDelay: Infinity });
      for await (const rawLine of rl) {
        if (maxMessages > 0 && messages.length >= maxMessages) break;
        consumedOffset += Buffer.byteLength(rawLine, 'utf-8') + 1;
        let obj: Record<string, unknown>;
        try {
          obj = JSON.parse(rawLine) as Record<string, unknown>;
        } catch {
          continue;
        }
        const record =
          obj.token_count && typeof obj.token_count === 'object'
            ? (obj.token_count as Record<string, unknown>)
            : obj;
        if (!isCodexTokenCountRecord(obj) && !isCodexTokenCountRecord(record)) continue;
        const usage = codexTokenUsageFromRecord(record);
        if (!usage) continue;

        const occurredAt =
          typeof obj.timestamp === 'string'
            ? obj.timestamp
            : typeof record.timestamp === 'string'
              ? record.timestamp
              : generatedAt;
        startedAt ||= occurredAt;
        const messageId = String(
          obj.id ?? obj.uuid ?? record.id ?? `${sessionId}:${consumedOffset}`
        );
        const projectPath = String(record.cwd ?? record.project_path ?? filePath);
        messages.push({
          kind: 'conversation_message',
          eventId: `codex:${sessionId}:${messageId}`,
          reportedAt: generatedAt,
          project: {
            projectRef: safeRef('codex-project', projectPath),
            name: typeof record.project === 'string' ? record.project : 'Codex',
            pathHash: `sha256-${sha(projectPath)}`,
          },
          conversation: { conversationId: sessionId, sessionRef: `codex:${sessionId}`, startedAt },
          message: {
            messageRef: messageId,
            parentRef: null,
            role: 'assistant',
            occurredAt,
            modelName:
              typeof record.model === 'string'
                ? record.model
                : typeof obj.model === 'string'
                  ? obj.model
                  : undefined,
            content: 'Codex token usage event',
            contentFormat: 'text',
            usage,
          },
        });
      }

      const toOffset =
        maxMessages > 0 && messages.length >= maxMessages
          ? Math.min(consumedOffset, scanEndOffset)
          : scanEndOffset;
      files.push({
        fileKey: key,
        pathHash,
        size: fileStat.size,
        mtimeMs: Math.trunc(fileStat.mtimeMs),
        fromOffset,
        toOffset,
      });
    }
    if (maxMessages > 0 && messages.length >= maxMessages) break;
  }

  return {
    messages,
    clientCursor: buildClientCursor(serverCursor, files, messages.length, generatedAt),
  };
}

async function collectMessagesForPlatform(
  platform: UploadPlatform,
  mode: UploadMode,
  serverCursor: ServerCursor | null | undefined,
  limit: number,
  generatedAt: string
): Promise<CollectedMessages> {
  return platform === 'codex'
    ? collectCodexMessages(mode, serverCursor, limit, generatedAt)
    : collectClaudeCodeMessages(mode, serverCursor, limit, generatedAt);
}

function sanitizeDiagnosticText(value: unknown): string {
  return String(value ?? '')
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi, '$1[hidden]')
    .replace(
      /(access[_-]?token|refresh[_-]?token|token|secret|password|authorization)(["'\s:=]+)([^\s,"'}]+)/gi,
      '$1$2[hidden]'
    )
    .slice(0, 1200);
}

function sanitizeUploadError(error: unknown): string {
  return sanitizeDiagnosticText(error instanceof Error ? error.message : String(error));
}

function responseDiagnosticFromText(status: number, text = ''): string {
  if (!text) return `HTTP ${status}`;
  return `HTTP ${status}: ${sanitizeDiagnosticText(text)}`;
}

async function responseDiagnostic(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  return responseDiagnosticFromText(res.status, text);
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function uploadStatusFromResult(
  receipt: UploadReceipt,
  attempted: number,
  baseUrl: string
): ConversationUploadStatus {
  const received = typeof receipt.received === 'number' ? receipt.received : attempted;
  const rejectedAtReceive =
    typeof receipt.rejectedAtReceive === 'number' ? receipt.rejectedAtReceive : 0;
  const accepted =
    typeof receipt.acceptedForProcessing === 'number'
      ? receipt.acceptedForProcessing
      : Math.max(0, received - rejectedAtReceive);
  const status: ConversationUploadStatus = {
    enabled: true,
    endpointConfigured: true,
    attempted,
    accepted,
    duplicated: typeof receipt.duplicatedAtReceive === 'number' ? receipt.duplicatedAtReceive : 0,
    rejected: rejectedAtReceive,
    queued: accepted,
    uploadIds: receipt.uploadId ? [receipt.uploadId] : [],
    lastReceiptId: receipt.receiptId,
    lastStatusUrl: statusUrl(baseUrl, receipt) || undefined,
    lastUploadStatus: receipt.status,
  };
  // Only an intake-level rejection is a real, actionable failure. A non-terminal
  // receipt ('queued') is normal: the server processes asynchronously and reports
  // authoritative counts + the committed cursor via /usage/status on the next scan.
  // The interface is the single source of truth — no parallel local accounting.
  if (receipt.ok === false || receipt.errors || rejectedAtReceive > 0) {
    status.lastError = '服务端接收阶段返回错误，已保留待上报状态';
  }
  return status;
}

function batchDelayMs(): number {
  const raw = Number.parseInt(process.env.OPENHERMIT_UPLOAD_BATCH_DELAY_MS ?? '', 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : 1_000;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postPayload(
  home: string,
  baseUrl: string,
  endpointPath: string,
  platform: UploadPlatform,
  token: string,
  payload: UploadPayload,
  mode: UploadMode
): Promise<ConversationUploadStatus> {
  const firstMessage = payload.messages[0];
  await appendUploadLog(home, 'upload-request', {
    endpoint: endpointPath,
    mode,
    platform,
    schemaVersion: payload.schemaVersion,
    reporter: payload.reporter,
    messageCount: payload.messages.length,
    hasClientCursor: Boolean(payload.clientCursor),
    cursorHash: payload.clientCursor?.targetCursorHash,
    cursorFileCount: payload.clientCursor?.fileCount,
    cursorMessageCount: payload.clientCursor?.messageCount,
    firstEventId: firstMessage?.eventId,
    firstKind: firstMessage?.kind,
    firstProjectRef: firstMessage?.project?.projectRef,
    hasRequestUploadId:
      Object.prototype.hasOwnProperty.call(payload, 'uploadId') ||
      Object.prototype.hasOwnProperty.call(payload, 'upload_id'),
  });
  const res = await authedFetch(home, baseUrl, apiUrl(baseUrl, endpointPath), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  const text = await res.text().catch(() => '');
  await appendUploadLog(home, 'upload-response', {
    endpoint: endpointPath,
    mode,
    platform,
    ok: res.ok,
    status: res.status,
    body: sanitizeDiagnosticText(text),
  });
  const receipt = parseJsonObject(text) as UploadReceipt;
  if (!res.ok) {
    throw new Error(
      `upload ${endpointPath} ${await responseDiagnostic(new Response(text, { status: res.status, statusText: res.statusText }))}`
    );
  }
  // Receipt-only: the 202 confirms the batch was accepted for processing. The
  // server is cursor-authoritative + eventId-dedup — it commits the cursor on
  // success and reports authoritative counts via /usage/status on the next scan.
  // No per-batch terminal-status polling: that fed display counts only and froze
  // the menu for ~an hour on a 199-batch first backfill (and made the worker hold
  // the lock ~an hour per cycle). The interface is the single source of truth.
  return uploadStatusFromResult(receipt, payload.messages.length, baseUrl);
}

function mergeStatuses(statuses: ConversationUploadStatus[]): ConversationUploadStatus {
  return statuses.reduce<ConversationUploadStatus>(
    (acc, item) => ({
      enabled: acc.enabled || item.enabled,
      endpointConfigured: acc.endpointConfigured || item.endpointConfigured,
      totalDiscovered: (acc.totalDiscovered ?? 0) + (item.totalDiscovered ?? 0),
      skippedAlreadyUploaded:
        (acc.skippedAlreadyUploaded ?? 0) + (item.skippedAlreadyUploaded ?? 0),
      pending: (acc.pending ?? 0) + (item.pending ?? 0),
      attempted: acc.attempted + item.attempted,
      accepted: acc.accepted + item.accepted,
      duplicated: acc.duplicated + item.duplicated,
      rejected: acc.rejected + item.rejected,
      inserted: (acc.inserted ?? 0) + (item.inserted ?? 0),
      failed: (acc.failed ?? 0) + (item.failed ?? 0),
      queued: (acc.queued ?? 0) + (item.queued ?? 0),
      uploadIds: [...(acc.uploadIds ?? []), ...(item.uploadIds ?? [])],
      lastUploadStatus: item.lastUploadStatus ?? acc.lastUploadStatus,
      lastReceiptId: item.lastReceiptId ?? acc.lastReceiptId,
      lastStatusUrl: item.lastStatusUrl ?? acc.lastStatusUrl,
      lastError: item.lastError ?? acc.lastError,
    }),
    emptyStatus(true, true)
  );
}

function resolveUploadProviders(
  telemetry: ConversationUploadTelemetryConfig | undefined
): UploadPlatform[] {
  const providers = telemetry?.uploadProviders?.length
    ? telemetry.uploadProviders
    : [telemetry?.platform || 'claudecode'];
  return [
    ...new Set(
      providers.filter(
        (provider): provider is UploadPlatform => provider === 'claudecode' || provider === 'codex'
      )
    ),
  ];
}

async function postMessagesInBatches(
  home: string,
  baseUrl: string,
  endpointPath: string,
  platform: UploadPlatform,
  mode: UploadMode,
  token: string,
  payloadBase: Omit<UploadPayload, 'messages'>,
  messages: UploadMessage[],
  batchSize: number,
  runTotalMessages: number,
  uploadedBeforeRun: number
): Promise<{ status: ConversationUploadStatus; uploadedCount: number }> {
  const statuses: ConversationUploadStatus[] = [];
  let uploadedCount = 0;
  const size = Math.max(1, batchSize);
  const totalBatches = Math.ceil(messages.length / size);

  for (let offset = 0; offset < messages.length; offset += size) {
    const batchIndex = Math.floor(offset / size) + 1;
    const batchMessages = messages.slice(offset, offset + size);
    await appendUploadLog(home, 'upload-batch-start', {
      platform,
      mode,
      batchIndex,
      totalBatches,
      batchSize: batchMessages.length,
      attemptedBeforeBatch: offset,
      attemptedAfterBatch: Math.min(messages.length, offset + batchMessages.length),
      uploadedBeforeBatch: uploadedBeforeRun + uploadedCount,
      totalMessages: runTotalMessages,
    });

    try {
      // Attach the cursor to EVERY batch, not only the last. The cursor marks
      // the scan position (per-file offsets) and is identical across batches;
      // the server commits it from whichever batch it durably processes, so a
      // mid-run crash still leaves an accurate cursor instead of none.
      const status = await postPayload(
        home,
        baseUrl,
        endpointPath,
        platform,
        token,
        {
          ...payloadBase,
          messages: batchMessages,
        },
        mode
      );
      statuses.push(status);
      // A batch that didn't hard-fail was accepted for processing (the 202
      // receipt). lastError is only set on intake rejection / HTTP error, so its
      // absence means the batch is in flight server-side — count it as sent.
      if (!status.lastError) {
        uploadedCount += batchMessages.length;
      }
      await appendUploadLog(home, 'upload-batch-finished', {
        platform,
        mode,
        batchIndex,
        totalBatches,
        attempted: status.attempted,
        accepted: status.accepted,
        duplicated: status.duplicated,
        rejected: status.rejected,
        failed: status.failed,
        uploadIds: status.uploadIds,
        lastUploadStatus: status.lastUploadStatus,
        ok: !status.lastError,
        uploadedAfterBatch: uploadedBeforeRun + uploadedCount,
        totalMessages: runTotalMessages,
        lastError: status.lastError,
      });
      if (status.lastError) return { status: mergeStatuses(statuses), uploadedCount };
      if (batchIndex < totalBatches) await wait(batchDelayMs());
    } catch (error) {
      const message = sanitizeUploadError(error);
      await appendUploadLog(home, 'upload-batch-failed', {
        platform,
        mode,
        batchIndex,
        totalBatches,
        batchSize: batchMessages.length,
        attemptedBeforeFailure: offset,
        attemptedAfterFailure: offset + batchMessages.length,
        uploadedBeforeFailure: uploadedBeforeRun + uploadedCount,
        totalMessages: runTotalMessages,
        lastError: message,
      });
      statuses.push(
        emptyStatus(true, true, {
          attempted: batchMessages.length,
          pending: messages.length,
          lastError: message,
        })
      );
      return { status: mergeStatuses(statuses), uploadedCount };
    }
  }

  return { status: mergeStatuses(statuses), uploadedCount };
}

async function uploadPlatformModeMessages(
  platform: UploadPlatform,
  mode: UploadMode,
  channel: UsageStatusChannel | null,
  cfg: ConversationUploadConfig,
  home: string,
  baseUrl: string,
  token: string,
  generatedAt: string
): Promise<ConversationUploadStatus> {
  const fullRescan = process.env.HERMIT_USAGE_FULL_RESCAN === '1';
  // A user-initiated scan (`usage report`, the 扫描一次 menu action, or --full)
  // runs as a --scan-once child with HERMIT_USAGE_FOREGROUND_SCAN=1; the periodic
  // daemon loop does NOT. Only the daemon defers to server backpressure — a
  // foreground scan must push through so a pending backlog actually drains.
  const foreground = process.env.HERMIT_USAGE_FOREGROUND_SCAN === '1';
  const inFlightCount = Number(channel?.inFlight?.count ?? 0);
  if (inFlightCount > 0 && !(foreground || fullRescan)) {
    await appendUploadLog(home, 'server-channel-inflight', {
      platform,
      mode,
      uploadIds: channel?.inFlight?.uploadIds ?? [],
    });
    return emptyStatus(true, true, {
      lastUploadStatus: channel?.status || 'processing',
      uploadIds: channel?.inFlight?.uploadIds ?? [],
    });
  }
  if (inFlightCount > 0) {
    // Foreground/full scan: don't let an in-flight batch from a prior run block
    // the drain. The server dedupes by eventId, so proceeding absorbs the
    // overlap — without this the channel skips forever while a backlog sits,
    // and 待上报 never drops.
    await appendUploadLog(home, 'server-channel-inflight-foreground', {
      platform,
      mode,
      uploadIds: channel?.inFlight?.uploadIds ?? [],
    });
  }
  // No cursor must NOT pause the upload. A missing cursor can simply mean this
  // is the channel's FIRST upload (nothing committed yet), or that the
  // server-side cursor commit is not implemented yet. Either way we proceed:
  // collectMessagesForPlatform receives the server cursor when present
  // (incremental) or null (full rescan), and the server dedupes by eventId.
  // Incremental resumes automatically once the server starts committing.

  const conversationCfg = cfg.telemetry?.conversations;
  // `usage report --full` backfill: ignore the server cursor so every file scans
  // from offset 0 and re-uploads everything. The server dedupes by eventId, so
  // already-uploaded messages become duplicates (not re-counted) and messages
  // newly included by a filter change (e.g. tool-use turns that now keep their
  // usage) get inserted. After success the server commits the full-range cursor.
  const { messages, clientCursor } = await collectMessagesForPlatform(
    platform,
    mode,
    fullRescan ? null : channel?.currentCursor,
    conversationCfg?.batchSize ?? 0,
    generatedAt
  );
  const baseStatus = {
    totalDiscovered: messages.length,
    skippedAlreadyUploaded: 0,
    pending: messages.length,
  };
  await appendUploadLog(home, 'scan-collected', {
    platform,
    mode,
    ...baseStatus,
    cursorSource: 'server-usage-status-currentCursor',
    baseCursorHash: clientCursor.baseCursorHash,
    targetCursorHash: clientCursor.targetCursorHash,
  });

  if (!messages.length) {
    await appendUploadLog(home, 'no-incremental-messages', { platform, mode, ...baseStatus });
    return emptyStatus(true, true, baseStatus);
  }

  const uploadBatchSize = Number(
    (conversationCfg as { uploadBatchSize?: number } | undefined)?.uploadBatchSize ??
      process.env.OPENHERMIT_CONVERSATION_UPLOAD_BATCH_SIZE ??
      500
  );
  const payloadBase: Omit<UploadPayload, 'messages'> = {
    schemaVersion: 1,
    generatedAt,
    reporter: SOURCE,
    client: { tool: platform },
    scene: mode === 'im' ? 'digital_employee' : 'coding',
    clientCursor,
  };

  await appendUploadLog(home, 'upload-start', {
    platform,
    mode,
    pending: messages.length,
    batchSize: uploadBatchSize,
    baseUrl,
  });

  // Unified endpoint: plain and IM both POST to /api/v1/report/messages in a
  // single batch sequence. Each message carries its own context (project/
  // conversation/im/routing); scene distinguishes coding vs digital_employee.
  const { status, uploadedCount } = await postMessagesInBatches(
    home,
    baseUrl,
    UPLOAD_ENDPOINT,
    platform,
    mode,
    token,
    payloadBase,
    messages,
    uploadBatchSize,
    messages.length,
    0
  );
  // pending = discovered − uploaded (remaining), not the raw discovered count —
  // otherwise it shows "N 待上报" even after a fully-successful upload.
  const result = {
    ...status,
    ...baseStatus,
    pending: Math.max(0, messages.length - uploadedCount),
  };
  await appendUploadLog(home, 'upload-finished', {
    platform,
    mode,
    attempted: result.attempted,
    accepted: result.accepted,
    duplicated: result.duplicated,
    rejected: result.rejected,
    failed: result.failed,
    pending: result.pending,
    uploadIds: result.uploadIds,
    lastUploadStatus: result.lastUploadStatus,
    cursorAuthority: 'server',
    lastError: result.lastError,
  });
  return result;
}

async function uploadConversationMessagesLocked(
  cfg: ConversationUploadConfig
): Promise<ConversationUploadStatus> {
  const telemetry = cfg.telemetry;
  const conversationCfg = telemetry?.conversations;
  const enabled = Boolean(telemetry?.conversationUploadEnabled || conversationCfg?.uploadEnabled);
  const baseUrl = resolveConversationUploadBaseUrl();
  if (!enabled) return emptyStatus(false, Boolean(baseUrl));

  const home = hermitHome();
  const providers = resolveUploadProviders(telemetry);
  await appendUploadLog(home, 'scan-start', {
    endpointConfigured: Boolean(baseUrl),
    providers,
    cursorAuthority: 'server-usage-status',
  });

  const token = await getValidBearerToken(home, baseUrl);
  if (!token) {
    await appendUploadLog(home, 'waiting-login', { providers });
    return emptyStatus(true, Boolean(baseUrl), { lastError: '等待登录' });
  }

  const authError = await probeAuth(baseUrl, token, home);
  if (authError) {
    await appendUploadLog(home, 'auth-unavailable', { providers, lastError: authError });
    return emptyStatus(true, Boolean(baseUrl), { lastError: authError });
  }

  const generatedAt = new Date().toISOString();
  const channels = new Map<string, UsageStatusChannel | null>();
  try {
    for (const platform of providers) {
      for (const mode of ['plain', 'im'] as const) {
        channels.set(
          `${platform}:${mode}`,
          await fetchUsageChannel(baseUrl, token, platform, mode, home)
        );
      }
    }
  } catch (error) {
    const message = `服务端 /usage/status 不可用，未扫描未上报：${sanitizeUploadError(error)}`;
    await appendUploadLog(home, 'server-cursor-unavailable', { providers, lastError: message });
    return emptyStatus(true, true, { lastError: message });
  }

  // Upload each platform×mode channel concurrently: they target independent
  // endpoints and independent eventId-dedup namespaces, so there is no
  // contention between them. appendUploadLog uses single-line atomic
  // appendFile, so interleaved channel logs stay line-coherent.
  const combos = providers.flatMap((platform) =>
    (['plain', 'im'] as const).map((mode) => ({ platform, mode }))
  );
  const statuses = await Promise.all(
    combos.map(({ platform, mode }) =>
      uploadPlatformModeMessages(
        platform,
        mode,
        channels.get(`${platform}:${mode}`) ?? null,
        cfg,
        home,
        baseUrl,
        token,
        generatedAt
      )
    )
  );
  return mergeStatuses(statuses);
}

export async function uploadConversationMessages(
  cfg: ConversationUploadConfig
): Promise<ConversationUploadStatus> {
  const telemetry = cfg.telemetry;
  const conversationCfg = telemetry?.conversations;
  const enabled = Boolean(telemetry?.conversationUploadEnabled || conversationCfg?.uploadEnabled);
  const baseUrl = resolveConversationUploadBaseUrl();
  if (!enabled) return emptyStatus(false, Boolean(baseUrl));
  const home = hermitHome();
  const result = await withUploadLock(home, () => uploadConversationMessagesLocked(cfg));
  return (
    result ??
    emptyStatus(true, Boolean(baseUrl), { lastError: '已有消息上报任务正在运行，本轮已跳过' })
  );
}
