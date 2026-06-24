#!/usr/bin/env node
/**
 * openHermit CLI - production entry point.
 *
 * Usage:
 *   npm install -g @yancyyu/openhermit
 *   openhermit                # open terminal navigation
 *   openhermit --daemon       # start Web UI on default port 5680
 *   openhermit --version      # show version
 *   openhermit update         # check and install updates
 *
 * Or without global install:
 *   npx @yancyyu/openhermit
 *   npx @yancyyu/openhermit --port 8080
 */

import { spawn, execSync } from 'node:child_process';
import crypto from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { BRAND, brandCommand, brandLogPrefix } from './branding.mjs';
import {
  args,
  commandArgs,
  jsonRequested,
  currentVersion,
  pkg,
  repoRoot,
  binDir,
  require,
  port,
  skipHermitBridge,
  hermitHome,
  daemonRequested,
  daemonChild,
  daemonPidPath,
  daemonLogPath,
  runtimeLogPath,
  serverLogPath,
  hermitSettingsPath,
  telemetryDir,
  telemetryWorkerPidPath,
  telemetryWorkerStatusPath,
  telemetryWorkerLogPath,
  telemetryWorkerErrorLogPath,
  conversationUploadLogPath,
  legacyRuntimeBridgeDir,
  hermitBridgeDir,
  legacyRuntimeBridgeConfigPath,
  defaultHermitBridgeConfigPath,
  legacyRuntimeBridgeDataDir,
  defaultHermitBridgeDataDir,
  hermitBridgeConfigPath,
  starterProjectName,
} from './lib/env.mjs';

let cancelHandled = false;

function cancelCli() {
  if (cancelHandled) return;
  cancelHandled = true;
  const message = process.stdout.isTTY && process.env.NO_COLOR !== '1' ? `\x1b[2m已退出 ${BRAND.stylizedName} 终端\x1b[0m` : `已退出 ${BRAND.stylizedName} 终端`;
  console.log(`\n${message}`);
  process.exit(130);
}

process.once('SIGINT', cancelCli);

const versionIndex = args.indexOf('--version');
if (versionIndex !== -1) {
  console.log(currentVersion);
  process.exit(0);
}

const helpIndex = args.indexOf('--help');
if (helpIndex !== -1) {
  console.log(`
${BRAND.stylizedName} - 本地 AI runtime 工作区控制面

用法:
  ${BRAND.cliCommand} [options]

常用选项:
  --port <number>    HTTP 服务端口（默认：5680）
  --no-hermit-bridge 不自动启动内置 runtime bridge
  --daemon           在后台启动 Web 控制台
  --version          显示当前版本
  --help             显示帮助

命令:
  ${BRAND.cliCommand}         打开终端导航，选择本地使用、团队协作或账号授权
  status [--json]    查看后台服务状态
  doctor [--json]    运行只读本地诊断
  teams list [--json]
                     查看本地团队，不启动 Web
  teams create [--name <name>] [--bind-project <id>] [--work-dir <path>] [--harness <runtime>] [--json]
                     创建本地团队元数据，不启动 Web、bridge 或 agent
  tasks list --team <team> [--json]
                     查看某个本地团队的活跃任务
  usage status [--json]
                     查看本地 Claude JSONL telemetry 状态，不上传
  usage today [--json]
                     查看今日本地 usage 摘要，不上传
  usage report [--json]
                     触发/准备本地 usage 报告，不上传
  usage start [--no-autostart] [--json]
                     开启轻量后台 usage 采集并默认配置开机自启，仅扫描本机 JSONL
  usage stop [--keep-autostart] [--json]
                     停止轻量后台 usage 采集并默认关闭开机自启
  usage autostart status|enable|disable [--json]
                     管理 usage 采集开机自启（macOS launchd）
  services [--json]
                     打开终端服务菜单，选择要启动/停止的本地服务
  services start web|usage|collaboration|local [--json]
                     按项启动本地服务
  services stop web|usage [--json]
                     按项停止本地服务
  collaboration start [--json]
                     启用本地/自托管团队协作配置
  auth status [--json]
                     查看 ${BRAND.authAccountLabel}状态，不启动 Web
  auth login [--control-url <url>] [--json]
                     通过 ${BRAND.authProviderName} 打开飞书授权；CLI 只保存 ${BRAND.authProviderName} 授权状态
  auth logout [--json]
                     退出 ${BRAND.authAccountLabel}，不影响本地 runtime 登录
  stop               停止后台服务
  update             检查并安装更新
  add <plugin>       安装能力插件到 MCP library
                     例如：${BRAND.cliCommand} add worker-society

示例:
  npx ${BRAND.npmPackage}             # 不安装直接运行
  npx ${BRAND.npmPackage} --daemon --port 8080
  ${BRAND.cliCommand}                          # 全局安装后打开终端导航
  ${BRAND.cliCommand} --daemon                 # 后台启动 Web 控制台
  ${BRAND.cliCommand} teams create
  ${BRAND.cliCommand} teams list
  ${BRAND.cliCommand} status
  ${BRAND.cliCommand} stop
`);
  process.exit(0);
}

