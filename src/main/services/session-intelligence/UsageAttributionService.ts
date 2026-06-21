import type { ConversationTelemetryRow } from '@shared/types/api';
import type { UsageAggregate } from './SessionUsageParser';
import type { UsageAttributionResult, UserUsageTelemetryRow } from './usageTypes';

function usageKey(row: ConversationTelemetryRow): string | null {
  const identity = row.identity;
  if (identity.platform === 'local') return `local:${identity.displayName}`;
  if (identity.userId) return `${identity.platform}:user:${identity.userId}`;
  return null;
}

function usageKind(row: ConversationTelemetryRow): UserUsageTelemetryRow['kind'] {
  if (row.identity.platform === 'local') return 'local';
  if (row.identity.userId) return 'external-im';
  return 'unresolved';
}

function latestTimestamp(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

function shortId(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}…${value.slice(-6)}`;
}

function displayIdentityForUsage(
  row: ConversationTelemetryRow
): ConversationTelemetryRow['identity'] {
  if (row.identity.platform !== 'local' && row.identity.userId) {
    return {
      ...row.identity,
      type: 'person',
      id: row.identity.userId,
      displayName:
        row.identity.userName ??
        row.identity.displayName ??
        `${row.identity.platform} 未解析用户 ${shortId(row.identity.userId)}`,
    };
  }
  return row.identity;
}

export class UsageAttributionService {
  attribute(input: {
    computedAt: string;
    global: UsageAggregate;
    conversations: ConversationTelemetryRow[];
  }): UsageAttributionResult {
    const byKey = new Map<string, UserUsageTelemetryRow>();
    const unresolved = { sessions: 0, messages: 0, tokensTotal: 0 };

    for (const row of input.conversations) {
      const kind = usageKind(row);
      const key = usageKey(row);
      if (!key || kind === 'unresolved') {
        unresolved.sessions += 1;
        unresolved.messages += row.content.messageCount;
        unresolved.tokensTotal += row.usage.totalTokens;
        continue;
      }

      const existing = byKey.get(key) ?? {
        key,
        kind,
        identity: displayIdentityForUsage(row),
        teamName: row.teamName || undefined,
        teamDisplayName: row.teamDisplayName || undefined,
        projectName: row.projectName || undefined,
        sessions: 0,
        messages: 0,
        tokensIn: 0,
        tokensOut: 0,
        cacheRead: 0,
        cacheCreation: 0,
        tokensTotal: 0,
        lastActiveAt: undefined,
      };

      existing.sessions += 1;
      existing.messages += row.content.messageCount;
      existing.tokensIn += row.usage.inputTokens;
      existing.tokensOut += row.usage.outputTokens;
      existing.cacheRead += row.usage.cacheReadTokens;
      existing.cacheCreation += row.usage.cacheCreationTokens;
      existing.tokensTotal += row.usage.totalTokens;
      existing.lastActiveAt = latestTimestamp(
        existing.lastActiveAt,
        row.session.updatedAt ?? row.session.endTime ?? row.session.startTime
      );
      byKey.set(key, existing);
    }

    const rows = [...byKey.values()].sort(
      (a, b) => b.tokensTotal - a.tokensTotal || b.messages - a.messages
    );
    return {
      computedAt: input.computedAt,
      global: input.global,
      localUsers: rows.filter((row) => row.kind === 'local'),
      externalUsers: rows.filter((row) => row.kind === 'external-im'),
      unresolved,
    };
  }
}
