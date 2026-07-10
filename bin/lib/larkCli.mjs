// larkCli.mjs — quick-install helper for the official Lark/Feishu CLI.
//
// Backs the "本地数字员工工作台 → 快速安装 lark-cli" menu action. The CLI is
// the npm package `@larksuite/cli` (binary `lark-cli`), per the project's own
// ops docs (scripts/build-pages.mjs expects a `lark-cli` binary on PATH).
//
// Stays in the bin/lib shape: importable, no import-time side effects, returns a
// structured result the caller renders. It only bootstraps the GLOBAL binary —
// the per-team profile wrapper (LARK_CLI_PROFILE in each team .env) is team
// setup, documented in scripts/build-pages.mjs, and intentionally out of scope.
import { spawn, spawnSync } from 'node:child_process';

const PACKAGE = '@larksuite/cli';
const BINARY = 'lark-cli';

function spawnLarkCli(cmd, args, options) {
  const spawn = globalThis.__larkCli_test_spawn || spawnSync;
  return spawn(cmd, args, options);
}

function findBinary() {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const r = spawnLarkCli(cmd, [BINARY], { encoding: 'utf-8' });
    const found = (r.stdout || '').split(/\r?\n/)[0]?.trim();
    if (found) return found;
  } catch {
    // which/where unavailable — treat as not found.
  }
  return null;
}

function npmGlobalBin() {
  try {
    const r = spawnLarkCli('npm', ['prefix', '-g'], { encoding: 'utf-8', shell: true });
    const prefix = (r.stdout || '').trim();
    if (!prefix) return null;
    return process.platform === 'win32' ? prefix : `${prefix}/bin`;
  } catch {
    return null;
  }
}

const DIGITAL_WORKER_LARK_SCOPES = [
  'contact:contact.base:readonly',
  'contact:user.base:readonly',
  'contact:user.basic_profile:readonly',
  'docs:document.content:read',
  'docx:document:readonly',
  'docx:document:write_only',
  'drive:drive:readonly',
  'im:chat:read',
  'im:message:readonly',
  'im:message.send_as_user',
];

function runLarkCli(args, { profile, input } = {}) {
  const binary = findBinary();
  if (!binary) return null;
  const fullArgs = profile ? ['--profile', profile, ...args] : args;
  return spawnLarkCli(binary, fullArgs, { encoding: 'utf-8', shell: process.platform === 'win32', input });
}

function parseJsonOutput(result) {
  try {
    return JSON.parse((result?.stdout || '').trim());
  } catch {
    return null;
  }
}

function getLarkUserIdentity(statusResult) {
  const parsed = parseJsonOutput(statusResult);
  const user = parsed?.identities?.user;
  if (!user || user.available !== true || user.verified !== true) return null;
  return user;
}

function hasMissingScopes(result) {
  const parsed = parseJsonOutput(result);
  if (!parsed || parsed.ok !== true) return true;
  return Array.isArray(parsed.missing) && parsed.missing.length > 0;
}

function listLarkCliProfiles() {
  // NOTE: `lark-cli profile list` does NOT accept `--json` (v1.0.53 rejects it as
  // unknown_flag). The plain subcommand already prints a JSON array to stdout, so
  // parse that directly. Other subcommands (auth status/check/login) do accept
  // `--json` and use it elsewhere above.
  const result = runLarkCli(['profile', 'list']);
  if (!result || result.status !== 0) return null;
  const parsed = parseJsonOutput(result);
  return Array.isArray(parsed) ? parsed : null;
}

