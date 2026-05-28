/**
 * Hermit standalone server (cc-connect sidecar mode).
 *
 * 这是 hermit 的"正式"后端入口(取代 bin/hermit-mvp/server.mjs)。
 *
 * 职责:
 *   1. 团队管理(/api/teams /api/teams/:slug/messages /api/teams/:slug/tasks ...)
 *   2. 群聊 SSE(/api/teams/:slug/group-send,通过 cc-connect Bridge WS 转发)
 *   3. cc-connect 原子能力 proxy(/api/cc/* → cc-connect:9820/api/v1/*)
 *   4. 静态资源托管(serve src/renderer 的 vite build 产物)
 *
 * 启动:
 *   pnpm dev:server         # 仅后端
 *   pnpm dev                # 后端 + vite dev(前端 5174,代理 /api 到 5680)
 *
 * 环境变量:
 *   HOST                       默认 127.0.0.1
 *   PORT                       默认 5680
 *   HERMIT_HOME                默认 ~/.hermit
 *   CC_CONNECT_BASE_URL        默认 http://127.0.0.1:9820
 *   CC_CONNECT_TOKEN           cc-connect Management API token(必填)
 *   CC_CONNECT_BRIDGE_URL      默认 ws://127.0.0.1:9810/bridge/ws
 *   CC_CONNECT_BRIDGE_TOKEN    cc-connect Bridge token(必填)
 *   STATIC_DIR                 静态资源目录,默认 dist-renderer/(若不存在,/ 返回 503 提示)
 */

import {
  existsSync as _existsSync2,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import Fastify from 'fastify';

import {
  CROSS_TEAM_SENT_SOURCE,
  CROSS_TEAM_SOURCE,
  formatCrossTeamText,
} from '@shared/constants/crossTeam';
import { CcConnectBridge } from './services/ccConnect/CcConnectBridge';
import { CcConnectClient } from './services/ccConnect/CcConnectClient';
import { TeamProvisioningService } from './services/teams-mvp';
import { TaskDispatchService } from './services/teams-mvp/TaskDispatchService';
import { CollaborationBoardService } from './services/teams-mvp/CollaborationBoardService';
import type { TaskBusConfig, TeamLaunchRequest } from '@shared/types/team';
import type { TeamManifest } from './services/teams-mvp/TeamWorkspaceService';
import { UpdateService } from './services/UpdateService';
import {
  startTelemetry,
  stopTelemetry,
  triggerScan,
  getTelemetryStatus,
} from './services/session-intelligence/UsageTelemetryService';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(__dirname, '../../package.json'), 'utf-8'));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number.parseInt(process.env.PORT ?? '5680', 10);
const STATIC_DIR = process.env.STATIC_DIR ?? path.resolve(REPO_ROOT, 'dist-renderer');
const HARNESS_BRIDGE_CONNECT_TIMEOUT_MS = 10_000;

// ===========================================================================
// Hermit runtime config — ~/.hermit/config.json
// Priority: file > env vars > defaults
// ===========================================================================

const HERMIT_HOME = process.env.HERMIT_HOME ?? path.join(os.homedir(), '.hermit');
const HERMIT_CONFIG_FILE = path.join(HERMIT_HOME, 'config.json');
const HERMIT_APP_CONFIG_FILE = path.join(HERMIT_HOME, 'app-config.json');
const HERMIT_CC_CONNECT_CONFIG_FILE = path.join(HERMIT_HOME, 'cc-connect', 'config.toml');
const HERMIT_SETTINGS_FILE = path.join(HERMIT_HOME, 'settings.json');

interface HermitConfig {
  ccBaseUrl: string;
  ccToken: string;
  ccBridgeUrl: string;
  ccBridgeToken: string;
}

function ensureWritableCcConnectConfigFile(): string {
  if (_existsSync2(HERMIT_CC_CONNECT_CONFIG_FILE)) {
    return HERMIT_CC_CONNECT_CONFIG_FILE;
  }
  throw new Error('cc-connect 配置文件不存在: ~/.hermit/cc-connect/config.toml');
}

function readCcConnectConfigTomlRaw(): { path: string; content: string } {
  if (!_existsSync2(HERMIT_CC_CONNECT_CONFIG_FILE)) {
    throw new Error('cc-connect 配置文件不存在: ~/.hermit/cc-connect/config.toml');
  }
  return {
    path: HERMIT_CC_CONNECT_CONFIG_FILE,
    content: readFileSync(HERMIT_CC_CONNECT_CONFIG_FILE, 'utf-8'),
  };
}

function readCcConnectTomlToken(section: 'bridge' | 'management'): string {
  try {
    if (!_existsSync2(HERMIT_CC_CONNECT_CONFIG_FILE)) {
      return '';
    }
    const raw = readFileSync(HERMIT_CC_CONNECT_CONFIG_FILE, 'utf-8');
    const match = raw.match(new RegExp(`\\[${section}\\][^\\[]*token\\s*=\\s*"([^"]+)"`, 's'));
    return match?.[1]?.trim() ?? '';
  } catch {
    return '';
  }
}

function loadConfig(): HermitConfig {
  const tomlManagementToken = readCcConnectTomlToken('management');
  const tomlBridgeToken = readCcConnectTomlToken('bridge');
  const defaults: HermitConfig = {
    ccBaseUrl: process.env.CC_CONNECT_BASE_URL ?? 'http://127.0.0.1:9820',
    ccToken:
      process.env.CC_CONNECT_TOKEN ||
      process.env.CC_CONNECT_MANAGEMENT_TOKEN ||
      tomlManagementToken,
    ccBridgeUrl: process.env.CC_CONNECT_BRIDGE_URL ?? 'ws://127.0.0.1:9810/bridge/ws',
    ccBridgeToken:
      process.env.CC_CONNECT_BRIDGE_TOKEN ||
      tomlBridgeToken ||
      process.env.CC_CONNECT_TOKEN ||
      process.env.CC_CONNECT_MANAGEMENT_TOKEN ||
      tomlManagementToken,
  };
  let merged = { ...defaults };
  try {
    if (_existsSync2(HERMIT_CONFIG_FILE)) {
      const raw = JSON.parse(readFileSync(HERMIT_CONFIG_FILE, 'utf-8')) as Partial<HermitConfig>;
      merged = { ...defaults, ...raw };
    }
  } catch {
    /* ignore parse errors */
  }
  if (!merged.ccBridgeToken.trim()) {
    merged = { ...merged, ccBridgeToken: tomlBridgeToken || merged.ccToken };
  }
  return merged;
}

function saveConfig(patch: Partial<HermitConfig>): HermitConfig {
  const current = loadConfig();
  const next = { ...current, ...patch };
  mkdirSync(HERMIT_HOME, { recursive: true });
  writeFileSync(HERMIT_CONFIG_FILE, JSON.stringify(next, null, 2), 'utf-8');
  return next;
}

function readHermitConfigRaw(): { path: string; content: string } {
  if (_existsSync2(HERMIT_CONFIG_FILE)) {
    return {
      path: HERMIT_CONFIG_FILE,
      content: readFileSync(HERMIT_CONFIG_FILE, 'utf-8'),
    };
  }
  return {
    path: HERMIT_CONFIG_FILE,
    content: `${JSON.stringify(loadConfig(), null, 2)}\n`,
  };
}

function writeHermitConfigRaw(content: string): HermitConfig {
  const parsed = JSON.parse(content) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Hermit 配置必须是 JSON 对象');
  }
  mkdirSync(HERMIT_HOME, { recursive: true });
  const normalized = content.endsWith('\n') ? content : `${content}\n`;
  writeFileSync(HERMIT_CONFIG_FILE, normalized, 'utf-8');
  return loadConfig();
}

// Mutable runtime config — updated via /api/hermit-config POST
let runtimeConfig = loadConfig();

const cc = new CcConnectClient({
  baseUrl: runtimeConfig.ccBaseUrl,
  token: runtimeConfig.ccToken,
  bridgeUrl: runtimeConfig.ccBridgeUrl,
});
const bridge = new CcConnectBridge({
  bridgeUrl: runtimeConfig.ccBridgeUrl,
  bridgeToken: runtimeConfig.ccBridgeToken || runtimeConfig.ccToken,
});
const svc = new TeamProvisioningService(cc, bridge);
const collabBoard = new CollaborationBoardService();
const taskDispatch = new TaskDispatchService(svc['workspace'], collabBoard);

// Broadcast collab board changes via SSE
taskDispatch.onCollabChange = (dispatchId, status, fromTeam, toTeam) => {
  broadcastSse('collab-change', { dispatchId, status, fromTeam, toTeam });
};

async function readSavedTaskBusConfig(): Promise<TaskBusConfig | null> {
  try {
    const raw = await fs.readFile(HERMIT_SETTINGS_FILE, 'utf-8');
    const settings = JSON.parse(raw) as { taskBus?: TaskBusConfig };
    return settings.taskBus ?? null;
  } catch {
    return null;
  }
}

