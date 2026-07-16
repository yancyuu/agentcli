/**
 * Lark / Feishu credential reporting — collects the four values that lark-cli
 * has stored locally (macOS Keychain + Library/Application Support/lark-cli/*.enc,
 * or Windows DPAPI + HKCU\Software\LarkCli\keychain) and POSTs them to the
 * agentbus batch endpoint.
 *
 * Mirrors `bin/lib/larkSecrets.mjs` batch semantics exactly:
 *   • enumerate all personal lark-cli profiles, refresh each, then read current credentials
 *   • batch the complete eligible set to the server
 *   • never logs plaintext secrets, never throws to the caller that uses the
 *     structured return
 *
 * Pure ESM, no Node side-effect imports, no process.exit. Called from the
 * telemetry/worker.ts main loop and from the CLI
 * via bin/lib/larkSecrets.mjs. The TS path is the worker entry so the long-lived
 * daemon can keep the code in sync with the CLI without spawning a child process.
 */

import { createDecipheriv, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
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

export interface LarkCredentials {
  appId: string;
  appSecret: string;
  accessToken: string;
  refreshToken: string;
  userOpenId: string;
  brand: string;
  scope: string;
  expiresAt: number;
  refreshExpiresAt: number;
}

export type GetLarkCredentialsResult =
  | { ok: true; credentials: LarkCredentials }
  | { ok: false; message: string; refreshFailed?: boolean };

export interface LarkProfileSkip {
  appId: string;
  userOpenId: string;
  reason: 'no-credentials' | 'refresh-failed';
  message: string;
}

export type GetLarkCredentialsAllResult =
  | { ok: true; credentials: LarkCredentials[]; skipped: LarkProfileSkip[] }
  | { ok: false; message: string };

export interface LarkBatchItem {
  client_item_id: string;
  app_id: string;
  app_secret: string;
  access_token: string;
  refresh_token: string;
}

export interface LarkBatchReport {
  items: LarkBatchItem[];
}

export interface LarkCredentialSummary {
  appId: string;
  userOpenId: string;
  scope: string;
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt: number;
}

export interface LarkCredentialsReportStatus {
  ok: boolean;
  enabled: boolean;
  reason?:
    | 'unsupported-platform'
    | 'no-credentials'
    | 'not-authorized'
    | 'config-disabled'
    | 'config-not-authorized'
    | 'refresh-failed'
    | 'fetch-failed'
    | 'http-error';
  message?: string;
  scopeCount?: number;
  accountCount?: number;
  lastAttemptAt: string;
  lastSuccessAt?: string;
  lastErrorAt?: string;
  lastHttpStatus?: number;
  accounts?: LarkCredentialSummary[];
}

function capture(cmd: string, args: string[], options: { input?: string } = {}): string {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf-8', shell: isWin, input: options.input });
    return (r.stdout || '').trim();
  } catch {
    return '';
  }
}

function storageDirMac(): string {
  return join(homedir(), 'Library', 'Application Support', SERVICE);
}

function safeFileName(account: string): string {
  return account.replace(/[^a-zA-Z0-9._-]/g, '_') + '.enc';
}

/**
 * Decode lark-cli's stored master key. go-keyring wraps the raw 32-byte AES key
 * as base64(base64(key)) — outer base64 → utf8 string → inner base64 → raw bytes
 * — optionally behind the `go-keyring-base64:` prefix. A single base64 pass (an
 * earlier drift here) yields garbage bytes and every decryption silently fails.
 * Returns null unless the result is exactly MASTER_KEY_BYTES long. Mirrors
 * bin/lib/larkSecrets.mjs exactly.
 */
function decodeMasterKey(encoded: string): Buffer | null {
  let s = encoded;
  if (s.startsWith(GO_KEYRING_PREFIX)) s = s.slice(GO_KEYRING_PREFIX.length);
  try {
    const buf = Buffer.from(Buffer.from(s, 'base64').toString('utf8'), 'base64');
    return buf.length === MASTER_KEY_BYTES ? buf : null;
  } catch {
    return null;
  }
}

