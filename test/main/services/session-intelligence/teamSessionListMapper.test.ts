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

  it('appends external cc-connect sessions before local JSONL exists', () => {
    const result = mergeLocalAndCcSessions(
      [],
      [ccSession({ agent_session_id: undefined, name: '飞书群会话' })],
      'team-opue'
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'oc_09d7d178a38cf860ed1967b83d6fc37d',
      title: '飞书群会话',
      projectId: 'team-opue',
      sessionKey: 'feishu:oc_09d7d178a38cf860ed1967b83d6fc37d:ou_user',
      platform: 'feishu',
      historyCount: 117,
      lastMessage: { role: 'user', content: '？' },
    });
  });

  it('shows Admin Loop cc-connect sessions from the shared my-project binding', () => {
    const result = mergeLocalAndCcSessions(
      [],
      [
        ccSession({
          id: 'oc_admin',
          name: 'Admin Loop',
          session_key: 'feishu:chat_admin:ou_admin',
          updated_at: '2026-06-11T02:00:00.000Z',
        }),
      ],
      'system-manager'
    );

    expect(result).toEqual([
      expect.objectContaining({
        id: 'oc_admin',
        title: 'Admin Loop',
        projectId: 'system-manager',
        sessionKey: 'feishu:chat_admin:ou_admin',
        platform: 'feishu',
      }),
    ]);
  });
});
