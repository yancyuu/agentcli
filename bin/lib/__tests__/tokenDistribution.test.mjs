// Tests for bin/lib/tokenDistribution.mjs — the Aliyun AI Gateway token
// distribution v3 async client.
//
// Flow: defaults → discover(discovery_id) → auto-provision(Idempotency-Key, 202)
//   → poll(poll_after_ms) → receipt(Idempotency-Key, one-time key).
//
// Auth context mirrors usageRemote.test.mjs: a temp HERMIT_HOME holds the auth
// store, OPENHERMIT_CONVERSATION_UPLOAD_BASE_URL pins the server, and fetch is
// stubbed to route by URL+method (including the /me probe resolveAuthedServerContext
// fires via refreshOpenHermitAuthStatus).
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const API = '/api/v1/token-distribution-v3';

describe('token distribution v3 client', () => {
  let tmpHome;
  let fetchMock;

  beforeAll(async () => {
    tmpHome = await mkdtemp(path.join(os.tmpdir(), 'hermit-tokendist-'));
    process.env.HERMIT_HOME = tmpHome;
    process.env.OPENHERMIT_CONVERSATION_UPLOAD_BASE_URL = 'http://gateway.test';
    vi.resetModules();
  });

  afterAll(async () => {
    delete process.env.HERMIT_HOME;
    delete process.env.OPENHERMIT_CONVERSATION_UPLOAD_BASE_URL;
    await rm(tmpHome, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Seed a live auth store each test so resolveAuthedServerContext sees a token.
    await mkdir(path.join(tmpHome, 'auth'), { recursive: true });
    await writeFile(
      path.join(tmpHome, 'auth', 'openhermit.json'),
      JSON.stringify({ token: { accessToken: 'bearer-tok', expiresAt: '2999-01-01T00:00:00.000Z' } })
    );
    vi.resetModules();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  function meOk() {
    return Response.json({ authenticated: true, status: 'ok' });
  }

  function route(handlers) {
    // handlers: (urlString, init) => Response | undefined
    fetchMock.mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.endsWith('/api/v1/auth/me')) return meOk();
      const resp = handlers(u, init);
      if (resp) return resp;
      throw new Error(`unexpected fetch ${init?.method || 'GET'} ${u}`);
    });
  }

  it('fetchDefaults reads region + default gateway + model api names', async () => {
    route((u) => {
      if (u.endsWith(`${API}/aliyun/defaults`)) {
        return Response.json({ region_id: 'cn-hangzhou', default_gateway_id: 'gw-1', default_model_api_names: ['cpamc-openai'] });
      }
    });
    const { fetchDefaults } = await import('../tokenDistribution.mjs');
    const d = await fetchDefaults();
    expect(d.regionId).toBe('cn-hangzhou');
    expect(d.gatewayId).toBe('gw-1');
    expect(d.modelApiNames).toEqual(['cpamc-openai']);
  });

  it('provisionRun posts discovery_id + gateway_id + model_api_ids with an Idempotency-Key', async () => {
    let posted = null;
    let idemHeader = null;
    route((u, init) => {
      if (u.endsWith(`${API}/aliyun/auto-provision`) && init?.method === 'POST') {
        posted = JSON.parse(init.body);
        idemHeader = init.headers['Idempotency-Key'];
        return Response.json({ run_id: 'run-123' });
      }
    });
    const { provisionRun } = await import('../tokenDistribution.mjs');
    const res = await provisionRun({ discoveryId: 'disc-1', gatewayId: 'gw-1', aliyunModelApiIds: ['h1', 'h2'] });
    expect(res.runId).toBe('run-123');
    expect(posted.discovery_id).toBe('disc-1');
    expect(posted.gateway_id).toBe('gw-1');
    expect(posted.region_id).toBe('cn-shenzhen');
    expect(posted.model_api_ids).toEqual(['h1', 'h2']);
    expect(posted.api_name).toBeUndefined(); // v3 dropped api_name
    expect(posted.use_default_credentials).toBeUndefined();
    expect(typeof idemHeader).toBe('string');
    expect(idemHeader.length).toBeGreaterThanOrEqual(8);
  });

  it('provisionRun rejects missing discovery_id before calling auto-provision', async () => {
    route(() => {
      throw new Error('distribution API must not be called');
    });
    const { provisionRun } = await import('../tokenDistribution.mjs');
    await expect(provisionRun({ aliyunModelApiIds: ['h1'] })).rejects.toThrow(/discovery/i);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith(`${API}/aliyun/auto-provision`))).toBe(false);
  });

  it('provisionRun rejects missing model API IDs before calling auto-provision', async () => {
    route(() => {
      throw new Error('distribution API must not be called');
    });
    const { provisionRun } = await import('../tokenDistribution.mjs');
    await expect(provisionRun({ discoveryId: 'disc-1' })).rejects.toThrow(/Model API|模型 API/i);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith(`${API}/aliyun/auto-provision`))).toBe(false);
  });

  it('pollRun resolves once the run reaches succeeded and honors poll_after_ms', async () => {
    let gets = 0;
    route((u) => {
      if (u.endsWith(`${API}/aliyun/provisioning-runs/run-123`)) {
        gets += 1;
        return Response.json({ status: gets === 1 ? 'running' : 'succeeded', poll_after_ms: 5 });
      }
    });
    const { pollRun } = await import('../tokenDistribution.mjs');
    const ticks = [];
    const body = await pollRun('run-123', { intervalMs: 50, onTick: (status) => ticks.push(status) });
    expect(body.status).toBe('succeeded');
    expect(ticks).toContain('running');
    expect(ticks).toContain('succeeded');
  });

  it('pollRun throws when the run fails', async () => {
    route(() => Response.json({ status: 'failed', error: 'quota exceeded' }));
    const { pollRun } = await import('../tokenDistribution.mjs');
    await expect(pollRun('run-bad', { intervalMs: 0, timeoutMs: 500 })).rejects.toThrow(/failed/);
  });

  it('pollRun surfaces error_code + error_message instead of [object Object]', async () => {
    // The run object reports failures as error_code/error_message (strings); the
    // old throw read body.error/body.message and collapsed to "[object Object]".
    route(() =>
      Response.json({
        status: 'failed',
        error_code: 'aliyun_model_api_ids_not_found',
        error_message: '未找到 Model API ID：api-x',
      })
    );
    const { pollRun } = await import('../tokenDistribution.mjs');
    await expect(pollRun('run-bad', { intervalMs: 0, timeoutMs: 500 })).rejects.toThrow(
      /aliyun_model_api_ids_not_found.*未找到 Model API ID/
    );
  });

  it('pollRun renders a nested object error without collapsing to [object Object]', async () => {
    route(() => Response.json({ status: 'failed', error: { code: 'X', message: 'boom-detail' } }));
    const { pollRun } = await import('../tokenDistribution.mjs');
    await expect(pollRun('run-bad', { intervalMs: 0, timeoutMs: 500 })).rejects.toThrow(/boom-detail/);
  });

  it('claimSecret posts to /receipt with an Idempotency-Key and returns key + endpoints', async () => {
    let idemHeader = null;
    route((u, init) => {
      if (u.endsWith(`${API}/aliyun/provisioning-runs/run-123/receipt`) && init?.method === 'POST') {
        idemHeader = init.headers['Idempotency-Key'];
        return Response.json({
          key: 'aim_v3_claimed',
          key_id: 'k1',
          endpoint: 'https://gw.example/cpaopen/v1/models',
          endpoints: { openai: 'https://gw.example/cpaopen', anthropic: 'https://gw.example/cpamc-cc' },
          model_ids: ['qwen-max'],
          expires_at: '2026-10-09T00:00:00Z',
        });
      }
    });
    const { claimSecret } = await import('../tokenDistribution.mjs');
    const secret = await claimSecret('run-123');
    expect(secret.key).toBe('aim_v3_claimed');
    expect(secret.keyId).toBe('k1');
    expect(secret.endpoints.anthropic).toBe('https://gw.example/cpamc-cc');
    expect(secret.endpoints.openai).toBe('https://gw.example/cpaopen');
    expect(secret.modelIds).toEqual(['qwen-max']);
    expect(typeof idemHeader).toBe('string');
    expect(idemHeader.length).toBeGreaterThanOrEqual(8);
  });

  it('claimSecret throws a clear error when the key is already consumed (即焚)', async () => {
    route(() => Response.json({ claimed: true, key: null }));
    const { claimSecret } = await import('../tokenDistribution.mjs');
    await expect(claimSecret('run-123')).rejects.toThrow(/key|receipt|领取/i);
  });

  it('discoverCatalog posts gateway_id and returns discovery_id + model_apis', async () => {
    let posted = null;
    route((u, init) => {
      if (u.endsWith(`${API}/aliyun/discover`) && init?.method === 'POST') {
        posted = JSON.parse(init.body);
        return Response.json({
          discovery_id: 'disc-1',
          default_api_name: 'cpamc-openai',
          gateways: [{ gateway_id: 'gw-1', selected: true }],
          model_apis: [
            { name: 'cpamc-openai', id: 'api-openai', endpoint: 'https://ai.skg.com/cpaopen', protocols: ['openai'] },
            { name: 'cpamc-cc', id: 'api-cc', endpoint: 'https://ai.skg.com/cpamc-cc', protocols: ['anthropic'] },
          ],
          // The server also returns a top-level `models` array, but we no longer
          // parse it here: provisioning authorizes model_apis, and the config
          // model is derived from the receipt's model_ids (pickHighestVersionModel).
          models: [
            { id: 'gpt-5.2', owned_by: 'openai' },
            { id: 'GLM-4.5', owned_by: 'anthropic' },
          ],
        });
      }
    });
    const { discoverCatalog } = await import('../tokenDistribution.mjs');
    const cat = await discoverCatalog({ regionId: 'cn-shenzhen', gatewayId: 'gw-1' });
    expect(cat.discoveryId).toBe('disc-1');
    expect(cat.gatewayId).toBe('gw-1');
    expect(posted.gateway_id).toBe('gw-1');
    expect(posted.include_upstream_models).toBe(true);
    expect(cat.defaultApiName).toBe('cpamc-openai');
    // model_apis drive provisioning (id + endpoint + protocols); discover's
    // top-level models list is intentionally not surfaced on the catalog.
    expect(cat.modelApis[0].name).toBe('cpamc-openai');
    expect(cat.modelApis[0].httpApiId).toBe('api-openai');
    expect(cat.modelApis[0].endpoint).toBe('https://ai.skg.com/cpaopen');
    expect(cat.modelApis[0].protocols).toEqual(['openai']);
    expect(cat).not.toHaveProperty('models');
  });

  it('discoverCatalog prefers default_gateway_id (the gateway model_apis belong to) over gateways[0]', async () => {
    // Neither gateway is marked `selected` and the list order is not meaningful,
    // so default_gateway_id is authoritative. Taking gateways[0] used to pick the
    // wrong gateway and made provision reject every model_api_id as not-found.
    route((u, init) => {
      if (u.endsWith(`${API}/aliyun/discover`) && init?.method === 'POST') {
        return Response.json({
          discovery_id: 'disc-1',
          default_gateway_id: 'gw-real',
          gateways: [{ gateway_id: 'gw-other' }, { gateway_id: 'gw-real' }],
          model_apis: [
            { name: 'cpamc-openai', http_api_id: 'api-1', gateway_id: 'gw-real', protocols: ['openai'] },
          ],
        });
      }
    });
    const { discoverCatalog } = await import('../tokenDistribution.mjs');
    const cat = await discoverCatalog({ regionId: 'cn-shenzhen' });
    expect(cat.gatewayId).toBe('gw-real');
  });

  it('discoverCatalog surfaces server-curated default_model_api_ids', async () => {
    // default_model_api_ids is the consumer-ready subset the server sanctions.
    // Provisioning must key off it (see selectModelApiIds), not the full catalog.
    route((u, init) => {
      if (u.endsWith(`${API}/aliyun/discover`) && init?.method === 'POST') {
        return Response.json({
          discovery_id: 'disc-1',
          default_gateway_id: 'gw-1',
          default_model_api_ids: ['api-openai', 'api-cc'],
          model_apis: [
            { name: 'cpamc-openai', http_api_id: 'api-openai' },
            { name: 'cpamc-cc', http_api_id: 'api-cc' },
            { name: 'ai-monitor-selftest', http_api_id: 'api-mon' },
          ],
        });
      }
    });
    const { discoverCatalog } = await import('../tokenDistribution.mjs');
    const cat = await discoverCatalog({ regionId: 'cn-shenzhen' });
    expect(cat.defaultModelApiIds).toEqual(['api-openai', 'api-cc']);
  });

  it('selectModelApiIds returns the server-curated defaults only', async () => {
    // Provisioning must use ONLY the curated set. The full catalog contains
    // monitoring/test endpoints with no data-plane domain; provisioning them is
    // what triggered aliyun_model_api_domain_missing. An uncurated catalog yields
    // [] and provisionRun's guard errors clearly rather than provisioning junk.
    const { selectModelApiIds } = await import('../tokenDistribution.mjs');
    expect(selectModelApiIds(['api-openai', 'api-cc'])).toEqual(['api-openai', 'api-cc']);
    expect(selectModelApiIds(['  api-x  ', '', null])).toEqual(['api-x']);
    expect(selectModelApiIds([])).toEqual([]);
    expect(selectModelApiIds(undefined)).toEqual([]);
  });

  it('discoverCatalog tolerates an empty/unknown catalog (empty list, not a throw)', async () => {
    route(() => Response.json({}));
    const { discoverCatalog } = await import('../tokenDistribution.mjs');
    const cat = await discoverCatalog();
    expect(cat.modelApis).toEqual([]);
    expect(cat.defaultApiName).toBeNull();
    expect(cat.discoveryId).toBeNull();
  });

  it('pickHighestVersionModel picks the highest dot-numeric version', async () => {
    const { pickHighestVersionModel } = await import('../tokenDistribution.mjs');
    expect(pickHighestVersionModel(['gpt-5.2', 'gpt-5.6-luna', 'gpt-4o'])).toBe('gpt-5.6-luna');
    expect(pickHighestVersionModel(['GLM-4.5-Air', 'GLM-5.2', 'GLM-4.6'])).toBe('GLM-5.2');
  });

  it('pickHighestVersionModel compares version segments numerically (1.10 > 1.2)', async () => {
    const { pickHighestVersionModel } = await import('../tokenDistribution.mjs');
    expect(pickHighestVersionModel(['m-1.2', 'm-1.10'])).toBe('m-1.10');
  });

  it('pickHighestVersionModel returns null on empty/missing input', async () => {
    const { pickHighestVersionModel } = await import('../tokenDistribution.mjs');
    expect(pickHighestVersionModel([])).toBeNull();
    expect(pickHighestVersionModel(null)).toBeNull();
    expect(pickHighestVersionModel(undefined)).toBeNull();
  });

  it('sortModelsByVersion returns ids sorted descending by dot-numeric version', async () => {
    const { sortModelsByVersion } = await import('../tokenDistribution.mjs');
    expect(sortModelsByVersion(['gpt-4o', 'gpt-5.6-luna', 'gpt-5.2'])).toEqual(['gpt-5.6-luna', 'gpt-5.2', 'gpt-4o']);
    expect(sortModelsByVersion(['GLM-4.5-Air', 'GLM-5.2', 'GLM-4.6'])).toEqual(['GLM-5.2', 'GLM-4.6', 'GLM-4.5-Air']);
    expect(sortModelsByVersion([])).toEqual([]);
  });

  it('sortModelsByVersion is reused by pickHighestVersionModel (first element)', async () => {
    const { pickHighestVersionModel, sortModelsByVersion } = await import('../tokenDistribution.mjs');
    const ids = ['gpt-4o', 'gpt-5.2', 'gpt-5.6-luna'];
    expect(pickHighestVersionModel(ids)).toBe(sortModelsByVersion(ids)[0]);
  });

  it('mapTierModels maps 3 GLM models to haiku/sonnet/opus by ascending version', async () => {
    const { mapTierModels } = await import('../tokenDistribution.mjs');
    expect(mapTierModels(['GLM-4.5-Air', 'GLM-5.2', 'GLM-5.1'])).toEqual({
      haiku: 'GLM-4.5-Air',
      sonnet: 'GLM-5.1',
      opus: 'GLM-5.2',
    });
  });

  it('mapTierModels with 2 models: sonnet = 2nd-highest, haiku = lowest', async () => {
    const { mapTierModels } = await import('../tokenDistribution.mjs');
    expect(mapTierModels(['glm-5.2', 'glm-5.1'])).toEqual({
      haiku: 'glm-5.1',
      sonnet: 'glm-5.2',
      opus: 'glm-5.2',
    });
  });

  it('mapTierModels with 1 model: all three tiers get the same model', async () => {
    const { mapTierModels } = await import('../tokenDistribution.mjs');
    expect(mapTierModels(['glm-5.2'])).toEqual({ haiku: 'glm-5.2', sonnet: 'glm-5.2', opus: 'glm-5.2' });
  });

  it('mapTierModels returns {} for empty/null input', async () => {
    const { mapTierModels } = await import('../tokenDistribution.mjs');
    expect(mapTierModels([])).toEqual({});
    expect(mapTierModels(null)).toEqual({});
    expect(mapTierModels(undefined)).toEqual({});
  });

  it('normalizeModelApis parses ai_protocols and protocols_normalized', async () => {
    // ai_protocols is the AI-level protocol (Anthropic/OpenAI/v1) — distinct from
    // the transport-level protocols field (HTTP/HTTPS). The manual command needs it.
    route((u, init) => {
      if (u.endsWith(`${API}/aliyun/discover`) && init?.method === 'POST') {
        return Response.json({
          discovery_id: 'disc-1',
          default_gateway_id: 'gw-1',
          model_apis: [
            { name: 'cpamc-cc', http_api_id: 'api-cc', endpoint: 'https://ai.skg.com/cpamc-cc', protocols: ['HTTPS'], ai_protocols: ['Anthropic'], protocols_normalized: ['anthropic'] },
            { name: 'cpamc-openai', http_api_id: 'api-openai', endpoint: 'https://ai.skg.com/cpaopen', ai_protocols: ['OpenAI/v1'] },
            { name: 'cpamc-other', http_api_id: 'api-other', protocols_normalized: ['openai'] },
          ],
        });
      }
    });
    const { discoverCatalog } = await import('../tokenDistribution.mjs');
    const cat = await discoverCatalog({ regionId: 'cn-shenzhen' });
    const cc = cat.modelApis.find((a) => a.name === 'cpamc-cc');
    expect(cc.aiProtocols).toEqual(['Anthropic']);
    const openai = cat.modelApis.find((a) => a.name === 'cpamc-openai');
    expect(openai.aiProtocols).toEqual(['OpenAI/v1']);
    const other = cat.modelApis.find((a) => a.name === 'cpamc-other');
    expect(other.aiProtocols).toEqual(['openai']);
  });

  it('normalizeModelApis aiProtocols falls back to [] when neither field exists', async () => {
    route((u, init) => {
      if (u.endsWith(`${API}/aliyun/discover`) && init?.method === 'POST') {
        return Response.json({
          discovery_id: 'disc-1',
          model_apis: [{ name: 'bare-api', http_api_id: 'api-bare' }],
        });
      }
    });
    const { discoverCatalog } = await import('../tokenDistribution.mjs');
    const cat = await discoverCatalog({ regionId: 'cn-shenzhen' });
    expect(cat.modelApis[0].aiProtocols).toEqual([]);
  });

  it('provisionRun throws a 未登录 error instead of silently mocking when unauthenticated', async () => {
    // No access token → resolveAuthedServerContext returns null → clear error.
    await rm(path.join(tmpHome, 'auth', 'openhermit.json'), { force: true });
    fetchMock.mockImplementation(async (url) => {
      if (String(url).endsWith('/api/v1/auth/me')) return Response.json({ authenticated: false, status: 'unauthenticated' });
      throw new Error('should not hit distribution API when unauthenticated');
    });
    const { provisionRun } = await import('../tokenDistribution.mjs');
    await expect(provisionRun({ discoveryId: 'disc-1', aliyunModelApiIds: ['h1'] })).rejects.toThrow(/登录|auth/i);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes(API))).toBe(false);
  });
});