/** master AES-256 key from the macOS Keychain (service "lark-cli" / account "master.key"). */
function getMasterKeyMac(): Buffer | null {
  // Env override (rare; lark-cli sets it when spawning children). Same encoding as
  // the keychain value, so decode it the same way.
  const env = process.env.LARK_CLI_MASTER_KEY;
  if (env) {
    const key = decodeMasterKey(env);
    if (key) return key;
  }
  const out = capture('security', [
    'find-generic-password',
    '-s',
    SERVICE,
    '-a',
    'master.key',
    '-w',
  ]);
  if (!out) return null;
  return decodeMasterKey(out);
}

function decryptAesGcm(blob: Buffer, key: Buffer): string | null {
  if (!Buffer.isBuffer(blob) || blob.length < IV_BYTES + TAG_BYTES + 1) return null;
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(blob.length - TAG_BYTES);
  const ciphertext = blob.subarray(IV_BYTES, blob.length - TAG_BYTES);
  try {
    const dec = createDecipheriv('aes-256-gcm', key, iv);
    dec.setAuthTag(tag);
    const plain = Buffer.concat([dec.update(ciphertext), dec.final()]);
    return plain.toString('utf-8');
  } catch {
    return null;
  }
}

function readSecret(service: string, account: string): string | null {
  if (isMac) {
    const key = getMasterKeyMac();
    if (!key) return null;
    const file = join(storageDirMac(), safeFileName(account));
    if (!existsSync(file)) return null;
    let buf: Buffer;
    try {
      buf = readFileSync(file);
    } catch {
      return null;
    }
    return decryptAesGcm(buf, key);
  }
  if (isWin) {
    return readRegistryDpapi(service, account);
  }
  return null;
}

/**
 * Windows DPAPI + registry path — mirrors bin/lib/larkSecrets.mjs. lark-cli stores
 * each secret at HKCU\Software\LarkCli\keychain\<service>, value name =
 * base64.RawURLEncoding(account), value = base64.Std( DPAPI-protect(plaintext,
 * entropy) ) where entropy = bytes(service + "\x00" + account). Two earlier drifts
 * silently broke this: the registry path was structured as Software\<service>\
 * keychain (wrong — keychain is the parent, service the leaf), and entropy was
 * read from an env var defaulting to empty instead of the service+account binding.
 * Both aligned to canonical here.
 */
function dpapiEntropy(service: string, account: string): Buffer {
  // lark-cli binds ciphertext to service + "\x00" + account.
  return Buffer.from(`${service}\x00${account}`, 'utf8');
}

function regValueName(account: string): string {
  return Buffer.from(account, 'utf8').toString('base64url'); // RawURLEncoding (no padding)
}

