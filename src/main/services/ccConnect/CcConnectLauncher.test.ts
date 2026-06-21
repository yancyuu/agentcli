import { describe, expect, it, vi } from 'vitest';

import {
  buildBridgeArgs,
  CcConnectLauncher,
  resolveBridgeCommand,
  resolveHermitBridgeBinaryName,
  type SpawnedBridge,
  type SpawnFn,
} from './CcConnectLauncher';

function probe(readyAfterCalls: number) {
  let calls = 0;
  return {
    listProjects: vi.fn(async () => {
      calls += 1;
      if (calls < readyAfterCalls) throw new Error('management api not ready');
      return [];
    }),
  };
}

describe('CcConnectLauncher', () => {
  describe('resolveBridgeCommand / buildBridgeArgs', () => {
    it('builds -config <path> + extras', () => {
      expect(buildBridgeArgs({ configPath: '/c.toml', extraArgs: ['--force'] })).toEqual([
        '-config',
        '/c.toml',
        '--force',
      ]);
    });

    it('returns the resolved binary path when present', () => {
      const { cmd, args } = resolveBridgeCommand(
        { configPath: '/c.toml' },
        () => '/node_modules/hermit-bridge/bin/hermit-bridge'
      );
      expect(cmd).toBe('/node_modules/hermit-bridge/bin/hermit-bridge');
      expect(args).toEqual(['-config', '/c.toml']);
    });

    it('maps host platforms to packaged hermit-bridge binary names', () => {
      expect(resolveHermitBridgeBinaryName('darwin', 'arm64')).toBe('hermit-bridge-darwin-arm64');
      expect(resolveHermitBridgeBinaryName('linux', 'x64')).toBe('hermit-bridge-linux-amd64');
      expect(resolveHermitBridgeBinaryName('win32', 'x64')).toBe('hermit-bridge-windows-amd64.exe');
      expect(resolveHermitBridgeBinaryName('win32', 'arm64')).toBe(
        'hermit-bridge-windows-arm64.exe'
      );
    });

    it('throws when the hermit-bridge binary is absent (no silent fallback)', () => {
      expect(() => resolveBridgeCommand({ configPath: '/c.toml' }, () => null)).toThrow(
        /hermit-bridge binary not found/
      );
    });
  });

  describe('ensureRunning', () => {
    it('is a no-op when the management API already responds (never double-launches)', async () => {
      const spawn = vi.fn();
      const launcher = new CcConnectLauncher({ spawn });
      const client = probe(1); // ready immediately

      const result = await launcher.ensureRunning({
        client,
        configPath: '/c.toml',
        timeoutMs: 1000,
        pollIntervalMs: 1,
      });

      expect(result).toEqual({ launched: false, alreadyRunning: true });
      expect(spawn).not.toHaveBeenCalled();
    });

    it('spawns once and waits for readiness when nothing is running', async () => {
      const fakeChild: SpawnedBridge = { pid: 4242, kill: vi.fn() };
      const spawn = vi.fn<SpawnFn>(() => fakeChild);
      const launcher = new CcConnectLauncher({
        spawn,
        resolveBinary: () => '/bin/hermit-bridge',
      });
      const client = probe(2); // initial check fails, first poll succeeds

      const result = await launcher.ensureRunning({
        client,
        configPath: '/c.toml',
        extraArgs: ['--force'],
        timeoutMs: 1000,
        pollIntervalMs: 1,
      });

      expect(result).toEqual({ launched: true, alreadyRunning: false, pid: 4242 });
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(spawn.mock.calls[0][0]).toBe('/bin/hermit-bridge');
      expect(spawn.mock.calls[0][1]).toEqual(['-config', '/c.toml', '--force']);
    });

    it('rejects when the bridge never becomes ready in time', async () => {
      const spawn = vi.fn<SpawnFn>(() => ({ pid: 99, kill: vi.fn() }));
      const launcher = new CcConnectLauncher({
        spawn,
        resolveBinary: () => '/bin/hermit-bridge',
      });
      const client = probe(999); // never ready

      await expect(
        launcher.ensureRunning({
          client,
          configPath: '/c.toml',
          timeoutMs: 3,
          pollIntervalMs: 1,
        })
      ).rejects.toThrow(/did not become ready/);
    });
  });

  describe('stop', () => {
    it('is a no-op when nothing was launched', () => {
      const launcher = new CcConnectLauncher({
        spawn: vi.fn(),
        resolveBinary: () => '/bin/hermit-bridge',
      });
      expect(() => launcher.stop()).not.toThrow();
    });

    it('kills (SIGTERM) a process this launcher started', async () => {
      const kill = vi.fn();
      const spawn = vi.fn<SpawnFn>(() => ({ pid: 7, kill }));
      const launcher = new CcConnectLauncher({ spawn, resolveBinary: () => '/bin/hermit-bridge' });

      await launcher.ensureRunning({
        client: probe(2),
        configPath: '/c.toml',
        timeoutMs: 1000,
        pollIntervalMs: 1,
      });
      launcher.stop();

      expect(kill).toHaveBeenCalledWith('SIGTERM');
    });
  });
});
