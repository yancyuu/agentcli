import { describe, expect, it } from 'vitest';

import { UsageAttributionService } from '@main/services/session-intelligence/UsageAttributionService';
import type { UsageAggregate } from '@main/services/session-intelligence/SessionUsageParser';
import type { ConversationTelemetryRow } from '@shared/types/api';

const globalUsage: UsageAggregate = {
  sessions: 0,
  messages: 0,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 },
  activeDays: 0,
  daily: {},
  hourly: new Array(24).fill(0),
  projects: [],
  events7d: [],
  workSecondsByDay: {},
};

function row(
  overrides: Omit<Partial<ConversationTelemetryRow>, 'identity' | 'usage' | 'content' | 'session'> & {
    identity: ConversationTelemetryRow['identity'];
    usage?: Partial<ConversationTelemetryRow['usage']>;
    content?: Partial<ConversationTelemetryRow['content']>;
    session?: Partial<ConversationTelemetryRow['session']>;
  }
): ConversationTelemetryRow {
  const inputTokens = overrides.usage?.inputTokens ?? 10;
  const outputTokens = overrides.usage?.outputTokens ?? 20;
  const cacheReadTokens = overrides.usage?.cacheReadTokens ?? 30;
  const cacheCreationTokens = overrides.usage?.cacheCreationTokens ?? 40;
  return {
    teamName: overrides.teamName ?? 'team-alpha',
    teamDisplayName: overrides.teamDisplayName ?? 'Team Alpha',
    projectName: overrides.projectName ?? 'team-alpha',
    session: {
      sessionKey: overrides.session?.sessionKey ?? 'session-1',
      updatedAt: overrides.session?.updatedAt ?? '2026-06-18T00:00:00.000Z',
      matchStatus: overrides.session?.matchStatus ?? 'matched',
      ...overrides.session,
    },
    identity: overrides.identity,
    content: {
      messageCount: overrides.content?.messageCount ?? 2,
      userMessageCount: overrides.content?.userMessageCount ?? 1,
      assistantMessageCount: overrides.content?.assistantMessageCount ?? 1,
      toolResultCount: overrides.content?.toolResultCount ?? 0,
      ...overrides.content,
    },
    usage: {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      totalTokens:
        overrides.usage?.totalTokens ??
        inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
      assistantTurnsWithUsage: overrides.usage?.assistantTurnsWithUsage ?? 1,
      models: overrides.usage?.models ?? {},
      toolCalls: overrides.usage?.toolCalls ?? {},
      usageSource: overrides.usage?.usageSource ?? 'claude-jsonl',
    },
  };
}