function regPathFor(service: string): string {
  // safeRegistryComponent: "\" → "_", then [^a-zA-Z0-9._-] → "_". "lark-cli" → "lark-cli".
  return `Software\\LarkCli\\keychain\\${service.replace(/\\/g, '_').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

/** Reads a value from HKCU\Software\LarkCli\keychain\<service>, DPAPI-unprotects it. */
function readRegistryDpapi(service: string, account: string): string | null {
  if (!isWin) return null;
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
  return out || null;
}

function parseStoredToken(json: string): {
  appId: string;
  userOpenId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  refreshExpiresAt: number;
  scope: string;
} | null {
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    if (!o || typeof o.accessToken !== 'string') return null;
    return {
      appId: typeof o.appId === 'string' ? o.appId : '',
      userOpenId: typeof o.userOpenId === 'string' ? o.userOpenId : '',
      accessToken: o.accessToken,
      refreshToken: typeof o.refreshToken === 'string' ? o.refreshToken : '',
      expiresAt: typeof o.expiresAt === 'number' ? o.expiresAt : 0,
      refreshExpiresAt: typeof o.refreshExpiresAt === 'number' ? o.refreshExpiresAt : 0,
      scope: typeof o.scope === 'string' ? o.scope : '',
    };
  } catch {
    return null;
  }
}

/**
 * Discover available (appId, userOpenId) pairs by DECRYPTING each .enc file and
 * reading the ids from the StoredUAToken JSON inside — NOT by parsing the
 * filename. lark-cli's safeFileName rewrites the `<appId>:<userOpenId>` account
 * key to `<appId>_<userOpenId>` (':' → '_'), so the original separators are gone
 * from the filename; only the decrypted content carries the true ids. An earlier
 * version split the filename on ':' and therefore always found zero profiles.
 *
 * Factored as an injectable core so the content-not-filename invariant can be
 * unit-tested without the macOS Keychain (tests supply `{ dir, key }`).
 */
function discoverProfilesMacCore(opts: {
  dir: string;
  key: Buffer | null;
}): Array<{ appId: string; userOpenId: string }> {
  const key = opts.key;
  if (!key) return [];
  if (!existsSync(opts.dir)) return [];
  let names: string[];
  try {
    names = readdirSync(opts.dir);
  } catch {
    return [];
  }
  const profiles: Array<{ appId: string; userOpenId: string }> = [];
  for (const name of names) {
    if (!name.endsWith('.enc')) continue;
    let buf: Buffer;
    try {
      buf = readFileSync(join(opts.dir, name));
    } catch {
      continue;
    }
    const plain = decryptAesGcm(buf, key);
    const parsed = plain ? parseStoredToken(plain) : null;
    // appsecret files decrypt to a bare secret string (not StoredUAToken JSON),
    // so parseStoredToken returns null and they are naturally excluded — no need
    // to filter by filename prefix.
    if (parsed?.appId && parsed?.userOpenId) {
      profiles.push({ appId: parsed.appId, userOpenId: parsed.userOpenId });
    }
  }
  return profiles;
}

function discoverProfilesMac(): Array<{ appId: string; userOpenId: string }> {
  return discoverProfilesMacCore({ dir: storageDirMac(), key: getMasterKeyMac() });
}

function activeAppId(): string | undefined {
  const env = process.env.LARK_CLI_ACTIVE_APP_ID || process.env.LARK_CLI_DEFAULT_APP_ID;
  if (env) return env;
  // ~/.lark-cli/config.json → apps[0].appId (the active/first app), matching
  // bin/lib/larkSecrets.mjs. Best-effort: when missing or unparsable, discovery
  // falls back to the first stored profile, so a wrong/absent config never breaks.
  const config = join(homedir(), '.lark-cli', 'config.json');
  if (!existsSync(config)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(config, 'utf-8')) as {
      apps?: Array<{ appId?: string }>;
    };
    if (Array.isArray(parsed.apps) && parsed.apps.length) {
      return parsed.apps[0].appId || undefined;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

function findLarkBinary(): string | null {
  const found = capture(process.platform === 'win32' ? 'where' : 'which', ['lark-cli']);
  return found || null;
}

/**
 * List lark-cli profiles. `profile list` does NOT accept --json (v1.0.53) but
 * already prints a JSON array to stdout, so parse that directly. Returns [] on
 * any failure so callers fall back gracefully.
 */
export interface LarkCliProfile {
  name: string;
  appId: string;
}

export interface LarkCliPersonalAuthorization {
  profileName: string;
  appId: string;
  userOpenId: string;
}

export function parseLarkCliPersonalAuthorizations(
  profile: LarkCliProfile,
  raw: unknown
): LarkCliPersonalAuthorization[] {
  if (!profile?.name || !profile.appId || !Array.isArray(raw)) return [];
  const authorizations = new Map<string, LarkCliPersonalAuthorization>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const appId = typeof record.appId === 'string' ? record.appId : '';
    const userOpenId =
      typeof record.userOpenId === 'string'
        ? record.userOpenId
        : typeof record.user_open_id === 'string'
          ? record.user_open_id
          : '';
    if (appId !== profile.appId || !userOpenId) continue;
    authorizations.set(`${appId}:${userOpenId}`, {
      appId,
      profileName: profile.name,
      userOpenId,
    });
  }
  return [...authorizations.values()];
}

function listLarkProfiles(): LarkCliProfile[] {
  const binary = findLarkBinary();
  if (!binary) return [];
  try {
    const result = spawnSync(binary, ['profile', 'list'], { encoding: 'utf-8', shell: isWin });
    const parsed: unknown = result.status === 0 ? JSON.parse((result.stdout || '').trim()) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const record = item as Record<string, unknown>;
      return typeof record.name === 'string' &&
        record.name &&
        typeof record.appId === 'string' &&
        record.appId
        ? [{ name: record.name, appId: record.appId }]
        : [];
    });
  } catch {
    return [];
  }
}

function listLarkCliPersonalAuthorizations(): LarkCliPersonalAuthorization[] {
  const binary = findLarkBinary();
  if (!binary) return [];
  const authorizations = new Map<string, LarkCliPersonalAuthorization>();
  for (const profile of listLarkProfiles()) {
    try {
      const result = spawnSync(binary, ['auth', 'list', '--json', '--profile', profile.name], {
        encoding: 'utf-8',
        shell: isWin,
      });
      const parsed: unknown = result.status === 0 ? JSON.parse((result.stdout || '').trim()) : [];
      for (const authorization of parseLarkCliPersonalAuthorizations(profile, parsed)) {
        authorizations.set(`${authorization.appId}:${authorization.userOpenId}`, authorization);
      }
    } catch {
      // One malformed profile must not hide other personal authorizations.
    }
  }
  return [...authorizations.values()];
}

export function pickProfileNameByAppId(
  profiles: Array<{ appId?: string; name?: string }>,
  appId: string
): string {
  const hit = profiles.find((p) => p && p.appId === appId);
  return hit?.name || appId;
}

/**
 * Decide whether a lark-cli refresh succeeded, from the raw exit codes + verify
 * stdout. Factored out of `triggerLarkRefresh` (which spawns the lark-cli binary)
 * so the decoupling rule is unit-testable without the binary on PATH.
 *
 * Decoupling (fixes authorization drops): an access token lark-cli just refreshed
 * MUST still be uploaded. Requiring the full scope set to be present (a56f531)
 * or `verified === true` withheld the already-refreshed token whenever a scope
 * drifted or lark-cli's verify flapped — agentbus then kept a stale token and
 * the user's Lark authorization "dropped" (401) even though worker kept refreshing.
 * So:
 *   • auth check exit 0 — the refresh side-effect ran. We no longer inspect its
 *     `ok`/`missing`: a partial scope grant still means the token was refreshed,
 *     and scope degradation should warn, not withhold the upload.
 *   • status --verify exit 0 + identities.user.available === true — the refreshed
 *     token is usable. `verified` is no longer required (it flaps on transient
 *     checks); availability already proves the token works.
 */
export function isLarkRefreshSucceeded(opts: {
  checkStatus: number | null;
  verifyStatus: number | null;
  verifyStdout: string;
}): boolean {
  if (!opts) return false;
  if (opts.checkStatus !== 0) return false;
  if (opts.verifyStatus !== 0) return false;
  let status: { identities?: { user?: { available?: unknown } } } = {};
  try {
    status = JSON.parse(String(opts.verifyStdout || '').trim());
  } catch {
    return false;
  }
  return status.identities?.user?.available === true;
}

function triggerLarkRefresh(appId: string, scope: string, profileName?: string): boolean {
  const binary = findLarkBinary();
  if (!binary) return false;
  // `auth check --scope` triggers the token refresh as a side effect; `auth status
  // --verify` persists the refreshed state. We still pass the full personal scope
  // (the digital-worker login uses --domain all) so lark-cli refreshes the whole
  // grant, but a partial/missing scope no longer blocks the upload — the success
  // rule lives in isLarkRefreshSucceeded (decoupled from scope completeness).
  const scopeArg = String(scope || '').trim() || 'contact:user.base:readonly';
  const targetProfile = profileName || pickProfileNameByAppId(listLarkProfiles(), appId);
  try {
    const check = spawnSync(
      binary,
      ['auth', 'check', '--json', '--scope', scopeArg, '--profile', targetProfile],
      { encoding: 'utf-8', shell: isWin }
    );
    const verify = spawnSync(
      binary,
      ['auth', 'status', '--json', '--verify', '--profile', targetProfile],
      { encoding: 'utf-8', shell: isWin }
    );
    return isLarkRefreshSucceeded({
      checkStatus: check.status,
      verifyStatus: verify.status,
      verifyStdout: verify.stdout || '',
    });
  } catch {
    return false;
  }
}