async function initializeTaskBusFromSettings(): Promise<void> {
  const config = await readSavedTaskBusConfig();
  if (!config) return;

  if (config.telemetry?.enabled) {
    await startTelemetry(config).catch((err) => {
      app.log.warn({ err }, 'telemetry startup failed');
    });
  }

  if (!config.enabled) {
    taskDispatch.dispose();
    return;
  }

  taskDispatch.dispose();
  try {
    await taskDispatch.start(config);
  } catch (err) {
    app.log.warn({ err }, 'Redis connection failed on startup — task bus disabled');
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
}

async function resolveTeamSlugForMention(rawName: string): Promise<string | null> {
  const normalized = rawName.trim().replace(/^@/, '');
  if (!normalized) return null;
  try {
    await svc.readTeamManifest(normalized);
    return normalized;
  } catch {
    // Try display name / case-insensitive slug match.
  }
  const lower = normalized.toLowerCase();
  const teams = await svc.listTeams().catch(() => []);
  const matched = teams.find((team) => {
    const slug = team.slug.toLowerCase();
    const displayName = (team.displayName ?? '').toLowerCase();
    return slug === lower || displayName === lower;
  });
  return matched?.slug ?? null;
}

function normalizePlatformAllowFrom(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .map(
      ([platform, allowFrom]) =>
        [platform.trim(), typeof allowFrom === 'string' ? allowFrom.trim() : ''] as const
    )
    .filter(([platform, allowFrom]) => platform.length > 0 && allowFrom.length > 0);
  return Object.fromEntries(entries);
}

// ===========================================================================
// SSE 客户端管理器 — 广播 bridge 事件到所有连接的前端客户端
// ===========================================================================

type SseClient = { res: import('node:http').ServerResponse; id: string };
const sseClients = new Set<SseClient>();

function broadcastSse(eventName: string, data: unknown): void {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.res.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

// 启动 bridge 并把事件广播到 SSE 客户端
bridge.start();

bridge.on('reply', (msg) => {
  const sessionKey: string = (msg as { session_key?: string }).session_key ?? '';
  const teamName = resolveTeamFromSessionKey(sessionKey) ?? sessionKey;

  void (async () => {
    // 先落盘再广播，否则前端可能在 appendFile 完成前刷新到旧 feed。
    await svc.appendMessage(teamName, {
      from: teamName,
      to: 'user',
      role: 'agent',
      content: (msg as { content?: string }).content ?? '',
      meta: { sessionKey },
    });
    broadcastSse('team-change', { type: 'inbox', teamName });
  })().catch((err) => {
    app.log.warn({ err, teamName, sessionKey }, 'bridge reply persistence failed');
  });
});

bridge.on('reply_stream', (msg) => {
  const sessionKey: string = (msg as { session_key?: string }).session_key ?? '';
  const teamName = resolveTeamFromSessionKey(sessionKey) ?? sessionKey;
  const done = (msg as { done?: boolean }).done ?? false;

  if (done) {
    // 流式结束，存储完整回复
    const fullText = (msg as { full_text?: string }).full_text ?? '';
    void (async () => {
      if (fullText) {
        await svc.appendMessage(teamName, {
          from: teamName,
          to: 'user',
          role: 'agent',
          content: fullText,
          meta: { sessionKey },
        });
      }
      broadcastSse('team-change', { type: 'inbox', teamName });
    })().catch((err) => {
      app.log.warn({ err, teamName, sessionKey }, 'bridge stream reply persistence failed');
    });
  } else {
    broadcastSse('team-change', { type: 'lead-message', teamName });
  }
});

bridge.on('message', (msg) => {
  const type = (msg as { type?: string }).type ?? '';
  const sessionKey: string = (msg as { session_key?: string }).session_key ?? '';
  if (!sessionKey) return; // 无 session_key 的控制帧（pong 等）不广播
  const teamName = resolveTeamFromSessionKey(sessionKey);
  if (!teamName) return;
  // typing_start/stop → lead-message；其他 → inbox
  const eventType = type === 'typing_start' || type === 'typing_stop' ? 'lead-message' : 'inbox';
  broadcastSse('team-change', { type: eventType, teamName });
});

/**
 * 从 session_key 解析 teamName。
 * 约定格式:
 *   hermit:{teamName}:session  (老格式)
 *   hermit:{teamName}:lead     (新格式)
 *   bridge:hermit-{team}:{member}
 *   {teamName}                 (直接就是 teamName)
 */
function resolveTeamFromSessionKey(sessionKey: string): string | null {
  if (!sessionKey) return null;
  // hermit:{teamName}:xxx
  const hermitMatch = sessionKey.match(/^hermit:([^:]+):/);
  if (hermitMatch) return hermitMatch[1];
  // bridge:hermit-{team}:{member}
  const bridgeMatch = sessionKey.match(/^bridge:hermit-([^:]+):/);
  if (bridgeMatch) return bridgeMatch[1];
  // 否则当成 teamName 本身
  return sessionKey;
}

const app = Fastify({
  logger: { level: process.env.HERMIT_LOG_LEVEL ?? 'warn' },
  disableRequestLogging: true,
});

// ===========================================================================
// Plugins
// ===========================================================================

await app.register(cors, {
  origin: process.env.CORS_ORIGIN?.split(',') ?? true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
});

// ===========================================================================
// /api/cc/*  →  cc-connect /api/v1/*  (proxy with token)
// /api/v1/*  →  cc-connect /api/v1/*  (兼容旧 renderer 直接打 /api/v1 的代码)
// ===========================================================================

async function proxyToCcConnect(
  request: import('fastify').FastifyRequest,
  reply: import('fastify').FastifyReply,
  stripPrefix: string
) {
  const baseUrl = runtimeConfig.ccBaseUrl.replace(/\/+$/, '');
  const token = runtimeConfig.ccToken;

  const url = request.url;
  const subPath = url.replace(new RegExp(`^${stripPrefix}`), '') || '/';
  const target = `${baseUrl}/api/v1${subPath}`;

  const headers: Record<string, string> = {
    'Content-Type': (request.headers['content-type'] as string) ?? 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const init: RequestInit = { method: request.method, headers };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body == null ? undefined : JSON.stringify(request.body);
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (err) {
    request.log.warn({ target, err }, 'cc-connect proxy network error');
    return reply.code(502).send({
      ok: false,
      error: `cc-connect 不可达: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const body = Buffer.from(await upstream.arrayBuffer());
  return reply
    .code(upstream.status)
    .header(
      'Content-Type',
      upstream.headers.get('content-type') ?? 'application/json; charset=utf-8'
    )
    .send(body);
}

app.all('/api/cc/*', async (request, reply) => proxyToCcConnect(request, reply, '/api/cc'));
app.all('/api/v1/*', async (request, reply) => proxyToCcConnect(request, reply, '/api/v1'));

// ===========================================================================
// Hermit config (read/write ~/.hermit/config.json)
// ===========================================================================

app.get('/api/hermit-config', async () => ({
  ok: true,
  data: {
    ccBaseUrl: runtimeConfig.ccBaseUrl,
    // mask token: show only first 4 chars if present
    ccToken: runtimeConfig.ccToken ? runtimeConfig.ccToken.slice(0, 4) + '****' : '',
    ccTokenSet: runtimeConfig.ccToken.length > 0,
    ccBridgeUrl: runtimeConfig.ccBridgeUrl,
  },
}));

app.post<{
  Body: { ccBaseUrl?: string; ccToken?: string; ccBridgeUrl?: string };
}>('/api/hermit-config', async (request, reply) => {
  const { ccBaseUrl, ccToken, ccBridgeUrl } = request.body ?? {};
  const patch: Partial<HermitConfig> = {};
  if (ccBaseUrl !== undefined) patch.ccBaseUrl = ccBaseUrl.trim() || 'http://127.0.0.1:9820';
  if (ccToken !== undefined) patch.ccToken = ccToken.trim();
  if (ccBridgeUrl !== undefined)
    patch.ccBridgeUrl = ccBridgeUrl.trim() || 'ws://127.0.0.1:9810/bridge/ws';

  runtimeConfig = saveConfig(patch);
  // Hot-update the cc client so subsequent requests use new config immediately
  cc.updateConfig({ baseUrl: runtimeConfig.ccBaseUrl, token: runtimeConfig.ccToken });
  bridge.updateConfig({
    bridgeUrl: runtimeConfig.ccBridgeUrl,
    bridgeToken: runtimeConfig.ccBridgeToken || runtimeConfig.ccToken,
  });

  return {
    ok: true,
    data: { ccBaseUrl: runtimeConfig.ccBaseUrl, ccTokenSet: runtimeConfig.ccToken.length > 0 },
  };
});

app.get('/api/hermit-config/raw', async () => {
  try {
    const data = readHermitConfigRaw();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

app.post<{ Body: { content?: unknown } }>('/api/hermit-config/raw', async (request) => {
  try {
    const content = request.body?.content;
    if (typeof content !== 'string') {
      return { ok: false, error: 'content 必须是字符串' };
    }
    runtimeConfig = writeHermitConfigRaw(content);
    cc.updateConfig({ baseUrl: runtimeConfig.ccBaseUrl, token: runtimeConfig.ccToken });
    bridge.updateConfig({
      bridgeUrl: runtimeConfig.ccBridgeUrl,
      bridgeToken: runtimeConfig.ccBridgeToken || runtimeConfig.ccToken,
    });
    return {
      ok: true,
      data: {
        ccBaseUrl: runtimeConfig.ccBaseUrl,
        ccTokenSet: runtimeConfig.ccToken.length > 0,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

// ===========================================================================
// cc-connect config (Hermit-managed: ~/.hermit/cc-connect/config.toml)
// ===========================================================================

function readCcConnectConfigRaw(): { path: string; content: string } {
  return readCcConnectConfigTomlRaw();
}

/** Simple TOML parser for cc-connect config (handles only the fields we need). */
function readCcConnectConfig(): Record<string, unknown> {
  const { content: raw } = readCcConnectConfigTomlRaw();

  const result: Record<string, unknown> = {};

  // Top-level simple fields
  const dataDirMatch = raw.match(/^data_dir\s*=\s*"([^"]*)"/m);
  if (dataDirMatch) result.data_dir = dataDirMatch[1];

  const languageMatch = raw.match(/^language\s*=\s*"([^"]*)"/m);
  if (languageMatch) result.language = languageMatch[1];

  const idleTimeoutMatch = raw.match(/^idle_timeout_mins\s*=\s*(\d+)/m);
  if (idleTimeoutMatch) result.idle_timeout_mins = Number(idleTimeoutMatch[1]);

  // [management] section
  const mgmtSection = raw.match(/\[management\]([^\[]*)/s);
  if (mgmtSection) {
    const section = mgmtSection[1];
    const enabledMatch = section.match(/enabled\s*=\s*(true|false)/);
    if (enabledMatch) result.management_enabled = enabledMatch[1] === 'true';
    const portMatch = section.match(/port\s*=\s*(\d+)/);
    if (portMatch) result.management_port = Number(portMatch[1]);
    const tokenMatch = section.match(/token\s*=\s*"([^"]*)"/);
    if (tokenMatch) result.management_token = tokenMatch[1];
  }

  // [bridge] section
  const bridgeSection = raw.match(/\[bridge\]([^\[]*)/s);
  if (bridgeSection) {
    const section = bridgeSection[1];
    const enabledMatch = section.match(/enabled\s*=\s*(true|false)/);
    if (enabledMatch) result.bridge_enabled = enabledMatch[1] === 'true';
    const portMatch = section.match(/port\s*=\s*(\d+)/);
    if (portMatch) result.bridge_port = Number(portMatch[1]);
    const tokenMatch = section.match(/token\s*=\s*"([^"]*)"/);
    if (tokenMatch) result.bridge_token = tokenMatch[1];
  }

  // [log] section
  const logSection = raw.match(/\[log\]([^\[]*)/s);
  if (logSection) {
    const levelMatch = logSection[1].match(/level\s*=\s*"([^"]*)"/);
    if (levelMatch) result.log_level = levelMatch[1];
  }

  // [display] section
  const displaySection = raw.match(/\[display\]([^\[]*)/s);
  if (displaySection) {
    const section = displaySection[1];
    const thinkingMatch = section.match(/thinking_messages\s*=\s*(true|false)/);
    if (thinkingMatch) result.display_thinking = thinkingMatch[1] === 'true';
    const toolMatch = section.match(/tool_messages\s*=\s*(true|false)/);
    if (toolMatch) result.display_tool = toolMatch[1] === 'true';
  }

  return result;
}

function writeCcConnectConfig(updates: Record<string, unknown>): void {
  const configFile = ensureWritableCcConnectConfigFile();
  let raw = readFileSync(configFile, 'utf-8');

  // Update top-level fields
  if (updates.language !== undefined) {
    raw = raw.replace(/^(language\s*=\s*)"[^"]*"/m, `$1"${updates.language}"`);
  }
  if (updates.idle_timeout_mins !== undefined) {
    raw = raw.replace(/^(idle_timeout_mins\s*=\s*)\d+/m, `$1${updates.idle_timeout_mins}`);
  }

  // Update [management] section
  if (updates.management_enabled !== undefined) {
    const val = updates.management_enabled ? 'true' : 'false';
    raw = raw.replace(
      /(\[management\][^\n]*\n(?:[^\[]*)?)(enabled\s*=\s*)(true|false)/s,
      (match, prefix, key) => `${prefix}${key}${val}`
    );
  }
  if (updates.management_port !== undefined) {
    raw = raw.replace(
      /(\[management\][^\n]*\n(?:[^\[]*)?)(port\s*=\s*)\d+/s,
      `$1$2${updates.management_port}`
    );
  }
  if (updates.management_token !== undefined) {
    raw = raw.replace(
      /(\[management\][^\n]*\n(?:[^\[]*)?)(token\s*=\s*)"[^"]*"/s,
      `$1$2"${updates.management_token}"`
    );
  }

  // Update [bridge] section
  if (updates.bridge_enabled !== undefined) {
    const val = updates.bridge_enabled ? 'true' : 'false';
    raw = raw.replace(/(\[bridge\][^\n]*\n(?:[^\[]*)?)(enabled\s*=\s*)(true|false)/s, `$1$2${val}`);
  }
  if (updates.bridge_port !== undefined) {
    raw = raw.replace(
      /(\[bridge\][^\n]*\n(?:[^\[]*)?)(port\s*=\s*)\d+/s,
      `$1$2${updates.bridge_port}`
    );
  }
  if (updates.bridge_token !== undefined) {
    raw = raw.replace(
      /(\[bridge\][^\n]*\n(?:[^\[]*)?)(token\s*=\s*)"[^"]*"/s,
      `$1$2"${updates.bridge_token}"`
    );
  }

  // Update [log] section
  if (updates.log_level !== undefined) {
    raw = raw.replace(
      /(\[log\][^\n]*\n(?:[^\[]*)?)(level\s*=\s*)"[^"]*"/s,
      `$1$2"${updates.log_level}"`
    );
  }

  // Update [display] section
  if (updates.display_thinking !== undefined) {
    const val = updates.display_thinking ? 'true' : 'false';
    raw = raw.replace(
      /(\[display\][^\n]*\n(?:[^\[]*)?)(thinking_messages\s*=\s*)(true|false)/s,
      `$1$2${val}`
    );
  }
  if (updates.display_tool !== undefined) {
    const val = updates.display_tool ? 'true' : 'false';
    raw = raw.replace(
      /(\[display\][^\n]*\n(?:[^\[]*)?)(tool_messages\s*=\s*)(true|false)/s,
      `$1$2${val}`
    );
  }

  writeFileSync(configFile, raw, 'utf-8');
}

function writeCcConnectConfigRaw(content: string): void {
  const configFile = ensureWritableCcConnectConfigFile();
  writeFileSync(configFile, content, 'utf-8');
}

app.get('/api/cc-config', async () => {
  try {
    const config = readCcConnectConfig();
    return { ok: true, data: config };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

app.post<{ Body: Record<string, unknown> }>('/api/cc-config', async (request, reply) => {
  try {
    const updates = request.body ?? {};
    writeCcConnectConfig(updates);

    // If management port/token changed, notify user to restart cc-connect
    const needsRestart =
      'management_port' in updates ||
      'management_token' in updates ||
      'bridge_port' in updates ||
      'bridge_token' in updates;

    return {
      ok: true,
      data: { needsRestart },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

app.get('/api/cc-config/raw', async () => {
  try {
    const data = readCcConnectConfigRaw();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

app.post<{ Body: { content?: unknown } }>('/api/cc-config/raw', async (request) => {
  try {
    const content = request.body?.content;
    if (typeof content !== 'string') {
      return { ok: false, error: 'content 必须是字符串' };
    }
    writeCcConnectConfigRaw(content);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

// ===========================================================================
// Health / cc-connect status (alias)
// ===========================================================================

app.get('/api/status', async () => {
  try {
    const data = await cc.getStatus();
    return { ok: true, data };
  } catch (err) {
    return reply500(err);
  }
});

// ===========================================================================
// cc-connect global settings proxy
// ===========================================================================

app.get('/api/cc-settings', async () => {
  try {
    const data = await cc.getGlobalSettings();
    return { ok: true, data };
  } catch (err) {
    return reply500(err);
  }
});

app.patch<{ Body: Record<string, unknown> }>('/api/cc-settings', async (request) => {
  try {
    const data = await cc.patchGlobalSettings(request.body ?? {});
    return { ok: true, data };
  } catch (err) {
    return reply500(err);
  }
});

// restart / reload cc-connect
app.post('/api/cc-restart', async () => {
  try {
    await cc.restart();
    // Wait for cc-connect to come back (restart only signals, process respawns async)
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        await cc.listProjects();
        return { ok: true };
      } catch {
        /* not back yet */
      }
    }
    return reply500(new Error('cc-connect did not come back within 30s'));
  } catch (err) {
    return reply500(err);
  }
});

app.post('/api/cc-reload', async () => {
  try {
    await cc.reload();
    return { ok: true };
  } catch (err) {
    return reply500(err);
  }
});

// ===========================================================================
// Teams — cc-connect projects 即团队，本地 ~/.hermit/teams/ 仅存 tasks + 额外元数据
// ===========================================================================

// GET /api/teams → 从 cc-connect 读取 project 列表，合并本地元数据（displayName 等）
app.get('/api/teams', async () => {
  try {
    const projects = await cc.listProjects();
    const summaries = await Promise.all(
      projects.map(async (p) => {
        // platforms 从 listProjects 返回的是 string[]，有 platform 即认为在线
        const isOnline = Array.isArray(p.platforms) && p.platforms.length > 0;

        // 尝试从本地元数据读取 displayName 等信息
        let displayName = p.name;
        let color = 'blue';
        let description = `${p.agent_type} · ${p.platforms?.join(', ') ?? ''}`;
        let workDir = '';
        let pendingDelete = false;
        let restartRequired = false;
        try {
          const meta = await svc.readTeamManifest(p.name);
          if (meta.displayName) displayName = meta.displayName;
          if (meta.color) color = meta.color;
          if (meta.description) description = meta.description;
          pendingDelete = meta.pendingDelete === true;
          restartRequired = meta.restartRequired === true;
          if (typeof meta.workDir === 'string') {
            workDir = meta.workDir.trim();
          }
        } catch {
          /* no local manifest, use defaults */
        }

        // 兼容仅存在于 cc-connect 的团队：回退读取 project 详情拿 work_dir。
        if (!workDir) {
          try {
            const detail = await cc.getProject(p.name);
            if (typeof detail.work_dir === 'string') {
              workDir = detail.work_dir.trim();
            }
          } catch {
            // ignore detail read failure, keep empty path
          }
        }

        return {
          teamName: p.name,
          displayName,
          description,
          color,
          memberCount: 1,
          members: [{ name: p.name, role: 'agent', agentId: p.agent_type, color }],
          taskCount: 0,
          lastActivity: null,
          isAlive: isOnline,
          harness: p.agent_type,
          bindProject: p.name,
          workDir,
          projectPath: workDir || undefined,
          sessionsCount: p.sessions_count,
          heartbeatEnabled: p.heartbeat_enabled,
          pendingDelete,
          restartRequired,
        };
      })
    );
    return summaries.filter(
      (team) => team.pendingDelete !== true && team.teamName !== 'my-project'
    );
  } catch {
    return [];
  }
});

// POST /api/teams/create → 直接在 cc-connect 创建 project
app.post('/api/teams/create', async (request, reply) => {
  try {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const name = String(body.teamName ?? body.displayName ?? '').trim();
    const displayName = String(body.displayName ?? body.teamName ?? '').trim() || name;
    const harness = String(body.harness ?? 'claudecode');
    let workDir = String(body.workDir ?? body.cwd ?? '');

    if (!name) return reply.code(400).send({ error: 'name required' });
    if (!workDir) return reply.code(400).send({ error: 'workDir required' });

    // Normalize path: fullwidth tilde → regular tilde, expand ~ to home
    workDir = workDir.replace(/\uff5e/g, '~');
    if (workDir.startsWith('~')) {
      workDir = path.join(os.homedir(), workDir.slice(1));
    }

    // 直接调用 cc-connect add-platform（project 自动创建）
    const platformType = (body.platform as string) ?? 'feishu';
    const result = await cc.createProject(name, harness, workDir, platformType, {});
    try {
      await svc.createTeam({
        displayName,
        bindProject: name,
        harness,
        workDir,
        color: typeof body.color === 'string' ? body.color : undefined,
        description: typeof body.description === 'string' ? body.description : undefined,
        platform: platformType,
        createCcProject: false,
      });
    } catch (err) {
      request.log.warn({ err, teamName: name }, 'failed to persist local team metadata');
    }

    // Bind provider refs if specified
    const providerRefs = Array.isArray(body.providerRefs) ? (body.providerRefs as string[]) : [];
    if (providerRefs.length > 0) {
      try {
        await cc.setProviderRefs(name, providerRefs);
      } catch (err) {
        request.log.warn({ err, teamName: name, providerRefs }, 'failed to set provider refs');
      }
    }

    return { ok: true, teamName: name, runId: null };
  } catch (err) {
    return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
  }
});

// GET /api/teams/:name/data → TeamViewSnapshot (cc-connect project 为主，本地 tasks 为辅)
app.get<{ Params: { name: string } }>('/api/teams/:name/data', async (request, reply) => {
  const { name } = request.params;

  // 本地元数据（始终尝试读取）
  let displayName = name; // 默认使用 team ID
  let color = 'blue';
  let description = '';
  let collaboration = true;
  let workDir = '';
  let harness = 'claudecode';
  let language = '';
  let permissionMode = 'default';
  let showContextIndicator = false;
  let replyFooter = false;
  let injectSender = false;
  let managedSources = '*';
  let disabledCommands: string[] = [];
  let platformAllowFrom: Record<string, string> = {};
  try {
    const meta = await svc.readTeamManifest(name);
    if (meta.displayName) displayName = meta.displayName;
    if (meta.color) color = meta.color;
    if (meta.description) description = meta.description;
    collaboration = meta.collaboration ?? true;
    if (meta.workDir) workDir = meta.workDir;
    if (meta.harness) harness = meta.harness;
    if (meta.language) language = meta.language;
    if (meta.permissionMode) permissionMode = meta.permissionMode;
    if (typeof meta.showContextIndicator === 'boolean') {
      showContextIndicator = meta.showContextIndicator;
    }
    if (typeof meta.replyFooter === 'boolean') {
      replyFooter = meta.replyFooter;
    }
    if (typeof meta.injectSender === 'boolean') {
      injectSender = meta.injectSender;
    }
    if (meta.managedSources) managedSources = meta.managedSources;
    if (Array.isArray(meta.disabledCommands)) {
      disabledCommands = normalizeStringArray(meta.disabledCommands);
    }
    if (meta.platformAllowFrom) {
      platformAllowFrom = normalizePlatformAllowFrom(meta.platformAllowFrom);
    }
  } catch {
    /* no local manifest */
  }

  // 本地任务
  const rawTasks = activeTasks(await svc.readTasks(name).catch(() => []));
  const teamTasks = rawTasks.map(toTeamTask);

  try {
    const p = await cc.getProject(name);
    const isOnline = Array.isArray(p.platforms) && p.platforms.some((pl) => pl.connected);
    const projectSettings = (p.settings ?? {}) as Record<string, unknown>;
    const resolvedLanguage =
      typeof projectSettings.language === 'string' && projectSettings.language.trim().length > 0
        ? projectSettings.language.trim()
        : language;
    const resolvedManagedSources =
      typeof projectSettings.admin_from === 'string' && projectSettings.admin_from.trim().length > 0
        ? projectSettings.admin_from.trim()
        : managedSources;
    const resolvedDisabledCommands =
      Array.isArray(projectSettings.disabled_commands) &&
      normalizeStringArray(projectSettings.disabled_commands).length > 0
        ? normalizeStringArray(projectSettings.disabled_commands)
        : disabledCommands;
    const resolvedShowContextIndicator =
      typeof projectSettings.show_context_indicator === 'boolean'
        ? projectSettings.show_context_indicator
        : showContextIndicator;
    const resolvedReplyFooter =
      typeof projectSettings.reply_footer === 'boolean'
        ? projectSettings.reply_footer
        : replyFooter;
    const resolvedInjectSender =
      typeof projectSettings.inject_sender === 'boolean'
        ? projectSettings.inject_sender
        : injectSender;
    const resolvedPlatformAllowFrom = (() => {
      const normalized = normalizePlatformAllowFrom(projectSettings.platform_allow_from);
      if (Object.keys(normalized).length > 0) {
        return normalized;
      }
      return platformAllowFrom;
    })();
    const resolvedPermissionMode =
      typeof p.agent_mode === 'string' && p.agent_mode.trim().length > 0
        ? p.agent_mode.trim()
        : permissionMode;
    const [providerRefs, globalProviders] = await Promise.all([
      cc.getProviderRefs(name).catch(() => []),
      cc.listProviders().catch(() => []),
    ]);

    return {
      teamName: name,
      config: {
        name: displayName, // 使用 displayName 作为展示名称
        color,
        description,
        language: resolvedLanguage,
        agentType: p.agent_type,
        permissionMode: resolvedPermissionMode,
        showContextIndicator: resolvedShowContextIndicator,
        replyFooter: resolvedReplyFooter,
        injectSender: resolvedInjectSender,
        managedSources: resolvedManagedSources,
        disabledCommands: resolvedDisabledCommands,
        platformAllowFrom: resolvedPlatformAllowFrom,
        projectPath: p.work_dir ?? workDir,
        members: [{ name: displayName, role: 'lead' }],
      },
      tasks: teamTasks,
      members: [
        {
          name: displayName,
          agentId: p.agent_type,
          agentType: p.agent_type,
          role: 'lead',
          color,
          currentTaskId: null,
          taskCount: teamTasks.length,
        },
      ],
      kanbanState: { teamName: name, reviewers: [], tasks: {} },
      processes: [],
      isAlive: isOnline,
      harness: p.agent_type,
      bindProject: name,
      collaboration,
      description,
      workDir: p.work_dir ?? workDir,
      permissionMode: resolvedPermissionMode,
      providerRefs,
      globalProviders,
      settings: {
        ...projectSettings,
        language: resolvedLanguage,
        admin_from: resolvedManagedSources,
        disabled_commands: resolvedDisabledCommands,
        show_context_indicator: resolvedShowContextIndicator,
        reply_footer: resolvedReplyFooter,
        inject_sender: resolvedInjectSender,
        platform_allow_from: resolvedPlatformAllowFrom,
      },
      heartbeat: p.heartbeat,
      activeSessions: p.active_session_keys ?? [],
    };
  } catch {
    // Project deleted from cc-connect (e.g., after stop) — return offline team data from local metadata
    return {
      teamName: name,
      config: {
        name: displayName, // 使用 displayName 作为展示名称
        color,
        description,
        language,
        agentType: harness,
        permissionMode,
        showContextIndicator,
        replyFooter,
        injectSender,
        managedSources,
        disabledCommands,
        platformAllowFrom,
        projectPath: workDir,
        members: [{ name: displayName, role: 'lead' }],
      },
      tasks: teamTasks,
      members: [
        {
          name: displayName,
          agentId: harness,
          agentType: harness,
          role: 'lead',
          color,
          currentTaskId: null,
          taskCount: teamTasks.length,
        },
      ],
      kanbanState: { teamName: name, reviewers: [], tasks: {} },
      processes: [],
      isAlive: false,
      harness,
      bindProject: name,
      collaboration,
      description,
      workDir,
      permissionMode,
      providerRefs: [],
      globalProviders: [],
      heartbeat: null,
      settings: {
        language,
        admin_from: managedSources,
        disabled_commands: disabledCommands,
        show_context_indicator: showContextIndicator,
        reply_footer: replyFooter,
        inject_sender: injectSender,
        platform_allow_from: platformAllowFrom,
      },
      activeSessions: [],
    };
  }
});

// PATCH /api/teams/:name — 更新团队元数据
app.patch<{
  Params: { name: string };
  Body: { displayName?: string; color?: string; description?: string };
}>('/api/teams/:name', async (request, reply) => {
  try {
    const updated = await svc.updateTeam(request.params.name, request.body ?? {});
    return { ok: true, data: updated };
  } catch (err) {
    return reply.code(404).send(reply500(err));
  }
});

// DELETE /api/teams/:name
app.delete<{ Params: { name: string }; Querystring: { deleteFiles?: string } }>(
  '/api/teams/:name',
  async (request, reply) => {
    const teamName = request.params.name;
    if (teamName === 'default' || teamName === 'my-project') {
      return reply.code(403).send({ error: '该团队不可删除' });
    }
    try {
      let restartRequired = false;
      try {
        const result = await cc.deleteProject(teamName);
        restartRequired = result.restart_required === true;
      } catch (err) {
        request.log.warn({ err, teamName }, 'delete cc-connect project failed or project missing');
      }

      try {
        await svc.deleteTeam(teamName, { deleteFiles: request.query.deleteFiles === 'true' });
      } catch (err) {
        request.log.warn({ err, teamName }, 'delete local team metadata failed or already missing');
      }

      return { ok: true, restartRequired };
    } catch (err) {
      return reply.code(500).send(reply500(err));
    }
  }
);

// ===========================================================================
// Tasks — 存储在 ~/.hermit/teams/:name/tasks/board.json
// 双向映射：TeamTask(pending/in_progress/completed) ↔ Task(todo/doing/done)
// assignee 变化时触发 Task Dispatcher（Bridge 推消息给目标团队 agent）
// ===========================================================================

/** TeamTask status → internal Task status */
function toTaskStatus(s: string): 'todo' | 'doing' | 'done' {
  if (s === 'in_progress') return 'doing';
  if (s === 'completed') return 'done';
  return 'todo';
}

/** internal Task → TeamTask shape (for UI consumption) */
function toTeamTask(task: {
  id: string;
  title?: string;
  subject?: string;
  description?: string;
  status: string;
  assignee?: string | null;
  result?: string | null;
  createdAt: string;
  updatedAt: string;
  order: number;
  teamSlug: string;
  dispatchMeta?: import('@shared/types/team').DispatchMeta;
}) {
  const statusMap: Record<string, string> = {
    todo: 'pending',
    doing: 'in_progress',
    done: 'completed',
  };
  return {
    id: task.id,
    displayId: task.id.slice(0, 8),
    subject: task.title ?? task.subject ?? '',
    description: task.description ?? '',
    status: statusMap[task.status] ?? 'pending',
    owner: task.assignee ?? undefined,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    result: task.result ?? undefined,
    dispatchMeta: task.dispatchMeta,
  };
}

function isSoftDeletedTask(task: { result?: string | null }): boolean {
  return task.result === '__deleted__';
}

function activeTasks<T extends { result?: string | null }>(tasks: T[]): T[] {
  return tasks.filter((task) => !isSoftDeletedTask(task));
}

function mapCcSessionDetail(detail: {
  id: string;
  name: string;
  session_key: string;
  agent_session_id?: string;
  agent_type: string;
  active: boolean;
  live: boolean;
  history_count: number;
  created_at: string;
  updated_at: string;
  platform: string;
  history: { role: 'user' | 'assistant'; content: string; timestamp: string }[];
}) {
  return {
    id: detail.id,
    name: detail.name,
    sessionKey: detail.session_key,
    agentSessionId: detail.agent_session_id,
    agentType: detail.agent_type,
    active: detail.active,
    live: detail.live,
    historyCount: detail.history_count,
    createdAt: detail.created_at,
    updatedAt: detail.updated_at,
    platform: detail.platform,
    history: detail.history ?? [],
  };
}

app.get<{ Params: { name: string } }>('/api/teams/:name/tasks', async (request) => {
  try {
    const tasks = activeTasks(await svc.readTasks(request.params.name));
    return tasks.map(toTeamTask);
  } catch {
    return [];
  }
});

app.post<{ Params: { name: string }; Body: Record<string, unknown> }>(
  '/api/teams/:name/tasks',
  async (request, reply) => {
    const body = request.body ?? {};
    // 支持 subject（TeamTask）或 title（内部）
    const title = (body.subject ?? body.title) as string | undefined;
    if (!title) return reply.code(400).send({ error: 'title/subject required' });
    const task = await svc.createTask(request.params.name, {
      title,
      description: body.description as string | undefined,
      assignee: (body.owner ?? body.assignee) as string | null | undefined,
      status: body.status ? toTaskStatus(body.status as string) : 'todo',
    });
    if (task.assignee) {
      svc
        .dispatchTask(request.params.name, task)
        .catch((err) => request.log.warn({ err }, 'dispatchTask failed'));
    }
    return toTeamTask(task);
  }
);

app.patch<{ Params: { name: string; id: string }; Body: Record<string, unknown> }>(
  '/api/teams/:name/tasks/:id',
  async (request) => {
    const body = request.body ?? {};
    const patch: Record<string, unknown> = {};
    if (body.subject !== undefined) patch.title = body.subject;
    if (body.title !== undefined) patch.title = body.title;
    if (body.description !== undefined) patch.description = body.description;
    if (body.status !== undefined) patch.status = toTaskStatus(body.status as string);
    if (body.owner !== undefined) patch.assignee = body.owner;
    if (body.assignee !== undefined) patch.assignee = body.assignee;
    if (body.result !== undefined) patch.result = body.result;
    const task = await svc.patchTask(request.params.name, request.params.id, patch);
    if (patch.assignee && task.assignee) {
      svc
        .dispatchTask(request.params.name, task)
        .catch((err) => request.log.warn({ err }, 'dispatchTask failed'));
    }
    return toTeamTask(task);
  }
);

app.delete<{ Params: { name: string; id: string } }>(
  '/api/teams/:name/tasks/:id',
  async (request, reply) => {
    try {
      await svc.patchTask(request.params.name, request.params.id, {
        status: 'done',
        result: '__deleted__',
      });
      return { ok: true };
    } catch {
      return reply.code(404).send({ error: 'not found' });
    }
  }
);

// ===========================================================================
// 协同开关 — PATCH /api/teams/:name/collaboration
// ===========================================================================

app.patch<{ Params: { name: string }; Body: { collaboration: boolean } }>(
  '/api/teams/:name/collaboration',
  async (request, reply) => {
    const { collaboration } = request.body ?? {};
    if (typeof collaboration !== 'boolean') {
      return reply.code(400).send({ error: 'collaboration must be boolean' });
    }
    try {
      const updated = await svc.updateTeam(request.params.name, { collaboration });
      return { ok: true, data: { collaboration: updated.collaboration } };
    } catch (err) {
      return reply.code(404).send(reply500(err));
    }
  }
);

// ===========================================================================
// 定时任务 — 透传 cc-connect heartbeat API
// GET    /api/teams/:name/heartbeat
// POST   /api/teams/:name/heartbeat/enable
// POST   /api/teams/:name/heartbeat/disable
// POST   /api/teams/:name/heartbeat/pause
// POST   /api/teams/:name/heartbeat/resume
// PATCH  /api/teams/:name/heartbeat  { interval_mins, only_when_idle, silent }
// ===========================================================================

app.get<{ Params: { name: string } }>('/api/teams/:name/heartbeat', async (request, reply) => {
  try {
    const data = await cc.getHeartbeat(request.params.name);
    return { ok: true, data };
  } catch (err) {
    return reply.code(404).send(reply500(err));
  }
});

app.post<{ Params: { name: string } }>(
  '/api/teams/:name/heartbeat/enable',
  async (request, reply) => {
    try {
      await cc.resumeHeartbeat(request.params.name);
      return { ok: true };
    } catch (err) {
      return reply.code(500).send(reply500(err));
    }
  }
);

app.post<{ Params: { name: string } }>(
  '/api/teams/:name/heartbeat/disable',
  async (request, reply) => {
    try {
      await cc.pauseHeartbeat(request.params.name);
      return { ok: true };
    } catch (err) {
      return reply.code(500).send(reply500(err));
    }
  }
);

app.post<{ Params: { name: string } }>(
  '/api/teams/:name/heartbeat/pause',
  async (request, reply) => {
    try {
      await cc.pauseHeartbeat(request.params.name);
      return { ok: true };
    } catch (err) {
      return reply.code(500).send(reply500(err));
    }
  }
);

app.post<{ Params: { name: string } }>(
  '/api/teams/:name/heartbeat/resume',
  async (request, reply) => {
    try {
      await cc.resumeHeartbeat(request.params.name);
      return { ok: true };
    } catch (err) {
      return reply.code(500).send(reply500(err));
    }
  }
);

app.patch<{
  Params: { name: string };
  Body: { interval_mins?: number; only_when_idle?: boolean; silent?: boolean };
}>('/api/teams/:name/heartbeat', async (request, reply) => {
  try {
    await cc.updateProject(request.params.name, request.body as Record<string, unknown>);
    const data = await cc.getHeartbeat(request.params.name);
    return { ok: true, data };
  } catch (err) {
    return reply.code(500).send(reply500(err));
  }
});

// ===========================================================================
// Harness 列表 — 从 cc-connect projects 提取已用 agent_type，合并固定枚举
// GET /api/harnesses
// ===========================================================================

const CC_AGENT_TYPES = [
  'claudecode',
  'codex',
  'cursor',
  'gemini',
  'iflow',
  'kimi',
  'devin',
  'opencode',
  'qoder',
  'pi',
  'acp',
  'tmux',
] as const;

app.get('/api/harnesses', async () => {
  try {
    const projects = await cc.listProjects();
    const usedTypes = new Set(projects.map((p) => p.agent_type));
    return CC_AGENT_TYPES.map((type) => ({
      type,
      inUse: usedTypes.has(type),
    }));
  } catch {
    // cc-connect 不可达时返回完整枚举列表
    return CC_AGENT_TYPES.map((type) => ({ type, inUse: false }));
  }
});

// ===========================================================================
// 团队启动 — 直接通过 cc-connect 激活 project/runtime
// POST /api/teams/:name/launch  → 补建 project（如缺失）并 restart cc-connect
// POST /api/teams/:name/stop    → 无需操作（cc-connect 自管理），返回 ok
// ===========================================================================

app.post<{ Params: { name: string }; Body: Partial<TeamLaunchRequest> }>(
  '/api/teams/:name/launch',
  async (request, reply) => {
    try {
      const name = request.params.name;
      const body = request.body ?? {};
      let manifest: TeamManifest | null = null;
      try {
        manifest = await svc.readTeamManifest(name);
      } catch {
        // Team may only exist in cc-connect.
      }
      const bindProject = manifest?.bindProject ?? name;
      const workDir = body.cwd ?? manifest?.workDir ?? '';
      const harness = manifest?.harness ?? 'claudecode';
      const platformType = manifest?.platform ?? 'bridge';
      const platformOptions = manifest?.platformOptions ?? {};
      let isOnline = false;
      let projectExists = false;
      try {
        const p = await cc.getProject(bindProject);
        projectExists = true;
        isOnline = Array.isArray(p.platforms) && p.platforms.some((pl) => pl.connected);
      } catch {
        /* project 不存在 */
      }

      if (!isOnline) {
        if (!projectExists) {
          if (!workDir) {
            return reply.code(400).send({ error: '团队缺少项目路径，无法启动 cc-connect project' });
          }
          const result = await cc.createProject(
            bindProject,
            harness,
            workDir,
            platformType,
            platformOptions as Record<string, string>
          );
          if (result.restart_required) {
            await cc.restart();
          }
          projectExists = true;
        } else {
          await cc.restart();
        }
      }

      return {
        runId: `cc-connect:${bindProject}:${Date.now()}`,
        ok: true,
        data: { teamName: name, bindProject, projectExists, isOnline: true },
      };
    } catch (err) {
      return reply.code(404).send(reply500(err));
    }
  }
);

app.post<{ Params: { name: string } }>('/api/teams/:name/stop', async (request) => {
  const name = request.params.name;
  // Stop = delete project from cc-connect (this is the only way to stop agents)
  await cc.stopProject(name);
  // Keep local team metadata intact by not deleting it
  // The team will show as offline (isAlive: false) on next data fetch
  return { ok: true };
});

// ===========================================================================
// cc-connect setup proxy — QR code & platform binding flows
// These endpoints proxy to cc-connect /api/v1/setup/* APIs
// ===========================================================================

// Feishu/Lark setup
app.post('/api/setup/feishu/begin', async (request, reply) => {
  try {
    const result = await (
      await fetch(`${runtimeConfig.ccBaseUrl}/api/v1/setup/feishu/begin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(runtimeConfig.ccToken ? { Authorization: `Bearer ${runtimeConfig.ccToken}` } : {}),
        },
        body: JSON.stringify(request.body ?? {}),
      })
    ).json();
    return result;
  } catch (err) {
    return reply500(err);
  }
});

