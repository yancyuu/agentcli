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
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
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
  --no-cc-connect    Do not auto-start bundled runtime service
  --daemon           Run openHermit in the background
  --version          Show current version
  --help             Show this help message
  status             Show background service status
  stop               Stop background service
  update             Check and install updates

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
const skipCcConnect = args.includes('--no-cc-connect') || process.env.HERMIT_NO_CC_CONNECT === '1';
const hermitHome = process.env.HERMIT_HOME || path.join(os.homedir(), '.hermit');
const daemonRequested = args.includes('--daemon');
const daemonChild = process.env.HERMIT_DAEMON_CHILD === '1';
const daemonPidPath = path.join(hermitHome, 'openhermit.pid');
const daemonLogPath = path.join(hermitHome, 'logs', 'openhermit.log');
const runtimeLogPath = path.join(hermitHome, 'logs', 'openhermit-runtime.log');
const serverLogPath = path.join(hermitHome, 'logs', 'openhermit-server.log');
const ccConnectConfigPath =
  process.env.HERMIT_CC_CONNECT_CONFIG ||
  process.env.CC_CONNECT_CONFIG ||
  path.join(hermitHome, 'cc-connect', 'config.toml');
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
      console.log(`\n[openHermit] Updated successfully. Restart with: openhermit\n`);
    } catch (err) {
      console.error('[openHermit] npm update failed. Try: sudo npm install -g @yancyyu/openhermit@latest');
      process.exit(1);
    }
  }
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
    "pgrep -f '@yancyyu/openhermit|openhermit/bin/hermit\\.mjs|src/main/server\\.ts|cc-connect' 2>/dev/null || true",
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
// cc-connect sidecar
// ---------------------------------------------------------------------------

