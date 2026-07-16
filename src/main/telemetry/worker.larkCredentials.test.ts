import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  appendLarkCredentialsAuditLog,
  createInterruptibleWait,
  getLarkCredentialsWorkerPaths,
  runWorkerCycle,
  scanLarkCredentialsOnce,
} from './worker';

describe('Lark credential loop', () => {
  let hermitHome: string | undefined;

  afterEach(async () => {
    if (hermitHome) await rm(hermitHome, { recursive: true, force: true });
    hermitHome = undefined;
  });

  it('appends a redacted, non-sensitive audit entry', async () => {
    hermitHome = await mkdtemp(path.join(os.tmpdir(), 'hermit-lark-audit-'));
    await appendLarkCredentialsAuditLog(hermitHome, {
      ok: false,
      enabled: true,
      reason: 'http-error',
      message: 'Bearer never-write-this secret=also-never-write-this',
      lastAttemptAt: '2026-07-15T00:00:00.000Z',
      lastErrorAt: '2026-07-15T00:00:00.000Z',
      lastHttpStatus: 503,
      accountCount: 1,
      accounts: [
        {
          appId: 'cli_app',
          userOpenId: 'ou_safe_identity',
          scope: 'contact:user.base:readonly',
          accessTokenExpiresAt: 1,
          refreshTokenExpiresAt: 2,
        },
      ],
    });

    const raw = await readFile(getLarkCredentialsWorkerPaths(hermitHome).auditLogPath, 'utf-8');
    expect(JSON.parse(raw)).toEqual({
      timestamp: '2026-07-15T00:00:00.000Z',
      ok: false,
      reason: 'http-error',
      httpStatus: 503,
      accountCount: 1,
      accounts: [
        {
          appId: 'cli_app',
          userOpenId: 'ou_safe_identity',
          scope: 'contact:user.base:readonly',
          accessTokenExpiresAt: 1,
          refreshTokenExpiresAt: 2,
        },
      ],
    });
    expect(raw).not.toContain('never-write-this');
    expect(raw).not.toContain('also-never-write-this');
  });
  it('starts Lark refresh and reporting even when usage reporting fails', async () => {
    let releaseLark: (() => void) | undefined;
    const lark = new Promise<void>((resolve) => {
      releaseLark = resolve;
    });
    const calls: string[] = [];
    const cycle = runWorkerCycle({
      scanUsage: async () => {
        calls.push('usage');
        throw new Error('usage upload unavailable');
      },
      scanLark: () => {
        calls.push('lark');
        return lark;
      },
    });

    expect(calls).toEqual(['usage', 'lark']);
    releaseLark?.();
    await expect(cycle).resolves.toEqual({ shouldContinue: true });
  });

  it('finishes a same-cycle Lark refresh before stopping for disabled usage', async () => {
    const calls: string[] = [];
    await expect(
      runWorkerCycle({
        scanUsage: async () => {
          calls.push('usage');
          return { shouldContinue: false };
        },
        scanLark: async () => {
          calls.push('lark');
        },
      })
    ).resolves.toEqual({ shouldContinue: false });
    expect(calls).toEqual(['usage', 'lark']);
  });

  it('interrupts the worker scheduler wait immediately', async () => {
    const wait = createInterruptibleWait();
    const completion = wait.wait(5 * 60 * 1000);
    wait.interrupt();
    await expect(completion).resolves.toBeUndefined();
  });

  it('continues credential reporting when status persistence is unavailable', async () => {
    hermitHome = await mkdtemp(path.join(os.tmpdir(), 'hermit-lark-readonly-'));
    await writeFile(path.join(hermitHome, 'lark-credentials'), 'not-a-directory');
    const previous = process.env.OPENHERMIT_CLOUD_UPLOAD_BASE_URL;
    process.env.OPENHERMIT_CLOUD_UPLOAD_BASE_URL = 'http://127.0.0.1:1';
    try {
      await expect(scanLarkCredentialsOnce(hermitHome)).resolves.toMatchObject({ ok: false });
    } finally {
      if (previous === undefined) delete process.env.OPENHERMIT_CLOUD_UPLOAD_BASE_URL;
      else process.env.OPENHERMIT_CLOUD_UPLOAD_BASE_URL = previous;
    }
  });

  it('writes an isolated, redacted Lark status when reporting cannot authenticate', async () => {
    hermitHome = await mkdtemp(path.join(os.tmpdir(), 'hermit-lark-worker-'));
    const previous = process.env.OPENHERMIT_CLOUD_UPLOAD_BASE_URL;
    process.env.OPENHERMIT_CLOUD_UPLOAD_BASE_URL = 'http://127.0.0.1:1';
    try {
      const status = await scanLarkCredentialsOnce(hermitHome);
      expect(status.ok).toBe(false);
      const raw = await readFile(getLarkCredentialsWorkerPaths(hermitHome).statusPath, 'utf-8');
      expect(JSON.parse(raw)).toMatchObject({ pid: process.pid, report: { ok: false } });
      expect(raw).not.toContain('Bearer ');
    } finally {
      if (previous === undefined) delete process.env.OPENHERMIT_CLOUD_UPLOAD_BASE_URL;
      else process.env.OPENHERMIT_CLOUD_UPLOAD_BASE_URL = previous;
    }
  });
});
