import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { TaskBusConfig } from '@shared/types/team';

import { scanTelemetryOnce } from '@main/services/session-intelligence/UsageTelemetryService';
import { sweepStaleUploadLock } from '@main/services/session-intelligence/ConversationMessageUploadService';
import type { UsageTelemetryStatus } from '@main/services/session-intelligence/usageTypes';

const STATUS_SCHEMA_VERSION = 1;
const DEFAULT_SCAN_INTERVAL_MS = 5 * 60 * 1000;

type WorkerState = 'starting' | 'scanning' | 'idle' | 'disabled' | 'stopped' | 'error';

export interface UsageTelemetryWorkerPaths {
  hermitHome: string;
  telemetryDir: string;
  pidPath: string;
  statusPath: string;
  logPath: string;
  errorLogPath: string;
  settingsPath: string;
}

export interface UsageTelemetryWorkerStatus {
  schemaVersion: typeof STATUS_SCHEMA_VERSION;
  state: WorkerState;
  running: boolean;
  pid: number | null;
  startedAt: string | null;
  updatedAt: string;
  lastScan: string | null;
  source: 'claude-jsonl';
  telemetryEnabled: boolean;
  telemetry: UsageTelemetryStatus;
  lastError?: string;
}

interface SavedSettings {
  taskBus?: TaskBusConfig;
}

let stopping = false;
let startedAt = new Date().toISOString();
let lastTelemetry = emptyUsageTelemetryStatus();
let lastScan: string | null = null;

export function resolveHermitHome(): string {
  return process.env.HERMIT_HOME || path.join(os.homedir(), '.hermit');
}

export function getUsageTelemetryWorkerPaths(
  hermitHome = resolveHermitHome()
): UsageTelemetryWorkerPaths {
  const telemetryDir = path.join(hermitHome, 'telemetry');
  return {
    hermitHome,
    telemetryDir,
    pidPath: path.join(telemetryDir, 'worker.pid'),
    statusPath: path.join(telemetryDir, 'status.json'),
    logPath: path.join(hermitHome, 'logs', 'telemetry-worker.log'),
    errorLogPath: path.join(hermitHome, 'logs', 'telemetry-worker.err.log'),
    settingsPath: path.join(hermitHome, 'settings.json'),
  };
}

export function isUsageTelemetryWorkerPidRunning(pid: number | null | undefined): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function emptyUsageTelemetryStatus(): UsageTelemetryStatus {
  return {
    connected: false,
    lastScan: null,
    sessions: 0,
    messages: 0,
    tokensIn: 0,
    tokensOut: 0,
    cacheRead: 0,
    cacheCreation: 0,
    totalTokens: 0,
    activeDays: 0,
    hourly: Array.from({ length: 24 }, () => 0),
    projects: [],
    workSecondsByDay: {},
    daily: {},
    localUsers: [],
    unresolvedUsage: { sessions: 0, messages: 0, tokensTotal: 0 },
  };
}

export async function readUsageTelemetryWorkerStatus(
  hermitHome = resolveHermitHome()
): Promise<{ status: UsageTelemetryWorkerStatus | null; error?: string }> {
  const paths = getUsageTelemetryWorkerPaths(hermitHome);
  try {
    const raw = await readFile(paths.statusPath, 'utf-8');
    const parsed = JSON.parse(raw) as UsageTelemetryWorkerStatus;
    return { status: parsed };
  } catch (err) {
    if (!existsSync(paths.statusPath)) return { status: null };
    return { status: null, error: err instanceof Error ? err.message : String(err) };
  }
}

async function readTaskBusConfig(paths: UsageTelemetryWorkerPaths): Promise<TaskBusConfig | null> {
  try {
    const raw = await readFile(paths.settingsPath, 'utf-8');
    const settings = JSON.parse(raw) as SavedSettings;
    return settings.taskBus ?? null;
  } catch {
    return null;
  }
}

async function writePid(paths: UsageTelemetryWorkerPaths): Promise<void> {
  await mkdir(paths.telemetryDir, { recursive: true, mode: 0o700 });
  await writeFile(paths.pidPath, String(process.pid), { encoding: 'utf-8', mode: 0o600 });
}

async function removePid(paths: UsageTelemetryWorkerPaths): Promise<void> {
  await rm(paths.pidPath, { force: true });
}