if (commandArgs[0] === 'update') {
  runUpdate();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Update command
// ---------------------------------------------------------------------------

async function runUpdate() {
  const isGitRepo = existsSync(path.join(repoRoot, '.git'));

  if (isGitRepo) {
    // Git repo: check GitHub releases and checkout latest tag
    console.log(`${brandLogPrefix()} Checking for updates...`);
    try {
      const res = await fetch(`https://api.github.com/repos/${BRAND.githubRepo}/releases/latest`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        console.error(`${brandLogPrefix()} Failed to check GitHub releases (HTTP ${res.status})`);
        process.exit(1);
      }
      const data = await res.json();
      const latestVersion = data.tag_name?.replace(/^v/, '');
      if (!latestVersion) {
        console.error(`${brandLogPrefix()} No release found on GitHub`);
        process.exit(1);
      }
      if (latestVersion === currentVersion) {
        migrateLegacyHermitBridgeConfigIfNeeded();
        console.log(`${brandLogPrefix()} Already on latest version (${currentVersion})`);
        process.exit(0);
      }
      console.log(`${brandLogPrefix()} Current: ${currentVersion} → Latest: ${latestVersion}`);
      console.log(`${brandLogPrefix()} Fetching latest changes...`);
      execSync('git fetch --tags', { cwd: repoRoot, stdio: 'inherit' });
      console.log(`${brandLogPrefix()} Checking out v${latestVersion}...`);
      execSync(`git checkout v${latestVersion}`, { cwd: repoRoot, stdio: 'inherit' });
      console.log(`${brandLogPrefix()} Installing dependencies...`);
      execSync('npm install', { cwd: repoRoot, stdio: 'inherit' });
      console.log(`${brandLogPrefix()} Building frontend...`);
      execSync('npm run build:web', { cwd: repoRoot, stdio: 'inherit' });
      migrateLegacyHermitBridgeConfigIfNeeded();
      console.log(`\n${brandLogPrefix()} Updated to ${latestVersion}. Restart with: ${brandCommand()}\n`);
    } catch (err) {
      console.error(`${brandLogPrefix()} Update failed:`, err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  } else {
    // npm install: directly update to latest
    console.log(`${brandLogPrefix()} Updating via npm...`);
    try {
      execSync(`npm install -g ${BRAND.npmPackage}@latest`, { stdio: 'inherit' });
      migrateLegacyHermitBridgeConfigIfNeeded();
      console.log(`\n${brandLogPrefix()} Updated successfully. Restart with: ${brandCommand()}\n`);
    } catch (err) {
      console.error(`${brandLogPrefix()} npm update failed. Try: sudo npm install -g ${BRAND.npmPackage}@latest`);
      process.exit(1);
    }
  }
}

// ---------------------------------------------------------------------------
// add <plugin> - install a feature plugin into the MCP library
// ---------------------------------------------------------------------------

/**
 * Known installable feature plugins. Each maps a `openhermit add <name>` key to
 * the MCP library entry it registers (pointing at a hermit-served MCP endpoint).
 * Mirrors src/features/worker-society/main/composition/workerSocietyPlugin.ts.
 */
const KNOWN_PLUGINS = {
  'worker-society': {
    name: 'worker-society',
    description:
      '去中心化 worker 自治社会：agent 通过 society_* 工具发布需求、自荐、择优选派、积累声誉与关系，替代中心化派单。',
    endpoint: '/mcp',
    transport: 'sse',
    hint: 'society_* tools (publish need / volunteer / auto-select …)',
  },
};

async function runAddPlugin(pluginName, port) {
  if (!pluginName) {
    console.error(`${brandLogPrefix()} Usage: ${brandCommand('add <plugin-name>')}`);
    console.error(`${brandLogPrefix()} Known plugins: ${Object.keys(KNOWN_PLUGINS).join(', ')}`);
    process.exit(1);
  }

  const spec = KNOWN_PLUGINS[pluginName];
  if (!spec) {
    console.error(`${brandLogPrefix()} Unknown plugin: ${pluginName}`);
    console.error(`${brandLogPrefix()} Known plugins: ${Object.keys(KNOWN_PLUGINS).join(', ')}`);
    process.exit(1);
  }

  const base = `http://127.0.0.1:${port}`;
  const body = {
    name: spec.name,
    description: spec.description,
    installSpec: {
      type: 'http',
      url: `${base}${spec.endpoint}`,
      transportType: spec.transport,
    },
  };

  console.log(`${brandLogPrefix()} Installing plugin "${pluginName}" → registering MCP server ${body.installSpec.url}`);

  try {
    const res = await fetch(`${base}/api/extensions/mcp/library`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });

    // 服务端统一包成 { success, data | error }：HTTP 200 但 success:false 也算失败。
    const text = await res.text().catch(() => '');
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* 非 JSON 响应，按 HTTP 状态兜底 */
    }
    const ok = res.ok && parsed && parsed.success !== false;
    const errMsg = parsed && typeof parsed.error === 'string' ? parsed.error : '';

    if (ok) {
      console.log(`${brandLogPrefix()} OK "${pluginName}" installed into the MCP library.`);
      console.log(`${brandLogPrefix()}   Agents can now use: ${spec.hint}`);
      console.log(`${brandLogPrefix()}   Enable it for a worker in the Extensions panel, or via the MCP library.`);
      return;
    }

    // 同名已存在 → 幂等视为已安装。
    if (res.status === 409 || /already exist|已存在|exists/i.test(errMsg)) {
      console.log(`${brandLogPrefix()} OK "${pluginName}" already in the MCP library (idempotent).`);
      return;
    }
    console.error(`${brandLogPrefix()} Install failed (HTTP ${res.status}): ${(errMsg || text).slice(0, 200)}`);
    process.exit(1);
  } catch (err) {
    console.error(`${brandLogPrefix()} Could not reach ${BRAND.stylizedName} at ${base}.`);
    console.error(`${brandLogPrefix()} ${err instanceof Error ? err.message : String(err)}`);
    console.error(`${brandLogPrefix()} Start it first with: ${brandCommand()}`);
    process.exit(1);
  }
}

if (commandArgs[0] === 'add') {
  await runAddPlugin(commandArgs[1], port);
  process.exit(0);
}

function readDaemonPid() {
  try {
    const raw = readFileSync(daemonPidPath, 'utf-8').trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function refreshDaemonPidFromReadyServer(pid) {
  if (!pid || !isPidRunning(pid)) return;
  try {
    mkdirSync(path.dirname(daemonPidPath), { recursive: true });
    writeFileSync(daemonPidPath, String(pid), 'utf-8');
  } catch {
    // PID refresh must not block the menu; server readiness is the source of truth.
  }
}

function isPidRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function removeDaemonPidFile() {
  try {
    unlinkSync(daemonPidPath);
  } catch {
    // Already gone.
  }
}

function signalDaemon(pid, signal) {
  if (!pid) return false;
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    // Fall back to direct process signal.
  }
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

function collectFallbackPids() {
  const pids = new Set();
  const commands = [
    `lsof -tiTCP:${port} -sTCP:LISTEN 2>/dev/null || true`,
    'lsof -tiTCP:9810 -sTCP:LISTEN 2>/dev/null || true',
    'lsof -tiTCP:9820 -sTCP:LISTEN 2>/dev/null || true',
    "pgrep -f '@yancyyu/openhermit|openhermit/bin/hermit\\.mjs|src/main/server\\.ts|hermit-bridge' 2>/dev/null || true",
  ];

  for (const command of commands) {
    try {
      const out = execSync(command, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
      for (const line of out.split(/\s+/)) {
        const pid = Number.parseInt(line, 10);
        if (Number.isFinite(pid) && pid > 0 && pid !== process.pid) {
          pids.add(pid);
        }
      }
    } catch {
      // Ignore missing lsof/pgrep or races with exiting processes.
    }
  }

  return [...pids];
}

async function stopFallbackProcesses() {
  const pids = collectFallbackPids();
  if (pids.length === 0) return false;

  for (const pid of pids) {
    signalDaemon(pid, 'SIGTERM');
  }
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  for (const pid of pids) {
    if (isPidRunning(pid)) {
      signalDaemon(pid, 'SIGKILL');
    }
  }
  return true;
}

async function collectDaemonStatus() {
  const pid = readDaemonPid();
  const pidRunning = Boolean(pid && isPidRunning(pid));
  const fallbackPids = pidRunning ? [] : collectFallbackPids();
  const server = await checkExistingOpenHermitServer();

  return {
    running: pidRunning || fallbackPids.length > 0 || server.running,
    version: currentVersion,
    port: Number.parseInt(port, 10),
    url: `http://127.0.0.1:${port}`,
    hermitHome,
    daemonPidPath,
    daemonLogPath,
    pid: pidRunning ? pid : null,
    pidfilePresent: Boolean(pid),
    fallbackPids,
    server,
  };
}

function printJson(value, exitCode = 0) {
  console.log(JSON.stringify(value, null, 2));
  process.exit(exitCode);
}

const AUTH_CALLBACK_PATH = '/oauth/openhermit/callback';
const AUTH_STORE_SCHEMA_VERSION = 1;

function getAuthStorePath() {
  return process.env.OPENHERMIT_AUTH_STORE_PATH || path.join(hermitHome, 'auth', 'openhermit.json');
}

function chmodBestEffort(filePath, mode) {
  try {
    chmodSync(filePath, mode);
  } catch {
    // Permission hardening is best-effort across platforms.
  }
}

function ensureAuthStoreDir() {
  const dir = path.dirname(getAuthStorePath());
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodBestEffort(dir, 0o700);
  return dir;
}

function normalizeExpiry(expiresIn, expiresAt) {
  if (expiresAt && !Number.isNaN(Date.parse(expiresAt))) return new Date(expiresAt).toISOString();
  const seconds = Number(expiresIn);
  if (Number.isFinite(seconds) && seconds > 0) return new Date(Date.now() + seconds * 1000).toISOString();
  return null;
}

function readOpenHermitAuthStore() {
  const filePath = getAuthStorePath();
  if (!existsSync(filePath)) return { store: null, warning: null };
  const { value, error } = safeReadJson(filePath);
  if (error || !value || typeof value !== 'object') {
    return { store: null, warning: error || 'Invalid auth store' };
  }
  return { store: value, warning: null };
}

function isAuthTokenExpired(store) {
  const expiresAt = store?.token?.expiresAt;
  if (!expiresAt) return false;
  const timestamp = Date.parse(expiresAt);
  if (Number.isNaN(timestamp)) return true;
  return timestamp <= Date.now() + 30_000;
}

function authStatusFromStore(store, warning = null) {
  if (store?.provider === 'openhermit-dev' && !store?.developerMode) {
    return {
      authorized: false,
      method: null,
      account: null,
      expiresAt: null,
      refreshable: false,
      expired: false,
      warning: warning || 'Dev unlock is disabled',
    };
  }
  const token = store?.token || {};
  const hasAccessToken = typeof token.accessToken === 'string' && token.accessToken.length > 0;
  const expired = hasAccessToken ? isAuthTokenExpired(store) : false;
  return {
    authorized: Boolean(hasAccessToken && !expired),
    method: hasAccessToken ? 'oauth' : null,
    account: store?.account && typeof store.account === 'object' ? store.account : null,
    expiresAt: token.expiresAt || null,
    refreshable: Boolean(token.refreshToken),
    expired,
    warning,
    developerMode: Boolean(store?.developerMode),
  };
}

function normalizeAccessTokenPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const accessToken = payload.access_token || payload.accessToken;
  if (typeof accessToken !== 'string' || !accessToken) return null;
  return {
    accessToken,
    refreshToken: payload.refresh_token || payload.refreshToken,
    tokenType: payload.token_type || payload.tokenType,
    scope: payload.scope,
    expiresAt: normalizeExpiry(payload.access_expires_in ?? payload.expires_in ?? payload.expiresIn, payload.expires_at || payload.expiresAt),
    refreshExpiresAt: normalizeExpiry(payload.refresh_expires_in, payload.refresh_expires_at || payload.refreshExpiresAt),
  };
}

function mergeAuthToken(existingToken = {}, tokenPatch) {
  return {
    ...existingToken,
    accessToken: tokenPatch.accessToken,
    refreshToken: tokenPatch.refreshToken || existingToken.refreshToken || null,
    tokenType: tokenPatch.tokenType || existingToken.tokenType || 'Bearer',
    scope: tokenPatch.scope || existingToken.scope || null,
    expiresAt: tokenPatch.expiresAt || null,
    refreshExpiresAt: tokenPatch.refreshExpiresAt || existingToken.refreshExpiresAt || null,
  };
}

function readOpenHermitAuthStatus() {
  if (process.env.OPENHERMIT_USAGE_OAUTH_TOKEN) {
    return {
      authorized: true,
      method: 'oauth',
      account: null,
      expiresAt: null,
      refreshable: false,
      expired: false,
      warning: null,
      source: 'env',
    };
  }
  const { store, warning } = readOpenHermitAuthStore();
  return authStatusFromStore(store, warning);
}

function writeOpenHermitAuthStore(store) {
  ensureAuthStoreDir();
  const filePath = getAuthStorePath();
  const tempPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
  chmodBestEffort(tempPath, 0o600);
  renameSync(tempPath, filePath);
  chmodBestEffort(filePath, 0o600);
}

function deleteOpenHermitAuthStore() {
  try {
    unlinkSync(getAuthStorePath());
  } catch {
    // Already logged out.
  }
}

function getOAuthConfig() {
  const authorizeUrl = process.env.OPENHERMIT_OAUTH_AUTHORIZE_URL || process.env.OPENHERMIT_USAGE_OAUTH_AUTHORIZE_URL || process.env.OPENHERMIT_USAGE_OAUTH_URL || '';
  const tokenUrl = process.env.OPENHERMIT_OAUTH_TOKEN_URL || process.env.OPENHERMIT_USAGE_OAUTH_TOKEN_URL || '';
  return {
    authorizeUrl,
    tokenUrl,
    userInfoUrl: process.env.OPENHERMIT_OAUTH_USERINFO_URL || process.env.OPENHERMIT_USAGE_OAUTH_USERINFO_URL || '',
    issuer: process.env.OPENHERMIT_OAUTH_ISSUER || (authorizeUrl ? new URL(authorizeUrl).origin : ''),
    clientId: process.env.OPENHERMIT_OAUTH_CLIENT_ID || process.env.OPENHERMIT_USAGE_OAUTH_CLIENT_ID || 'openhermit-cli',
    scope: process.env.OPENHERMIT_OAUTH_SCOPE || process.env.OPENHERMIT_USAGE_OAUTH_SCOPE || 'openid profile email usage:write',
    timeoutMs: Number.parseInt(process.env.OPENHERMIT_OAUTH_TIMEOUT_MS || '120000', 10),
  };
}

function hasRawOAuthConfig() {
  const config = getOAuthConfig();
  return Boolean(config.authorizeUrl || config.tokenUrl || config.userInfoUrl);
}

function normalizeControlUrl(value, optionName = '--control-url') {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${optionName} must be a valid URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${optionName} must use http or https`);
  }
  return url.toString().replace(/\/+$/u, '');
}

const DEFAULT_OPENHERMIT_CLOUD_HOST = '159.75.231.98';
const OPENHERMIT_AUTH_BROKER_URL = process.env.OPENHERMIT_AUTH_BASE_URL || process.env.OPENHERMIT_CLOUD_AUTH_BASE_URL || `http://${process.env.OPENHERMIT_CLOUD_HOST || DEFAULT_OPENHERMIT_CLOUD_HOST}:3001`;
const OPENHERMIT_CONVERSATION_UPLOAD_BASE_URL = process.env.OPENHERMIT_CONVERSATION_UPLOAD_BASE_URL || process.env.OPENHERMIT_CLOUD_UPLOAD_BASE_URL || `http://${process.env.OPENHERMIT_CLOUD_HOST || DEFAULT_OPENHERMIT_CLOUD_HOST}:8088`;
const DEV_AUTH_UNLOCK_CODE = process.env.OPENHERMIT_DEV_UNLOCK_CODE || '';

function resolveConversationUploadBaseUrl(existingBaseUrl = '') {
  return process.env.OPENHERMIT_CONVERSATION_UPLOAD_BASE_URL || process.env.OPENHERMIT_CLOUD_UPLOAD_BASE_URL || (existingBaseUrl || OPENHERMIT_CONVERSATION_UPLOAD_BASE_URL);
}

function isSourceCheckout() {
  return existsSync(path.join(repoRoot, '.git'));
}

function getDefaultDeviceAuthBaseUrl() {
  return OPENHERMIT_AUTH_BROKER_URL;
}

function getDeviceAuthConfig({ controlUrl = null } = {}) {
  const baseUrl = normalizeControlUrl(controlUrl || process.env.OPENHERMIT_AUTH_BASE_URL || process.env.OPENHERMIT_USAGE_AUTH_BASE_URL || getDefaultDeviceAuthBaseUrl(), 'OPENHERMIT_AUTH_BASE_URL');
  return {
    baseUrl,
    startUrl: process.env.OPENHERMIT_AUTH_START_URL || `${baseUrl}/api/v1/auth/hermit/start`,
    pollUrl: process.env.OPENHERMIT_AUTH_POLL_URL || `${baseUrl}/api/v1/auth/hermit/poll`,
    tokenUrl: process.env.OPENHERMIT_AUTH_TOKEN_URL || `${baseUrl}/api/cli-auth/token`,
    refreshUrl: process.env.OPENHERMIT_AUTH_REFRESH_URL || `${baseUrl}/api/v1/auth/hermit/refresh`,
    meUrl: process.env.OPENHERMIT_AUTH_ME_URL || `${baseUrl}/api/v1/auth/hermit/me`,
    logoutUrl: process.env.OPENHERMIT_AUTH_LOGOUT_URL || `${baseUrl}/api/v1/auth/hermit/logout`,
    clientId: process.env.OPENHERMIT_OAUTH_CLIENT_ID || process.env.OPENHERMIT_AUTH_CLIENT_ID || 'openhermit-cli',
    scope: process.env.OPENHERMIT_OAUTH_SCOPE || process.env.OPENHERMIT_AUTH_SCOPE || 'openid profile email usage:write',
    timeoutMs: Number.parseInt(process.env.OPENHERMIT_AUTH_TIMEOUT_MS || process.env.OPENHERMIT_OAUTH_TIMEOUT_MS || '600000', 10),
  };
}

function assertOAuthConfigured(config) {
  const missing = [];
  if (!config.authorizeUrl) missing.push('OPENHERMIT_OAUTH_AUTHORIZE_URL');
  if (!config.tokenUrl) missing.push('OPENHERMIT_OAUTH_TOKEN_URL');
  if (missing.length > 0) {
    throw new Error(`OAuth not configured: missing ${missing.join(', ')}`);
  }
}

function base64Url(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function randomOAuthValue(bytes = 32) {
  return base64Url(crypto.randomBytes(bytes));
}

function buildCodeChallenge(verifier) {
  return base64Url(crypto.createHash('sha256').update(verifier).digest());
}

function buildAuthorizationUrl(config, redirectUri, state, codeChallenge) {
  const url = new URL(config.authorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', config.scope);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

async function openExternalUrl(url) {
  const mode = process.env.OPENHERMIT_AUTH_OPEN_BROWSER || process.env.OPENHERMIT_OAUTH_OPEN_BROWSER;
  if (mode === '0') return { opened: false, skipped: true };
  if (mode === 'fetch') {
    await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
    return { opened: true, mode: 'fetch' };
  }

  const platform = process.platform;
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'powershell.exe' : 'xdg-open';
  const commandArgsForPlatform = platform === 'win32'
    ? ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $args[0]', url]
    : [url];

  return new Promise((resolve) => {
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const child = spawn(command, commandArgsForPlatform, {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.once('error', () => settle({ opened: false, skipped: true, mode: command }));
    child.once('spawn', () => {
      child.unref();
      setTimeout(() => settle({ opened: true, mode: command }), 200);
    });
    child.once('exit', (code) => {
      if (code !== 0) settle({ opened: false, skipped: true, mode: command });
    });
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildAuthCallbackHtml({ title, eyebrow, message, tone = 'success' }) {
  const accent = tone === 'success' ? '#16a34a' : tone === 'warn' ? '#d97706' : '#dc2626';
  const glow = tone === 'success' ? 'rgba(22, 163, 74, 0.22)' : tone === 'warn' ? 'rgba(217, 119, 6, 0.22)' : 'rgba(220, 38, 38, 0.2)';
  const safeTitle = escapeHtml(title);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100dvh;
      display: grid;
      place-items: center;
      overflow: hidden;
      background:
        radial-gradient(circle at 20% 15%, ${glow}, transparent 34rem),
        radial-gradient(circle at 85% 20%, rgba(59, 130, 246, 0.16), transparent 28rem),
        linear-gradient(135deg, #f8fafc 0%, #eef2f7 46%, #f8fafc 100%);
      color: #111827;
      font: 15px/1.6 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      position: relative;
      width: min(520px, calc(100vw - 32px));
      padding: 34px;
      border: 1px solid rgba(148, 163, 184, 0.28);
      border-radius: 28px;
      background: rgba(255, 255, 255, 0.84);
      box-shadow: 0 24px 80px rgba(15, 23, 42, 0.12);
      backdrop-filter: blur(18px);
    }
    main::before {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      border-radius: inherit;
      background: linear-gradient(135deg, rgba(255, 255, 255, 0.92), transparent 42%);
    }
    .content { position: relative; }
    .mark {
      width: 52px;
      height: 52px;
      display: grid;
      place-items: center;
      margin-bottom: 22px;
      border-radius: 18px;
      background: color-mix(in srgb, ${accent} 12%, white);
      color: ${accent};
      box-shadow: 0 14px 30px ${glow};
    }
    .mark svg { width: 26px; height: 26px; }
    .eyebrow {
      margin: 0 0 8px;
      color: ${accent};
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }
    h1 { margin: 0; font-size: clamp(30px, 6vw, 42px); line-height: 1.08; letter-spacing: -0.04em; }
    p { margin: 16px 0 0; color: #475569; }
    .hint {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 26px;
      padding-top: 18px;
      border-top: 1px solid rgba(148, 163, 184, 0.22);
      color: #64748b;
      font-size: 13px;
    }
    .dot { width: 8px; height: 8px; border-radius: 999px; background: ${accent}; box-shadow: 0 0 0 6px ${glow}; }
    @media (prefers-color-scheme: dark) {
      body {
        background:
          radial-gradient(circle at 20% 15%, ${glow}, transparent 34rem),
          radial-gradient(circle at 85% 20%, rgba(59, 130, 246, 0.18), transparent 28rem),
          linear-gradient(135deg, #020617 0%, #111827 48%, #020617 100%);
        color: #f8fafc;
      }
      main { background: rgba(15, 23, 42, 0.78); border-color: rgba(148, 163, 184, 0.18); box-shadow: 0 24px 80px rgba(0, 0, 0, 0.36); }
      main::before { background: linear-gradient(135deg, rgba(255, 255, 255, 0.08), transparent 42%); }
      .mark { background: color-mix(in srgb, ${accent} 18%, #0f172a); }
      p, .hint { color: #94a3b8; }
    }
  </style>
</head>
<body>
  <main>
    <div class="content">
      <div class="mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
      </div>
      <p class="eyebrow">${escapeHtml(eyebrow)}</p>
      <h1>${safeTitle}</h1>
      <p>${escapeHtml(message)}</p>
      <div class="hint"><span class="dot"></span><span>这个页面可以关闭，${BRAND.productName} 会自动继续。</span></div>
    </div>
  </main>
</body>
</html>`;
}

async function startOAuthCallbackServer(expectedState, timeoutMs) {
  let server;
  let timer;
  let closed = false;
  const closeServer = async () => {
    clearTimeout(timer);
    if (closed) return;
    closed = true;
    await new Promise((resolve) => server.close(() => resolve()));
  };
  const callback = new Promise((resolve, reject) => {
    server = createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
        if (requestUrl.pathname !== AUTH_CALLBACK_PATH) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Not found');
          return;
        }
        const state = requestUrl.searchParams.get('state') || '';
        const code = requestUrl.searchParams.get('code') || '';
        const error = requestUrl.searchParams.get('error') || '';
        if (state !== expectedState) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(buildAuthCallbackHtml({
            title: '授权失败',
            eyebrow: `${BRAND.stylizedName} Auth`,
            message: 'state 校验失败，请回到终端重试。',
            tone: 'error',
          }));
          reject(new Error('OAuth state mismatch'));
          return;
        }
        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(buildAuthCallbackHtml({
            title: '授权已取消',
            eyebrow: `${BRAND.stylizedName} Auth`,
            message: '授权流程已取消，请回到终端查看详情。',
            tone: 'warn',
          }));
          reject(new Error(`OAuth provider returned error: ${error}`));
          return;
        }
        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(buildAuthCallbackHtml({
            title: '授权失败',
            eyebrow: `${BRAND.stylizedName} Auth`,
            message: '缺少授权码，请回到终端重新发起登录。',
            tone: 'error',
          }));
          reject(new Error('OAuth callback missing code'));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(buildAuthCallbackHtml({
          title: '授权完成',
          eyebrow: `${BRAND.productName} is ready`,
          message: `你已经成功登录 ${BRAND.authProviderName}，可以回到 ${BRAND.productName} 继续使用。`,
        }));
        resolve(code);
      } catch (err) {
        reject(err);
      }
    });
    server.listen(0, '127.0.0.1', () => undefined);
    server.once('error', reject);
    timer = setTimeout(() => reject(new Error('OAuth login timed out')), timeoutMs);
  });

  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  return {
    redirectUri: `http://127.0.0.1:${server.address().port}${AUTH_CALLBACK_PATH}`,
    waitForCode: async () => {
      try {
        return await callback;
      } finally {
        await closeServer();
      }
    },
    close: closeServer,
  };
}

async function exchangeAuthorizationCode(config, code, redirectUri, codeVerifier) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: config.clientId,
    code_verifier: codeVerifier,
  });
  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    // Keep provider response private.
  }
  if (!res.ok || !payload?.access_token) {
    throw new Error(`OAuth token exchange failed (HTTP ${res.status})`);
  }
  return payload;
}

async function fetchOAuthUserInfo(config, accessToken) {
  if (!config.userInfoUrl) return null;
  const res = await fetch(config.userInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  if (!user || typeof user !== 'object') return null;
  return {
    id: user.sub || user.id || user.open_id || user.user_id || null,
    email: user.email || null,
    name: user.name || user.display_name || user.username || null,
  };
}

function buildAuthStoreFromToken(config, tokenPayload, account) {
  const now = new Date().toISOString();
  const normalizedToken = normalizeAccessTokenPayload(tokenPayload);
  if (!normalizedToken) throw new Error('Auth token response did not include an access token');
  return {
    schemaVersion: AUTH_STORE_SCHEMA_VERSION,
    provider: 'openhermit',
    issuer: config.issuer || config.baseUrl || null,
    clientId: config.clientId,
    account: account || tokenPayload.account || null,
    token: mergeAuthToken({ scope: config.scope }, normalizedToken),
    createdAt: now,
    updatedAt: now,
  };
}

async function performRawOAuthLogin({ quiet = false } = {}) {
  const config = getOAuthConfig();
  assertOAuthConfigured(config);
  const state = randomOAuthValue();
  const codeVerifier = randomOAuthValue(48);
  const codeChallenge = buildCodeChallenge(codeVerifier);
  const server = await startOAuthCallbackServer(state, config.timeoutMs || 120_000);
  const authorizationUrl = buildAuthorizationUrl(config, server.redirectUri, state, codeChallenge);

  try {
    const browser = await openExternalUrl(authorizationUrl);
    if (!quiet && browser.skipped) {
      console.log(`${brandLogPrefix()} 浏览器未自动打开，请复制下面链接完成授权：`);
      console.log(authorizationUrl);
    } else if (!quiet) {
      console.log(`${brandLogPrefix()} 已打开浏览器，请完成 ${BRAND.authProviderName} 授权...`);
    }
    const code = await server.waitForCode();
    const tokenPayload = await exchangeAuthorizationCode(config, code, server.redirectUri, codeVerifier);
    const account = await fetchOAuthUserInfo(config, tokenPayload.access_token);
    const store = buildAuthStoreFromToken(config, tokenPayload, account);
    writeOpenHermitAuthStore(store);
    return authStatusFromStore(store);
  } catch (err) {
    await server.close().catch(() => undefined);
    throw err;
  }
}

async function startDeviceAuthSession(config) {
  const res = await fetch(config.startUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok || !payload) {
    throw new Error(`CLI auth start failed (HTTP ${res.status})`);
  }

  if (payload.flow_id && payload.poll_secret && payload.authorization_url) {
    return {
      mode: 'hermit-feishu',
      flowId: payload.flow_id,
      pollSecret: payload.poll_secret,
      verificationUrl: payload.authorization_url,
      verificationUriComplete: payload.authorization_url,
      userCode: null,
      expiresIn: Number(payload.expires_in || 600),
      interval: Math.max(1, Number(payload.interval || 2)),
    };
  }

  if (payload.deviceCode && payload.verificationUrl) {
    return {
      mode: 'legacy-device',
      deviceCode: payload.deviceCode,
      userCode: payload.userCode || null,
      verificationUrl: payload.verificationUrl,
      verificationUriComplete: payload.verificationUriComplete || payload.verification_url_complete || null,
      expiresIn: Number(payload.expiresIn || payload.expires_in || 600),
      interval: Math.max(1, Number(payload.interval || 2)),
    };
  }

  throw new Error(`CLI auth start returned an unsupported response (HTTP ${res.status})`);
}

function normalizeHermitAuthIdentity(identity) {
  if (!identity || typeof identity !== 'object') return null;
  return {
    id: identity.id || identity.union_id || identity.open_id || identity.user_id || null,
    tenantKey: identity.tenant_key || identity.tenantKey || null,
    openId: identity.open_id || identity.openId || null,
    unionId: identity.union_id || identity.unionId || null,
    userId: identity.user_id || identity.userId || null,
    name: identity.name || identity.display_name || identity.username || null,
  };
}

async function waitForAuthPollInterval(intervalMs, signal) {
  if (signal?.aborted) throw signal.reason || new Error('CLI auth cancelled');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, intervalMs);
    if (!signal) return;
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason || new Error('CLI auth cancelled'));
    }, { once: true });
  });
}

async function pollDeviceAuthToken(config, session, { signal = null } = {}) {
  const startedAt = Date.now();
  const timeoutAt = startedAt + Math.min(config.timeoutMs, session.expiresIn * 1000);
  let intervalMs = session.interval * 1000;

  while (Date.now() < timeoutAt) {
    if (signal?.aborted) throw signal.reason || new Error('CLI auth cancelled');
    const fetchSignal = AbortSignal.timeout(30_000);
    const res = session.mode === 'hermit-feishu'
      ? await fetch(`${config.pollUrl}?flow_id=${encodeURIComponent(session.flowId)}&poll_secret=${encodeURIComponent(session.pollSecret)}`, {
        headers: { Accept: 'application/json' },
        signal: fetchSignal,
      })
      : await fetch(config.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ deviceCode: session.deviceCode, clientId: config.clientId }),
        signal: fetchSignal,
      });
    const payload = await res.json().catch(() => null);
    if (res.ok && (payload?.accessToken || payload?.access_token)) return payload;
    const status = payload?.status || '';
    const error = payload?.error || status;
    if (error === 'authorization_pending') {
      await waitForAuthPollInterval(intervalMs, signal);
      continue;
    }
    if (error === 'slow_down') {
      intervalMs += 1000;
      await waitForAuthPollInterval(intervalMs, signal);
      continue;
    }
    throw new Error(error || `CLI auth token failed (HTTP ${res.status})`);
  }
  throw new Error('CLI auth timed out');
}

async function performDeviceAuthLogin({ quiet = false, controlUrl = null } = {}) {
  const config = getDeviceAuthConfig({ controlUrl });
  const abortController = new AbortController();
  const cancelAuth = () => abortController.abort(new Error('已取消飞书授权登录'));
  const interactiveCancel = !quiet && process.stdin.isTTY;
  let previousRawMode = false;
  const onCancelKey = (chunk) => {
    for (const key of parseMenuKeys(chunk)) {
      if (key.type === 'exit' || key.type === 'back') cancelAuth();
    }
  };

  if (interactiveCancel) {
    previousRawMode = Boolean(process.stdin.isRaw);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onCancelKey);
    process.stdout.write('\x1b[?25l');
  }

  try {
    if (!quiet) {
      printCliRows('飞书授权登录', [
        ['状态', `正在连接 ${BRAND.authProviderName} 授权服务`, 'warn'],
        ['服务', config.baseUrl, 'info'],
      ], '如果这里超过 30 秒，说明授权服务不可达或网络被拦截；Esc/Ctrl+C 可取消。');
    }

    const session = await startDeviceAuthSession(config);
    if (abortController.signal.aborted) throw abortController.signal.reason;
    const loginUrl = session.verificationUriComplete || session.verificationUrl;
    const browser = await openExternalUrl(loginUrl);

    if (!quiet) {
      printCliRows('飞书授权登录', [
        ['地址', loginUrl],
        ['授权码', session.userCode || '浏览器页面已包含授权信息'],
        ['状态', browser.skipped ? '请复制地址到浏览器完成飞书授权' : '已打开浏览器，等待飞书授权确认'],
        ['安全', `CLI 只保存 ${BRAND.authProviderName} 授权状态`],
      ], '浏览器完成授权后，CLI 会自动继续；Esc/Ctrl+C 可取消。');
    }

    const tokenPayload = await pollDeviceAuthToken(config, session, { signal: abortController.signal });
    const account = normalizeHermitAuthIdentity(tokenPayload.identity) || tokenPayload.account || null;
    const store = buildAuthStoreFromToken(config, tokenPayload, account);
    writeOpenHermitAuthStore(store);
    return authStatusFromStore(store);
  } finally {
    if (interactiveCancel) {
      process.stdin.off('data', onCancelKey);
      process.stdin.setRawMode(previousRawMode);
      process.stdin.pause();
      process.stdout.write('\x1b[?25h');
    }
  }
}

async function performOpenHermitLogin(options = {}) {
  if (hasRawOAuthConfig()) return performRawOAuthLogin(options);
  return performDeviceAuthLogin(options);
}

async function refreshExpiredOpenHermitToken(store) {
  const refreshToken = store?.token?.refreshToken;
  if (!refreshToken || !store?.issuer) return store;
  try {
    const config = getDeviceAuthConfig({ controlUrl: store.issuer });
    const res = await fetch(config.refreshUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refreshToken, clientId: store.clientId || config.clientId }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) return store;
    const tokenPatch = normalizeAccessTokenPayload(payload);
    if (!tokenPatch) return store;
    const account = normalizeHermitAuthIdentity(payload?.identity) || normalizeHermitAuthIdentity(payload?.account) || payload?.account || store.account || null;
    const refreshedStore = {
      ...store,
      clientId: store.clientId || config.clientId,
      account,
      token: mergeAuthToken(store.token, tokenPatch),
      updatedAt: new Date().toISOString(),
    };
    writeOpenHermitAuthStore(refreshedStore);
    return refreshedStore;
  } catch {
    // Refresh is best-effort. Keep the local store private and unchanged on network failures.
    return store;
  }
}

async function refreshOpenHermitAuthStatus() {
  const { store: initialStore } = readOpenHermitAuthStore();
  let store = initialStore;
  if (isAuthTokenExpired(store)) store = await refreshExpiredOpenHermitToken(store);
  let accessToken = store?.token?.accessToken;
  if (!accessToken || !store?.issuer) return readOpenHermitAuthStatus();
  try {
    const config = getDeviceAuthConfig({ controlUrl: store.issuer });
    let res = await fetch(config.meUrl, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
    let payload = await res.json().catch(() => null);

    if (res.ok && payload?.access_expired === true && store?.token?.refreshToken) {
      store = await refreshExpiredOpenHermitToken({
        ...store,
        token: { ...store.token, expiresAt: '2000-01-01T00:00:00.000Z' },
      });
      accessToken = store?.token?.accessToken;
      if (accessToken) {
        res = await fetch(config.meUrl, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(5_000),
        });
        payload = await res.json().catch(() => null);
      }
    }

    if (!res.ok) return readOpenHermitAuthStatus();
    if (payload?.authenticated === false || payload?.refresh_expired === true || payload?.revoked_at) {
      writeOpenHermitAuthStore({
        ...store,
        token: {
          ...store.token,
          expiresAt: '2000-01-01T00:00:00.000Z',
        },
        updatedAt: new Date().toISOString(),
        lastMeStatus: payload?.status || 'unauthenticated',
      });
      return readOpenHermitAuthStatus();
    }
    const account = normalizeHermitAuthIdentity(payload?.identity) || normalizeHermitAuthIdentity(payload?.account) || payload?.account || store.account || null;
    const nextExpiresAt = normalizeExpiry(payload?.access_expires_in ?? payload?.expires_in ?? payload?.expiresIn, payload?.access_expires_at || payload?.expires_at || payload?.expiresAt);
    writeOpenHermitAuthStore({
      ...store,
      account,
      token: {
        ...store.token,
        expiresAt: nextExpiresAt,
      },
      updatedAt: new Date().toISOString(),
      lastMeStatus: payload?.status || 'ok',
      lastMeAuthenticatedAt: new Date().toISOString(),
    });
  } catch {
    // Broker ping is best-effort. Keep the local token state if the service is unreachable.
  }
  return readOpenHermitAuthStatus();
}

function authStatusPayload(command = 'auth status') {
  return { ok: true, command, hermitHome, auth: readOpenHermitAuthStatus() };
}

function failAuthRequired(command) {
  const result = {
    ok: false,
    command,
    error: `${BRAND.stylizedName} login required`,
    auth: readOpenHermitAuthStatus(),
  };
  if (jsonRequested) printJson(result, 1);
  console.error(`${brandLogPrefix()} 请先登录：${brandCommand('auth login')}`);
  console.error(`${brandLogPrefix()} 本地数字员工工作台、Usage 采集和团队协作可免登录；云端授权、托管服务或显式上传需要 ${BRAND.authAccountLabel}。`);
  process.exit(1);
}

function requireOpenHermitAuthForCommand(command) {
  if (!readOpenHermitAuthStatus().authorized) failAuthRequired(command);
}

function isAuthCommandAllowedWithoutLogin() {
  if (commandArgs[0] !== 'auth') return false;
  return ['login', 'status', 'logout', 'dev-login'].includes(commandArgs[1]);
}

function isLocalCommandAllowedWithoutLogin() {
  if (['status', 'doctor', 'services', 'stop'].includes(commandArgs[0])) return true;
  if (commandArgs[0] === 'usage') return ['status', 'today', 'report', 'start', 'stop', 'autostart'].includes(commandArgs[1]);
  if (commandArgs[0] === 'collaboration' && commandArgs[1] === 'start') return true;
  if (commandArgs[0] === 'teams') return ['list', 'create'].includes(commandArgs[1]);
  if (commandArgs[0] === 'tasks' && commandArgs[1] === 'list') return true;
  return false;
}

async function requireOpenHermitAuthForEntry() {
  if (commandArgs.length === 0 || isAuthCommandAllowedWithoutLogin() || isLocalCommandAllowedWithoutLogin()) return;
  if (commandArgs[0] === 'auth') return;
  if (commandArgs[0] === '__telemetry-worker') return;
  if (readOpenHermitAuthStatus().authorized) return;

  const isInteractiveEntry = commandArgs.length === 0 && !daemonChild && !daemonRequested && !jsonRequested;
  if (isInteractiveEntry) {
    const login = await runAuthLogin({ exitOnDone: false, interactiveMenu: true, quiet: false });
    if (login?.auth?.authorized || readOpenHermitAuthStatus().authorized) return;
  }

  failAuthRequired(commandArgs.join(' ') || 'openhermit');
}

function parseAuthLoginOptions() {
  const index = args.indexOf('--control-url');
  if (index === -1) return { controlUrl: null };
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error('Missing required value for --control-url');
  }
  return { controlUrl: normalizeControlUrl(value) };
}

function buildDevAuthStore() {
  const now = new Date().toISOString();
  return {
    schemaVersion: AUTH_STORE_SCHEMA_VERSION,
    provider: 'openhermit-dev',
    developerMode: true,
    debugLogging: true,
    issuer: 'local-dev-unlock',
    clientId: 'openhermit-cli-dev',
    account: {
      id: 'local-dev-unlock',
      email: 'dev@openhermit.local',
      name: `${BRAND.stylizedName} Dev Unlock`,
    },
    token: {
      accessToken: `dev-unlock-${crypto.randomBytes(16).toString('hex')}`,
      refreshToken: null,
      tokenType: 'Bearer',
      scope: 'openid profile email usage:write dev:local',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    },
    createdAt: now,
    updatedAt: now,
  };
}

async function promptDevUnlockCode() {
  const wasRaw = Boolean(process.stdin.isRaw);
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.resume();
  const rl = createPromptInterface();
  try {
    return await askRequired(rl, '开发口令');
  } finally {
    rl.close();
    if (process.stdin.isTTY && wasRaw) process.stdin.setRawMode(true);
  }
}

async function runAuthDevLogin({ exitOnDone = true, requireCode = true, quiet = false } = {}) {
  let code = commandArgs[2] || '';
  if (requireCode && !code && isInteractiveCli() && !jsonRequested) {
    code = await promptDevUnlockCode();
  }
  if (!isSourceCheckout()) {
    const result = { ok: false, command: 'auth dev-login', hermitHome, error: 'dev-login is only available from a source checkout' };
    if (jsonRequested) printJson(result, 1);
    console.error(`${brandLogPrefix()} dev-login 仅允许源码开发模式使用。`);
    if (exitOnDone) process.exit(1);
    return result;
  }
  if (requireCode && (!DEV_AUTH_UNLOCK_CODE || code !== DEV_AUTH_UNLOCK_CODE)) {
    const result = { ok: false, command: 'auth dev-login', hermitHome, error: 'Invalid dev unlock code' };
    if (jsonRequested) printJson(result, 1);
    console.error(`${brandLogPrefix()} 开发解锁口令无效。`);
    if (exitOnDone) process.exit(1);
    return result;
  }
  const store = buildDevAuthStore();
  writeOpenHermitAuthStore(store);
  const auth = authStatusFromStore(store);
  const result = { ok: true, command: 'auth dev-login', hermitHome, auth };
  if (!quiet && jsonRequested) printJson(result);
  if (!quiet) {
    printCliRows('开发模式已解锁', [
      ['账号', auth.account?.email || auth.account?.id || 'local dev'],
      ['有效期', auth.expiresAt || '本地会话'],
      ['调试日志', '开启'],
      ['Web 日志', daemonLogPath],
      ['同步日志', telemetryWorkerLogPath],
      ['范围', '仅源码 checkout，本地调试使用'],
    ], `退出开发登录可运行：${brandCommand('auth logout')}`);
  }
  if (exitOnDone) process.exit(0);
  return result;
}

async function printAuthStatus({ exitOnDone = true } = {}) {
  await refreshOpenHermitAuthStatus();
  const result = authStatusPayload();
  if (jsonRequested) printJson(result);
  if (result.auth.authorized) {
    const account = result.auth.account?.email || result.auth.account?.name || result.auth.account?.id || `${BRAND.authProviderName} account`;
    printCliRows(BRAND.authAccountLabel, [
      ['状态', '已登录'],
      ['账号', account],
      ['授权', `${BRAND.authProviderName} 飞书授权已确认，云端授权和托管服务可用`],
    ], `退出登录可运行：${brandCommand('auth logout')}`);
  } else {
    printCliRows(BRAND.authAccountLabel, [
      ['状态', '未登录'],
      ['影响', `本地使用和本地 usage 统计无需登录；云端授权、托管服务和显式上传需要 ${BRAND.authProviderName} 飞书授权`],
    ], `需要云端/上传能力时运行：${brandCommand('auth login')}`);
  }
  if (result.auth.warning) console.error(`${brandLogPrefix()} Auth store warning: ${result.auth.warning}`);
  if (exitOnDone) process.exit(0);
  return result;
}

async function runAuthLogout({ exitOnDone = true } = {}) {
  const { store } = readOpenHermitAuthStore();
  const accessToken = store?.token?.accessToken;
  if (accessToken && store?.issuer) {
    try {
      const config = getDeviceAuthConfig({ controlUrl: store.issuer });
      await fetch(config.logoutUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      // Local logout should still clear the token if the broker is unreachable.
    }
  }
  deleteOpenHermitAuthStore();
  const result = { ok: true, command: 'auth logout', hermitHome };
  if (jsonRequested) printJson(result);
  console.log(`${brandLogPrefix()} 已退出 ${BRAND.authAccountLabel}；再次进入菜单、Web、Usage 采集或团队协作前需要重新登录。`);
  if (exitOnDone) process.exit(0);
  return result;
}

async function runAuthLogin({ exitOnDone = true, interactiveMenu = false, quiet = jsonRequested } = {}) {
  try {
    const loginOptions = parseAuthLoginOptions();
    const auth = await performOpenHermitLogin({ quiet, ...loginOptions });
    const result = { ok: true, command: 'auth login', hermitHome, auth };
    if (jsonRequested) printJson(result);
    printCliRows('登录成功', [
      ['账号', auth.account?.email || auth.account?.name || auth.account?.id || `${BRAND.authProviderName} account`],
      ['授权', `飞书授权已通过 ${BRAND.authProviderName} 确认，云端授权和托管服务已可用`],
      ['安全', `CLI 只保存 ${BRAND.authProviderName} 授权状态，不会保存飞书 app secret、飞书 token 或 Claude Code 凭证`],
    ], `继续运行 ${BRAND.cliCommand} 进入终端导航。`);
    if (exitOnDone) process.exit(0);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const result = { ok: false, command: 'auth login', hermitHome, error: message };
    if (jsonRequested) printJson(result, 1);
    printCliRows('登录失败', [
      ['原因', message],
      ['默认', `通过 ${BRAND.authProviderName} 打开飞书授权，可用 --control-url 指定控制台地址`],
      ['调试', '显式配置 OAuth authorize/token/userinfo 时才走原始 PKCE'],
      ['安全', 'CLI 不保存飞书 app secret、飞书 token 或 Claude Code 凭证，也不会打印 token'],
    ], '本地调试可运行 scripts/openhermit-device-auth-debug-server.mjs。');
    if (exitOnDone && !interactiveMenu) process.exit(1);
    return result;
  }
}

async function printDaemonStatus({ exitOnDone = true } = {}) {
  const status = await collectDaemonStatus();
  if (jsonRequested) {
    printJson({ ok: status.running, command: 'status', status }, status.running ? 0 : 1);
  }

  if (status.pid) {
    printCliRows('后台服务', [
      ['状态', `运行中 (pid ${status.pid})`],
      ['地址', status.url],
      ['日志', daemonLogPath],
    ], `停止服务可运行：${brandCommand('stop')}`);
    if (exitOnDone) process.exit(0);
    return status;
  }
  if (status.fallbackPids.length > 0) {
    printCliRows('后台服务', [
      ['状态', `运行中，无 daemon pidfile (pids ${status.fallbackPids.join(', ')})`],
      ['地址', status.url],
    ], '需要清理时可运行：openhermit stop');
    if (exitOnDone) process.exit(0);
    return status;
  }
  if (status.server.running) {
    printCliRows('后台服务', [
      ['状态', '运行中'],
      ['地址', status.server.url],
      ['版本', status.server.version],
    ], '复杂设置请在 Web 控制台中完成。');
    if (exitOnDone) process.exit(0);
    return status;
  }
  printCliRows('后台服务', [
    ['状态', '未运行'],
    ['地址', status.url],
  ], `启动服务可运行：${brandCommand('--daemon')}`);
  if (exitOnDone) process.exit(1);
  return status;
}

async function stopDaemon({ exitOnDone = true, quiet = false } = {}) {
  clearWebRunningOptimistic();
  const pid = readDaemonPid();
  if (!pid || !isPidRunning(pid)) {
    if (pid) removeDaemonPidFile();
    const stoppedFallback = await stopFallbackProcesses();
    if (!quiet) {
      printCliRows('后台服务', [
        ['状态', stoppedFallback ? '已停止残留服务进程' : '未运行'],
        ['地址', `http://127.0.0.1:${port}`],
      ], stoppedFallback ? `如需重新启动可运行：${brandCommand('--daemon')}` : '无需处理。');
    }
    if (exitOnDone) process.exit(0);
    return { stopped: stoppedFallback, pid: null };
  }
  if (!quiet) {
    printCliRows('后台服务', [
      ['状态', `正在停止 (pid ${pid})`],
      ['地址', `http://127.0.0.1:${port}`],
    ]);
  }
  signalDaemon(pid, 'SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  if (isPidRunning(pid)) {
    signalDaemon(pid, 'SIGKILL');
  }
  removeDaemonPidFile();
  if (!quiet) {
    printCliRows('后台服务', [
      ['状态', '已停止'],
      ['地址', `http://127.0.0.1:${port}`],
    ], `如需重新启动可运行：${brandCommand('--daemon')}`);
  }
  if (exitOnDone) process.exit(0);
  return { stopped: true, pid };
}

async function waitForOpenHermitServerReady(pid, timeoutMs = 20_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (pid && !isPidRunning(pid)) {
      return { ready: false, reason: '服务进程已退出，请查看日志', url: `http://127.0.0.1:${port}` };
    }

    const server = await checkExistingOpenHermitServer();
    if (server.running) return { ready: true, ...server };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { ready: false, reason: '服务还没准备好，请稍后刷新或查看日志', url: `http://127.0.0.1:${port}` };
}

function startDaemon({ exitOnDone = true, quiet = false, childArgs } = {}) {
  const url = `http://127.0.0.1:${port}`;
  const existingPid = readDaemonPid();
  if (existingPid && isPidRunning(existingPid)) {
    if (!quiet) {
      printCliRows('后台服务', [
        ['状态', `已运行 (pid ${existingPid})`],
        ['地址', url],
        ['日志', daemonLogPath],
      ], `停止服务可运行：${brandCommand('stop')}`);
    }
    if (exitOnDone) process.exit(0);
    return { started: false, pid: existingPid, url, logPath: daemonLogPath };
  }

  mkdirSync(path.dirname(daemonPidPath), { recursive: true });
  mkdirSync(path.dirname(daemonLogPath), { recursive: true });
  const out = openSync(daemonLogPath, 'a');
  const err = openSync(daemonLogPath, 'a');
  const daemonChildArgs = childArgs ?? process.argv.slice(2).filter((arg) => arg !== '--daemon');
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...daemonChildArgs], {
    cwd: repoRoot,
    detached: true,
    env: {
      ...process.env,
      HERMIT_DAEMON_CHILD: '1',
    },
    stdio: ['ignore', out, err],
  });
  child.unref();
  closeSync(out);
  closeSync(err);
  writeFileSync(daemonPidPath, String(child.pid), 'utf-8');
  if (!quiet) {
    printCliRows('后台服务', [
      ['状态', `已启动 (pid ${child.pid})`],
      ['地址', url],
      ['日志', daemonLogPath],
    ], `停止服务可运行：${brandCommand('stop')}`);
  }
  if (exitOnDone) process.exit(0);
  return { started: true, pid: child.pid, url, logPath: daemonLogPath };
}

