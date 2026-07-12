import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { TaskBusConfig } from '@shared/types/team';

import { scanTelemetryOnce } from '@main/services/session-intelligence/UsageTelemetryService';
import { sweepStaleUploadLock } from '@main/services/session-intelligence/ConversationMessageUploadService';
import { getValidBearerToken } from '@main/services/auth/OpenHermitAuthClient';
import type { UsageTelemetryStatus } from '@main/services/session-intelligence/usageTypes';
import { reportLarkCredentialsOnce, type LarkCredentialsReportStatus } from './larkCredentials';
import { reapOtherUsageWorkers } from './workerSingleton';

const STATUS_SCHEMA_VERSION = 1;
const DEFAULT_SCAN_INTERVAL_MS = 10 * 60 * 1000;

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
  /**
   * Latest lark / feishu credential report. Runs serial after `telemetry` every
   * scan cycle; worker writes this alongside status so the renderer can show
   * "上报成功 / 未登录 / 未配置" without a separate request.
   */
  larkCredentials?: LarkCredentialsReportStatus;
}

interface SavedSettings {
  taskBus?: TaskBusConfig;
}

type LarkAuthedResolver = (
  hermitHome: string
) => Promise<{ baseUrl: string; token: string } | null>;

/**
 * Auth resolver injected into the lark credentials reporter. The default wires
 * `getValidBearerToken` (which proactively refreshes the access token when it
 * is near/expired) plus the same OPENHERMIT_* base URL overrides the upload
 * pipeline uses. Tests can swap this with a stub to exercise both branches.
 */
let larkAuthedResolver: LarkAuthedResolver = defaultLarkAuthedResolver;

export function setLarkAuthedResolver(resolver: LarkAuthedResolver | null): void {
  larkAuthedResolver = resolver ?? defaultLarkAuthedResolver;
}

async function defaultLarkAuthedResolver(
  hermitHome: string
): Promise<{ baseUrl: string; token: string } | null> {
  const envBaseUrl =
    normalizeCloudBaseUrl(
      process.env.OPENHERMIT_CLOUD_UPLOAD_BASE_URL,
      'OPENHERMIT_CLOUD_UPLOAD_BASE_URL'
    ) ||
    normalizeCloudBaseUrl(
      process.env.OPENHERMIT_CONVERSATION_UPLOAD_BASE_URL,
      'OPENHERMIT_CONVERSATION_UPLOAD_BASE_URL'
    );
  const baseUrl =
    envBaseUrl ||
    `${DEFAULT_OPENHERMIT_CLOUD_SCHEME}://${DEFAULT_OPENHERMIT_CLOUD_HOST}:${DEFAULT_OPENHERMIT_CLOUD_PORT}`;
  const token = await getValidBearerToken(hermitHome, baseUrl);
  if (!token) return null;
  return { baseUrl, token };
}

function normalizeCloudBaseUrl(value: string | undefined, optionName: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`${optionName} 必须是 http(s)://`);
    }
    return url.toString().replace(/\/+$/, '');
  } catch (err) {
    throw new Error(`${optionName} 无法解析：${err instanceof Error ? err.message : String(err)}`);
  }
}

const DEFAULT_OPENHERMIT_CLOUD_HOST = '159.75.231.98';
const DEFAULT_OPENHERMIT_CLOUD_PORT = '8088';
const DEFAULT_OPENHERMIT_CLOUD_SCHEME = 'http';

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
    larkCredentials?: LarkCredentialsReportStatus;
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
    ...(options.larkCredentials ? { larkCredentials: options.larkCredentials } : {}),
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

export async function scanUsageTelemetryWorkerOnce(
  hermitHome = resolveHermitHome()
): Promise<{ status: UsageTelemetryWorkerStatus; shouldContinue: boolean }> {
  const paths = getUsageTelemetryWorkerPaths(hermitHome);
  const cfg = uploadDisabledTelemetryConfig(await readTaskBusConfig(paths));
  if (!cfg?.telemetry?.enabled) {
    if (shouldForceLocalScan()) {
      await writeStatus(paths, 'scanning', cfg);
      try {
        const telemetry = (await scanTelemetryOnce()) ?? emptyUsageTelemetryStatus();
        const larkCredentials = await safeScanLarkCredentials(hermitHome);
        const status = await writeStatus(paths, 'idle', cfg, {
          running: false,
          telemetry,
          startedAt: null,
          larkCredentials,
        });
        return { status, shouldContinue: false };
      } catch (err) {
        const larkCredentials = await safeScanLarkCredentials(hermitHome);
        const status = await writeStatus(paths, 'error', cfg, {
          running: false,
          error: err instanceof Error ? err.message : String(err),
          startedAt: null,
          larkCredentials,
        });
        return { status, shouldContinue: false };
      }
    }
    const larkCredentials = await safeScanLarkCredentials(hermitHome);
    const status = await writeStatus(paths, 'disabled', cfg, {
      running: false,
      telemetry: lastTelemetry,
      startedAt: null,
      larkCredentials,
    });
    await removePid(paths);
    return { status, shouldContinue: false };
  }

  await writeStatus(paths, 'scanning', cfg);
  try {
    const telemetry = (await scanTelemetryOnce(cfg)) ?? emptyUsageTelemetryStatus();
    const larkCredentials = await safeScanLarkCredentials(hermitHome);
    const status = await writeStatus(paths, 'idle', cfg, { telemetry, larkCredentials });
    return { status, shouldContinue: true };
  } catch (err) {
    const larkCredentials = await safeScanLarkCredentials(hermitHome);
    const status = await writeStatus(paths, 'error', cfg, {
      error: err instanceof Error ? err.message : String(err),
      larkCredentials,
    });
    return { status, shouldContinue: true };
  }
}

/**
 * Same-shape wrapper: never throws, never blocks the scan loop. A failure here
 * must NEVER escalate to a worker exit — it just lives in status.json as the
 * last `larkCredentials` snapshot, visible to the renderer with the reason.
 */
async function safeScanLarkCredentials(
  hermitHome: string
): Promise<LarkCredentialsReportStatus | undefined> {
  try {
    return await reportLarkCredentialsOnce({
      hermitHome,
      resolveAuthedContext: larkAuthedResolver,
    });
  } catch (err) {
    return {
      ok: false,
      enabled: true,
      reason: 'fetch-failed',
      message: err instanceof Error ? err.message : String(err),
      lastAttemptAt: new Date().toISOString(),
      lastErrorAt: new Date().toISOString(),
    };
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
  // At-most-one: reap any OTHER live worker daemon (pidfile-stale orphans included)
  // before claiming the pidfile, so a freshly booted worker — even after a reinstall
  // or respawn with no manual `usage stop` — always becomes the sole one.
  await reapOtherUsageWorkers();
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
