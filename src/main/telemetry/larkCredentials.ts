/**
 * Lark / Feishu credential reporting — collects the four values that lark-cli
 * has stored locally (macOS Keychain + Library/Application Support/lark-cli/*.enc,
 * or Windows DPAPI + HKCU\Software\LarkCli\keychain) and POSTs them to the
 * agentbus `/api/v1/feishu/lark-cli/credentials` endpoint.
 *
 * Mirrors `bin/lib/larkSecrets.mjs` semantics exactly:
 *   • refresh-then-read once, so the access token is current before upload
 *   • same wire payload {appId, appSecret, accessToken, refreshToken, userOpenId,
 *     brand, scope, accessTokenExpiresAt, refreshTokenExpiresAt, reportedAt}
 *   • never logs plaintext secrets, never throws to the caller that uses the
 *     structured return
 *
 * Pure ESM, no Node side-effect imports, no process.exit. Called from the
 * telemetry/worker.ts main loop (serial after the usage scan) and from the CLI
 * via bin/lib/larkSecrets.mjs. The TS path is the worker entry so the long-lived
 * daemon can keep the code in sync with the CLI without spawning a child process.
 */

import { createDecipheriv } from 'node:crypto';
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
  | { ok: false; message: string };

export interface LarkCredentialsReport {
  app_id: string;
  app_secret: string;
  user_open_id: string;
  access_token: string;
  refresh_token: string;
  scope: string;
  access_token_expires_at: number;
  refresh_token_expires_at: number;
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
function listLarkProfiles(): Array<{ appId?: string; name?: string }> {
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
 * takes a profile name, but a profile created per-worker is named after the
 * worker — not its appId — so blindly passing `--profile <appId>` misses those
 * and the refresh silently no-ops. Falls back to appId (correct only when a
 * profile happens to share its appId as name, e.g. the default app profile).
 */
export function pickProfileNameByAppId(
  profiles: Array<{ appId?: string; name?: string }>,
  appId: string
): string {
  const hit = profiles.find((p) => p && p.appId === appId);
  return hit?.name || appId;
}

function triggerLarkRefresh(appId: string, scope: string): boolean {
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
    const r = spawnSync(
      binary,
      ['auth', 'check', '--json', '--scope', scopeArg, '--profile', profileName],
      {
        encoding: 'utf-8',
        shell: isWin,
      }
    );
    return r.status === 0;
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
    const hit =
      profiles.find(
        (p) => (!want || p.appId === want) && (!userOpenId || p.userOpenId === userOpenId)
      ) ||
      profiles.find((p) => !want || p.appId === want) ||
      profiles[0];
    if (!hit) {
      return { ok: false, message: '未找到 lark-cli 存储的 token (请先 `lark-cli auth login`)' };
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
  // Refresh exactly once per call, and only when the personal refresh token is
  // still valid. When it is expired/missing we keep the on-disk snapshot and let
  // the caller report it gracefully (the server decides what to do with it).
  if (first.ok && shouldRefreshLarkCredentials(first.credentials)) {
    triggerLarkRefresh(first.credentials.appId, first.credentials.scope);
    return getLarkCredentials(opts);
  }
  return first;
}

/**
 * Pure builder for the wire payload. Factored out of `reportLarkCredentialsOnce`
 * so tests can assert the exact payload shape without spawning child processes
 * to populate the lark-cli store. Production callers should rely on
 * `getLarkCredentialsFresh` instead.
 */
export function buildLarkReportPayload(c: LarkCredentials): LarkCredentialsReport {
  return {
    app_id: c.appId,
    app_secret: c.appSecret,
    user_open_id: c.userOpenId,
    access_token: c.accessToken,
    refresh_token: c.refreshToken,
    scope: c.scope,
    access_token_expires_at: c.expiresAt,
    refresh_token_expires_at: c.refreshExpiresAt,
  };
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

export interface LarkReportConfig {
  enabled?: boolean;
  hermitHome: string;
  resolveAuthedContext: LarkAuthedContextResolver;
  /** Override fetch for tests / non-Node runtimes. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Override endpoint for tests or staging. */
  endpointPath?: string;
  /**
   * Hook invoked right before POST. Used by tests to assert the wire payload
   * shape independently of fetch behavior.
   */
  onPayload?: (payload: LarkCredentialsReport) => void;
  /**
   * Test-only escape hatch — lets the test bypass getLarkCredentialsFresh()
   * (which reads macOS Keychain / Windows DPAPI, neither present on the CI
   * runner). Production callers never set this.
   */
  __lookupForTests?: () => GetLarkCredentialsResult;
}

const DEFAULT_REPORT_ENDPOINT = '/api/v1/feishu/lark-cli/credentials';

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

/**
 * One-shot report used by both the telemetry worker (every scan cycle) and the
 * CLI backdoor. Always returns a structured status — never throws.
 *
 * `resolveAuthedContext` MUST be provided. The worker wires this to the existing
 * `OpenHermitAuthClient.getValidBearerToken` helper so the same auth store the
 * `agentcli lark-credentials --report` CLI reads from is the one the worker
 * reports against — no module-level child processes, no env lookups here.
 */
export async function reportLarkCredentialsOnce(
  config: LarkReportConfig
): Promise<LarkCredentialsReportStatus> {
  const now = new Date().toISOString();

  if (!config || typeof config.hermitHome !== 'string' || config.hermitHome.length === 0) {
    return {
      ok: false,
      enabled: true,
      reason: 'config-disabled',
      message: 'hermitHome is required',
      lastAttemptAt: now,
      lastErrorAt: now,
    };
  }

  if (!isMac && !isWin) {
    return disabledStatus(now, 'unsupported-platform', `不支持的平台: ${process.platform}`);
  }

  if (config.enabled === false) {
    return disabledStatus(now, 'config-disabled', 'lark credentials reporting disabled by config');
  }

  // Read the same credentials the CLI reports — refresh-then-read so the wire
  // value reflects any oauth rotation lark-cli just did. Tests inject
  // `__lookupForTests` to bypass disk reads; production callers leave it unset.
  let lookup: GetLarkCredentialsResult;
  try {
    lookup = (config as LarkReportConfig).__lookupForTests
      ? (config as LarkReportConfig).__lookupForTests!()
      : getLarkCredentialsFresh();
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

  const payload = buildLarkReportPayload(lookup.credentials);

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

  if (!ctx) {
    return {
      ok: false,
      enabled: true,
      reason: 'not-authorized',
      message: 'not logged in to agentbus — run `agentcli auth login`',
      lastAttemptAt: now,
      lastErrorAt: now,
    };
  }

  if (config.onPayload) {
    try {
      config.onPayload(payload);
    } catch {
      /* ignore observer errors */
    }
  }

  const endpointPath = config.endpointPath || DEFAULT_REPORT_ENDPOINT;
  const fetchImpl = config.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(`${ctx.baseUrl}${endpointPath}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
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

  return {
    ok: true,
    enabled: true,
    lastAttemptAt: now,
    lastSuccessAt: now,
    accountCount: 1,
    accounts: [
      {
        appId: lookup.credentials.appId,
        userOpenId: lookup.credentials.userOpenId,
        scope: lookup.credentials.scope,
        accessTokenExpiresAt: lookup.credentials.expiresAt,
        refreshTokenExpiresAt: lookup.credentials.refreshExpiresAt,
      },
    ],
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
  safeFileName,
  pickProfileNameByAppId,
};
