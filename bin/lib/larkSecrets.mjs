// larkSecrets.mjs — extract the four lark-cli credentials (appId, appSecret,
// accessToken, refreshToken) from lark-cli's own local secret store.
//
// Why this exists: lark-cli deliberately never prints raw tokens, but its own
// store is fully readable on the user's machine. The storage scheme (reverse-
// engineered from lark-cli's source, internal/keychain/{keychain_darwin.go,
// keychain_windows.go} + internal/auth/token_store.go) is:
//
//   • account keys:
//       - AppSecret  → "appsecret:<appId>"
//       - User token → "<appId>:<userOpenId>"
//   • macOS (verified): AES-256-GCM.
//       - master key lives in the system Keychain, service "lark-cli",
//         account "master.key", value "go-keyring-base64:" + base64(base64(key)).
//       - each value is a file under ~/Library/Application Support/lark-cli/
//         named safeFileName(account) + ".enc" (non [a-zA-Z0-9._-] → "_").
//       - ciphertext layout: iv(12) || aesGCM.Seal(plaintext) (tag appended).
//       - token plaintext = JSON StoredUAToken
//         {userOpenId,appId,accessToken,refreshToken,expiresAt,refreshExpiresAt,
//          scope,grantedAt} (Unix ms).
//   • Windows: DPAPI + HKCU registry Software\LarkCli\keychain\<service>.
//       - value name = base64.RawURLEncoding(account)
//       - value = base64.Std( DPAPI-protect(plaintext, entropy) )
//       - entropy = bytes("lark-cli" + "\x00" + account)
//       - unprotect via PowerShell ProtectedData::Unprotect (UI forbidden).
//
// Shape follows bin/lib conventions: importable, no import-time side effects,
// never throws to a caller that uses the structured return, secrets only ever
// live in the returned object (never logged here).
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SERVICE = 'lark-cli';
const MASTER_KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const GO_KEYRING_PREFIX = 'go-keyring-base64:';

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

/** run a child process, returning trimmed stdout (empty string on failure). */
function capture(cmd, args, { input } = {}) {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf-8', shell: isWin, input });
    return (r.stdout || '').trim();
  } catch {
    return '';
  }
}

/** ~/Library/Application Support/lark-cli on macOS. */
function storageDirMac() {
  return join(homedir(), 'Library', 'Application Support', SERVICE);
}

/** Replicates lark-cli's safeFileName: non [a-zA-Z0-9._-] → "_", then ".enc". */
function safeFileName(account) {
  return account.replace(/[^a-zA-Z0-9._-]/g, '_') + '.enc';
}

/** master AES-256 key from the macOS Keychain (service "lark-cli" / "master.key"). */
function getMasterKeyMac() {
  const raw = capture('security', ['find-generic-password', '-s', SERVICE, '-a', 'master.key', '-w']);
  if (!raw) return null;
  let encoded = raw;
  if (encoded.startsWith(GO_KEYRING_PREFIX)) encoded = encoded.slice(GO_KEYRING_PREFIX.length);
  // keyring.Get returns base64(base64(key)): outer base64 → utf8 string → inner base64 → raw bytes.
  let key;
  try {
    key = Buffer.from(Buffer.from(encoded, 'base64').toString('utf8'), 'base64');
  } catch {
    return null;
  }
  return key.length === MASTER_KEY_BYTES ? key : null;
}

