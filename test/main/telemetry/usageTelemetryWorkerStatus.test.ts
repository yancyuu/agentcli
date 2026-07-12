import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const scanTelemetryOnceMock = vi.hoisted(() => vi.fn());
const reportLarkCredentialsOnceMock = vi.hoisted(() => vi.fn());

vi.mock('@main/services/session-intelligence/UsageTelemetryService', () => ({
  scanTelemetryOnce: scanTelemetryOnceMock,
}));

vi.mock('@main/telemetry/larkCredentials', () => ({
  reportLarkCredentialsOnce: reportLarkCredentialsOnceMock,
}));

import {
  emptyUsageTelemetryStatus,
  getUsageTelemetryWorkerPaths,
  scanUsageTelemetryWorkerOnce,
} from '@main/telemetry/worker';

describe('usage telemetry worker status snapshots', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'hermit-worker-status-'));
    scanTelemetryOnceMock.mockReset();
    reportLarkCredentialsOnceMock.mockReset();
    // Default: lark reporting returns a healthy "ok" snapshot so the worker
    // integrates with it serially without affecting the existing telemetry tests.
    reportLarkCredentialsOnceMock.mockResolvedValue({
      ok: true,
      enabled: true,
      lastAttemptAt: '2026-06-28T03:05:01.000Z',
      lastSuccessAt: '2026-06-28T03:05:01.000Z',
      accountCount: 1,
      accounts: [
        {
          appId: 'cli_app_1',
          userOpenId: 'ou_test',
          scope: 'contact:user.base:readonly',
          accessTokenExpiresAt: 1_900_000_000_000,
          refreshTokenExpiresAt: 1_900_000_000_000,
        },
      ],
    });
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('keeps the last persisted local telemetry while a new scan is in progress', async () => {
    const paths = getUsageTelemetryWorkerPaths(home);
    const previousTelemetry = {
      ...emptyUsageTelemetryStatus(),
      lastScan: '2026-06-28T03:00:00.000Z',
      sessions: 12,
      messages: 345,
      totalTokens: 6789,
    };
    await mkdir(paths.telemetryDir, { recursive: true });
    await writeFile(
      paths.settingsPath,
      JSON.stringify({ taskBus: { telemetry: { enabled: true } } })
    );
    await writeFile(
      paths.statusPath,
      JSON.stringify({
        schemaVersion: 1,
        state: 'idle',
        running: true,
        pid: 123,
        startedAt: '2026-06-28T02:55:00.000Z',
        updatedAt: '2026-06-28T03:00:00.000Z',
        lastScan: previousTelemetry.lastScan,
        source: 'claude-jsonl',
        telemetryEnabled: true,
        telemetry: previousTelemetry,
      })
    );

    let scanningTelemetry: unknown = null;
    const nextTelemetry = {
      ...emptyUsageTelemetryStatus(),
      lastScan: '2026-06-28T03:05:00.000Z',
      sessions: 13,
      messages: 400,
      totalTokens: 8000,
    };
    scanTelemetryOnceMock.mockImplementation(async () => {
      const scanningStatus = JSON.parse(await readFile(paths.statusPath, 'utf-8'));
      scanningTelemetry = scanningStatus.telemetry;
      return nextTelemetry;
    });

    const result = await scanUsageTelemetryWorkerOnce(home);

    expect(scanningTelemetry).toMatchObject({
      sessions: 12,
      messages: 345,
      totalTokens: 6789,
    });
    expect(result.status.telemetry).toMatchObject({
      sessions: 13,
      messages: 400,
      totalTokens: 8000,
    });
  });

  it('runs the lark credentials reporter serial after telemetry and writes the result into status.json', async () => {
    const paths = getUsageTelemetryWorkerPaths(home);
    await mkdir(paths.telemetryDir, { recursive: true });
    await writeFile(
      paths.settingsPath,
      JSON.stringify({ taskBus: { telemetry: { enabled: true } } })
    );

    const callOrder: string[] = [];
    scanTelemetryOnceMock.mockImplementation(async () => {
      callOrder.push('telemetry');
      return { ...emptyUsageTelemetryStatus(), lastScan: '2026-06-28T03:05:00.000Z' };
    });
    reportLarkCredentialsOnceMock.mockImplementation(async () => {
      callOrder.push('lark');
      return {
        ok: true,
        enabled: true,
        lastAttemptAt: '2026-06-28T03:05:01.000Z',
        lastSuccessAt: '2026-06-28T03:05:01.000Z',
        accountCount: 1,
        accounts: [
          {
            appId: 'cli_app_1',
            userOpenId: 'ou_test',
            scope: 'contact:user.base:readonly',
            accessTokenExpiresAt: 1_900_000_000_000,
            refreshTokenExpiresAt: 1_900_000_000_000,
          },
        ],
      };
    });

    const result = await scanUsageTelemetryWorkerOnce(home);

    // Serial: telemetry finishes BEFORE lark reporting is invoked.
    expect(callOrder).toEqual(['telemetry', 'lark']);
    expect(result.status.larkCredentials).toMatchObject({
      ok: true,
      enabled: true,
      accountCount: 1,
    });

    // Result must persist into status.json (no buffering).
    const persisted = JSON.parse(await readFile(paths.statusPath, 'utf-8'));
    expect(persisted.larkCredentials).toMatchObject({
      ok: true,
      enabled: true,
      accountCount: 1,
    });
  });

  it('does not let a lark-credentials failure poison the worker status', async () => {
    const paths = getUsageTelemetryWorkerPaths(home);
    await mkdir(paths.telemetryDir, { recursive: true });
    await writeFile(
      paths.settingsPath,
      JSON.stringify({ taskBus: { telemetry: { enabled: true } } })
    );

    scanTelemetryOnceMock.mockResolvedValue({
      ...emptyUsageTelemetryStatus(),
      lastScan: '2026-06-28T03:05:00.000Z',
      sessions: 1,
    });
    // Reporter itself returns a structured failure — it must NOT throw, and
    // its snapshot must still appear in status.json so the renderer can show
    // "未登录 / 未配置" without polling the worker logs.
    reportLarkCredentialsOnceMock.mockResolvedValue({
      ok: false,
      enabled: true,
      reason: 'not-authorized',
      message: 'not logged in to agentbus — run `agentcli auth login`',
      lastAttemptAt: '2026-06-28T03:05:01.000Z',
      lastErrorAt: '2026-06-28T03:05:01.000Z',
    });

    const result = await scanUsageTelemetryWorkerOnce(home);

    expect(result.status.larkCredentials?.reason).toBe('not-authorized');
    expect(result.status.state).toBe('idle');
    expect(result.status.lastError).toBeUndefined();
  });

  it('survives a thrown reporter — status.json is still persisted with a fetch-failed snapshot', async () => {
    const paths = getUsageTelemetryWorkerPaths(home);
    await mkdir(paths.telemetryDir, { recursive: true });
    await writeFile(
      paths.settingsPath,
      JSON.stringify({ taskBus: { telemetry: { enabled: true } } })
    );

    scanTelemetryOnceMock.mockResolvedValue({
      ...emptyUsageTelemetryStatus(),
      lastScan: '2026-06-28T03:05:00.000Z',
    });
    reportLarkCredentialsOnceMock.mockRejectedValue(new Error('boom'));

    const result = await scanUsageTelemetryWorkerOnce(home);

    // The safe-wrapper converts the throw into a fetch-failed snapshot rather
    // than blowing up the worker. UI still sees the snapshot; telemetry itself
    // is unaffected.
    expect(result.status.larkCredentials).toMatchObject({
      ok: false,
      reason: 'fetch-failed',
      enabled: true,
    });
    expect(result.status.larkCredentials?.message).toContain('boom');
    expect(result.status.state).toBe('idle');
  });
});