export function ensureLarkCliProfile({ profile, appId, appSecret, brand = 'feishu' }) {
  if (!profile || !appId || !appSecret) {
    return { ok: false, message: '缺少 lark-cli profile / app_id / app_secret' };
  }
  const installed = findBinary();
  if (!installed) return { ok: false, message: '未检测到 lark-cli' };

  // lark-cli maps each app_id to at most one profile. When the same Feishu app
  // backs multiple digital workers, forcing a new profile named after the worker
  // fails validation. Reuse the existing profile for this app_id if present.
  const existing = (listLarkCliProfiles() || []).find((p) => p.appId === appId);
  if (existing) {
    return { ok: true, profile: existing.name, reused: true, message: `已复用 lark-cli profile：${existing.name}` };
  }

  const result = runLarkCli([
    'profile', 'add',
    '--name', profile,
    '--app-id', appId,
    '--brand', brand,
    '--app-secret-stdin',
  ], { input: `${appSecret}\n` });
  if (result?.status === 0) return { ok: true, profile, message: `已准备 lark-cli profile：${profile}` };
  const detail = (result?.stderr || result?.stdout || '').trim();
  if (/already exists|已存在|exists/i.test(detail)) {
    const after = (listLarkCliProfiles() || []).find((p) => p.appId === appId);
    if (after) return { ok: true, profile: after.name, reused: true, message: `已复用 lark-cli profile：${after.name}` };
    return { ok: true, profile, message: `已复用 lark-cli profile：${profile}` };
  }
  return { ok: false, profile, message: '创建 lark-cli profile 失败', detail };
}

export function checkLarkCliDigitalWorkerAuth({ profile } = {}) {
  const status = runLarkCli(['auth', 'status', '--json', '--verify'], { profile });
  if (!status || status.status !== 0) {
    return { ok: false, message: '飞书个人身份授权状态不可用', detail: (status?.stderr || status?.stdout || '').trim() };
  }
  const userIdentity = getLarkUserIdentity(status);
  if (!userIdentity) {
    return {
      ok: false,
      message: '需要绑定飞书个人身份',
      detail: (status?.stdout || status?.stderr || '').trim(),
      scopes: DIGITAL_WORKER_LARK_SCOPES,
    };
  }
  const check = runLarkCli(['auth', 'check', '--json', '--scope', DIGITAL_WORKER_LARK_SCOPES.join(' ')], { profile });
  if (!check || check.status !== 0 || hasMissingScopes(check)) {
    return {
      ok: false,
      message: '需要授权飞书文档、消息和用户信息权限',
      detail: (check?.stdout || check?.stderr || '').trim(),
      scopes: DIGITAL_WORKER_LARK_SCOPES,
      user: userIdentity,
    };
  }
  return {
    ok: true,
    message: userIdentity.userName ? `已绑定个人：${userIdentity.userName}` : '飞书个人身份已绑定',
    scopes: DIGITAL_WORKER_LARK_SCOPES,
    user: userIdentity,
  };
}

const AUTH_POLL_TIMEOUT_MS = 5 * 60 * 1000;