app.post('/api/setup/feishu/poll', async (request, reply) => {
  try {
    const result = await (
      await fetch(`${runtimeConfig.ccBaseUrl}/api/v1/setup/feishu/poll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(runtimeConfig.ccToken ? { Authorization: `Bearer ${runtimeConfig.ccToken}` } : {}),
        },
        body: JSON.stringify(request.body ?? {}),
      })
    ).json();
    return result;
  } catch (err) {
    return reply500(err);
  }
});

app.post('/api/setup/feishu/save', async (request, reply) => {
  try {
    const result = await (
      await fetch(`${runtimeConfig.ccBaseUrl}/api/v1/setup/feishu/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(runtimeConfig.ccToken ? { Authorization: `Bearer ${runtimeConfig.ccToken}` } : {}),
        },
        body: JSON.stringify(request.body ?? {}),
      })
    ).json();
    return result;
  } catch (err) {
    return reply500(err);
  }
});

// Weixin setup
app.post('/api/setup/weixin/begin', async (request, reply) => {
  try {
    const result = await (
      await fetch(`${runtimeConfig.ccBaseUrl}/api/v1/setup/weixin/begin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(runtimeConfig.ccToken ? { Authorization: `Bearer ${runtimeConfig.ccToken}` } : {}),
        },
        body: JSON.stringify(request.body ?? {}),
      })
    ).json();
    return result;
  } catch (err) {
    return reply500(err);
  }
});

app.post('/api/setup/weixin/poll', async (request, reply) => {
  try {
    const result = await (
      await fetch(`${runtimeConfig.ccBaseUrl}/api/v1/setup/weixin/poll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(runtimeConfig.ccToken ? { Authorization: `Bearer ${runtimeConfig.ccToken}` } : {}),
        },
        body: JSON.stringify(request.body ?? {}),
      })
    ).json();
    return result;
  } catch (err) {
    return reply500(err);
  }
});

