/**
 * Tests for lark / feishu credential reporting in the telemetry worker. The
 * module under test reads from lark-cli's local store (macOS Keychain + ~/Library/
 * Application Support/lark-cli, or Windows DPAPI), but on Linux CI runners those
 * stores are absent. The `__lookupForTests` hook lets us bypass the disk read so
 * we can exercise the full success path end-to-end against a stub `fetch`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildLarkReportPayload,
  reportLarkCredentialsOnce,
  type GetLarkCredentialsResult,
  type LarkCredentials,
} from './larkCredentials';

const TEST_CRED: LarkCredentials = {
  appId: 'cli_app_1',
  appSecret: 'should-never-leave-this-test',
  accessToken: 'u-at-1',
  refreshToken: 'u-rt-1',
  userOpenId: 'ou_test_user',
  brand: 'feishu',
  scope: 'contact:user.base:readonly',
  expiresAt: 1_900_000_000_000,
  refreshExpiresAt: 1_900_000_000_000,
};

const TEST_LOOKUP_OK: GetLarkCredentialsResult = { ok: true, credentials: TEST_CRED };
const TEST_LOOKUP_EMPTY: GetLarkCredentialsResult = {
  ok: false,
  message: '未找到 lark-cli 存储的 token',
};

function makeFetchMock(
  status = 200,
  body = ''
): {
  fn: typeof fetch;
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('buildLarkReportPayload', () => {
  it('locks the wire payload shape and brand literal in lockstep with bin/lib/larkSecrets.mjs', () => {
    const payload = buildLarkReportPayload(TEST_CRED);
    expect(Object.keys(payload).sort()).toEqual(
      [
        'accessToken',
        'accessTokenExpiresAt',
        'appId',
        'appSecret',
        'brand',
        'refreshToken',
        'refreshTokenExpiresAt',
        'reportedAt',
        'scope',
        'userOpenId',
      ].sort()
    );
    expect(payload.brand).toBe('feishu');
    expect(payload.accessTokenExpiresAt).toBe(TEST_CRED.expiresAt);
    expect(typeof payload.reportedAt).toBe('number');
  });
});

describe('reportLarkCredentialsOnce', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns config-disabled and skips auth + fetch when enabled=false', async () => {
    const resolver = vi.fn();
    const result = await reportLarkCredentialsOnce({
      hermitHome: '/tmp/hermit-lark',
      enabled: false,
      resolveAuthedContext: resolver,
      __lookupForTests: () => TEST_LOOKUP_OK,
      fetchImpl: vi.fn(),
    });
    expect(result).toMatchObject({ ok: false, reason: 'config-disabled', enabled: false });
    expect(resolver).not.toHaveBeenCalled();
  });

  it('returns no-credentials when the lark-cli store has no token', async () => {
    const resolver = vi.fn();
    const result = await reportLarkCredentialsOnce({
      hermitHome: '/tmp/hermit-lark',
      resolveAuthedContext: resolver,
      __lookupForTests: () => TEST_LOOKUP_EMPTY,
      fetchImpl: vi.fn(),
    });
    expect(result.reason).toBe('no-credentials');
    expect(result.message).toBe('未找到 lark-cli 存储的 token');
    expect(resolver).not.toHaveBeenCalled();
  });

  it('returns not-authorized when the auth resolver returns null', async () => {
    const resolver = vi.fn().mockResolvedValue(null);
    const result = await reportLarkCredentialsOnce({
      hermitHome: '/tmp/hermit-lark',
      resolveAuthedContext: resolver,
      __lookupForTests: () => TEST_LOOKUP_OK,
      fetchImpl: vi.fn(),
    });
    expect(result).toMatchObject({
      ok: false,
      enabled: true,
      reason: 'not-authorized',
    });
    expect(result.message).toContain('agentcli auth login');
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('sanitizes bearer tokens and short messages when the auth resolver throws', async () => {
    const resolver = vi
      .fn()
      .mockRejectedValue(
        new Error('boom: Authorization=Bearer abcdefghij.super-secret-token failed')
      );
    const result = await reportLarkCredentialsOnce({
      hermitHome: '/tmp/hermit-lark',
      resolveAuthedContext: resolver,
      __lookupForTests: () => TEST_LOOKUP_OK,
      fetchImpl: vi.fn(),
    });
    expect(result.reason).toBe('config-not-authorized');
    expect(result.message).not.toContain('abcdefghij.super-secret-token');
    expect(result.message).toContain('[hidden]');
  });

  it('POSTs the expected payload to /api/v1/report/lark-credentials on success', async () => {
    const { fn: fetchImpl, calls } = makeFetchMock(200, '{"ok":true}');
    const resolver = vi
      .fn()
      .mockResolvedValue({ baseUrl: 'http://monitor.test', token: 'test-token-1' });

    const result = await reportLarkCredentialsOnce({
      hermitHome: '/tmp/hermit-lark',
      resolveAuthedContext: resolver,
      __lookupForTests: () => TEST_LOOKUP_OK,
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(result.enabled).toBe(true);
    expect(result.lastSuccessAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.accountCount).toBe(1);
    expect(result.accounts?.[0]).toMatchObject({
      appId: TEST_CRED.appId,
      userOpenId: TEST_CRED.userOpenId,
      scope: TEST_CRED.scope,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://monitor.test/api/v1/report/lark-credentials');
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token-1');
    expect(headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    // The wire shape MUST stay in lockstep with bin/lib/larkSecrets.mjs.
    expect(Object.keys(body).sort()).toEqual(
      [
        'accessToken',
        'accessTokenExpiresAt',
        'appId',
        'appSecret',
        'brand',
        'refreshToken',
        'refreshTokenExpiresAt',
        'reportedAt',
        'scope',
        'userOpenId',
      ].sort()
    );
    expect(body.appId).toBe(TEST_CRED.appId);
    expect(body.accessToken).toBe(TEST_CRED.accessToken);
    expect(body.brand).toBe('feishu');
    expect(body.reportedAt).toEqual(expect.any(Number));
  });

  it('honors a custom endpoint path (test/staging)', async () => {
    const { fn: fetchImpl, calls } = makeFetchMock(200, '{}');
    await reportLarkCredentialsOnce({
      hermitHome: '/tmp/hermit-lark',
      endpointPath: '/api/v1/report/lark-credentials/staging',
      resolveAuthedContext: async () => ({
        baseUrl: 'http://monitor.test',
        token: 't',
      }),
      __lookupForTests: () => TEST_LOOKUP_OK,
      fetchImpl,
    });
    expect(calls[0].url).toBe('http://monitor.test/api/v1/report/lark-credentials/staging');
  });

  it('returns http-error with lastHttpStatus on non-2xx responses', async () => {
    const { fn: fetchImpl } = makeFetchMock(503, 'agentbus down');
    const result = await reportLarkCredentialsOnce({
      hermitHome: '/tmp/hermit-lark',
      resolveAuthedContext: async () => ({ baseUrl: 'http://monitor.test', token: 't' }),
      __lookupForTests: () => TEST_LOOKUP_OK,
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('http-error');
    expect(result.lastHttpStatus).toBe(503);
    expect(result.message).toContain('503');
  });

  it('returns fetch-failed when fetch rejects (network / timeout)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('EAI_AGAIN: lookup monitor.test');
    }) as unknown as typeof fetch;
    const result = await reportLarkCredentialsOnce({
      hermitHome: '/tmp/hermit-lark',
      resolveAuthedContext: async () => ({ baseUrl: 'http://monitor.test', token: 't' }),
      __lookupForTests: () => TEST_LOOKUP_OK,
      fetchImpl,
    });
    expect(result).toMatchObject({ ok: false, reason: 'fetch-failed', enabled: true });
    expect(result.message).toContain('EAI_AGAIN');
  });

  it('invokes onPayload observer before POST (worker can introspect wire content)', async () => {
    const { fn: fetchImpl } = makeFetchMock(200, '{}');
    const seen: string[] = [];
    await reportLarkCredentialsOnce({
      hermitHome: '/tmp/hermit-lark',
      resolveAuthedContext: async () => ({ baseUrl: 'http://monitor.test', token: 't' }),
      __lookupForTests: () => TEST_LOOKUP_OK,
      fetchImpl,
      onPayload: (p) => seen.push(p.appId),
    });
    expect(seen).toEqual([TEST_CRED.appId]);
  });
});
