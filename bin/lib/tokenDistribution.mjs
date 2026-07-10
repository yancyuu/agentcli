// tokenDistribution.mjs — Aliyun AI Gateway "token distribution v3" client.
//
// Wires the CLI's token池「认领」action to the server's provision pipeline:
//   1. provisionRun  → POST /aliyun/auto-provision   (async, returns run_id)
//   2. pollRun       → GET  /provisioning-runs/{id}  (until succeeded/failed)
//   3. claimSecret   → POST /provisioning-runs/{id}/secrets/claim  (one-time 明文 key)
//   4. discoverCatalog → POST /aliyun/discover        (available model list)
//
// The claimed key is 即焚 (one-time) and NEVER persisted here — it lives only in
// memory between claimSecret() and the caller's applyToConfigs() write into the
// local runtime configs. Auth context (bearer + base URL) is resolved once per
// call via the shared resolveAuthedServerContext() so this stays in lockstep with
// the rest of the CLI's /me-sourced login state.
import { resolveAuthedServerContext } from './auth.mjs';

const API_PREFIX = '/api/v1/token-distribution-v3';
const DEFAULT_TIMEOUT_MS = 30_000;

// Common defaults for the Aliyun gateway provision request. api_name selects the
// pre-provisioned consumer template on the server; region_id is the Aliyun region.
const DEFAULT_REGION_ID = 'cn-shenzhen';
const DEFAULT_API_NAME = 'cpamc-openai';

class ApiError extends Error {
  constructor(message, { status, path } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.path = path;
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
  return new ApiError(`${res.status} ${res.statusText}${trimmed}`, { status: res.status, path });
}

async function send(ctx, method, suffix, { body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const res = await fetch(`${ctx.baseUrl}${API_PREFIX}${suffix}`, {
    method,
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 401) {
    throw new Error('登录已失效（401），请重新登录后再认领 token。');
  }
  if (!res.ok) throw await readError(res, suffix);
  return res.json().catch(() => null);
}

// 1. Kick off consumer provisioning. Returns { runId }.
export async function provisionRun({
  regionId = DEFAULT_REGION_ID,
  apiName = DEFAULT_API_NAME,
  useDefaultCredentials = true,
  aliyunModelApiIds,
} = {}) {
  const selectedIds = Array.isArray(aliyunModelApiIds)
    ? aliyunModelApiIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  if (selectedIds.length === 0) {
    throw new Error('请至少选择一个阿里云 Model API。');
  }
  const ctx = await requireAuthedContext();
  const body = await send(ctx, 'POST', '/aliyun/auto-provision', {
    body: {
      region_id: regionId,
      api_name: apiName,
      use_default_credentials: useDefaultCredentials,
      // Wire field is `model_api_ids` (verified against a historical succeeded
      // provisioning run's recorded request). The server's 422
      // `aliyun_model_api_ids_required` is misleadingly named — the body model
      // key is `model_api_ids`; sending `aliyun_model_api_ids` is silently
      // ignored and the validator then reports the field as empty.
      model_api_ids: selectedIds,
    },
  });
  const runId = body?.run_id || body?.runId || body?.id;
  if (!runId) throw new Error('auto-provision 未返回 run_id');
  return { runId, raw: body };
}

// 2. Poll the provisioning run until it reaches a terminal state. Resolves with
// the final status body on success; throws on failure or timeout. onTick(status,
// body) is invoked on every poll so the menu can paint a live progress line.
export async function pollRun(runId, { timeoutMs = 120_000, intervalMs = 2_000, onTick = null } = {}) {
  const ctx = await requireAuthedContext();
  const startedAt = Date.now();
  let lastStatus = 'running';
  while (Date.now() - startedAt < timeoutMs) {
    const body = await send(ctx, 'GET', `/provisioning-runs/${runId}`);
    const status = body?.status || body?.state || 'running';
    lastStatus = status;
    if (typeof onTick === 'function') {
      try { onTick(status, body); } catch { /* progress paint must never break the poll */ }
    }
    if (['succeeded', 'success', 'completed', 'complete'].includes(status)) return body;
    if (['failed', 'error'].includes(status)) {
      throw new Error(`provisioning failed: ${body?.error || body?.message || status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`provisioning 超时（最后状态：${lastStatus}）`);
}

// 3. Claim the one-time plaintext secret. The server burns it after this call, so
// the returned key must be carried straight into applyToConfigs — never logged.
export async function claimSecret(runId) {
  const ctx = await requireAuthedContext();
  const body = await send(ctx, 'POST', `/provisioning-runs/${runId}/secrets/claim`, { body: {} });
  const secret = body?.one_time_secrets?.[0] || body?.secret || body || {};
  const key = secret?.key || secret?.api_key || secret?.plaintext_key;
  if (!key) {
    throw new Error('claim 未返回明文 key（可能已被领取或已过期，请重新发起认领）。');
  }
  const proxyPaths = secret?.proxy_paths || body?.proxy_paths || {};
  return {
    key,
    keyId: secret?.key_id || secret?.id || null,
    endpoint: secret?.endpoint || body?.endpoint || '',
    proxyPaths,
    raw: body,
  };
}

// Normalize the discover response into a flat list of model APIs. The exact field
// names are not pinned by the spec, so this tolerates several plausible shapes;
// an empty/unknown catalog resolves to [] rather than throwing — the menu then
// offers a manual model-name entry fallback.
function normalizeModelApis(body) {
  if (!body || typeof body !== 'object') return [];
  const list = body.model_apis || body.modelApis || body.apis || [];
  const result = [];
  for (const api of list) {
    if (!api || typeof api !== 'object') continue;
    const name = api.name || api.api_name;
    if (!name) continue;
    const rawModels = api.models || api.model_catalog || api.model_list || [];
    const models = rawModels
      .map((m) => (typeof m === 'string' ? m : m?.model || m?.name || m?.id))
      .filter(Boolean);
    const wireApis = api.wire_apis || api.wireApis || api.protocols || [];
    result.push({ name, httpApiId: api.http_api_id || api.id || null, models, wireApis });
  }
  return result;
}

// 4. Discover the available model catalog for the gateway.
export async function discoverCatalog({ regionId = DEFAULT_REGION_ID } = {}) {
  const ctx = await requireAuthedContext();
  const payload = await send(ctx, 'POST', '/aliyun/discover', { body: { region_id: regionId } });
  const body = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const modelApis = normalizeModelApis(body);
  const defaultApiName = body?.default_api_name || body?.defaultApiName || modelApis[0]?.name || null;
  return { modelApis, defaultApiName, raw: body };
}