app.post('/api/setup/weixin/save', async (request, reply) => {
  try {
    const result = await (
      await fetch(`${runtimeConfig.ccBaseUrl}/api/v1/setup/weixin/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(runtimeConfig.ccToken ? { Authorization: `Bearer ${runtimeConfig.ccToken}` } : {}),
        },
        body: JSON.stringify(request.body ?? {}),
      })
    ).json();
    return result;
  } catch (err) {
    return reply500(err);
  }
});

// Generic platform add (manual credential form)
app.post<{
  Params: { name: string };
  Body: { type: string; options?: Record<string, unknown>; work_dir?: string; agent_type?: string };
}>('/api/projects/:name/add-platform', async (request, reply) => {
  try {
    const result = await cc.createProject(
      request.params.name,
      request.body.agent_type ?? 'claudecode',
      request.body.work_dir ?? '',
      request.body.type,
      (request.body.options ?? {}) as Record<string, string>
    );
    return result;
  } catch (err) {
    return reply500(err);
  }
});

// ===========================================================================
// 组织图 API — GET /api/graph
// 返回 nodes（团队）+ edges（任务 assignee 关系）供前端 Graph 渲染
// ===========================================================================

app.get('/api/graph', async () => {
  try {
    const projects = await cc.listProjects();
    const nodes = projects.map((p) => ({
      id: p.name,
      label: p.name,
      harness: p.agent_type,
      color: 'blue',
      collaboration: true,
      bindProject: p.name,
    }));

    const edges: { source: string; target: string; taskId: string; taskTitle: string }[] = [];
    for (const p of projects) {
      try {
        const tasks = await svc.readTasks(p.name);
        for (const task of tasks) {
          if (task.assignee && task.status !== 'done') {
            edges.push({
              source: p.name,
              target: task.assignee,
              taskId: task.id,
              taskTitle: task.title,
            });
          }
        }
      } catch {
        /* skip */
      }
    }

    return { ok: true, data: { nodes, edges } };
  } catch (err) {
    return reply500(err);
  }
});

// ===========================================================================
// MCP Server — hermit-tasks (MCP over HTTP: SSE + JSON-RPC)
//
// Claude Code / Qoder 等 agent 通过 MCP 协议读取和更新任务。
// MCP 配置在创建团队时自动注入到 workDir/.claude/settings.json。
//
// Tools:
//   list_tasks(team_slug)
//   claim_task(team_slug, task_id)
//   complete_task(team_slug, task_id, result?)
//   create_task(team_slug, title, description?, assignee?)
// ===========================================================================

const MCP_TOOLS = [
  {
    name: 'list_tasks',
    description: '列出指定团队的任务看板',
    inputSchema: {
      type: 'object',
      properties: {
        team_slug: { type: 'string', description: '团队 slug' },
      },
      required: ['team_slug'],
    },
  },
  {
    name: 'claim_task',
    description: '认领任务（状态改为 doing）',
    inputSchema: {
      type: 'object',
      properties: {
        team_slug: { type: 'string', description: '团队 slug' },
        task_id: { type: 'string', description: '任务 ID' },
      },
      required: ['team_slug', 'task_id'],
    },
  },
  {
    name: 'complete_task',
    description: '标记任务完成（状态改为 done），可写入结果摘要',
    inputSchema: {
      type: 'object',
      properties: {
        team_slug: { type: 'string', description: '团队 slug' },
        task_id: { type: 'string', description: '任务 ID' },
        result: { type: 'string', description: '完成结果摘要（可选）' },
      },
      required: ['team_slug', 'task_id'],
    },
  },
  {
    name: 'list_teams',
    description:
      '只读：列出所有可用团队（本地和远程）及能力信息。跨团队派发由 Hermit 平台根据用户 @团队 自动处理，agent 不应自行派发。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'accept_task',
    description: '接受来自另一个团队的任务请求。在本地创建任务并通知发起方。',
    inputSchema: {
      type: 'object',
      properties: {
        team_slug: { type: 'string', description: '你的团队 slug（接收方）' },
        dispatch_id: { type: 'string', description: '任务派发 ID' },
      },
      required: ['team_slug', 'dispatch_id'],
    },
  },
  {
    name: 'reject_task',
    description: '拒绝来自另一个团队的任务请求。通知发起方并附原因。',
    inputSchema: {
      type: 'object',
      properties: {
        team_slug: { type: 'string', description: '你的团队 slug（接收方）' },
        dispatch_id: { type: 'string', description: '任务派发 ID' },
        reason: { type: 'string', description: '拒绝原因（可选）' },
      },
      required: ['team_slug', 'dispatch_id'],
    },
  },
  {
    name: 'list_pending_requests',
    description: '列出当前团队待处理的任务请求（尚未接受或拒绝的）。',
    inputSchema: {
      type: 'object',
      properties: {
        team_slug: { type: 'string', description: '团队 slug' },
      },
      required: ['team_slug'],
    },
  },
  {
    name: 'deliver_task',
    description: '交付任务结果。完成任务后调用此工具，将结果发送给发起方审核。',
    inputSchema: {
      type: 'object',
      properties: {
        team_slug: { type: 'string', description: '你的团队 slug（接收方/执行方）' },
        dispatch_id: { type: 'string', description: '任务派发 ID' },
        result: { type: 'string', description: '交付结果描述' },
      },
      required: ['team_slug', 'dispatch_id', 'result'],
    },
  },
  {
    name: 'approve_task',
    description: '审核通过任务交付。发起方对交付结果满意时调用。',
    inputSchema: {
      type: 'object',
      properties: {
        team_slug: { type: 'string', description: '你的团队 slug（发起方/审核方）' },
        dispatch_id: { type: 'string', description: '任务派发 ID' },
      },
      required: ['team_slug', 'dispatch_id'],
    },
  },
  {
    name: 'reject_result',
    description: '退回任务交付结果，要求修改。附上反馈意见。超过 3 次退回需要人工介入。',
    inputSchema: {
      type: 'object',
      properties: {
        team_slug: { type: 'string', description: '你的团队 slug（发起方/审核方）' },
        dispatch_id: { type: 'string', description: '任务派发 ID' },
        feedback: { type: 'string', description: '退回反馈（需要修改的内容）' },
      },
      required: ['team_slug', 'dispatch_id', 'feedback'],
    },
  },
];

/** 执行 MCP tool，返回 content array */
async function executeMcpTool(
  toolName: string,
  args: Record<string, string>
): Promise<{ type: string; text: string }[]> {
  const text = async (result: unknown) => [{ type: 'text', text: JSON.stringify(result, null, 2) }];

  if (toolName === 'list_tasks') {
    const tasks = await svc.readTasks(args.team_slug);
    return text(tasks);
  }

  if (toolName === 'claim_task') {
    const task = await svc.patchTask(args.team_slug, args.task_id, { status: 'doing' });
    return text(task);
  }

  if (toolName === 'complete_task') {
    const patch: Record<string, unknown> = { status: 'done' };
    if (args.result) patch.result = args.result;
    const task = await svc.patchTask(args.team_slug, args.task_id, patch);
    // Notify origin team if this was a dispatched task
    await taskDispatch.onTaskCompleted(args.team_slug, args.task_id).catch(() => {});
    return text(task);
  }

  if (toolName === 'list_teams') {
    const teams = await taskDispatch.discoverTeams();
    return text(teams);
  }

  if (toolName === 'accept_task') {
    const result = await taskDispatch.acceptTask(args.team_slug, args.dispatch_id);
    return text(result);
  }

  if (toolName === 'reject_task') {
    await taskDispatch.rejectTask(args.team_slug, args.dispatch_id, args.reason);
    return text({ ok: true, message: 'Task rejected' });
  }

  if (toolName === 'list_pending_requests') {
    const requests = taskDispatch.listPendingRequests(args.team_slug);
    return text(requests);
  }

  if (toolName === 'deliver_task') {
    const result = await taskDispatch.deliverTask(args.team_slug, args.dispatch_id, args.result);
    return text(result);
  }

  if (toolName === 'approve_task') {
    const result = await taskDispatch.approveTask(args.team_slug, args.dispatch_id);
    return text(result);
  }

  if (toolName === 'reject_result') {
    const result = await taskDispatch.rejectResult(args.team_slug, args.dispatch_id, args.feedback);
    return text(result);
  }

  throw new Error(`Unknown tool: ${toolName}`);
}

// GET /mcp — SSE 端点（MCP over HTTP-SSE transport）
app.get('/mcp', (request, reply) => {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // MCP initialize 握手
  const endpoint = `http://${request.hostname}/mcp`;
  reply.raw.write(`event: endpoint\ndata: ${JSON.stringify({ endpoint })}\n\n`);

  const ka = setInterval(() => {
    try {
      reply.raw.write(': keep-alive\n\n');
    } catch {
      clearInterval(ka);
    }
  }, 15000);

  request.raw.on('close', () => clearInterval(ka));
  return reply.hijack();
});

// POST /mcp — JSON-RPC 请求处理
app.post<{
  Body: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
}>('/mcp', async (request, reply) => {
  const { id, method, params = {} } = request.body ?? {};

  // MCP initialize
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'hermit-tasks', version: '1.0.0' },
      },
    };
  }

  // MCP tools/list
  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } };
  }

  // MCP tools/call
  if (method === 'tools/call') {
    const toolName = params.name as string;
    const toolArgs = (params.arguments ?? {}) as Record<string, string>;
    try {
      const content = await executeMcpTool(toolName, toolArgs);
      return { jsonrpc: '2.0', id, result: { content } };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            { type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` },
          ],
          isError: true,
        },
      };
    }
  }

  // notifications/initialized — 无需响应
  if (method === 'notifications/initialized') {
    return reply.code(204).send();
  }

  return reply
    .code(400)
    .send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
});

// ===========================================================================
// Hermit 主仓 UI 首屏强依赖的几个 stub(占位实现)
// ===========================================================================

// hermit getAppVersion 期望返回字符串(不是数组),通配 stub 给的 [] 会让 JSON.parse 后类型对不上
app.get('/api/version', async () => pkg.version);

// GET /api/update/check — 检查是否有新版本
const updateService = new UpdateService();
app.get('/api/update/check', async () => updateService.checkForUpdates());

// POST /api/update/apply — 应用更新（SSE 推送进度）
app.post('/api/update/apply', async (request, reply) => {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const send = (data: unknown) => {
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await updateService.applyUpdate((progress) => {
      send(progress);
      if (progress.phase === 'completed' || progress.phase === 'error') {
        reply.raw.end();
      }
    });
  } catch (err: unknown) {
    send({
      phase: 'error',
      message: 'Update failed',
      error: err instanceof Error ? err.message : String(err),
    });
    reply.raw.end();
  }
});

// 主仓有"recent projects"概念,mvp 不实现,返回空
app.get('/api/dashboard/recent-projects', async () => ({
  recentProjects: [],
  pinnedSessions: [],
}));

app.get('/api/projects', async () => []);
app.get('/api/repository-groups', async () => []);

app.get('/api/notifications/unread-count', async () => ({ count: 0 }));
app.get('/api/notifications', async () => []);

// CLI installer / runtime / context 相关查询(主仓启动时会调,mvp 没这些概念)
app.get('/api/cli/status', async () => ({
  installed: true,
  version: 'cc-connect',
  path: null,
}));
app.get('/api/contexts', async () => []);
app.get('/api/contexts/active', async () => null);

const DEFAULT_APP_CONFIG = {
  notifications: {
    enabled: true,
    soundEnabled: true,
    ignoredRegex: [] as string[],
    ignoredRepositories: [] as string[],
    snoozedUntil: null as number | null,
    snoozeMinutes: 30,
    includeSubagentErrors: false,
    notifyOnLeadInbox: false,
    notifyOnUserInbox: true,
    notifyOnClarifications: true,
    notifyOnStatusChange: true,
    notifyOnTaskComments: true,
    notifyOnTaskCreated: true,
    notifyOnAllTasksCompleted: true,
    notifyOnCrossTeamMessage: true,
    notifyOnTeamLaunched: true,
    notifyOnToolApproval: true,
    autoResumeOnRateLimit: false,
    statusChangeOnlySolo: false,
    statusChangeStatuses: ['in_progress', 'completed'] as string[],
    triggers: [] as unknown[],
  },
  general: {
    launchAtLogin: false,
    showDockIcon: true,
    theme: 'dark' as 'dark' | 'light' | 'system',
    defaultTab: 'dashboard' as 'dashboard' | 'last-session',
    multimodelEnabled: false,
    claudeRootPath: null as string | null,
    agentLanguage: 'system',
    autoExpandAIGroups: false,
    useNativeTitleBar: false,
    telemetryEnabled: true,
  },
  providerConnections: {
    anthropic: {
      authMode: 'auto' as 'auto' | 'oauth' | 'api_key',
      fastModeDefault: false,
    },
    codex: {
      preferredAuthMode: 'auto' as 'auto' | 'chatgpt' | 'api_key',
    },
  },
  runtime: {
    providerBackends: {
      gemini: 'auto' as 'auto' | 'api' | 'cli-sdk',
      codex: 'codex-native' as 'codex-native',
    },
  },
  display: {
    showTimestamps: true,
    compactMode: false,
    syntaxHighlighting: true,
  },
  sessions: {
    pinnedSessions: {} as Record<string, { sessionId: string; pinnedAt: number }[]>,
    hiddenSessions: {} as Record<string, { sessionId: string; hiddenAt: number }[]>,
  },
  claudeEnv: {} as Record<string, string>,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeConfigDefaults<T extends Record<string, unknown>>(defaults: T, value: unknown): T {
  if (!isPlainObject(value)) {
    return defaults;
  }
  const output: Record<string, unknown> = { ...defaults };
  for (const [key, entry] of Object.entries(value)) {
    const defaultEntry = output[key];
    output[key] = isPlainObject(defaultEntry) ? mergeConfigDefaults(defaultEntry, entry) : entry;
  }
  return output as T;
}

function readAppConfig() {
  try {
    if (_existsSync2(HERMIT_APP_CONFIG_FILE)) {
      const raw = JSON.parse(readFileSync(HERMIT_APP_CONFIG_FILE, 'utf-8')) as unknown;
      return mergeConfigDefaults(DEFAULT_APP_CONFIG, raw);
    }
  } catch (err) {
    app.log.warn({ err }, 'failed to read app config, using defaults');
  }
  return DEFAULT_APP_CONFIG;
}

function writeAppConfig(config: typeof DEFAULT_APP_CONFIG): typeof DEFAULT_APP_CONFIG {
  mkdirSync(HERMIT_HOME, { recursive: true });
  writeFileSync(HERMIT_APP_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  return config;
}

app.get('/api/config', async () => ({
  success: true,
  data: readAppConfig(),
}));

app.post<{ Body: { section?: unknown; data?: unknown } }>('/api/config/update', async (request) => {
  const section = typeof request.body?.section === 'string' ? request.body.section : '';
  const patch = isPlainObject(request.body?.data) ? request.body.data : {};
  const current = readAppConfig();
  const next = section
    ? mergeConfigDefaults(current, {
        [section]: {
          ...(isPlainObject((current as Record<string, unknown>)[section])
            ? ((current as Record<string, unknown>)[section] as Record<string, unknown>)
            : {}),
          ...patch,
        },
      })
    : current;
  return {
    success: true,
    data: writeAppConfig(next),
  };
});

app.get('/api/config/triggers', async () => []);

const CRON_ZERO_TIME_PREFIX = '0001-01-01T00:00:00';
const DEFAULT_SCHEDULE_TIMEZONE =
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
const DEFAULT_SCHEDULE_WARMUP_MINUTES = 15;
const DEFAULT_SCHEDULE_MAX_TURNS = 50;
const DEFAULT_SCHEDULE_MAX_CONSECUTIVE_FAILURES = 3;

type InMemoryScheduleRun = {
  id: string;
  scheduleId: string;
  teamName: string;
  status:
    | 'pending'
    | 'warming_up'
    | 'warm'
    | 'running'
    | 'completed'
    | 'failed'
    | 'failed_interrupted'
    | 'cancelled';
  scheduledFor: string;
  startedAt: string;
  warmUpCompletedAt?: string;
  executionStartedAt?: string;
  completedAt?: string;
  durationMs?: number;
  exitCode?: number | null;
  error?: string;
  retryCount: number;
  summary?: string;
};

const scheduleRunsById = new Map<string, InMemoryScheduleRun[]>();
const scheduleRunLogsByKey = new Map<string, { stdout: string; stderr: string }>();

function makeScheduleRunLogKey(scheduleId: string, runId: string): string {
  return `${scheduleId}:${runId}`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeCronLastRun(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  if (value.startsWith(CRON_ZERO_TIME_PREFIX)) return undefined;
  return value;
}

function buildFallbackSessionKey(teamName: string): string {
  return `hermit:${teamName}:session`;
}

async function waitForHarnessBridgeConnected(
  timeoutMs = HARNESS_BRIDGE_CONNECT_TIMEOUT_MS
): Promise<void> {
  if (bridge.connected) return;
  bridge.start();
  if (bridge.connected) return;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('cc-connect Bridge 连接超时，无法发送到 harness'));
    }, timeoutMs);

    const onConnected = () => {
      cleanup();
      resolve();
    };

    const cleanup = () => {
      clearTimeout(timer);
      bridge.off('connected', onConnected);
    };

    bridge.on('connected', onConnected);
  });
}

async function sendHarnessMessageViaBridge(params: {
  teamName: string;
  text: string;
  sessionKey?: string;
  msgId?: string;
}): Promise<string> {
  await waitForHarnessBridgeConnected();

  const sessionKey = params.sessionKey?.trim() || buildFallbackSessionKey(params.teamName);
  bridge.sendUserMessage({
    sessionKey,
    userId: 'hermit-user',
    userName: 'User',
    content: params.text,
    msgId: params.msgId,
    project: params.teamName,
  });
  return sessionKey;
}

async function resolveTeamWorkDirs(teamNames: string[]): Promise<Map<string, string>> {
  const uniqueTeamNames = [...new Set(teamNames.filter((name) => name.trim().length > 0))];
  const results = new Map<string, string>();

  await Promise.all(
    uniqueTeamNames.map(async (teamName) => {
      let cwd = '';
      try {
        const meta = await svc.readTeamManifest(teamName);
        if (typeof meta.workDir === 'string') {
          cwd = meta.workDir.trim();
        }
      } catch {
        // ignore
      }

      if (!cwd) {
        try {
          const detail = await cc.getProject(teamName);
          if (typeof detail.work_dir === 'string') {
            cwd = detail.work_dir.trim();
          }
        } catch {
          // ignore
        }
      }

      results.set(teamName, cwd);
    })
  );

  return results;
}

function mapCronJobToSchedule(
  cronJob: {
    id: string;
    project: string;
    cron_expr: string;
    prompt: string;
    description?: string;
    enabled: boolean;
    created_at: string;
    last_run?: string;
  },
  cwd: string
): {
  id: string;
  teamName: string;
  label?: string;
  cronExpression: string;
  timezone: string;
  status: 'active' | 'paused' | 'disabled';
  warmUpMinutes: number;
  maxConsecutiveFailures: number;
  consecutiveFailures: number;
  maxTurns: number;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  launchConfig: { cwd: string; prompt: string };
} {
  const lastRunAt = normalizeCronLastRun(cronJob.last_run);
  const status: 'active' | 'paused' = cronJob.enabled ? 'active' : 'paused';

  return {
    id: cronJob.id,
    teamName: cronJob.project,
    label: isNonEmptyString(cronJob.description) ? cronJob.description.trim() : undefined,
    cronExpression: cronJob.cron_expr,
    timezone: DEFAULT_SCHEDULE_TIMEZONE,
    status,
    warmUpMinutes: DEFAULT_SCHEDULE_WARMUP_MINUTES,
    maxConsecutiveFailures: DEFAULT_SCHEDULE_MAX_CONSECUTIVE_FAILURES,
    consecutiveFailures: 0,
    maxTurns: DEFAULT_SCHEDULE_MAX_TURNS,
    createdAt: cronJob.created_at,
    updatedAt: lastRunAt ?? cronJob.created_at,
    lastRunAt,
    launchConfig: {
      cwd,
      prompt: cronJob.prompt,
    },
  };
}

function normalizeScheduleRouteId(id: string): string {
  const trimmed = id.trim();
  if (trimmed.startsWith('schedule:')) {
    return trimmed.slice('schedule:'.length);
  }
  if (trimmed.startsWith('SCH-')) {
    return trimmed.slice('SCH-'.length);
  }
  return trimmed;
}

function findCronJobByRouteId<
  T extends {
    id: string;
  },
>(jobs: T[], id: string): T | undefined {
  const normalized = normalizeScheduleRouteId(id);
  const exact = jobs.find((job) => job.id === normalized || job.id === id);
  if (exact) return exact;

  const prefixMatches = jobs.filter((job) => job.id.startsWith(normalized));
  return prefixMatches.length === 1 ? prefixMatches[0] : undefined;
}

function clearScheduleRuntimeState(scheduleId: string): void {
  scheduleRunsById.delete(scheduleId);
  for (const key of [...scheduleRunLogsByKey.keys()]) {
    if (key.startsWith(`${scheduleId}:`)) {
      scheduleRunLogsByKey.delete(key);
    }
  }
}

function isCronNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(\b404\b|not found|no matching|does not exist|不存在)/i.test(message);
}

app.get('/api/schedules', async () => {
  try {
    const jobs = await cc.listCronJobs();
    if (jobs.length === 0) return [];
    const workDirMap = await resolveTeamWorkDirs(jobs.map((job) => job.project));
    return jobs.map((job) => mapCronJobToSchedule(job, workDirMap.get(job.project) ?? ''));
  } catch (err) {
    app.log.warn({ err }, 'list schedules from cc-connect failed');
    return [];
  }
});

app.get<{ Params: { id: string } }>('/api/schedules/:id', async (request) => {
  try {
    const jobs = await cc.listCronJobs();
    const job = jobs.find((item) => item.id === request.params.id);
    if (!job) return null;
    const workDirMap = await resolveTeamWorkDirs([job.project]);
    return mapCronJobToSchedule(job, workDirMap.get(job.project) ?? '');
  } catch (err) {
    app.log.warn({ err, scheduleId: request.params.id }, 'get schedule from cc-connect failed');
    return null;
  }
});

app.post<{ Body: Record<string, unknown> }>('/api/schedules', async (request, reply) => {
  try {
    const body = request.body ?? {};
    const teamName = typeof body.teamName === 'string' ? body.teamName.trim() : '';
    const cronExpression =
      typeof body.cronExpression === 'string' ? body.cronExpression.trim() : '';
    const label = typeof body.label === 'string' ? body.label.trim() : '';
    const maxTurns =
      typeof body.maxTurns === 'number' && Number.isFinite(body.maxTurns)
        ? Math.max(1, Math.floor(body.maxTurns))
        : DEFAULT_SCHEDULE_MAX_TURNS;

    const launchConfig =
      body.launchConfig &&
      typeof body.launchConfig === 'object' &&
      !Array.isArray(body.launchConfig)
        ? (body.launchConfig as Record<string, unknown>)
        : {};
    const prompt = typeof launchConfig.prompt === 'string' ? launchConfig.prompt.trim() : '';
    const cwd = typeof launchConfig.cwd === 'string' ? launchConfig.cwd.trim() : '';
    const sessionKey =
      typeof launchConfig.session_key === 'string' && launchConfig.session_key.trim().length > 0
        ? launchConfig.session_key.trim()
        : buildFallbackSessionKey(teamName);

    if (!teamName || !cronExpression || !prompt) {
      return reply
        .code(400)
        .send({ error: 'teamName、cronExpression、launchConfig.prompt 不能为空' });
    }

    const created = await cc.createCronJob({
      project: teamName,
      session_key: sessionKey,
      cron_expr: cronExpression,
      prompt,
      description: label || undefined,
      enabled: true,
      timeout_mins: maxTurns,
    });

    const schedule = mapCronJobToSchedule(created, cwd);
    broadcastSse('schedule:change', {
      type: 'schedule-updated',
      scheduleId: schedule.id,
      teamName: schedule.teamName,
      detail: 'created',
    });
    return schedule;
  } catch (err) {
    return reply500(err);
  }
});

app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
  '/api/schedules/:id',
  async (request, reply) => {
    try {
      const jobs = await cc.listCronJobs();
      const existing = jobs.find((item) => item.id === request.params.id);
      if (!existing) {
        return reply.code(404).send({ error: 'Schedule not found' });
      }

      const patchBody = request.body ?? {};
      const patch: Record<string, unknown> = {};
      if (typeof patchBody.label === 'string') {
        patch.description = patchBody.label.trim();
      }
      if (typeof patchBody.cronExpression === 'string') {
        patch.cron_expr = patchBody.cronExpression.trim();
      }
      const launchConfig =
        patchBody.launchConfig &&
        typeof patchBody.launchConfig === 'object' &&
        !Array.isArray(patchBody.launchConfig)
          ? (patchBody.launchConfig as Record<string, unknown>)
          : null;
      if (launchConfig && typeof launchConfig.prompt === 'string') {
        patch.prompt = launchConfig.prompt.trim();
      }
      if (typeof patchBody.maxTurns === 'number' && Number.isFinite(patchBody.maxTurns)) {
        patch.timeout_mins = Math.max(1, Math.floor(patchBody.maxTurns));
      }

      const updated = Object.keys(patch).length
        ? await cc.updateCronJob(request.params.id, patch)
        : existing;

      const workDirMap = await resolveTeamWorkDirs([updated.project]);
      const schedule = mapCronJobToSchedule(updated, workDirMap.get(updated.project) ?? '');
      broadcastSse('schedule:change', {
        type: 'schedule-updated',
        scheduleId: schedule.id,
        teamName: schedule.teamName,
        detail: 'updated',
      });
      return schedule;
    } catch (err) {
      return reply500(err);
    }
  }
);

app.delete<{ Params: { id: string } }>('/api/schedules/:id', async (request, reply) => {
  const requestedId = request.params.id;
  const normalizedId = normalizeScheduleRouteId(requestedId);
  let resolvedId = normalizedId;
  let resolvedTeamName = '';

  try {
    let jobs: Awaited<ReturnType<typeof cc.listCronJobs>> = [];
    let listedJobs = false;
    try {
      jobs = await cc.listCronJobs();
      listedJobs = true;
    } catch (listErr) {
      request.log.warn(
        { err: listErr, scheduleId: requestedId },
        'list cron jobs before delete failed'
      );
    }
    const target = findCronJobByRouteId(jobs, requestedId);
    if (target) {
      resolvedId = target.id;
      resolvedTeamName =
        'project' in target && typeof target.project === 'string' ? target.project : '';
    } else if (
      listedJobs &&
      !jobs.some((job) => job.id === normalizedId || job.id.startsWith(normalizedId))
    ) {
      clearScheduleRuntimeState(normalizedId);
      broadcastSse('schedule:change', {
        type: 'schedule-updated',
        scheduleId: normalizedId,
        teamName: '',
        detail: 'deleted',
      });
      return {};
    }

    await cc.deleteCronJob(resolvedId);
    clearScheduleRuntimeState(resolvedId);
    broadcastSse('schedule:change', {
      type: 'schedule-updated',
      scheduleId: resolvedId,
      teamName: resolvedTeamName,
      detail: 'deleted',
    });
    return {};
  } catch (err) {
    if (isCronNotFoundError(err)) {
      clearScheduleRuntimeState(resolvedId);
      clearScheduleRuntimeState(normalizedId);
      broadcastSse('schedule:change', {
        type: 'schedule-updated',
        scheduleId: resolvedId,
        teamName: resolvedTeamName,
        detail: 'deleted',
      });
      return {};
    }
    try {
      const jobs = await cc.listCronJobs();
      const stillExists = Boolean(findCronJobByRouteId(jobs, requestedId));
      if (!stillExists) {
        clearScheduleRuntimeState(resolvedId);
        broadcastSse('schedule:change', {
          type: 'schedule-updated',
          scheduleId: resolvedId,
          teamName: resolvedTeamName,
          detail: 'deleted',
        });
        return {};
      }
    } catch (verifyErr) {
      request.log.warn({ err: verifyErr, scheduleId: requestedId }, 'verify cron delete failed');
    }
    return reply.code(500).send(reply500(err));
  }
});

app.post<{ Params: { id: string } }>('/api/schedules/:id/pause', async (request, reply) => {
  try {
    const jobs = await cc.listCronJobs();
    const current = jobs.find((item) => item.id === request.params.id);
    if (current) {
      try {
        await cc.sendMessage(
          current.project,
          current.session_key || buildFallbackSessionKey(current.project),
          '/stop'
        );
      } catch (err) {
        request.log.warn({ err, scheduleId: request.params.id }, 'send /stop for cron failed');
      }
    }
    const updated = await cc.updateCronJob(request.params.id, { enabled: false });
    broadcastSse('schedule:change', {
      type: 'schedule-paused',
      scheduleId: request.params.id,
      teamName: updated.project,
      detail: 'paused',
    });
    return {};
  } catch (err) {
    return reply500(err);
  }
});

app.post<{ Params: { id: string } }>('/api/schedules/:id/resume', async (request, reply) => {
  try {
    const updated = await cc.updateCronJob(request.params.id, { enabled: true });
    broadcastSse('schedule:change', {
      type: 'schedule-updated',
      scheduleId: request.params.id,
      teamName: updated.project,
      detail: 'resumed',
    });
    return {};
  } catch (err) {
    return reply500(err);
  }
});

app.post<{ Params: { id: string } }>('/api/schedules/:id/trigger', async (request, reply) => {
  try {
    const jobs = await cc.listCronJobs();
    const job = jobs.find((item) => item.id === request.params.id);
    if (!job) {
      return reply.code(404).send({ error: 'Schedule not found' });
    }
    const nowIso = new Date().toISOString();
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let run: InMemoryScheduleRun;

    try {
      await cc.sendMessage(
        job.project,
        job.session_key || buildFallbackSessionKey(job.project),
        job.prompt
      );
      run = {
        id: runId,
        scheduleId: job.id,
        teamName: job.project,
        status: 'running',
        scheduledFor: nowIso,
        startedAt: nowIso,
        executionStartedAt: nowIso,
        retryCount: 0,
        summary: 'Triggered via Hermit; waiting for agent runtime',
      };
      scheduleRunLogsByKey.set(makeScheduleRunLogKey(job.id, runId), {
        stdout: `Triggered at ${nowIso}`,
        stderr: '',
      });
    } catch (error) {
      run = {
        id: runId,
        scheduleId: job.id,
        teamName: job.project,
        status: 'failed',
        scheduledFor: nowIso,
        startedAt: nowIso,
        executionStartedAt: nowIso,
        completedAt: nowIso,
        durationMs: 0,
        exitCode: 1,
        retryCount: 0,
        error: error instanceof Error ? error.message : String(error),
        summary: 'Trigger failed',
      };
      scheduleRunLogsByKey.set(makeScheduleRunLogKey(job.id, runId), {
        stdout: '',
        stderr: run.error ?? 'Trigger failed',
      });
    }

    const previousRuns = scheduleRunsById.get(job.id) ?? [];
    scheduleRunsById.set(job.id, [run, ...previousRuns].slice(0, 100));
    broadcastSse('schedule:change', {
      type: run.status === 'failed' ? 'run-failed' : 'run-started',
      scheduleId: job.id,
      teamName: job.project,
      detail: run.status,
    });
    return run;
  } catch (err) {
    return reply500(err);
  }
});

app.get<{ Params: { id: string } }>('/api/schedules/:id/runs', async (request) => {
  const scheduleId = request.params.id;
  const runs = scheduleRunsById.get(scheduleId) ?? [];
  if (runs.length > 0) {
    return runs;
  }

  try {
    const jobs = await cc.listCronJobs();
    const job = jobs.find((item) => item.id === scheduleId);
    const lastRunAt = normalizeCronLastRun(job?.last_run);
    if (!job || !lastRunAt) return [];
    return [
      {
        id: `last-${scheduleId}`,
        scheduleId,
        teamName: job.project,
        status: 'completed',
        scheduledFor: lastRunAt,
        startedAt: lastRunAt,
        executionStartedAt: lastRunAt,
        completedAt: lastRunAt,
        durationMs: 0,
        exitCode: 0,
        retryCount: 0,
        summary: 'Last run from cc-connect',
      },
    ];
  } catch {
    return [];
  }
});

app.get<{ Params: { id: string; runId: string } }>(
  '/api/schedules/:id/runs/:runId/logs',
  async (request) => {
    return (
      scheduleRunLogsByKey.get(makeScheduleRunLogKey(request.params.id, request.params.runId)) ?? {
        stdout: '',
        stderr: '',
      }
    );
  }
);

// Browse directories — returns subdirectories at the given path
app.post<{ Body: { path?: string; limit?: number } }>(
  '/api/config/browse-folders',
  async (request) => {
    const { path: dirPath, limit = 200 } = request.body ?? {};
    const target = dirPath && dirPath.trim() ? dirPath.trim() : os.homedir();

    try {
      const entries = readdirSync(target, { withFileTypes: true });
      const dirs = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .slice(0, limit)
        .map((e) => path.join(target, e.name));
      return {
        success: true,
        data: { path: target, dirs, hasParent: target !== path.dirname(target) },
      };
    } catch {
      return { success: false, error: `无法访问目录: ${target}` };
    }
  }
);

// POST /api/workspace/list — 文件目录浏览
app.post<{ Body: { dirPath?: string } }>('/api/workspace/list', async (request) => {
  const { dirPath } = request.body ?? {};
  const target = dirPath && dirPath.trim() ? dirPath.trim() : os.homedir();

  try {
    const entries = readdirSync(target, { withFileTypes: true });
    const files = entries
      .filter((e) => !e.name.startsWith('.'))
      .slice(0, 500)
      .map((e) => {
        const fullPath = path.join(target, e.name);
        const isDirectory = e.isDirectory();
        let size = 0;
        try {
          const stat = statSync(fullPath);
          size = stat.size;
        } catch {
          /* ignore */
        }
        return {
          name: e.name,
          isDirectory,
          size,
          ext: isDirectory ? '' : path.extname(e.name).slice(1).toLowerCase(),
        };
      });
    return { path: target, files, hasParent: target !== path.dirname(target) };
  } catch {
    return { path: target, files: [], hasParent: false, error: `无法访问目录: ${target}` };
  }
});

// ===========================================================================
// Project Editor API (web mode)
// ===========================================================================

const MAX_EDITOR_DIR_ENTRIES = 2000;
const MAX_EDITOR_FILE_BYTES = 2 * 1024 * 1024;

function resolveEditorRoot(rawRoot: unknown): string {
  if (typeof rawRoot !== 'string' || rawRoot.trim().length === 0) {
    throw new Error('root 参数不能为空');
  }
  const resolved = path.resolve(rawRoot.trim());
  if (!_existsSync2(resolved)) {
    throw new Error(`目录不存在: ${resolved}`);
  }
  const st = statSync(resolved);
  if (!st.isDirectory()) {
    throw new Error(`不是目录: ${resolved}`);
  }
  return resolved;
}

function isPathInsideRoot(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveEditorPath(root: string, rawPath: unknown): string {
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    throw new Error('filePath/dirPath 参数不能为空');
  }
  const requested = rawPath.trim();
  const resolved = path.resolve(
    path.isAbsolute(requested) ? requested : path.join(root, requested)
  );
  if (!isPathInsideRoot(root, resolved)) {
    throw new Error('路径超出项目根目录');
  }
  return resolved;
}

function detectBinary(buffer: Buffer): boolean {
  const sampleLength = Math.min(buffer.length, 4096);
  for (let i = 0; i < sampleLength; i++) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
}

function sendEditorError(
  reply: { code: (statusCode: number) => { send: (payload: { error: string }) => unknown } },
  err: unknown
) {
  const message = err instanceof Error ? err.message : String(err);
  return reply.code(500).send({ error: message });
}

app.post<{ Body: { root?: unknown } }>('/api/editor/open', async (request, reply) => {
  try {
    const root = resolveEditorRoot(request.body?.root);
    return { ok: true, root };
  } catch (err) {
    return sendEditorError(reply, err);
  }
});

app.post('/api/editor/close', async () => ({ ok: true }));

app.get<{ Querystring: { root?: unknown; dirPath?: unknown; maxEntries?: string } }>(
  '/api/editor/readDir',
  async (request, reply) => {
    try {
      const root = resolveEditorRoot(request.query.root);
      const dirPath = request.query.dirPath ? resolveEditorPath(root, request.query.dirPath) : root;
      const maxEntriesRaw = Number.parseInt(request.query.maxEntries ?? '', 10);
      const maxEntries = Number.isFinite(maxEntriesRaw)
        ? Math.min(Math.max(maxEntriesRaw, 1), MAX_EDITOR_DIR_ENTRIES)
        : MAX_EDITOR_DIR_ENTRIES;
      const entries = readdirSync(dirPath, { withFileTypes: true });
      const sliced = entries.slice(0, maxEntries);
      const mapped = sliced
        .map((entry) => {
          const fullPath = path.join(dirPath, entry.name);
          let size = 0;
          try {
            size = entry.isFile() ? statSync(fullPath).size : 0;
          } catch {
            size = 0;
          }
          return {
            name: entry.name,
            path: fullPath,
            type: (entry.isDirectory() ? 'directory' : 'file') as 'directory' | 'file',
            size,
          };
        })
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      return {
        entries: mapped,
        truncated: entries.length > maxEntries,
      };
    } catch (err) {
      return sendEditorError(reply, err);
    }
  }
);

app.get<{ Querystring: { root?: unknown; filePath?: unknown } }>(
  '/api/editor/readFile',
  async (request, reply) => {
    try {
      const root = resolveEditorRoot(request.query.root);
      const filePath = resolveEditorPath(root, request.query.filePath);
      const st = statSync(filePath);
      if (!st.isFile()) {
        throw new Error(`不是文件: ${filePath}`);
      }

      const fullBuffer = readFileSync(filePath);
      const truncated = fullBuffer.length > MAX_EDITOR_FILE_BYTES;
      const readBuffer = truncated ? fullBuffer.subarray(0, MAX_EDITOR_FILE_BYTES) : fullBuffer;
      const isBinary = detectBinary(readBuffer);
      return {
        content: isBinary ? '' : readBuffer.toString('utf-8'),
        size: st.size,
        mtimeMs: st.mtimeMs,
        truncated,
        encoding: isBinary ? 'binary' : 'utf-8',
        isBinary,
      };
    } catch (err) {
      return sendEditorError(reply, err);
    }
  }
);

app.post<{
  Body: { root?: unknown; filePath?: unknown; content?: unknown; baselineMtimeMs?: unknown };
}>('/api/editor/writeFile', async (request, reply) => {
  try {
    const root = resolveEditorRoot(request.body?.root);
    const filePath = resolveEditorPath(root, request.body?.filePath);
    const content = request.body?.content;
    if (typeof content !== 'string') {
      throw new Error('content 必须是字符串');
    }
    const baselineRaw = request.body?.baselineMtimeMs;
    if (typeof baselineRaw === 'number' && Number.isFinite(baselineRaw)) {
      const currentMtime = statSync(filePath).mtimeMs;
      if (Math.abs(currentMtime - baselineRaw) > 1) {
        throw new Error('CONFLICT: file changed on disk');
      }
    }
    writeFileSync(filePath, content, 'utf-8');
    const st = statSync(filePath);
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch (err) {
    return sendEditorError(reply, err);
  }
});

app.post<{ Body: { root?: unknown; parentDir?: unknown; fileName?: unknown } }>(
  '/api/editor/createFile',
  async (request, reply) => {
    try {
      const root = resolveEditorRoot(request.body?.root);
      const parentDir = resolveEditorPath(root, request.body?.parentDir);
      const fileName =
        typeof request.body?.fileName === 'string' ? request.body.fileName.trim() : '';
      if (!fileName) {
        throw new Error('fileName 不能为空');
      }
      const filePath = resolveEditorPath(root, path.join(parentDir, fileName));
      writeFileSync(filePath, '', { encoding: 'utf-8', flag: 'wx' });
      const st = statSync(filePath);
      return { filePath, mtimeMs: st.mtimeMs };
    } catch (err) {
      return sendEditorError(reply, err);
    }
  }
);

app.post<{ Body: { root?: unknown; parentDir?: unknown; dirName?: unknown } }>(
  '/api/editor/createDir',
  async (request, reply) => {
    try {
      const root = resolveEditorRoot(request.body?.root);
      const parentDir = resolveEditorPath(root, request.body?.parentDir);
      const dirName = typeof request.body?.dirName === 'string' ? request.body.dirName.trim() : '';
      if (!dirName) {
        throw new Error('dirName 不能为空');
      }
      const dirPath = resolveEditorPath(root, path.join(parentDir, dirName));
      mkdirSync(dirPath, { recursive: false });
      return { dirPath };
    } catch (err) {
      return sendEditorError(reply, err);
    }
  }
);

app.post<{ Body: { root?: unknown; filePath?: unknown } }>(
  '/api/editor/deleteFile',
  async (request, reply) => {
    try {
      const root = resolveEditorRoot(request.body?.root);
      const filePath = resolveEditorPath(root, request.body?.filePath);
      rmSync(filePath, { recursive: true, force: false });
      return { deletedPath: filePath };
    } catch (err) {
      return sendEditorError(reply, err);
    }
  }
);

app.post<{ Body: { root?: unknown; sourcePath?: unknown; destDir?: unknown } }>(
  '/api/editor/moveFile',
  async (request, reply) => {
    try {
      const root = resolveEditorRoot(request.body?.root);
      const sourcePath = resolveEditorPath(root, request.body?.sourcePath);
      const destDir = resolveEditorPath(root, request.body?.destDir);
      const newPath = resolveEditorPath(root, path.join(destDir, path.basename(sourcePath)));
      const sourceStat = statSync(sourcePath);
      renameSync(sourcePath, newPath);
      return { newPath, isDirectory: sourceStat.isDirectory() };
    } catch (err) {
      return sendEditorError(reply, err);
    }
  }
);

app.post<{ Body: { root?: unknown; sourcePath?: unknown; newName?: unknown } }>(
  '/api/editor/renameFile',
  async (request, reply) => {
    try {
      const root = resolveEditorRoot(request.body?.root);
      const sourcePath = resolveEditorPath(root, request.body?.sourcePath);
      const newName = typeof request.body?.newName === 'string' ? request.body.newName.trim() : '';
      if (!newName) {
        throw new Error('newName 不能为空');
      }
      const parentDir = path.dirname(sourcePath);
      const newPath = resolveEditorPath(root, path.join(parentDir, newName));
      const sourceStat = statSync(sourcePath);
      renameSync(sourcePath, newPath);
      return { newPath, isDirectory: sourceStat.isDirectory() };
    } catch (err) {
      return sendEditorError(reply, err);
    }
  }
);

app.get<{ Querystring: { root?: unknown } }>('/api/editor/listFiles', async (request, reply) => {
  try {
    const root = resolveEditorRoot(request.query.root);
    const result: { path: string; name: string; relativePath: string }[] = [];
    const walk = (dirPath: string) => {
      for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '.git' || entry.name === 'node_modules') {
            continue;
          }
          walk(fullPath);
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }
        result.push({
          path: fullPath,
          name: entry.name,
          relativePath: path.relative(root, fullPath),
        });
      }
    };
    walk(root);
    return result;
  } catch (err) {
    return sendEditorError(reply, err);
  }
});

app.get<{ Querystring: { root?: unknown; filePath?: unknown } }>(
  '/api/editor/readBinaryPreview',
  async (request, reply) => {
    try {
      const root = resolveEditorRoot(request.query.root);
      const filePath = resolveEditorPath(root, request.query.filePath);
      const content = readFileSync(filePath);
      return {
        base64: content.toString('base64'),
        mimeType: 'application/octet-stream',
        size: content.length,
      };
    } catch (err) {
      return sendEditorError(reply, err);
    }
  }
);

app.get('/api/editor/gitStatus', async () => ({
  files: [],
  isGitRepo: false,
  branch: null,
}));

app.post('/api/editor/watchDir', async () => ({ ok: true }));
app.post('/api/editor/setWatchedFiles', async () => ({ ok: true }));
app.post('/api/editor/setWatchedDirs', async () => ({ ok: true }));
app.get('/api/editor/search', async () => ({ results: [], totalMatches: 0, truncated: false }));

// ===========================================================================
// 团队详情页强依赖的 stubs — 返回正确数据结构防止 store 解析失败
// ===========================================================================

// 消息分页 — store 期望 MessagesPage 结构
app.get<{ Params: { name: string }; Querystring: { cursor?: string; limit?: string } }>(
  '/api/teams/:name/messages',
  async (request) => {
    const { name } = request.params;
    const requestedLimit = Number(request.query.limit ?? 50);
    const limit = Math.min(
      Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 50),
      100
    );
    const rawCursor = request.query.cursor;
    const offset = Math.max(
      0,
      Number.isFinite(Number(rawCursor)) ? Math.floor(Number(rawCursor)) : 0
    );
    try {
      // Keep a bounded history snapshot in memory for pagination safety.
      const msgs = await svc.readMessages(name, { limit: 5000 });
      const sessions = await cc.listSessions(name).catch(() => []);
      const sessionByKey = new Map(sessions.map((session) => [session.session_key, session]));
      const newestFirstMessages = [...msgs].reverse();
      const pageSlice = newestFirstMessages.slice(offset, offset + limit);
      const page = pageSlice.map((m) => {
        const explicitSessionKey =
          typeof m.meta?.sessionKey === 'string'
            ? m.meta.sessionKey
            : typeof m.meta?.session_key === 'string'
              ? m.meta.session_key
              : undefined;
        const sessionKey = explicitSessionKey ?? buildFallbackSessionKey(name);
        const session = sessionKey ? sessionByKey.get(sessionKey) : undefined;
        return {
          messageId: m.id,
          from: m.from,
          to: m.to,
          text: m.content,
          timestamp: m.ts,
          read: true,
          source:
            typeof m.meta?.source === 'string'
              ? m.meta.source
              : ((m.role === 'user' ? 'user_sent' : 'inbox') as string),
          taskRefs: Array.isArray(m.meta?.taskRefs) ? m.meta.taskRefs : undefined,
          summary: typeof m.meta?.summary === 'string' ? m.meta.summary : undefined,
          conversationId:
            typeof m.meta?.conversationId === 'string' ? m.meta.conversationId : undefined,
          replyToConversationId:
            typeof m.meta?.replyToConversationId === 'string'
              ? m.meta.replyToConversationId
              : undefined,
          session: sessionKey
            ? {
                id: session?.id,
                key: sessionKey,
                platform: session?.platform,
                title: session?.name || session?.user_name || session?.chat_name || sessionKey,
                chatName: session?.chat_name,
                userName: session?.user_name,
              }
            : undefined,
        };
      });
      // feedRevision = count:lastId で変更を確実に検出
      const lastMsg = msgs[msgs.length - 1];
      const firstMsg = msgs[0];
      const feedRevision = `${msgs.length}:${firstMsg?.id ?? '0'}:${lastMsg?.id ?? '0'}`;
      const nextOffset = offset + page.length;
      const hasMore = nextOffset < newestFirstMessages.length;
      return {
        messages: page,
        nextCursor: hasMore ? String(nextOffset) : null,
        hasMore,
        feedRevision,
      };
    } catch {
      return { messages: [], nextCursor: null, hasMore: false, feedRevision: '0' };
    }
  }
);

// 消息 head（messages-head 不是标准路由，storeok调 getMessagesPage 的同路由带 limit）
// member-activity-meta
app.get<{ Params: { name: string } }>('/api/teams/:name/member-activity-meta', async (request) => {
  const { name } = request.params;
  return {
    teamName: name,
    computedAt: new Date().toISOString(),
    members: {},
    feedRevision: '0',
  };
});

// member-activity — GET /api/teams/:name/member-activity
app.get<{ Params: { name: string } }>('/api/teams/:name/member-activity', async (request) => {
  const { name } = request.params;
  return {
    teamName: name,
    computedAt: new Date().toISOString(),
    members: {},
    feedRevision: '0',
  };
});

// member-spawn-statuses — GET /api/teams/:name/member-spawn-statuses
app.get<{ Params: { name: string } }>('/api/teams/:name/member-spawn-statuses', async (request) => {
  const { name } = request.params;
  return {
    statuses: {},
    runId: null,
  };
});

// agent-runtime — GET /api/teams/:name/agent-runtime
app.get<{ Params: { name: string } }>('/api/teams/:name/agent-runtime', async (request) => {
  const { name } = request.params;
  return {
    teamName: name,
    updatedAt: new Date().toISOString(),
    runId: null,
    members: {},
  };
});

// lead-activity — GET /api/teams/:name/lead-activity
app.get<{ Params: { name: string } }>('/api/teams/:name/lead-activity', async () => {
  return { state: 'offline', updatedAt: new Date().toISOString() };
});

// lead-context — GET /api/teams/:name/lead-context
app.get<{ Params: { name: string } }>('/api/teams/:name/lead-context', async () => {
  return { usage: null };
});

// sessions — 从 cc-connect project sessions 获取，转换为前端 Session 格式
app.get<{ Params: { name: string } }>('/api/teams/:name/sessions', async (request) => {
  try {
    const sessions = await cc.listSessions(request.params.name);
    const sessionsByKey = new Map<string, (typeof sessions)[number]>();
    const sessionScore = (session: (typeof sessions)[number]): number => {
      const updatedAt = Date.parse(session.updated_at);
      return (
        (session.live ? 1_000_000_000_000_000 : 0) +
        (session.active ? 1_000_000_000_000 : 0) +
        (session.history_count ?? 0) * 1_000_000 +
        (session.agent_type ? 10_000 : 0) +
        (Number.isFinite(updatedAt) ? updatedAt / 1_000_000 : 0)
      );
    };
    for (const session of sessions) {
      const existing = sessionsByKey.get(session.session_key);
      if (!existing || sessionScore(session) > sessionScore(existing)) {
        sessionsByKey.set(session.session_key, session);
      }
    }

    return [...sessionsByKey.values()].map((s) => ({
      id: s.id,
      title: s.user_name || s.chat_name || s.name || s.session_key,
      projectId: request.params.name,
      sessionKey: s.session_key,
      platform: s.platform,
      userName: s.user_name ?? null,
      chatName: s.chat_name ?? null,
      active: s.active,
      live: s.live,
      historyCount: s.history_count,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
      lastMessage: s.last_message
        ? {
            role: s.last_message.role,
            content: s.last_message.content,
            timestamp: s.last_message.timestamp,
          }
        : null,
    }));
  } catch {
    return [];
  }
});

// GET session detail — 通过 cc-connect API 获取会话详情（含历史消息）
app.get<{ Params: { name: string; sessionId: string }; Querystring: { history_limit?: string } }>(
  '/api/teams/:name/sessions/:sessionId',
  async (request) => {
    const historyLimit = request.query.history_limit
      ? parseInt(request.query.history_limit, 10)
      : 500;
    const detail = await cc.getSession(request.params.name, request.params.sessionId, historyLimit);
    return mapCcSessionDetail(detail);
  }
);

// DELETE session — 关闭 cc-connect live session，使其从运行中转为历史会话。
app.delete<{ Params: { name: string; sessionId: string } }>(
  '/api/teams/:name/sessions/:sessionId',
  async (request, reply) => {
    try {
      const detail = await cc.getSession(request.params.name, request.params.sessionId, 1);
      await sendHarnessMessageViaBridge({
        teamName: request.params.name,
        sessionKey: detail.session_key,
        text: '/stop',
        msgId: `hermit-stop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      });
      return { ok: true };
    } catch (err) {
      return reply
        .code(500)
        .send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
);