export function getLarkCredentials(
  opts: { appId?: string; userOpenId?: string } = {}
): GetLarkCredentialsResult {
  if (!isMac && !isWin) {
    return { ok: false, message: `不支持的平台: ${process.platform} (仅 mac/windows)` };
  }

  let { appId, userOpenId } = opts;
  if (!appId) {
    const profiles = isMac ? discoverProfilesMac() : [];
    const want = activeAppId();
    const hit = want
      ? profiles.find((p) => p.appId === want && (!userOpenId || p.userOpenId === userOpenId))
      : profiles.find((p) => !userOpenId || p.userOpenId === userOpenId);
    if (!hit) {
      return {
        ok: false,
        message: want
          ? `当前 lark-cli 应用缺少个人授权 (appId=${want})`
          : '未找到 lark-cli 存储的 token (请先 `lark-cli auth login`)',
      };
    }
    appId = hit.appId;
    userOpenId = userOpenId || hit.userOpenId;
  }

  const appSecret = readSecret(SERVICE, `appsecret:${appId}`);
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
      userOpenId: token?.userOpenId || userOpenId || '',
      brand: 'feishu',
      scope: token?.scope || '',
      expiresAt: token?.expiresAt || 0,
      refreshExpiresAt: token?.refreshExpiresAt || 0,
    },
  };
}