describe('UsageAttributionService', () => {
  it('aggregates multiple external IM sessions by platform and user id', () => {
    const result = new UsageAttributionService().attribute({
      computedAt: '2026-06-18T00:00:00.000Z',
      global: globalUsage,
      conversations: [
        row({
          session: { sessionKey: 'lark:user-a:1', updatedAt: '2026-06-18T01:00:00.000Z' },
          identity: {
            platform: 'lark',
            type: 'person',
            id: 'ou_user_a',
            userId: 'ou_user_a',
            displayName: 'Alice',
            userName: 'Alice',
            confidence: 'exact-id',
          },
          content: { messageCount: 3 },
          usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheCreationTokens: 40 },
        }),
        row({
          session: { sessionKey: 'lark:user-a:2', updatedAt: '2026-06-18T02:00:00.000Z' },
          identity: {
            platform: 'lark',
            type: 'person',
            id: 'ou_user_a',
            userId: 'ou_user_a',
            displayName: 'Alice Renamed',
            userName: 'Alice Renamed',
            confidence: 'exact-id',
          },
          content: { messageCount: 4 },
          usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4 },
        }),
      ],
    });

    expect(result.externalUsers).toHaveLength(1);
    expect(result.externalUsers[0]).toMatchObject({
      key: 'lark:user:ou_user_a',
      kind: 'external-im',
      sessions: 2,
      messages: 7,
      tokensIn: 11,
      tokensOut: 22,
      cacheRead: 33,
      cacheCreation: 44,
      tokensTotal: 110,
      lastActiveAt: '2026-06-18T02:00:00.000Z',
    });
  });

  it('keeps different platforms separated even when user ids match', () => {
    const result = new UsageAttributionService().attribute({
      computedAt: '2026-06-18T00:00:00.000Z',
      global: globalUsage,
      conversations: [
        row({
          identity: {
            platform: 'lark',
            type: 'person',
            id: 'same-user',
            userId: 'same-user',
            displayName: 'Lark User',
            confidence: 'exact-id',
          },
        }),
        row({
          identity: {
            platform: 'slack',
            type: 'person',
            id: 'same-user',
            userId: 'same-user',
            displayName: 'Slack User',
            confidence: 'exact-id',
          },
        }),
      ],
    });

    expect(result.externalUsers.map((user) => user.key).sort()).toEqual([
      'lark:user:same-user',
      'slack:user:same-user',
    ]);
  });

  it('tracks chat-only external sessions as unresolved instead of guessing a user', () => {
    const result = new UsageAttributionService().attribute({
      computedAt: '2026-06-18T00:00:00.000Z',
      global: globalUsage,
      conversations: [
        row({
          identity: {
            platform: 'lark',
            type: 'group',
            id: 'oc_group',
            chatId: 'oc_group',
            displayName: 'Engineering Group',
            confidence: 'exact-id',
          },
          content: { messageCount: 5 },
          usage: { totalTokens: 123 },
        }),
      ],
    });

    expect(result.externalUsers).toEqual([]);
    expect(result.unresolved).toEqual({ sessions: 1, messages: 5, tokensTotal: 123 });
  });

  it('sorts user rows by total tokens then messages', () => {
    const result = new UsageAttributionService().attribute({
      computedAt: '2026-06-18T00:00:00.000Z',
      global: globalUsage,
      conversations: [
        row({
          identity: {
            platform: 'local',
            type: 'person',
            displayName: 'small',
            confidence: 'session-key-only',
          },
          content: { messageCount: 100 },
          usage: { totalTokens: 100 },
        }),
        row({
          identity: {
            platform: 'local',
            type: 'person',
            displayName: 'large',
            confidence: 'session-key-only',
          },
          content: { messageCount: 1 },
          usage: { totalTokens: 200 },
        }),
      ],
    });

    expect(result.localUsers.map((user) => user.identity.displayName)).toEqual(['large', 'small']);
  });

  it('does not copy IM message content into attributed usage rows', () => {
    const result = new UsageAttributionService().attribute({
      computedAt: '2026-06-18T00:00:00.000Z',
      global: globalUsage,
      conversations: [
        row({
          identity: {
            platform: 'lark',
            type: 'person',
            id: 'ou_secret',
            userId: 'ou_secret',
            displayName: 'Sensitive User',
            confidence: 'exact-id',
          },
          content: {
            messageCount: 2,
            firstUserMessage: 'SECRET IM BODY should not be reported',
            lastUserMessage: 'ANOTHER SECRET BODY',
            text: 'FULL SECRET TRANSCRIPT',
            messages: [
              {
                role: 'user',
                content: 'NESTED SECRET MESSAGE',
                timestamp: '2026-06-18T00:00:00.000Z',
              },
            ],
          },
        }),
      ],
    });

    const serialized = JSON.stringify(result.externalUsers);
    expect(serialized).toContain('Sensitive User');
    expect(serialized).not.toContain('SECRET IM BODY');
    expect(serialized).not.toContain('ANOTHER SECRET BODY');
    expect(serialized).not.toContain('FULL SECRET TRANSCRIPT');
    expect(serialized).not.toContain('NESTED SECRET MESSAGE');
  });
});
