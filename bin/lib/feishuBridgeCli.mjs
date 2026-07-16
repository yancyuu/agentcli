// feishuBridgeCli.mjs — lifecycle helper for feishu-codex-bridge.
//
// Backs the "本地工作台 → 飞书 Codex 桥" menu actions. The bridge is the npm
// package `@modelzen/feishu-codex-bridge` (bin `feishu-codex-bridge`) — a
// Feishu/Lark group → local Codex / Claude Code bridge. It is NOT a bundled
// dependency: the first time the user turns it on in 本地工作台 we install it on
// demand via `npm i -g` (ensureFeishuCodexBridge), then start it. Keeps the
// default install lean — the ~26M Lark SDK is only pulled when 飞书桥 is used.
//
// Stays in the bin/lib shape: importable, no import-time side effects, returns
// structured results the caller renders, never throws. The daemon writes its pid
// to `~/.feishu-codex-bridge/service.pid`, so running-state is a pid-file +
// liveness check — no per-repaint subprocess.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

const PACKAGE = '@modelzen/feishu-codex-bridge';
const BINARY = 'feishu-codex-bridge';
// Bundled bin inside the optionalDependency; resolved via require.resolve so we
// never depend on a global PATH install (mirrors postinstall's hermit-bridge
// resolution). The global `which feishu-codex-bridge` is only a fallback for when
// the optional dep didn't install.
const BUNDLED_BIN = `${PACKAGE}/bin/feishu-codex-bridge.mjs`;
const DATA_DIR = path.join(homedir(), '.feishu-codex-bridge');
const PID_FILE = path.join(DATA_DIR, 'service.pid');
const BOTS_FILE = path.join(DATA_DIR, 'bots.json');
// fcb's launchd LaunchAgent label (src/service/launchd.ts). `start` installs this on
// macOS; the daemon pid isn't in service.pid there (recordServicePid is win32-only),
// so we probe launchd for it — same trick fcb's own `status` uses.
const LAUNCHD_LABEL = 'ai.feishu-codex-bridge.bot';
// daemon 内嵌 Web 控制台的发现文件（{port, token, pid}，0600）。daemon 起来时写入；
// token 是稳定值（见 web-token），所以这条带 token 的 URL 重启后仍然有效。
const WEB_CONSOLE_FILE = path.join(DATA_DIR, 'web-console.json');

/**
 * Resolve how to invoke the bridge. Prefers the BUNDLED dependency (shipped with
 * AgentCli → "默认安装"), falls back to a global `feishu-codex-bridge` on PATH.
 * Returns a launcher {cmd, args, displayPath, via} or null.
 *
 * The bundled bin is an .mjs script → invoke `node <mjs>`; a PATH binary runs
 * directly. One resolver + one spawn contract means lifecycle callers never
 * branch on how the bridge was found.
 */
function resolveBridgeLauncher() {
  try {
    const mjs = require.resolve(BUNDLED_BIN);
    return { cmd: process.execPath, args: [mjs], displayPath: mjs, via: 'bundled' };
  } catch {
    // bundled dep absent (optionalDependency skipped/failed) → try global PATH.
  }
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const r = spawnSync(cmd, [BINARY], { encoding: 'utf-8' });
    const found = (r.stdout || '').split(/\r?\n/)[0]?.trim();
    if (found) return { cmd: found, args: [], displayPath: found, via: 'global' };
  } catch {
    // which/where unavailable — treat as not found.
  }
  return null;
}

/** Spawn the bridge via the resolved launcher. Returns null when not resolvable. */
function runBridge(args, opts = {}) {
  const launcher = resolveBridgeLauncher();
  if (!launcher) return null;
  return spawnSync(launcher.cmd, [...launcher.args, ...args], {
    encoding: 'utf-8',
    // `node <abs-path>` never needs a shell; global bins on Windows are .cmd shims.
    shell: launcher.via === 'global' && process.platform === 'win32',
    ...opts,
  });
}

