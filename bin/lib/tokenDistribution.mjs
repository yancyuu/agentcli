// tokenDistribution.mjs — Aliyun AI Gateway "token distribution v3" async client.
//
// Wires the CLI's token池「认领」action to the server's async provision pipeline:
//   1. fetchDefaults   → GET  /aliyun/defaults                 (region + default gateway)
//   2. discoverCatalog → POST /aliyun/discover                 (returns discovery_id, 15m TTL)
//   3. provisionRun    → POST /aliyun/auto-provision           (Idempotency-Key, 202 + run_id)
//   4. pollRun         → GET  /aliyun/provisioning-runs/{id}   (until succeeded/failed; honors poll_after_ms)
//   5. claimSecret     → POST /aliyun/provisioning-runs/{id}/receipt  (Idempotency-Key, one-time 明文 key)
//
// The claimed key is 即焚 (one-time) and NEVER persisted here — it lives only in
// memory between claimSecret() and the caller's applyToConfigs() write into the
// local runtime configs. Auth context (bearer + base URL) is resolved once per
// call via the shared resolveAuthedServerContext() so this stays in lockstep with
// the rest of the CLI's /me-sourced login state.
import { randomUUID } from 'node:crypto';

import { resolveAuthedServerContext } from './auth.mjs';

const API_PREFIX = '/api/v1/token-distribution-v3';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_REGION_ID = 'cn-shenzhen';

class ApiError extends Error {
  constructor(message, { status, path, body } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.path = path;
    this.body = body; // raw server response, for full diagnostics
  }
}

async function requireAuthedContext() {
  const ctx = await resolveAuthedServerContext();
  if (!ctx) {
    throw new Error('未登录或缺少授权，请先在「用户」菜单登录后再认领 token。');
  }
  return ctx;
}

async function readError(res, path) {
  const detail = await res.text().catch(() => '');
  const trimmed = detail ? `: ${detail.trim().slice(0, 200)}` : '';
  let body = null;
  if (detail) {
    try { body = JSON.parse(detail); } catch { /* keep null for non-JSON */ }
  }
  return new ApiError(`${res.status} ${res.statusText}${trimmed}`, { status: res.status, path, body });
}

// v3 mandates a stable Idempotency-Key (8–160 chars) on auto-provision and
// receipt. A UUID (36 chars) is unique per call and within range; the server
// replays the same run/receipt when the same key recurs, which is exactly the
// retry behavior we want.
function newIdempotencyKey() {
  return randomUUID();
}

async function send(ctx, method, suffix, { body, timeoutMs = DEFAULT_TIMEOUT_MS, idempotencyKey = null } = {}) {
  const headers = {
    Authorization: `Bearer ${ctx.token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const url = `${ctx.baseUrl}${API_PREFIX}${suffix}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // Network/TLS/DNS/timeout failures never produce an HTTP response, so without
    // wrapping they surface as a bare "fetch failed" with no clue which request
    // or host failed. Carry the endpoint path + the underlying cause (e.g.
    // getaddrinfo ENOTFOUND gw, certificate expired, timeout) so the CLI box can
    // show something actionable.
    const causeMsg = (e && (e.cause?.message || e.message)) || 'fetch failed';
    const wrapped = new ApiError(`网络请求失败 (${method} ${suffix}): ${causeMsg}`, { path: suffix });
    wrapped.cause = e?.cause || e;
    throw wrapped;
  }
  if (res.status === 401) {
    throw new Error('登录已失效（401），请重新登录后再认领 token。');
  }
  if (!res.ok) {
    const err = await readError(res, suffix);
    throw err;
  }
  return res.json().catch(() => null);
}

// 1. Read server default region + gateway. Region resolves to cn-shenzhen when
// absent so downstream calls always carry a concrete region_id.
export async function fetchDefaults() {
  const ctx = await requireAuthedContext();
  const body = await send(ctx, 'GET', '/aliyun/defaults');
  return {
    regionId: String(body?.region_id || '').trim() || DEFAULT_REGION_ID,
    gatewayId: String(body?.default_gateway_id || '').trim() || null,
    modelApiNames: Array.isArray(body?.default_model_api_names) ? body.default_model_api_names : [],
    raw: body,
  };
}

// Normalize discover's `model_apis` into a flat list. Each model_api is an
// endpoint (e.g. cpamc-openai → /cpaopen, cpamc-cc → /cpamc-cc) carrying its
// id, endpoint URL, and protocols — but NO nested model list. The actual model
// ids come later on the receipt (model_ids); the claim flow picks the highest
// version from those for the Codex config default (pickHighestVersionModel).
function normalizeModelApis(body) {
  if (!body || typeof body !== 'object') return [];
  const list = body.model_apis || body.modelApis || body.apis || [];
  const result = [];
  for (const api of list) {
    if (!api || typeof api !== 'object') continue;
    const name = api.name || api.api_name;
    if (!name) continue;
    result.push({
      name,
      httpApiId: api.http_api_id || api.id || null,
      endpoint: String(api.endpoint || '').trim(),
      protocols: Array.isArray(api.protocols) ? api.protocols : [],
      aiProtocols: Array.isArray(api.ai_protocols) ? api.ai_protocols
        : Array.isArray(api.protocols_normalized) ? api.protocols_normalized : [],
    });
  }
  return result;
}

