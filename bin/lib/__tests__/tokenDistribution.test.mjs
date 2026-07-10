// Tests for bin/lib/tokenDistribution.mjs — the Aliyun AI Gateway token
// distribution v3 client (auto-provision → poll → claim one-time secret → discover).
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

  it('provisionRun posts to /aliyun/auto-provision and returns run_id', async () => {
    let posted = null;
    route((u, init) => {
      if (u.endsWith(`${API}/aliyun/auto-provision`) && init?.method === 'POST') {
        posted = JSON.parse(init.body);
        return Response.json({ run_id: 'run-123' });
      }
    });
    const { provisionRun } = await import('../tokenDistribution.mjs');
    const res = await provisionRun({ apiName: 'cpamc-openai', aliyunModelApiIds: ['h1', 'h2'] });
    expect(res.runId).toBe('run-123');
    expect(posted.api_name).toBe('cpamc-openai');
    expect(posted.region_id).toBe('cn-shenzhen');
    expect(posted.use_default_credentials).toBe(true);
    expect(posted.model_api_ids).toEqual(['h1', 'h2']);
  });

  it('provisionRun rejects missing model API IDs before calling auto-provision', async () => {
    route(() => {
      throw new Error('distribution API must not be called');
    });
    const { provisionRun } = await import('../tokenDistribution.mjs');
    await expect(provisionRun()).rejects.toThrow(/Model API|模型 API/i);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith(`${API}/aliyun/auto-provision`))).toBe(false);
  });

  it('pollRun resolves once the run reaches succeeded and calls onTick each poll', async () => {
    let gets = 0;
    route((u) => {
      if (u.endsWith(`${API}/provisioning-runs/run-123`) && gets === 0) { gets += 1; return Response.json({ status: 'running' }); }
      if (u.endsWith(`${API}/provisioning-runs/run-123`)) { gets += 1; return Response.json({ status: 'succeeded' }); }
    });
    const { pollRun } = await import('../tokenDistribution.mjs');
    const ticks = [];
    const body = await pollRun('run-123', { intervalMs: 0, onTick: (status) => ticks.push(status) });
    expect(body.status).toBe('succeeded');
    expect(ticks).toContain('running');
    expect(ticks).toContain('succeeded');
  });

  it('pollRun throws when the run fails', async () => {
    route(() => Response.json({ status: 'failed', error: 'quota exceeded' }));
    const { pollRun } = await import('../tokenDistribution.mjs');
    await expect(pollRun('run-bad', { intervalMs: 0, timeoutMs: 500 })).rejects.toThrow(/failed/);
  });

  it('claimSecret returns the one-time plaintext key + endpoint + proxy paths', async () => {
    route((u, init) => {
      if (u.endsWith(`${API}/provisioning-runs/run-123/secrets/claim`) && init?.method === 'POST') {
        return Response.json({
          one_time_secrets: [{
            key: 'sk-claimed',
            key_id: 'k1',
            endpoint: 'https://gw.example',
            proxy_paths: { openai_chat: '/proxy/openai/v1/chat/completions', openai_responses: '/proxy/openai/v1/responses' },
          }],
        });
      }
    });
    const { claimSecret } = await import('../tokenDistribution.mjs');
    const secret = await claimSecret('run-123');
    expect(secret.key).toBe('sk-claimed');
    expect(secret.endpoint).toBe('https://gw.example');
    expect(secret.keyId).toBe('k1');
    expect(secret.proxyPaths.openai_chat).toBeTruthy();
  });

  it('claimSecret throws a clear error when the secret is already consumed (即焚)', async () => {
    route(() => Response.json({ one_time_secrets: [] }));
    const { claimSecret } = await import('../tokenDistribution.mjs');
    await expect(claimSecret('run-123')).rejects.toThrow(/key|claim/i);
  });

  it('discoverCatalog normalizes enveloped model_apis into {name, httpApiId, models, wireApis}', async () => {
    route((u, init) => {
      if (u.endsWith(`${API}/aliyun/discover`) && init?.method === 'POST') {
        return Response.json({
          data: {
            default_api_name: 'cpamc-openai',
            model_apis: [{
              name: 'cpamc-openai',
              http_api_id: 'h1',
              models: [{ model: 'qwen-max' }, { model: 'gpt-4o' }],
              wire_apis: ['chat', 'responses'],
            }],
          },
        });
      }
    });
    const { discoverCatalog } = await import('../tokenDistribution.mjs');
    const cat = await discoverCatalog();
    expect(cat.defaultApiName).toBe('cpamc-openai');
    expect(cat.modelApis[0].name).toBe('cpamc-openai');
    expect(cat.modelApis[0].httpApiId).toBe('h1');
    expect(cat.modelApis[0].models).toEqual(['qwen-max', 'gpt-4o']);
    expect(cat.modelApis[0].wireApis).toEqual(['chat', 'responses']);
  });

  it('discoverCatalog tolerates an empty/unknown catalog (empty list, not a throw)', async () => {
    route(() => Response.json({}));
    const { discoverCatalog } = await import('../tokenDistribution.mjs');
    const cat = await discoverCatalog();
    expect(cat.modelApis).toEqual([]);
    expect(cat.defaultApiName).toBeNull();
  });

  it('provisionRun throws a 未登录 error instead of silently mocking when unauthenticated', async () => {
    // No access token → resolveAuthedServerContext returns null → clear error.
    await rm(path.join(tmpHome, 'auth', 'openhermit.json'), { force: true });
    fetchMock.mockImplementation(async (url) => {
      if (String(url).endsWith('/api/v1/auth/me')) return Response.json({ authenticated: false, status: 'unauthenticated' });
      throw new Error('should not hit distribution API when unauthenticated');
    });
    const { provisionRun } = await import('../tokenDistribution.mjs');
    await expect(provisionRun({ aliyunModelApiIds: ['h1'] })).rejects.toThrow(/登录|auth/i);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes(API))).toBe(false);
  });
});
