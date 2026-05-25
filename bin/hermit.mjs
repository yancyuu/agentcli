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
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  --no-cc-connect    Do not auto-start bundled cc-connect
  --version          Show current version
  --help             Show this help message
  update             Check and install updates

Examples:
  npx @yancyyu/openhermit             # Run without installing
  npx @yancyyu/openhermit --port 8080
  openhermit                          # After global install
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
const ccConnectConfigPath =
  process.env.HERMIT_CC_CONNECT_CONFIG ||
  process.env.CC_CONNECT_CONFIG ||
  path.join(hermitHome, 'cc-connect', 'config.toml');
const bootstrapProjectName = '__openhermit_bootstrap__';

// ---------------------------------------------------------------------------
// Update command
// ---------------------------------------------------------------------------

async function runUpdate() {
  console.log('[openHermit] Checking for updates...');

  const isGitRepo = existsSync(path.join(repoRoot, '.git'));

  try {
    // Check latest version from GitHub
    const res = await fetch('https://api.github.com/repos/yancyuu/Hermit/releases/latest');
    if (!res.ok) {
      console.error('[openHermit] Failed to check for updates');
      process.exit(1);
    }

    const data = await res.json();
    const latestVersion = data.tag_name?.replace(/^v/, '');

    if (!latestVersion) {
      console.log('[openHermit] Already on latest version');
      process.exit(0);
    }

    if (latestVersion === currentVersion) {
      console.log(`[openHermit] Already on latest version (${currentVersion})`);
      process.exit(0);
    }

    console.log(`[openHermit] Current version: ${currentVersion}`);
    console.log(`[openHermit] Latest version: ${latestVersion}`);

    if (isGitRepo) {
      console.log('[openHermit] Updating from git repository...');
      console.log('[openHermit] Fetching latest changes...');
      execSync('git fetch --tags', { cwd: repoRoot, stdio: 'inherit' });

      console.log(`[openHermit] Checking out v${latestVersion}...`);
      execSync(`git checkout v${latestVersion}`, { cwd: repoRoot, stdio: 'inherit' });

      console.log('[openHermit] Installing dependencies...');
      execSync('npm install', { cwd: repoRoot, stdio: 'inherit' });

      console.log('[openHermit] Building frontend...');
      execSync('npm run build:web', { cwd: repoRoot, stdio: 'inherit' });

      console.log(`\n[openHermit] Updated to openHermit ${latestVersion}`);
      console.log('[openHermit] Please restart the server with: openhermit\n');
    } else {
      console.log('[openHermit] Updating via npm...');
      execSync('npm update -g @yancyyu/openhermit', { stdio: 'inherit' });
      console.log(`\n[openHermit] Updated to openHermit ${latestVersion}\n`);
    }
  } catch (err) {
    console.error('[openHermit] Update failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
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

function randomToken() {
  return crypto.randomBytes(16).toString('hex');
}

function escapeTomlPath(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function parseTomlToken(raw, section) {
  const match = raw.match(new RegExp(`\\[${section}\\][^\\[]*token\\s*=\\s*"([^"]+)"`, 's'));
  return match?.[1] || '';
}

function hasProjectEntries(raw) {
  return /^\s*\[\[projects\]\]/m.test(raw);
}

function buildBootstrapProjectToml() {
  return `
# Bootstrap project — cc-connect requires at least one project to start.
# This entry is automatically managed by openHermit and will be ignored at runtime.
[[projects]]
name = "${bootstrapProjectName}"
disabled_commands = ["*"]

[projects.agent]
type = "claudecode"

[projects.agent.options]
work_dir = "${escapeTomlPath(hermitHome)}"
mode = "default"

[[projects.platforms]]
type = "bridge"
`;
}

function ensureCcConnectConfig() {
  mkdirSync(path.dirname(ccConnectConfigPath), { recursive: true });
  if (!existsSync(ccConnectConfigPath)) {
    const managementToken = randomToken();
    const bridgeToken = randomToken();
    const config = `data_dir = "${escapeTomlPath(path.join(hermitHome, 'cc-connect', 'data'))}"
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
${buildBootstrapProjectToml()}`;
    writeFileSync(ccConnectConfigPath, config, 'utf-8');
  }

  let raw = readFileSync(ccConnectConfigPath, 'utf-8');
  if (!hasProjectEntries(raw)) {
    raw = `${raw.trimEnd()}\n${buildBootstrapProjectToml()}`;
    writeFileSync(ccConnectConfigPath, raw, 'utf-8');
  }

  return {
    managementToken:
      process.env.CC_CONNECT_TOKEN ||
      process.env.CC_CONNECT_MANAGEMENT_TOKEN ||
      parseTomlToken(raw, 'management'),
    bridgeToken:
      process.env.CC_CONNECT_BRIDGE_TOKEN ||
      process.env.CC_CONNECT_TOKEN ||
      parseTomlToken(raw, 'bridge'),
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

function resolveCcConnectRunner() {
  const pkgPath = require.resolve('cc-connect/package.json');
  return path.join(path.dirname(pkgPath), 'run.js');
}

function resolveTsxCli() {
  return require.resolve('tsx/cli');
}

let ccConnectProcess = null;
let ccTokens = {
  managementToken: process.env.CC_CONNECT_TOKEN || process.env.CC_CONNECT_MANAGEMENT_TOKEN || '',
  bridgeToken: process.env.CC_CONNECT_BRIDGE_TOKEN || process.env.CC_CONNECT_TOKEN || '',
};

if (!skipCcConnect) {
  ccTokens = ensureCcConnectConfig();
  const ccBaseUrl = process.env.CC_CONNECT_BASE_URL || 'http://127.0.0.1:9820';
  const alreadyRunning = await waitForCcConnect(ccBaseUrl, ccTokens.managementToken, 1_000);
  if (alreadyRunning) {
    console.log(`[openHermit] cc-connect already running: ${ccBaseUrl}`);
  } else {
    console.log('[openHermit] Starting bundled cc-connect...');
    console.log(`[openHermit] cc-connect config: ${ccConnectConfigPath}`);
    ccConnectProcess = spawn(process.execPath, [resolveCcConnectRunner(), '-config', ccConnectConfigPath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CC_CONNECT_TOKEN: ccTokens.managementToken,
        CC_CONNECT_MANAGEMENT_TOKEN: ccTokens.managementToken,
        CC_CONNECT_BRIDGE_TOKEN: ccTokens.bridgeToken,
      },
      stdio: 'inherit',
    });
    const ready = await waitForCcConnect(ccBaseUrl, ccTokens.managementToken, 30_000);
    if (!ready) {
      console.warn('[openHermit] cc-connect did not become ready within 30s; openHermit will keep trying via API.');
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

const serverProcess = spawn(process.execPath, [resolveTsxCli(), 'src/main/server.ts'], {
  cwd: repoRoot,
  env: {
    ...process.env,
    PORT: port,
    HOST: process.env.HOST || '127.0.0.1',
    NODE_ENV: 'production',
    HERMIT_HOME: hermitHome,
    CC_CONNECT_TOKEN: ccTokens.managementToken,
    CC_CONNECT_MANAGEMENT_TOKEN: ccTokens.managementToken,
    CC_CONNECT_BRIDGE_TOKEN: ccTokens.bridgeToken,
    CC_CONNECT_CONFIG: ccConnectConfigPath,
  },
  stdio: 'inherit',
});

serverProcess.on('exit', (code) => {
  if (code !== 0) {
    console.error(`[openHermit] Server exited with code ${code}`);
    process.exit(code ?? 1);
  }
});

process.on('SIGINT', () => {
  console.log('\n[openHermit] Shutting down...');
  serverProcess.kill('SIGINT');
  ccConnectProcess?.kill('SIGINT');
});

process.on('SIGTERM', () => {
  console.log('\n[openHermit] Shutting down...');
  serverProcess.kill('SIGTERM');
  ccConnectProcess?.kill('SIGTERM');
});

console.log(`[openHermit] Server starting on http://127.0.0.1:${port}`);
console.log('[openHermit] Press Ctrl+C to stop\n');
