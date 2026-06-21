import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { createLogger } from '@shared/utils/logger';

const require = createRequire(import.meta.url);
const log = createLogger('HermitBridgeLauncher');

/** Minimal view of HermitBridgeClient the launcher needs to probe readiness. */
export interface BridgeManagementProbe {
  listProjects(): Promise<unknown>;
}

/** A spawned bridge process: pid + a way to terminate it. */
export interface SpawnedBridge {
  pid?: number;
  kill(signal?: NodeJS.Signals | number): void;
}

export type SpawnFn = (cmd: string, args: string[], opts: { logFile?: string }) => SpawnedBridge;
export type ResolveBinaryFn = () => string | null;

export interface BridgeLaunchOptions {
  configPath: string;
  /** Args appended after `-config <configPath>` (e.g. ['--force']). */
  extraArgs?: string[];
  /** File path to redirect the child's combined stdout/stderr. */
  logFile?: string;
}

export interface EnsureRunningOptions extends BridgeLaunchOptions {
  client: BridgeManagementProbe;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface EnsureRunningResult {
  launched: boolean;
  alreadyRunning: boolean;
  pid?: number;
}

export interface BridgeCommand {
  cmd: string;
  args: string[];
}

/**
 * Resolve the bridge binary path from the `hermit-bridge` npm dependency. Returns
 * null when the optional dependency was skipped (e.g. on a platform hermit-bridge
 * ships no binary for) so the caller can fall back to `npx`. Pure of side effects
 * apart from the resolution read.
 */
export function resolveHermitBridgeBinaryName(
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch
): string | null {
  const platformName =
    platform === 'win32'
      ? 'windows'
      : platform === 'darwin' || platform === 'linux'
        ? platform
        : null;
  const archName = arch === 'x64' ? 'amd64' : arch === 'arm64' ? 'arm64' : null;
  if (!platformName || !archName) return null;
  return `hermit-bridge-${platformName}-${archName}${platformName === 'windows' ? '.exe' : ''}`;
}

function defaultResolveBinary(): string | null {
  try {
    const pkgRoot = path.dirname(require.resolve('hermit-bridge/package.json'));
    const binaryName = resolveHermitBridgeBinaryName();
    const candidates = [
      binaryName ? path.join(pkgRoot, 'bin', binaryName) : null,
      path.join(
        pkgRoot,
        'bin',
        process.platform === 'win32' ? 'hermit-bridge.exe' : 'hermit-bridge'
      ),
    ].filter((candidate): candidate is string => Boolean(candidate));
    return candidates.find((candidate) => existsSync(candidate)) ?? null;
  } catch {
    return null;
  }
}

/** Build the argv for `-config <path>` plus any extras. */
export function buildBridgeArgs(opts: BridgeLaunchOptions): string[] {
  return ['-config', opts.configPath, ...(opts.extraArgs ?? [])];
}

/**
 * Resolve the command + args to launch the bridge from the bundled
 * `hermit-bridge` binary. Throws when the binary is absent (the optional
 * dependency was skipped, e.g. on a platform hermit-bridge ships no binary for)
 * so the boot wiring can skip auto-launch and fall through to an externally
 * managed cc-connect.
 */
export function resolveBridgeCommand(
  opts: BridgeLaunchOptions,
  resolveBinary: ResolveBinaryFn = defaultResolveBinary
): BridgeCommand {
  const bin = resolveBinary();
  if (!bin) {
    throw new Error(
      'hermit-bridge binary not found — optional dependency not installed or ' +
        'the current platform is unsupported by the bundled runtime.'
    );
  }
  return { cmd: bin, args: buildBridgeArgs(opts) };
}

/** Spawn the bridge detached, redirecting stdio to a log file (or ignoring it). */
function defaultSpawn(cmd: string, args: string[], opts: { logFile?: string }): SpawnedBridge {
  const fs = require('node:fs') as typeof import('node:fs');
  let child: ChildProcess;
  if (opts.logFile) {
    const fd = fs.openSync(opts.logFile, 'a');
    child = spawn(cmd, args, { detached: true, stdio: ['ignore', fd, fd] });
  } else {
    child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  }
  child.on('error', (err) => log.error({ err, cmd }, 'hermit-bridge spawn failed'));
  child.unref();
  return child;
}

/**
 * Owns launching the hermit-bridge sidecar (via the `hermit-bridge` package) when it
 * is not already running. Idempotent and double-launch-safe: if the management
 * API already responds, ensureRunning() is a no-op and leaves any externally
 * managed hermit-bridge untouched. Only stop() kills a process THIS launcher started.
 */
export class HermitBridgeLauncher {
  private child: SpawnedBridge | null = null;

  constructor(
    private readonly deps: {
      now?: () => number;
      spawn?: SpawnFn;
      resolveBinary?: ResolveBinaryFn;
    } = {}
  ) {}

  /** True when the hermit-bridge management API responds. */
  async isRunning(client: BridgeManagementProbe): Promise<boolean> {
    try {
      await client.listProjects();
      return true;
    } catch {
      return false;
    }
  }

  async ensureRunning(opts: EnsureRunningOptions): Promise<EnsureRunningResult> {
    if (await this.isRunning(opts.client)) {
      return { launched: false, alreadyRunning: true };
    }
    const { cmd, args } = resolveBridgeCommand(
      opts,
      this.deps.resolveBinary ?? defaultResolveBinary
    );
    log.info({ cmd, args }, 'launching hermit-bridge');
    const spawnFn = this.deps.spawn ?? defaultSpawn;
    this.child = spawnFn(cmd, args, { logFile: opts.logFile });
    const pid = this.child.pid;
    await this.waitForReady(opts);
    return { launched: true, alreadyRunning: false, pid };
  }

  private async waitForReady(opts: EnsureRunningOptions): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const interval = opts.pollIntervalMs ?? 1000;
    const now = this.deps.now ?? Date.now;
    const deadline = now() + timeoutMs;
    while (now() < deadline) {
      await new Promise((r) => setTimeout(r, interval));
      if (await this.isRunning(opts.client)) return;
    }
    throw new Error(`hermit-bridge did not become ready within ${timeoutMs}ms`);
  }

  /** Stop the bridge only if THIS launcher started it. */
  stop(): void {
    if (!this.child) return;
    try {
      this.child.kill('SIGTERM');
      log.info('stopped hermit-bridge launched by Hermit');
    } catch (err) {
      log.warn({ err }, 'failed to stop hermit-bridge');
    }
    this.child = null;
  }
}