function escapeTomlPath(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function parseTomlToken(raw, section) {
  const match = raw.match(new RegExp(`\\[${section}\\][^\\[]*token\\s*=\\s*"([^"]+)"`, 's'));
  return match?.[1] || '';
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findProjectBlock(raw, name) {
  const projectPattern = new RegExp(
    `\\[\\[projects\\]\\]\\nname\\s*=\\s*"${escapeRegExp(name)}"[\\s\\S]*?(?=\\n\\[\\[projects\\]\\]|\\s*$)`
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
  const projectPattern = /\[\[projects\]\]\nname\s*=\s*"([^"]+)"[\s\S]*?(?=\n\[\[projects\]\]|\s*$)/g;
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

function readCcConnectConfigState() {
  mkdirSync(path.dirname(ccConnectConfigPath), { recursive: true });
  if (!existsSync(ccConnectConfigPath)) {
    return {
      configExists: false,
      managementToken: process.env.CC_CONNECT_TOKEN || process.env.CC_CONNECT_MANAGEMENT_TOKEN || '',
      bridgeToken: process.env.CC_CONNECT_BRIDGE_TOKEN || process.env.CC_CONNECT_TOKEN || '',
      hasRunnableProjects: false,
      isStarterConfig: false,
    };
  }

  const raw = readFileSync(ccConnectConfigPath, 'utf-8');

  return {
    configExists: true,
    managementToken:
      process.env.CC_CONNECT_TOKEN ||
      process.env.CC_CONNECT_MANAGEMENT_TOKEN ||
      parseTomlToken(raw, 'management'),
    bridgeToken:
      process.env.CC_CONNECT_BRIDGE_TOKEN ||
      process.env.CC_CONNECT_TOKEN ||
      parseTomlToken(raw, 'bridge'),
    hasProjects: hasProjectEntries(raw),
    isStarterConfig: isStarterProjectConfig(raw),
    raw,
  };
}

async function waitForCcConnect(baseUrl, token, timeoutMs = 15_000) {
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

function resolveCcConnectRunner() {
  const pkgPath = require.resolve('cc-connect/package.json');
  return path.join(path.dirname(pkgPath), 'run.js');
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

let ccConnectProcess = null;
let ccTokens = {
  managementToken: process.env.CC_CONNECT_TOKEN || process.env.CC_CONNECT_MANAGEMENT_TOKEN || '',
  bridgeToken: process.env.CC_CONNECT_BRIDGE_TOKEN || process.env.CC_CONNECT_TOKEN || '',
};
let runtimeSetupMode = false;

await assertWebPortAvailable();

if (!skipCcConnect) {
  let shouldStartRuntime = false;
  ccTokens = readCcConnectConfigState();
  const ccBaseUrl = process.env.CC_CONNECT_BASE_URL || 'http://127.0.0.1:9820';
  const alreadyRunning = await waitForCcConnect(ccBaseUrl, ccTokens.managementToken, 1_000);
  if (alreadyRunning) {
    console.log(`[openHermit] Runtime service already running: ${ccBaseUrl}`);
  } else if (!ccTokens.configExists) {
    console.log('[openHermit] Initializing runtime config with bundled runtime service...');
    console.log(`[openHermit] Runtime config: ${ccConnectConfigPath}`);
    const initProcess = spawn(process.execPath, [resolveCcConnectRunner(), '-config', ccConnectConfigPath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CC_CONNECT_TOKEN: ccTokens.managementToken,
        CC_CONNECT_MANAGEMENT_TOKEN: ccTokens.managementToken,
        CC_CONNECT_BRIDGE_TOKEN: ccTokens.bridgeToken,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    initProcess.stdout?.on('data', (chunk) => {
      process.stdout.write(chunk);
      appendLog(runtimeLogPath, chunk);
    });
    initProcess.stderr?.on('data', (chunk) => {
      process.stderr.write(chunk);
      appendLog(runtimeLogPath, chunk);
    });

    const initCode = await new Promise((resolve) => {
      initProcess.on('exit', (code) => resolve(code ?? 1));
      initProcess.on('error', () => resolve(1));
    });

    ccTokens = readCcConnectConfigState();
    if (initCode === 0 && ccTokens.configExists) {
      console.log('[openHermit] Runtime starter config created.');
      try {
        ensureClaudeCodeCliIfNeeded(ccTokens.raw);
      } catch {
        printLogTail('Runtime', runtimeLogPath);
        process.exit(1);
      }
      shouldStartRuntime = true;
    } else {
      console.error(`[openHermit] Runtime config initialization failed (code ${initCode}).`);
      printLogTail('Runtime', runtimeLogPath);
      process.exit(1);
    }
  } else if (ccTokens.hasProjects) {
    try {
      ensureClaudeCodeCliIfNeeded(ccTokens.raw);
    } catch {
      printLogTail('Runtime', runtimeLogPath);
      process.exit(1);
    }
    shouldStartRuntime = true;
  } else {
    console.error('[openHermit] Runtime config has no projects. Please edit the config and try again.');
    console.error(`[openHermit] Runtime config: ${ccConnectConfigPath}`);
    process.exit(1);
  }

  if (shouldStartRuntime) {
    console.log('[openHermit] Starting bundled runtime service...');
    console.log(`[openHermit] Runtime config: ${ccConnectConfigPath}`);
    ccConnectProcess = spawn(process.execPath, [resolveCcConnectRunner(), '-config', ccConnectConfigPath], {
      cwd: repoRoot,
      detached: true,
      env: {
        ...process.env,
        CC_CONNECT_TOKEN: ccTokens.managementToken,
        CC_CONNECT_MANAGEMENT_TOKEN: ccTokens.managementToken,
        CC_CONNECT_BRIDGE_TOKEN: ccTokens.bridgeToken,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    ccConnectProcess.stdout?.on('data', (chunk) => {
      process.stdout.write(chunk);
      appendLog(runtimeLogPath, chunk);
    });
    ccConnectProcess.stderr?.on('data', (chunk) => {
      process.stderr.write(chunk);
      appendLog(runtimeLogPath, chunk);
    });

    try {
      await waitForRuntimeReady(ccBaseUrl, ccTokens.managementToken, ccConnectProcess, 30_000);
    } catch (err) {
      console.error(
        `[openHermit] Runtime service failed to start: ${err instanceof Error ? err.message : String(err)}`
      );
      printLogTail('Runtime', runtimeLogPath);
      signalDaemon(ccConnectProcess.pid, 'SIGTERM');
      setTimeout(() => signalDaemon(ccConnectProcess?.pid, 'SIGKILL'), 2_000).unref();
      process.exit(1);
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
    CC_CONNECT_TOKEN: ccTokens.managementToken,
    CC_CONNECT_MANAGEMENT_TOKEN: ccTokens.managementToken,
    CC_CONNECT_BRIDGE_TOKEN: ccTokens.bridgeToken,
    CC_CONNECT_CONFIG: ccConnectConfigPath,
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
  signalDaemon(ccConnectProcess?.pid, 'SIGTERM');
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
  signalDaemon(ccConnectProcess?.pid, 'SIGTERM');
  setTimeout(() => {
    signalDaemon(serverProcess?.pid, 'SIGKILL');
    signalDaemon(ccConnectProcess?.pid, 'SIGKILL');
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