/**
 * A personal refresh token can only rotate the access token while it is still
 * alive. Once `refreshExpiresAt` has passed, `lark-cli auth check` cannot
 * succeed and the user must re-authorize — so there is no point spawning it.
 * Pure predicate (default clock injectable) so the eligibility rule is unit-
 * tested without the macOS Keychain / Windows DPAPI backends.
 */
export function shouldRefreshLarkCredentials(
  credentials: LarkCredentials | undefined,
  now: number = Date.now()
): boolean {
  return Boolean(
    credentials &&
    typeof credentials.refreshExpiresAt === 'number' &&
    Number.isFinite(credentials.refreshExpiresAt) &&
    credentials.refreshExpiresAt > now
  );
}

export function getLarkCredentialsFresh(
  opts: { appId?: string; userOpenId?: string } = {}
): GetLarkCredentialsResult {
  const first = getLarkCredentials(opts);
  if (!first.ok) return first;

  // Every report must force a refresh attempt, even if the stored access token
  // looks current. Reporting a stale snapshot after an unsuccessful refresh is
  // unsafe because AgentBus uses it to prove the personal Lark identity.
  if (
    !shouldRefreshLarkCredentials(first.credentials) ||
    !triggerLarkRefresh(first.credentials.appId, first.credentials.scope)
  ) {
    return {
      ok: false,
      refreshFailed: true,
      message: 'lark-cli 个人授权刷新失败，未上传可能过期的凭证',
    };
  }

  const refreshed = getLarkCredentials(opts);
  if (!refreshed.ok) {
    return {
      ok: false,
      refreshFailed: true,
      message: 'lark-cli 刷新后无法读取个人授权凭证，未执行上报',
    };
  }
  return refreshed;
}

export function getLarkCredentialsAll(): GetLarkCredentialsAllResult {
  if (!isMac && !isWin) {
    return { ok: false, message: `不支持的平台: ${process.platform} (仅 mac/windows)` };
  }

  const profiles = isMac ? discoverProfilesMac() : [];
  const credentials: LarkCredentials[] = [];
  const skipped: LarkProfileSkip[] = [];
  for (const profile of profiles) {
    const result = getLarkCredentials(profile);
    if (result.ok) {
      credentials.push(result.credentials);
    } else {
      skipped.push({
        appId: profile.appId,
        userOpenId: profile.userOpenId,
        reason: 'no-credentials',
        message: result.message,
      });
    }
  }
  return { ok: true, credentials, skipped };
}

export function getLarkCredentialsFreshAll(): GetLarkCredentialsAllResult {
  if (!isMac && !isWin) {
    return { ok: false, message: `不支持的平台: ${process.platform} (仅 mac/windows)` };
  }

  const credentials: LarkCredentials[] = [];
  const skipped: LarkProfileSkip[] = [];
  for (const authorization of listLarkCliPersonalAuthorizations()) {
    const profile = { appId: authorization.appId, userOpenId: authorization.userOpenId };
    const beforeRefresh = getLarkCredentials(profile);
    const scope = beforeRefresh.ok ? beforeRefresh.credentials.scope : '';
    if (!triggerLarkRefresh(authorization.appId, scope, authorization.profileName)) {
      skipped.push({
        ...profile,
        reason: 'refresh-failed',
        message: 'lark-cli 个人授权刷新失败，未上传可能过期的凭证',
      });
      continue;
    }

    const refreshed = getLarkCredentials(profile);
    if (
      !refreshed.ok ||
      refreshed.credentials.appId !== profile.appId ||
      refreshed.credentials.userOpenId !== profile.userOpenId
    ) {
      skipped.push({
        ...profile,
        reason: 'no-credentials',
        message: refreshed.ok ? 'lark-cli 刷新后凭证身份不匹配，未执行上报' : refreshed.message,
      });
      continue;
    }
    credentials.push(refreshed.credentials);
  }
  return { ok: true, credentials, skipped };
}

