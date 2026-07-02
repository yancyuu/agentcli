import { describe, expect, it } from 'vitest';

import { parseOtherUsageWorkerPids } from '../workerSingleton';

// Sample `ps -axo pid=,command=` output covering every case the reaper must
// distinguish: the self daemon, a peer daemon, a transient --scan-once child,
// a global-package daemon (different install path), and an unrelated process.
const PS_OUTPUT = [
  ' 42790 /usr/local/bin/node --import ...tsx/dist/loader.mjs src/main/telemetry/worker.ts',
  ' 14726 node src/main/telemetry/worker.ts',
  ' 99999 node src/main/telemetry/worker.ts --scan-once',
  ' 50001 /usr/local/bin/node ~/.npm-global/.../openhermit/src/main/telemetry/worker.ts',
  ' 12345 /usr/local/bin/node src/main/server.ts',
  '',
].join('\n');

describe('parseOtherUsageWorkerPids', () => {
  it('collects peer worker daemons, excluding self, --scan-once, and unrelated procs', () => {
    const pids = parseOtherUsageWorkerPids(PS_OUTPUT, 42790);
    // Self (42790) excluded; --scan-once (99999) excluded; server.ts (12345) excluded.
    expect(pids).toContain(14726);
    expect(pids).toContain(50001);
    expect(pids).toEqual([14726, 50001]);
  });

  it('matches a global-package install path worker (orphan with no pidfile entry)', () => {
    // Self is the local daemon; the global-package daemon (50001) must still be found.
    const pids = parseOtherUsageWorkerPids(PS_OUTPUT, 42790);
    expect(pids).toContain(50001);
  });

  it('returns empty when only self / no other worker is running', () => {
    expect(parseOtherUsageWorkerPids(' 42790 node src/main/telemetry/worker.ts', 42790)).toEqual(
      []
    );
    expect(parseOtherUsageWorkerPids(' 12345 node src/main/server.ts', 42790)).toEqual([]);
    expect(parseOtherUsageWorkerPids('', 42790)).toEqual([]);
  });

  it('ignores malformed lines but keeps valid ones', () => {
    const out = [
      'garbage line',
      '',
      ' notapid telemetry/worker.ts',
      ' 7 node telemetry/worker.ts',
    ].join('\n');
    expect(parseOtherUsageWorkerPids(out, 42790)).toEqual([7]);
  });
});
