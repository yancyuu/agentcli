/**
 * UsageTelemetryService - scans local Claude Code JSONL sessions as the single
 * usage telemetry source. The service intentionally stays local-only: it does
 * not upload usage, conversation messages, or capability snapshots.
 */

import type { ConversationTelemetryRow } from '@shared/types/api';
import type { TaskBusConfig } from '@shared/types/team';

import { SessionUsageCollector } from './SessionUsageCollector';
import { uploadConversationMessages } from './ConversationMessageUploadService';
import type { SessionEntry, UsageAggregate } from './SessionUsageParser';
import type {
  UsageCollectionResult,
  UsageTelemetryStatus,
  UserUsageTelemetryRow,
} from './usageTypes';

export type UsageTelemetryScanPhase = 'idle' | 'scanning' | 'done' | 'error';

export interface UsageTelemetryRuntimeStatus {
  running: boolean;
  phase: UsageTelemetryScanPhase;
  startedAt: string | null;
  updatedAt: string | null;
  lastError: string | null;
}

let scanInterval: ReturnType<typeof setInterval> | null = null;
let lastLocalScan: UsageTelemetryStatus | null = null;
let scanRuntime: UsageTelemetryRuntimeStatus = {
  running: false,
  phase: 'idle',
  startedAt: null,
  updatedAt: null,
  lastError: null,
};
let collector = new SessionUsageCollector();

function emptyUnresolvedUsage() {
  return { sessions: 0, messages: 0, tokensTotal: 0 };
}

function projectNameForPath(projectPath: string): string | undefined {
  return projectPath ? projectPath.split('/').filter(Boolean).at(-1) : undefined;
}

function localUserRowsFromSessions(sessions: SessionEntry[]): UserUsageTelemetryRow[] {
  return sessions
    .filter((session) => session.tokens.total > 0 || session.messageCount > 0)
    .map((session) => ({
      key: `local:${session.relPath}`,
      kind: 'local' as const,
      identity: {
        platform: 'local',
        type: 'person' as const,
        displayName: projectNameForPath(session.projectPath) || 'Local Claude Code',
        confidence: 'local-jsonl',
      },
      projectName: projectNameForPath(session.projectPath),
      workDir: session.projectPath || undefined,
      sessions: 1,
      messages: session.messageCount,
      tokensIn: session.tokens.input,
      tokensOut: session.tokens.output,
      cacheRead: session.tokens.cacheRead,
      cacheCreation: session.tokens.cacheCreation,
      tokensTotal: session.tokens.total,
      lastActiveAt: session.endTime || session.startTime || undefined,
    }));
}

function statusFromCollection(collection: UsageCollectionResult): UsageTelemetryStatus {
  const aggregate: UsageAggregate = collection.legacyParseResult.aggregate;

  return {
    connected: false,
    lastScan: collection.computedAt,
    sessions: aggregate.sessions,
    messages: aggregate.messages,
    imMessages: aggregate.imMessages,
    imTokensTotal: aggregate.imTotalTokens,
    tokensIn: aggregate.tokens.input,
    tokensOut: aggregate.tokens.output,
    cacheRead: aggregate.tokens.cacheRead,
    cacheCreation: aggregate.tokens.cacheCreation,
    totalTokens: aggregate.tokens.total,
    activeDays: aggregate.activeDays,
    hourly: aggregate.hourly,
    projects: aggregate.projects,
    workSecondsByDay: aggregate.workSecondsByDay,
    daily: aggregate.daily,
    localUsers: localUserRowsFromSessions(collection.legacyParseResult.sessions),
    unresolvedUsage: emptyUnresolvedUsage(),
  };
}

function setScanRuntime(patch: Partial<UsageTelemetryRuntimeStatus>): void {
  scanRuntime = {
    ...scanRuntime,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
}

function sanitizeScanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(token|secret|password|authorization)=([^\s]+)/gi, '$1=[hidden]');
}

async function doScan(cfg?: TaskBusConfig): Promise<UsageTelemetryStatus | null> {
  const startedAt = new Date().toISOString();
  scanRuntime = {
    running: true,
    phase: 'scanning',
    startedAt,
    updatedAt: startedAt,
    lastError: null,
  };

  try {
    const collection = await collector.collect();
    lastLocalScan = statusFromCollection(collection);
    if (cfg?.telemetry?.conversationUploadEnabled || cfg?.telemetry?.conversations?.uploadEnabled) {
      try {
        lastLocalScan.conversationUpload = await uploadConversationMessages(cfg);
      } catch (error) {
        lastLocalScan.conversationUpload = {
          enabled: true,
          endpointConfigured: true,
          totalDiscovered: 0,
          skippedAlreadyUploaded: 0,
          pending: 0,
          attempted: 0,
          accepted: 0,
          duplicated: 0,
          rejected: 0,
          lastError: sanitizeScanError(error),
        };
      }
    }
    setScanRuntime({ running: false, phase: 'done' });
    return lastLocalScan;
  } catch (error) {
    setScanRuntime({ running: false, phase: 'error', lastError: sanitizeScanError(error) });
    throw error;
  }
}

export async function scanTelemetryOnce(cfg?: TaskBusConfig): Promise<UsageTelemetryStatus | null> {
  return doScan(cfg);
}

export function configureUsageTelemetry(
  _options: {
    loadConversations?: () => Promise<ConversationTelemetryRow[]>;
    loadConversationMessages?: () => Promise<ConversationTelemetryRow[]>;
  } = {}
): void {
  collector = new SessionUsageCollector();
}

export async function startTelemetry(cfg: TaskBusConfig): Promise<void> {
  await stopTelemetry();
  if (!cfg.telemetry?.enabled) return;

  await doScan(cfg);
  scanInterval = setInterval(
    async () => {
      await doScan(cfg);
    },
    5 * 60 * 1000
  );
}

export async function stopTelemetry(): Promise<void> {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
}

export async function triggerScan(cfg: TaskBusConfig): Promise<UsageTelemetryStatus | null> {
  if (!cfg.telemetry?.enabled) return null;
  return doScan(cfg);
}

export function isTelemetryRunning(): boolean {
  return scanInterval !== null;
}

export function getTelemetryRuntimeStatus(): UsageTelemetryRuntimeStatus {
  return scanRuntime;
}

export async function getTelemetryStatus(): Promise<UsageTelemetryStatus | null> {
  return lastLocalScan;
}

export type { ConversationTelemetryRow, UsageTelemetryStatus };
