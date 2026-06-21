import type { ConversationTelemetryRow } from '@shared/types/api';
import type { ParseResult, UsageAggregate } from './SessionUsageParser';

export interface UsageCollectionResult {
  computedAt: string;
  legacyParseResult: ParseResult;
  conversations: ConversationTelemetryRow[];
}

export interface UsageTokenMetrics {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
}

export interface UserUsageTelemetryRow {
  key: string;
  kind: 'local' | 'external-im' | 'unresolved';
  identity: ConversationTelemetryRow['identity'];
  teamName?: string;
  teamDisplayName?: string;
  projectName?: string;
  sessions: number;
  messages: number;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheCreation: number;
  tokensTotal: number;
  lastActiveAt?: string;
}

export interface UsageUnresolvedSummary {
  sessions: number;
  messages: number;
  tokensTotal: number;
}

export interface UsageAttributionResult {
  computedAt: string;
  global: UsageAggregate;
  localUsers: UserUsageTelemetryRow[];
  externalUsers: UserUsageTelemetryRow[];
  unresolved: UsageUnresolvedSummary;
}

export interface UsageTelemetryProjectRow {
  cwd: string;
  sessions: number;
  messages: number;
  tokensIn: number;
  tokensOut: number;
  tokensTotal: number;
}

export interface UsageTelemetryStatus {
  connected: boolean;
  lastScan: string | null;
  sessions: number;
  messages: number;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheCreation: number;
  totalTokens: number;
  activeDays: number;
  hourly: number[];
  projects: UsageTelemetryProjectRow[];
  workSecondsByDay: Record<string, number>;
  localUsers: UserUsageTelemetryRow[];
  externalUsers: UserUsageTelemetryRow[];
  unresolvedUsage: UsageUnresolvedSummary;
}
