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

import { existsSync as _existsSync2, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import Fastify from 'fastify';

import { CcConnectBridge } from './services/ccConnect/CcConnectBridge';
import { CcConnectClient } from './services/ccConnect/CcConnectClient';
import { TeamProvisioningService } from './services/teams-mvp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number.parseInt(process.env.PORT ?? '5680', 10);
const STATIC_DIR = process.env.STATIC_DIR ?? path.resolve(REPO_ROOT, 'dist-renderer');

// ===========================================================================
// Hermit runtime config — ~/.hermit/config.json
// Priority: file > env vars > defaults
// ===========================================================================

const HERMIT_HOME = process.env.HERMIT_HOME ?? path.join(os.homedir(), '.hermit');
const HERMIT_CONFIG_FILE = path.join(HERMIT_HOME, 'config.json');

interface HermitConfig {
  ccBaseUrl: string;
  ccToken: string;
  ccBridgeUrl: string;
}

function loadConfig(): HermitConfig {
  const defaults: HermitConfig = {
    ccBaseUrl: process.env.CC_CONNECT_BASE_URL ?? 'http://127.0.0.1:9820',
    ccToken: process.env.CC_CONNECT_TOKEN ?? process.env.CC_CONNECT_MANAGEMENT_TOKEN ?? '',
    ccBridgeUrl: process.env.CC_CONNECT_BRIDGE_URL ?? 'ws://127.0.0.1:9810/bridge/ws',
  };
  try {
    if (_existsSync2(HERMIT_CONFIG_FILE)) {
      const raw = JSON.parse(readFileSync(HERMIT_CONFIG_FILE, 'utf-8')) as Partial<HermitConfig>;
      return { ...defaults, ...raw };
    }
  } catch {
    /* ignore parse errors */
  }
  return defaults;
}

function saveConfig(patch: Partial<HermitConfig>): HermitConfig {
  const current = loadConfig();
  const next = { ...current, ...patch };
  mkdirSync(HERMIT_HOME, { recursive: true });
  writeFileSync(HERMIT_CONFIG_FILE, JSON.stringify(next, null, 2), 'utf-8');
  return next;
}

// Mutable runtime config — updated via /api/hermit-config POST
let runtimeConfig = loadConfig();

const cc = new CcConnectClient({
  baseUrl: runtimeConfig.ccBaseUrl,
  token: runtimeConfig.ccToken,
  bridgeUrl: runtimeConfig.ccBridgeUrl,
});
const bridge = new CcConnectBridge();
const svc = new TeamProvisioningService(cc, bridge);

const app = Fastify({ logger: { level: 'info' } });

// ===========================================================================
// Plugins
// ===========================================================================

await app.register(cors, {
  origin: process.env.CORS_ORIGIN?.split(',') ?? true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
});

// ===========================================================================
// /api/cc/*  →  cc-connect /api/v1/*  (proxy with token)
// ===========================================================================

app.all('/api/cc/*', async (request, reply) => {
  const baseUrl = runtimeConfig.ccBaseUrl.replace(/\/+$/, '');
  const token = runtimeConfig.ccToken;

  const url = request.url; // e.g. /api/cc/projects?foo=1
  const subPath = url.replace(/^\/api\/cc/, '') || '/';
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
  reply
    .code(upstream.status)
    .header(
      'Content-Type',
      upstream.headers.get('content-type') ?? 'application/json; charset=utf-8'
    )
    .send(body);
});

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

  return {
    ok: true,
    data: { ccBaseUrl: runtimeConfig.ccBaseUrl, ccTokenSet: runtimeConfig.ccToken.length > 0 },
  };
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
// Teams (hermit-managed)
// ===========================================================================

app.get('/api/teams', async () => {
  // 适配 hermit 主仓 TeamSummary[] 形态(直接数组)
  const teams = await svc.listTeams();
  const palette = ['blue', 'saffron', 'turquoise', 'brick', 'indigo', 'forest', 'apricot', 'rose'];
  return await Promise.all(
    teams.map(async (t, ti) => {
      let taskCount = 0;
      try {
        const tasks = await svc.readTasks(t.slug);
        taskCount = tasks.length;
      } catch {
        // ignore
      }
      return {
        teamName: t.slug,
        displayName: t.displayName,
        description: '',
        color: palette[ti % palette.length],
        memberCount: t.members.length,
        members: t.members.map((m, mi) => ({
          name: m.name,
          role: m.role || 'worker',
          agentId: m.bindProject ?? undefined,
          color: palette[mi % palette.length],
        })),
        taskCount,
        lastActivity: null,
        projectPath: t.rootPath,
        projectPathHistory: [t.rootPath],
      };
    })
  );
});

app.post<{
  Body: {
    displayName: string;
    members: Array<{ name: string; bindProject: string; role?: string; systemPrompt?: string }>;
  };
}>('/api/teams', async (request, reply) => {
  const body = request.body;
  if (!body?.displayName) return reply.code(400).send({ ok: false, error: 'displayName required' });
  if (!Array.isArray(body.members) || body.members.length === 0) {
    return reply.code(400).send({ ok: false, error: 'at least one member required' });
  }
  for (const m of body.members) {
    if (!m.name) return reply.code(400).send({ ok: false, error: 'member.name required' });
    if (!m.bindProject) {
      return reply.code(400).send({ ok: false, error: `member ${m.name} 需要 bindProject` });
    }
  }
  const created = await svc.createTeam({
    displayName: body.displayName,
    members: body.members,
  });
  await svc.launchTeam(created.slug);
  return { ok: true, team: created.manifest };
});

app.post<{ Params: { slug: string } }>('/api/teams/:slug/stop', async (request) => {
  const r = await svc.stopTeam(request.params.slug);
  return { ok: true, ...r };
});

app.get<{ Params: { slug: string }; Querystring: { limit?: string } }>(
  '/api/teams/:slug/messages',
  async (request) => {
    const limit = parseInt(request.query.limit ?? '200', 10);
    const messages = await svc.listGroupMessages(request.params.slug, { limit });
    return { ok: true, messages };
  }
);

// ===========================================================================
// Group send (SSE)
// ===========================================================================

app.post<{
  Params: { slug: string };
  Body: { target: string; text: string; author?: string };
}>('/api/teams/:slug/group-send', async (request, reply) => {
  const { slug } = request.params;
  const { target, text, author } = request.body || ({} as { target: string; text: string });
  if (!target || !text) {
    return reply.code(400).send({ ok: false, error: 'target and text are required' });
  }

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sseSend = (event: string, data: unknown): void => {
    reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    sseSend('start', { ts: Date.now(), target, author: author ?? 'user' });
    const result = await svc.groupSend(slug, target, text, {
      author,
      timeoutMs: 5 * 60 * 1000,
      onEvent: (evt) => sseSend('chunk', evt),
    });
    sseSend('user_entry', result.userEntry);
    sseSend('reply_entry', result.replyEntry);
    sseSend('done', { durationMs: result.durationMs });
  } catch (err) {
    sseSend('error', { message: err instanceof Error ? err.message : String(err) });
  } finally {
    reply.raw.end();
  }
});

// ===========================================================================
// Tasks
// ===========================================================================

app.get<{ Params: { slug: string } }>('/api/teams/:slug/tasks', async (request) => {
  const tasks = await svc.readTasks(request.params.slug);
  return { ok: true, tasks };
});

app.post<{
  Params: { slug: string };
  Body: {
    title: string;
    description?: string;
    assignee?: string | null;
    status?: 'todo' | 'doing' | 'done';
  };
}>('/api/teams/:slug/tasks', async (request, reply) => {
  if (!request.body?.title) return reply.code(400).send({ ok: false, error: 'title required' });
  const task = await svc.createTask(request.params.slug, request.body);
  return { ok: true, task };
});

app.patch<{ Params: { slug: string; id: string }; Body: Record<string, unknown> }>(
  '/api/teams/:slug/tasks/:id',
  async (request) => {
    const task = await svc.patchTask(request.params.slug, request.params.id, request.body || {});
    return { ok: true, task };
  }
);

app.delete<{ Params: { slug: string; id: string } }>(
  '/api/teams/:slug/tasks/:id',
  async (request, reply) => {
    const ok = await svc.deleteTask(request.params.slug, request.params.id);
    if (!ok) return reply.code(404).send({ ok: false, error: 'not found' });
    return { ok: true };
  }
);

// ===========================================================================
// Hermit 主仓 UI 首屏强依赖的几个 stub(占位实现)
// ===========================================================================

// hermit getAppVersion 期望返回字符串(不是数组),通配 stub 给的 [] 会让 JSON.parse 后类型对不上
app.get('/api/version', async () => '0.0.0-mvp');

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
  ignoredRegexes: [] as string[],
  ignoredRepositories: [] as string[],
  notificationTriggers: [] as unknown[],
  pinnedSessions: [] as unknown[],
  hiddenSessions: [] as unknown[],
  snoozedUntil: null as string | null,
  selectedFolders: [] as string[],
  claudeEnv: {} as Record<string, string>,
};

app.get('/api/config', async () => ({
  success: true,
  data: DEFAULT_APP_CONFIG,
}));

app.post('/api/config/update', async () => ({
  success: true,
  data: DEFAULT_APP_CONFIG,
}));

app.get('/api/config/triggers', async () => []);
app.get('/api/schedules', async () => []);

// ===========================================================================
// Fallback stubs — 让 hermit 主仓 UI 在缺失 endpoint 时优雅降级,不白屏
// ===========================================================================

const SSE_FALLBACK_RE = /^\/api\/(events|.*\/(events|stream|notifications\/stream))$/;

app.setNotFoundHandler((request, reply) => {
  const u = request.url;
  if (!u.startsWith('/api/')) {
    return reply.code(404).type('text/plain').send('not found');
  }

  request.log.info({ method: request.method, url: u }, '[stub]');

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
