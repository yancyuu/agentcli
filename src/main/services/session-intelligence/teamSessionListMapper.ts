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

  return localSessions
    .map((session): CcSession => {
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
      };
    })
    .sort((a, b) => timestampMs(b.updatedAt) - timestampMs(a.updatedAt));
}