// runtime/alive — 从 cc-connect 获取真实在线状态
app.get('/api/teams/runtime/alive', async () => {
  try {
    const projects = await cc.listProjects();
    return await Promise.all(
      projects.map(async (p) => {
        let isAlive = false;
        try {
          const detail = await cc.getProject(p.name);
          isAlive = Array.isArray(detail.platforms) && detail.platforms.some((pl) => pl.connected);
        } catch {
          /* degraded */
        }
        return { teamName: p.name, isAlive, runId: p.name };
      })
    );
  } catch {
    return [];
  }
});

// process-alive — 查询 cc-connect project 在线状态
app.get<{ Params: { name: string } }>('/api/teams/:name/process-alive', async (request) => {
  try {
    const p = await cc.getProject(request.params.name);
    return Array.isArray(p.platforms) && p.platforms.some((pl) => pl.connected);
  } catch {
    return false;
  }
});

// process-send — 从 Hermit UI 注入到 harness，不回发到 IM 平台。
app.post<{ Params: { name: string }; Body: { text?: string; message?: string } }>(
  '/api/teams/:name/process-send',
  async (request, reply) => {
    try {
      const text = request.body?.text ?? request.body?.message ?? '';
      if (text) {
        await sendHarnessMessageViaBridge({
          teamName: request.params.name,
          text,
        });
      }
      return { ok: true };
    } catch (err) {
      return reply.code(502).send({
        ok: false,
        error: err instanceof Error ? err.message : '发送到 harness 失败',
      });
    }
  }
);

