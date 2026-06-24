import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  appendFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import * as path from 'node:path';
import { createInterface } from 'node:readline';

import { getProjectsBasePath } from '@main/utils/pathDecoder';
import type { TaskBusConfig } from '@shared/types/team';

const DEFAULT_OPENHERMIT_CLOUD_HOST = '159.75.231.98';
const OPENHERMIT_CONVERSATION_UPLOAD_BASE_URL =
  process.env.OPENHERMIT_CONVERSATION_UPLOAD_BASE_URL ||
  process.env.OPENHERMIT_CLOUD_UPLOAD_BASE_URL ||
  `http://${process.env.OPENHERMIT_CLOUD_HOST || DEFAULT_OPENHERMIT_CLOUD_HOST}:8088`;

function resolveConversationUploadBaseUrl(): string {
  return OPENHERMIT_CONVERSATION_UPLOAD_BASE_URL;
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

interface UploadMessage {
  kind: 'conversation_message' | 'im_conversation_message';
  eventId: string;
  reportedAt: string;
  project: {
    projectRef: string;
    name: string;
    pathHash: string;
  };
  conversation: {
    conversationId: string;
    sessionRef: string;
    claudeSessionRef?: string;
    startedAt?: string;
  };
  message: {
    messageRef: string;
    parentRef: string | null;
    role: 'user' | 'assistant';
    occurredAt?: string;
    model?: string;
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

type UploadPlatform = 'claudecode' | 'codex';

interface UploadPayload {
  schemaVersion: 1;
  uploadId: string;
  generatedAt: string;
  source: 'openhermit';
  platform: UploadPlatform;
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

interface UploadResult {
  ok?: boolean;
  uploadId?: string;
  receiptId?: string;
  status?: string;
  received?: number;
  accepted?: number;
  inserted?: number;
  duplicated?: number;
  rejected?: number;
  failed?: number;
  errors?: unknown;
  items?: Array<{
    eventId?: string;
    status?: string;
    errorCode?: string | null;
    errorMessage?: string | null;
  }>;
}

interface ScanCursorFileState {
  pathHash: string;
  size: number;
  mtimeMs: number;
  offset: number;
}

interface ScanCursor {
  schemaVersion: 1;
  purpose: 'local-jsonl-scan-position';
  files: Record<string, ScanCursorFileState>;
}

const SCAN_CURSOR_FILE = 'conversation-message-scan-cursor.json';
const UPLOAD_LOCK_FILE = 'conversation-message-upload.lock';
const UPLOAD_LOG_FILE = 'conversation-upload.log';

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

function scanCursorPath(hermitHome: string, platform: UploadPlatform = 'claudecode'): string {
  const fileName =
    platform === 'claudecode'
      ? SCAN_CURSOR_FILE
      : `conversation-message-scan-cursor-${platform}.json`;
  return path.join(hermitHome, 'telemetry', fileName);
}

function uploadLockPath(hermitHome: string): string {
  return path.join(hermitHome, 'telemetry', UPLOAD_LOCK_FILE);
}

function cursorHash(cursor: ScanCursor): string {
  return sha(JSON.stringify(cursor));
}

async function withUploadLock<T>(hermitHome: string, fn: () => Promise<T>): Promise<T | null> {
  const filePath = uploadLockPath(hermitHome);
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(filePath, 'wx', 0o600);
    await handle.writeFile(
      JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })
    );
  } catch {
    await appendUploadLog(hermitHome, 'upload-lock-busy', {
      lockPath: 'telemetry/conversation-message-upload.lock',
    });
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }

  try {
    return await fn();
  } finally {
    await unlink(filePath).catch(() => undefined);
  }
}

async function commitScanCursorIfUnchanged(
  hermitHome: string,
  platform: UploadPlatform,
  baseCursorHash: string,
  nextCursor: ScanCursor
): Promise<boolean> {
  const currentCursor = await readScanCursor(hermitHome, platform);
  if (cursorHash(currentCursor) !== baseCursorHash) return false;
  await writeScanCursor(hermitHome, platform, nextCursor);
  return true;
}

async function readScanCursor(
  hermitHome: string,
  platform: UploadPlatform = 'claudecode'
): Promise<ScanCursor> {
  try {
    const raw = await readFile(scanCursorPath(hermitHome, platform), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ScanCursor>;
    if (
      parsed.schemaVersion !== 1 ||
      parsed.purpose !== 'local-jsonl-scan-position' ||
      !parsed.files ||
      typeof parsed.files !== 'object'
    ) {
      return { schemaVersion: 1, purpose: 'local-jsonl-scan-position', files: {} };
    }
    return {
      schemaVersion: 1,
      purpose: 'local-jsonl-scan-position',
      files: parsed.files as Record<string, ScanCursorFileState>,
    };
  } catch {
    return { schemaVersion: 1, purpose: 'local-jsonl-scan-position', files: {} };
  }
}

async function writeScanCursor(
  hermitHome: string,
  platform: UploadPlatform,
  cursor: ScanCursor
): Promise<void> {
  const filePath = scanCursorPath(hermitHome, platform);
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(cursor, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: 0o600,
  });
  await rename(tmpPath, filePath);
}

function fileKey(filePath: string): string {
  return sha(filePath);
}

function validCursorState(
  state: ScanCursorFileState | undefined,
  fileStat: Awaited<ReturnType<typeof stat>>
): state is ScanCursorFileState {
  if (!state) return false;
  if (!Number.isFinite(state.offset) || state.offset < 0) return false;
  if (state.offset > fileStat.size) return false;
  if (state.size > fileStat.size) return false;
  return true;
}

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeRef(prefix: string, value: string): string {
  return `${prefix}-${sha(value).slice(0, 24)}`;
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
  if (!inputTokens && !outputTokens && !cacheReadTokens && !cacheCreationTokens && !totalTokens)
    return undefined;
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
    else if (entry.isFile() && entry.name.endsWith('.jsonl') && !entry.name.startsWith('agent_'))
      yield full;
  }
}

