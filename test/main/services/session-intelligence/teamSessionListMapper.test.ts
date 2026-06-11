import { describe, expect, it } from 'vitest';

import { mergeLocalAndCcSessions } from '@main/services/session-intelligence/teamSessionListMapper';

import type { LocalSessionSummary } from '@main/services/session-intelligence/LocalSessionScanner';
import type { CcSessionListItem } from '@shared/types/ccConnect';

function localSession(id: string): LocalSessionSummary {
  return {
    id,
    title: 'Local Claude Session',
    projectId: 'team-opue',
    messageCount: 117,
    userMessageCount: 10,
    assistantMessageCount: 10,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    model: 'claude',
    active: true,
    live: true,
    startTime: '2026-06-11T00:00:00.000Z',
    endTime: '2026-06-11T01:00:00.000Z',
    createdAt: '2026-06-11T00:00:00.000Z',
    updatedAt: '2026-06-11T01:00:00.000Z',
  };
}

function ccSession(overrides: Partial<CcSessionListItem>): CcSessionListItem {
  return {
    id: 'oc_09d7d178a38cf860ed1967b83d6fc37d',
    name: '',
    session_key: 'feishu:oc_09d7d178a38cf860ed1967b83d6fc37d:ou_user',
    agent_session_id: undefined,
    agent_type: 'claudecode',
    active: true,
    live: true,
    history_count: 117,
    created_at: '2026-06-11T00:00:00.000Z',
    updated_at: '2026-06-11T01:00:00.000Z',
    last_message: { role: 'user', content: '？', timestamp: '2026-06-11T01:00:00.000Z' },
    platform: 'feishu',
    user_name: undefined,
    chat_name: undefined,
    ...overrides,
  };
}

describe('mergeLocalAndCcSessions', () => {
  it('uses agent_session_id as the local session id and keeps oc_* only as sessionKey', () => {
    const result = mergeLocalAndCcSessions(
      [localSession('claude-jsonl-session-id')],
      [ccSession({ agent_session_id: 'claude-jsonl-session-id' })],
      'team-opue'
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'claude-jsonl-session-id',
      sessionKey: 'feishu:oc_09d7d178a38cf860ed1967b83d6fc37d:ou_user',
      platform: 'feishu',
      historyCount: 117,
      lastMessage: { role: 'user', content: '？' },
    });
  });

  it('does not append an external oc_* session when it cannot be mapped to a local JSONL session', () => {
    const result = mergeLocalAndCcSessions(
      [],
      [ccSession({ agent_session_id: undefined })],
      'team-opue'
    );

    expect(result).toEqual([]);
  });
});
