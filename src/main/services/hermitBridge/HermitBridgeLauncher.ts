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
 * Pure name-mapper: maps platform+arch to the canonical `cc-connect` binary name.
 * Used by tests; the actual resolution in production goes through
 * `resolveBridgeCommand` which probes the `cc-connect` npm package directly.
 */
export function resolveHermitBridgeBinaryName(
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch
): string | null {
  // cc-connect ships a single cross-platform binary named `cc-connect`
  // (the Go binary is the canonical cc-connect, identical to hermit-bridge).
  if (platform === 'win32') return 'cc-connect.exe';
  if (platform === 'darwin' || platform === 'linux') return 'cc-connect';
  return null;
}

/**
 * Resolve the cc-connect npm package's `run.js` entry (an optionalDependency).
 * `run.js` is the self-installing launcher that fetches the canonical cc-connect
 * Go binary on first run, so it is always present once the package is installed.
 * Returns null when cc-connect is not installed so the caller can fall back to
 * an externally managed bridge. (agentcli brands this component as "bridge"
 * outward, but the upstream npm package it ships is `cc-connect` — the former
 * `hermit-bridge` wrapper was dropped because it duplicated cc-connect with no
 * added logic and broke its own version→release coupling.)
 */
function resolveHermitBridgeRunner(): string | null {
  try {
    const pkgRoot = path.dirname(require.resolve('cc-connect/package.json'));
    const runner = path.join(pkgRoot, 'run.js');
    return existsSync(runner) ? runner : null;
  } catch {
    return null;
  }
}

/** Build the argv for `-config <path>` plus any extras. */
export function buildBridgeArgs(opts: BridgeLaunchOptions): string[] {
  return ['-config', opts.configPath, ...(opts.extraArgs ?? [])];
}

/**
 * Resolve the command + args to launch the bridge via the bundled cc-connect
 * `run.js` entry. Mirrors the CLI (bin/hermit.mjs: `node run.js -config <path>`)
 * so the same self-installing Go binary runs under node on every platform.
 * Throws when cc-connect is absent so the boot wiring can skip auto-launch
 * and fall through to an externally managed bridge.
 */
export function resolveBridgeCommand(
  opts: BridgeLaunchOptions,
  resolveBinary: ResolveBinaryFn = resolveHermitBridgeRunner
): BridgeCommand {
  const runner = resolveBinary();
  if (!runner) {
    throw new Error(
      'cc-connect runner not found — install cc-connect via npm (npm i cc-connect) or use --no-hermit-bridge to skip.'
    );
  }
  return { cmd: process.execPath, args: [runner, ...buildBridgeArgs(opts)] };
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
  child.on('error', (err) => log.error({ err, cmd }, 'cc-connect spawn failed'));
  child.unref();
  return child;
}

/**
 * Owns launching the cc-connect sidecar when it is not already running. Idempotent
 * and double-launch-safe: if the management API already responds, ensureRunning()
 * is a no-op and leaves any externally managed cc-connect untouched. Only stop()
 * kills a process THIS launcher started.
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

  /** True when the cc-connect management API responds. */
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
      this.deps.resolveBinary ?? resolveHermitBridgeRunner
    );
    log.info({ cmd, args }, 'launching cc-connect');
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
    throw new Error(`cc-connect did not become ready within ${timeoutMs}ms`);
  }

  /** Stop the bridge only if THIS launcher started it. */
  stop(): void {
    if (!this.child) return;
    try {
      this.child.kill('SIGTERM');
      log.info('stopped cc-connect launched by Hermit');
    } catch (err) {
      log.warn({ err }, 'failed to stop cc-connect');
    }
    this.child = null;
  }
}
