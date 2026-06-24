import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  authedFetch,
  getValidBearerToken,
  probeAuth,
  readAuthStore,
  refreshAccessToken,
} from '../OpenHermitAuthClient';

describe('OpenHermitAuthClient', () => {
  let home: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'hermit-auth-'));
    await mkdir(path.join(home, 'auth'), { recursive: true });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await rm(home, { recursive: true, force: true });
  });

  async function writeStore(store: Record<string, unknown>): Promise<void> {
    await writeFile(path.join(home, 'auth', 'openhermit.json'), JSON.stringify(store));
  }

  function jsonResponse(body: unknown, status = 200): Response {
    return Response.json(body, { status });
  }

  it('returns a non-expired token without refreshing', async () => {
    await writeStore({
      token: { accessToken: 'live', expiresAt: '2999-01-01T00:00:00.000Z', refreshToken: 'r' },
      issuer: 'http://broker.test',
    });
    const token = await getValidBearerToken(home, 'http://upload.test');
    expect(token).toBe('live');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes when the token is locally expired and persists the new token', async () => {
    await writeStore({
      token: { accessToken: 'old', expiresAt: '2000-01-01T00:00:00.000Z', refreshToken: 'r' },
      issuer: 'http://broker.test',
    });
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/api/v1/auth/hermit/refresh')) {
        return jsonResponse({
          access_token: 'new',
          access_expires_in: 3600,
          token_type: 'Bearer',
          scope: 'upload:read upload:write',
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    const token = await getValidBearerToken(home, 'http://upload.test');
    expect(token).toBe('new');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const persisted = await readAuthStore(home);
    expect(persisted?.token?.accessToken).toBe('new');
    expect(Date.parse(persisted?.token?.expiresAt ?? '')).toBeGreaterThan(Date.now());
  });

  it('posts refresh_token to the issuer broker base and merges the patch', async () => {
    await writeStore({
      token: { accessToken: 'old', refreshToken: 'rt', expiresAt: '2000-01-01T00:00:00.000Z' },
      issuer: 'http://broker.test',
    });
    let postedBody: unknown = null;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url) === 'http://broker.test/api/v1/auth/hermit/refresh') {
        postedBody = JSON.parse(String(init?.body));
        return jsonResponse({ access_token: 'new', refresh_token: 'rt2', access_expires_in: 7200 });
      }
      throw new Error(`unexpected ${url}`);
    });
    const store = await refreshAccessToken(home, 'http://upload.test');
    expect(store?.token?.accessToken).toBe('new');
    expect(store?.token?.refreshToken).toBe('rt2');
    expect(postedBody).toEqual({ refresh_token: 'rt' });
  });

  it('is a no-op without a refreshToken', async () => {
    await writeStore({
      token: { accessToken: 'old', expiresAt: '2999-01-01T00:00:00.000Z' },
      issuer: 'http://broker.test',
    });
    const store = await refreshAccessToken(home, 'http://upload.test');
    expect(store?.token?.accessToken).toBe('old');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('degrades gracefully (keeps old token) when the broker rejects the refresh', async () => {
    await writeStore({
      token: { accessToken: 'old', refreshToken: 'rt', expiresAt: '2000-01-01T00:00:00.000Z' },
      issuer: 'http://broker.test',
    });
    fetchMock.mockResolvedValue(jsonResponse({ error: 'invalid_grant' }, 401));
    const store = await refreshAccessToken(home, 'http://upload.test');
    expect(store?.token?.accessToken).toBe('old');
  });

  it('probeAuth reports ok with upload scopes', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ authenticated: true, status: 'ok', scopes: ['upload:read', 'upload:write'] })
    );
    const result = await probeAuth('http://upload.test', 'tok');
    expect(result.ok).toBe(true);
    expect(result.scopes).toEqual(['upload:read', 'upload:write']);
  });

  it('probeAuth flags missing upload scopes', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ authenticated: true, status: 'ok', scopes: ['upload:read'] })
    );
    const result = await probeAuth('http://upload.test', 'tok');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('upload:write');
  });

  it('authedFetch returns the response on success without refreshing', async () => {
    await writeStore({
      token: { accessToken: 'tok', refreshToken: 'r', expiresAt: '2999-01-01T00:00:00.000Z' },
      issuer: 'http://broker.test',
    });
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }, 200));
    const res = await authedFetch(home, 'http://upload.test', 'http://upload.test/x', {
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('authedFetch refreshes once and retries on 401', async () => {
    await writeStore({
      token: { accessToken: 'tok', refreshToken: 'r', expiresAt: '2999-01-01T00:00:00.000Z' },
      issuer: 'http://broker.test',
    });
    let dataCalls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/api/v1/auth/hermit/refresh')) {
        return jsonResponse({ access_token: 'tok2', access_expires_in: 3600 });
      }
      dataCalls += 1;
      return dataCalls === 1 ? jsonResponse({}, 401) : jsonResponse({ ok: true }, 200);
    });
    const res = await authedFetch(home, 'http://upload.test', 'http://upload.test/x', {
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(200);
    // 1 initial 401 + 1 refresh + 1 retry = 3 fetches, single retry.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('authedFetch does not loop: at most one retry even if the broker keeps rejecting', async () => {
    await writeStore({
      token: { accessToken: 'tok', refreshToken: 'r', expiresAt: '2999-01-01T00:00:00.000Z' },
      issuer: 'http://broker.test',
    });
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/api/v1/auth/hermit/refresh')) {
        return jsonResponse({ access_token: 'tok2', access_expires_in: 3600 });
      }
      return jsonResponse({}, 401);
    });
    const res = await authedFetch(home, 'http://upload.test', 'http://upload.test/x', {
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('authedFetch does not retry when there is no usable token after refresh', async () => {
    // Store has a refreshToken but no access token; refresh fails -> still no
    // access token -> return the original 401 without a retry fetch.
    await writeStore({
      token: { refreshToken: 'r', expiresAt: '2000-01-01T00:00:00.000Z' },
      issuer: 'http://broker.test',
    });
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/api/v1/auth/hermit/refresh')) {
        return jsonResponse({ error: 'invalid_grant' }, 401);
      }
      return jsonResponse({}, 401);
    });
    const res = await authedFetch(home, 'http://upload.test', 'http://upload.test/x', {
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(401);
    // 1 initial 401 + 1 refresh (which returned no token) = 2; no retry fetch.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
