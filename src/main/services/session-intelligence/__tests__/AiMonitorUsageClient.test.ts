import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkEvents,
  fetchAuthoritativeUsage,
  fetchUploadsStatus,
  fetchUploadsSummary,
} from '../AiMonitorUsageClient';

describe('AiMonitorUsageClient', () => {
  let home: string;
  let fetchMock: ReturnType<typeof vi.fn>;
  const baseUrl = 'http://monitor.test';

  beforeEach(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'hermit-aimon-'));
    await mkdir(path.join(home, 'auth'), { recursive: true });
    await writeFile(
      path.join(home, 'auth', 'openhermit.json'),
      JSON.stringify({ token: { accessToken: 'tok', expiresAt: '2999-01-01T00:00:00.000Z' } })
    );
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await rm(home, { recursive: true, force: true });
  });

  // Records every fetch call AND returns the handler's response, so a test can
  // both assert request shape and supply a canned response.
  function captures(
    handler: () => Response = () => Response.json({})
  ): Array<{ url: string; init: RequestInit }> {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return handler();
    });
    return calls;
  }

  it('fetchAuthoritativeUsage GETs /hermit/usage with a Bearer header', async () => {
    const calls = captures(() =>
      Response.json({ totals: { tokens: 1000, messages: 20, batches: 4 } })
    );
    const usage = await fetchAuthoritativeUsage(home, baseUrl);
    expect(usage?.totals?.tokens).toBe(1000);
    expect(calls[0].url).toBe('http://monitor.test/api/v1/hermit/usage');
    expect(calls[0].init.method).toBeUndefined(); // GET
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
  });

  it('fetchUploadsStatus POSTs { uploadIds } to /hermit/uploads/status', async () => {
    const calls = captures(() =>
      Response.json({ items: [{ ok: true, uploadId: 'upl_1', status: 'success' }] })
    );
    const items = await fetchUploadsStatus(home, baseUrl, ['upl_1', 'upl_2']);
    expect(items).toHaveLength(1);
    expect(items[0].uploadId).toBe('upl_1');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].url).toBe('http://monitor.test/api/v1/hermit/uploads/status');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ uploadIds: ['upl_1', 'upl_2'] });
  });

  it('fetchUploadsStatus skips the request for an empty uploadIds list', async () => {
    const items = await fetchUploadsStatus(home, baseUrl, []);
    expect(items).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetchUploadsSummary GETs /hermit/uploads/summary', async () => {
    const calls = captures(() => Response.json({ batches: 4, accepted: 3900, duplicated: 900 }));
    const summary = await fetchUploadsSummary(home, baseUrl);
    expect(summary?.batches).toBe(4);
    expect(summary?.accepted).toBe(3900);
    expect(calls[0].url).toBe('http://monitor.test/api/v1/hermit/uploads/summary');
  });

  it('checkEvents POSTs { eventIds } to /hermit/events/check', async () => {
    const calls = captures(() =>
      Response.json({ items: [{ eventId: 'e1', known: true, status: 'processed' }] })
    );
    const items = await checkEvents(home, baseUrl, ['e1']);
    expect(items[0].known).toBe(true);
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].url).toBe('http://monitor.test/api/v1/hermit/events/check');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ eventIds: ['e1'] });
  });

  it('checkEvents skips the request for an empty eventIds list', async () => {
    const items = await checkEvents(home, baseUrl, []);
    expect(items).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('degrades gracefully on 404/422 (no throw, null/empty)', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'nope' }, { status: 404 }));
    await expect(fetchAuthoritativeUsage(home, baseUrl)).resolves.toBeNull();
    await expect(fetchUploadsSummary(home, baseUrl)).resolves.toBeNull();
    fetchMock.mockResolvedValue(Response.json({ error: 'bad' }, { status: 422 }));
    await expect(fetchUploadsStatus(home, baseUrl, ['x'])).resolves.toEqual([]);
    await expect(checkEvents(home, baseUrl, ['x'])).resolves.toEqual([]);
  });
});