export function meetsBatchFieldConstraints(credential: LarkCredentials): boolean {
  const { appId, appSecret, accessToken, refreshToken } = credential;
  return (
    appId.startsWith('cli_') &&
    appId.length >= 5 &&
    appId.length <= 160 &&
    appSecret.length >= 8 &&
    appSecret.length <= 4096 &&
    accessToken.length >= 40 &&
    accessToken.length <= 65536 &&
    refreshToken.length >= 40 &&
    refreshToken.length <= 65536
  );
}

function clientItemIdFor(credential: LarkCredentials): string {
  const identity = `${credential.appId}:${credential.userOpenId}`;
  if (/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(identity)) return identity;
  const prefix = credential.appId.replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 47) || 'lark';
  const suffix = createHash('sha256').update(identity).digest('hex').slice(0, 16);
  return `${prefix}:${suffix}`;
}

export function buildLarkBatchPayload(credentials: LarkCredentials[]): LarkBatchReport {
  const items = new Map<string, LarkBatchItem>();
  for (const credential of credentials) {
    const clientItemId = clientItemIdFor(credential);
    items.set(clientItemId, {
      client_item_id: clientItemId,
      app_id: credential.appId,
      app_secret: credential.appSecret,
      access_token: credential.accessToken,
      refresh_token: credential.refreshToken,
    });
  }
  return { items: [...items.values()] };
}

export interface AuthorizedServerContext {
  baseUrl: string;
  token: string;
}

/**
 * Auth resolver contract — workers / tests inject their own. The worker wires
 * this to `getValidBearerToken(hermitHome, fallbackBase)`; the existing
 * `bin/lib/auth.mjs` resolveAuthedServerContext has the same shape and is what
 * the CLI uses, so reported credentials always flow through the same auth store.
 */
export type LarkAuthedContextResolver = (
  hermitHome: string
) => Promise<AuthorizedServerContext | null>;

function disabledStatus(
  now: string,
  reason: Exclude<LarkCredentialsReportStatus['reason'], 'fetch-failed' | 'http-error'>,
  message: string
): LarkCredentialsReportStatus {
  return { ok: false, enabled: false, reason, message, lastAttemptAt: now };
}

function failureStatus(
  prev: LarkCredentialsReportStatus | undefined,
  now: string,
  reason: 'fetch-failed' | 'http-error',
  message: string,
  httpStatus?: number
): LarkCredentialsReportStatus {
  return {
    ok: false,
    enabled: prev?.enabled ?? true,
    reason,
    message,
    lastAttemptAt: now,
    lastErrorAt: now,
    lastHttpStatus: httpStatus,
  };
}

export interface LarkBatchReportConfig {
  enabled?: boolean;
  hermitHome: string;
  resolveAuthedContext: LarkAuthedContextResolver;
  fetchImpl?: typeof fetch;
  endpointPath?: string;
  onPayload?: (payload: LarkBatchReport) => void;
  __lookupAllForTests?: () => GetLarkCredentialsAllResult;
}

const DEFAULT_BATCH_REPORT_ENDPOINT = '/api/v1/feishu/lark-cli/credentials/batch';
const LARK_BATCH_MAX_ITEMS = 20;

function splitBatchItems(items: LarkBatchItem[]): LarkBatchItem[][] {
  const batches: LarkBatchItem[][] = [];
  for (let index = 0; index < items.length; index += LARK_BATCH_MAX_ITEMS) {
    batches.push(items.slice(index, index + LARK_BATCH_MAX_ITEMS));
  }
  return batches;
}

/**
 * Canonical all-profile Lark credential batch report. This is the ONE
 * implementation shared by the long-lived telemetry worker and the CLI (via the
 * TSX worker bridge in bin/lib/larkSecrets.mjs). It enumerates every personal
 * lark-cli authorization, refreshes each, then batches the complete eligible set
 * to the AgentBus batch endpoint. It never logs plaintext secrets and never
 * throws to structured-return callers.
 */
