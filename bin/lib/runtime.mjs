// runtime.mjs — hermit-bridge runtime config (TOML/migration/ensure), port checks,
// log helpers, dependency resolution, and the bundled-runtime/tsx/alias-loader
// resolvers. Depends only on env + branding.

import {
  repoRoot,
  binDir,
  require,
  port,
  starterProjectName,
  hermitBridgeConfigPath,
  defaultHermitBridgeConfigPath,
  defaultHermitBridgeDataDir,
  legacyRuntimeBridgeConfigPath,
  legacyRuntimeBridgeDataDir,
  conversationUploadLogPath,
} from './env.mjs';
import { BRAND, brandCommand, brandLogPrefix } from '../branding.mjs';

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

export {
checkDependency,
escapeTomlPath,
parseTomlToken,
randomToken,
escapeRegExp,
findProjectBlock,
isManagedBootstrapBlock,
isStarterProjectConfig,
configRequiresClaudeCode,
hasProjectEntries,
commandExists,
ensureClaudeCodeCliIfNeeded,
hasTomlSection,
buildOpenHermitStarterConfig,
normalizeMigratedHermitBridgeConfig,
migrateLegacyHermitBridgeDataIfNeeded,
normalizeHermitBridgeConfigFileIfNeeded,
migrateLegacyHermitBridgeConfigIfNeeded,
ensureOpenHermitRuntimeConfig,
readHermitBridgeConfigState,
waitForHermitBridge,
appendLog,
printLogTail,
readLogTail,
printDeveloperUploadLogs,
waitForRuntimeReady,
resolveHermitBridgeRunner,
resolveTsxLoader,
resolveAliasLoaderRegister,
checkExistingOpenHermitServer,
isTcpPortAvailable,
assertWebPortAvailable,
};