async function writeStatus(
  paths: UsageTelemetryWorkerPaths,
  state: WorkerState,
  cfg: TaskBusConfig | null,
  options: {
    running?: boolean;
    telemetry?: UsageTelemetryStatus;
    error?: string;
    startedAt?: string | null;
  } = {}
): Promise<UsageTelemetryWorkerStatus> {
  const telemetry = options.telemetry ?? lastTelemetry;
  lastTelemetry = telemetry;
  lastScan = telemetry.lastScan ?? lastScan;
  const status: UsageTelemetryWorkerStatus = {
    schemaVersion: STATUS_SCHEMA_VERSION,
    state,
    running: options.running ?? !['disabled', 'stopped'].includes(state),
    pid: options.running === false ? null : process.pid,
    startedAt: options.startedAt === undefined ? startedAt : options.startedAt,
    updatedAt: new Date().toISOString(),
    lastScan,
    source: 'claude-jsonl',
    telemetryEnabled: Boolean(cfg?.telemetry?.enabled),
    telemetry,
    ...(options.error ? { lastError: options.error } : {}),
  };
  await mkdir(paths.telemetryDir, { recursive: true, mode: 0o700 });
  await writeFile(paths.statusPath, `${JSON.stringify(status, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: 0o600,
  });
  return status;
}

export async function scanUsageTelemetryWorkerOnce(
  hermitHome = resolveHermitHome()
): Promise<{ status: UsageTelemetryWorkerStatus; shouldContinue: boolean }> {
  const paths = getUsageTelemetryWorkerPaths(hermitHome);
  const cfg = await readTaskBusConfig(paths);
  if (!cfg?.telemetry?.enabled) {
    if (process.env.HERMIT_USAGE_SCAN_DISABLED === '1') {
      await writeStatus(paths, 'scanning', cfg);
      try {
        const telemetry = (await scanTelemetryOnce()) ?? emptyUsageTelemetryStatus();
        const status = await writeStatus(paths, 'idle', cfg, {
          running: false,
          telemetry,
          startedAt: null,
        });
        return { status, shouldContinue: false };
      } catch (err) {
        const status = await writeStatus(paths, 'error', cfg, {
          running: false,
          error: err instanceof Error ? err.message : String(err),
          startedAt: null,
        });
        return { status, shouldContinue: false };
      }
    }
    const status = await writeStatus(paths, 'disabled', cfg, {
      running: false,
      telemetry: lastTelemetry,
      startedAt: null,
    });
    await removePid(paths);
    return { status, shouldContinue: false };
  }

  await writeStatus(paths, 'scanning', cfg);
  try {
    const telemetry = (await scanTelemetryOnce(cfg)) ?? emptyUsageTelemetryStatus();
    const status = await writeStatus(paths, 'idle', cfg, { telemetry });
    return { status, shouldContinue: true };
  } catch (err) {
    const status = await writeStatus(paths, 'error', cfg, {
      error: err instanceof Error ? err.message : String(err),
    });
    return { status, shouldContinue: true };
  }
}

function scanIntervalMs(): number {
  const raw = Number.parseInt(process.env.HERMIT_USAGE_TELEMETRY_INTERVAL_MS ?? '', 10);
  if (Number.isFinite(raw) && raw > 0) return Math.max(1_000, raw);
  return DEFAULT_SCAN_INTERVAL_MS;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runUsageTelemetryWorker(hermitHome = resolveHermitHome()): Promise<void> {
  const paths = getUsageTelemetryWorkerPaths(hermitHome);
  startedAt = new Date().toISOString();
  await mkdir(path.dirname(paths.logPath), { recursive: true, mode: 0o700 });
  await writePid(paths);
  // Clear any upload lock left by a previous crash/reboot before the first scan,
  // so a stale lock never blocks the first cycle of a fresh boot.
  await sweepStaleUploadLock(hermitHome);
  await writeStatus(paths, 'starting', await readTaskBusConfig(paths));

  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await writeStatus(paths, 'stopped', await readTaskBusConfig(paths), {
      running: false,
      startedAt,
    });
    await removePid(paths);
  };

  process.once('SIGINT', () => {
    void stop().finally(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    void stop().finally(() => process.exit(0));
  });

  while (!stopping) {
    const result = await scanUsageTelemetryWorkerOnce(hermitHome);
    if (!result.shouldContinue) return;
    await wait(scanIntervalMs());
  }
}

async function runCli(): Promise<void> {
  if (process.argv.includes('--scan-once')) {
    const result = await scanUsageTelemetryWorkerOnce();
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
    return;
  }
  await runUsageTelemetryWorker();
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  runCli().catch((err) => {
    process.stderr.write(
      `[openHermit] telemetry worker failed: ${err instanceof Error ? err.message : String(err)}\n`
    );
    process.exit(1);
  });
}
