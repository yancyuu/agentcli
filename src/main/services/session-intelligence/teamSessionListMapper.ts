import type { LocalSessionSummary } from './LocalSessionScanner';
import type { CcSessionListItem } from '@shared/types/ccConnect';
import type { CcSession } from '@shared/types/api';

function toLastMessage(session: CcSessionListItem): CcSession['lastMessage'] {
  return session.last_message
    ? {
        role: session.last_message.role,
        content: session.last_message.content,
        timestamp: session.last_message.timestamp,
      }
    : null;
}

function timestampMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapCcOnlySession(session: CcSessionListItem, projectId: string): CcSession {
  return {
    id: session.agent_session_id || session.id,
    title: session.name || session.session_key,
    projectId,
    sessionKey: session.session_key,
    platform: session.platform,
    userName: session.user_name ?? null,
    chatName: session.chat_name ?? null,
    active: session.active,
    live: session.live,
    historyCount: session.history_count,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    lastMessage: toLastMessage(session),
    hasLocalFile: false,
  };
}

export function filterHiddenTeamSessions(
  localSessions: LocalSessionSummary[],
  ccSessions: CcSessionListItem[],
  hiddenIds: ReadonlySet<string>
): { localSessions: LocalSessionSummary[]; ccSessions: CcSessionListItem[] } {
  if (hiddenIds.size === 0) {
    return { localSessions, ccSessions };
  }

  return {
    localSessions: localSessions.filter((session) => !hiddenIds.has(session.id)),
    ccSessions: ccSessions.filter((session) => {
      const ids = [session.id, session.agent_session_id].filter(
        (id): id is string => typeof id === 'string' && id.length > 0
      );
      return ids.every((id) => !hiddenIds.has(id));
    }),
  };
}

export function mergeLocalAndCcSessions(
  localSessions: LocalSessionSummary[],
  ccSessions: CcSessionListItem[],
  projectId: string
): CcSession[] {
  const localSessionIds = new Set(localSessions.map((session) => session.id));
  const ccByLocalSessionId = new Map(
    ccSessions
      .map((session) => [session.agent_session_id || session.id, session] as const)
      .filter(([localSessionId]) => localSessionIds.has(localSessionId))
  );

  const localResults = localSessions.map((session): CcSession => {
    const ccMeta = ccByLocalSessionId.get(session.id);
    return {
      id: session.id,
      title: session.title || session.id,
      projectId,
      sessionKey: ccMeta?.session_key ?? session.id,
      platform: ccMeta?.platform ?? 'local',
      userName: ccMeta?.user_name ?? null,
      chatName: ccMeta?.chat_name ?? null,
      active: session.active,
      live: session.live,
      historyCount: session.messageCount,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      lastMessage: ccMeta ? toLastMessage(ccMeta) : null,
      hasLocalFile: true,
    };
  });

  const ccOnlyResults = ccSessions
    .filter((session) => !localSessionIds.has(session.agent_session_id || session.id))
    .map((session) => mapCcOnlySession(session, projectId));

  return [...localResults, ...ccOnlyResults].sort(
    (a, b) => timestampMs(b.updatedAt) - timestampMs(a.updatedAt)
  );
}
