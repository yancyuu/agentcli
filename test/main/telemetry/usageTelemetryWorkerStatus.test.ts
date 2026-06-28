import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const scanTelemetryOnceMock = vi.hoisted(() => vi.fn());

vi.mock('@main/services/session-intelligence/UsageTelemetryService', () => ({
  scanTelemetryOnce: scanTelemetryOnceMock,
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
});