async function readBearerToken(hermitHome: string): Promise<string | null> {
  try {
    const raw = await readFile(path.join(hermitHome, 'auth', 'openhermit.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { token?: { accessToken?: string; expiresAt?: string } };
    if (!parsed.token?.accessToken) return null;
    if (parsed.token.expiresAt && Date.parse(parsed.token.expiresAt) <= Date.now()) return null;
    return parsed.token.accessToken;
  } catch {
    return null;
  }
}

async function collectClaudeCodeMessages(
  hermitHome: string,
  limit: number
): Promise<{
  plain: UploadMessage[];
  im: UploadMessage[];
  baseCursorHash: string;
  nextCursor: ScanCursor;
}> {
  const plain: UploadMessage[] = [];
  const im: UploadMessage[] = [];
  const base = getProjectsBasePath();
  const reportedAt = new Date().toISOString();
  const maxMessages = Math.max(0, limit);
  const currentCursor = await readScanCursor(hermitHome, 'claudecode');
  const baseCursorHash = cursorHash(currentCursor);
  const nextCursor: ScanCursor = {
    schemaVersion: 1,
    purpose: 'local-jsonl-scan-position',
    files: { ...currentCursor.files },
  };

  for await (const filePath of walkJsonl(base)) {
    if (maxMessages > 0 && plain.length + im.length >= maxMessages) break;
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat || !fileStat.isFile()) continue;
    const key = fileKey(filePath);
    const pathHash = `sha256-${sha(filePath)}`;
    const cursorState = currentCursor.files[key];
    const startOffset = validCursorState(cursorState, fileStat) ? cursorState.offset : 0;
    const scanEndOffset = fileStat.size;
    if (startOffset >= scanEndOffset) {
      nextCursor.files[key] = {
        pathHash,
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        offset: scanEndOffset,
      };
      continue;
    }

    const projectPath = path.dirname(filePath);
    const projectRef = safeRef('project', projectPath);
    const sessionRef = safeRef('session', filePath);
    const conversationId = safeRef('conv', filePath);
    let startedAt: string | undefined;
    let consumedOffset = startOffset;
    const stream = createReadStream(filePath, {
      encoding: 'utf-8',
      start: startOffset,
      end: Math.max(startOffset, scanEndOffset - 1),
    });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const rawLine of rl) {
      if (maxMessages > 0 && plain.length + im.length >= maxMessages) break;
      consumedOffset += Buffer.byteLength(rawLine, 'utf-8') + 1;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(rawLine) as Record<string, unknown>;
      } catch {
        continue;
      }
      const msg = (obj.message && typeof obj.message === 'object' ? obj.message : obj) as Record<
        string,
        unknown
      >;
      const role = msg.role === 'user' || msg.role === 'assistant' ? msg.role : undefined;
      if (!role) continue;
      const content = textFromContent(msg.content ?? obj.content);
      if (!content) continue;
      const occurredAt =
        typeof obj.timestamp === 'string'
          ? obj.timestamp
          : typeof msg.timestamp === 'string'
            ? msg.timestamp
            : undefined;
      startedAt ||= occurredAt;
      const messageRefSource = String(
        obj.uuid ??
          msg.uuid ??
          obj.requestId ??
          `${filePath}:${occurredAt}:${role}:${content.slice(0, 80)}`
      );
      const messageRef = safeRef('msg', messageRefSource);
      const baseMessage: UploadMessage = {
        kind: 'conversation_message',
        eventId: safeRef('evt', messageRefSource),
        reportedAt,
        project: {
          projectRef,
          name: path.basename(projectPath),
          pathHash: `sha256-${sha(projectPath)}`,
        },
        conversation: { conversationId, sessionRef, claudeSessionRef: sessionRef, startedAt },
        message: {
          messageRef,
          parentRef: typeof obj.parentUuid === 'string' ? safeRef('msg', obj.parentUuid) : null,
          role,
          occurredAt,
          model: typeof msg.model === 'string' ? msg.model : undefined,
          content,
          contentFormat: 'text',
          usage: usageFromMessage(msg),
        },
      };
      const maybeIm =
        obj.im && typeof obj.im === 'object' ? (obj.im as Record<string, unknown>) : null;
      if (maybeIm) im.push({ ...baseMessage, kind: 'im_conversation_message', im: maybeIm });
      else plain.push(baseMessage);
    }
    const offset =
      maxMessages > 0 && plain.length + im.length >= maxMessages
        ? Math.min(consumedOffset, scanEndOffset)
        : scanEndOffset;
    nextCursor.files[key] = { pathHash, size: fileStat.size, mtimeMs: fileStat.mtimeMs, offset };
  }
  return { plain, im, baseCursorHash, nextCursor };
}

