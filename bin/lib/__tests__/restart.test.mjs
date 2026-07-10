// restart.test.mjs — pins `agentcli restart` orchestration.
//
// restart must cycle BOTH long-running layers so every process comes back on
// current code (the whole point after `agentcli update`): usage worker, then the
// web daemon (which re-spawns hermit-bridge + cc-connect children). The order is
// load-bearing, and so is the childArgs guard — startDaemon otherwise defaults
// to process.argv.slice(2) ('restart') and the spawned child re-enters this
// command forever.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  stopDaemon: vi.fn(),
  startDaemon: vi.fn(),
  stopTelemetryWorker: vi.fn(),
  startTelemetryWorker: vi.fn(),
}));

// Mock the two lifecycle modules restart.mjs orchestrates. Factories return only
// the named exports restart.mjs uses; transitive imports never run.
vi.mock('../daemon.mjs', () => ({
  stopDaemon: mocks.stopDaemon,
  startDaemon: mocks.startDaemon,
}));
vi.mock('../usageCommand.mjs', () => ({
  stopTelemetryWorker: mocks.stopTelemetryWorker,
  startTelemetryWorker: mocks.startTelemetryWorker,
}));

describe('runRestart — cycles both layers on fresh code, in order', () => {
  let runRestart;

  beforeAll(async () => {
    ({ runRestart } = await import('../restart.mjs'));
  });

  beforeEach(() => {
    mocks.stopDaemon.mockReset();
    mocks.startDaemon.mockReset();
    mocks.stopTelemetryWorker.mockReset();
    mocks.startTelemetryWorker.mockReset();
    mocks.stopTelemetryWorker.mockResolvedValue({ stopped: true, pid: null, running: false });
    mocks.stopDaemon.mockResolvedValue({ stopped: true, pid: 123 });
    mocks.startDaemon.mockReturnValue({
      started: true,
      pid: 456,
      url: 'http://127.0.0.1:5680',
      logPath: '/tmp/daemon.log',
    });
    mocks.startTelemetryWorker.mockResolvedValue({
      started: true,
      running: true,
      pid: 789,
      pidPath: '/tmp/worker.pid',
    });
  });

  it('calls the lifecycle in order: usage-stop → web-stop → web-start → usage-start', async () => {
    await runRestart({ quiet: true });

    const seq = [
      mocks.stopTelemetryWorker.mock.invocationCallOrder[0],
      mocks.stopDaemon.mock.invocationCallOrder[0],
      mocks.startDaemon.mock.invocationCallOrder[0],
      mocks.startTelemetryWorker.mock.invocationCallOrder[0],
    ];
    // Strictly increasing invocation order = the exact sequence above.
    expect(seq[0]).toBeLessThan(seq[1]);
    expect(seq[1]).toBeLessThan(seq[2]);
    expect(seq[2]).toBeLessThan(seq[3]);
  });

  it('starts the daemon with childArgs that never re-enter "restart" (recursion guard)', async () => {
    await runRestart({ quiet: true });

    expect(mocks.startDaemon).toHaveBeenCalledTimes(1);
    const opts = mocks.startDaemon.mock.calls[0][0] ?? {};
    // If childArgs were absent, daemon.mjs would default to process.argv.slice(2)
    // ('restart') → infinite re-entry. Must be explicit and clean.
    const childArgs = opts.childArgs ?? ['restart'];
    expect(childArgs).not.toContain('restart');
    expect(opts.exitOnDone).toBe(false);
  });

  it('forces a fresh worker spawn and does not toggle user settings', async () => {
    await runRestart({ quiet: true });

    expect(mocks.startTelemetryWorker).toHaveBeenCalledTimes(1);
    const opts = mocks.startTelemetryWorker.mock.calls[0][0] ?? {};
    expect(opts.forceRestart).toBe(true);
    expect(opts.quiet).toBe(true);
  });

  it('returns a structured result describing both layers', async () => {
    const result = await runRestart({ quiet: true });

    expect(result).toMatchObject({
      ok: true,
      command: 'restart',
      daemon: { started: true, pid: 456 },
      worker: { running: true, pid: 789 },
    });
    expect(result.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });
});
