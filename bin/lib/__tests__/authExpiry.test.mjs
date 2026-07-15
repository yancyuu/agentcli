import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

async function importAuthWithHome(home) {
  vi.resetModules();
  process.env.HERMIT_HOME = home;
  return import('../auth.mjs');
}

// Regression for the "明明已登录却显示未登录" bug: when the OAuth token exchange
// and /me both decline to send an access-token expiry, token.expiresAt stayed
// absent. isAuthTokenExpired() treats absent as expired, so authStatusFromStore
// computed authorized=false and the menu showed 未登录 — even though /me had just
// returned authenticated:true. /me is the source of truth; a live token must not
// be marked expired just because the server omitted expires_in.
describe('access-token expiry resolution', () => {
  const previousEnv = { ...process.env };
  let tmpHome;

  afterEach(async () => {
    process.env = { ...previousEnv };
    vi.resetModules();
    if (tmpHome) await rm(tmpHome, { recursive: true, force: true });
    tmpHome = null;
  });

  async function freshAuth() {
    tmpHome = await mkdtemp(path.join(os.tmpdir(), 'hermit-auth-exp-'));
    await mkdir(path.join(tmpHome, 'auth'), { recursive: true });
    return importAuthWithHome(tmpHome);
  }

  const config = { issuer: 'https://auth.example.test', clientId: 'openhermit-cli', scope: 'upload:read upload:write' };

  it('authorizes a live access token when the server omits expiry', async () => {
    const auth = await freshAuth();
    const store = auth.buildAuthStoreFromToken(
      config,
      { access_token: 'atk', refresh_token: 'rtk' }, // no expires_in / expires_at
      { id: 'u1', name: 'Tester' }
    );

    // Synthesized horizon — must be a real future date, not null/absent.
    expect(store.token.expiresAt).toBeTruthy();
    auth.writeOpenHermitAuthStore(store);

    const status = auth.readOpenHermitAuthStatus();
    expect(status.authorized).toBe(true);
    expect(status.expired).toBe(false);
    expect(status.method).toBe('oauth');
  });

  it('still honors an explicit expires_in from the token exchange', async () => {
    const auth = await freshAuth();
    const store = auth.buildAuthStoreFromToken(config, { access_token: 'atk', expires_in: 3600 }, null);

    auth.writeOpenHermitAuthStore(store);
    const status = auth.readOpenHermitAuthStatus();
    expect(status.authorized).toBe(true);

    // The real expiry (~1h) wins over the synthesized horizon (~5min).
    const msUntilExpiry = Date.parse(store.token.expiresAt) - Date.now();
    expect(msUntilExpiry).toBeGreaterThan(59 * 60 * 1000);
  });


  it('expires local auth when /me keeps returning access_expired after a refresh attempt', async () => {
    const auth = await freshAuth();
    const store = auth.buildAuthStoreFromToken(
      config,
      { access_token: 'atk-old', refresh_token: 'rtk' },
      { id: 'u1', name: 'Tester' }
    );
    auth.writeOpenHermitAuthStore(store);

    const originalFetch = globalThis.fetch;
    let meCalls = 0;
    globalThis.fetch = async (url) => {
      const href = String(url);
      if (href.endsWith('/api/v1/auth/token')) {
        return new Response('refresh failed', { status: 500 });
      }
      if (href.endsWith('/api/v1/auth/me')) {
        meCalls += 1;
        return Response.json({ authenticated: true, status: 'access_expired' });
      }
      throw new Error(`unexpected fetch ${url}`);
    };
    try {
      const status = await auth.refreshOpenHermitAuthStatus();
      expect(meCalls).toBe(2);
      expect(status.authorized).toBe(false);
      expect(status.expired).toBe(true);
      expect(auth.readOpenHermitAuthStatus().authorized).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not synthesize a horizon for payloads without an access token', async () => {
    const auth = await freshAuth();
    // No access token → normalizeAccessTokenPayload returns null (no store built).
    // Guard: the synthesis must never invent a token where none exists.
    expect(auth.normalizeAccessTokenPayload({ expires_in: 3600 })).toBeNull();
  });

  // Regression (observed live, 2026-07-08): the broker stops sending expires_in and
  // the stored refresh token is empty, so refreshExpiredOpenHermitToken is a no-op.
  // /me STILL returns authenticated:true (the server-side session is alive), but the
  // local expiresAt was a stale past timestamp → isAuthTokenExpired=true → the menu
  // and resolveAuthedServerContext reported 未登录, blocking token 池. A successful
  // /me must revive the token: a past existing expiry is replaced by a fresh horizon.
  it('a successful /me refresh revives a token whose stored expiry is in the past', async () => {
    const auth = await freshAuth();
    const store = auth.buildAuthStoreFromToken(
      config,
      { access_token: 'atk' }, // no refresh_token → renewal is impossible
      { id: 'u1', name: 'Tester' }
    );
    store.token.expiresAt = '2000-01-01T00:00:00.000Z'; // locally expired
    store.token.refreshToken = null;
    auth.writeOpenHermitAuthStore(store);

    expect(auth.readOpenHermitAuthStatus().authorized).toBe(false);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/api/v1/auth/me')) {
        return Response.json({ authenticated: true, status: 'ok' }); // server omits expires_in
      }
      throw new Error(`unexpected fetch ${url}`);
    };
    try {
      const status = await auth.refreshOpenHermitAuthStatus();
      expect(status.authorized).toBe(true);
      expect(status.expired).toBe(false);
      // And it persisted: a fresh read still sees a live (future) expiry.
      expect(auth.readOpenHermitAuthStatus().authorized).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// The broker only issues a refresh_token when the device-auth /start request
// identifies the client as a long-lived CLI (client_kind:"cli"). Without it the
// poll response omits refresh_token, the access token can't be refreshed, and the
// user must re-login daily. Lock the { client_kind: "cli" } body on /start.
describe('startDeviceAuthSession — client_kind:"cli" on /start', () => {
  const previousEnv = { ...process.env };
  let tmpHome;

  afterEach(async () => {
    process.env = { ...previousEnv };
    vi.resetModules();
    if (tmpHome) await rm(tmpHome, { recursive: true, force: true });
    tmpHome = null;
  });

  async function freshAuth() {
    tmpHome = await mkdtemp(path.join(os.tmpdir(), 'hermit-auth-start-'));
    await mkdir(path.join(tmpHome, 'auth'), { recursive: true });
    return importAuthWithHome(tmpHome);
  }

  it('sends { client_kind: "cli" } so the broker returns a refresh_token', async () => {
    const auth = await freshAuth();
    const originalFetch = globalThis.fetch;
    const captured = [];
    globalThis.fetch = async (url, opts) => {
      captured.push({ url: String(url), body: opts?.body ? JSON.parse(opts.body) : null });
      return Response.json({
        flow_id: 'flow-1',
        poll_secret: 'ps',
        authorization_url: 'https://auth.example.test/authorize',
        expires_in: 600,
        interval: 2,
      });
    };
    try {
      const config = {
        startUrl: 'https://auth.example.test/api/v1/auth/start',
        startFallbackUrl: 'https://auth.example.test/api/cli-auth/start',
      };
      const session = await auth.startDeviceAuthSession(config);
      expect(captured[0].url).toBe(config.startUrl);
      expect(captured[0].body).toEqual({ client_kind: 'cli' });
      expect(session.flowId).toBe('flow-1');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