// saved-request — 新版无此概念
app.get<{ Params: { name: string } }>('/api/teams/:name/saved-request', async () => null);

// kanban state — 返回空看板状态
app.get<{ Params: { name: string } }>('/api/teams/:name/kanban', async (request) => ({
  teamName: request.params.name,
  reviewers: [],
  tasks: {},
}));

// task-change-presence — 返回 {}
app.get<{ Params: { name: string } }>('/api/teams/:name/task-change-presence', async () => ({}));

// kanban column order — no-op
app.post<{ Params: { name: string } }>('/api/teams/:name/kanban-column-order', async () => ({
  ok: true,
}));

// teams/tasks (全局任务列表 — 跨所有团队)
app.get('/api/teams/tasks', async () => {
  try {
    const allTasks: ReturnType<typeof toTeamTask>[] = [];
    const projects = await cc.listProjects();
    for (const p of projects) {
      try {
        const tasks = activeTasks(await svc.readTasks(p.name));
        allTasks.push(...tasks.map(toTeamTask));
      } catch {
        /* skip */
      }
    }
    return allTasks;
  } catch {
    return [];
  }
});

// 团队任务子操作 — 全部委托给 svc.patchTask
app.post<{ Params: { name: string; id: string } }>(
  '/api/teams/:name/tasks/:id/request-review',
  async (request) => {
    try {
      const task = await svc.patchTask(request.params.name, request.params.id, { status: 'done' });
      return { ok: true, data: toTeamTask(task) };
    } catch {
      return { ok: true };
    }
  }
);
app.patch<{ Params: { name: string; id: string }; Body: Record<string, unknown> }>(
  '/api/teams/:name/tasks/:id/kanban',
  async (request) => {
    // kanban metadata — stored in board.json via patchTask (no-op for now, column tracked client-side)
    return { ok: true };
  }
);
app.patch<{ Params: { name: string; id: string }; Body: { status?: string } }>(
  '/api/teams/:name/tasks/:id/status',
  async (request) => {
    try {
      const { status } = request.body ?? {};
      const task = await svc.patchTask(request.params.name, request.params.id, {
        status: status ? toTaskStatus(status) : undefined,
      });
      return toTeamTask(task);
    } catch {
      return { ok: true };
    }
  }
);
app.patch<{ Params: { name: string; id: string }; Body: { owner?: string } }>(
  '/api/teams/:name/tasks/:id/owner',
  async (request) => {
    try {
      const body = request.body ?? {};
      const task = await svc.patchTask(request.params.name, request.params.id, {
        assignee: body.owner ?? null,
      });
      if (task.assignee) {
        svc.dispatchTask(request.params.name, task).catch(() => {});
      }
      return toTeamTask(task);
    } catch {
      return { ok: true };
    }
  }
);
app.patch<{ Params: { name: string; id: string }; Body: Record<string, unknown> }>(
  '/api/teams/:name/tasks/:id/fields',
  async (request) => {
    try {
      const body = request.body ?? {};
      const patch: Record<string, unknown> = {};
      if (body.subject !== undefined) patch.title = body.subject;
      if (body.description !== undefined) patch.description = body.description;
      const task = await svc.patchTask(request.params.name, request.params.id, patch);
      return toTeamTask(task);
    } catch {
      return { ok: true };
    }
  }
);
app.post<{ Params: { name: string; id: string } }>(
  '/api/teams/:name/tasks/:id/start',
  async (request) => {
    try {
      const task = await svc.patchTask(request.params.name, request.params.id, { status: 'doing' });
      if (task.assignee) {
        svc.dispatchTask(request.params.name, task).catch(() => {});
        return { notifiedOwner: true };
      }
      return { notifiedOwner: false };
    } catch {
      return { notifiedOwner: false };
    }
  }
);
app.post<{ Params: { name: string; id: string } }>(
  '/api/teams/:name/tasks/:id/start-by-user',
  async (request) => {
    try {
      const task = await svc.patchTask(request.params.name, request.params.id, { status: 'doing' });
      if (task.assignee) {
        svc.dispatchTask(request.params.name, task).catch(() => {});
        return { notifiedOwner: true };
      }
      return { notifiedOwner: false };
    } catch {
      return { notifiedOwner: false };
    }
  }
);
app.post<{ Params: { name: string; id: string } }>(
  '/api/teams/:name/tasks/:id/soft-delete',
  async (request, reply) => {
    try {
      await svc.patchTask(request.params.name, request.params.id, {
        status: 'done',
        result: '__deleted__',
      });
      return { ok: true };
    } catch (err) {
      return reply.code(404).send(reply500(err));
    }
  }
);
app.post<{ Params: { name: string; id: string } }>(
  '/api/teams/:name/tasks/:id/restore',
  async (request, reply) => {
    try {
      await svc.patchTask(request.params.name, request.params.id, { status: 'todo', result: null });
      return { ok: true };
    } catch (err) {
      return reply.code(404).send(reply500(err));
    }
  }
);
app.get<{ Params: { name: string } }>('/api/teams/:name/deleted-tasks', async (request) => {
  try {
    const tasks = await svc.readTasks(request.params.name);
    return tasks.filter((t) => t.result === '__deleted__').map(toTeamTask);
  } catch {
    return [];
  }
});
app.post<{ Params: { name: string; id: string }; Body: { text?: string } }>(
  '/api/teams/:name/tasks/:id/comments',
  async () => ({ ok: true })
);
app.post<{ Params: { name: string; id: string } }>(
  '/api/teams/:name/tasks/:id/clarification',
  async () => ({ ok: true })
);
app.post<{ Params: { name: string; id: string } }>(
  '/api/teams/:name/tasks/:id/relationships',
  async () => ({ ok: true })
);

// 成员相关 stubs
app.post<{ Params: { name: string } }>('/api/teams/:name/members', async () => ({ ok: true }));
app.delete<{ Params: { name: string; memberName: string } }>(
  '/api/teams/:name/members/:memberName',
  async () => ({ ok: true })
);
app.patch<{ Params: { name: string; memberName: string } }>(
  '/api/teams/:name/members/:memberName/role',
  async () => ({ ok: true })
);
app.post<{ Params: { name: string; memberName: string } }>(
  '/api/teams/:name/members/:memberName/restart',
  async () => ({ ok: true })
);
app.post<{ Params: { name: string; memberName: string } }>(
  '/api/teams/:name/members/:memberName/skip-launch',
  async () => ({ ok: true })
);

// claude logs
app.get<{ Params: { name: string } }>('/api/teams/:name/claude-logs', async () => ({
  logs: [],
  total: 0,
}));

// restore / permanent delete
app.post<{ Params: { name: string } }>('/api/teams/:name/restore', async () => ({ ok: true }));
app.delete<{ Params: { name: string } }>('/api/teams/:name/permanent', async () => ({ ok: true }));