function codexHome(): string {
  return process.env.CODEX_HOME || path.join(process.env.HOME || '', '.codex');
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
  hermitHome: string,
  limit: number
): Promise<{
  plain: UploadMessage[];
  im: UploadMessage[];
  baseCursorHash: string;
  nextCursor: ScanCursor;
}> {
  const plain: UploadMessage[] = [];
  const im: UploadMessage[] = [];
  const reportedAt = new Date().toISOString();
  const maxMessages = Math.max(0, limit);
  const currentCursor = await readScanCursor(hermitHome, 'codex');
  const baseCursorHash = cursorHash(currentCursor);
  const nextCursor: ScanCursor = {
    schemaVersion: 1,
    purpose: 'local-jsonl-scan-position',
    files: { ...currentCursor.files },
  };
  const roots = [path.join(codexHome(), 'sessions'), path.join(codexHome(), 'archived_sessions')];

  for (const root of roots) {
    for await (const filePath of walkJsonl(root)) {
      if (maxMessages > 0 && plain.length >= maxMessages) break;
      const fileStat = await stat(filePath).catch(() => null);
      if (!fileStat || !fileStat.isFile()) continue;
      const key = fileKey(filePath);
      const pathHash = `sha256-${sha(filePath)}`;
      const cursorState = currentCursor.files[key];
      const startOffset = validCursorState(cursorState, fileStat) ? cursorState.offset : 0;
      const scanEndOffset = fileStat.size;
      if (startOffset >= scanEndOffset) {
        nextCursor.files[key] = {
          pathHash,
          size: fileStat.size,
          mtimeMs: fileStat.mtimeMs,
          offset: scanEndOffset,
        };
        continue;
      }

      const sessionRef = safeRef('codex-session', filePath);
      const conversationId = safeRef('codex-conv', filePath);
      let consumedOffset = startOffset;
      let startedAt: string | undefined;
      const stream = createReadStream(filePath, {
        encoding: 'utf-8',
        start: startOffset,
        end: Math.max(startOffset, scanEndOffset - 1),
      });
      const rl = createInterface({ input: stream, crlfDelay: Infinity });
      for await (const rawLine of rl) {
        if (maxMessages > 0 && plain.length >= maxMessages) break;
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
              : reportedAt;
        startedAt ||= occurredAt;
        const messageRefSource = String(
          obj.id ??
            obj.uuid ??
            record.id ??
            `${filePath}:${occurredAt}:${plain.length}:${usage.totalTokens}`
        );
        const projectName = typeof record.project === 'string' ? record.project : 'Codex';
        plain.push({
          kind: 'conversation_message',
          eventId: safeRef('codex-evt', messageRefSource),
          reportedAt,
          project: {
            projectRef: safeRef(
              'codex-project',
              String(record.cwd ?? record.project_path ?? filePath)
            ),
            name: projectName,
            pathHash: `sha256-${sha(String(record.cwd ?? filePath))}`,
          },
          conversation: { conversationId, sessionRef, startedAt },
          message: {
            messageRef: safeRef('codex-msg', messageRefSource),
            parentRef: null,
            role: 'assistant',
            occurredAt,
            model:
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
      const offset =
        maxMessages > 0 && plain.length >= maxMessages
          ? Math.min(consumedOffset, scanEndOffset)
          : scanEndOffset;
      nextCursor.files[key] = { pathHash, size: fileStat.size, mtimeMs: fileStat.mtimeMs, offset };
    }
    if (maxMessages > 0 && plain.length >= maxMessages) break;
  }
  return { plain, im, baseCursorHash, nextCursor };
}

function countsCoverAttempt(status: ConversationUploadStatus): boolean {
  return status.accepted + status.duplicated === status.attempted;
}

function countMismatchError(status: ConversationUploadStatus): string | null {
  if (
    status.accepted < 0 ||
    status.duplicated < 0 ||
    status.rejected < 0 ||
    (status.failed ?? 0) < 0
  )
    return '服务端返回负数计数，已保留本地待上报状态';
  if (status.accepted + status.duplicated > status.attempted)
    return '服务端确认数超过本批发送数，已保留本地待上报状态';
  if (status.rejected > status.attempted || (status.failed ?? 0) > status.attempted)
    return '服务端拒绝/失败数超过本批发送数，已保留本地待上报状态';
  if (!countsCoverAttempt(status))
    return '服务端最终处理计数未覆盖本批发送数，已保留本地待上报状态';
  return null;
}

function apiUrl(baseUrl: string, pathName: string): string {
  return `${baseUrl.replace(/\/$/, '')}${pathName}`;
}

function statusUrl(baseUrl: string, receipt: UploadReceipt): string | null {
  const url = receipt.statusUrl || receipt.detailUrl;
  if (!url)
    return receipt.uploadId
      ? `/api/v1/hermit/uploads/${encodeURIComponent(receipt.uploadId)}`
      : null;
  return url;
}

async function probeAuth(
  baseUrl: string,
  token: string,
  hermitHome: string
): Promise<string | null> {
  const res = await fetch(apiUrl(baseUrl, '/api/v1/auth/hermit/me'), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const status = typeof body.status === 'string' ? body.status : `HTTP ${res.status}`;
  await appendUploadLog(hermitHome, 'auth-me-checked', {
    ok: res.ok && body.authenticated !== false,
    status,
    feishuAuthorized: body.feishu_authorized,
    accessExpired: body.access_expired,
  });
  if (!res.ok || body.authenticated === false || status !== 'ok') return `授权不可用：${status}`;
  return null;
}

async function queryUploadResult(
  baseUrl: string,
  token: string,
  receipt: UploadReceipt
): Promise<UploadResult | null> {
  const url = statusUrl(baseUrl, receipt);
  if (!url) return null;
  const absoluteUrl =
    url.startsWith('http://') || url.startsWith('https://') ? url : apiUrl(baseUrl, url);
  const res = await fetch(absoluteUrl, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`upload status ${await responseDiagnostic(res)}`);
  const text = await res.text().catch(() => '');
  if (!text) return null;
  return parseJsonObject(text) as UploadResult;
}

async function postPayload(
  baseUrl: string,
  endpointPath: string,
  token: string,
  payload: UploadPayload
): Promise<ConversationUploadStatus> {
  const endpoint = apiUrl(baseUrl, endpointPath);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text().catch(() => '');
  const receipt = parseJsonObject(text) as UploadReceipt;
  if (!res.ok)
    throw new Error(
      await responseDiagnostic(
        new Response(text, { status: res.status, statusText: res.statusText })
      )
    );

  const received =
    typeof receipt.received === 'number' ? receipt.received : payload.messages.length;
  const receiveRejected =
    typeof receipt.rejectedAtReceive === 'number' ? receipt.rejectedAtReceive : 0;
  const queued =
    typeof receipt.acceptedForProcessing === 'number'
      ? receipt.acceptedForProcessing
      : Math.max(0, received - receiveRejected);
  const baseStatus: ConversationUploadStatus = {
    enabled: true,
    endpointConfigured: true,
    attempted: payload.messages.length,
    accepted: 0,
    duplicated: typeof receipt.duplicatedAtReceive === 'number' ? receipt.duplicatedAtReceive : 0,
    rejected: receiveRejected,
    queued,
    uploadIds: [receipt.uploadId || payload.uploadId],
    lastReceiptId: receipt.receiptId,
    lastStatusUrl: statusUrl(baseUrl, receipt) || undefined,
    lastUploadStatus: receipt.status,
    ...(receipt.ok === false || receipt.errors
      ? { lastError: '服务端接收阶段返回错误，已保留本地待上报状态' }
      : {}),
  };
  if (baseStatus.lastError || receiveRejected > 0)
    return { ...baseStatus, lastError: baseStatus.lastError || '部分消息在接收阶段被拒绝' };

  const result = await queryUploadResult(baseUrl, token, receipt);
  if (!result) return { ...baseStatus, lastError: '服务端未返回上报结果，已保留本地待上报状态' };

  const status: ConversationUploadStatus = {
    ...baseStatus,
    accepted: typeof result.accepted === 'number' ? result.accepted : 0,
    inserted: typeof result.inserted === 'number' ? result.inserted : undefined,
    duplicated: typeof result.duplicated === 'number' ? result.duplicated : baseStatus.duplicated,
    rejected: typeof result.rejected === 'number' ? result.rejected : baseStatus.rejected,
    failed: typeof result.failed === 'number' ? result.failed : 0,
    lastReceiptId: result.receiptId || baseStatus.lastReceiptId,
    lastUploadStatus: result.status || baseStatus.lastUploadStatus,
    lastError:
      result.errors && Array.isArray(result.errors) && result.errors.length > 0
        ? '服务端最终处理返回错误，已保留本地待上报状态'
        : undefined,
  };
  if (status.lastUploadStatus && !['success'].includes(status.lastUploadStatus)) {
    status.lastError = `服务端批次状态为 ${status.lastUploadStatus}，已保留本地待上报状态`;
  }
  if ((status.failed ?? 0) > 0) status.lastError = '部分消息处理失败，已保留本地待上报状态';
  if (status.rejected > 0) status.lastError = '部分消息被拒绝，已保留本地待上报状态';
  if (!status.lastError) {
    const mismatch = countMismatchError(status);
    if (mismatch) status.lastError = mismatch;
  }
  return status;
}

async function postMessagesInBatches(
  hermitHome: string,
  baseUrl: string,
  endpointPath: string,
  token: string,
  payloadBase: Omit<UploadPayload, 'uploadId' | 'messages'>,
  uploadIdPrefix: string,
  messages: UploadMessage[],
  batchSize: number,
  runTotalMessages: number,
  uploadedBeforeRun: number
): Promise<{ status: ConversationUploadStatus; uploadedMessages: UploadMessage[] }> {
  const statuses: ConversationUploadStatus[] = [];
  const uploadedMessages: UploadMessage[] = [];
  const size = Math.max(1, batchSize);
  const totalBatches = Math.ceil(messages.length / size);

  for (let offset = 0; offset < messages.length; offset += size) {
    const batchIndex = Math.floor(offset / size) + 1;
    const batchMessages = messages.slice(offset, offset + size);
    await appendUploadLog(hermitHome, 'upload-batch-start', {
      batchIndex,
      totalBatches,
      batchSize: batchMessages.length,
      attemptedBeforeBatch: offset,
      attemptedAfterBatch: Math.min(messages.length, offset + batchMessages.length),
      uploadedBeforeBatch: uploadedBeforeRun + uploadedMessages.length,
      totalMessages: runTotalMessages,
    });
    try {
      const status = await postPayload(baseUrl, endpointPath, token, {
        ...payloadBase,
        uploadId: `${uploadIdPrefix}-${String(batchIndex).padStart(4, '0')}-${randomUUID()}`,
        messages: batchMessages,
      });
      statuses.push(status);
      const serverConfirmed = shouldCountAsUploaded(status);
      if (serverConfirmed) {
        uploadedMessages.push(...batchMessages);
      }
      const serverCoveredCount = status.accepted + status.duplicated;
      await appendUploadLog(hermitHome, 'upload-batch-finished', {
        batchIndex,
        totalBatches,
        attempted: status.attempted,
        accepted: status.accepted,
        duplicated: status.duplicated,
        rejected: status.rejected,
        serverConfirmed,
        serverConfirmedCount: serverConfirmed ? batchMessages.length : 0,
        serverConfirmReason: serverConfirmed
          ? 'server-confirmed-full-batch'
          : `server-covered-${serverCoveredCount}-of-${status.attempted}`,
        attemptedAfterBatch: offset + status.attempted,
        uploadedAfterBatch: uploadedBeforeRun + uploadedMessages.length,
        totalMessages: runTotalMessages,
        lastError: status.lastError,
      });
    } catch (error) {
      const message = sanitizeUploadError(error);
      await appendUploadLog(hermitHome, 'upload-batch-failed', {
        batchIndex,
        totalBatches,
        batchSize: batchMessages.length,
        attemptedBeforeFailure: offset,
        attemptedAfterFailure: offset + batchMessages.length,
        uploadedBeforeFailure: uploadedBeforeRun + uploadedMessages.length,
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
      return { status: mergeStatuses(statuses), uploadedMessages };
    }
  }

  return { status: mergeStatuses(statuses), uploadedMessages };
}

function shouldCountAsUploaded(status: ConversationUploadStatus): boolean {
  if (status.attempted <= 0 || status.rejected > 0 || status.lastError) return false;
  return countsCoverAttempt(status);
}

function sanitizeUploadError(error: unknown): string {
  return sanitizeDiagnosticText(error instanceof Error ? error.message : String(error));
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

async function responseDiagnostic(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  if (!text) return `HTTP ${res.status}`;
  return `HTTP ${res.status}: ${sanitizeDiagnosticText(text)}`;
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
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

function resolveUploadProviders(telemetry: TaskBusConfig['telemetry']): UploadPlatform[] {
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

async function collectMessagesForPlatform(
  platform: UploadPlatform,
  hermitHome: string,
  limit: number
) {
  return platform === 'codex'
    ? collectCodexMessages(hermitHome, limit)
    : collectClaudeCodeMessages(hermitHome, limit);
}

async function uploadPlatformMessages(
  platform: UploadPlatform,
  cfg: TaskBusConfig,
  hermitHome: string,
  baseUrl: string,
  token: string,
  generatedAt: string
): Promise<ConversationUploadStatus & { scanCursorAdvanced?: boolean }> {
  const conversationCfg = cfg.telemetry?.conversations;
  const { plain, im, baseCursorHash, nextCursor } = await collectMessagesForPlatform(
    platform,
    hermitHome,
    conversationCfg?.batchSize ?? 0
  );
  const totalDiscovered = plain.length + im.length;
  const pending = totalDiscovered;
  const baseStatus = { totalDiscovered, skippedAlreadyUploaded: 0, pending };
  await appendUploadLog(hermitHome, 'scan-collected', {
    platform,
    ...baseStatus,
    pendingPlain: plain.length,
    pendingIm: im.length,
    skipSource: 'remote-authoritative-not-local-cursor',
  });

  if (!pending) {
    await appendUploadLog(hermitHome, 'no-incremental-messages', { platform, ...baseStatus });
    return emptyStatus(true, true, baseStatus);
  }

  const authError = await probeAuth(baseUrl, token, hermitHome);
  if (authError) {
    await appendUploadLog(hermitHome, 'auth-unavailable', {
      platform,
      ...baseStatus,
      lastError: authError,
    });
    return emptyStatus(true, Boolean(baseUrl), { ...baseStatus, lastError: authError });
  }

  const uploadBatchSize = Number(
    (conversationCfg as { uploadBatchSize?: number } | undefined)?.uploadBatchSize ??
      process.env.OPENHERMIT_CONVERSATION_UPLOAD_BATCH_SIZE ??
      500
  );
  const statuses: ConversationUploadStatus[] = [];
  const uploadedMessages: UploadMessage[] = [];
  const payloadBase = {
    schemaVersion: 1 as const,
    generatedAt,
    source: 'openhermit' as const,
    platform,
  };

  await appendUploadLog(hermitHome, 'upload-start', {
    platform,
    pendingPlain: plain.length,
    pendingIm: im.length,
    batchSize: uploadBatchSize,
    baseUrl,
  });
  if (plain.length) {
    const plainResult = await postMessagesInBatches(
      hermitHome,
      baseUrl,
      '/api/v1/hermit/conversation-messages',
      token,
      payloadBase,
      `upload-${platform}-${generatedAt.slice(0, 10).replace(/-/g, '')}`,
      plain,
      uploadBatchSize,
      pending,
      uploadedMessages.length
    );
    statuses.push(plainResult.status);
    uploadedMessages.push(...plainResult.uploadedMessages);
  }
  if (im.length) {
    const imResult = await postMessagesInBatches(
      hermitHome,
      baseUrl,
      '/api/v1/hermit/im-conversation-messages',
      token,
      payloadBase,
      `upload-${platform}-${generatedAt.slice(0, 10).replace(/-/g, '')}-im`,
      im,
      uploadBatchSize,
      pending,
      uploadedMessages.length
    );
    statuses.push(imResult.status);
    uploadedMessages.push(...imResult.uploadedMessages);
  }
  const result = {
    ...mergeStatuses(statuses),
    totalDiscovered,
    skippedAlreadyUploaded: 0,
    pending,
  };
  const fullyConfirmed =
    result.attempted > 0 &&
    result.rejected === 0 &&
    !result.lastError &&
    countsCoverAttempt(result);
  let scanCursorAdvanced = false;
  if (fullyConfirmed) {
    scanCursorAdvanced = await commitScanCursorIfUnchanged(
      hermitHome,
      platform,
      baseCursorHash,
      nextCursor
    );
    if (!scanCursorAdvanced) result.lastError = '本地扫描游标已被其他任务更新，本轮不推进游标';
  }
  await appendUploadLog(hermitHome, 'upload-finished', {
    platform,
    attempted: result.attempted,
    accepted: result.accepted,
    duplicated: result.duplicated,
    rejected: result.rejected,
    skippedAlreadyUploaded: 0,
    pending,
    serverConfirmed: fullyConfirmed,
    serverConfirmedCount: fullyConfirmed ? uploadedMessages.length : 0,
    scanCursorAdvanced,
  });
  return { ...result, scanCursorAdvanced };
}

async function uploadConversationMessagesLocked(
  cfg: TaskBusConfig
): Promise<ConversationUploadStatus> {
  const telemetry = cfg.telemetry;
  const conversationCfg = telemetry?.conversations;
  const enabled = Boolean(telemetry?.conversationUploadEnabled || conversationCfg?.uploadEnabled);
  const baseUrl = resolveConversationUploadBaseUrl();
  if (!enabled) return emptyStatus(false, Boolean(baseUrl));

  const hermitHome = process.env.HERMIT_HOME || path.join(process.env.HOME || '', '.hermit');
  const providers = resolveUploadProviders(telemetry);
  await appendUploadLog(hermitHome, 'scan-start', {
    endpointConfigured: Boolean(baseUrl),
    providers,
  });

  const token = await readBearerToken(hermitHome);
  if (!token) {
    await appendUploadLog(hermitHome, 'waiting-login', { providers });
    return emptyStatus(true, Boolean(baseUrl), { lastError: '等待登录' });
  }

  const generatedAt = new Date().toISOString();
  const statuses: ConversationUploadStatus[] = [];
  for (const platform of providers) {
    statuses.push(
      await uploadPlatformMessages(platform, cfg, hermitHome, baseUrl, token, generatedAt)
    );
  }
  return mergeStatuses(statuses);
}

export async function uploadConversationMessages(
  cfg: TaskBusConfig
): Promise<ConversationUploadStatus> {
  const telemetry = cfg.telemetry;
  const conversationCfg = telemetry?.conversations;
  const enabled = Boolean(telemetry?.conversationUploadEnabled || conversationCfg?.uploadEnabled);
  const baseUrl = resolveConversationUploadBaseUrl();
  if (!enabled) return emptyStatus(false, Boolean(baseUrl));
  const hermitHome = process.env.HERMIT_HOME || path.join(process.env.HOME || '', '.hermit');
  const result = await withUploadLock(hermitHome, () => uploadConversationMessagesLocked(cfg));
  return (
    result ??
    emptyStatus(true, Boolean(baseUrl), { lastError: '已有消息上报任务正在运行，本轮已跳过' })
  );
}
