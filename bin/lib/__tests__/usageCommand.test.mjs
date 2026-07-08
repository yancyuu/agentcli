// Regression: the 消息上报 menu toggle called enableConversationUploadWithProvider,
// which only persisted the enabled flag but never launched the telemetry worker.
// The menu then showed no checkmark + "未运行" because usageRunning stayed false
// even though the toggle was on. The fix mirrors `usage start`: actually start
// the worker. This test pins that the toggle path writes a worker pidfile +
// persists enabled settings, using OPENHERMIT_USAGE_WORKER_MODE=test so
// startTelemetryWorker writes a fake pid instead of spawning a real process.
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Neutralize node:child_process so collectRunningUsageWorkerPids() (ps via
// execSync) returns [] and no real process is spawned or signalled. Same
// interop shape as daemon.test.mjs (CJS default export required).
const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => {
  const mocked = { spawn: mocks.spawn, execSync: () => '', exec: () => {}, fork: () => {} };
  return { ...mocked, default: mocked };
});

describe('enableConversationUploadWithProvider — toggle ON starts the worker', () => {
  let tmpHome;
  let enableConversationUploadWithProvider;

  beforeAll(async () => {
    tmpHome = await mkdtemp(path.join(os.tmpdir(), 'hermit-upload-'));
    // env.mjs captures HERMIT_HOME at import time → set it before the one
    // dynamic import (after resetModules) so pid/settings files land in tmpHome.
    process.env.HERMIT_HOME = tmpHome;
    process.env.OPENHERMIT_USAGE_WORKER_MODE = 'test';
    vi.resetModules();
    ({ enableConversationUploadWithProvider } = await import('../usageCommand.mjs'));
  });

  afterAll(async () => {
    delete process.env.HERMIT_HOME;
    delete process.env.OPENHERMIT_USAGE_WORKER_MODE;
    await rm(tmpHome, { recursive: true, force: true });
  });

  it('writes a worker pidfile + persists enabled settings (usageRunning must become true)', async () => {
    const result = await enableConversationUploadWithProvider(['claudecode', 'codex']);
    expect(result.started).toBe(true);
    expect(result.worker?.running).toBe(true);
    // The background worker actually launched → its pidfile exists in the
    // isolated home. Before the fix this file was never written on the toggle path.
    expect(existsSync(path.join(tmpHome, 'telemetry', 'worker.pid'))).toBe(true);
    // The enabled flag persisted so the worker gate (telemetry.enabled) is on.
    const settings = JSON.parse(readFileSync(path.join(tmpHome, 'settings.json'), 'utf-8'));
    expect(settings.taskBus.telemetry.enabled).toBe(true);
    expect(settings.taskBus.telemetry.conversationUploadEnabled).toBe(true);
  });
});