function safeReadJson(filePath) {
  try {
    return { value: JSON.parse(readFileSync(filePath, 'utf-8')) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function readHermitSettings() {
  if (!existsSync(hermitSettingsPath)) return {};
  const { value } = safeReadJson(hermitSettingsPath);
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function writeHermitSettings(settings) {
  const settingsDir = path.dirname(hermitSettingsPath);
  mkdirSync(settingsDir, { recursive: true, mode: 0o700 });
  chmodBestEffort(settingsDir, 0o700);
  writeFileSync(hermitSettingsPath, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
  chmodBestEffort(hermitSettingsPath, 0o600);
}

function buildTeamCollaborationTaskBusConfig(current = {}) {
  const existing = current && typeof current === 'object' ? current : {};
  const redis = existing.redis && typeof existing.redis === 'object'
    ? existing.redis
    : { host: '127.0.0.1', port: 6379 };
  const existingTelemetry = existing.telemetry && typeof existing.telemetry === 'object' ? existing.telemetry : {};
  return {
    ...existing,
    enabled: true,
    redis: {
      host: typeof redis.host === 'string' && redis.host.trim() ? redis.host : '127.0.0.1',
      port: Number.isFinite(Number(redis.port)) ? Number(redis.port) : 6379,
      ...(redis.password ? { password: redis.password } : {}),
      ...(redis.db !== undefined ? { db: redis.db } : {}),
    },
    collaboration: true,
    telemetry: {
      ...existingTelemetry,
      enabled: true,
      platform: 'claudecode',
    },
  };
}

function enableTeamCollaborationDefaults() {
  const settings = readHermitSettings();
  const taskBus = buildTeamCollaborationTaskBusConfig(settings.taskBus);
  writeHermitSettings({ ...settings, taskBus });
  return taskBus;
}

function listDirectoryNames(dirPath) {
  try {
    return readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function isSafeTeamArg(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9:_-]+$/.test(value) && !value.startsWith('-');
}

const KNOWN_HARNESSES = [
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
];

const CLI_MENU_WIDTH = 72;
const useAnsi = process.stdout.isTTY && process.env.NO_COLOR !== '1';
const useUnicodeUi = process.platform !== 'win32';
const glyphs = useUnicodeUi
  ? { h: '─', v: '│', tl: '╭', tr: '╮', ml: '├', mr: '┤', bl: '╰', br: '╯', dot: '●', pointer: '❯', checked: '✓', unchecked: ' ', caretOpen: '▾', caretClosed: '▸' }
  : { h: '-', v: '|', tl: '+', tr: '+', ml: '+', mr: '+', bl: '+', br: '+', dot: '*', pointer: '>', checked: 'x', unchecked: ' ', caretOpen: 'v', caretClosed: '>' };

function ansi(value, code) {
  return useAnsi ? `\x1b[${code}m${value}\x1b[0m` : value;
}

const ui = {
  bold: (value) => ansi(value, '1'),
  dim: (value) => ansi(value, '2'),
  accent: (value) => ansi(value, '36'),
  success: (value) => ansi(value, '32'),
  warn: (value) => ansi(value, '33'),
  danger: (value) => ansi(value, '31'),
};

function isValidBindProject(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]*$/.test(value);
}

function normalizeWorkDir(value) {
  const raw = String(value || '').trim().replace(/^～/, '~');
  if (!raw) return '';
  if (raw === '~') return os.homedir();
  if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
  return path.resolve(raw);
}

function generateBindProject(displayName) {
  const normalized = String(displayName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  if (isValidBindProject(normalized)) return normalized;
  const hash = crypto.createHash('sha1').update(String(displayName || 'team')).digest('hex').slice(0, 8);
  return `team-${hash}`;
}

function isHiddenTeam(manifest) {
  const slug = String(manifest?.slug || '');
  const bindProject = String(manifest?.bindProject || '');
  return (
    Boolean(manifest?.deletedAt || manifest?.pendingDelete) ||
    ['default', 'my-project', 'system-manager'].includes(slug) ||
    slug.startsWith('feishu:') ||
    bindProject.startsWith('feishu:')
  );
}

function collectTeams() {
  const teamsDir = path.join(hermitHome, 'teams');
  const warnings = [];
  const teams = [];

  for (const slug of listDirectoryNames(teamsDir)) {
    const manifestPath = path.join(teamsDir, slug, 'team.json');
    if (!existsSync(manifestPath)) continue;
    const { value, error } = safeReadJson(manifestPath);
    if (error || !value || typeof value !== 'object') {
      warnings.push({ path: manifestPath, message: error || 'Invalid team manifest' });
      continue;
    }
    const manifest = { ...value, slug: value.slug || slug };
    if (isHiddenTeam(manifest)) continue;
    teams.push({
      slug: manifest.slug,
      displayName: manifest.displayName || manifest.name || manifest.slug,
      bindProject: manifest.bindProject || manifest.slug,
      harness: manifest.harness || manifest.agentType || null,
      workDir: manifest.workDir || null,
      description: manifest.description || '',
      createdAt: manifest.createdAt || null,
      updatedAt: manifest.updatedAt || null,
      pendingDelete: Boolean(manifest.pendingDelete),
      deletedAt: manifest.deletedAt || null,
      restartRequired: Boolean(manifest.restartRequired),
    });
  }

  teams.sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  return { teams, warnings, teamsDir };
}

function resolveTeamSlug(teamArg, teams) {
  if (!isSafeTeamArg(teamArg)) return null;
  const directPath = path.join(hermitHome, 'teams', teamArg, 'team.json');
  if (existsSync(directPath)) return teamArg;
  return teams.find((team) => team.bindProject === teamArg || team.slug === teamArg)?.slug || teamArg;
}

function mapTaskStatus(status) {
  if (status === 'doing') return 'in_progress';
  if (status === 'done') return 'completed';
  return 'pending';
}

function collectTasks(teamArg) {
  const { teams, warnings } = collectTeams();
  const resolvedTeam = resolveTeamSlug(teamArg, teams);
  if (!resolvedTeam) {
    return {
      team: teamArg,
      resolvedTeam: null,
      tasks: [],
      warnings: [...warnings, { path: '', message: 'Invalid team argument' }],
      boardPath: null,
    };
  }
  const boardPath = path.join(hermitHome, 'teams', resolvedTeam, 'tasks', 'board.json');
  if (!existsSync(boardPath)) return { team: teamArg, resolvedTeam, tasks: [], warnings, boardPath };

  const { value, error } = safeReadJson(boardPath);
  if (error || !value || typeof value !== 'object') {
    return {
      team: teamArg,
      resolvedTeam,
      tasks: [],
      warnings: [...warnings, { path: boardPath, message: error || 'Invalid task board' }],
      boardPath,
    };
  }

  const rawTasks = Array.isArray(value.tasks) ? value.tasks : [];
  const tasks = rawTasks
    .filter((task) => task && task.result !== '__deleted__')
    .map((task) => ({
      id: task.id,
      displayId: typeof task.id === 'string' ? task.id.slice(0, 8) : '',
      subject: task.title || task.subject || '',
      description: task.description || '',
      status: mapTaskStatus(task.status),
      owner: task.assignee || task.owner || null,
      createdAt: task.createdAt || null,
      updatedAt: task.updatedAt || null,
      result: task.result && task.result !== '__deleted__' ? task.result : null,
      dispatchMeta: task.dispatchMeta || null,
    }));

  return { team: teamArg, resolvedTeam, tasks, warnings, boardPath };
}

async function printDoctor({ exitOnDone = true } = {}) {
  const status = await collectDaemonStatus();
  const checks = [
    { id: 'hermit-home', ok: existsSync(hermitHome), label: `${BRAND.productName} home`, path: hermitHome },
    { id: 'teams-dir', ok: existsSync(path.join(hermitHome, 'teams')), label: 'Teams directory', path: path.join(hermitHome, 'teams') },
    { id: 'daemon-pid', ok: status.pidfilePresent ? Boolean(status.pid) : true, label: 'Daemon pidfile', path: daemonPidPath },
    { id: 'server', ok: status.server.running, label: `${BRAND.stylizedName} HTTP server`, url: status.url },
    { id: 'bridge-config', ok: existsSync(hermitBridgeConfigPath), label: `${BRAND.runtimeBridgeName} config`, path: hermitBridgeConfigPath },
    { id: 'claude-projects', ok: existsSync(path.join(os.homedir(), '.claude', 'projects')), label: 'Claude Code projects', path: path.join(os.homedir(), '.claude', 'projects') },
  ];
  const result = { ok: checks.every((check) => check.ok), command: 'doctor', status, checks };

  if (jsonRequested) printJson(result, result.ok ? 0 : 1);

  console.log(`${BRAND.stylizedName} doctor`);
  for (const check of checks) {
    const target = check.path || check.url || '';
    console.log(`${check.ok ? 'OK' : 'ERR'} ${check.label}${target ? `: ${target}` : ''}`);
  }
  if (exitOnDone) process.exit(result.ok ? 0 : 1);
  return result;
}

function printTeamsList({ exitOnDone = true } = {}) {
  const result = { ok: true, command: 'teams list', hermitHome, ...collectTeams() };
  if (jsonRequested) printJson(result);

  if (result.teams.length === 0) {
    printCliRows('本地团队', [
      ['数量', '0'],
      ['路径', result.teamsDir],
    ], '创建团队可运行：openhermit teams create');
  } else {
    printCliRows('本地团队', [
      ['数量', `${result.teams.length} 个可见团队`],
      ['路径', result.teamsDir],
    ], '已删除或待删除的团队不会显示在这里。');
    for (const team of result.teams) {
      const harness = team.harness ? ` (${team.harness})` : '';
      console.log(`  ${team.slug}${harness} - ${team.displayName}`);
    }
  }
  for (const warning of result.warnings) {
    console.error(`${brandLogPrefix()} 警告：${warning.path}: ${warning.message}`);
  }
  if (exitOnDone) process.exit(0);
  return result;
}

function findOptionValue(name) {
  const index = commandArgs.indexOf(name);
  return index !== -1 ? commandArgs[index + 1] : undefined;
}

function findOptionValues(name) {
  const values = [];
  for (let index = 0; index < commandArgs.length; index += 1) {
    if (commandArgs[index] === name && commandArgs[index + 1] && !commandArgs[index + 1].startsWith('--')) {
      values.push(commandArgs[index + 1]);
    }
  }
  return values;
}

function findAnyOptionValues(names) {
  return names.flatMap((name) => findOptionValues(name));
}

function findAnyOptionValue(names) {
  for (const name of names) {
    const value = findOptionValue(name);
    if (value !== undefined) return value;
  }
  return undefined;
}

function isInteractiveCli() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function createPromptInterface() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on('SIGINT', cancelCli);
  return rl;
}

async function askText(rl, label, defaultValue = '') {
  const suffix = defaultValue ? `  默认：${defaultValue}` : '';
  const answer = (await rl.question(`\n${label}${suffix}\n› `)).trim();
  return answer || defaultValue;
}

async function askRequired(rl, label, defaultValue = '') {
  while (true) {
    const answer = await askText(rl, label, defaultValue);
    if (answer.trim()) return answer.trim();
    console.log('  这个值不能为空。');
  }
}

async function askChoice(rl, label, choices, defaultValue) {
  console.log(`\n${label}`);
  choices.forEach((choice, index) => {
    const marker = choice === defaultValue ? '  推荐' : '';
    console.log(`  ${index + 1}. ${choice}${marker}`);
  });
  while (true) {
    const answer = (await rl.question(`› 请选择 1-${choices.length}，直接回车使用 ${defaultValue}: `)).trim();
    if (!answer) return defaultValue;
    const index = Number.parseInt(answer, 10) - 1;
    if (Number.isInteger(index) && choices[index]) return choices[index];
    if (choices.includes(answer)) return answer;
    console.log('  无效选择，请重新输入。');
  }
}

function charDisplayWidth(char) {
  return /[ᄀ-ᅟ〈〉⺀-꓏가-힣豈-﫿︐-︙︰-﹯＀-｠￠-￦]/u.test(char) ? 2 : 1;
}

function stripAnsi(value) {
  return String(value).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function displayWidth(value) {
  return Array.from(stripAnsi(value)).reduce((sum, char) => sum + charDisplayWidth(char), 0);
}

function fitDisplay(value, width) {
  let result = '';
  let used = 0;
  for (const char of Array.from(String(value))) {
    const charWidth = charDisplayWidth(char);
    if (used + charWidth > width) break;
    result += char;
    used += charWidth;
  }
  return result + ' '.repeat(Math.max(0, width - used));
}

function truncateDisplay(value, width) {
  const raw = String(value);
  if (displayWidth(raw) <= width) return raw;

  let result = '';
  let used = 0;
  for (let i = 0; i < raw.length;) {
    if (raw[i] === '\x1b' && raw[i + 1] === '[') {
      const match = raw.slice(i).match(/^\x1B\[[0-?]*[ -/]*[@-~]/);
      if (match) {
        result += match[0];
        i += match[0].length;
        continue;
      }
    }
    const char = Array.from(raw.slice(i))[0];
    const charWidth = charDisplayWidth(char);
    if (used + charWidth > Math.max(0, width - 1)) break;
    result += char;
    used += charWidth;
    i += char.length;
  }
  return `${result}…`;
}

function statusDot(state) {
  const dot = glyphs.dot;
  if (state === 'ok') return ui.success(dot);
  if (state === 'warn') return ui.warn(dot);
  if (state === 'error') return ui.danger(dot);
  if (state === 'off') return ui.dim(dot);
  return ui.accent(dot);
}

function formatStatusPill(label, state = 'info') {
  return `${statusDot(state)} ${label}`;
}

function colorByState(value, state) {
  if (state === 'ok') return ui.success(value);
  if (state === 'warn') return ui.warn(value);
  if (state === 'error') return ui.danger(value);
  if (state === 'off') return ui.dim(value);
  return value;
}

function rowStateFromValue(value, fallback = 'info') {
  const text = stripAnsi(value);
  if (/失败|错误|异常|未运行|无效|不可用/u.test(text)) return 'error';
  if (/等待|未知|未连接|正在|请先/u.test(text)) return 'warn';
  if (/关闭|未登录|未启用|不支持/u.test(text)) return 'off';
  if (/开启|已启动|已运行|运行中|正常|已登录|成功/u.test(text)) return 'ok';
  return fallback;
}

function printStatusBar(items = []) {
  const visible = items.filter(Boolean);
  if (visible.length === 0) return;
  console.log(visible.map((item) => `${statusDot(item.state)} ${colorByState(item.label, item.state)}`).join(ui.dim('  ·  ')));
}

function boxLine(left, fill = glyphs.h, right = left) {
  return ui.dim(`${left}${fill.repeat(CLI_MENU_WIDTH)}${right}`);
}

function boxContentLine(content = '') {
  const maxContentWidth = CLI_MENU_WIDTH - 1;
  const visible = truncateDisplay(content, maxContentWidth);
  const padding = ' '.repeat(Math.max(0, maxContentWidth - displayWidth(visible)));
  return `${ui.dim(glyphs.v)} ${visible}${padding}${ui.dim(glyphs.v)}`;
}

function boxColumnsLine(left = '', right = '') {
  const maxContentWidth = CLI_MENU_WIDTH - 1;
  const rightVisible = truncateDisplay(right, 18);
  const leftWidth = Math.max(1, maxContentWidth - displayWidth(rightVisible) - 2);
  const leftVisible = truncateDisplay(left, leftWidth);
  const gap = ' '.repeat(Math.max(2, maxContentWidth - displayWidth(leftVisible) - displayWidth(rightVisible)));
  return `${ui.dim(glyphs.v)} ${leftVisible}${gap}${rightVisible}${ui.dim(glyphs.v)}`;
}

function menuColumnsLine(left = '', right = '') {
  const rightVisible = truncateDisplay(right, 18);
  const leftWidth = Math.max(1, CLI_MENU_WIDTH - displayWidth(rightVisible) - 2);
  const leftVisible = truncateDisplay(left, leftWidth);
  const gap = ' '.repeat(Math.max(2, CLI_MENU_WIDTH - displayWidth(leftVisible) - displayWidth(rightVisible)));
  return `${leftVisible}${gap}${rightVisible}`;
}

function printCliRows(title, rows = [], hint = '', options = {}) {
  if (options.screen === true && isInteractiveCli() && !jsonRequested) {
    clearTerminal();
    printWelcomeLogo();
    console.log(menuBrandTitle());
  }
  const labelWidth = Math.max(4, ...rows.map(([label]) => displayWidth(label)));
  console.log('');
  console.log(ui.bold(title));
  for (const [label, value, state] of rows) {
    const resolvedState = state || rowStateFromValue(value);
    console.log(`  ${statusDot(resolvedState)} ${fitDisplay(label, labelWidth)}  ${colorByState(value, resolvedState)}`);
  }
  if (hint) console.log(ui.dim(`\n提示: ${hint}`));
}

const NAV_ACTIONS = [
  {
    id: 'web',
    label: '本地数字员工工作台',
    description: '回车展开；在二级项里用 ✓ 表示已开启，回车可开启或关闭',
    recommended: true,
    children: [
      { id: 'toggle-web', label: '本地数字员工工作台', toggle: 'web' },
    ],
  },
  {
    id: 'data-sync',
    label: '用量上报',
    description: '回车展开；消息上报会启动后台增量扫描，首次补齐历史，后续只上传新增消息',
    children: [
      { id: 'toggle-message-upload', label: '消息上报', toggle: 'conversation-upload' },
      { id: 'overview', label: '查看同步状态' },
      { id: 'scan', label: '立即扫描并上报一次' },
      { id: 'upload-logs', label: '查看上报日志', developerOnly: true },
    ],
  },
  {
    id: 'account',
    label: '账号与云端',
    description: '回车展开；登录后可启用云端授权和托管能力',
    children: [
      { id: 'login', label: '登录 / OAuth 授权' },
      { id: 'status', label: '查看登录状态' },
      { id: 'logout', label: '退出登录' },
    ],
  },
  {
    id: 'exit',
    label: '退出',
    description: `离开 ${BRAND.stylizedName} 终端入口`,
  },
];

const WEB_ENTRY_ACTIONS = [
  {
    id: 'start-web',
    label: '开启本地数字员工工作台',
    description: '启动本机工作台；不影响用量上报后台进程',
    recommended: true,
  },
  {
    id: 'stop-web',
    label: '关闭本地数字员工工作台',
    description: '停止本机工作台；不影响用量上报后台进程',
  },
  {
    id: 'back',
    label: '取消 / 返回首页',
    description: `不修改工作台状态，回到 ${BRAND.stylizedName} 入口`,
  },
];

const SERVICE_ACTIONS = [
  {
    id: 'start-local',
    label: '启动本地基础服务',
    description: '启动 Web + Usage 后台采集 + 本地/自托管团队协作；无需登录，不上传',
    recommended: true,
  },
  {
    id: 'start-web',
    label: '只启动 Web 控制台',
    description: '启动本机 Web UI，不启动 usage worker',
  },
  {
    id: 'start-usage',
    label: '启动 Usage 后台采集',
    description: '轻量后台进程 + 默认开机自启；不上传',
  },
  {
    id: 'start-collaboration',
    label: '启用本地团队协作',
    description: '写入本地/自托管团队总线配置；不要求登录',
  },
  {
    id: 'status',
    label: '查看服务状态',
    description: '查看 Web daemon、usage worker 和本地协作状态',
  },
  {
    id: 'stop-usage',
    label: '停止 Usage 采集',
    description: '停止 usage worker 并关闭开机自启',
  },
  {
    id: 'stop-web',
    label: '停止 Web 控制台',
    description: '停止后台 daemon/runtime',
  },
  {
    id: 'back',
    label: '返回首页',
    description: `回到 ${BRAND.stylizedName} 导航`,
  },
];

const LOCAL_USE_ACTIONS = [
  {
    id: 'web',
    label: '打开本机 Web 控制台',
    description: `进入本机 ${BRAND.stylizedName} Web，适合本地设置和可视化管理`,
  },
  {
    id: 'employees',
    label: '数字员工',
    description: '本机团队创建、列表和管理',
  },
  {
    id: 'local-collection',
    label: '本地数据采集',
    description: '查看本机 Loop 使用概览；无需登录，不依赖 Redis',
  },
  {
    id: 'runtime',
    label: '本地运行时',
    description: '后台服务状态、诊断和生命周期管理',
  },
  {
    id: 'back',
    label: '返回首页',
    description: `回到 ${BRAND.stylizedName} 导航`,
  },
];

const TEAM_COLLAB_ACTIONS = [
  {
    id: 'open-web-settings',
    label: '打开协作设置',
    description: '进入 Web 设置 > 团队总线，管理 Redis 和协作配置',
  },
  {
    id: 'task-bus',
    label: '团队总线状态',
    description: '查看本地/自托管 Redis 和分布式协作状态',
  },
  {
    id: 'account',
    label: '账号状态',
    description: `查看或退出当前 ${BRAND.authAccountLabel}`,
  },
  {
    id: 'back',
    label: '返回首页',
    description: `回到 ${BRAND.stylizedName} 导航`,
  },
];

const EMPLOYEE_ACTIONS = [
  {
    id: 'create-team',
    label: '创建数字员工团队',
    description: '写入本地团队元数据',
  },
  {
    id: 'list-teams',
    label: '查看数字员工列表',
    description: '列出可见团队，隐藏已删除项',
  },
  {
    id: 'back',
    label: '返回首页',
    description: `回到 ${BRAND.stylizedName} 导航`,
  },
];

const RUNTIME_ACTIONS = [
  {
    id: 'status',
    label: '服务状态',
    description: '查看 daemon / Web URL',
  },
  {
    id: 'doctor',
    label: '本地诊断',
    description: '只读检查配置与服务',
  },
  {
    id: 'stop',
    label: '停止后台服务',
    description: '结束后台 daemon/runtime',
  },
  {
    id: 'back',
    label: '返回首页',
    description: `回到 ${BRAND.stylizedName} 导航`,
  },
];

const USAGE_UPLOAD_PROVIDER_OPTIONS = [
  { id: 'claudecode', label: 'Claude Code', description: '扫描本机 Claude Code 会话 usage，并按 ${BRAND.authProviderName} 消息上报协议分批增量上传' },
  { id: 'codex', label: 'Codex', description: '扫描本机 Codex 会话 usage，并按 ${BRAND.authProviderName} 消息上报协议分批增量上传' },
];

function normalizeUploadProviders(value) {
  const rawItems = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const items = rawItems.flatMap((item) => String(item).split(/[,+，、\s]+/u));
  const normalized = items
    .map((item) => String(item).trim())
    .filter((item) => USAGE_UPLOAD_PROVIDER_OPTIONS.some((option) => option.id === item));
  return Array.from(new Set(normalized));
}

function uploadProviderLabel(provider) {
  return USAGE_UPLOAD_PROVIDER_OPTIONS.find((option) => option.id === provider)?.label || provider;
}

function formatUploadProviders(providers) {
  const normalized = normalizeUploadProviders(providers);
  return normalized.length ? normalized.map(uploadProviderLabel).join(' + ') : '未选择';
}

const LOCAL_COLLECTION_ACTIONS = [
  {
    id: 'overview',
    label: '查看同步状态',
    description: '显示消息上报后台和本机扫描状态',
  },
  {
    id: 'scan',
    label: '立即扫描并上报一次',
    description: '立刻执行一次增量扫描；消息上报开启时会按游标只上传新增消息',
  },
  {
    id: 'choose-upload-provider',
    label: '开启消息上报',
    description: '默认同时扫描 Claude Code + Codex；按批次增量上传',
  },
  {
    id: 'stop-background',
    label: '停止消息上报',
    description: '停止消息上报 worker，并关闭开机自启',
  },
  {
    id: 'back',
    label: '返回首页',
    description: `回到 ${BRAND.stylizedName} 导航`,
  },
];

const TASK_BUS_ACTIONS = [
  {
    id: 'status',
    label: '查看团队总线状态',
    description: '显示本地/自托管 Redis 和分布式协作状态',
  },
  {
    id: 'open-web-settings',
    label: '打开 Web 设置',
    description: '配置入口：设置 > 团队总线',
  },
  {
    id: 'doctor',
    label: '本地诊断',
    description: '只读检查服务和本地路径',
  },
  {
    id: 'back',
    label: '返回首页',
    description: `回到 ${BRAND.stylizedName} 导航`,
  },
];

const ACCOUNT_ACTIONS = [
  {
    id: 'login',
    label: '登录 / OAuth 授权',
    description: '用于云端授权和托管服务；本地使用无需登录',
  },
  {
    id: 'status',
    label: '查看登录状态',
    description: `查看 ${BRAND.authAccountLabel} 授权状态`,
  },
  {
    id: 'logout',
    label: '退出登录',
    description: `退出 ${BRAND.authAccountLabel}，不影响本地 runtime 登录`,
  },
  {
    id: 'back',
    label: '返回首页',
    description: `回到 ${BRAND.stylizedName} 导航`,
  },
];

function findMenuAction(actions, actionId) {
  for (const action of actions) {
    if (action.id === actionId) return action;
    const child = action.children?.find((item) => item.id === actionId);
    if (child) return child;
  }
  return null;
}

function menuFooterForEscape() {
  return '[↑↓ move • Enter expand/confirm • ← back • Esc cancel]';
}

let optimisticWebRunningUntil = 0;

function markWebRunningOptimistic() {
  optimisticWebRunningUntil = Date.now() + 10 * 60_000;
}

function clearWebRunningOptimistic() {
  optimisticWebRunningUntil = 0;
}

function hasDeveloperModeEnabled() {
  return Boolean(readOpenHermitAuthStatus().developerMode);
}

function requireDeveloperMode() {
  if (hasDeveloperModeEnabled()) return true;
  printCliRows('开发者模式未开启', [
    ['状态', '未解锁', 'warn'],
    ['开启', 'openhermit auth dev-login <口令>', 'info'],
  ], '只有输入正确开发口令后才会显示详细日志。');
  return false;
}

function currentFeatureStates() {
  const auth = readOpenHermitAuthStatus();
  const webPid = readDaemonPid();
  const usagePid = readPidFile(telemetryWorkerPidPath);
  const settings = readHermitSettings();
  const telemetry = settings.taskBus?.telemetry && typeof settings.taskBus.telemetry === 'object'
    ? settings.taskBus.telemetry
    : {};
  const uploadProviders = normalizeUploadProviders(telemetry.uploadProviders || telemetry.platform || 'claudecode');
  return {
    auth,
    webPid,
    usagePid,
    webRunning: Boolean((webPid && isPidRunning(webPid)) || Date.now() < optimisticWebRunningUntil),
    usageRunning: Boolean(usagePid && isPidRunning(usagePid)),
    remoteUploadEnabled: Boolean(telemetry.uploadEnabled || telemetry.conversationUploadEnabled),
    conversationUploadEnabled: Boolean(telemetry.conversationUploadEnabled),
    uploadProviders,
  };
}

async function refreshWebRunningState(expectedPid = null) {
  const pid = expectedPid || readDaemonPid();
  const server = await checkExistingOpenHermitServer();
  if (server.running) {
    refreshDaemonPidFromReadyServer(pid || expectedPid);
    markWebRunningOptimistic();
    return true;
  }
  if (pid && isPidRunning(pid)) {
    markWebRunningOptimistic();
    return true;
  }
  clearWebRunningOptimistic();
  return false;
}

function currentMenuStatusItems(states = currentFeatureStates()) {
  return [
    { label: states.auth.authorized ? `登录 ${states.auth.account?.name || BRAND.authProviderName}` : '未登录', state: states.auth.authorized ? 'ok' : 'off' },
    { label: states.webRunning ? `Web ${port}` : 'Web 关闭', state: states.webRunning ? 'ok' : 'off' },
    { label: states.conversationUploadEnabled ? '消息上报' : '消息上报关闭', state: states.conversationUploadEnabled ? states.usageRunning ? 'ok' : 'warn' : 'off' },
  ];
}

function parseMenuKey(input) {
  const key = Buffer.isBuffer(input) ? input.toString('utf8') : String(input || '');
  if (key === '') return { type: 'exit' };
  if (key === '') return { type: 'exit' };
  if (key === '\r' || key === '\n' || key === '[C') return { type: 'choose' };
  if (key === ' ') return { type: 'toggle-expand' };
  if (key === '[D') return { type: 'back' };
  if (key === '[A' || key === '') return { type: 'move', delta: -1 };
  if (key === '[B' || key === '') return { type: 'move', delta: 1 };
  if (/^[1-9]$/u.test(key)) return { type: 'quick-select', index: Number.parseInt(key, 10) - 1 };
  return { type: 'unknown' };
}

function parseMenuKeys(input) {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input || '');
  const keys = [];
  for (let index = 0; index < text.length;) {
    const three = text.slice(index, index + 3);
    if (['[A', '[B', '[C', '[D'].includes(three)) {
      keys.push(parseMenuKey(three));
      index += 3;
      continue;
    }
    keys.push(parseMenuKey(text[index]));
    index += 1;
  }
  return keys;
}

function actionStateLabel(action, states) {
  if (['web', 'toggle-web', 'start-web'].includes(action.id)) return { text: states.webRunning ? 'running' : 'stopped', state: states.webRunning ? 'ok' : 'error' };
  if (action.toggle === 'conversation-upload' || action.id === 'toggle-message-upload') return { text: states.conversationUploadEnabled ? states.usageRunning ? formatUploadProviders(states.uploadProviders) : 'enabled' : 'stopped', state: states.conversationUploadEnabled ? states.usageRunning ? 'ok' : 'warn' : 'error' };
  if (action.id === 'choose-upload-provider') return { text: formatUploadProviders(states.uploadProviders), state: states.uploadProviders.length ? 'info' : 'warn' };
  if (['toggle-background', 'start-usage', 'start-background'].includes(action.id)) return { text: states.usageRunning ? 'running' : 'stopped', state: states.usageRunning ? 'ok' : 'error' };
  if (['data-sync', 'local-collection'].includes(action.id)) return { text: states.conversationUploadEnabled ? states.usageRunning ? 'running' : 'enabled' : 'stopped', state: states.conversationUploadEnabled ? states.usageRunning ? 'ok' : 'warn' : 'error' };
  if (action.id === 'stop-web' || action.id === 'stop-usage' || action.id === 'stop-background') return { text: 'stop', state: 'warn' };
  if (['account', 'login', 'status'].includes(action.id)) return { text: states.auth.authorized ? 'signed in' : 'signed out', state: states.auth.authorized ? 'ok' : 'off' };
  if (action.id === 'back') return { text: 'back', state: 'off' };
  if (action.id === 'exit') return { text: 'exit', state: 'off' };
  if (action.recommended) return { text: 'recommended', state: 'ok' };
  return { text: '', state: 'info' };
}

function visibleMenuRows(actions, expandedActionIds) {
  const rows = [];
  for (const action of actions) {
    if (action.developerOnly && !hasDeveloperModeEnabled()) continue;
    rows.push({ action, depth: 0 });
    if (expandedActionIds.has(action.id)) {
      for (const child of action.children || []) {
        if (child.developerOnly && !hasDeveloperModeEnabled()) continue;
        rows.push({ action: child, parent: action, depth: 1 });
      }
    }
  }
  return rows;
}

function menuBrandTitle() {
  return `${ui.accent('🦀')} ${ui.accent(ui.bold(BRAND.stylizedName))} ${ui.dim(`v${currentVersion}`)}`;
}

function logoBorderLine() {
  const columns = Number(process.stdout.columns || 80);
  const width = Math.max(32, Math.min(44, columns - 8));
  return ui.dim('…'.repeat(width));
}

function welcomeLogoLines() {
  return [
    logoBorderLine(),
    `        ${ui.accent('☀')}                    ${ui.dim('*')}      `,
    '              _     _              ',
    '           __(.)< <(.)__           ',
    '        __/             \\__        ',
    `   ${ui.dim('~')}   /  ${ui.accent('███████████')}  \\   ${ui.dim('~')}   `,
    `      |  ${ui.accent('██▄█████▄██')}  |      `,
    `       \\  ${ui.accent('█████████')}  /       `,
    `   ${ui.dim('~')}    /_/  /___\\  \\_\\   ${ui.dim('~')}    `,
    logoBorderLine(),
  ];
}

function printWelcomeLogo() {
  for (const line of welcomeLogoLines()) console.log(line);
}

function clearTerminal() {
  process.stdout.write('\x1b[2J\x1b[H');
}

let navigationIntroShown = false;

async function renderNavigationIntro() {
  if (navigationIntroShown || jsonRequested || !isInteractiveCli()) return;
  navigationIntroShown = true;
  clearTerminal();
  printWelcomeLogo();
  await new Promise((resolve) => setTimeout(resolve, 420));
}

function inlineBusyMessage(action) {
  if (action.id === 'toggle-web') {
    return currentFeatureStates().webRunning
      ? '本地数字员工工作台已运行，正在打开/确认状态...'
      : '正在启动本地数字员工工作台...';
  }
  if (action.id === 'toggle-message-upload') {
    return currentFeatureStates().conversationUploadEnabled
      ? '正在关闭消息上报...'
      : '正在开启消息上报...';
  }
  if (action.id === 'login') return `正在连接 ${BRAND.authProviderName} 授权服务...`;
  if (action.id === 'dev-login') return '请输入开发口令以开启开发者模式...';
  if (action.id === 'upload-logs') return '正在读取消息上报调试日志...';
  return `正在处理：${action.label}，请稍候...`;
}

function renderBusyScreen(title, message) {
  clearTerminal();
  console.log(menuBrandTitle());
  console.log(ui.bold(title));
  console.log(colorByState(message, 'warn'));
}

function renderNavMenu(title, subtitle, actions, selectedIndex, escapeAction = 'exit', expandedActionIds = new Set(), notice = '') {
  clearTerminal();
  printWelcomeLogo();
  const states = currentFeatureStates();
  console.log(menuBrandTitle());
  printStatusBar(currentMenuStatusItems(states));
  console.log(ui.bold(title));
  if (subtitle) console.log(ui.dim(subtitle));
  if (notice) console.log(colorByState(notice, 'warn'));

  const rows = visibleMenuRows(actions, expandedActionIds);
  for (const [index, row] of rows.entries()) {
    const { action, depth } = row;
    const focused = index === selectedIndex;
    const expanded = expandedActionIds.has(action.id);
    const pointer = focused ? ui.accent(glyphs.pointer) : ' ';
    const hasChildren = Boolean(action.children?.length);
    const caret = hasChildren ? (expanded ? glyphs.caretOpen : glyphs.caretClosed) : ' ';
    const state = actionStateLabel(action, states);
    const selected = action.toggle && state.state === 'ok';
    const marker = selected ? ui.success(glyphs.checked) : ' ';
    const label = selected ? ui.success(action.label) : focused ? ui.accent(action.label) : action.label;
    const right = depth === 0 && state.text ? colorByState(state.text, state.state) : '';
    const left = depth === 0
      ? `${pointer} ${caret} ${label}`
      : `${pointer}   ${marker} ${label}`;
    console.log(menuColumnsLine(left, right));
    if (focused && action.description) console.log(`    ${ui.dim(action.description)}`);
  }

  console.log(ui.dim(`${menuFooterForEscape(escapeAction)}  [1-${rows.length} quick]`));
}

async function askMenuAction({ title, subtitle, actions, escapeAction = 'exit', onAction = null }) {
  return new Promise((resolve) => {
    let selectedIndex = 0;
    let busy = false;
    let notice = '';
    const expandedActionIds = new Set();
    const stdin = process.stdin;

    function cleanup() {
      stdin.off('data', onData);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\x1b[?25h');
    }

    function choose(actionId) {
      cleanup();
      process.stdout.write('\n');
      resolve(actionId);
    }

    function repaint(nextNotice = notice) {
      notice = nextNotice;
      renderNavMenu(title, subtitle, actions, selectedIndex, escapeAction, expandedActionIds, notice);
    }

    function visibleRows() {
      return visibleMenuRows(actions, expandedActionIds);
    }

    async function chooseInline(row) {
      if (!onAction) return false;
      busy = true;
      stdin.off('data', onData);
      renderBusyScreen(title, inlineBusyMessage(row.action));
      try {
        const handled = await onAction(row.action, { row, repaint });
        if (!handled) return false;
        repaint('');
        return true;
      } finally {
        busy = false;
        stdin.on('data', onData);
      }
    }

    async function chooseCurrent() {
      const rows = visibleRows();
      const row = rows[selectedIndex];
      if (!row) return;
      if (row.depth === 0 && row.action.children?.length) {
        const wasExpanded = expandedActionIds.has(row.action.id);
        expandedActionIds.clear();
        if (!wasExpanded) {
          expandedActionIds.add(row.action.id);
          const firstChildIndex = visibleRows().findIndex((item) => item.parent?.id === row.action.id);
          selectedIndex = firstChildIndex === -1 ? selectedIndex : firstChildIndex;
        } else {
          selectedIndex = Math.min(selectedIndex, visibleRows().length - 1);
        }
        repaint();
        return;
      }
      if (await chooseInline(row)) return;
      choose(row.action.id);
    }

    function move(delta) {
      const rows = visibleRows();
      selectedIndex = (selectedIndex + delta + rows.length) % rows.length;
      repaint();
    }

    function toggleExpand() {
      const row = visibleRows()[selectedIndex];
      if (!row || row.depth !== 0) return;
      const actionId = row.action.id;
      const wasExpanded = expandedActionIds.has(actionId);
      expandedActionIds.clear();
      if (!wasExpanded) {
        expandedActionIds.add(actionId);
        const firstChildIndex = visibleRows().findIndex((item) => item.parent?.id === actionId);
        selectedIndex = firstChildIndex === -1 ? selectedIndex : firstChildIndex;
      } else {
        selectedIndex = Math.min(selectedIndex, visibleRows().length - 1);
      }
      repaint();
    }

    async function handleKey(key) {
      if (key.type === 'exit') {
        cleanup();
        cancelCli();
        return;
      }
      if (key.type === 'back') {
        if (escapeAction === 'stay') {
          repaint();
          return;
        }
        cleanup();
        resolve(escapeAction);
        return;
      }
      if (key.type === 'choose') {
        await chooseCurrent();
        return;
      }
      if (key.type === 'toggle-expand') {
        toggleExpand();
        return;
      }
      if (key.type === 'move') {
        move(key.delta);
        return;
      }
      if (key.type === 'quick-select') {
        const rows = visibleRows();
        if (rows[key.index]) {
          selectedIndex = key.index;
          await chooseCurrent();
        }
      }
    }

    async function onData(chunk) {
      if (busy) {
        repaint('正在处理上一个操作，请稍候...');
        return;
      }
      for (const key of parseMenuKeys(chunk)) {
        if (busy) break;
        await handleKey(key);
      }
    }

    process.stdout.write('\x1b[?25l');
    repaint();
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

function printNavigationActions() {
  const result = {
    ok: true,
    command: 'navigate',
    message: `${BRAND.stylizedName} 入口按意图分为本地使用和团队协作；本地使用和本地/自托管团队协作无需登录，云端上传/托管能力需要登录。`,
    defaultAction: 'services',
    actions: NAV_ACTIONS,
  };
  if (jsonRequested) printJson(result);

  printCliRows(BRAND.stylizedName, [
    ['本地使用', '无需登录，本机 Web / 数字员工 / 本地采集'],
    ['团队协作', '无需登录，本地/自托管协作先启用；上传/托管稍后登录开启'],
    ['CLI 职责', '本地控制面状态和生命周期'],
  ]);
  for (const action of NAV_ACTIONS) {
    console.log(`- ${action.id}: ${action.label}`);
    console.log(`  ${action.description}`);
  }
  console.log('\n也可以直接运行：openhermit teams create | teams list | tasks list | usage status | usage today | usage report | doctor | status | auth status | stop');
  process.exit(0);
}

async function waitForNavigationContinue(message = '按 Enter 返回 | ← 返回上一级 | Esc/Ctrl+C 退出', options = {}) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const keepMenuInput = Boolean(options.keepMenuInput);

    function cleanup() {
      stdin.off('data', onData);
      if (!keepMenuInput) {
        if (stdin.isTTY) stdin.setRawMode(false);
        stdin.pause();
      }
    }

    function finish(result) {
      cleanup();
      resolve(result);
    }

    function onData(chunk) {
      for (const key of parseMenuKeys(chunk)) {
        if (key.type === 'choose') {
          finish('continue');
          return;
        }
        if (key.type === 'back') {
          finish('back');
          return;
        }
        if (key.type === 'exit') {
          cleanup();
          cancelCli();
          return;
        }
      }
    }

    console.log('');
    console.log(ui.dim(message));
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function fetchLocalJson(pathname, options = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    ...options,
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function formatStatusToggle(value) {
  if (value === true) return '开启';
  if (value === false) return '关闭';
  return '未知';
}

function formatNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function emptyUsageTelemetryStatus() {
  return {
    connected: false,
    lastScan: null,
    sessions: 0,
    messages: 0,
    tokensIn: 0,
    tokensOut: 0,
    cacheRead: 0,
    cacheCreation: 0,
    totalTokens: 0,
    activeDays: 0,
    hourly: Array.from({ length: 24 }, () => 0),
    projects: [],
    workSecondsByDay: {},
    daily: {},
    localUsers: [],
    unresolvedUsage: { sessions: 0, messages: 0, tokensTotal: 0 },
  };
}

function usageDaemonPayload(server) {
  return {
    running: Boolean(server?.running),
    url: server?.url || `http://127.0.0.1:${port}`,
    version: server?.version || '',
  };
}

function telemetryWorkerPayload({ status = null, statusError = '', autostart = null } = {}) {
  const pid = readPidFile(telemetryWorkerPidPath);
  const running = Boolean(pid && isPidRunning(pid));
  return {
    running,
    pid: running ? pid : null,
    pidfilePresent: Boolean(pid),
    pidPath: telemetryWorkerPidPath,
    statusPath: telemetryWorkerStatusPath,
    logPath: telemetryWorkerLogPath,
    errorLogPath: telemetryWorkerErrorLogPath,
    lastStatus: status,
    statusError,
    autostart,
  };
}

function readPidFile(pidPath) {
  try {
    const raw = readFileSync(pidPath, 'utf-8').trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function readTelemetryWorkerStatusFile() {
  if (!existsSync(telemetryWorkerStatusPath)) return { status: null, error: '' };
  const { value, error } = safeReadJson(telemetryWorkerStatusPath);
  if (error) return { status: null, error };
  return value && typeof value === 'object' ? { status: value, error: '' } : { status: null, error: 'invalid status file' };
}

function telemetryFromWorkerStatus(status) {
  return status?.telemetry && typeof status.telemetry === 'object' ? status.telemetry : emptyUsageTelemetryStatus();
}

async function fetchBackendUsageStatus() {
  const daemon = await collectDaemonStatus();
  if (!daemon.server?.running) return null;
  try {
    const telemetry = await fetchLocalJson('/api/telemetry/status');
    const autostart = await getUsageAutostartStatus();
    return {
      daemon: usageDaemonPayload(daemon.server),
      worker: telemetry.worker || telemetryWorkerPayload({ status: null, autostart }),
      telemetry,
      source: 'backend-api',
    };
  } catch {
    return null;
  }
}

async function readUsageStatus({ scan = false, localOnly = false } = {}) {
  if (scan) return scanUsageTelemetryOnce({ localOnly });
  const backend = await fetchBackendUsageStatus();
  if (backend) return backend;
  const { status, error } = readTelemetryWorkerStatusFile();
  const autostart = await getUsageAutostartStatus();
  return {
    daemon: usageDaemonPayload({ running: false, url: `http://127.0.0.1:${port}`, version: '' }),
    worker: telemetryWorkerPayload({ status, statusError: error, autostart }),
    telemetry: telemetryFromWorkerStatus(status),
    source: 'claude-jsonl',
  };
}

function conversationUploadRows(upload = {}, auth = readOpenHermitAuthStatus()) {
  const waitingLogin = upload.lastError === '等待登录';
  const statusText = waitingLogin && auth.authorized ? '已登录，等待下一次增量扫描上报' : upload.lastError;
  const failed = Boolean(statusText) && !waitingLogin;
  const confirmed = Number(upload.accepted || 0) + Number(upload.duplicated || 0);
  const failedCount = Number(upload.failed || 0);
  const queued = Number(upload.queued || 0);
  const statusState = waitingLogin ? 'warn' : failed ? 'error' : 'info';
  return [
    ['历史消息', upload.totalDiscovered === undefined ? '等待扫描' : `${formatNumber(upload.totalDiscovered)} 条已发现`, 'info'],
    ['本次增量', upload.pending === undefined ? '等待扫描' : `${formatNumber(upload.pending)} 条待上报`, upload.pending ? 'warn' : 'ok'],
    ['已跳过', upload.skippedAlreadyUploaded === undefined ? '等待扫描' : `${formatNumber(upload.skippedAlreadyUploaded)} 条已上报`, 'info'],
    ['已尝试发送', `${formatNumber(upload.attempted || 0)} 条`, upload.attempted ? failed ? 'warn' : 'ok' : 'info'],
    ['服务端确认', `${formatNumber(confirmed)} 条（${formatNumber(upload.accepted || 0)} 接收 / ${formatNumber(upload.duplicated || 0)} 重复 / ${formatNumber(upload.rejected || 0)} 拒绝${failedCount ? ` / ${formatNumber(failedCount)} 失败` : ''}${queued ? ` / ${formatNumber(queued)} 排队` : ''}）`, upload.rejected || failedCount || failed ? 'warn' : 'info'],
    ...(upload.lastUploadStatus ? [['批次状态', upload.lastUploadStatus, failed ? 'error' : 'info']] : []),
    ...(statusText ? [['错误日志', statusText, statusState], ['本地游标', '未推进，后续会按 eventId 幂等重试', failed ? 'warn' : 'info']] : []),
  ];
}

function printUsageRows(title, data, hint) {
  const states = currentFeatureStates();
  const auth = readOpenHermitAuthStatus();
  const upload = data.telemetry.conversationUpload;
  const uploadEnabled = Boolean(states.conversationUploadEnabled || upload?.enabled);
  const workerText = states.usageRunning ? `后台运行中 (pid ${states.usagePid})，每 5 分钟增量扫描` : '后台未运行';
  const uploadText = uploadEnabled
    ? auth.authorized ? workerText : `${workerText}，等待登录授权`
    : '关闭';
  printCliRows(title, [
    ['消息上报', uploadText, uploadEnabled ? auth.authorized ? states.usageRunning ? 'ok' : 'warn' : 'warn' : 'off'],
    ['最近扫描', data.telemetry.lastScan ? new Date(data.telemetry.lastScan).toLocaleString('zh-CN') : '等待首次扫描', data.telemetry.lastScan ? 'ok' : 'warn'],
    ['会话数', formatNumber(data.telemetry.sessions), 'info'],
    ['消息数', formatNumber(data.telemetry.messages), 'info'],
    ['Token 总量', formatNumber(data.telemetry.totalTokens), 'info'],
    ['来源', `${formatUploadProviders(states.uploadProviders)} 本地消息记录`, 'info'],
    ...(uploadEnabled && upload ? conversationUploadRows(upload, auth) : []),
  ], hint || '消息上报会后台增量扫描：首次补齐历史消息，后续只上报新增消息。');
}

async function printUsageStatus({ exitOnDone = true } = {}) {
  try {
    const data = await readUsageStatus({ scan: false });
    const result = { ok: true, command: 'usage status', hermitHome, ...data };
    if (jsonRequested) printJson(result);
    printUsageRows('用量上报状态', data, data.daemon.running ? '触发扫描：openhermit usage report' : '启动本地采集：openhermit usage start');
    if (exitOnDone) process.exit(0);
    return result;
  } catch (err) {
    const result = { ok: false, command: 'usage status', hermitHome, error: err instanceof Error ? err.message : String(err) };
    if (jsonRequested) printJson(result, 1);
    console.error(`${brandLogPrefix()} usage status 失败：${result.error}`);
    if (exitOnDone) process.exit(1);
    return result;
  }
}

function todayUsageFromStatus(status) {
  const date = todayKey();
  const daily = status.daily?.[date];
  return {
    date,
    sessions: daily?.sessions ?? 0,
    messages: daily?.messages ?? 0,
    tokensIn: daily?.tokensIn ?? 0,
    tokensOut: daily?.tokensOut ?? 0,
    cacheRead: daily?.cacheRead ?? 0,
    cacheCreation: daily?.cacheCreation ?? 0,
    totalTokens: daily?.tokensTotal ?? 0,
    workSeconds: daily?.workSeconds ?? status.workSecondsByDay?.[date] ?? 0,
  };
}

async function printUsageToday({ exitOnDone = true } = {}) {
  try {
    const data = await readUsageStatus({ scan: false });
    const today = todayUsageFromStatus(data.telemetry);
    const result = { ok: true, command: 'usage today', hermitHome, daemon: data.daemon, worker: data.worker, source: data.source, today };
    if (jsonRequested) printJson(result);
    printCliRows('今日用量', [
      ['日期', today.date],
      ['后台扫描', data.worker?.running ? `运行中 (pid ${data.worker.pid})` : '未运行'],
      ['会话数', formatNumber(today.sessions)],
      ['消息数', formatNumber(today.messages)],
      ['Token 总量', formatNumber(today.totalTokens)],
      ['工作时长（秒）', formatNumber(today.workSeconds)],
      ['来源', 'Claude Code 本地消息记录'],
    ], data.daemon.running ? '刷新统计：openhermit usage report' : '启动本地采集：openhermit usage start');
    if (exitOnDone) process.exit(0);
    return result;
  } catch (err) {
    const result = { ok: false, command: 'usage today', hermitHome, error: err instanceof Error ? err.message : String(err) };
    if (jsonRequested) printJson(result, 1);
    console.error(`${brandLogPrefix()} usage today 失败：${result.error}`);
    if (exitOnDone) process.exit(1);
    return result;
  }
}

function getFlagValue(flag) {
  const index = commandArgs.indexOf(flag);
  if (index < 0) return '';
  const value = commandArgs[index + 1];
  return value && !value.startsWith('--') ? value : '';
}

function setConversationUploadEnabled(enabled, providers = null) {
  const selectedProviders = providers == null ? null : normalizeUploadProviders(providers);
  const settings = readHermitSettings();
  const existing = settings.taskBus && typeof settings.taskBus === 'object' ? settings.taskBus : {};
  const telemetry = existing.telemetry && typeof existing.telemetry === 'object' ? existing.telemetry : {};
  const uploadProviders = selectedProviders ?? normalizeUploadProviders(telemetry.uploadProviders || ['claudecode']);
  const taskBus = {
    ...existing,
    telemetry: {
      ...telemetry,
      enabled: true,
      platform: uploadProviders[0] || telemetry.platform || 'claudecode',
      uploadProviders,
      conversationUploadEnabled: Boolean(enabled),
      conversations: {
        ...(telemetry.conversations && typeof telemetry.conversations === 'object' ? telemetry.conversations : {}),
        uploadEnabled: Boolean(enabled),
        baseUrl: resolveConversationUploadBaseUrl(telemetry.conversations?.baseUrl),
      },
    },
  };
  writeHermitSettings({ ...settings, taskBus });
  return taskBus;
}

function buildLocalUsageTaskBusConfig(current = {}) {
  const existing = current && typeof current === 'object' ? current : {};
  const redis = existing.redis && typeof existing.redis === 'object'
    ? existing.redis
    : { host: '127.0.0.1', port: 6379 };
  const existingTelemetry = existing.telemetry && typeof existing.telemetry === 'object' ? existing.telemetry : {};
  const uploadProviders = normalizeUploadProviders(existingTelemetry.uploadProviders || ['claudecode']);
  return {
    ...existing,
    enabled: Boolean(existing.enabled),
    redis: {
      host: typeof redis.host === 'string' && redis.host.trim() ? redis.host : '127.0.0.1',
      port: Number.isFinite(Number(redis.port)) ? Number(redis.port) : 6379,
      ...(redis.password ? { password: redis.password } : {}),
      ...(redis.db !== undefined ? { db: redis.db } : {}),
    },
    telemetry: {
      ...existingTelemetry,
      enabled: true,
      uploadEnabled: Boolean(existingTelemetry.uploadEnabled),
      conversationUploadEnabled: Boolean(existingTelemetry.conversationUploadEnabled),
      uploadProviders,
      platform: uploadProviders[0] || existingTelemetry.platform || 'claudecode',
    },
  };
}

function enableLocalUsageTelemetry() {
  const settings = readHermitSettings();
  const taskBus = buildLocalUsageTaskBusConfig(settings.taskBus);
  writeHermitSettings({ ...settings, taskBus });
  return taskBus;
}

function disableLocalUsageTelemetry() {
  const settings = readHermitSettings();
  const existing = settings.taskBus && typeof settings.taskBus === 'object' ? settings.taskBus : {};
  const telemetry = existing.telemetry && typeof existing.telemetry === 'object' ? existing.telemetry : {};
  const taskBus = {
    ...existing,
    telemetry: {
      ...telemetry,
      enabled: false,
      platform: telemetry.platform || 'claudecode',
    },
  };
  writeHermitSettings({ ...settings, taskBus });
  return taskBus;
}

function telemetryWorkerChildArgs(extraArgs = []) {
  return ['--import', resolveAliasLoaderRegister(), '--import', resolveTsxLoader(), 'src/main/telemetry/worker.ts', ...extraArgs];
}

function startTelemetryWorker({ quiet = false } = {}) {
  const existingPid = readPidFile(telemetryWorkerPidPath);
  if (existingPid && isPidRunning(existingPid)) {
    return { started: false, running: true, pid: existingPid, pidPath: telemetryWorkerPidPath, statusPath: telemetryWorkerStatusPath, logPath: telemetryWorkerLogPath };
  }

  if (process.env.OPENHERMIT_USAGE_WORKER_MODE === 'test') {
    mkdirSync(telemetryDir, { recursive: true, mode: 0o700 });
    writeFileSync(telemetryWorkerPidPath, String(process.pid), { encoding: 'utf-8', mode: 0o600 });
    writeFileSync(telemetryWorkerStatusPath, `${JSON.stringify({
      schemaVersion: 1,
      state: 'idle',
      running: true,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastScan: null,
      source: 'claude-jsonl',
      telemetryEnabled: true,
      telemetry: emptyUsageTelemetryStatus(),
    }, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
    return { started: true, running: true, pid: process.pid, pidPath: telemetryWorkerPidPath, statusPath: telemetryWorkerStatusPath, logPath: telemetryWorkerLogPath, mode: 'test' };
  }

  mkdirSync(telemetryDir, { recursive: true, mode: 0o700 });
  mkdirSync(path.dirname(telemetryWorkerLogPath), { recursive: true, mode: 0o700 });
  const out = openSync(telemetryWorkerLogPath, 'a');
  const err = openSync(telemetryWorkerErrorLogPath, 'a');
  const child = spawn(process.execPath, telemetryWorkerChildArgs(), {
    cwd: repoRoot,
    detached: true,
    env: { ...process.env, HERMIT_HOME: hermitHome },
    stdio: ['ignore', out, err],
  });
  child.unref();
  closeSync(out);
  closeSync(err);
  writeFileSync(telemetryWorkerPidPath, String(child.pid), { encoding: 'utf-8', mode: 0o600 });
  if (!quiet) console.error(`${brandLogPrefix()} usage telemetry worker started: pid ${child.pid}`);
  return { started: true, running: true, pid: child.pid, pidPath: telemetryWorkerPidPath, statusPath: telemetryWorkerStatusPath, logPath: telemetryWorkerLogPath };
}

async function stopTelemetryWorker() {
  const pid = readPidFile(telemetryWorkerPidPath);
  if (!pid) return { stopped: false, pid: null, running: false };
  if (pid === process.pid && process.env.OPENHERMIT_USAGE_WORKER_MODE === 'test') {
    removeTelemetryWorkerPidFile();
    return { stopped: true, pid, running: false, mode: 'test' };
  }
  if (isPidRunning(pid)) {
    signalDaemon(pid, 'SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    if (isPidRunning(pid)) signalDaemon(pid, 'SIGKILL');
  }
  removeTelemetryWorkerPidFile();
  return { stopped: true, pid, running: false };
}

function removeTelemetryWorkerPidFile() {
  try {
    unlinkSync(telemetryWorkerPidPath);
  } catch {
    // Already gone.
  }
}

async function runTelemetryWorkerScanOnce({ localOnly = false, scanDisabled = false } = {}) {
  const child = spawn(process.execPath, telemetryWorkerChildArgs(['--scan-once']), {
    cwd: repoRoot,
    env: {
      ...process.env,
      HERMIT_HOME: hermitHome,
      ...(localOnly ? { HERMIT_USAGE_FORCE_LOCAL_ONLY: '1' } : {}),
      ...(scanDisabled ? { HERMIT_USAGE_SCAN_DISABLED: '1' } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
  const code = await new Promise((resolve) => child.on('exit', resolve));
  if (code !== 0) throw new Error(stderr.trim() || `telemetry worker scan exited with ${code}`);
  const parsed = JSON.parse(stdout.trim() || '{}');
  return parsed.status?.telemetry ? parsed.status.telemetry : emptyUsageTelemetryStatus();
}

async function scanUsageTelemetryOnce({ localOnly = false } = {}) {
  if (process.env.OPENHERMIT_USAGE_WORKER_MODE === 'test') {
    const { status } = readTelemetryWorkerStatusFile();
    const autostart = await getUsageAutostartStatus();
    return {
      daemon: usageDaemonPayload({ running: false, url: `http://127.0.0.1:${port}`, version: '' }),
      worker: telemetryWorkerPayload({ status, autostart }),
      telemetry: telemetryFromWorkerStatus(status),
      source: 'claude-jsonl',
    };
  }
  const telemetry = await runTelemetryWorkerScanOnce({ localOnly, scanDisabled: localOnly });
  const { status } = readTelemetryWorkerStatusFile();
  const autostart = await getUsageAutostartStatus();
  return {
    daemon: usageDaemonPayload({ running: false, url: `http://127.0.0.1:${port}`, version: '' }),
    worker: telemetryWorkerPayload({ status, autostart }),
    telemetry,
    source: 'claude-jsonl',
  };
}

function usageLaunchdLabel() {
  return 'com.openhermit.telemetry';
}

function usageLaunchdPlistPath() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${usageLaunchdLabel()}.plist`);
}

function xmlEscape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function buildUsageLaunchdPlist() {
  const pathValue = process.env.PATH || '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n\t<key>Label</key>\n\t<string>${usageLaunchdLabel()}</string>\n\t<key>ProgramArguments</key>\n\t<array>\n\t\t<string>${xmlEscape(process.execPath)}</string>\n\t\t<string>${xmlEscape(fileURLToPath(import.meta.url))}</string>\n\t\t<string>__telemetry-worker</string>\n\t</array>\n\t<key>EnvironmentVariables</key>\n\t<dict>\n\t\t<key>HERMIT_HOME</key>\n\t\t<string>${xmlEscape(hermitHome)}</string>\n\t\t<key>PATH</key>\n\t\t<string>${xmlEscape(pathValue)}</string>\n\t</dict>\n\t<key>RunAtLoad</key>\n\t<true/>\n\t<key>KeepAlive</key>\n\t<dict>\n\t\t<key>SuccessfulExit</key>\n\t\t<false/>\n\t</dict>\n\t<key>ThrottleInterval</key>\n\t<integer>30</integer>\n\t<key>StandardOutPath</key>\n\t<string>${xmlEscape(telemetryWorkerLogPath)}</string>\n\t<key>StandardErrorPath</key>\n\t<string>${xmlEscape(telemetryWorkerErrorLogPath)}</string>\n</dict>\n</plist>\n`;
}

function launchctlBestEffort(args) {
  if (process.env.OPENHERMIT_SKIP_LAUNCHCTL === '1') return { ok: true, output: 'skipped' };
  try {
    const output = execSync(`launchctl ${args.map((arg) => JSON.stringify(arg)).join(' ')}`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, output };
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : String(err) };
  }
}

async function getUsageAutostartStatus() {
  const plistPath = usageLaunchdPlistPath();
  if (process.platform !== 'darwin') return { supported: false, enabled: false, loaded: false, label: usageLaunchdLabel(), plistPath };
  const print = launchctlBestEffort(['print', `gui/${process.getuid?.() ?? ''}/${usageLaunchdLabel()}`]);
  return { supported: true, enabled: existsSync(plistPath), loaded: print.ok, label: usageLaunchdLabel(), plistPath };
}

async function enableUsageAutostart() {
  const plistPath = usageLaunchdPlistPath();
  if (process.platform !== 'darwin') return getUsageAutostartStatus();
  mkdirSync(path.dirname(plistPath), { recursive: true });
  mkdirSync(path.dirname(telemetryWorkerLogPath), { recursive: true, mode: 0o700 });
  writeFileSync(plistPath, buildUsageLaunchdPlist(), 'utf-8');
  const uid = process.getuid?.();
  if (uid !== undefined) {
    launchctlBestEffort(['bootout', `gui/${uid}`, plistPath]);
    launchctlBestEffort(['bootstrap', `gui/${uid}`, plistPath]);
    launchctlBestEffort(['enable', `gui/${uid}/${usageLaunchdLabel()}`]);
    launchctlBestEffort(['kickstart', '-k', `gui/${uid}/${usageLaunchdLabel()}`]);
  }
  return getUsageAutostartStatus();
}

async function disableUsageAutostart() {
  const plistPath = usageLaunchdPlistPath();
  const uid = process.getuid?.();
  if (process.platform === 'darwin' && uid !== undefined) launchctlBestEffort(['bootout', `gui/${uid}`, plistPath]);
  try { unlinkSync(plistPath); } catch {}
  return getUsageAutostartStatus();
}

async function withCliProgress(label, task) {
  if (jsonRequested || !process.stdout.isTTY) return task();
  const frames = useUnicodeUi ? ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] : ['-', '\\', '|', '/'];
  let index = 0;
  process.stdout.write(`${ui.dim(frames[index])} ${label}`);
  const timer = setInterval(() => {
    index = (index + 1) % frames.length;
    process.stdout.write(`\r${ui.dim(frames[index])} ${label}`);
  }, 120);
  try {
    return await task();
  } finally {
    clearInterval(timer);
    process.stdout.write(`\r${' '.repeat(displayWidth(`${frames[0]} ${label}`) + 4)}\r`);
  }
}


function readConversationUploadLogEvents(limit = 200) {
  if (!existsSync(conversationUploadLogPath)) return [];
  const lines = readFileSync(conversationUploadLogPath, 'utf-8').trim().split('\n').filter(Boolean).slice(-limit);
  return lines.flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function latestConversationUploadProgress() {
  const events = readConversationUploadLogEvents();
  let latestScan = null;
  let latestBatch = null;
  let latestFailure = null;
  for (const event of events) {
    if (event.message === 'scan-collected') latestScan = event;
    if (event.message === 'upload-batch-start' || event.message === 'upload-batch-finished') latestBatch = event;
    if (event.message === 'upload-batch-failed' || event.message === 'upload-failed') latestFailure = event;
  }
  return { latestScan, latestBatch, latestFailure };
}

function uploadProgressLabel() {
  const { latestScan, latestBatch, latestFailure } = latestConversationUploadProgress();
  if (!latestScan) return '扫描本地消息中';
  const total = Number(latestBatch?.totalMessages ?? latestScan.pendingPlain ?? latestScan.pending ?? 0);
  if (!latestBatch) return `发现 ${formatNumber(Number(latestScan.totalDiscovered || 0))} 条，准备上报`;
  const done = Number(
    latestBatch.attemptedAfterFailure
      ?? latestBatch.attemptedAfterBatch
      ?? latestBatch.uploadedAfterBatch
      ?? latestBatch.uploadedBeforeBatch
      ?? latestBatch.uploadedBeforeFailure
      ?? 0
  );
  const batchIndex = Number(latestBatch.batchIndex || 0);
  const totalBatches = Number(latestBatch.totalBatches || 0);
  const percent = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const failed = latestFailure && latestFailure.timestamp >= latestBatch.timestamp;
  const state = failed ? '失败' : percent >= 100 ? '完成' : '上报中';
  return `${percent}% 批次 ${batchIndex}/${totalBatches} 消息 ${formatNumber(done)}/${formatNumber(total)} ${state}`;
}

function fitProgressLine(text) {
  const columns = Math.max(40, Number(process.stdout.columns || 80));
  const maxWidth = Math.max(20, columns - 2);
  if (displayWidth(text) <= maxWidth) return text;
  let result = '';
  for (const char of text) {
    if (displayWidth(`${result}${char}…`) > maxWidth) break;
    result += char;
  }
  return `${result}…`;
}

async function withUploadProgress(label, task) {
  if (jsonRequested || !process.stdout.isTTY) return task();
  let lastWidth = 0;
  const render = () => {
    const text = fitProgressLine(`${label} ${uploadProgressLabel()}`);
    process.stdout.write(`\r\x1b[2K${ui.dim(text)}`);
    lastWidth = displayWidth(text);
  };
  render();
  const timer = setInterval(render, 500);
  try {
    return await task();
  } finally {
    clearInterval(timer);
    process.stdout.write(`\r\x1b[2K${' '.repeat(Math.max(0, lastWidth))}\r\x1b[2K`);
  }
}

async function printUsageReport({ exitOnDone = true } = {}) {
  try {
    const auth = readOpenHermitAuthStatus();
    const states = currentFeatureStates();
    if (states.conversationUploadEnabled && !auth.authorized) {
      const result = {
        ok: false,
        command: 'usage report',
        hermitHome,
        error: `${BRAND.stylizedName} login required for message upload`,
        auth: { authorized: false },
        upload: { enabled: true, authorized: false },
      };
      if (jsonRequested) printJson(result, 1);
      printCliRows('用量上报报告', [
        ['消息上报', '已开启，但未登录', 'warn'],
        ['本次扫描', '已取消，避免扫描后无法上报', 'warn'],
        ['下一步', '先执行 openhermit auth login', 'info'],
      ], '立即扫描并上报需要 Bearer 登录授权；登录后再执行会按本地游标只上传新增消息。');
      if (exitOnDone) process.exit(1);
      return result;
    }

    const data = await withUploadProgress('正在执行一次增量扫描并按需上报...', () => readUsageStatus({ scan: true, localOnly: false }));
    const upload = data.telemetry.conversationUpload;
    const result = {
      ok: true,
      command: 'usage report',
      hermitHome,
      localOnly: false,
      upload: {
        enabled: Boolean(upload?.enabled),
        authorized: readOpenHermitAuthStatus().authorized,
        attempted: upload?.attempted || 0,
        accepted: upload?.accepted || 0,
        duplicated: upload?.duplicated || 0,
        rejected: upload?.rejected || 0,
      },
      ...data,
    };
    if (jsonRequested) printJson(result);
    printUsageRows('用量上报报告', data, '已执行一次增量扫描；消息上报开启时会按本地游标只上传新增消息。');
    if (exitOnDone) process.exit(0);
    return result;
  } catch (err) {
    const result = { ok: false, command: 'usage report', hermitHome, error: err instanceof Error ? err.message : String(err) };
    if (jsonRequested) printJson(result, 1);
    console.error(`${brandLogPrefix()} usage report 失败：${result.error}`);
    if (exitOnDone) process.exit(1);
    return result;
  }
}

function getUploadProvidersFromFlags() {
  const values = findAnyOptionValues(['--upload-provider', '--provider', '--providers']);
  return normalizeUploadProviders(values).length ? normalizeUploadProviders(values) : ['claudecode'];
}

function getUploadProviderFromFlags() {
  return getUploadProvidersFromFlags()[0] || 'claudecode';
}

async function printUsageStart({ exitOnDone = true } = {}) {
  const autostartRequested = !commandArgs.includes('--no-autostart');
  const shouldEnableConversationUpload = args.includes('--upload') || args.includes('--upload-conversations');
  if (shouldEnableConversationUpload) {
    const providers = getUploadProvidersFromFlags();
    setConversationUploadEnabled(providers.length > 0, providers);
  }
  const taskBus = enableLocalUsageTelemetry();
  const worker = startTelemetryWorker({ quiet: jsonRequested });
  const autostart = autostartRequested ? await enableUsageAutostart() : await getUsageAutostartStatus();
  const result = {
    ok: true,
    command: 'usage start',
    hermitHome,
    worker,
    daemon: usageDaemonPayload({ running: false, url: `http://127.0.0.1:${port}`, version: '' }),
    autostart,
    telemetry: {
      localScanEnabled: true,
      source: 'claude-jsonl',
    },
    auth: {
      authorized: readOpenHermitAuthStatus().authorized,
    },
  };
  if (jsonRequested) printJson(result);
  const auth = readOpenHermitAuthStatus();
  const conversationUploadEnabled = Boolean(taskBus.telemetry?.conversationUploadEnabled);
  printCliRows('消息上报后台已启动', [
    ['消息上报', conversationUploadEnabled ? auth.authorized ? `开启（pid ${worker.pid}）` : `等待登录（pid ${worker.pid}）` : '关闭', conversationUploadEnabled ? auth.authorized ? 'ok' : 'warn' : 'off'],
    ['日志', worker.logPath, 'info'],
    ['开机自启', autostart.enabled ? '开启' : '关闭', autostart.enabled ? 'ok' : 'off'],
    ['模式', '首次补齐全部历史，后续只上报增量', 'info'],
    ['归因', 'Claude Code + IM 会话归因', 'info'],
  ], conversationUploadEnabled
    ? '消息上报会启动后台增量扫描；需要登录后用 Bearer 授权发送。'
    : '消息上报已关闭；开启后首次补齐历史消息，之后只上传新增消息。');
  if (exitOnDone) process.exit(0);
  return result;
}

async function printUsageStop({ exitOnDone = true } = {}) {
  const disableAutostart = !commandArgs.includes('--keep-autostart');
  const taskBus = disableLocalUsageTelemetry();
  const worker = await stopTelemetryWorker();
  const autostart = disableAutostart ? await disableUsageAutostart() : await getUsageAutostartStatus();
  const result = {
    ok: true,
    command: 'usage stop',
    hermitHome,
    worker,
    autostart,
    telemetry: {
      localScanEnabled: Boolean(taskBus.telemetry?.enabled),
      source: 'claude-jsonl',
    },
  };
  if (jsonRequested) printJson(result);
  printCliRows('用量上报已停止', [
    ['后台扫描', worker.stopped ? `已停止 (pid ${worker.pid})` : '未运行'],
    ['开机自启', autostart.enabled ? '开启' : '关闭'],
    ['本地扫描', '关闭'],
  ], autostart.enabled ? '如需保留开机自启：openhermit usage stop --keep-autostart' : '重新启动：openhermit usage start');
  if (exitOnDone) process.exit(0);
  return result;
}

async function printUsageAutostart({ exitOnDone = true } = {}) {
  const action = commandArgs[2] || 'status';
  let autostart;
  if (action === 'enable') autostart = await enableUsageAutostart();
  else if (action === 'disable') autostart = await disableUsageAutostart();
  else if (action === 'status') autostart = await getUsageAutostartStatus();
  else {
    const result = { ok: false, command: `usage autostart ${action}`, error: `Unknown usage autostart action: ${action}` };
    if (jsonRequested) printJson(result, 1);
    console.error(`${brandLogPrefix()} 未知 usage autostart 动作：${action}`);
    if (exitOnDone) process.exit(1);
    return result;
  }
  const result = { ok: true, command: `usage autostart ${action}`, hermitHome, autostart };
  if (jsonRequested) printJson(result);
  printCliRows('用量上报开机自启', [
    ['支持', autostart.supported ? '是' : '否'],
    ['状态', autostart.enabled ? '开启' : '关闭'],
    ['已加载', autostart.loaded ? '是' : '否'],
    ['Label', autostart.label],
    ['Plist', autostart.plistPath],
  ]);
  if (exitOnDone) process.exit(0);
  return result;
}

function summarizeTaskBus(taskBus = {}) {
  const redis = taskBus.redis && typeof taskBus.redis === 'object' ? taskBus.redis : { host: '127.0.0.1', port: 6379 };
  return {
    enabled: Boolean(taskBus.enabled),
    collaboration: Boolean(taskBus.collaboration),
    redis: {
      host: typeof redis.host === 'string' && redis.host.trim() ? redis.host : '127.0.0.1',
      port: Number.isFinite(Number(redis.port)) ? Number(redis.port) : 6379,
      ...(redis.password ? { password: true } : {}),
      ...(redis.db !== undefined ? { db: redis.db } : {}),
    },
    telemetry: {
      enabled: Boolean(taskBus.telemetry?.enabled),
      platform: taskBus.telemetry?.platform || 'claudecode',
    },
  };
}

async function collectServicesStatus() {
  const [daemon, usage] = await Promise.all([
    collectDaemonStatus(),
    readUsageStatus({ scan: false }),
  ]);
  const taskBus = summarizeTaskBus(readHermitSettings().taskBus || {});
  return {
    hermitHome,
    web: {
      running: Boolean(daemon.running),
      pid: daemon.pid || null,
      url: daemon.server?.url || daemon.url,
      logPath: daemonLogPath,
    },
    usage: {
      enabled: taskBus.telemetry.enabled,
      worker: usage.worker,
      autostart: usage.worker?.autostart || null,
      source: 'claude-jsonl',
    },
    collaboration: {
      enabled: Boolean(taskBus.enabled && taskBus.collaboration),
      redis: taskBus.redis,
    },
    auth: {
      authorized: readOpenHermitAuthStatus().authorized,
    },
  };
}

function printServicesRows(title, status, hint = '') {
  printCliRows(title, [
    ['Web 控制台', status.web.running ? `运行中 ${status.web.url}` : '未运行'],
    ['用量后台', status.usage.worker?.running ? `运行中 (pid ${status.usage.worker.pid})` : '未运行'],
    ['用量统计', status.usage.enabled ? '本地扫描开启' : '关闭'],
    ['团队协作', status.collaboration.enabled ? '开启' : '关闭'],
    ['Redis', `${status.collaboration.redis.host}:${status.collaboration.redis.port}`],
    ['账号', status.auth.authorized ? '已登录' : '未登录'],
  ], hint);
}

async function printServicesStatus({ exitOnDone = true } = {}) {
  const status = await collectServicesStatus();
  const result = { ok: true, command: 'services status', ...status, actions: SERVICE_ACTIONS };
  if (jsonRequested) printJson(result);
  printServicesRows('服务状态', status, '启动本地基础服务：openhermit services start local');
  if (exitOnDone) process.exit(0);
  return result;
}

async function startUsageService({ autostartRequested = !args.includes('--no-autostart') } = {}) {
  enableLocalUsageTelemetry();
  const worker = startTelemetryWorker({ quiet: true });
  const autostart = autostartRequested ? await enableUsageAutostart() : await getUsageAutostartStatus();
  return {
    enabled: true,
    worker,
    autostart,
    source: 'claude-jsonl',
  };
}

async function stopUsageService() {
  const taskBus = disableLocalUsageTelemetry();
  const worker = await stopTelemetryWorker();
  const autostart = await disableUsageAutostart();
  return {
    enabled: Boolean(taskBus.telemetry?.enabled),
    worker,
    autostart,
    source: 'claude-jsonl',
  };
}

function startCollaborationService() {
  return summarizeTaskBus(enableTeamCollaborationDefaults());
}

function startWebService() {
  if (process.env.OPENHERMIT_SERVICE_WEB_MODE === 'test') {
    return { running: true, started: true, pid: process.pid, url: `http://127.0.0.1:${port}`, logPath: daemonLogPath, mode: 'test' };
  }
  const daemon = startDaemon({ exitOnDone: false, quiet: true });
  return { running: true, ...daemon };
}

async function runServiceAction(actionId) {
  if (actionId === 'start-local') {
    const web = startWebService();
    const usage = await startUsageService();
    const collaboration = startCollaborationService();
    return { ok: true, command: 'services start local', hermitHome, web, usage, collaboration, auth: { authorized: readOpenHermitAuthStatus().authorized } };
  }
  if (actionId === 'start-web') return { ok: true, command: 'services start web', hermitHome, web: startWebService() };
  if (actionId === 'start-usage') return { ok: true, command: 'services start usage', hermitHome, usage: await startUsageService() };
  if (actionId === 'start-collaboration') return { ok: true, command: 'services start collaboration', hermitHome, collaboration: startCollaborationService(), auth: { authorized: readOpenHermitAuthStatus().authorized } };
  if (actionId === 'stop-usage') return { ok: true, command: 'services stop usage', hermitHome, usage: await stopUsageService() };
  if (actionId === 'stop-web') return { ok: true, command: 'services stop web', hermitHome, web: await stopDaemon({ exitOnDone: false, quiet: true }) };
  if (actionId === 'status') return printServicesStatus({ exitOnDone: false });
  throw new Error(`Unknown services action: ${actionId}`);
}

function serviceActionIdForCommand(verb, target) {
  if (!verb) return 'status';
  if (verb === 'status') return 'status';
  if (verb === 'start') {
    if (target === 'local') return 'start-local';
    if (target === 'web') return 'start-web';
    if (target === 'usage') return 'start-usage';
    if (target === 'collaboration') return 'start-collaboration';
  }
  if (verb === 'stop') {
    if (target === 'usage') return 'stop-usage';
    if (target === 'web') return 'stop-web';
  }
  return null;
}

async function printServicesCommand({ exitOnDone = true } = {}) {
  if (commandArgs.length === 1 && !jsonRequested && isInteractiveCli()) {
    await runServicesMenu();
    if (exitOnDone) process.exit(0);
    return { ok: true, command: 'services' };
  }
  const actionId = serviceActionIdForCommand(commandArgs[1], commandArgs[2]);
  if (!actionId) {
    const command = commandArgs.join(' ');
    const result = { ok: false, command, error: `Unknown services action: ${command}` };
    if (jsonRequested) printJson(result, 1);
    console.error(`${brandLogPrefix()} 未知 services 动作：${command}`);
    if (exitOnDone) process.exit(1);
    return result;
  }
  const result = await runServiceAction(actionId);
  if (jsonRequested) printJson(result);
  if (actionId === 'status') return result;
  const status = await collectServicesStatus();
  printServicesRows('服务已更新', status, '继续定制可运行：openhermit services');
  if (exitOnDone) process.exit(0);
  return result;
}

async function runServicesMenu() {
  while (true) {
    const actionId = await askMenuAction({
      title: '服务菜单',
      subtitle: '选择要启动/停止的本地服务；本地基础服务无需登录',
      actions: SERVICE_ACTIONS,
      escapeAction: 'back',
    });
    if (actionId === 'back') return;
    try {
      await runServiceAction(actionId);
      const status = await collectServicesStatus();
      printServicesRows('服务已更新', status);
    } catch (err) {
      printCliRows('服务操作失败', [['原因', err instanceof Error ? err.message : String(err)]], '上传/托管能力需要先运行 openhermit auth login。');
    }
    await waitForNavigationContinue('按 Enter/← 返回服务菜单 | Esc/Ctrl+C 退出');
  }
}

async function openWebSettingsTaskBus() {
  console.log('');
  console.log('正在后台启动 Web 控制台...');
  startDaemon({ exitOnDone: false, quiet: true });
  printCliRows('Web 设置入口', [
    ['状态', '已启动本机 Web 控制台'],
    ['地址', `http://127.0.0.1:${port}`],
    ['进入', '设置 > 团队总线'],
  ], 'Redis/IM/协作配置都在 Web 中管理。');
}

async function printLocalCollectionOverview() {
  const server = await checkExistingOpenHermitServer();
  if (!server.running) {
    printCliRows('本地数据采集', [
      ['状态', 'Web 未运行，暂无法读取 Loop 使用概览'],
      ['模式', '本地扫描，无需登录，不依赖 Redis'],
      ['隐私', '不上传对话内容'],
    ], '打开 Web 控制台，进入 设置 > 团队总线 > 本地数据采集。');
    return;
  }

  try {
    const status = await fetchLocalJson('/api/telemetry/status');
    printCliRows('Loop 使用概览', [
      ['采集会话', formatNumber(status.sessions)],
      ['消息数', formatNumber(status.messages)],
      ['Token 总量', formatNumber(status.totalTokens)],
      ['最近采集', status.lastScan ? new Date(status.lastScan).toLocaleString('zh-CN') : '-'],
      ['隐私', '本地扫描，不上传提示词、回复、路径或原始记录'],
    ]);
  } catch (err) {
    printCliRows('本地数据采集', [
      ['状态', '读取失败'],
      ['原因', err instanceof Error ? err.message : String(err)],
      ['模式', '本地扫描，无需登录，不依赖 Redis'],
    ], '打开 Web 控制台，进入 设置 > 团队总线 > 本地数据采集。');
  }
}

async function triggerLocalCollectionScan() {
  const server = await checkExistingOpenHermitServer();
  if (!server.running) {
    printCliRows('本地数据采集', [
      ['状态', 'Web 未运行，CLI 不重复实现扫描配置'],
      ['进入', '设置 > 团队总线 > 本地数据采集'],
    ], '请先打开 Web 控制台。');
    return;
  }

  try {
    await fetchLocalJson('/api/telemetry/scan', { method: 'POST' });
    await printLocalCollectionOverview();
  } catch (err) {
    printCliRows('立即采集失败', [
      ['原因', err instanceof Error ? err.message : String(err)],
      ['进入', 'Web 设置 > 团队总线 > 本地数据采集'],
    ], '请在 Web 中重试。');
  }
}

async function printTaskBusStatus() {
  const server = await checkExistingOpenHermitServer();
  if (!server.running) {
    printCliRows('团队总线状态', [
      ['状态', 'Web 未运行，无法确认实时 Redis 连接'],
      ['Redis', '仅用于本地/自托管团队总线'],
      ['Usage 统计', '仅扫描本机 Claude Code JSONL'],
    ], '配置入口：Web 设置 > 团队总线。');
    return;
  }

  try {
    const [config, telemetry] = await Promise.all([
      fetchLocalJson('/api/settings/task-bus'),
      fetchLocalJson('/api/telemetry/status').catch(() => null),
    ]);
    printCliRows('团队总线状态', [
      ['团队总线', formatStatusToggle(config.enabled)],
      ['Redis', telemetry?.connected ? '已连接' : config.enabled ? '未连接/未知' : '未启用'],
      ['Usage 统计', config.telemetry?.enabled ? '本地扫描开启' : '关闭'],
      ['分布式协作', formatStatusToggle(config.collaboration)],
      ['边界', 'Redis 仅用于本地/自托管协作，Usage 统计不上传'],
    ], '配置入口：Web 设置 > 团队总线。');
  } catch (err) {
    printCliRows('团队总线状态', [
      ['状态', '读取失败'],
      ['原因', err instanceof Error ? err.message : String(err)],
    ], '配置入口：Web 设置 > 团队总线。');
  }
}

async function chooseUploadProviderPrompt(defaultProviders = ['claudecode', 'codex']) {
  const defaults = normalizeUploadProviders(defaultProviders);
  printCliRows('选择消息上报来源', USAGE_UPLOAD_PROVIDER_OPTIONS.map((option, index) => [
    `${index + 1}. ${option.label}`,
    option.description,
    defaults.includes(option.id) ? 'ok' : 'info',
  ]), '可多选：输入 1,2 同时上报 Claude Code + Codex；直接回车默认全选。');

  if (!process.stdin.isTTY) return defaults.length ? defaults : ['claudecode'];
  const rl = createPromptInterface();
  try {
    const answer = (await rl.question('\n请选择 [1/2/1,2]，默认 1,2: ')).trim();
    if (!answer) return defaults.length ? defaults : ['claudecode', 'codex'];
    const tokens = answer.split(/[,+，、\s]+/u).filter(Boolean);
    const selected = tokens.flatMap((token) => {
      if (token === '1') return ['claudecode'];
      if (token === '2') return ['codex'];
      if (/^(all|both|全部|全选)$/iu.test(token)) return ['claudecode', 'codex'];
      return [token.toLowerCase()];
    });
    const normalized = normalizeUploadProviders(selected);
    return normalized.length ? normalized : defaults;
  } finally {
    rl.close();
  }
}

async function enableConversationUploadWithProvider(providers = ['claudecode', 'codex']) {
  const selectedProviders = normalizeUploadProviders(providers);
  const enabledProviders = selectedProviders.length ? selectedProviders : ['claudecode', 'codex'];
  const taskBus = setConversationUploadEnabled(true, enabledProviders);
  await runNavigationAction({ id: 'start-background' });
  return { taskBus, providers: enabledProviders, started: true };
}

async function runLocalCollectionAction() {
  while (true) {
    const actionId = await askMenuAction({
      title: '用量上报',
      subtitle: '本地扫描可免登录；消息上报支持多选 Claude Code / Codex，按批次增量上传',
      actions: LOCAL_COLLECTION_ACTIONS,
      escapeAction: 'back',
    });
    if (actionId === 'back') return;
    if (actionId === 'overview') await printUsageStatus({ exitOnDone: false });
    if (actionId === 'scan') await printUsageReport({ exitOnDone: false });
    if (actionId === 'choose-upload-provider') await enableConversationUploadWithProvider();
    if (actionId === 'start-background') await printUsageStart({ exitOnDone: false });
    if (actionId === 'stop-background') await printUsageStop({ exitOnDone: false });
    await waitForNavigationContinue('按 Enter 返回用量上报菜单 | Esc/Ctrl+C 退出（后台继续运行）');
  }
}

async function runTaskBusAction() {
  while (true) {
    const actionId = await askMenuAction({
      title: '团队总线',
      subtitle: '本地 / 自托管 Redis 与协作状态 | 配置入口：Web 设置 > 团队总线',
      actions: TASK_BUS_ACTIONS,
      escapeAction: 'back',
    });
    if (actionId === 'back') return;
    if (actionId === 'status') await printTaskBusStatus();
    if (actionId === 'open-web-settings') await openWebSettingsTaskBus();
    if (actionId === 'doctor') await printDoctor({ exitOnDone: false });
    await waitForNavigationContinue('按 Enter 返回团队总线菜单 | Ctrl+C 退出');
  }
}

async function runAccountAction() {
  while (true) {
    const actionId = await askMenuAction({
      title: '登录状态',
      subtitle: `本地使用无需登录；云端授权、托管服务或显式上传需要 ${BRAND.authAccountLabel}`,
      actions: ACCOUNT_ACTIONS,
      escapeAction: 'back',
    });
    if (actionId === 'back') return;
    if (actionId === 'status') await printAuthStatus({ exitOnDone: false });
    if (actionId === 'login') await runAuthLogin({ exitOnDone: false, interactiveMenu: true });
    if (actionId === 'logout') await runAuthLogout({ exitOnDone: false });
    if (actionId === 'dev-login') await runAuthDevLogin({ exitOnDone: false });
    await waitForNavigationContinue('按 Enter/← 返回登录状态菜单 | Esc/Ctrl+C 退出');
  }
}

async function runLocalUseAction() {
  while (true) {
    const actionId = await askMenuAction({
      title: '本地使用',
      subtitle: '无需登录 | 本机 Web、数字员工、本地采集和运行时',
      actions: LOCAL_USE_ACTIONS,
      escapeAction: 'back',
    });
    if (actionId === 'back') return;
    const action = findMenuAction(LOCAL_USE_ACTIONS, actionId);
    if (action) await runNavigationAction(action);
  }
}

async function printCollaborationStart({ exitOnDone = true } = {}) {
  const auth = readOpenHermitAuthStatus();
  const taskBus = enableTeamCollaborationDefaults();
  const result = {
    ok: true,
    command: 'collaboration start',
    hermitHome,
    taskBus: {
      enabled: Boolean(taskBus.enabled),
      collaboration: Boolean(taskBus.collaboration),
      redis: taskBus.redis,
      telemetry: {
        enabled: Boolean(taskBus.telemetry?.enabled),
        platform: taskBus.telemetry?.platform || 'claudecode',
      },
    },
    auth: {
      authorized: auth.authorized,
    },
  };
  if (jsonRequested) printJson(result);
  printCliRows('团队协作已准备好', [
    ['账号', auth.authorized ? `已登录 ${BRAND.authProviderName}` : '未登录（本地/自托管协作可用）'],
    ['Redis', `${taskBus.redis.host}:${taskBus.redis.port}`],
    ['配置入口', 'Web 设置 > 团队总线'],
  ], 'Redis 仅用于本地/自托管团队协作；Usage 统计不会上传。');
  if (exitOnDone) process.exit(0);
  return result;
}

async function runTeamCollaborationAction() {
  const result = await printCollaborationStart({ exitOnDone: false });
  const auth = result.auth;
  const taskBus = result.taskBus;
  const nextAction = await waitForNavigationContinue('按 Enter/→ 进入团队协作菜单 | ← 返回首页 | Esc/Ctrl+C 退出');
  if (nextAction === 'back') return;

  while (true) {
    const actionId = await askMenuAction({
      title: '团队协作',
      subtitle: auth.authorized ? '已登录 | Redis 配置已写入本机设置' : '未登录 | 本地/自托管协作可用',
      actions: TEAM_COLLAB_ACTIONS,
      escapeAction: 'back',
    });
    if (actionId === 'back') return;
    if (actionId === 'open-web-settings') await openWebSettingsTaskBus();
    if (actionId === 'task-bus') await printTaskBusStatus();
    if (actionId === 'account') await runAccountAction();
    await waitForNavigationContinue('按 Enter/← 返回团队协作菜单 | Esc/Ctrl+C 退出');
  }
}

async function runEmployeeAction() {
  while (true) {
    const actionId = await askMenuAction({
      title: '数字员工',
      subtitle: '团队、任务与协作入口',
      actions: EMPLOYEE_ACTIONS,
      escapeAction: 'back',
    });
    if (actionId === 'back') return;
    if (actionId === 'create-team') {
      await printTeamsCreate({ exitOnDone: false });
      await waitForNavigationContinue('按 Enter 返回数字员工菜单 | Ctrl+C 退出');
      continue;
    }
    if (actionId === 'list-teams') {
      printTeamsList({ exitOnDone: false });
      await waitForNavigationContinue('按 Enter 返回数字员工菜单 | Ctrl+C 退出');
    }
  }
}

async function runRuntimeAction() {
  while (true) {
    const actionId = await askMenuAction({
      title: '本地运行时',
      subtitle: 'Web / daemon / runtime 生命周期管理',
      actions: RUNTIME_ACTIONS,
      escapeAction: 'back',
    });
    if (actionId === 'back') return;
    if (actionId === 'status') {
      await printDaemonStatus({ exitOnDone: false });
      await waitForNavigationContinue('按 Enter 返回本地运行时菜单 | Ctrl+C 退出');
      continue;
    }
    if (actionId === 'doctor') {
      await printDoctor({ exitOnDone: false });
      await waitForNavigationContinue('按 Enter 返回本地运行时菜单 | Ctrl+C 退出');
      continue;
    }
    if (actionId === 'stop') {
      await stopDaemon({ exitOnDone: false });
      await waitForNavigationContinue('按 Enter 返回本地运行时菜单 | Ctrl+C 退出');
    }
  }
}

async function runNavigationAction(action) {
  if (action.id === 'web' || action.id === 'toggle-web') {
    await runNavigationAction({ id: currentFeatureStates().webRunning ? 'stop-web' : 'start-web' });
    return;
  }
  if (action.id === 'toggle-background') {
    await runNavigationAction({ id: currentFeatureStates().usageRunning ? 'stop-background' : 'start-background' });
    return;
  }
  if (action.id === 'toggle-message-upload') {
    const states = currentFeatureStates();
    if (!states.conversationUploadEnabled || !states.usageRunning) {
      await enableConversationUploadWithProvider();
      return;
    }
    setConversationUploadEnabled(false, states.uploadProviders);
    const updatedStates = currentFeatureStates();
    printCliRows('消息上报', [
      ['状态', '已关闭', 'off'],
      ['菜单显示', updatedStates.conversationUploadEnabled ? '仍显示开启，请刷新状态' : '已更新为关闭', updatedStates.conversationUploadEnabled ? 'warn' : 'ok'],
      ['来源', formatUploadProviders(states.uploadProviders), 'info'],
      ['说明', '后台扫描仍可保留；消息正文不会继续上报', 'info'],
    ], '再次开启后会读取本地游标，只上传未上报过的新增消息。');
    return;
  }
  if (action.id === 'start-web') {
    const daemon = startDaemon({ exitOnDone: false, quiet: true });
    const ready = await waitForOpenHermitServerReady(daemon.pid);
    if (ready.ready) {
      refreshDaemonPidFromReadyServer(daemon.pid);
      markWebRunningOptimistic();
      printCliRows('本地数字员工工作台', [
        ['状态', daemon.started ? '已启动并可打开' : '已运行并可打开', 'ok'],
        ['地址', ready.url || daemon.url, 'info'],
        ['设置', '复杂配置请在工作台中完成', 'info'],
      ]);
      return;
    }
    printCliRows('本地数字员工工作台', [
      ['状态', '启动失败或仍在启动中', 'error'],
      ['地址', daemon.url, 'info'],
      ['日志', daemon.logPath, 'info'],
      ['原因', ready.reason, 'warn'],
    ], '已打印最近日志，按提示处理后再重试。');
    printLogTail(BRAND.stylizedName, daemon.logPath);
    return;
  }
  if (action.id === 'stop-web') {
    await stopDaemon({ exitOnDone: false, quiet: true });
    printCliRows('本地数字员工工作台', [
      ['状态', '已关闭', 'off'],
      ['用量上报', '不受影响', 'info'],
    ]);
    return;
  }
  if (action.id === 'overview') {
    await printUsageStatus({ exitOnDone: false });
    return;
  }
  if (action.id === 'scan') {
    await printUsageReport({ exitOnDone: false });
    return;
  }
  if (action.id === 'start-background') {
    await printUsageStart({ exitOnDone: false });
    return;
  }
  if (action.id === 'stop-background') {
    await printUsageStop({ exitOnDone: false });
    return;
  }
  if (action.id === 'upload-logs') {
    printDeveloperUploadLogs();
    return;
  }
  if (action.id === 'login') {
    await runAuthLogin({ exitOnDone: false, interactiveMenu: true });
    return;
  }
  if (action.id === 'logout') {
    await runAuthLogout({ exitOnDone: false });
    return;
  }
  if (action.id === 'dev-login') {
    await runAuthDevLogin({ exitOnDone: false });
    return;
  }
  if (action.id === 'status') {
    await printAuthStatus({ exitOnDone: false });
    return;
  }
  if (action.id === 'local-use') {
    await runLocalUseAction();
    return;
  }
  if (action.id === 'data-sync') {
    await runLocalCollectionAction();
    return;
  }
  if (action.id === 'services') {
    await runServicesMenu();
    return;
  }
  if (action.id === 'team-collaboration') {
    await runTeamCollaborationAction();
    return;
  }
  if (action.id === 'local-collection') {
    await runLocalCollectionAction();
    return;
  }
  if (action.id === 'task-bus') {
    await runTaskBusAction();
    return;
  }
  if (action.id === 'account') {
    await runAccountAction();
    return;
  }
  if (action.id === 'employees') {
    await runEmployeeAction();
    return;
  }
  if (action.id === 'runtime') {
    await runRuntimeAction();
    return;
  }
  if (action.id === 'exit') cancelCli();
}

async function printNavigation() {
  if (!isInteractiveCli() || jsonRequested) printNavigationActions();
  await renderNavigationIntro();
  await refreshOpenHermitAuthStatus();
  await refreshWebRunningState();

  while (true) {
    const actionId = await askMenuAction({
      title: '选择入口',
      subtitle: '↑/↓ 或 Ctrl-N/Ctrl-P 移动，Enter 执行；✓ 表示已开启，执行后停留在当前页面',
      actions: NAV_ACTIONS,
      onAction: async (action) => {
        if (!['toggle-web', 'toggle-message-upload', 'overview', 'scan', 'upload-logs', 'login', 'logout', 'dev-login', 'status'].includes(action.id)) return false;
        await runNavigationAction(action);
        await waitForNavigationContinue('按 Enter 回到菜单 | Esc/Ctrl+C 退出', { keepMenuInput: true });
        return true;
      },
    });
    const action = findMenuAction(NAV_ACTIONS, actionId);
    if (!action) {
      console.error(`${brandLogPrefix()} 未知操作：${actionId}`);
      await waitForNavigationContinue();
      continue;
    }

    try {
      await runNavigationAction(action);
    } catch (err) {
      console.error(`${ui.danger('ERR')} ${err instanceof Error ? err.message : String(err)}`);
      await waitForNavigationContinue();
    }
  }
}

function buildTeamCreateSeed() {
  const displayName = findAnyOptionValue(['--name', '--display-name']) || commandArgs[2] || '';
  return {
    displayName,
    bindProject: findOptionValue('--bind-project') || '',
    workDir: findAnyOptionValue(['--work-dir', '--cwd']) || '',
    harness: findOptionValue('--harness') || 'claudecode',
  };
}

async function promptForMissingTeamCreateFields(seed) {
  if (!isInteractiveCli()) return seed;

  const rl = createPromptInterface();
  try {
    const displayName = seed.displayName || (await askRequired(rl, '团队名称'));
    const bindProjectDefault = seed.bindProject || generateBindProject(displayName);
    const bindProject = seed.bindProject || (await askRequired(rl, '团队 ID / bindProject', bindProjectDefault));
    const workDir = seed.workDir || (await askRequired(rl, '工作目录', process.cwd()));
    const harness = seed.harness && KNOWN_HARNESSES.includes(seed.harness)
      ? seed.harness
      : await askChoice(rl, '选择运行时', KNOWN_HARNESSES, 'claudecode');
    return { displayName, bindProject, workDir, harness };
  } finally {
    rl.close();
  }
}

function failTeamCreate(error) {
  const payload = { ok: false, command: 'teams create', error };
  if (jsonRequested) printJson(payload, 1);
  console.error(`${brandLogPrefix()} ${error}`);
  process.exit(1);
}

function createLocalTeam(input) {
  const displayName = String(input.displayName || '').trim();
  const bindProject = String(input.bindProject || '').trim();
  const harness = String(input.harness || 'claudecode').trim();
  const workDir = normalizeWorkDir(input.workDir);

  if (!displayName) throw new Error('Missing required --name <name>');
  if (!bindProject) throw new Error('Missing required --bind-project <id>');
  if (!isValidBindProject(bindProject)) {
    throw new Error('bindProject must match ^[a-z0-9][a-z0-9_-]*$');
  }
  if (!workDir) throw new Error('Missing required --work-dir <path>');
  if (!KNOWN_HARNESSES.includes(harness)) {
    throw new Error(`Unsupported harness: ${harness}`);
  }

  const teamsDir = path.join(hermitHome, 'teams');
  const rootPath = path.join(teamsDir, bindProject);
  const existing = collectTeams().teams.find((team) => team.bindProject === bindProject || team.slug === bindProject);
  if (existing || existsSync(path.join(rootPath, 'team.json'))) {
    throw new Error(`Team bindProject already exists: ${bindProject}`);
  }

  mkdirSync(path.join(rootPath, 'messages'), { recursive: true });
  mkdirSync(path.join(rootPath, 'tasks'), { recursive: true });
  const createdAt = new Date().toISOString();
  const manifest = {
    schemaVersion: 2,
    slug: bindProject,
    displayName,
    bindProject,
    harness,
    workDir,
    collaboration: true,
    rootPath,
    createdAt,
  };
  writeFileSync(path.join(rootPath, 'team.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
  return manifest;
}

async function printTeamsCreate({ exitOnDone = true } = {}) {
  try {
    const input = await promptForMissingTeamCreateFields(buildTeamCreateSeed());
    const team = createLocalTeam(input);
    const result = { ok: true, command: 'teams create', hermitHome, team };
    if (jsonRequested) printJson(result);

    printCliRows('团队已创建', [
      ['团队', `${team.slug} - ${team.displayName}`],
      ['运行时', team.harness],
      ['工作目录', team.workDir],
    ], '下一步：openhermit teams list');
    if (exitOnDone) process.exit(0);
    return result;
  } catch (err) {
    if (!exitOnDone) throw err;
    failTeamCreate(err instanceof Error ? err.message : String(err));
  }
}

function printTasksList({ exitOnDone = true } = {}) {
  const teamArg = findOptionValue('--team') || commandArgs[2];
  if (!teamArg) {
    const payload = { ok: false, command: 'tasks list', error: 'Missing required --team <team>' };
    if (jsonRequested) printJson(payload, 1);
    console.error(`${brandLogPrefix()} 用法：openhermit tasks list --team <team>`);
    if (exitOnDone) process.exit(1);
    return payload;
  }

  const result = { ok: true, command: 'tasks list', hermitHome, ...collectTasks(teamArg) };
  if (jsonRequested) printJson(result);

  if (result.tasks.length === 0) {
    console.log(`${result.resolvedTeam} 没有活跃任务。`);
  } else {
    for (const task of result.tasks) {
      console.log(`${task.displayId || task.id} [${task.status}] ${task.subject}`);
    }
  }
  for (const warning of result.warnings) {
    console.error(`${brandLogPrefix()} 警告：${warning.path}: ${warning.message}`);
  }
  if (exitOnDone) process.exit(0);
  return result;
}

await requireOpenHermitAuthForEntry();

if (commandArgs[0] === 'status') {
  await printDaemonStatus();
}

if (commandArgs[0] === 'doctor') {
  await printDoctor();
}

if (commandArgs[0] === 'usage' && commandArgs[1] === 'status') {
  await printUsageStatus();
}

if (commandArgs[0] === 'usage' && commandArgs[1] === 'today') {
  await printUsageToday();
}

if (commandArgs[0] === 'usage' && commandArgs[1] === 'report') {
  await printUsageReport();
}

if (commandArgs[0] === 'usage' && commandArgs[1] === 'start') {
  await printUsageStart();
}

if (commandArgs[0] === 'usage' && commandArgs[1] === 'stop') {
  await printUsageStop();
}

if (commandArgs[0] === 'usage' && commandArgs[1] === 'autostart') {
  await printUsageAutostart();
}

if (commandArgs[0] === 'services') {
  await printServicesCommand();
}

if (commandArgs[0] === 'collaboration' && commandArgs[1] === 'start') {
  await printCollaborationStart();
}

if (commandArgs[0] === '__telemetry-worker') {
  const extraArgs = args.includes('--scan-once') ? ['--scan-once'] : [];
  const child = spawn(process.execPath, telemetryWorkerChildArgs(extraArgs), {
    cwd: repoRoot,
    env: { ...process.env, HERMIT_HOME: hermitHome },
    stdio: 'inherit',
  });
  const code = await new Promise((resolve) => child.on('exit', resolve));
  process.exit(Number(code) || 0);
}

if (commandArgs[0] === 'auth' && commandArgs[1] === 'status') {
  await printAuthStatus();
}

if (commandArgs[0] === 'auth' && commandArgs[1] === 'login') {
  await runAuthLogin();
}

if (commandArgs[0] === 'auth' && commandArgs[1] === 'dev-login') {
  await runAuthDevLogin();
}

if (commandArgs[0] === 'auth' && commandArgs[1] === 'logout') {
  await runAuthLogout();
}

if (commandArgs.length === 0 && !daemonChild && !daemonRequested) {
  if (isInteractiveCli() && !jsonRequested) {
    const navigationKeepAlive = setInterval(() => undefined, 2_147_483_647);
    try {
      await printNavigation();
    } finally {
      clearInterval(navigationKeepAlive);
    }
  } else {
    await printNavigation();
  }
}

if (commandArgs[0] === 'teams' && commandArgs[1] === 'list') {
  printTeamsList();
}

if (commandArgs[0] === 'teams' && commandArgs[1] === 'create') {
  await printTeamsCreate();
}

if (commandArgs[0] === 'tasks' && commandArgs[1] === 'list') {
  printTasksList();
}

if (commandArgs[0] === 'stop') {
  await stopDaemon();
}

if (commandArgs.length > 0 && !daemonRequested && !daemonChild) {
  const command = commandArgs.join(' ');
  const result = { ok: false, command, error: `Unknown command: ${command}` };
  if (jsonRequested) printJson(result, 1);
  console.error(`${brandLogPrefix()} 未知命令：${command}`);
  console.error(`${brandLogPrefix()} 可用命令：status | doctor | services | services start/stop | teams list/create | tasks list | usage status/today/report/start/stop/autostart | auth status/login/logout | stop`);
  process.exit(1);
}

if (daemonRequested && !daemonChild) {
  startDaemon();
}

// ---------------------------------------------------------------------------
// Check dependencies
// ---------------------------------------------------------------------------

function checkDependency(name) {
  try {
    require.resolve(name);
    return true;
  } catch {
    return false;
  }
}

const missingDeps = [];
if (!checkDependency('fastify')) missingDeps.push('fastify');
if (!checkDependency('tsx')) missingDeps.push('tsx');

if (missingDeps.length > 0) {
  console.error(`
${brandLogPrefix()} Error: Missing dependencies: ${missingDeps.join(', ')}

Please install dependencies first:
  cd ${repoRoot}
  npm install
`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// hermit-bridge sidecar
// ---------------------------------------------------------------------------

function escapeTomlPath(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function parseTomlToken(raw, section) {
  const match = raw.match(new RegExp(`\\[${section}\\][^\\[]*token\\s*=\\s*"([^"]+)"`, 's'));
  return match?.[1] || '';
}

function randomToken() {
  return crypto.randomBytes(16).toString('hex');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findProjectBlock(raw, name) {
  const projectPattern = new RegExp(
    `\\[\\[projects\\]\\]\\s*\\n\\s*name\\s*=\\s*"${escapeRegExp(name)}"[\\s\\S]*?(?=\\n\\s*\\[\\[projects\\]\\]|\\s*$)`
  );
  const match = raw.match(projectPattern);
  return match ? { pattern: projectPattern, match } : null;
}

function isManagedBootstrapBlock(block) {
  return (
    block.includes('disabled_commands = ["*"]') &&
    (block.includes('app_id = "placeholder"') ||
      block.includes('channel_token = "openhermit-bootstrap"') ||
      block.includes('callback_path = "/openhermit-bootstrap"'))
  );
}

function isStarterProjectConfig(raw) {
  const block = findProjectBlock(raw, starterProjectName);
  if (!block) return false;
  const text = block.match[0];
  return (
    text.includes('name = "my-project"') &&
    text.includes('type = "claudecode"') &&
    text.includes('work_dir = "/path/to/your/project"') &&
    text.includes('app_id = "your-feishu-app-id"') &&
    text.includes('app_secret = "your-feishu-app-secret"')
  );
}

function configRequiresClaudeCode(raw) {
  return /type\s*=\s*"claudecode"/.test(raw);
}

function hasProjectEntries(raw) {
  const projectPattern = /\[\[projects\]\]\s*\n\s*name\s*=\s*"([^"]+)"[\s\S]*?(?=\n\s*\[\[projects\]\]|\s*$)/g;
  return [...raw.matchAll(projectPattern)].some((match) => !isManagedBootstrapBlock(match[0]));
}

function commandExists(command) {
  try {
    execSync(`${command} --version`, { stdio: 'ignore', shell: true });
    return true;
  } catch {
    return false;
  }
}

function ensureClaudeCodeCliIfNeeded(raw) {
  if (!configRequiresClaudeCode(raw) || commandExists('claude')) return;

  console.log(`${brandLogPrefix()} Claude Code CLI not found.`);
  console.log(`${brandLogPrefix()} Installing @anthropic-ai/claude-code globally. This may take a few minutes...`);
  console.log(`${brandLogPrefix()} Running: npm install -g @anthropic-ai/claude-code@latest --prefer-online`);
  try {
    execSync('npm install -g @anthropic-ai/claude-code@latest --prefer-online', {
      stdio: 'inherit',
      shell: true,
    });
  } catch (err) {
    console.error(`${brandLogPrefix()} Claude Code CLI install command failed.`);
    console.error(`${brandLogPrefix()} Failed to install Claude Code CLI automatically.`);
    console.error(`${brandLogPrefix()} Please install it manually: npm install -g @anthropic-ai/claude-code@latest`);
    throw err;
  }

  if (!commandExists('claude')) {
    throw new Error('Claude Code CLI was installed but `claude` is still not available in PATH');
  }
  console.log(`${brandLogPrefix()} Claude Code CLI installed and available in PATH.`);
}

function hasTomlSection(raw, section) {
  return new RegExp(`^\\[${section}\\]\\s*$`, 'm').test(raw);
}

function buildOpenHermitStarterConfig(managementToken, bridgeToken) {
  return `# hermit-bridge configuration
# Runtime bridge packaged by Hermit.

data_dir = "${escapeTomlPath(defaultHermitBridgeDataDir)}"
language = "zh"

[management]
enabled = true
host = "127.0.0.1"
port = 9820
token = "${managementToken}"

[bridge]
enabled = true
host = "127.0.0.1"
port = 9810
token = "${bridgeToken}"
path = "/bridge/ws"

[log]
level = "info"

[[projects]]
name = "my-project"

[projects.agent]
type = "claudecode"   # "claudecode", "codex", "cursor", "gemini", "qoder", "opencode", or "iflow"

[projects.agent.options]
work_dir = "/path/to/your/project"
mode = "default"
# model = "claude-sonnet-4-20250514"

# --- Choose at least one platform below ---

[[projects.platforms]]
type = "feishu"

[projects.platforms.options]
app_id = "your-feishu-app-id"
app_secret = "your-feishu-app-secret"
`;
}

function normalizeMigratedHermitBridgeConfig(raw) {
  return raw
    .split(escapeTomlPath(legacyRuntimeBridgeDataDir))
    .join(escapeTomlPath(defaultHermitBridgeDataDir))
    .split('~/.hermit/cc-connect/data')
    .join('~/.hermit/hermit-bridge/data');
}

function migrateLegacyHermitBridgeDataIfNeeded() {
  if (existsSync(defaultHermitBridgeDataDir) || !existsSync(legacyRuntimeBridgeDataDir)) return false;
  mkdirSync(path.dirname(defaultHermitBridgeDataDir), { recursive: true });
  try {
    renameSync(legacyRuntimeBridgeDataDir, defaultHermitBridgeDataDir);
  } catch {
    cpSync(legacyRuntimeBridgeDataDir, defaultHermitBridgeDataDir, { recursive: true });
    rmSync(legacyRuntimeBridgeDataDir, { recursive: true, force: true });
  }
  return true;
}

function normalizeHermitBridgeConfigFileIfNeeded() {
  if (!existsSync(hermitBridgeConfigPath)) return false;
  const raw = readFileSync(hermitBridgeConfigPath, 'utf-8');
  const normalized = normalizeMigratedHermitBridgeConfig(raw);
  if (normalized === raw) return false;
  writeFileSync(hermitBridgeConfigPath, normalized, 'utf-8');
  return true;
}

function migrateLegacyHermitBridgeConfigIfNeeded() {
  if (hermitBridgeConfigPath !== defaultHermitBridgeConfigPath) return;

  const migratedData = migrateLegacyHermitBridgeDataIfNeeded();
  let migratedConfig = false;
  if (!existsSync(hermitBridgeConfigPath) && existsSync(legacyRuntimeBridgeConfigPath)) {
    mkdirSync(path.dirname(hermitBridgeConfigPath), { recursive: true });
    const migrated = normalizeMigratedHermitBridgeConfig(readFileSync(legacyRuntimeBridgeConfigPath, 'utf-8'));
    writeFileSync(hermitBridgeConfigPath, migrated, 'utf-8');
    rmSync(legacyRuntimeBridgeConfigPath, { force: true });
    migratedConfig = true;
  }
  const normalizedConfig = normalizeHermitBridgeConfigFileIfNeeded();
  if (migratedConfig || migratedData || normalizedConfig) {
    console.log(`${brandLogPrefix()} Migrated runtime files to ~/${BRAND.defaultLocalHomeName}/${BRAND.runtimeBridgeName}/`);
  }
}

function ensureOpenHermitRuntimeConfig() {
  migrateLegacyHermitBridgeConfigIfNeeded();
  mkdirSync(path.dirname(hermitBridgeConfigPath), { recursive: true });
  if (!existsSync(hermitBridgeConfigPath)) {
    writeFileSync(hermitBridgeConfigPath, buildOpenHermitStarterConfig(randomToken(), randomToken()), 'utf-8');
    return;
  }

  let raw = readFileSync(hermitBridgeConfigPath, 'utf-8');
  let changed = false;
  if (!hasTomlSection(raw, 'management')) {
    raw = `${raw.trimEnd()}

[management]
enabled = true
host = "127.0.0.1"
port = 9820
token = "${randomToken()}"
`;
    changed = true;
  }
  if (!hasTomlSection(raw, 'bridge')) {
    raw = `${raw.trimEnd()}

[bridge]
enabled = true
host = "127.0.0.1"
port = 9810
token = "${randomToken()}"
path = "/bridge/ws"
`;
    changed = true;
  }
  if (changed) {
    writeFileSync(hermitBridgeConfigPath, raw, 'utf-8');
  }
}

function readHermitBridgeConfigState() {
  ensureOpenHermitRuntimeConfig();

  const raw = readFileSync(hermitBridgeConfigPath, 'utf-8');

  return {
    configExists: true,
    managementToken:
      process.env.HERMIT_BRIDGE_TOKEN ||
      process.env.HERMIT_BRIDGE_MANAGEMENT_TOKEN ||
      parseTomlToken(raw, 'management'),
    bridgeToken:
      process.env.HERMIT_BRIDGE_WS_TOKEN ||
      process.env.HERMIT_BRIDGE_TOKEN ||
      parseTomlToken(raw, 'bridge'),
    hasProjects: hasProjectEntries(raw),
    isStarterConfig: isStarterProjectConfig(raw),
    raw,
  };
}

async function waitForHermitBridge(baseUrl, token, timeoutMs = 15_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/v1/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (res.ok) return true;
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function appendLog(filePath, chunk) {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    appendFileSync(filePath, chunk);
  } catch {
    // Logging must never block startup.
  }
}

function printLogTail(label, filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trimEnd().split(/\r?\n/).slice(-80);
    console.error(`${brandLogPrefix()} ${label} log: ${filePath}`);
    if (lines.length > 0) {
      console.error(`${brandLogPrefix()} Last ${label} log lines:`);
      console.error(lines.join('\n'));
    }
  } catch {
    console.error(`${brandLogPrefix()} ${label} log: ${filePath}`);
  }
}

function readLogTail(filePath, maxLines = 30) {
  try {
    const content = readFileSync(filePath, 'utf-8').trimEnd();
    if (!content) return '（暂无日志）';
    return content.split(/\r?\n/).slice(-maxLines).join('\n');
  } catch {
    return '（日志文件尚未生成）';
  }
}

function printDeveloperUploadLogs() {
  if (!requireDeveloperMode()) return;
  printCliRows('消息上报调试日志', [
    ['消息上报', conversationUploadLogPath, 'info'],
    ['后台扫描', telemetryWorkerLogPath, 'info'],
    ['错误日志', telemetryWorkerErrorLogPath, 'info'],
  ], '只显示本地日志尾部；不会打印 token、原始 JSONL 或完整私有路径内容。');
  console.log(ui.dim('\n--- conversation-upload.log ---'));
  console.log(readLogTail(conversationUploadLogPath));
  console.log(ui.dim('\n--- telemetry-worker.log ---'));
  console.log(readLogTail(telemetryWorkerLogPath));
  console.log(ui.dim('\n--- telemetry-worker.err.log ---'));
  console.log(readLogTail(telemetryWorkerErrorLogPath));
}

async function waitForRuntimeReady(baseUrl, token, child, timeoutMs = 30_000) {
  let exitCode = null;
  child.once('exit', (code) => {
    exitCode = code ?? 1;
  });

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (exitCode !== null) {
      throw new Error(`Runtime service exited before becoming ready (code ${exitCode})`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/v1/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (res.ok) return;
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Runtime service did not become ready within ${Math.round(timeoutMs / 1000)}s`);
}

function resolveHermitBridgeRunner() {
  try {
    const pkgPath = require.resolve('hermit-bridge/package.json');
    const runner = path.join(path.dirname(pkgPath), 'run.js');
    return existsSync(runner) ? runner : null;
  } catch {
    return null;
  }
}

function resolveTsxLoader() {
  return pathToFileURL(require.resolve('tsx')).href;
}

function resolveAliasLoaderRegister() {
  const aliasLoaderUrl = pathToFileURL(path.join(binDir, 'alias-loader.mjs')).href;
  return `data:text/javascript,import { register } from "node:module"; import { pathToFileURL } from "node:url"; register(${JSON.stringify(aliasLoaderUrl)}, pathToFileURL("./"));`;
}

async function checkExistingOpenHermitServer() {
  const url = `http://127.0.0.1:${port}`;
  try {
    const res = await fetch(`${url}/api/version`, { signal: AbortSignal.timeout(1000) });
    if (res.ok) {
      const version = (await res.text()).trim() || 'unknown';
      return { running: true, version, url };
    }
  } catch {
    // Port may be unused or owned by another process.
  }
  return { running: false, version: '', url };
}

async function isTcpPortAvailable(portNumber) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(portNumber, process.env.HOST || '127.0.0.1');
  });
}

async function assertWebPortAvailable() {
  const existingServer = await checkExistingOpenHermitServer();
  if (existingServer.running) {
    console.log(`${brandLogPrefix()} Already running: ${existingServer.url}`);
    console.log(`${brandLogPrefix()} Version: ${existingServer.version}`);
    console.log(`${brandLogPrefix()} Run ${brandCommand('stop')} first, or use ${brandCommand('--port <port>')} for another instance.`);
    process.exit(0);
  }

  const available = await isTcpPortAvailable(Number.parseInt(port, 10));
  if (!available) {
    console.error(`${brandLogPrefix()} Port ${port} is already in use.`);
    console.error(`${brandLogPrefix()} Stop the existing process first, or start with another port:`);
    console.error(`  ${brandCommand(`--port ${Number.parseInt(port, 10) + 1}`)}`);
    console.error(`${brandLogPrefix()} macOS/Linux: lsof -nP -iTCP:${port} -sTCP:LISTEN`);
    console.error(`${brandLogPrefix()} Windows: netstat -ano | findstr :${port}`);
    process.exit(1);
  }
}

let hermitBridgeProcess = null;
let bridgeTokens = {
  managementToken:
    process.env.HERMIT_BRIDGE_TOKEN ||
    process.env.HERMIT_BRIDGE_MANAGEMENT_TOKEN ||
    '',
  bridgeToken:
    process.env.HERMIT_BRIDGE_WS_TOKEN ||
    process.env.HERMIT_BRIDGE_TOKEN ||
    '',
};
let runtimeSetupMode = false;

await assertWebPortAvailable();

if (!skipHermitBridge) {
  let shouldStartRuntime = false;
  bridgeTokens = readHermitBridgeConfigState();
  const bridgeBaseUrl = process.env.HERMIT_BRIDGE_BASE_URL || 'http://127.0.0.1:9820';
  const alreadyRunning = await waitForHermitBridge(bridgeBaseUrl, bridgeTokens.managementToken, 1_000);
  if (alreadyRunning) {
    console.log(`${brandLogPrefix()} Runtime service already running: ${bridgeBaseUrl}`);
  } else if (bridgeTokens.hasProjects) {
    try {
      ensureClaudeCodeCliIfNeeded(bridgeTokens.raw);
    } catch {
      printLogTail('Runtime', runtimeLogPath);
      process.exit(1);
    }
    shouldStartRuntime = true;
  } else {
    console.error(`${brandLogPrefix()} Runtime config has no projects. Please edit the config and try again.`);
    console.error(`${brandLogPrefix()} Runtime config: ${hermitBridgeConfigPath}`);
    process.exit(1);
  }

  if (shouldStartRuntime) {
    const hermitBridgeRunner = resolveHermitBridgeRunner();
    if (!hermitBridgeRunner) {
      runtimeSetupMode = true;
      console.warn(`${brandLogPrefix()} Bundled ${BRAND.runtimeBridgeName} runtime is not installed for this platform.`);
      console.warn(`${brandLogPrefix()} Starting ${BRAND.stylizedName} without auto-starting the runtime service.`);
      console.warn(`${brandLogPrefix()} Configure an external ${BRAND.runtimeBridgeName} service or use --no-hermit-bridge to skip this check.`);
    } else {
      console.log(`${brandLogPrefix()} Starting bundled runtime service...`);
      console.log(`${brandLogPrefix()} Runtime config: ${hermitBridgeConfigPath}`);
      hermitBridgeProcess = spawn(process.execPath, [hermitBridgeRunner, '-config', hermitBridgeConfigPath], {
        cwd: repoRoot,
        detached: true,
        env: {
          ...process.env,
          HERMIT_BRIDGE_TOKEN: bridgeTokens.managementToken,
          HERMIT_BRIDGE_MANAGEMENT_TOKEN: bridgeTokens.managementToken,
          HERMIT_BRIDGE_WS_TOKEN: bridgeTokens.bridgeToken,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      hermitBridgeProcess.stdout?.on('data', (chunk) => {
        process.stdout.write(chunk);
        appendLog(runtimeLogPath, chunk);
      });
      hermitBridgeProcess.stderr?.on('data', (chunk) => {
        process.stderr.write(chunk);
        appendLog(runtimeLogPath, chunk);
      });

      try {
        await waitForRuntimeReady(bridgeBaseUrl, bridgeTokens.managementToken, hermitBridgeProcess, 180_000);
      } catch (err) {
        console.error(
          `${brandLogPrefix()} Runtime service failed to start: ${err instanceof Error ? err.message : String(err)}`
        );
        printLogTail('Runtime', runtimeLogPath);
        signalDaemon(hermitBridgeProcess.pid, 'SIGTERM');
        setTimeout(() => signalDaemon(hermitBridgeProcess?.pid, 'SIGKILL'), 2_000).unref();
        process.exit(1);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

console.log(`${brandLogPrefix()} Starting ${BRAND.stylizedName} server...`);
console.log(`${brandLogPrefix()} Version: ${currentVersion}`);
console.log(`${brandLogPrefix()} Port: ${port}`);
console.log(`${brandLogPrefix()} Root: ${repoRoot}`);
console.log('');

// Build dist-renderer in development checkouts only. Published installs ship the
// prebuilt renderer and usually do not include frontend build dependencies.
const distRenderererDir = path.resolve(repoRoot, 'dist-renderer');
const distRendererEntry = path.join(distRenderererDir, 'index.html');
const canBuildRendererFromSource =
  existsSync(path.join(repoRoot, 'vite.web.config.ts')) &&
  existsSync(path.join(repoRoot, 'pnpm-lock.yaml')) &&
  existsSync(path.join(repoRoot, 'node_modules'));

if (!existsSync(distRendererEntry)) {
  if (!canBuildRendererFromSource) {
    console.error(`${brandLogPrefix()} Missing prebuilt frontend: dist-renderer/index.html`);
    console.error(`${brandLogPrefix()} This install appears incomplete. Please reinstall ${BRAND.npmPackage} or report a packaging issue.`);
    process.exit(1);
  }

  console.log(`${brandLogPrefix()} Building frontend...`);
  const buildProcess = spawn('pnpm', ['build:web'], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true,
  });

  await new Promise((resolve, reject) => {
    buildProcess.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Frontend build failed with exit code ${code}`));
      }
    });
    buildProcess.on('error', reject);
  });
  console.log(`${brandLogPrefix()} Frontend built successfully\n`);
}

// Start the server
console.log(`${brandLogPrefix()} Launching server...\n`);

function printServerLogTail() {
  printLogTail('Server', serverLogPath);
}

const serverProcess = spawn(process.execPath, ['--import', resolveAliasLoaderRegister(), '--import', resolveTsxLoader(), 'src/main/server.ts'], {
  cwd: repoRoot,
  detached: true,
  env: {
    ...process.env,
    PORT: port,
    HOST: process.env.HOST || '127.0.0.1',
    NODE_ENV: 'production',
    HERMIT_HOME: hermitHome,
    HERMIT_RUNTIME_SETUP_MODE: runtimeSetupMode ? '1' : '0',
    HERMIT_BRIDGE_TOKEN: bridgeTokens.managementToken,
    HERMIT_BRIDGE_MANAGEMENT_TOKEN: bridgeTokens.managementToken,
    HERMIT_BRIDGE_WS_TOKEN: bridgeTokens.bridgeToken,
    HERMIT_BRIDGE_CONFIG: hermitBridgeConfigPath,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

serverProcess.stdout?.on('data', (chunk) => {
  process.stdout.write(chunk);
  appendLog(serverLogPath, chunk);
});

serverProcess.stderr?.on('data', (chunk) => {
  process.stderr.write(chunk);
  appendLog(serverLogPath, chunk);
});

serverProcess.on('exit', (code) => {
  if (shuttingDown) return;
  signalDaemon(hermitBridgeProcess?.pid, 'SIGTERM');
  if (code !== 0) {
    console.error(`${brandLogPrefix()} Server exited with code ${code}`);
    printServerLogTail();
    process.exit(code ?? 1);
  }
});

let shuttingDown = false;
function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${brandLogPrefix()} Shutting down...`);
  signalDaemon(serverProcess?.pid, 'SIGTERM');
  signalDaemon(hermitBridgeProcess?.pid, 'SIGTERM');
  setTimeout(() => {
    signalDaemon(serverProcess?.pid, 'SIGKILL');
    signalDaemon(hermitBridgeProcess?.pid, 'SIGKILL');
    process.exit(exitCode);
  }, 2_000).unref();
}

process.on('SIGINT', () => {
  shutdown(0);
});

process.on('SIGTERM', () => {
  shutdown(0);
});

console.log(`${brandLogPrefix()} Server starting on http://${process.env.HOST || '127.0.0.1'}:${port}`);
console.log(`${brandLogPrefix()} Press Ctrl+C to stop\n`);
