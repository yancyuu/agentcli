/**
 * UsageTelemetryService - scans Claude Code JSONL sessions to serve the
 * local usage view. Local-only: it never uploads anything.
 *
 * Centralized reporting of IM "digital employee" usage is handled separately
 * and per-turn by ExternalImUsageReporter, which pushes to the team-bus Redis
 * when the team bus is on (this box is part of a distributed Hermit fleet) and
 * usage reporting is opted in — see getImUplinkRedisConfig in server.ts. Local
 * JSONL scans are never pushed off-box.
 */

import type { ConversationTelemetryRow } from '@shared/types/api';
import type { TaskBusConfig } from '@shared/types/team';

import { SessionUsageCollector, type ConversationUsageRowsProvider } from './SessionUsageCollector';
import type { UsageAggregate } from './SessionUsageParser';
import { UsageAttributionService } from './UsageAttributionService';
import type { UsageCollectionResult, UsageTelemetryStatus } from './usageTypes';

let scanInterval: ReturnType<typeof setInterval> | null = null;
let lastLocalScan: UsageTelemetryStatus | null = null;
let collector = new SessionUsageCollector();
const usageAttribution = new UsageAttributionService();

function emptyUnresolvedUsage() {
  return { sessions: 0, messages: 0, tokensTotal: 0 };
}

function statusFromCollection(collection: UsageCollectionResult): UsageTelemetryStatus {
  const aggregate: UsageAggregate = collection.legacyParseResult.aggregate;
  const attributed = usageAttribution.attribute({
    computedAt: collection.computedAt,
    global: aggregate,
    conversations: collection.conversations,
  });

  return {
    connected: false,
    lastScan: collection.computedAt,
    sessions: aggregate.sessions,
    messages: aggregate.messages,
    tokensIn: aggregate.tokens.input,
    tokensOut: aggregate.tokens.output,
    cacheRead: aggregate.tokens.cacheRead,
    cacheCreation: aggregate.tokens.cacheCreation,
    totalTokens: aggregate.tokens.total,
    activeDays: aggregate.activeDays,
    hourly: aggregate.hourly,
    projects: aggregate.projects,
    workSecondsByDay: aggregate.workSecondsByDay,
    localUsers: attributed.localUsers,
    externalUsers: attributed.externalUsers,
    unresolvedUsage: attributed.unresolved ?? emptyUnresolvedUsage(),
  };
}

async function doScan(): Promise<UsageTelemetryStatus | null> {
  const collection = await collector.collect();
  lastLocalScan = statusFromCollection(collection);
  return lastLocalScan;
}

export function configureUsageTelemetry(options: {
  loadConversations?: ConversationUsageRowsProvider;
}): void {
  collector = new SessionUsageCollector(options.loadConversations);
}

export async function startTelemetry(cfg: TaskBusConfig): Promise<void> {
  await stopTelemetry();
  if (!cfg.telemetry?.enabled) return;

  // Immediate first scan, then refresh every 10 minutes. Scans are local-only
  // (no upload); the collector caches parsed results per file by size+mtime so
  // unchanged files only cost a stat.
  await doScan();
  scanInterval = setInterval(
    async () => {
      await doScan();
    },
    10 * 60 * 1000
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
  return doScan();
}

export function isTelemetryRunning(): boolean {
  return scanInterval !== null;
}

export async function getTelemetryStatus(): Promise<UsageTelemetryStatus | null> {
  return lastLocalScan;
}

export type { ConversationTelemetryRow, UsageTelemetryStatus };