/** First positive integer found in the pid file contents, or null. Pure. */
export function parseFeishuBridgePid(raw) {
  if (typeof raw !== 'string') return null;
  const match = raw.match(/\d+/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Current daemon pid read from `service.pid`, or null when absent/unparseable. */
export function readFeishuBridgePid() {
  try {
    if (!existsSync(PID_FILE)) return null;
    return parseFeishuBridgePid(readFileSync(PID_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Resolve the live daemon pid. fcb's `start` installs a launchd LaunchAgent on
 * macOS; service.pid is written on Windows only (recordServicePid is win32-guarded),
 * so on macOS we ask launchd — mirroring fcb's statusLaunchd
 * (`launchctl print gui/<uid>/<label>` → `pid = N`). service.pid covers Windows.
 */
function readBridgeDaemonPid() {
  const filePid = readFeishuBridgePid();
  if (filePid) return filePid;
  if (process.platform === 'darwin') {
    try {
      const r = spawnSync('launchctl', ['print', `gui/${userInfo().uid}/${LAUNCHD_LABEL}`], { encoding: 'utf-8' });
      if (r.status === 0) {
        const m = (r.stdout || '').match(/\bpid\s*=\s*(\d+)/);
        const n = m ? Number(m[1]) : null;
        if (n && Number.isSafeInteger(n) && n > 0) return n;
      }
    } catch {
      // launchctl unavailable / service not loaded → no pid.
    }
  }
  return null;
}

/** launchctl kickstart — force the loaded LaunchAgent to run now (macOS only). */
function kickstartBridgeDaemon() {
  if (process.platform !== 'darwin') return false;
  try {
    const r = spawnSync('launchctl', ['kickstart', `gui/${userInfo().uid}/${LAUNCHD_LABEL}`], { encoding: 'utf-8' });
    return r.status === 0;
  } catch {
    return false;
  }
}

/**
 * Poll for a live daemon pid. fcb's `start` installs the launchd job but doesn't
 * always actually run the daemon (launchd can leave it "loaded, not running");
 * callers kickstart then re-poll. Returns the live pid, or null on timeout.
 */
async function waitForBridgeDaemonUp({ timeoutMs = 3000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pid = readBridgeDaemonPid();
    if (pid && isPidAlive(pid)) return pid;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

/** True when a pid is live. `process.kill(pid, 0)` throws on dead/foreign pids. */
function isPidAlive(pid) {
  if (!pid || !Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Bridge resolvable — bundled dep present OR a global binary on PATH. */
export function isFeishuBridgeInstalled() {
  return resolveBridgeLauncher() !== null;
}

/** Daemon running = installed AND its (launchd / service.pid) daemon pid is live. */
export function isFeishuBridgeRunning() {
  return isFeishuBridgeInstalled() && isPidAlive(readBridgeDaemonPid());
}

/** Configured = a bot is registered. `bot init` writes bots.json ({bots:[...]}). */
export function feishuBridgeConfigured() {
  try {
    if (!existsSync(BOTS_FILE)) return false;
    const parsed = JSON.parse(readFileSync(BOTS_FILE, 'utf-8'));
    return Array.isArray(parsed.bots) && parsed.bots.length > 0;
  } catch {
    return false;
  }
}

/** Snapshot the menu reads on every repaint (cheap; same pattern as web/usage). */
export function feishuBridgeState() {
  const launcher = resolveBridgeLauncher();
  return {
    installed: launcher !== null,
    configured: feishuBridgeConfigured(),
    running: launcher !== null && isPidAlive(readBridgeDaemonPid()),
    pid: readBridgeDaemonPid(),
    binPath: launcher?.displayPath ?? null,
    dataDir: DATA_DIR,
  };
}

/**
 * Pure: parse the daemon's web-console discovery record into {url, port, pid}.
 * Split from the file read so the URL-building logic is unit-testable without a
 * real data dir — mirrors the parseFeishuBridgePid / readFeishuBridgePid split.
 * Accepts the JSON the daemon writes ({port, token, pid}); null when the record
 * can't publish a reachable URL (missing port/token, malformed JSON).
 */
export function parseFeishuBridgeWebConsole(raw) {
  let rec;
  try {
    rec = typeof raw === 'string' ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
  if (!rec || typeof rec.port !== 'number' || typeof rec.token !== 'string' || !rec.token) {
    return null;
  }
  return {
    url: `http://127.0.0.1:${rec.port}/?token=${encodeURIComponent(rec.token)}`,
    port: rec.port,
    pid: typeof rec.pid === 'number' ? rec.pid : null,
  };
}

/**
 * Resolve the daemon's embedded web-console URL from its discovery file
 * (`web-console.json` = {port, token, pid}). The daemon writes this when it serves
 * the console; fcb builds the URL the same way (`http://127.0.0.1:<port>/?token=`).
 * Returns the parsed record or null when the daemon hasn't published one yet.
 * Pure file read — callers gate on the daemon actually running.
 */
export function feishuBridgeWebUrl() {
  try {
    if (!existsSync(WEB_CONSOLE_FILE)) return null;
    return parseFeishuBridgeWebConsole(readFileSync(WEB_CONSOLE_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Ensures the bridge binary is available. feishu-codex-bridge is installed on
 * demand (not bundled): this globally `npm i -g @modelzen/feishu-codex-bridge`
 * the first time the user enables 飞书桥. Resolves to a structured result (never
 * throws) so the menu can always render an outcome.
 */
export async function ensureFeishuCodexBridge() {
  const existing = resolveBridgeLauncher();
  if (existing) {
    return { ok: true, alreadyInstalled: true, binPath: existing.displayPath, message: `已安装：${existing.displayPath}` };
  }

  const npmCheck = spawnSync('npm --version', { encoding: 'utf-8', shell: true });
  if (npmCheck.status !== 0 || !(npmCheck.stdout || '').trim()) {
    return { ok: false, alreadyInstalled: false, message: '未检测到 npm，请先安装 Node.js / npm' };
  }

  // shell: true so npm.cmd resolves on Windows (spawn without shell → ENOENT).
  const install = spawnSync(`npm install -g ${PACKAGE}`, { encoding: 'utf-8', shell: true });
  if (install.status !== 0) {
    return {
      ok: false,
      alreadyInstalled: false,
      message: `安装失败（npm exit ${install.status}）`,
      detail: (install.stderr || install.stdout || '').slice(-400),
    };
  }

  const installed = resolveBridgeLauncher();
  return {
    ok: true,
    alreadyInstalled: false,
    binPath: installed?.displayPath ?? null,
    message: installed ? `已安装：${installed.displayPath}` : '安装完成，但暂未解析到 feishu-codex-bridge（重开终端后再试）',
  };
}

/** Run a bridge subcommand via runBridge; normalizes stdout/stderr/exit. */
function runBridgeSubcommand(args) {
  const r = runBridge(args);
  if (!r) {
    return { ok: false, code: null, message: `未安装 ${BINARY}（先开启飞书 Codex 桥以自动安装）`, stdout: '', stderr: '' };
  }
  const stdout = (r.stdout || '').trim();
  const stderr = (r.stderr || '').trim();
  return { ok: r.status === 0, code: r.status, stdout, stderr, message: stdout || stderr || `exit ${r.status}` };
}

/**
 * Guide the user through bot setup by handing the terminal to fcb's own
 * `bot init` wizard (stdio inherit). fcb asks for App ID / App Secret (and
 * tenant / scan-code) itself and writes bots.json — hermit does NOT duplicate
 * its credential/config logic. Returns whether a bot is registered afterwards.
 */
export async function configureFeishuBridge() {
  if (!resolveBridgeLauncher()) {
    return { ok: false, configured: false, message: `未安装 ${BINARY}（先开启飞书 Codex 桥以自动安装）` };
  }
  // spawnSync pauses hermit's readline while bot init owns the TTY; on exit,
  // control returns here. stdio:'inherit' so the user sees/answers fcb's prompts.
  const r = runBridge(['bot', 'init'], { stdio: 'inherit' });
  const configured = feishuBridgeConfigured();
  return {
    ok: configured,
    configured,
    message: configured ? '已配置飞书应用' : (r && r.status === 0 ? '向导已结束，但未检测到机器人' : `bot init 退出（code ${r?.status ?? '?'}）`),
  };
}

/**
 * Start the bridge daemon. Ensures the binary first (on-demand fallback), then
 * runs `feishu-codex-bridge start` (the daemonizing variant — it writes
 * service.pid and returns). Detached so it survives the menu session.
 */
export async function startFeishuBridge() {
  if (isFeishuBridgeRunning()) {
    return { ok: true, alreadyRunning: true, pid: readBridgeDaemonPid(), message: '飞书 Codex 桥已在运行' };
  }
  const ensured = await ensureFeishuCodexBridge();
  if (!ensured.ok) return { ok: false, message: ensured.message, detail: ensured.detail };

  // `start` daemonizes and writes service.pid; capture its banner for the result.
  const r = runBridge(['start']);
  if (!r) {
    return { ok: false, message: `未安装 ${BINARY}（先开启飞书 Codex 桥以自动安装）` };
  }
  const out = (r.stdout || '').trim();
  const err = (r.stderr || '').trim();
  // fcb's `start` installs the launchd job but doesn't always actually run the
  // daemon (launchd can leave it "loaded, not running"). Poll for a live pid; if
  // it never appears, kickstart and re-poll — so "已启动" means really running.
  let pid = await waitForBridgeDaemonUp({ timeoutMs: 3000 });
  if (!pid) {
    kickstartBridgeDaemon();
    pid = await waitForBridgeDaemonUp({ timeoutMs: 3000 });
  }
  return {
    ok: pid !== null || r.status === 0,
    alreadyRunning: false,
    pid,
    message: pid ? `已启动（pid ${pid}）` : (out || err || `启动返回 exit ${r.status}，但守护进程未运行`),
    detail: pid ? '' : (err || out).slice(-400),
  };
}

/** Stop the bridge daemon via its own `stop` subcommand (clears service.pid). */
export async function stopFeishuBridge() {
  if (!isFeishuBridgeInstalled()) {
    return { ok: true, message: `${BINARY} 未安装，无需停止` };
  }
  const r = runBridgeSubcommand(['stop']);
  return { ok: r.ok, message: r.ok ? (r.stdout || '已停止') : r.message, detail: r.ok ? '' : r.stderr };
}

/** Surface `feishu-codex-bridge status` + the pid-file view for the status row. */
export async function feishuBridgeStatus() {
  const state = feishuBridgeState();
  const probe = isFeishuBridgeInstalled() ? runBridgeSubcommand(['status']) : null;
  return {
    installed: state.installed,
    running: state.running,
    pid: state.pid,
    binPath: state.binPath,
    dataDir: state.dataDir,
    bridgeOutput: probe ? (probe.stdout || probe.stderr || probe.message) : `${BINARY} 未安装`,
  };
}