// config operations
async function applyTeamConfigUpdate(
  teamName: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const color = typeof body.color === 'string' ? body.color.trim() : '';
  const agentType = typeof body.agentType === 'string' ? body.agentType.trim() : '';
  const workDir = typeof body.workDir === 'string' ? body.workDir.trim() : '';
  const permissionMode = typeof body.permissionMode === 'string' ? body.permissionMode.trim() : '';
  const language = typeof body.language === 'string' ? body.language.trim() : '';
  const managedSources = typeof body.managedSources === 'string' ? body.managedSources.trim() : '';
  const showContextIndicator =
    typeof body.showContextIndicator === 'boolean' ? body.showContextIndicator : undefined;
  const replyFooter = typeof body.replyFooter === 'boolean' ? body.replyFooter : undefined;
  const injectSender = typeof body.injectSender === 'boolean' ? body.injectSender : undefined;
  const disabledCommands = Array.isArray(body.disabledCommands)
    ? normalizeStringArray(body.disabledCommands)
    : undefined;
  const providerRefs = Array.isArray(body.providerRefs)
    ? normalizeStringArray(body.providerRefs)
    : undefined;
  const platformAllowFrom = body.platformAllowFrom
    ? normalizePlatformAllowFrom(body.platformAllowFrom)
    : undefined;

  const localPatch: Record<string, unknown> = {};
  if (name) localPatch.displayName = name;
  if (description) localPatch.description = description;
  if (color) localPatch.color = color;
  if (agentType) localPatch.harness = agentType;
  if (workDir) localPatch.workDir = workDir;
  if (permissionMode) localPatch.permissionMode = permissionMode;
  if (language) localPatch.language = language;
  if (managedSources) localPatch.managedSources = managedSources;
  if (disabledCommands) localPatch.disabledCommands = disabledCommands;
  if (platformAllowFrom !== undefined) localPatch.platformAllowFrom = platformAllowFrom;
  if (showContextIndicator !== undefined) localPatch.showContextIndicator = showContextIndicator;
  if (replyFooter !== undefined) localPatch.replyFooter = replyFooter;
  if (injectSender !== undefined) localPatch.injectSender = injectSender;

  if (Object.keys(localPatch).length > 0) {
    try {
      await svc.updateTeam(teamName, localPatch);
    } catch {
      // If the team only exists in cc-connect, create Hermit metadata now so displayName can persist.
      const project = await cc.getProject(teamName);
      await svc.createTeam({
        displayName: name || teamName,
        bindProject: teamName,
        harness: agentType || project.agent_type || 'claudecode',
        workDir: workDir || project.work_dir || '',
        color: color || undefined,
        description: description || undefined,
        createCcProject: false,
      });
      await svc.updateTeam(teamName, localPatch);
    }
  }

  const ccPatch: Record<string, unknown> = {};
  if (agentType) ccPatch.agent_type = agentType;
  if (workDir) ccPatch.work_dir = workDir;
  if (permissionMode) ccPatch.mode = permissionMode;
  if (language) ccPatch.language = language;
  if (managedSources) ccPatch.admin_from = managedSources;
  if (disabledCommands) ccPatch.disabled_commands = disabledCommands;
  if (platformAllowFrom !== undefined) ccPatch.platform_allow_from = platformAllowFrom;
  if (showContextIndicator !== undefined) ccPatch.show_context_indicator = showContextIndicator;
  if (replyFooter !== undefined) ccPatch.reply_footer = replyFooter;
  if (injectSender !== undefined) ccPatch.inject_sender = injectSender;

  let ccSyncError: string | null = null;
  if (Object.keys(ccPatch).length > 0) {
    try {
      const updateResult = await cc.updateProject(
        teamName,
        ccPatch as Parameters<CcConnectClient['updateProject']>[1]
      );
      if (updateResult.restart_required) {
        await cc.restart();
      }
    } catch (err) {
      ccSyncError = err instanceof Error ? err.message : String(err);
    }
  }
  if (providerRefs !== undefined) {
    try {
      await cc.setProviderRefs(teamName, providerRefs);
    } catch (err) {
      ccSyncError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    name: name || teamName,
    displayName: name || teamName,
    description: description || undefined,
    color: color || undefined,
    projectPath: workDir || undefined,
    agentType: agentType || undefined,
    permissionMode: permissionMode || undefined,
    language: language || undefined,
    managedSources: managedSources || undefined,
    disabledCommands: disabledCommands ?? [],
    showContextIndicator: showContextIndicator ?? false,
    replyFooter: replyFooter ?? false,
    injectSender: injectSender ?? false,
    platformAllowFrom: platformAllowFrom ?? {},
    providerRefs: providerRefs ?? [],
    ccSyncError,
  };
}

app.get<{ Params: { name: string } }>('/api/teams/:name/config', async (request, reply) => {
  try {
    const name = request.params.name;
    const p = await cc.getProject(name);
    // local metadata overlay
    let color = 'blue';
    let description = '';
    let language = '';
    let managedSources = '*';
    let disabledCommands: string[] = [];
    let showContextIndicator = false;
    let replyFooter = false;
    let injectSender = false;
    let permissionMode = 'default';
    let platformAllowFrom: Record<string, string> = {};
    try {
      const meta = await svc.readTeamManifest(name);
      color = meta.color ?? color;
      description = meta.description ?? description;
      language = meta.language ?? language;
      managedSources = meta.managedSources ?? managedSources;
      disabledCommands = normalizeStringArray(meta.disabledCommands);
      showContextIndicator = meta.showContextIndicator ?? showContextIndicator;
      replyFooter = meta.replyFooter ?? replyFooter;
      injectSender = meta.injectSender ?? injectSender;
      permissionMode = meta.permissionMode ?? permissionMode;
      platformAllowFrom = normalizePlatformAllowFrom(meta.platformAllowFrom);
    } catch {
      /* ok */
    }
    const projectSettings = (p.settings ?? {}) as Record<string, unknown>;
    const resolvedLanguage =
      typeof projectSettings.language === 'string' && projectSettings.language.trim().length > 0
        ? projectSettings.language.trim()
        : language;
    const resolvedManagedSources =
      typeof projectSettings.admin_from === 'string' && projectSettings.admin_from.trim().length > 0
        ? projectSettings.admin_from.trim()
        : managedSources;
    const resolvedDisabledCommands =
      Array.isArray(projectSettings.disabled_commands) &&
      normalizeStringArray(projectSettings.disabled_commands).length > 0
        ? normalizeStringArray(projectSettings.disabled_commands)
        : disabledCommands;
    const resolvedShowContextIndicator =
      typeof projectSettings.show_context_indicator === 'boolean'
        ? projectSettings.show_context_indicator
        : showContextIndicator;
    const resolvedReplyFooter =
      typeof projectSettings.reply_footer === 'boolean'
        ? projectSettings.reply_footer
        : replyFooter;
    const resolvedInjectSender =
      typeof projectSettings.inject_sender === 'boolean'
        ? projectSettings.inject_sender
        : injectSender;
    const resolvedPlatformAllowFrom = (() => {
      const normalized = normalizePlatformAllowFrom(projectSettings.platform_allow_from);
      if (Object.keys(normalized).length > 0) {
        return normalized;
      }
      return platformAllowFrom;
    })();
    const resolvedPermissionMode =
      typeof p.agent_mode === 'string' && p.agent_mode.trim().length > 0
        ? p.agent_mode.trim()
        : permissionMode;
    const [providerRefs, globalProviders] = await Promise.all([
      cc.getProviderRefs(name).catch(() => []),
      cc.listProviders().catch(() => []),
    ]);
    return {
      name,
      color,
      projectPath: p.work_dir ?? '',
      description,
      agentType: p.agent_type,
      workDir: p.work_dir ?? '',
      language: resolvedLanguage,
      managedSources: resolvedManagedSources,
      disabledCommands: resolvedDisabledCommands,
      showContextIndicator: resolvedShowContextIndicator,
      replyFooter: resolvedReplyFooter,
      injectSender: resolvedInjectSender,
      permissionMode: resolvedPermissionMode,
      platformAllowFrom: resolvedPlatformAllowFrom,
      providerRefs,
      globalProviders,
      settings: {
        ...projectSettings,
        language: resolvedLanguage,
        admin_from: resolvedManagedSources,
        disabled_commands: resolvedDisabledCommands,
        show_context_indicator: resolvedShowContextIndicator,
        reply_footer: resolvedReplyFooter,
        inject_sender: resolvedInjectSender,
        platform_allow_from: resolvedPlatformAllowFrom,
      },
    };
  } catch {
    return reply.code(404).send({ error: 'not found' });
  }
});
app.patch<{ Params: { name: string } }>('/api/teams/:name/config', async (request, reply) => {
  try {
    const data = await applyTeamConfigUpdate(
      request.params.name,
      (request.body as Record<string, unknown>) ?? {}
    );
    return data;
  } catch (err) {
    return reply.code(400).send(reply500(err));
  }
});

// provisioning stubs (新版无 provisioning 概念)
app.post('/api/teams/provisioning/prepare', async () => ({
  runId: null,
  warnings: [],
}));
app.get<{ Params: { runId: string } }>('/api/teams/provisioning/:runId', async () => ({
  runId: '',
  phase: 'done',
  progress: 100,
  message: '',
  done: true,
  error: null,
}));
app.post<{ Params: { runId: string } }>('/api/teams/provisioning/:runId/cancel', async () => ({
  ok: true,
}));

// 团队创建已由上方 /api/teams/create 处理（cc-connect 直接调用）

// templates stubs
app.get('/api/teams/templates', async () => ({ sources: [], templates: [] }));
app.post('/api/teams/templates/save', async () => ({ sources: [], templates: [] }));
app.post('/api/teams/templates/refresh', async () => ({ sources: [], templates: [] }));

// replace members
app.put<{ Params: { name: string } }>('/api/teams/:name/members', async () => ({ ok: true }));

// draft
app.delete<{ Params: { name: string } }>('/api/teams/:name/draft', async () => ({ ok: true }));

// send-message — 从 Hermit 会话面板注入到 harness，不使用 Management /send（那会回发到 IM）。
app.post<{
  Params: { name: string };
  Body: {
    member?: string;
    text?: string;
    content?: string;
    summary?: string;
    sessionKey?: string;
    messageId?: string;
  };
}>('/api/teams/:name/send-message', async (request, reply) => {
  const teamName = request.params.name;
  const text = request.body?.text ?? request.body?.content ?? '';
  if (!text.trim()) return { ok: true, messageId: null };

  const requestedMessageId =
    typeof request.body?.messageId === 'string' ? request.body.messageId.trim() : '';
  const msgId =
    requestedMessageId || `hermit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const crossTeamDirective = text.trim().match(/^@([^\s]+)\s+([\s\S]+)$/);
  if (crossTeamDirective) {
    const targetTeam = await resolveTeamSlugForMention(crossTeamDirective[1] ?? '');
    const subject = crossTeamDirective[2]?.trim();
    if (targetTeam && subject && targetTeam !== teamName) {
      try {
        const sourceMsg = await svc.appendMessage(teamName, {
          from: 'user',
          to: targetTeam,
          role: 'user',
          content: text,
          meta: { source: CROSS_TEAM_SENT_SOURCE },
        });
        const result = await taskDispatch.dispatchTask(
          teamName,
          {
            subject,
            description: text,
            prompt: subject,
          },
          targetTeam,
          { deadlineMinutes: 10, needsHumanReview: true }
        );
        broadcastSse('team-change', { type: 'inbox', teamName });
        broadcastSse('collab-change', {
          dispatchId: result.dispatchId,
          status: result.status,
          fromTeam: teamName,
          toTeam: targetTeam,
        });
        return {
          ok: result.status !== 'failed',
          deliveredToInbox: true,
          messageId: sourceMsg.id,
          dispatchId: result.dispatchId,
          status: result.status,
          message: result.message,
          runtimeDelivery: {
            attempted: true,
            delivered: result.status !== 'failed',
          },
        };
      } catch (err) {
        request.log.warn({ err, teamName, targetTeam }, 'cross-team directive dispatch failed');
      }
    }
  }

  // 使用固定格式 session key，保证 reply 事件能正确映射回 teamName。
  // UI 消息先落盘并广播，bridge 投递放后台执行，避免 bridge 重连窗口卡住发送按钮。
  const requestedSessionKey =
    typeof request.body?.sessionKey === 'string' ? request.body.sessionKey.trim() : '';
  const sessionKey = requestedSessionKey || buildFallbackSessionKey(teamName);

  // 本地存储用户消息
  const userMsg = await svc
    .appendMessage(teamName, {
      from: 'user',
      to: teamName,
      role: 'user',
      content: text,
      meta: { sessionKey },
    })
    .catch(() => null);

  // 广播 SSE 让前端触发消息刷新
  broadcastSse('team-change', { type: 'inbox', teamName });

  const bridgeWasConnected = bridge.connected;
  void sendHarnessMessageViaBridge({
    teamName,
    text,
    sessionKey,
    msgId,
  }).catch((err) => {
    request.log.warn({ err, teamName, sessionKey }, 'send-message bridge delivery failed');
    broadcastSse('team-change', { type: 'inbox', teamName });
  });

  return {
    ok: true,
    deliveredToInbox: true,
    messageId: userMsg?.id ?? msgId,
    runtimeDelivery: {
      attempted: true,
      delivered: bridgeWasConnected,
    },
  };
});

// ===========================================================================
// 路由别名 — 修正前端调用路径与服务端路径的不匹配
// ===========================================================================

// requestReview: 前端调用 /tasks/:id/review，服务端原路由是 /tasks/:id/request-review
app.post<{ Params: { name: string; id: string } }>(
  '/api/teams/:name/tasks/:id/review',
  async (request) => {
    try {
      const task = await svc.patchTask(request.params.name, request.params.id, { status: 'done' });
      return { ok: true, data: toTeamTask(task) };
    } catch {
      return { ok: true };
    }
  }
);

// updateKanban: 前端调用 PATCH /kanban/:taskId
app.patch<{ Params: { name: string; id: string }; Body: Record<string, unknown> }>(
  '/api/teams/:name/kanban/:id',
  async () => ({ ok: true })
);

// updateKanbanColumnOrder: 前端调用 PUT /kanban/column-order
app.put<{ Params: { name: string } }>('/api/teams/:name/kanban/column-order', async () => ({
  ok: true,
}));

// updateConfig: 前端调用 PUT /config（服务端原有 PATCH，补充 PUT 别名）
app.put<{ Params: { name: string } }>('/api/teams/:name/config', async (request, reply) => {
  try {
    const data = await applyTeamConfigUpdate(
      request.params.name,
      (request.body as Record<string, unknown>) ?? {}
    );
    return data;
  } catch (err) {
    return reply.code(400).send(reply500(err));
  }
});

// skipMemberForLaunch: 前端调用 /members/:memberName/skip
app.post<{ Params: { name: string; memberName: string } }>(
  '/api/teams/:name/members/:memberName/skip',
  async () => ({ ok: true })
);

// setTaskClarification: 前端调用 POST /task-clarification/:taskId
app.post<{ Params: { name: string; taskId: string } }>(
  '/api/teams/:name/task-clarification/:taskId',
  async () => ({ ok: true })
);

// removeTaskRelationship: 前端调用 DELETE /tasks/:id/relationships
app.delete<{ Params: { name: string; id: string } }>(
  '/api/teams/:name/tasks/:id/relationships',
  async () => ({ ok: true })
);

// ===========================================================================
// 缺失的 stub 路由 — 返回空数据防止前端 404 崩溃
// ===========================================================================

// createConfig
app.post('/api/teams/config', async () => ({ ok: true }));

// kill-process
app.post<{ Params: { name: string }; Body: { pid?: number } }>(
  '/api/teams/:name/kill-process',
  async () => ({ ok: true })
);

// member-logs
app.get<{ Params: { name: string; memberName: string } }>(
  '/api/teams/:name/member-logs/:memberName',
  async () => []
);

// task-logs
app.get<{ Params: { name: string; taskId: string } }>(
  '/api/teams/:name/task-logs/:taskId',
  async () => []
);

// activity
app.get<{ Params: { name: string } }>('/api/teams/:name/activity', async () => []);

// task-activity-detail
app.get<{ Params: { name: string } }>('/api/teams/:name/task-activity-detail', async () => ({
  entries: [],
}));

// task-log-stream-summary
app.get<{ Params: { name: string; taskId: string } }>(
  '/api/teams/:name/task-log-stream-summary/:taskId',
  async () => ({ chunks: [] })
);

// task-log-stream
app.get<{ Params: { name: string; taskId: string } }>(
  '/api/teams/:name/task-log-stream/:taskId',
  async () => ({ chunks: [] })
);

// exact-log-summaries
app.get<{ Params: { name: string; taskId: string } }>(
  '/api/teams/:name/exact-log-summaries/:taskId',
  async () => ({ logs: [] })
);

// exact-log-detail
app.get<{ Params: { name: string; taskId: string } }>(
  '/api/teams/:name/exact-log-detail/:taskId',
  async () => ({ lines: [] })
);

// member-stats
app.get<{ Params: { name: string; memberName: string } }>(
  '/api/teams/:name/member-stats/:memberName',
  async () => ({
    linesAdded: 0,
    linesRemoved: 0,
    filesTouched: [],
    fileStats: {},
    toolUsage: {},
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0,
    tasksCompleted: 0,
    messageCount: 0,
    totalDurationMs: 0,
    sessionCount: 0,
    computedAt: new Date().toISOString(),
  })
);

// tool-approval stubs
app.post<{ Params: { name: string } }>('/api/teams/:name/tool-approval/respond', async () => ({
  ok: true,
}));
app.post<{ Params: { name: string } }>('/api/teams/:name/tool-approval/settings', async () => ({
  ok: true,
}));
app.post('/api/teams/tool-approval/read-file', async () => ({ content: '' }));

// validate-cli-args
app.post('/api/teams/validate-cli-args', async () => ({ valid: true, args: [], errors: [] }));

// cross-team task dispatch endpoints
// Agent collaboration: accept a task request
app.post<{
  Body: { team_slug: string; dispatch_id: string };
}>('/api/cross-team/accept', async (request) => {
  const { team_slug, dispatch_id } = request.body ?? {};
  if (!team_slug || !dispatch_id) {
    return { ok: false, error: 'team_slug and dispatch_id are required' };
  }
  try {
    const result = await taskDispatch.acceptTask(team_slug, dispatch_id);
    return { ok: true, taskId: result.taskId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
});

// Agent collaboration: reject a task request
app.post<{
  Body: { team_slug: string; dispatch_id: string; reason?: string };
}>('/api/cross-team/reject', async (request) => {
  const { team_slug, dispatch_id, reason } = request.body ?? {};
  if (!team_slug || !dispatch_id) {
    return { ok: false, error: 'team_slug and dispatch_id are required' };
  }
  try {
    await taskDispatch.rejectTask(team_slug, dispatch_id, reason);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
});

app.get<{ Querystring: { excludeTeam?: string } }>('/api/cross-team/targets', async (request) => {
  const excludeTeam = request.query.excludeTeam;
  const all = await taskDispatch.discoverTeams();
  const teams = excludeTeam ? all.filter((t) => t.slug !== excludeTeam) : all;
  return teams.map((t) => ({
    teamName: t.slug,
    displayName: t.displayName || t.slug,
    description: t.description,
    color: undefined,
    isOnline: t.status === 'online',
    location: t.location,
    harness: t.harness,
  }));
});

app.get<{ Params: { name: string } }>('/api/cross-team/outbox/:name', async (request) => {
  const teamSlug = request.params.name;
  const tasks = await svc.readTasks(teamSlug);
  const pending = tasks.filter(
    (t: any) => t.dispatchMeta?.status === 'dispatched' && t.dispatchMeta?.originTeam === teamSlug
  );
  return { pending };
});

// Agent collaboration: discover teams with capabilities
app.get('/api/cross-team/discover', async () => {
  const teams = await taskDispatch.discoverTeams();
  return { teams };
});

// Agent collaboration: pending handshake requests for a team
app.get<{ Params: { name: string } }>('/api/cross-team/pending-requests/:name', async (request) => {
  const teamSlug = request.params.name;
  const requests = taskDispatch.listPendingRequests(teamSlug);
  return { requests };
});

// Agent collaboration: deliver task result
app.post<{
  Body: { team_slug: string; dispatch_id: string; result: string };
}>('/api/cross-team/deliver', async (request) => {
  const { team_slug, dispatch_id, result } = request.body ?? {};
  if (!team_slug || !dispatch_id || !result) {
    return { ok: false, error: 'team_slug, dispatch_id, and result are required' };
  }
  try {
    const res = await taskDispatch.deliverTask(team_slug, dispatch_id, result);
    return res;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
});

// Agent collaboration: approve task result
app.post<{
  Body: { team_slug: string; dispatch_id: string };
}>('/api/cross-team/approve', async (request) => {
  const { team_slug, dispatch_id } = request.body ?? {};
  if (!team_slug || !dispatch_id) {
    return { ok: false, error: 'team_slug and dispatch_id are required' };
  }
  try {
    const res = await taskDispatch.approveTask(team_slug, dispatch_id);
    return res;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
});

// Agent collaboration: reject (request revision) task result
app.post<{
  Body: { team_slug: string; dispatch_id: string; feedback: string };
}>('/api/cross-team/revision', async (request) => {
  const { team_slug, dispatch_id, feedback } = request.body ?? {};
  if (!team_slug || !dispatch_id || !feedback) {
    return { ok: false, error: 'team_slug, dispatch_id, and feedback are required' };
  }
  try {
    const res = await taskDispatch.rejectResult(team_slug, dispatch_id, feedback);
    return res;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
});

// Collaboration board: list all collab tasks
app.get('/api/collab/board', async () => {
  return { tasks: taskDispatch.getCollabBoard() };
});

// Collaboration board: get single collab task
app.get<{ Params: { dispatchId: string } }>('/api/collab/board/:dispatchId', async (request) => {
  const task = taskDispatch.getCollabTask(request.params.dispatchId);
  if (!task) return { ok: false, error: 'Not found' };
  return { task };
});

app.get<{ Params: { dispatchId: string } }>(
  '/api/collab/board/:dispatchId/events',
  async (request) => {
    return { events: taskDispatch.getCollabTaskEvents(request.params.dispatchId) };
  }
);

// Update /api/cross-team/send to support needsHumanReview
app.post<{
  Body: {
    fromTeam: string;
    fromMember?: string;
    toTeam: string;
    text?: string;
    subject?: string;
    description?: string;
    prompt?: string;
    messageId?: string;
    sessionKey?: string;
    conversationId?: string;
    replyToConversationId?: string;
    taskRefs?: unknown[];
    actionMode?: string;
    summary?: string;
    chainDepth?: number;
    deadlineMinutes?: number;
    needsHumanReview?: boolean;
  };
}>('/api/cross-team/send', async (request) => {
  const {
    fromTeam,
    fromMember,
    toTeam,
    text,
    subject,
    description,
    prompt,
    messageId,
    sessionKey,
    conversationId,
    replyToConversationId,
    taskRefs,
    actionMode,
    summary,
    chainDepth,
    deadlineMinutes,
    needsHumanReview,
  } = request.body ?? {};
  if (!fromTeam || !toTeam) return { ok: false, error: 'fromTeam and toTeam are required' };
  const resolvedToTeam = await resolveTeamSlugForMention(toTeam);
  if (!resolvedToTeam) return { ok: false, error: `Unknown target team: ${toTeam}` };

  if (typeof text === 'string') {
    const trimmedText = text.trim();
    if (!trimmedText) return { ok: false, error: 'text is required' };

    const depth = Number.isFinite(Number(chainDepth)) ? Number(chainDepth) : 0;
    const threadId = conversationId || messageId || `cross-team-${Date.now()}`;
    const sender = fromMember || 'user';
    const fromSessionKey =
      typeof sessionKey === 'string' && sessionKey.trim().length > 0
        ? sessionKey.trim()
        : buildFallbackSessionKey(fromTeam);
    const toSessionKey = buildFallbackSessionKey(resolvedToTeam);
    const sentText = formatCrossTeamText(`${fromTeam}.${sender}`, depth, trimmedText, {
      conversationId: threadId,
      replyToConversationId,
    });
    const meta = {
      taskRefs,
      actionMode,
      summary,
      conversationId: threadId,
      replyToConversationId,
      chainDepth: depth,
    };

    const outgoing = await svc.appendMessage(fromTeam, {
      from: `${fromTeam}.${sender}`,
      to: resolvedToTeam,
      role: 'user',
      content: trimmedText,
      meta: { ...meta, source: CROSS_TEAM_SENT_SOURCE, sessionKey: fromSessionKey },
    });

    await svc.appendMessage(resolvedToTeam, {
      from: `${fromTeam}.${sender}`,
      to: resolvedToTeam,
      role: 'user',
      content: sentText,
      meta: {
        ...meta,
        source: CROSS_TEAM_SOURCE,
        relayOfMessageId: outgoing.id,
        sessionKey: toSessionKey,
      },
    });

    const existingTasks = await svc.readTasks(resolvedToTeam).catch(() => []);
    const existingTask = existingTasks.find((task) => task.dispatchMeta?.dispatchId === threadId);
    if (!existingTask) {
      const now = new Date().toISOString();
      await svc.createTask(resolvedToTeam, {
        title: summary || trimmedText.split(/\r?\n/, 1)[0]?.slice(0, 120) || '跨团队 @ 消息',
        description: trimmedText,
        status: 'todo',
        dispatchMeta: {
          dispatchId: threadId,
          originTeam: fromTeam,
          targetTeam: resolvedToTeam,
          status: 'pending_accept',
          dispatchedAt: now,
          receivedAt: now,
        },
      });
    }

    broadcastSse('team-change', { type: 'inbox', teamName: fromTeam });
    broadcastSse('team-change', { type: 'inbox', teamName: resolvedToTeam });
    broadcastSse('team-change', { type: 'task', teamName: resolvedToTeam });

    void sendHarnessMessageViaBridge({
      teamName: resolvedToTeam,
      text: sentText,
    }).catch((err) => {
      request.log.warn({ err }, 'cross-team runtime delivery failed after persistence');
    });

    return {
      messageId: outgoing.id,
      deliveredToInbox: true,
      deduplicated: false,
    };
  }

  if (!subject) return { ok: false, error: 'subject is required' };

  const sentMessage = await svc.appendMessage(fromTeam, {
    from: fromMember ? `${fromTeam}.${fromMember}` : 'user',
    to: resolvedToTeam,
    role: 'user',
    content: `@${resolvedToTeam} ${subject}`,
    meta: {
      source: CROSS_TEAM_SENT_SOURCE,
      sessionKey,
      clientMessageId: messageId,
    },
  });
  broadcastSse('team-change', { type: 'inbox', teamName: fromTeam });

  // Check collaboration toggle
  try {
    const configPath = path.join(os.homedir(), '.hermit', 'settings.json');
    const raw = await fs.readFile(configPath, 'utf-8');
    const settings = JSON.parse(raw);
    if (!settings.taskBus?.collaboration) {
      return {
        ok: false,
        error: 'Distributed collaboration is not enabled. Enable it in Settings → Task Bus.',
      };
    }
  } catch {
    return { ok: false, error: 'Could not read task bus configuration.' };
  }

  const result = await taskDispatch.dispatchTask(
    fromTeam ?? 'unknown',
    { subject, description, prompt },
    resolvedToTeam,
    {
      deadlineMinutes: deadlineMinutes ? Number(deadlineMinutes) : undefined,
      needsHumanReview,
    }
  );
  const ok = result.status !== 'failed';
  if (ok) {
    broadcastSse('team-change', { type: 'inbox', teamName: resolvedToTeam });
    void sendHarnessMessageViaBridge({
      teamName: resolvedToTeam,
      text: `[跨团队任务] ${fromTeam} 派发了任务：${subject}${description ? `\n\n${description}` : ''}`,
    }).catch((err) => {
      request.log.warn(
        { err, fromTeam, resolvedToTeam },
        'cross-team task runtime delivery failed'
      );
    });
  }
  return {
    ok,
    messageId: sentMessage.id,
    dispatchId: result.dispatchId,
    status: result.status,
    message: result.message,
  };
});

// GET /api/settings/task-bus → full config including telemetry
app.get('/api/settings/task-bus', async () => {
  const configPath = path.join(os.homedir(), '.hermit', 'settings.json');
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    const settings = JSON.parse(raw);
    return (
      settings.taskBus ?? {
        enabled: false,
        redis: { host: '127.0.0.1', port: 6379 },
        telemetry: { enabled: false, platform: 'claudecode' },
      }
    );
  } catch {
    return {
      enabled: false,
      redis: { host: '127.0.0.1', port: 6379 },
      telemetry: { enabled: false, platform: 'claudecode' },
    };
  }
});

// PUT /api/settings/task-bus → save config + start/stop telemetry
app.put<{ Body: TaskBusConfig }>('/api/settings/task-bus', async (request) => {
  const config = (
    request.body && 'taskBus' in (request.body as unknown as Record<string, unknown>)
      ? (request.body as unknown as { taskBus: TaskBusConfig }).taskBus
      : request.body
  ) as TaskBusConfig;
  const configPath = path.join(os.homedir(), '.hermit', 'settings.json');
  let settings: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    settings = JSON.parse(raw);
  } catch {
    // File doesn't exist yet
  }
  settings.taskBus = config;
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(settings, null, 2));

  // Sync telemetry service
  if (config.telemetry?.enabled) {
    await startTelemetry(config);
  } else {
    await stopTelemetry();
  }

  // Keep CLAUDE.md team instructions aligned with the collaboration toggle.
  const syncTeamInstructions = async (enabled: boolean): Promise<void> => {
    const projects = await cc.listProjects();
    for (const p of projects) {
      let workDir = '';
      let slug = p.name;
      try {
        const meta = await svc.readTeamManifest(p.name);
        if (typeof meta.workDir === 'string') workDir = meta.workDir.trim();
        if (meta.slug) slug = meta.slug;
      } catch {
        /* no local manifest */
      }
      if (!workDir) {
        try {
          const detail = await cc.getProject(p.name);
          if (typeof detail.work_dir === 'string') workDir = detail.work_dir.trim();
        } catch {
          // ignore
        }
      }
      if (!workDir) continue;
      if (enabled) {
        await svc.injectTeamInstructions(workDir, slug);
      } else {
        await svc.removeTeamInstructions(workDir);
      }
    }
  };

  const collaborationEnabled = config?.enabled === true && config?.collaboration === true;
  try {
    await syncTeamInstructions(collaborationEnabled);
  } catch (err) {
    request.log.warn({ err }, 'CLAUDE.md team instruction sync failed');
  }

  if (config?.enabled) {
    // Reconnect TaskDispatchService with Redis (optional)
    taskDispatch.dispose();
    try {
      await taskDispatch.start(config);
      return {
        ok: true,
        connected: true,
        message: `Redis 连接成功，分布式派发已启用`,
      };
    } catch {
      return {
        ok: true,
        connected: false,
        message: `Redis 连接失败，仅本地派发`,
      };
    }
  }

  taskDispatch.dispose();
  return { ok: true, connected: false, message: 'Task bus disabled' };
});

// POST /api/telemetry/scan → trigger manual scan
app.post('/api/telemetry/scan', async (request, reply) => {
  try {
    const configPath = path.join(os.homedir(), '.hermit', 'settings.json');
    let settings: Record<string, unknown> = {};
    try {
      const raw = await fs.readFile(configPath, 'utf-8');
      settings = JSON.parse(raw);
    } catch {
      // no settings
    }
    const taskBus = (settings.taskBus ?? {}) as TaskBusConfig;
    if (!taskBus.telemetry?.enabled) {
      return reply.code(400).send({ error: 'Telemetry is not enabled' });
    }
    const result = await triggerScan(taskBus);
    if (!result) {
      return reply.code(503).send({ error: 'Telemetry scan failed' });
    }
    return {
      ok: true,
      connected: taskBus.telemetry.uploadEnabled === true,
      lastScan: new Date().toISOString(),
      sessions: result.aggregate.sessions,
      messages: result.aggregate.messages,
      tokensIn: result.aggregate.tokens.input,
      tokensOut: result.aggregate.tokens.output,
      cacheRead: result.aggregate.tokens.cacheRead,
      cacheCreation: result.aggregate.tokens.cacheCreation,
      activeDays: result.aggregate.activeDays,
      hourly: result.aggregate.hourly,
      projects: result.aggregate.projects,
      workSecondsByDay: result.aggregate.workSecondsByDay,
    };
  } catch (err) {
    return reply.code(500).send({ error: String(err) });
  }
});

// GET /api/telemetry/status → current telemetry status (full stats)
app.get('/api/telemetry/status', async (request, reply) => {
  try {
    const configPath = path.join(os.homedir(), '.hermit', 'settings.json');
    let settings: Record<string, unknown> = {};
    try {
      const raw = await fs.readFile(configPath, 'utf-8');
      settings = JSON.parse(raw);
    } catch {
      // no settings
    }
    const taskBus = (settings.taskBus ?? {}) as TaskBusConfig;
    const redisCfg = taskBus.enabled ? taskBus.redis : undefined;
    const status = await getTelemetryStatus(redisCfg);
    return (
      status ?? {
        connected: false,
        lastScan: null,
        sessions: 0,
        messages: 0,
        tokensIn: 0,
        tokensOut: 0,
        cacheRead: 0,
        cacheCreation: 0,
        activeDays: 0,
        hourly: [],
        projects: [],
        workSecondsByDay: {},
      }
    );
  } catch {
    return {
      connected: false,
      lastScan: null,
      sessions: 0,
      messages: 0,
      tokensIn: 0,
      tokensOut: 0,
      cacheRead: 0,
      cacheCreation: 0,
      activeDays: 0,
      hourly: [],
      projects: [],
      workSecondsByDay: {},
    };
  }
});

app.get<{ Params: { name: string; memberName: string } }>(
  '/api/teams/:name/review/agent-changes/:memberName',
  async (request) => ({
    teamName: request.params.name,
    memberName: request.params.memberName,
    files: [],
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
    totalFiles: 0,
    computedAt: new Date().toISOString(),
  })
);
app.get<{ Params: { name: string; taskId: string } }>(
  '/api/teams/:name/review/task-changes/:taskId',
  async () => ({ changes: [] })
);
app.get<{ Params: { name: string; memberName: string } }>(
  '/api/teams/:name/review/change-stats/:memberName',
  async () => ({ stats: {} })
);
app.get<{ Params: { name: string } }>('/api/teams/:name/review/file-content', async () => ({
  content: '',
}));
app.post<{ Params: { name: string } }>('/api/teams/:name/review/apply-decisions', async () => ({
  ok: true,
}));
app.post('/api/teams/review/check-conflict', async () => ({ conflict: false }));
app.post('/api/teams/review/preview-reject', async () => ({ preview: '' }));
app.post('/api/teams/review/save-edited-file', async () => ({ ok: true }));
app.post('/api/teams/review/decisions/load', async () => ({ decisions: {} }));
app.post('/api/teams/review/decisions/save', async () => ({ ok: true }));
app.post('/api/teams/review/decisions/clear', async () => ({ ok: true }));
app.get('/api/teams/review/git-file-log', async () => ({ log: [] }));

// ===========================================================================
// SSE 推送端点 — 前端 EventSource 连接此处接收实时事件
// ===========================================================================

app.get('/api/events', (request, reply) => {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const client: SseClient = {
    res: reply.raw,
    id: `sse-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  };
  sseClients.add(client);

  // 握手
  reply.raw.write(`event: hello\ndata: {"ok":true}\n\n`);

  // keep-alive
  const ka = setInterval(() => {
    try {
      reply.raw.write(': keep-alive\n\n');
    } catch {
      clearInterval(ka);
      sseClients.delete(client);
    }
  }, 15_000);

  request.raw.on('close', () => {
    clearInterval(ka);
    sseClients.delete(client);
  });

  return reply.hijack();
});

