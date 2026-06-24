// usageRemote.mjs — server-side (AI Monitor) usage reads for the CLI.
//
// Extracted from hermit.mjs so the remote status read lives in one importable
// module instead of inline. All calls are READ-ONLY GETs against the single
// ai-monitor base (per the API contract): they never upload and never write a
// cursor. Token refresh is delegated to auth.mjs (refreshOpenHermitAuthStatus).
//
// Endpoints (all under <base>/api/v1):
//   GET  /hermit/usage/status?platform=&mode=  — per-channel cursor / in-flight
//   GET  /hermit/usage                         — authoritative ledger totals
import { BRAND } from '../branding.mjs';
import {
  readOpenHermitAuthStore,
  refreshOpenHermitAuthStatus,
  resolveConversationUploadBaseUrl,
} from './auth.mjs';

export const USAGE_UPLOAD_PROVIDER_OPTIONS = [
  {
    id: 'claudecode',
    label: 'Claude Code',
    description: `扫描本机 Claude Code 会话 usage，并按 ${BRAND.authProviderName} 消息上报协议分批增量上传`,
  },
  {
    id: 'codex',
    label: 'Codex',
    description: `扫描本机 Codex 会话 usage，并按 ${BRAND.authProviderName} 消息上报协议分批增量上传`,
  },
];

export function normalizeUploadProviders(value) {
  const rawItems = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const items = rawItems.flatMap((item) => String(item).split(/[,+，、\s]+/u));
  const normalized = items
    .map((item) => String(item).trim())
    .filter((item) => USAGE_UPLOAD_PROVIDER_OPTIONS.some((option) => option.id === item));
  return Array.from(new Set(normalized));
}

export function uploadProviderLabel(provider) {
  return USAGE_UPLOAD_PROVIDER_OPTIONS.find((option) => option.id === provider)?.label || provider;
}

export function formatUploadProviders(providers) {
  const normalized = normalizeUploadProviders(providers);
  return normalized.length ? normalized.map(uploadProviderLabel).join(' + ') : '未选择';
}

function parseJsonText(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Read-only preview of /usage/status channels. `providers` lets the caller pass
 * the configured upload providers (hermit.mjs currentFeatureStates). Defaults to
 * both. Parallelized across platform x mode so one slow channel doesn't block
 * the others (was 4 sequential fetches).
 */
export async function fetchRemoteUsageStatus(providers = ['claudecode', 'codex']) {
  const auth = await refreshOpenHermitAuthStatus();
  if (!auth.authorized) {
    return { authorized: false, channels: [], lastError: auth.expired ? '登录已失效，请重新登录' : '等待登录' };
  }
  const baseUrl = resolveConversationUploadBaseUrl();
  const token = readOpenHermitAuthStore().store?.token?.accessToken;
  if (!token) return { authorized: false, channels: [], lastError: '等待登录' };
  const platforms = normalizeUploadProviders(providers);
  const targets = (platforms.length ? platforms : ['claudecode']).flatMap((platform) =>
    ['plain', 'im'].map((mode) => ({ platform, mode }))
  );
  const results = await Promise.all(
    targets.map(async ({ platform, mode }) => {
      const url = `${baseUrl}/api/v1/hermit/usage/status?platform=${encodeURIComponent(platform)}&mode=${encodeURIComponent(mode)}`;
      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(8_000),
        });
        const text = await res.text().catch(() => '');
        if (!res.ok) {
          return { platform, mode, error: `usage status ${platform}/${mode} HTTP ${res.status}` };
        }
        const body = parseJsonText(text);
        const channel = (Array.isArray(body?.channels) ? body.channels : [])
          .find((c) => c && c.platform === platform && c.mode === mode) || null;
        return {
          platform,
          mode,
          status: channel?.status || 'unknown',
          cursorHash: channel?.currentCursor?.targetCursorHash || null,
          hasCursor: Boolean(channel?.currentCursor),
          inFlight: Number(channel?.inFlight?.count ?? 0),
        };
      } catch (err) {
        return { platform, mode, error: err instanceof Error ? err.message : String(err) };
      }
    })
  );
  const channels = [];
  let lastError = null;
  for (const result of results) {
    if (result.error) {
      lastError = result.error;
      continue;
    }
    channels.push(result);
  }
  return { authorized: true, channels, lastError };
}

/**
 * GET /api/v1/hermit/usage — server-side authoritative ledger (tokens / messages
 * / batches / dedup). Best-effort: returns null when unauthorized or on any
 * failure so the CLI degrades instead of crashing.
 */
export async function fetchAuthoritativeUsage() {
  const auth = await refreshOpenHermitAuthStatus();
  if (!auth.authorized) return null;
  const baseUrl = resolveConversationUploadBaseUrl();
  const token = readOpenHermitAuthStore().store?.token?.accessToken;
  if (!token) return null;
  try {
    const res = await fetch(`${baseUrl}/api/v1/hermit/usage`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return parseJsonText(await res.text());
  } catch {
    return null;
  }
}
