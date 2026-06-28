import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  formatUploadProviders,
  normalizeUploadProviders,
  uploadProviderLabel,
} from '../usageRemote.mjs';

describe('usageRemote provider helpers', () => {
  it('normalizeUploadProviders parses, dedups, and filters to known providers', () => {
    expect(normalizeUploadProviders('claudecode')).toEqual(['claudecode']);
    expect(normalizeUploadProviders('claudecode,codex')).toEqual(['claudecode', 'codex']);
    expect(normalizeUploadProviders(['claudecode', 'claudecode'])).toEqual(['claudecode']);
    expect(normalizeUploadProviders('codex+claudecode')).toEqual(['codex', 'claudecode']);
    expect(normalizeUploadProviders('invalid,claudecode')).toEqual(['claudecode']);
    expect(normalizeUploadProviders('')).toEqual([]);
    expect(normalizeUploadProviders(null)).toEqual([]);
  });

  it('uploadProviderLabel maps known ids and passes unknown through', () => {
    expect(uploadProviderLabel('claudecode')).toBe('Claude Code');
    expect(uploadProviderLabel('codex')).toBe('Codex');
    expect(uploadProviderLabel('mystery')).toBe('mystery');
  });

  it('formatUploadProviders joins labels or reports 未选择', () => {
    expect(formatUploadProviders(['claudecode', 'codex'])).toBe('Claude Code + Codex');
    expect(formatUploadProviders('claudecode')).toBe('Claude Code');
    expect(formatUploadProviders([])).toBe('未选择');
  });
});

describe('usageRemote fetch short-circuits when unauthenticated', () => {
  let tmpHome;
  let fetchMock;

  beforeAll(async () => {
    tmpHome = await mkdtemp(path.join(os.tmpdir(), 'hermit-usage-remote-'));
    process.env.HERMIT_HOME = tmpHome;
    vi.resetModules();
  });

  afterAll(async () => {
    delete process.env.HERMIT_HOME;
    delete process.env.OPENHERMIT_CONVERSATION_UPLOAD_BASE_URL;
    await rm(tmpHome, { recursive: true, force: true });
  });

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('fetchRemoteUsageStatus returns 等待登录 without calling the server', async () => {
    const { fetchRemoteUsageStatus } = await import('../usageRemote.mjs');
    const result = await fetchRemoteUsageStatus(['claudecode']);
    expect(result.authorized).toBe(false);
    expect(result.channels).toEqual([]);
    expect(result.errors?.[0]?.error).toBe('等待登录');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetchAuthoritativeUsage returns ok:false without calling the server', async () => {
    const { fetchAuthoritativeUsage } = await import('../usageRemote.mjs');
    const result = await fetchAuthoritativeUsage();
    expect(result?.ok).toBe(false);
    expect(result?.error).toBe('等待登录');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetchRemoteUsageStatus reads /report/usage/status with client+scene filters', async () => {
    await mkdir(path.join(tmpHome, 'auth'), { recursive: true });
    await writeFile(
      path.join(tmpHome, 'auth', 'openhermit.json'),
      JSON.stringify({ token: { accessToken: 'tok', expiresAt: '2999-01-01T00:00:00.000Z' } })
    );
    process.env.OPENHERMIT_CONVERSATION_UPLOAD_BASE_URL = 'http://monitor.test';
    vi.resetModules();
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.endsWith('/api/v1/auth/me')) {
        return Response.json({ authenticated: true, status: 'ok', feishu_authorized: true });
      }
      if (u.includes('/api/v1/report/usage/status')) {
        const parsed = new URL(u);
        const client = parsed.searchParams.get('client');
        const scene = parsed.searchParams.get('scene');
        return Response.json({
          checkedAt: '2026-06-28T00:00:00.000Z',
          channels: [
            {
              reporter: 'openhermit',
              client,
              scene,
              status: 'success',
              inFlight: { count: 0, uploadIds: [] },
              currentCursor: { targetCursorHash: `${client}-${scene}`, messageCount: 3, fileCount: 1 },
            },
          ],
        });
      }
      throw new Error(`unexpected fetch ${u}`);
    });

    const { fetchRemoteUsageStatus } = await import('../usageRemote.mjs');
    const result = await fetchRemoteUsageStatus(['claudecode']);

    expect(result.errors).toEqual([]);
    expect(result.channels).toHaveLength(2);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(
      'http://monitor.test/api/v1/report/usage/status?client=claudecode&scene=coding'
    );
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(
      'http://monitor.test/api/v1/report/usage/status?client=claudecode&scene=digital_employee'
    );
    expect(result.channels.map((c) => c.cursorHash)).toEqual([
      'claudecode-coding',
      'claudecode-digital_employee',
    ]);
  });
});
