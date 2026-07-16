import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, rm, stat, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { TaskBusConfig } from '@shared/types/team';

import { getValidBearerToken } from '@main/services/auth/OpenHermitAuthClient';
import type { UsageTelemetryStatus } from '@main/services/session-intelligence/usageTypes';
import { reportLarkCredentialsOnce, type LarkCredentialsReportStatus } from './larkCredentials';
import { reapOtherUsageWorkers } from './workerSingleton';

const STATUS_SCHEMA_VERSION = 1;
const DEFAULT_SCAN_INTERVAL_MS = 5 * 60 * 1000;
const LARK_AUDIT_MAX_BYTES = 512 * 1024;

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
  source: 'claude-jsonl' | 'local-jsonl';
  telemetryEnabled: boolean;
  telemetry: UsageTelemetryStatus;
  lastError?: string;
}

export interface LarkCredentialsWorkerPaths {
  statusPath: string;
  auditLogPath: string;
}

export interface LarkCredentialsWorkerStatus {
  schemaVersion: typeof STATUS_SCHEMA_VERSION;
  state: 'starting' | 'reporting' | 'idle' | 'error' | 'stopped';
  running: boolean;
  pid: number | null;
  startedAt: string | null;
  updatedAt: string;
  lastAttempt: string | null;
  report?: LarkCredentialsReportStatus;
}

interface SavedSettings {
  taskBus?: TaskBusConfig;
}

let stopping = false;
let startedAt = new Date().toISOString();
let lastTelemetry = emptyUsageTelemetryStatus();
let lastScan: string | null = null;

export function createInterruptibleWait(): {
  wait: (ms: number) => Promise<void>;
  interrupt: () => void;
} {
  const pending = new Set<{ timer: NodeJS.Timeout; resolve: () => void }>();
  return {
    wait: (ms) =>
      new Promise((resolve) => {
        const entry = {
          timer: setTimeout(() => {
            pending.delete(entry);
            resolve();
          }, ms),
          resolve,
        };
        pending.add(entry);
      }),
    interrupt: () => {
      for (const entry of pending) {
        clearTimeout(entry.timer);
        entry.resolve();
      }
      pending.clear();
    },
  };
}

const schedulerWait = createInterruptibleWait();

function requestWorkerStop(): void {
  stopping = true;
  schedulerWait.interrupt();
}

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

