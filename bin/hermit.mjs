#!/usr/bin/env node
/**
 * openHermit CLI — production entry point.
 *
 * Usage:
 *   npm install -g @yancyyu/openhermit
 *   openhermit                # start on default port 5680
 *   openhermit --port 8080    # start on custom port
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
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Load version
// ---------------------------------------------------------------------------

const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
const currentVersion = pkg.version;

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

const versionIndex = args.indexOf('--version');
if (versionIndex !== -1) {
  console.log(currentVersion);
  process.exit(0);
}

const helpIndex = args.indexOf('--help');
if (helpIndex !== -1) {
  console.log(`
openHermit — Team-oriented agent management workbench

Usage:
  openhermit [options]

Options:
  --port <number>    HTTP server port (default: 5680)
  --no-hermit-bridge Do not auto-start bundled runtime service
  --daemon           Run openHermit in the background
  --version          Show current version
  --help             Show this help message
  status             Show background service status
  stop               Stop background service
  update             Check and install updates
  add <plugin>       Install a feature plugin into the MCP library
                     (e.g. openhermit add worker-society)

Examples:
  npx @yancyyu/openhermit             # Run without installing
  npx @yancyyu/openhermit --port 8080
  openhermit                          # After global install
  openhermit --daemon
  openhermit status
  openhermit stop
  openhermit --version
  openhermit update
`);
  process.exit(0);
}

const updateIndex = args.indexOf('update');
if (updateIndex !== -1) {
  runUpdate();
  process.exit(0);
}

const portIndex = args.indexOf('--port');
const port = portIndex !== -1 && args[portIndex + 1] ? args[portIndex + 1] : '5680';
const skipHermitBridge =
  args.includes('--no-hermit-bridge') || process.env.HERMIT_NO_HERMIT_BRIDGE === '1';
const hermitHome = process.env.HERMIT_HOME || path.join(os.homedir(), '.hermit');
const daemonRequested = args.includes('--daemon');
const daemonChild = process.env.HERMIT_DAEMON_CHILD === '1';
const daemonPidPath = path.join(hermitHome, 'openhermit.pid');
const daemonLogPath = path.join(hermitHome, 'logs', 'openhermit.log');
const runtimeLogPath = path.join(hermitHome, 'logs', 'openhermit-runtime.log');
const serverLogPath = path.join(hermitHome, 'logs', 'openhermit-server.log');
const legacyRuntimeBridgeDir = path.join(hermitHome, 'cc-connect');
const hermitBridgeDir = path.join(hermitHome, 'hermit-bridge');
const legacyRuntimeBridgeConfigPath = path.join(legacyRuntimeBridgeDir, 'config.toml');
const defaultHermitBridgeConfigPath = path.join(hermitBridgeDir, 'config.toml');
const legacyRuntimeBridgeDataDir = path.join(legacyRuntimeBridgeDir, 'data');
const defaultHermitBridgeDataDir = path.join(hermitBridgeDir, 'data');
const hermitBridgeConfigPath =
  process.env.HERMIT_BRIDGE_CONFIG ||
  defaultHermitBridgeConfigPath;
const starterProjectName = 'my-project';

// ---------------------------------------------------------------------------
// Update command
// ---------------------------------------------------------------------------

async function runUpdate() {
  const isGitRepo = existsSync(path.join(repoRoot, '.git'));

  if (isGitRepo) {
    // Git repo: check GitHub releases and checkout latest tag
    console.log('[openHermit] Checking for updates...');
    try {
      const res = await fetch('https://api.github.com/repos/yancyuu/Hermit/releases/latest', {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        console.error(`[openHermit] Failed to check GitHub releases (HTTP ${res.status})`);
        process.exit(1);
      }
      const data = await res.json();
      const latestVersion = data.tag_name?.replace(/^v/, '');
      if (!latestVersion) {
        console.error('[openHermit] No release found on GitHub');
        process.exit(1);
      }
      if (latestVersion === currentVersion) {
        migrateLegacyHermitBridgeConfigIfNeeded();
        console.log(`[openHermit] Already on latest version (${currentVersion})`);
        process.exit(0);
      }
      console.log(`[openHermit] Current: ${currentVersion} → Latest: ${latestVersion}`);
      console.log('[openHermit] Fetching latest changes...');
      execSync('git fetch --tags', { cwd: repoRoot, stdio: 'inherit' });
      console.log(`[openHermit] Checking out v${latestVersion}...`);
      execSync(`git checkout v${latestVersion}`, { cwd: repoRoot, stdio: 'inherit' });
      console.log('[openHermit] Installing dependencies...');
      execSync('npm install', { cwd: repoRoot, stdio: 'inherit' });
      console.log('[openHermit] Building frontend...');
      execSync('npm run build:web', { cwd: repoRoot, stdio: 'inherit' });
      migrateLegacyHermitBridgeConfigIfNeeded();
      console.log(`\n[openHermit] Updated to ${latestVersion}. Restart with: openhermit\n`);
    } catch (err) {
      console.error('[openHermit] Update failed:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  } else {
    // npm install: directly update to latest
    console.log('[openHermit] Updating via npm...');
    try {
      execSync('npm install -g @yancyyu/openhermit@latest', { stdio: 'inherit' });
      migrateLegacyHermitBridgeConfigIfNeeded();
      console.log(`\n[openHermit] Updated successfully. Restart with: openhermit\n`);
    } catch (err) {
      console.error('[openHermit] npm update failed. Try: sudo npm install -g @yancyyu/openhermit@latest');
      process.exit(1);
    }
  }
}

// ---------------------------------------------------------------------------
// add <plugin> — install a feature plugin into the MCP library
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
    console.error('[openHermit] Usage: openhermit add <plugin-name>');
    console.error('[openHermit] Known plugins: ' + Object.keys(KNOWN_PLUGINS).join(', '));
    process.exit(1);
  }

  const spec = KNOWN_PLUGINS[pluginName];
  if (!spec) {
    console.error(`[openHermit] Unknown plugin: ${pluginName}`);
    console.error('[openHermit] Known plugins: ' + Object.keys(KNOWN_PLUGINS).join(', '));
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

  console.log(`[openHermit] Installing plugin "${pluginName}" → registering MCP server ${body.installSpec.url}`);

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
      console.log(`[openHermit] ✓ "${pluginName}" installed into the MCP library.`);
      console.log(`[openHermit]   Agents can now use: ${spec.hint}`);
      console.log('[openHermit]   Enable it for a worker in the Extensions panel, or via the MCP library.');
      return;
    }

    // 同名已存在 → 幂等视为已安装。
    if (res.status === 409 || /already exist|已存在|exists/i.test(errMsg)) {
      console.log(`[openHermit] ✓ "${pluginName}" already in the MCP library (idempotent).`);
      return;
    }
    console.error(`[openHermit] Install failed (HTTP ${res.status}): ${(errMsg || text).slice(0, 200)}`);
    process.exit(1);
  } catch (err) {
    console.error(`[openHermit] Could not reach openHermit at ${base}.`);
    console.error(`[openHermit] ${err instanceof Error ? err.message : String(err)}`);
    console.error('[openHermit] Start it first with: openhermit');
    process.exit(1);
  }
}

const addIndex = args.indexOf('add');
if (addIndex !== -1) {
  await runAddPlugin(args[addIndex + 1], port);
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

function printDaemonStatus() {
  const pid = readDaemonPid();
  if (pid && isPidRunning(pid)) {
    console.log(`[openHermit] Running in background (pid ${pid})`);
    console.log(`[openHermit] Log: ${daemonLogPath}`);
    process.exit(0);
  }
  if (pid) removeDaemonPidFile();
  const fallbackPids = collectFallbackPids();
  if (fallbackPids.length > 0) {
    console.log(`[openHermit] Running without daemon pidfile (pids ${fallbackPids.join(', ')})`);
    process.exit(0);
  }
  console.log('[openHermit] Not running');
  process.exit(1);
}

async function stopDaemon() {
  const pid = readDaemonPid();
  if (!pid || !isPidRunning(pid)) {
    if (pid) removeDaemonPidFile();
    const stoppedFallback = await stopFallbackProcesses();
    console.log(stoppedFallback ? '[openHermit] Stopped orphaned service processes' : '[openHermit] Not running');
    process.exit(0);
  }
  console.log(`[openHermit] Stopping background service (pid ${pid})...`);
  signalDaemon(pid, 'SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  if (isPidRunning(pid)) {
    signalDaemon(pid, 'SIGKILL');
  }
  removeDaemonPidFile();
  console.log('[openHermit] Stopped');
  process.exit(0);
}

function startDaemon() {
  const existingPid = readDaemonPid();
  if (existingPid && isPidRunning(existingPid)) {
    console.log(`[openHermit] Already running in background (pid ${existingPid})`);
    console.log(`[openHermit] Log: ${daemonLogPath}`);
    process.exit(0);
  }

  mkdirSync(path.dirname(daemonPidPath), { recursive: true });
  mkdirSync(path.dirname(daemonLogPath), { recursive: true });
  const out = openSync(daemonLogPath, 'a');
  const err = openSync(daemonLogPath, 'a');
  const childArgs = process.argv.slice(2).filter((arg) => arg !== '--daemon');
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...childArgs], {
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
  console.log(`[openHermit] Started in background (pid ${child.pid})`);
  console.log(`[openHermit] URL: http://127.0.0.1:${port}`);
  console.log(`[openHermit] Log: ${daemonLogPath}`);
  process.exit(0);
}

if (args.includes('status')) {
  printDaemonStatus();
}

if (args.includes('stop')) {
  await stopDaemon();
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
[openHermit] Error: Missing dependencies: ${missingDeps.join(', ')}

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

  console.log('[openHermit] Claude Code CLI not found.');
  console.log('[openHermit] Installing @anthropic-ai/claude-code globally. This may take a few minutes...');
  console.log('[openHermit] Running: npm install -g @anthropic-ai/claude-code@latest --prefer-online');
  try {
    execSync('npm install -g @anthropic-ai/claude-code@latest --prefer-online', {
      stdio: 'inherit',
      shell: true,
    });
  } catch (err) {
    console.error('[openHermit] Claude Code CLI install command failed.');
    console.error('[openHermit] Failed to install Claude Code CLI automatically.');
    console.error('[openHermit] Please install it manually: npm install -g @anthropic-ai/claude-code@latest');
    throw err;
  }

  if (!commandExists('claude')) {
    throw new Error('Claude Code CLI was installed but `claude` is still not available in PATH');
  }
  console.log('[openHermit] Claude Code CLI installed and available in PATH.');
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
    console.log('[openHermit] Migrated runtime files to ~/.hermit/hermit-bridge/');
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
    console.error(`[openHermit] ${label} log: ${filePath}`);
    if (lines.length > 0) {
      console.error(`[openHermit] Last ${label} log lines:`);
      console.error(lines.join('\n'));
    }
  } catch {
    console.error(`[openHermit] ${label} log: ${filePath}`);
  }
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
  const aliasLoaderUrl = pathToFileURL(path.join(__dirname, 'alias-loader.mjs')).href;
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
    server.listen(portNumber, '127.0.0.1');
  });
}

async function assertWebPortAvailable() {
  const existingServer = await checkExistingOpenHermitServer();
  if (existingServer.running) {
    console.log(`[openHermit] Already running: ${existingServer.url}`);
    console.log(`[openHermit] Version: ${existingServer.version}`);
    console.log('[openHermit] Run `openhermit stop` first, or use `openhermit --port <port>` for another instance.');
    process.exit(0);
  }

  const available = await isTcpPortAvailable(Number.parseInt(port, 10));
  if (!available) {
    console.error(`[openHermit] Port ${port} is already in use.`);
    console.error('[openHermit] Stop the existing process first, or start with another port:');
    console.error(`  openhermit --port ${Number.parseInt(port, 10) + 1}`);
    console.error('[openHermit] macOS/Linux: lsof -nP -iTCP:' + port + ' -sTCP:LISTEN');
    console.error('[openHermit] Windows: netstat -ano | findstr :' + port);
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
    console.log(`[openHermit] Runtime service already running: ${bridgeBaseUrl}`);
  } else if (bridgeTokens.hasProjects) {
    try {
      ensureClaudeCodeCliIfNeeded(bridgeTokens.raw);
    } catch {
      printLogTail('Runtime', runtimeLogPath);
      process.exit(1);
    }
    shouldStartRuntime = true;
  } else {
    console.error('[openHermit] Runtime config has no projects. Please edit the config and try again.');
    console.error(`[openHermit] Runtime config: ${hermitBridgeConfigPath}`);
    process.exit(1);
  }

  if (shouldStartRuntime) {
    const hermitBridgeRunner = resolveHermitBridgeRunner();
    if (!hermitBridgeRunner) {
      runtimeSetupMode = true;
      console.warn('[openHermit] Bundled hermit-bridge runtime is not installed for this platform.');
      console.warn('[openHermit] Starting openHermit without auto-starting the runtime service.');
      console.warn('[openHermit] Configure an external hermit-bridge service or use --no-hermit-bridge to skip this check.');
    } else {
      console.log('[openHermit] Starting bundled runtime service...');
      console.log(`[openHermit] Runtime config: ${hermitBridgeConfigPath}`);
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
          `[openHermit] Runtime service failed to start: ${err instanceof Error ? err.message : String(err)}`
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

console.log(`[openHermit] Starting openHermit server...`);
console.log(`[openHermit] Version: ${currentVersion}`);
console.log(`[openHermit] Port: ${port}`);
console.log(`[openHermit] Root: ${repoRoot}`);
console.log('');

// Build dist-renderer if not exists
const distRenderererDir = path.resolve(repoRoot, 'dist-renderer');

if (!existsSync(distRenderererDir) || !existsSync(path.join(distRenderererDir, 'index.html'))) {
  console.log('[openHermit] Building frontend...');
  const buildProcess = spawn('npm', ['run', 'build:web'], {
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
  console.log('[openHermit] Frontend built successfully\n');
}

// Start the server
console.log('[openHermit] Launching server...\n');

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
    console.error(`[openHermit] Server exited with code ${code}`);
    printServerLogTail();
    process.exit(code ?? 1);
  }
});

let shuttingDown = false;
function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n[openHermit] Shutting down...');
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

console.log(`[openHermit] Server starting on http://127.0.0.1:${port}`);
console.log('[openHermit] Press Ctrl+C to stop\n');