const SSE_FALLBACK_RE = /^\/api\/(.*\/(events|stream|notifications\/stream))$/;

app.get('/api/extensions/mcp/browse', async () => ({
  servers: [],
  items: [],
}));

app.setNotFoundHandler((request, reply) => {
  const u = request.url;
  if (!u.startsWith('/api/')) {
    const pathname = u.split('?')[0] ?? '/';
    const hasFileExtension = /\.[^/]+$/.test(pathname);
    const indexPath = path.join(STATIC_DIR, 'index.html');
    if (
      (request.method === 'GET' || request.method === 'HEAD') &&
      !hasFileExtension &&
      _existsSync2(indexPath)
    ) {
      return reply.type('text/html; charset=utf-8').send(readFileSync(indexPath, 'utf-8'));
    }
    return reply.code(404).type('text/plain').send('not found');
  }

  if (request.method === 'GET' && SSE_FALLBACK_RE.test(u)) {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(`event: hello\ndata: {"ok":true}\n\n`);
    const ka = setInterval(() => {
      try {
        reply.raw.write(': keep-alive\n\n');
      } catch {
        clearInterval(ka);
      }
    }, 15000);
    request.raw.on('close', () => clearInterval(ka));
    return reply.hijack();
  }

  if (request.method === 'GET') return [];
  return { ok: true };
});

// ===========================================================================
// Static resources(vite build 产物)— 必须最后注册,放在 setNotFoundHandler 之后
// ===========================================================================

import { existsSync } from 'node:fs';
if (existsSync(STATIC_DIR)) {
  await app.register(staticPlugin, {
    root: STATIC_DIR,
    prefix: '/',
    decorateReply: false,
  });
} else {
  app.get('/', async (request, reply) => {
    if (request.url.startsWith('/api/')) return;
    reply
      .code(503)
      .type('text/plain')
      .send(`UI not built. Run: pnpm build:web (output → ${STATIC_DIR})`);
  });
}

// ===========================================================================
// Helpers
// ===========================================================================

function reply500(err: unknown) {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

// ===========================================================================
// Start
// ===========================================================================

// 启动 cc-connect Bridge WebSocket 连接(注册 platform=hermit adapter)
bridge.start();
await initializeTaskBusFromSettings();

try {
  await app.listen({ host: HOST, port: PORT });
  app.log.info(
    `cc-connect:           ${process.env.CC_CONNECT_BASE_URL ?? 'http://127.0.0.1:9820'}`
  );
  app.log.info(
    `bridge:               ${process.env.CC_CONNECT_BRIDGE_URL ?? 'ws://127.0.0.1:9810/bridge/ws'}`
  );
  app.log.info(`static:               ${STATIC_DIR}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// graceful shutdown
const shutdown = async () => {
  try {
    bridge.dispose?.();
    await app.close();
    process.exit(0);
  } catch {
    process.exit(1);
  }
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