export function getLarkCredentialsWorkerPaths(
  hermitHome = resolveHermitHome()
): LarkCredentialsWorkerPaths {
  return {
    statusPath: path.join(hermitHome, 'lark-credentials', 'status.json'),
    auditLogPath: path.join(hermitHome, 'logs', 'lark-credentials-audit.ndjson'),
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
    imMessages: 0,
    imTokensTotal: 0,
    tokensIn: 0,
    tokensOut: 0,
    cacheRead: 0,
    cacheCreation: 0,
    totalTokens: 0,
    recentMessages: 0,
    recentTokensTotal: 0,
    recentByProvider: {
      claudecode: {
        sessions: 0,
        messages: 0,
        tokensIn: 0,
        tokensOut: 0,
        cacheRead: 0,
        cacheCreation: 0,
        tokensTotal: 0,
      },
      codex: {
        sessions: 0,
        messages: 0,
        tokensIn: 0,
        tokensOut: 0,
        cacheRead: 0,
        cacheCreation: 0,
        tokensTotal: 0,
      },
    },
    activeDays: 0,
    hourly: Array.from({ length: 24 }, () => 0),
    projects: [],
    workSecondsByDay: {},
    daily: {},
    localUsers: [],
    byProvider: {
      claudecode: {
        sessions: 0,
        messages: 0,
        tokensIn: 0,
        tokensOut: 0,
        cacheRead: 0,
        cacheCreation: 0,
        tokensTotal: 0,
      },
      codex: {
        sessions: 0,
        messages: 0,
        tokensIn: 0,
        tokensOut: 0,
        cacheRead: 0,
        cacheCreation: 0,
        tokensTotal: 0,
      },
    },
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

function hasLocalTelemetry(telemetry: UsageTelemetryStatus | null | undefined): boolean {
  return Boolean(
    telemetry &&
    (Number(telemetry.sessions) > 0 ||
      Number(telemetry.messages) > 0 ||
      Number(telemetry.totalTokens) > 0 ||
      Boolean(telemetry.lastScan))
  );
}

async function readPersistedTelemetry(
  paths: UsageTelemetryWorkerPaths
): Promise<UsageTelemetryStatus | null> {
  try {
    const raw = await readFile(paths.statusPath, 'utf-8');
    const parsed = JSON.parse(raw) as UsageTelemetryWorkerStatus;
    return parsed?.telemetry && typeof parsed.telemetry === 'object' ? parsed.telemetry : null;
  } catch {
    return null;
  }
}

async function resolveStatusTelemetry(
  paths: UsageTelemetryWorkerPaths,
  telemetry: UsageTelemetryStatus | undefined
): Promise<UsageTelemetryStatus> {
  if (telemetry) return telemetry;
  if (hasLocalTelemetry(lastTelemetry)) return lastTelemetry;
  const persisted = await readPersistedTelemetry(paths);
  return persisted ?? lastTelemetry;
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
  const telemetry = await resolveStatusTelemetry(paths, options.telemetry);
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
    source: 'local-jsonl',
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

function isUsageUploadDisabled(): boolean {
  return (
    process.env.HERMIT_USAGE_UPLOAD_DISABLED === '1' ||
    process.env.HERMIT_USAGE_FORCE_LOCAL_ONLY === '1'
  );
}

function uploadDisabledTelemetryConfig(cfg: TaskBusConfig | null): TaskBusConfig | null {
  if (!isUsageUploadDisabled() || !cfg?.telemetry) return cfg;
  return {
    ...cfg,
    telemetry: {
      ...cfg.telemetry,
      conversationUploadEnabled: false,
      conversations: {
        ...cfg.telemetry.conversations,
        uploadEnabled: false,
      },
    },
  };
}

function shouldForceLocalScan(): boolean {
  return process.env.HERMIT_USAGE_SCAN_DISABLED === '1' || isUsageUploadDisabled();
}

async function scanUsageTelemetryOnce(
  cfg: TaskBusConfig | null
): Promise<UsageTelemetryStatus | null | undefined> {
  const { scanTelemetryOnce } =
    await import('@main/services/session-intelligence/UsageTelemetryService');
  return scanTelemetryOnce(cfg ?? undefined);
}

async function sweepUsageUploadLock(hermitHome: string): Promise<void> {
  const { sweepStaleUploadLock } =
    await import('@main/services/session-intelligence/ConversationMessageUploadService');
  await sweepStaleUploadLock(hermitHome);
}

export async function scanUsageTelemetryWorkerOnce(
  hermitHome = resolveHermitHome()
): Promise<{ status: UsageTelemetryWorkerStatus; shouldContinue: boolean }> {
  const paths = getUsageTelemetryWorkerPaths(hermitHome);
  const cfg = uploadDisabledTelemetryConfig(await readTaskBusConfig(paths));
  if (!cfg?.telemetry?.enabled) {
    if (shouldForceLocalScan()) {
      await writeStatus(paths, 'scanning', cfg);
      try {
        const telemetry = (await scanUsageTelemetryOnce(null)) ?? emptyUsageTelemetryStatus();
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
    const telemetry = (await scanUsageTelemetryOnce(cfg)) ?? emptyUsageTelemetryStatus();
    const status = await writeStatus(paths, 'idle', cfg, { telemetry });
    return { status, shouldContinue: true };
  } catch (err) {
    const status = await writeStatus(paths, 'error', cfg, {
      error: err instanceof Error ? err.message : String(err),
    });
    return { status, shouldContinue: true };
  }
}

async function resolveLarkAuthedContext(
  hermitHome: string
): Promise<{ baseUrl: string; token: string } | null> {
  const baseUrl = (
    process.env.OPENHERMIT_CLOUD_UPLOAD_BASE_URL ||
    process.env.OPENHERMIT_CONVERSATION_UPLOAD_BASE_URL ||
    'http://159.75.231.98:8088'
  )
    .trim()
    .replace(/\/+$/, '');
  const token = await getValidBearerToken(hermitHome, baseUrl);
  return token ? { baseUrl, token } : null;
}

function redactLarkError(message: string): string {
  return message
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/g, '$1[hidden]')
    .replace(/(token|secret|password|authorization)=([^\s,;&]+)/gi, '$1=[hidden]')
    .slice(0, 500);
}

interface LarkCredentialsAuditEntry {
  timestamp: string;
  ok: boolean;
  reason?: LarkCredentialsReportStatus['reason'];
  httpStatus?: number;
  accountCount?: number;
  accounts?: LarkCredentialsReportStatus['accounts'];
}

function buildLarkCredentialsAuditEntry(
  report: LarkCredentialsReportStatus
): LarkCredentialsAuditEntry {
  return {
    timestamp: report.lastAttemptAt,
    ok: report.ok,
    ...(report.reason ? { reason: report.reason } : {}),
    ...(report.lastHttpStatus ? { httpStatus: report.lastHttpStatus } : {}),
    ...(report.accountCount ? { accountCount: report.accountCount } : {}),
    ...(report.accounts ? { accounts: report.accounts } : {}),
  };
}

export async function appendLarkCredentialsAuditLog(
  hermitHome: string,
  report: LarkCredentialsReportStatus
): Promise<void> {
  const { auditLogPath } = getLarkCredentialsWorkerPaths(hermitHome);
  try {
    await mkdir(path.dirname(auditLogPath), { recursive: true, mode: 0o700 });
    try {
      if ((await stat(auditLogPath)).size >= LARK_AUDIT_MAX_BYTES) {
        await truncate(auditLogPath, 0);
      }
    } catch {
      // First append creates the file.
    }
    await appendFile(auditLogPath, `${JSON.stringify(buildLarkCredentialsAuditEntry(report))}\n`, {
      encoding: 'utf-8',
      mode: 0o600,
    });
  } catch {
    // An audit-write failure must never block the five-minute reporting loop.
  }
}

async function safeWriteLarkCredentialsStatus(
  hermitHome: string,
  state: LarkCredentialsWorkerStatus['state'],
  report?: LarkCredentialsReportStatus
): Promise<void> {
  try {
    await persistLarkCredentialsStatus(hermitHome, state, report);
  } catch {
    // Status persistence is diagnostic only; it must not stop Lark reporting.
  }
}

async function persistLarkCredentialsStatus(
  hermitHome: string,
  state: LarkCredentialsWorkerStatus['state'],
  report?: LarkCredentialsReportStatus
): Promise<void> {
  const paths = getLarkCredentialsWorkerPaths(hermitHome);
  await mkdir(path.dirname(paths.statusPath), { recursive: true, mode: 0o700 });
  const status: LarkCredentialsWorkerStatus = {
    schemaVersion: STATUS_SCHEMA_VERSION,
    state,
    running: state !== 'stopped',
    pid: state === 'stopped' ? null : process.pid,
    startedAt,
    updatedAt: new Date().toISOString(),
    lastAttempt: report?.lastAttemptAt ?? null,
    ...(report
      ? {
          report: report.message ? { ...report, message: redactLarkError(report.message) } : report,
        }
      : {}),
  };
  await writeFile(paths.statusPath, `${JSON.stringify(status, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

export async function scanLarkCredentialsOnce(
  hermitHome = resolveHermitHome()
): Promise<LarkCredentialsReportStatus> {
  await safeWriteLarkCredentialsStatus(hermitHome, 'reporting');
  try {
    const report = await reportLarkCredentialsOnce({
      hermitHome,
      resolveAuthedContext: resolveLarkAuthedContext,
    });
    await safeWriteLarkCredentialsStatus(hermitHome, report.ok ? 'idle' : 'error', report);
    await appendLarkCredentialsAuditLog(hermitHome, report);
    return report;
  } catch (err) {
    const now = new Date().toISOString();
    const report: LarkCredentialsReportStatus = {
      ok: false,
      enabled: true,
      reason: 'fetch-failed',
      message: redactLarkError(err instanceof Error ? err.message : String(err)),
      lastAttemptAt: now,
      lastErrorAt: now,
    };
    await safeWriteLarkCredentialsStatus(hermitHome, 'error', report);
    await appendLarkCredentialsAuditLog(hermitHome, report);
    return report;
  }
}

export interface WorkerCycleScans {
  scanUsage: () => Promise<{ shouldContinue: boolean }>;
  scanLark: () => Promise<unknown>;
}

export async function runWorkerCycle(
  scans: WorkerCycleScans
): Promise<{ shouldContinue: boolean }> {
  const usage = scans.scanUsage();
  const lark = scans.scanLark();
  const [usageResult] = await Promise.allSettled([usage, lark]);
  return {
    shouldContinue: usageResult.status !== 'fulfilled' || usageResult.value.shouldContinue,
  };
}

function scanIntervalMs(): number {
  const raw = Number.parseInt(process.env.HERMIT_USAGE_TELEMETRY_INTERVAL_MS ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? Math.max(1_000, raw) : DEFAULT_SCAN_INTERVAL_MS;
}

export async function runUsageTelemetryWorker(hermitHome = resolveHermitHome()): Promise<void> {
  const paths = getUsageTelemetryWorkerPaths(hermitHome);
  startedAt = new Date().toISOString();
  await mkdir(path.dirname(paths.logPath), { recursive: true, mode: 0o700 });
  // At-most-one: reap any OTHER live worker daemon (pidfile-stale orphans included)
  // before claiming the pidfile, so a freshly booted worker — even after a reinstall
  // or respawn with no manual `usage stop` — always becomes the sole one.
  await reapOtherUsageWorkers();
  await writePid(paths);
  // Clear any upload lock left by a previous crash/reboot before the first scan,
  // so a stale lock never blocks the first cycle of a fresh boot.
  try {
    await sweepUsageUploadLock(hermitHome);
  } catch {
    // Usage module failures must not prevent the independent Lark cycle from starting.
  }
  await writeStatus(paths, 'starting', await readTaskBusConfig(paths));

  const stop = async () => {
    if (stopping) return;
    requestWorkerStop();
    await writeStatus(paths, 'stopped', await readTaskBusConfig(paths), {
      running: false,
      startedAt,
    });
    await safeWriteLarkCredentialsStatus(hermitHome, 'stopped');
    await removePid(paths);
  };

  process.once('SIGINT', () => {
    void stop().finally(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    void stop().finally(() => process.exit(0));
  });

  while (!stopping) {
    const result = await runWorkerCycle({
      scanUsage: () => scanUsageTelemetryWorkerOnce(hermitHome),
      scanLark: () => scanLarkCredentialsOnce(hermitHome),
    });
    if (!result.shouldContinue) {
      requestWorkerStop();
      break;
    }
    await schedulerWait.wait(scanIntervalMs());
  }
  await safeWriteLarkCredentialsStatus(hermitHome, 'stopped');
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