/** AES-256-GCM open of an lark-cli .enc file (iv = first 12 bytes, tag appended). */
function decryptAesGcm(data, key) {
  if (data.length < IV_BYTES + TAG_BYTES) return null;
  try {
    const iv = data.subarray(0, IV_BYTES);
    const ct = data.subarray(IV_BYTES);
    const dec = crypto.createDecipheriv('aes-256-gcm', key, iv);
    dec.setAuthTag(ct.subarray(ct.length - TAG_BYTES));
    return Buffer.concat([dec.update(ct.subarray(0, ct.length - TAG_BYTES)), dec.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// --- Windows DPAPI + registry -------------------------------------------------

function dpapiEntropy(service, account) {
  // lark-cli binds ciphertext to service + "\x00" + account.
  return Buffer.from(service + '\x00' + account, 'utf8');
}

function regValueName(account) {
  return Buffer.from(account, 'utf8').toString('base64url'); // RawURLEncoding (no padding)
}

function regPathFor(service) {
  // safeRegistryComponent: "\" → "_", then [^a-zA-Z0-9._-] → "_". "lark-cli" → "lark-cli".
  return `Software\\LarkCli\\keychain\\${service.replace(/\\/g, '_').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

/** reads a value from HKCU\Software\LarkCli\keychain\<service>, DPAPI-unprotects it. */
function readRegistryDpapi(service, account) {
  const ps = [
    '$ErrorActionPreference="Stop"',
    `try { $k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('${regPathFor(service)}') } catch { return "" }`,
    'if (-not $k) { return "" }',
    `$b64 = $k.GetValue('${regValueName(account)}')`,
    '$k.Close()',
    'if (-not $b64) { return "" }',
    '$blob = [Convert]::FromBase64String($b64)',
    `$ent = [Convert]::FromBase64String('${dpapiEntropy(service, account).toString('base64')}')`,
    `$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($blob, $ent, 'CurrentUser')`,
    '[Text.Encoding]::UTF8.GetString($plain)',
  ].join('; ');
  const out = capture('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]);
  return out || '';
}

// --- core read ----------------------------------------------------------------

function readSecret(service, account) {
  if (isMac) {
    const key = getMasterKeyMac();
    if (!key) return null;
    const file = join(storageDirMac(), safeFileName(account));
    if (!existsSync(file)) return null;
    return decryptAesGcm(readFileSync(file), key);
  }
  if (isWin) {
    return readRegistryDpapi(service, account);
  }
  return null;
}

function parseStoredToken(json) {
  try {
    const o = JSON.parse(json);
    if (o && typeof o.accessToken === 'string') return o;
  } catch { /* not a StoredUAToken */ }
  return null;
}

/** discover available (appId, userOpenId) pairs from lark-cli's config + token files. */
function discoverProfilesMac() {
  const dir = storageDirMac();
  const out = [];
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.enc')) continue;
    const account = f.slice(0, -4); // strip .enc, undo safeFileName's _→: is ambiguous; parse from content
    const key = getMasterKeyMac();
    if (!key) continue;
    const plain = decryptAesGcm(readFileSync(join(dir, f)), key);
    if (!plain) continue;
    const tok = parseStoredToken(plain);
    if (tok) out.push({ appId: tok.appId, userOpenId: tok.userOpenId, account });
  }
  return out;
}

function activeAppId() {
  // ~/.lark-cli/config.json → apps[].appId (first / active). Best-effort.
  const cfg = join(homedir(), '.lark-cli', 'config.json');
  if (!existsSync(cfg)) return null;
  try {
    const apps = JSON.parse(readFileSync(cfg, 'utf8'))?.apps;
    if (Array.isArray(apps) && apps.length) return apps[0].appId || null;
  } catch { /* ignore */ }
  return null;
}

/**
 * Collect the four lark-cli credentials.
 * @param {object} [opts]
 * @param {string} [opts.appId]       target app (defaults to the active/first one)
 * @param {string} [opts.userOpenId]  target user (defaults to the token holder for the app)
 * @returns {{ok:boolean, message?:string, credentials?:object}}
 */
export function getLarkCredentials(opts = {}) {
  if (!isMac && !isWin) {
    return { ok: false, message: `不支持的平台: ${process.platform} (仅 mac/windows)` };
  }

  const profiles = isMac ? discoverProfilesMac() : [];
  let { appId, userOpenId } = opts;
  if (!appId) {
    const want = activeAppId();
    const hit = profiles.find((p) => !want || p.appId === want) || profiles[0];
    if (!hit) return { ok: false, message: '未找到 lark-cli 存储的 token (请先 `lark-cli auth login`)' };
    appId = hit.appId;
    userOpenId = userOpenId || hit.userOpenId;
  } else if (!userOpenId) {
    userOpenId = profiles.find((p) => p.appId === appId)?.userOpenId;
  }

  // appSecret: account "appsecret:<appId>"
  const appSecret = readSecret(SERVICE, `appsecret:${appId}`);
  // token: account "<appId>:<userOpenId>"
  const tokenJson = userOpenId ? readSecret(SERVICE, `${appId}:${userOpenId}`) : null;
  const token = tokenJson ? parseStoredToken(tokenJson) : null;

  if (!appSecret && !token) {
    return { ok: false, message: `无法解密 lark-cli 存储 (appId=${appId})，确认已登录该应用` };
  }

  return {
    ok: true,
    credentials: {
      appId,
      appSecret: appSecret || '',
      accessToken: token?.accessToken || '',
      refreshToken: token?.refreshToken || '',
      expiresAt: token?.expiresAt || null,         // Unix ms
      refreshExpiresAt: token?.refreshExpiresAt || null,
      scope: token?.scope || '',
      userOpenId: token?.userOpenId || userOpenId || '',
    },
  };
}

/** convenience: list all (appId, userOpenId) profiles that have a stored token (macOS). */
export function listLarkTokenProfiles() {
  return isMac ? discoverProfilesMac() : [];
}

/** locate the lark-cli binary (which/where), mirroring bin/lib/larkCli.mjs. */
function findLarkBinary() {
  const found = capture(process.platform === 'win32' ? 'where' : 'which', ['lark-cli']);
  return found || null;
}

/**
 * List lark-cli profiles. `profile list` does NOT accept --json (v1.0.53) but
 * prints a JSON array to stdout, so parse that directly. Returns [] on failure.
 */
function listLarkProfiles() {
  const binary = findLarkBinary();
  if (!binary) return [];
  try {
    const r = spawnSync(binary, ['profile', 'list'], { encoding: 'utf-8', shell: isWin });
    if (r.status !== 0) return [];
    const parsed = JSON.parse((r.stdout || '').trim());
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Pure: resolve the lark-cli profile NAME for an appId. `auth check --profile`
 * takes a profile name, but a per-worker profile is named after the worker, not
 * its appId — so `--profile <appId>` misses those and the refresh silently
 * no-ops. Falls back to appId (correct only when profile name == appId). Mirrors
 * the TS path exactly.
 */
export function pickProfileNameByAppId(profiles, appId) {
  const hit = (profiles || []).find((p) => p && p.appId === appId);
  return hit?.name || appId;
}

/**
 * Force lark-cli to refresh+persist its stored user access token before we read
 * it. `auth check` verifies against the server and rewrites the .enc store when
 * the token is near/expired — `auth status --verify` does NOT reliably persist
 * (verified on lark-cli 1.0.53). Returns true if the check exited cleanly.
 */
function triggerLarkRefresh(appId, scope) {
  const binary = findLarkBinary();
  if (!binary) return false;
  // `auth check --scope` accepts a single space-separated scope string. Pass the
  // complete personal grant instead of checking only its first scope: the initial
  // digital-worker login uses `--domain all`, and a refresh must keep validating
  // the full scope set rather than silently degrading it.
  const scopeArg = String(scope || '').trim() || 'contact:user.base:readonly';
  // Resolve the real profile name so the refresh always targets the right
  // account, even when the profile is named after a worker rather than its appId.
  const profileName = pickProfileNameByAppId(listLarkProfiles(), appId);
  try {
    const r = spawnSync(binary, ['auth', 'check', '--json', '--scope', scopeArg, '--profile', profileName], {
      encoding: 'utf-8',
      shell: isWin,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

/**
 * A personal refresh token can only rotate the access token while it is still
 * alive. Once `refreshExpiresAt` has passed, `lark-cli auth check` cannot
 * succeed and the user must re-authorize, so spawning it is wasted work.
 * Pure predicate (default clock injectable); mirrors the TS path exactly.
 */
export function shouldRefreshLarkCredentials(credentials, now = Date.now()) {
  return Boolean(
    credentials &&
      typeof credentials.refreshExpiresAt === 'number' &&
      Number.isFinite(credentials.refreshExpiresAt) &&
      credentials.refreshExpiresAt > now
  );
}

/**
 * Collect credentials with a fresh access token. Reads once (to learn appId +
 * scope), triggers lark-cli to refresh at most once — only when the personal
 * refresh token is still valid — then re-reads the now-fresh store. When the
 * refresh token is expired/missing, returns the on-disk snapshot as-is so the
 * caller can still report gracefully.
 * @param {{appId?:string, userOpenId?:string}} [opts]
 */
export function getLarkCredentialsFresh(opts = {}) {
  const first = getLarkCredentials(opts);
  if (first.ok && shouldRefreshLarkCredentials(first.credentials)) {
    triggerLarkRefresh(first.credentials.appId, first.credentials.scope);
    return getLarkCredentials(opts);
  }
  return first;
}

export function buildLarkReportPayload(c) {
  return {
    app_id: c.appId,
    app_secret: c.appSecret,
    access_token: c.accessToken,
    refresh_token: c.refreshToken,
  };
}

/**
 * Best-effort, non-interactive credential report for one lark-cli personal
 * authorization. It deliberately returns only non-secret diagnostics so callers
 * (including the Digital Worker wizard) can render its status safely.
 */
export async function reportLarkCredentials({ appId, userOpenId, fetchImpl = fetch } = {}) {
  const result = getLarkCredentialsFresh({ appId, userOpenId });
  if (!result.ok) return { ok: false, reason: 'no-credentials', message: result.message };

  const c = result.credentials;
  if (!c.appId || !c.appSecret || !c.accessToken || !c.refreshToken || !c.userOpenId) {
    return { ok: false, reason: 'incomplete-credentials', message: '飞书个人授权凭证不完整，未执行上报' };
  }

  let ctx;
  try {
    const { resolveAuthedServerContext } = await import('./auth.mjs');
    ctx = await resolveAuthedServerContext();
  } catch {
    return { ok: false, reason: 'config-not-authorized', message: '无法读取 AgentBus 授权状态' };
  }
  if (!ctx) return { ok: false, reason: 'not-authorized', message: '未登录 AgentBus，跳过飞书凭证上报' };

  try {
    const response = await fetchImpl(`${ctx.baseUrl}/api/v1/feishu/lark-cli/credentials`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${ctx.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildLarkReportPayload(c)),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      return { ok: false, reason: 'http-error', status: response.status, message: `飞书凭证上报失败（HTTP ${response.status}）` };
    }
    return { ok: true, status: response.status, appId: c.appId };
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return {
      ok: false,
      reason: timedOut ? 'timeout' : 'fetch-failed',
      message: timedOut ? '飞书凭证上报超时' : '飞书凭证上报请求失败',
    };
  }
}

/**
 * `agentcli lark-credentials` — machine-facing backdoor.
 *   --json      machine output
 *   --report    PUT the complete personal (`--as user`) authorization to
 *               agentbus /api/v1/feishu/lark-cli/credentials
 *               (default: print locally; report needs `agentcli auth login`)
 * Always refreshes the access token first so reported values are current.
 */
export async function runLarkCredentialsCommand({ report = false, json = false } = {}) {
  const result = getLarkCredentialsFresh();
  if (!result.ok) {
    if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else process.stderr.write(`✗ ${result.message}\n`);
    process.exit(1);
  }
  const c = result.credentials;
  const payload = {
    appId: c.appId,
    appSecret: c.appSecret,
    accessToken: c.accessToken,
    refreshToken: c.refreshToken,
    userOpenId: c.userOpenId,
    brand: 'feishu',
    scope: c.scope,
    accessTokenExpiresAt: c.expiresAt,     // Unix ms
    refreshTokenExpiresAt: c.refreshExpiresAt, // Unix ms
    reportedAt: Date.now(),
  };

  if (!report) {
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: true, credentials: payload }, null, 2)}\n`);
    } else {
      const rows = [
        ['appId', c.appId],
        ['appSecret', c.appSecret],
        ['accessToken', c.accessToken],
        ['refreshToken', c.refreshToken],
        ['accessTokenExpiresAt', c.expiresAt ? new Date(c.expiresAt).toISOString() : '—'],
        ['refreshTokenExpiresAt', c.refreshExpiresAt ? new Date(c.refreshExpiresAt).toISOString() : '—'],
        ['userOpenId', c.userOpenId],
      ];
      const w = Math.max(...rows.map((r) => r[0].length));
      for (const [k, v] of rows) process.stdout.write(`${k.padEnd(w)}  ${v}\n`);
    }
    process.exit(0);
  }

  const reportResult = await reportLarkCredentials({ appId: c.appId, userOpenId: c.userOpenId });
  if (json) {
    process.stdout.write(`${JSON.stringify({
      ok: reportResult.ok,
      status: reportResult.status,
      reason: reportResult.reason,
      message: reportResult.message,
    })}\n`);
  } else {
    process.stdout.write(reportResult.ok
      ? `✓ 已上报到 agentbus (HTTP ${reportResult.status})\n`
      : `✗ ${reportResult.message || '上报失败'}\n`);
  }
  process.exit(reportResult.ok ? 0 : 1);
}

// export internals for tests
export const __internals = { getMasterKeyMac, decryptAesGcm, safeFileName, storageDirMac, readSecret, triggerLarkRefresh };
