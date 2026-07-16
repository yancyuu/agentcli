/**
 * Tests for lark / feishu credential reporting in the telemetry worker. The
 * module under test reads from lark-cli's local store (macOS Keychain + ~/Library/
 * Application Support/lark-cli, or Windows DPAPI), but on Linux CI runners those
 * stores are absent. The `__lookupForTests` hook lets us bypass the disk read so
 * we can exercise the full success path end-to-end against a stub `fetch`.
 */

import { createCipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  __internals,
  buildLarkBatchPayload,
  buildLarkReportPayload,
  isLarkRefreshSucceeded,
  meetsBatchFieldConstraints,
  reportLarkCredentialsBatchOnce,
  reportLarkCredentialsOnce,
  shouldRefreshLarkCredentials,
  parseLarkCliPersonalAuthorizations,
  type GetLarkCredentialsAllResult,
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

const TEST_LOOKUP_REFRESH_FAILED: GetLarkCredentialsResult = {
  ok: false,
  refreshFailed: true,
  message: 'lark-cli 个人授权刷新失败，未上传可能过期的凭证',
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

describe('lark-cli profile authorization discovery', () => {
  it('keeps the exact profile name when auth metadata identifies a personal authorization', () => {
    expect(
      parseLarkCliPersonalAuthorizations(
        { name: '2222', appId: 'cli_aadcbb097af8dd2c' },
        [
          {
            appId: 'cli_aadcbb097af8dd2c',
            userOpenId: 'ou_target_user',
          },
        ]
      )
    ).toEqual([
      {
        profileName: '2222',
        appId: 'cli_aadcbb097af8dd2c',
        userOpenId: 'ou_target_user',
      },
    ]);
  });

  it('rejects auth metadata whose app identity does not match the profile', () => {
    expect(
      parseLarkCliPersonalAuthorizations(
        { name: '2222', appId: 'cli_aadcbb097af8dd2c' },
        [{ appId: 'cli_other', userOpenId: 'ou_target_user' }]
      )
    ).toEqual([]);
  });
});
describe('lark-cli profile selection', () => {
  it('uses the profile name for an app instead of assuming it equals the appId', () => {
    expect(
      __internals.pickProfileNameByAppId(
        [
          { appId: 'cli_default', name: 'cli_default' },
          { appId: 'cli_worker', name: 'support-worker' },
        ],
        'cli_worker'
      )
    ).toBe('support-worker');
  });

  it('falls back to the appId when its profile cannot be listed', () => {
    expect(__internals.pickProfileNameByAppId([], 'cli_default')).toBe('cli_default');
  });
});

describe('shouldRefreshLarkCredentials', () => {
  const NOW = 1_700_000_000_000;
  const cred = (refreshExpiresAt: number): LarkCredentials => ({ ...TEST_CRED, refreshExpiresAt });

  it('refreshes when the personal refresh token expires in the future', () => {
    expect(shouldRefreshLarkCredentials(cred(NOW + 60_000), NOW)).toBe(true);
  });

  it('skips refresh when the refresh token is already expired', () => {
    expect(shouldRefreshLarkCredentials(cred(NOW - 1), NOW)).toBe(false);
  });

  it('treats the exact expiry moment as expired (strictly greater-than)', () => {
    expect(shouldRefreshLarkCredentials(cred(NOW), NOW)).toBe(false);
  });

  it('skips refresh when refreshExpiresAt is missing/zero', () => {
    expect(shouldRefreshLarkCredentials(cred(0), NOW)).toBe(false);
    expect(shouldRefreshLarkCredentials(undefined, NOW)).toBe(false);
  });

  it('skips refresh for non-finite (corrupt) expiry values', () => {
    expect(shouldRefreshLarkCredentials(cred(Number.NaN), NOW)).toBe(false);
    expect(shouldRefreshLarkCredentials(cred(Number.POSITIVE_INFINITY), NOW)).toBe(false);
  });
});

describe('isLarkRefreshSucceeded (decoupled: a refreshed token must still upload)', () => {
  const ok = (
    over: Partial<{ checkStatus: number; verifyStatus: number; verifyStdout: string }> = {}
  ) => ({
    checkStatus: 0,
    verifyStatus: 0,
    verifyStdout: JSON.stringify({ identities: { user: { available: true, verified: true } } }),
    ...over,
  });

  it('succeeds when auth check + status verify exit 0 and the user is available', () => {
    expect(isLarkRefreshSucceeded(ok())).toBe(true);
  });

  it('succeeds even when verified is false — availability is enough', () => {
    // a56f531 required verified===true; it flapped on transient lark-cli checks and
    // withheld an already-refreshed token, dropping the user's authorization.
    expect(
      isLarkRefreshSucceeded(
        ok({
          verifyStdout: JSON.stringify({
            identities: { user: { available: true, verified: false } },
          }),
        })
      )
    ).toBe(true);
  });

  it('succeeds regardless of scope missing — scope drift must not withhold the upload', () => {
    // isLarkRefreshSucceeded no longer inspects auth check's ok/missing at all.
    expect(
      isLarkRefreshSucceeded(
        ok({ verifyStdout: JSON.stringify({ identities: { user: { available: true } } }) })
      )
    ).toBe(true);
  });

  it('fails when the refreshed token is not available', () => {
    expect(
      isLarkRefreshSucceeded(
        ok({ verifyStdout: JSON.stringify({ identities: { user: { available: false } } }) })
      )
    ).toBe(false);
  });

  it('fails when auth check or status verify exits non-zero', () => {
    expect(isLarkRefreshSucceeded(ok({ checkStatus: 1 }))).toBe(false);
    expect(isLarkRefreshSucceeded(ok({ verifyStatus: 2 }))).toBe(false);
  });

  it('fails on unparseable verify output', () => {
    expect(isLarkRefreshSucceeded(ok({ verifyStdout: 'not-json' }))).toBe(false);
  });

  it('fails for null/missing opts', () => {
    expect(isLarkRefreshSucceeded(undefined as never)).toBe(false);
  });
});

describe('buildLarkReportPayload', () => {
  it('uses only the backend-supported four-field snake_case wire payload', () => {
    const payload = buildLarkReportPayload(TEST_CRED);
    expect(payload).toEqual({
      app_id: TEST_CRED.appId,
      app_secret: TEST_CRED.appSecret,
      access_token: TEST_CRED.accessToken,
      refresh_token: TEST_CRED.refreshToken,
    });
  });
});

describe('lark-cli batch reporting', () => {
  const batchCred = (index: number): LarkCredentials => ({
    ...TEST_CRED,
    appId: `cli_batch_${index}`,
    appSecret: `secret-${'a'.repeat(40)}-${index}`,
    accessToken: `access-${'a'.repeat(40)}-${index}`,
    refreshToken: `refresh-${'a'.repeat(40)}-${index}`,
    userOpenId: `ou_batch_${index}`,
  });

  const batchLookup = (credentials: LarkCredentials[]): GetLarkCredentialsAllResult => ({
    ok: true,
    credentials,
    skipped: [],
  });

  it('builds one unique wire item per personal authorization', () => {
    const payload = buildLarkBatchPayload([batchCred(1), batchCred(2), batchCred(3), batchCred(1)]);

    expect(payload.items).toHaveLength(3);
    expect(payload.items.map((item) => item.client_item_id)).toEqual([
      'cli_batch_1:ou_batch_1',
      'cli_batch_2:ou_batch_2',
      'cli_batch_3:ou_batch_3',
    ]);
    expect(payload.items[0]).toEqual({
      client_item_id: 'cli_batch_1:ou_batch_1',
      app_id: 'cli_batch_1',
      app_secret: batchCred(1).appSecret,
      access_token: batchCred(1).accessToken,
      refresh_token: batchCred(1).refreshToken,
    });
    expect(
      payload.items.every((item) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(item.client_item_id))
    ).toBe(true);
  });

  it('prevalidates batch items so one incomplete credential cannot reject the whole atomic request', () => {
    expect(meetsBatchFieldConstraints(batchCred(1))).toBe(true);
    expect(meetsBatchFieldConstraints({ ...batchCred(1), appId: 'not-cli' })).toBe(false);
    expect(meetsBatchFieldConstraints({ ...batchCred(1), appSecret: 'short' })).toBe(false);
    expect(meetsBatchFieldConstraints({ ...batchCred(1), accessToken: 'short' })).toBe(false);
    expect(meetsBatchFieldConstraints({ ...batchCred(1), refreshToken: 'short' })).toBe(false);
  });

  it('keeps an API-valid stable client item id when a profile identity exceeds 64 characters', () => {
    const long = {
      ...batchCred(1),
      appId: `cli_${'a'.repeat(150)}`,
      userOpenId: `ou_${'b'.repeat(80)}`,
    };
    const first = buildLarkBatchPayload([long]).items[0].client_item_id;
    const second = buildLarkBatchPayload([long]).items[0].client_item_id;

    expect(first).toBe(second);
    expect(first).toHaveLength(64);
    expect(first).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/);
  });

  it('splits more than 20 eligible profiles into API-valid atomic batches', async () => {
    const { fn: fetchImpl, calls } = makeFetchMock(200, '{}');
    const credentials = Array.from({ length: 21 }, (_, index) => batchCred(index + 1));
    const result = await reportLarkCredentialsBatchOnce({
      hermitHome: '/tmp/hermit-lark',
      resolveAuthedContext: async () => ({ baseUrl: 'http://monitor.test', token: 't' }),
      __lookupAllForTests: () => batchLookup(credentials),
      fetchImpl,
    });

    expect(result).toMatchObject({ ok: true, accountCount: 21 });
    expect(calls).toHaveLength(2);
    expect(calls.map((call) => JSON.parse(String(call.init.body)).items.length)).toEqual([20, 1]);
  });

  it('stops after a later batch fails without retransmitting earlier batches', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const status = calls.length === 2 ? 503 : 200;
      return new Response('{}', { status });
    }) as unknown as typeof fetch;
    const credentials = Array.from({ length: 41 }, (_, index) => batchCred(index + 1));

    const result = await reportLarkCredentialsBatchOnce({
      hermitHome: '/tmp/hermit-lark',
      resolveAuthedContext: async () => ({ baseUrl: 'http://monitor.test', token: 't' }),
      __lookupAllForTests: () => batchLookup(credentials),
      fetchImpl,
    });

    expect(result).toMatchObject({ ok: false, reason: 'http-error', lastHttpStatus: 503 });
    expect(calls.map((call) => JSON.parse(String(call.init.body)).items.length)).toEqual([20, 20]);
  });

  it('POSTs every eligible personal authorization to the atomic batch endpoint', async () => {
    const { fn: fetchImpl, calls } = makeFetchMock(200, '{"ok":true}');
    const credentials = [batchCred(1), batchCred(2), batchCred(3)];
    const result = await reportLarkCredentialsBatchOnce({
      hermitHome: '/tmp/hermit-lark',
      resolveAuthedContext: async () => ({ baseUrl: 'http://monitor.test', token: 'test-token-1' }),
      __lookupAllForTests: () => batchLookup(credentials),
      fetchImpl,
    });

    expect(result).toMatchObject({ ok: true, accountCount: 3 });
    expect(result.accounts).toHaveLength(3);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://monitor.test/api/v1/feishu/lark-cli/credentials/batch');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init.body))).toEqual(buildLarkBatchPayload(credentials));
  });

  it('filters invalid profiles before POST and does not send an empty batch', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const resolver = vi.fn();
    const result = await reportLarkCredentialsBatchOnce({
      hermitHome: '/tmp/hermit-lark',
      resolveAuthedContext: resolver,
      __lookupAllForTests: () => batchLookup([{ ...batchCred(1), accessToken: 'short' }]),
      fetchImpl,
    });

    expect(result).toMatchObject({ ok: false, reason: 'no-credentials', accountCount: 0 });
    expect(resolver).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps valid profiles when another profile is invalid', async () => {
    const { fn: fetchImpl, calls } = makeFetchMock(200, '{}');
    const result = await reportLarkCredentialsBatchOnce({
      hermitHome: '/tmp/hermit-lark',
      resolveAuthedContext: async () => ({ baseUrl: 'http://monitor.test', token: 't' }),
      __lookupAllForTests: () =>
        batchLookup([batchCred(1), { ...batchCred(2), refreshToken: 'short' }]),
      fetchImpl,
    });

    expect(result).toMatchObject({ ok: true, accountCount: 1 });
    expect(JSON.parse(String(calls[0].init.body)).items).toHaveLength(1);
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

  it('returns refresh-failed and makes no request when local refresh did not complete', async () => {
    const resolver = vi.fn();
    const fetchImpl = vi.fn();
    const onPayload = vi.fn();
    const result = await reportLarkCredentialsOnce({
      hermitHome: '/tmp/hermit-lark',
      resolveAuthedContext: resolver,
      __lookupForTests: () => TEST_LOOKUP_REFRESH_FAILED,
      fetchImpl,
      onPayload,
    });

    expect(result).toMatchObject({ ok: false, enabled: true, reason: 'refresh-failed' });
    expect(resolver).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onPayload).not.toHaveBeenCalled();
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

  it('PUTs the canonical snake_case payload to /api/v1/feishu/lark-cli/credentials on success', async () => {
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
    expect(calls[0].url).toBe('http://monitor.test/api/v1/feishu/lark-cli/credentials');
    expect(calls[0].init.method).toBe('PUT');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token-1');
    expect(headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(body).toEqual({
      app_id: TEST_CRED.appId,
      app_secret: TEST_CRED.appSecret,
      access_token: TEST_CRED.accessToken,
      refresh_token: TEST_CRED.refreshToken,
    });
  });

  it('honors a custom endpoint path (test/staging)', async () => {
    const { fn: fetchImpl, calls } = makeFetchMock(200, '{}');
    await reportLarkCredentialsOnce({
      hermitHome: '/tmp/hermit-lark',
      endpointPath: '/api/v1/feishu/lark-cli/credentials/staging',
      resolveAuthedContext: async () => ({
        baseUrl: 'http://monitor.test',
        token: 't',
      }),
      __lookupForTests: () => TEST_LOOKUP_OK,
      fetchImpl,
    });
    expect(calls[0].url).toBe('http://monitor.test/api/v1/feishu/lark-cli/credentials/staging');
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

  it('redacts reflected credentials from non-2xx response bodies', async () => {
    const reflectedSecret = 'reflected-secret-should-not-persist';
    const { fn: fetchImpl } = makeFetchMock(
      400,
      JSON.stringify({ app_secret: reflectedSecret, access_token: reflectedSecret })
    );
    const result = await reportLarkCredentialsOnce({
      hermitHome: '/tmp/hermit-lark',
      resolveAuthedContext: async () => ({ baseUrl: 'http://monitor.test', token: 't' }),
      __lookupForTests: () => TEST_LOOKUP_OK,
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    expect(result.message).not.toContain(reflectedSecret);
    expect(result.message).toContain('[hidden]');
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

  it('invokes onPayload observer before PUT (worker can introspect wire content)', async () => {
    const { fn: fetchImpl } = makeFetchMock(200, '{}');
    const seen: string[] = [];
    await reportLarkCredentialsOnce({
      hermitHome: '/tmp/hermit-lark',
      resolveAuthedContext: async () => ({ baseUrl: 'http://monitor.test', token: 't' }),
      __lookupForTests: () => TEST_LOOKUP_OK,
      fetchImpl,
      onPayload: (p) => seen.push(p.app_id),
    });
    expect(seen).toEqual([TEST_CRED.appId]);
  });
});

describe('lark-cli store crypto layer (mirrors bin/lib/larkSecrets.mjs)', () => {
  // These tests lock the decode / decrypt / discovery invariants that previously
  // drifted from the canonical CLI. The macOS Keychain + Windows DPAPI backends
  // can't run on CI, but the math underneath them can — and these are the exact
  // spots that drifted (single vs double base64, master_key vs master.key,
  // filename-split vs decrypt-and-parse).

  function doubleEncode(buf: Buffer): string {
    // Inverse of decodeMasterKey: raw bytes → inner base64 string → outer base64.
    return Buffer.from(buf.toString('base64'), 'utf8').toString('base64');
  }

  function seal(plain: string, key: Buffer): Buffer {
    // lark-cli .enc layout: iv(12) || aes-256-gcm ciphertext || tag(16).
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, ct, tag]);
  }

  it('decodeMasterKey unwraps base64(base64(key)) and the go-keyring prefix, rejects wrong length', () => {
    const raw = randomBytes(32);
    const dbl = doubleEncode(raw);
    expect(__internals.decodeMasterKey(dbl)?.equals(raw)).toBe(true);
    expect(__internals.decodeMasterKey(`go-keyring-base64:${dbl}`)?.equals(raw)).toBe(true);
    // A SINGLE base64 pass (the old drift) decodes to wrong-length bytes → null.
    expect(__internals.decodeMasterKey(raw.toString('base64'))).toBeNull();
    // Not 32 bytes → null.
    expect(__internals.decodeMasterKey(doubleEncode(randomBytes(16)))).toBeNull();
  });

  it('decryptAesGcm round-trips the iv||ct||tag layout lark-cli writes', () => {
    const key = randomBytes(32);
    const plain = 'hello lark-cli';
    expect(__internals.decryptAesGcm(seal(plain, key), key)).toBe(plain);
    // Tampered / truncated blob → null, never throws.
    expect(__internals.decryptAesGcm(randomBytes(5), key)).toBeNull();
  });

  it('discoverProfilesMacCore reads ids from DECRYPTED content, not the (mangled) filename', async () => {
    // Reproduces the original bug: the account key `<appId>:<userOpenId>` is
    // safeFileName'd to `<appId>_<userOpenId>.enc` (':' → '_'), so splitting the
    // filename on ':' can never recover the ids. Discovery must decrypt + parse.
    const dir = await mkdtemp(path.join(os.tmpdir(), 'lark-store-'));
    try {
      const key = randomBytes(32);
      const appId = 'cli_test_app';
      const userOpenId = 'ou_test_user';

      const tokenJson = JSON.stringify({
        appId,
        userOpenId,
        accessToken: 'at-1',
        refreshToken: 'rt-1',
        expiresAt: 1_900_000_000_000,
        refreshExpiresAt: 1_900_000_000_000,
        scope: 'contact:user.base:readonly',
      });
      await writeFile(
        path.join(dir, __internals.safeFileName(`${appId}:${userOpenId}`)),
        seal(tokenJson, key)
      );
      // appsecret file: plaintext is a bare secret, NOT StoredUAToken JSON → excluded.
      await writeFile(
        path.join(dir, __internals.safeFileName(`appsecret:${appId}`)),
        seal('topsecret', key)
      );

      const profiles = __internals.discoverProfilesMacCore({ dir, key });
      expect(profiles).toEqual([{ appId, userOpenId }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('discoverProfilesMacCore returns [] when the key is null (Keychain unreadable)', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'lark-store-'));
    try {
      expect(__internals.discoverProfilesMacCore({ dir, key: null })).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
