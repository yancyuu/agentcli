// feishuAssistant.mjs — create a Feishu personal assistant project via hermit-bridge.
//
// Bridges the CLI layer (hermit.mjs) to hermit-bridge's `create feishu-assistant`
// subcommand. hermit-bridge is the bundled optionalDependency that ships the
// `cc-connect` / `hermit-bridge` binary. This module follows the same pattern as
// feishuBridgeCli.mjs: no import-time side effects, structured results, never throws.
//
// Usage in hermit.mjs:
//
//   hermit create-feishu-assistant --name <name> [--ai-key <key>] [--description <desc>]
//
// Workflow:
//   1. Resolve the hermit-bridge binary (bundled or global PATH).
//   2. Spawn `hermit-bridge create feishu-assistant --name <name> [--ai-key …] [--description …]`.
//   3. hermit-bridge creates a project with a Feishu engine + embedded AI credentials,
//      writes ~/.hermit/teams/<name>/manifest.json, and prints the team slug on success.
//   4. Return the parsed result (ok, teamSlug, message, detail) to the caller.
//
// hermit-bridge must be installed and its management API reachable (it auto-starts on
// first launch via hermit-bridge install). If the API is down the command will fail
// with a clear error — callers should direct the user to run `hermit bridge status`.
//
// The Feishu personal assistant uses a Claude Code engine with a single-user Feishu bot
// that sends/receives in personal 1:1 chats. The user provides their own Feishu app
// credentials (App ID + App Secret) via environment variables or the --app-id / --app-secret
// flags; hermit-bridge stores them in its per-project config.
//
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const PACKAGE = 'hermit-bridge';
const BINARY = process.platform === 'win32' ? 'cc-connect.exe' : 'cc-connect';

const BUNDLED_BIN_BASE = `${PACKAGE}/bin/${BINARY}`;

/**
 * Resolve how to invoke hermit-bridge. Prefers the bundled optionalDependency
 * (shipped with AgentCli), falls back to a global `hermit-bridge` on PATH.
 * Returns {cmd, args, displayPath, via} or null when not found.
 */
function resolveHermitBridgeLauncher() {
  try {
    const mjs = require.resolve(BUNDLED_BIN_BASE);
    return { cmd: process.execPath, args: [mjs], displayPath: mjs, via: 'bundled' };
  } catch {
    // bundled dep absent → try global PATH.
  }
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const r = spawnSync(cmd, [BINARY], { encoding: 'utf-8' });
    const found = (r.stdout || '').split(/\r?\n/)[0]?.trim();
    if (found) return { cmd: found, args: [], displayPath: found, via: 'global' };
  } catch {
    // which/where unavailable.
  }
  return null;
}

/**
 * Parse the structured output line hermit-bridge prints on success.
 * Looks for a trailing JSON blob like {ok:true,teamSlug:"…"} or {ok:false,error:"…"}
 * appended to the human-readable stdout. Falls back to treating stdout as the message.
 */
function parseHermitBridgeOutput(stdout, stderr) {
  const raw = (stdout || '').trim();
  const lines = raw.split('\n');
  // Scan from the end for a JSON object line.
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === 'object' && parsed !== null) return parsed;
      } catch {
        // Not JSON — keep scanning.
      }
    }
  }
  // No structured output found; treat stdout as message.
  return { ok: true, message: raw || (stderr || '').trim() || '命令执行完成' };
}

/**
 * Result shape returned by all public functions in this module.
 * @typedef {{ ok: boolean; alreadyExists?: boolean; teamSlug?: string; message: string; detail?: string }} CreateFeishuAssistantResult
 */

/**
 * Check whether hermit-bridge is available (bundled or on PATH).
 * @returns {boolean}
 */
export function isHermitBridgeInstalled() {
  return resolveHermitBridgeLauncher() !== null;
}

/**
 * Create a new Feishu personal assistant project via hermit-bridge.
 *
 * @param {object} opts
 * @param {string} opts.name          - Unique project / team name (slug-safe, will be normalized).
 * @param {string} [opts.aiKey]       - API key for the embedded Claude engine (sk-… or ANTHROPIC_API_KEY value).
 * @param {string} [opts.description] - Human-readable description shown in the UI.
 * @param {string} [opts.appId]       - Feishu App ID (optional; hermit-bridge may prompt or use env).
 * @param {string} [opts.appSecret]   - Feishu App Secret (optional; hermit-bridge may prompt or use env).
 * @returns {CreateFeishuAssistantResult}
 */
export function createFeishuAssistant({ name, aiKey, description, appId, appSecret } = {}) {
  const launcher = resolveHermitBridgeLauncher();
  if (!launcher) {
    return {
      ok: false,
      message: `${BINARY} 未安装（运行 hermit bridge install 或重新安装 Hermit）`,
      detail: 'hermit-bridge optional dependency not found',
    };
  }

  if (!name || !name.trim()) {
    return { ok: false, message: '缺少项目名称（--name <名称>）' };
  }

  const args = ['create', 'feishu-assistant', '--name', name.trim()];
  if (aiKey) args.push('--ai-key', aiKey);
  if (description) args.push('--description', description);
  if (appId) args.push('--app-id', appId);
  if (appSecret) args.push('--app-secret', appSecret);

  const r = spawnSync(launcher.cmd, [...launcher.args, ...args], {
    encoding: 'utf-8',
    // hermit-bridge CLI is interactive when credentials are missing; stdio:inherit lets
    // it read from TTY so the user can fill in App ID / Secret if not provided.
    // On non-TTY (piped), hermit-bridge should return a non-zero exit with a clear message.
    // shell: true only on Windows global-bin PATH (not needed for node <mjs>).
    shell: launcher.via === 'global' && process.platform === 'win32',
  });

  const stdout = (r.stdout || '').trim();
  const stderr = (r.stderr || '').trim();
  const parsed = parseHermitBridgeOutput(stdout, stderr);

  if (r.status === 0 || parsed.ok) {
    return {
      ok: true,
      alreadyExists: parsed.alreadyExists ?? false,
      teamSlug: parsed.teamSlug ?? name.trim(),
      message: parsed.message || stdout || '飞书个人助理已创建',
      detail: parsed.detail ?? '',
    };
  }

  // Non-zero exit: surface the error clearly.
  const errorText = parsed.error || stderr || stdout || `exit ${r.status}`;
  return {
    ok: false,
    message: `创建失败：${errorText}`,
    detail: stdout,
  };
}

/**
 * List all Feishu-assistant projects known to hermit-bridge.
 * Spawns `hermit-bridge list feishu-assistants` and returns the parsed JSON array.
 *
 * @returns {{ ok: boolean; projects: Array<{name: string; teamSlug: string; status: string}>; message: string }}
 */
export function listFeishuAssistants() {
  const launcher = resolveHermitBridgeLauncher();
  if (!launcher) {
    return { ok: false, projects: [], message: `${BINARY} 未安装` };
  }

  const r = spawnSync(
    launcher.cmd,
    [...launcher.args, 'list', 'feishu-assistants', '--json'],
    { encoding: 'utf-8' }
  );

  if (r.status !== 0) {
    return { ok: false, projects: [], message: (r.stderr || r.stdout || '').trim() || `exit ${r.status}` };
  }

  try {
    const parsed = JSON.parse((r.stdout || '').trim());
    return { ok: true, projects: Array.isArray(parsed) ? parsed : [], message: '' };
  } catch {
    return { ok: false, projects: [], message: '无法解析 hermit-bridge 输出' };
  }
}