// 2. Discover the available model catalog. Returns discovery_id (15m TTL) that
// the provision step must echo back, plus the selected gateway_id.
export async function discoverCatalog({ regionId = DEFAULT_REGION_ID, gatewayId = null } = {}) {
  const ctx = await requireAuthedContext();
  const body = await send(ctx, 'POST', '/aliyun/discover', {
    body: {
      region_id: regionId,
      include_upstream_models: true,
      ...(gatewayId ? { gateway_id: gatewayId } : {}),
    },
  });
  const modelApis = normalizeModelApis(body);
  const defaultApiName = body?.default_api_name || modelApis[0]?.name || null;
  const discoveryId = String(body?.discovery_id || '').trim() || null;
  // default_gateway_id is authoritative — it's the gateway the model_apis
  // actually belong to. The `gateways` list order is not meaningful (none is
  // marked `selected`), so gateways[0] used to win and pick the wrong gateway,
  // which made provision reject every model_api_id as "not found".
  const defaultGwId = String(body?.default_gateway_id || '').trim() || null;
  const gateways = Array.isArray(body?.gateways) ? body.gateways : [];
  const selected = gateways.find((g) => g && g.selected);
  const resolvedGatewayId =
    defaultGwId || selected?.gateway_id || gatewayId || gateways[0]?.gateway_id || null;
  // default_model_api_ids is the consumer-ready subset the server curates.
  // Provisioning keys off it (selectModelApiIds) — the full catalog includes
  // monitoring/test endpoints that have no data-plane domain, which the server
  // rejects mid-provision as aliyun_model_api_domain_missing.
  const defaultModelApiIds = (Array.isArray(body?.default_model_api_ids) ? body.default_model_api_ids : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  return { modelApis, defaultApiName, defaultModelApiIds, discoveryId, gatewayId: resolvedGatewayId, regionId, raw: body };
}

// The model_api_ids to provision = the server-curated consumer-ready set
// (default_model_api_ids). Provisioning the FULL catalog instead pulls in
// monitoring/test endpoints that have no data-plane domain, which the server
// rejects mid-provision as aliyun_model_api_domain_missing. Returns the curated
// ids trimmed/filtered; an empty result lets provisionRun's guard error clearly
// rather than silently provisioning endpoints that can't serve traffic.
export function selectModelApiIds(defaultModelApiIds = []) {
  return (Array.isArray(defaultModelApiIds) ? defaultModelApiIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
}

// 3. Kick off consumer provisioning. discovery_id is mandatory (from discover);
// Idempotency-Key is mandatory per v3.
export async function provisionRun({
  discoveryId,
  regionId = DEFAULT_REGION_ID,
  gatewayId = null,
  aliyunModelApiIds,
} = {}) {
  const selectedIds = Array.isArray(aliyunModelApiIds)
    ? aliyunModelApiIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  if (selectedIds.length === 0) {
    throw new Error('请至少选择一个阿里云 Model API。');
  }
  const discovery = String(discoveryId || '').trim();
  if (!discovery) {
    throw new Error('缺少 discovery_id，请先执行 discover 后再认领。');
  }
  const ctx = await requireAuthedContext();
  const body = await send(ctx, 'POST', '/aliyun/auto-provision', {
    body: {
      discovery_id: discovery,
      region_id: regionId,
      ...(gatewayId ? { gateway_id: gatewayId } : {}),
      model_api_ids: selectedIds,
    },
    idempotencyKey: newIdempotencyKey(),
  });
  const runId = body?.run_id;
  if (!runId) throw new Error('auto-provision 未返回 run_id');
  return { runId, raw: body };
}

// Render the real cause of a failed run. The run object reports failures as
// `error_code` + `error_message` (strings); some poll/event payloads nest an
// object under `error`. Surface whichever is present so the message doesn't
// collapse to "[object Object]" (or a bare status) when an upstream id/gateway
// is wrong.
function describeProvisioningError(body) {
  if (!body || typeof body !== 'object') return 'unknown';
  const code = typeof body.error_code === 'string' ? body.error_code.trim() : '';
  const message = typeof body.error_message === 'string' ? body.error_message.trim() : '';
  if (code && message) return `${code}: ${message}`;
  if (message) return message;
  if (code) return code;
  const err = body.error;
  if (typeof err === 'string' && err.trim()) return err.trim();
  if (err && typeof err === 'object') {
    const nested = err.message ?? err.detail ?? err.error_message ?? err.error;
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
    try {
      return JSON.stringify(err);
    } catch {
      return 'unknown error';
    }
  }
  if (typeof body.message === 'string' && body.message.trim()) return body.message.trim();
  return typeof body.status === 'string' ? body.status : 'unknown';
}

// 4. Poll the provisioning run until terminal. Sleeps for the server-advertised
// poll_after_ms between polls (caller's intervalMs when the server omits it).
// onTick(status, body) paints live progress.
export async function pollRun(runId, { timeoutMs = 120_000, intervalMs = 2_000, onTick = null } = {}) {
  const ctx = await requireAuthedContext();
  const startedAt = Date.now();
  let lastStatus = 'running';
  while (Date.now() - startedAt < timeoutMs) {
    const body = await send(ctx, 'GET', `/aliyun/provisioning-runs/${runId}`);
    const status = body?.status || 'running';
    lastStatus = status;
    if (typeof onTick === 'function') {
      try { onTick(status, body); } catch { /* progress paint must never break the poll */ }
    }
    if (status === 'succeeded') return body;
    if (status === 'failed') {
      const err = new Error(`provisioning failed: ${describeProvisioningError(body)}`);
      err.body = body; // raw run object, for full diagnostics (error_code/message/events)
      throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, body?.poll_after_ms ?? intervalMs));
  }
  throw new Error(`provisioning 超时（最后状态：${lastStatus}）`);
}

// 5. Claim the one-time plaintext secret via /receipt. Idempotency-Key is
// mandatory. The server burns the key after this call, so the returned key must
// be carried straight into applyToConfigs — never logged. endpoints
// ({openai, anthropic}) are the ready-to-use base URLs for each runtime.
export async function claimSecret(runId) {
  const ctx = await requireAuthedContext();
  const body = await send(ctx, 'POST', `/aliyun/provisioning-runs/${runId}/receipt`, {
    body: {},
    idempotencyKey: newIdempotencyKey(),
  });
  const key = String(body?.key || '').trim();
  if (!key) {
    throw new Error('receipt 未返回明文 key（可能已被领取或 run 未成功，请重新发起认领）。');
  }
  return {
    key,
    keyId: body?.key_id || null,
    endpoint: String(body?.endpoint || '').trim(),
    endpoints: body?.endpoints || {},
    modelIds: Array.isArray(body?.model_ids) ? body.model_ids : [],
    expiresAt: body?.expires_at || null,
    raw: body,
  };
}

// Sort model ids descending by dot-numeric version. Version = the first
// dot-numeric run in the id ("gpt-5.6-luna" → [5,6], "GLM-4.5-Air" → [4,5]);
// segments compared numerically (1.10 > 1.2); ids without a parseable version
// sort below any versioned one. Shared by pickHighestVersionModel + mapTierModels.
export function sortModelsByVersion(modelIds) {
  const ids = (Array.isArray(modelIds) ? modelIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  const versionOf = (id) => {
    const m = id.match(/(\d+(?:\.\d+)*)/);
    return m ? m[1].split('.').map(Number) : [];
  };
  const cmp = (a, b) => {
    const va = versionOf(a);
    const vb = versionOf(b);
    const len = Math.max(va.length, vb.length);
    for (let i = 0; i < len; i++) {
      const ai = va[i] ?? 0;
      const bi = vb[i] ?? 0;
      if (ai !== bi) return bi - ai; // higher version sorts first
    }
    return a < b ? -1 : a > b ? 1 : 0; // deterministic tiebreak
  };
  return [...ids].sort(cmp);
}

// Pick the highest-version model id from the receipt's authorized model_ids, for
// the Codex config default. Reuses sortModelsByVersion (DRY) — highest is [0].
export function pickHighestVersionModel(modelIds) {
  const sorted = sortModelsByVersion(modelIds);
  return sorted.length > 0 ? sorted[0] : null;
}

// Map receipt model_ids to Claude Code tier env vars (ANTHROPIC_DEFAULT_*_MODEL).
// Sorted descending (highest-first) from sortModelsByVersion, then:
//   opus   = sorted[0]        (always highest)
//   haiku  = sorted[len-1]    (always lowest)
//   sonnet = sorted[1] when len >= 3 (mid), else sorted[0] (same as opus)
// Matches user's real config: haiku→glm-4.5-air, sonnet→glm-5.1, opus→glm-5.2.
// Returns {} when the list is empty/null.
export function mapTierModels(modelIds) {
  const sorted = sortModelsByVersion(modelIds);
  if (sorted.length === 0) return {};
  const len = sorted.length;
  return {
    haiku: sorted[len - 1],
    sonnet: len >= 3 ? sorted[1] : sorted[0],
    opus: sorted[0],
  };
}