export async function reportAllLarkCredentials(
  config: LarkBatchReportConfig
): Promise<LarkCredentialsReportStatus> {
  const now = new Date().toISOString();
  if (!config || !config.hermitHome) {
    return {
      ok: false,
      enabled: true,
      reason: 'config-disabled',
      message: 'hermitHome is required',
      lastAttemptAt: now,
      lastErrorAt: now,
    };
  }
  if (!isMac && !isWin)
    return disabledStatus(now, 'unsupported-platform', `不支持的平台: ${process.platform}`);
  if (config.enabled === false)
    return disabledStatus(now, 'config-disabled', 'lark credentials reporting disabled by config');

  let lookup: GetLarkCredentialsAllResult;
  try {
    lookup = config.__lookupAllForTests
      ? config.__lookupAllForTests()
      : getLarkCredentialsFreshAll();
  } catch {
    lookup = { ok: false, message: 'lark-cli 凭证读取失败' };
  }
  if (!lookup.ok) {
    return {
      ok: false,
      enabled: true,
      reason: 'no-credentials',
      message: lookup.message,
      lastAttemptAt: now,
      lastErrorAt: now,
    };
  }

  const eligible = lookup.credentials.filter(meetsBatchFieldConstraints);
  const payload = buildLarkBatchPayload(eligible);
  if (payload.items.length === 0) {
    return {
      ok: false,
      enabled: true,
      reason: 'no-credentials',
      message: '无满足批量上报条件的 lark-cli 个人授权',
      accountCount: 0,
      accounts: [],
      lastAttemptAt: now,
      lastErrorAt: now,
    };
  }

  let ctx: AuthorizedServerContext | null = null;
  try {
    ctx = await config.resolveAuthedContext(config.hermitHome);
  } catch (err) {
    return {
      ok: false,
      enabled: true,
      reason: 'config-not-authorized',
      message: sanitizeAuthError(err),
      lastAttemptAt: now,
      lastErrorAt: now,
    };
  }
  if (!ctx)
    return {
      ok: false,
      enabled: true,
      reason: 'not-authorized',
      message: 'not logged in to agentbus — run `agentcli auth login`',
      lastAttemptAt: now,
      lastErrorAt: now,
    };

  const endpoint = `${ctx.baseUrl}${config.endpointPath || DEFAULT_BATCH_REPORT_ENDPOINT}`;
  const fetchImpl = config.fetchImpl ?? fetch;
  for (const items of splitBatchItems(payload.items)) {
    const batchPayload = { items };
    try {
      config.onPayload?.(batchPayload);
    } catch {
      /* observer errors are diagnostic only */
    }

    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ctx.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(batchPayload),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      return failureStatus(undefined, now, 'fetch-failed', sanitizeAuthError(err));
    }
    if (!response.ok) {
      let body = '';
      try {
        body = (await response.text()).slice(0, 500);
      } catch {
        /* ignore */
      }
      return failureStatus(
        undefined,
        now,
        'http-error',
        `HTTP ${response.status}: ${sanitizeAuthError(body || response.statusText)}`,
        response.status
      );
    }
  }
  return {
    ok: true,
    enabled: true,
    lastAttemptAt: now,
    lastSuccessAt: now,
    accountCount: eligible.length,
    accounts: eligible.map((credential) => ({
      appId: credential.appId,
      userOpenId: credential.userOpenId,
      scope: credential.scope,
      accessTokenExpiresAt: credential.expiresAt,
      refreshTokenExpiresAt: credential.refreshExpiresAt,
    })),
  };
}

function sanitizeAuthError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  // Two passes: first scrub trailing tokens that ride along (Bearer abc..., a long
  // base64-url segment), THEN scrub key=value pairs. Reversed order leaves any
  // `[^\s]+`-non-attached token floating after "Authorization=[hidden]" because
  // the value group stops at whitespace — the prior keyword hadn't swallowed the
  // trailing base64 token it missed.
  return message
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/g, '$1[hidden]')
    .replace(
      /(["']?(?:access_token|refresh_token|app_secret|token|secret|password|authorization)["']?\s*[:=]\s*["']?)([^"'\s,;&}]+)/gi,
      '$1[hidden]'
    )
    .slice(0, 500);
}

// Export the disk-read crypto layer for unit tests. The Keychain / DPAPI backends
// can't run on CI, but the decode/decrypt/discovery invariants CAN — these are
// the exact spots that previously drifted from bin/lib/larkSecrets.mjs.
export const __internals = {
  decodeMasterKey,
  decryptAesGcm,
  discoverProfilesMacCore,
  parseStoredToken,
  parseLarkCliPersonalAuthorizations,
  safeFileName,
  pickProfileNameByAppId,
};
