import { mkdtemp, rm } from 'node:fs/promises';
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
});