function runLarkCliAsync(args, { profile } = {}) {
  const binary = findBinary();
  if (!binary) return Promise.resolve(null);
  const child = globalThis.__larkCli_test_spawn_async || spawn;
  const fullArgs = profile ? ['--profile', profile, ...args] : args;
  const proc = child(binary, fullArgs, { shell: process.platform === 'win32' });
  let stdout = '';
  let stderr = '';
  proc.stdout?.on('data', (chunk) => { stdout += chunk; });
  proc.stderr?.on('data', (chunk) => { stderr += chunk; });
  return new Promise((resolve) => {
    proc.on('close', (code) => {
      resolve({ status: code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    proc.on('error', (err) => {
      resolve({ status: 1, stdout: '', stderr: err.message });
    });
  });
}

export async function ensureLarkCliDigitalWorkerAuth(renderQr, options = {}) {
  const installed = await installLarkCli();
  if (!installed.ok) return { ...installed, authReady: false };

  let profile = options.profile;
  if (profile && options.appId && options.appSecret) {
    const profileResult = ensureLarkCliProfile({
      profile,
      appId: options.appId,
      appSecret: options.appSecret,
      brand: options.brand,
    });
    if (!profileResult.ok) return { ...profileResult, installed, authReady: false };
    profile = profileResult.profile || profile;
  }
  const runOpts = { profile };

  const current = checkLarkCliDigitalWorkerAuth(runOpts);
  if (current.ok) return { ok: true, authReady: true, installed, auth: current, profile, message: current.message };

  // Step 1: initiate device flow — returns verification URL + device code immediately.
  const init = runLarkCli([
    'auth', 'login', '--no-wait', '--json',
    '--scope', DIGITAL_WORKER_LARK_SCOPES.join(' '),
  ], runOpts);
  const initResult = parseJsonOutput(typeof init === 'object' && init !== null && 'then' in init ? await init : init);
  if (!initResult?.verification_url || !initResult?.device_code) {
    const raw = typeof init === 'object' && init !== null && 'then' in init ? await init : init;
    return {
      ok: false,
      authReady: false,
      installed,
      profile,
      message: '飞书授权初始化失败',
      detail: raw?.stderr || raw?.stdout || '',
      scopes: DIGITAL_WORKER_LARK_SCOPES,
    };
  }

  // Display verification URL / QR to the user.
  let renderStatus = null;
  if (typeof renderQr === 'function') {
    const maybeStatus = await renderQr(initResult.verification_url, current, initResult);
    if (typeof maybeStatus === 'function') renderStatus = maybeStatus;
  } else {
    console.log(initResult.verification_url);
  }

  // Step 2: poll until user completes authorization in browser.
  const startedAt = Date.now();
  while (Date.now() - startedAt < AUTH_POLL_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const poll = await runLarkCliAsync(['auth', 'login', '--device-code', initResult.device_code, '--json'], runOpts);
    const pollResult = parseJsonOutput(poll);
    renderStatus?.(pollResult?.status || pollResult?.error?.subtype || (poll?.status === 0 ? 'completed' : 'pending'));
    if (poll?.status === 0 && (!pollResult?.error)) break;
    if (pollResult?.ok === true) break;

    // lark-cli 1.0.53 can keep returning authorization_pending (or report an
    // already-consumed device code) after the browser has completed authorization.
    // The persisted profile token is authoritative, so verify its identity/scopes
    // on every poll before treating the device-code response as expired.
    const interim = checkLarkCliDigitalWorkerAuth(runOpts);
    if (interim.ok) {
      renderStatus?.('completed');
      break;
    }
    if (pollResult?.error?.subtype === 'expired') {
      return { ok: false, authReady: false, installed, profile, message: '飞书授权已过期，请重新开通数字员工', scopes: DIGITAL_WORKER_LARK_SCOPES };
    }
  }

  const verified = checkLarkCliDigitalWorkerAuth(runOpts);
  return verified.ok
    ? { ok: true, authReady: true, installed, auth: verified, profile, message: verified.message }
    : { ok: false, authReady: false, installed, auth: verified, profile, message: verified.message, detail: verified.detail };
}

/**
 * Ensures the `lark-cli` binary is available. Installs `@larksuite/cli` globally
 * via npm when missing. Resolves to a structured result (never throws) so the
 * menu can always render an outcome.
 */
export async function installLarkCli() {
  const existing = findBinary();
  if (existing) {
    return { ok: true, alreadyInstalled: true, binPath: existing, message: `已安装：${existing}` };
  }

  const npmCheck = spawnLarkCli('npm', ['--version'], { encoding: 'utf-8', shell: true });
  if (npmCheck.status !== 0 || !(npmCheck.stdout || '').trim()) {
    return { ok: false, alreadyInstalled: false, message: '未检测到 npm，请先安装 Node.js / npm' };
  }

  // shell: true so npm.cmd resolves on Windows (spawn without shell → ENOENT).
  const install = spawnLarkCli('npm', ['install', '-g', PACKAGE], { encoding: 'utf-8', shell: true });
  if (install.status !== 0) {
    return {
      ok: false,
      alreadyInstalled: false,
      message: `安装失败（npm exit ${install.status}）`,
      detail: (install.stderr || install.stdout || '').slice(-400),
    };
  }

  const installed = findBinary() || `${npmGlobalBin()}/${BINARY}`;
  return {
    ok: true,
    alreadyInstalled: false,
    binPath: installed,
    message: installed ? `已安装：${installed}` : '安装完成，但未在 PATH 找到 lark-cli（重开终端后再试）',
  };
}
