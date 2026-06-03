/**
 * SidebarSessions — cc-connect 会话列表（侧边栏）。
 *
 * - 默认按当前选中团队隔离展示（无选中团队时展示全部）
 * - 分组：live 在上，inactive 在下
 * - 分页：默认 8 条，"加载更多"
 * - 关闭：live 会话 hover 显示红色 X，关闭后进入历史会话
 * - 搜索：按会话标题、团队名、最后消息过滤
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@renderer/api';
import { useStore } from '@renderer/store';
import { formatDistanceToNowStrict } from 'date-fns';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  MessageSquare,
  Radio,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';

import type { CcSession, CcSessionDetail, TeamChangeEvent, TeamSummary } from '@shared/types';

const PAGE_SIZE = 8;
const REFRESH_INTERVAL_MS = 2000;
const SESSION_DETAIL_PAGE_SIZE = 50;

interface TaggedSession extends CcSession {
  teamName: string;
  teamDisplayName: string;
}

export const SidebarSessions = (): React.JSX.Element => {
  const { selectedTeamName, activeTabId, paneLayout } = useStore((s) => ({
    selectedTeamName: s.selectedTeamName,
    activeTabId: s.activeTabId,
    paneLayout: s.paneLayout,
  }));
  const [allSessions, setAllSessions] = useState<TaggedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [searchQuery, setSearchQuery] = useState('');
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const refreshInFlightRef = useRef(false);
  const needsRefreshRef = useRef(false);

  const activeTeamTabName = useMemo(() => {
    if (!activeTabId) return null;
    for (const pane of paneLayout.panes) {
      const tab = pane.tabs.find((item) => item.id === activeTabId);
      if (tab?.type === 'team' && tab.teamName) {
        return tab.teamName;
      }
    }
    return null;
  }, [activeTabId, paneLayout.panes]);

  // 优先使用当前激活的团队 Tab，避免 selectedTeamName 在多标签下滞后导致串团队。
  const scopedTeamName = activeTeamTabName ?? selectedTeamName ?? null;

  const fetchAll = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (refreshInFlightRef.current) {
        needsRefreshRef.current = true;
        return;
      }
      const { silent = false } = opts;
      refreshInFlightRef.current = true;
      if (!silent) {
        setLoading(true);
      }
      setError(null);
      try {
        const teamList = await api.teams.list();
        const scopedTeams: TeamSummary[] = scopedTeamName
          ? teamList.filter((team) => team.teamName === scopedTeamName)
          : teamList;

        const results = await Promise.allSettled(
          scopedTeams.map(async (t) => {
            try {
              const sessions = await api.teams.getTeamSessions(t.teamName);
              return sessions.map((s) => ({
                ...s,
                teamName: t.teamName,
                teamDisplayName: t.displayName || t.teamName,
              }));
            } catch {
              return [] as TaggedSession[];
            }
          })
        );

        const merged: TaggedSession[] = [];
        for (const r of results) {
          if (r.status === 'fulfilled') merged.push(...r.value);
        }
        setAllSessions(merged);
        setExpandedId((prev) => (prev && merged.some((s) => s.id === prev) ? prev : null));
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        refreshInFlightRef.current = false;
        if (!silent) {
          setLoading(false);
        }
        if (needsRefreshRef.current) {
          needsRefreshRef.current = false;
          void fetchAll({ silent: true });
        }
      }
    },
    [scopedTeamName]
  );

  /** Incremental refresh: only re-fetch sessions for one team */
  const refreshTeam = useCallback(async (teamName: string) => {
    try {
      const sessions = await api.teams.getTeamSessions(teamName);
      const tagged = sessions.map((s) => ({
        ...s,
        teamName,
        teamDisplayName: teamName,
      }));
      setAllSessions((prev) => {
        const others = prev.filter((s) => s.teamName !== teamName);
        return [...others, ...tagged];
      });
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setExpandedId(null);
  }, [scopedTeamName]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void fetchAll({ silent: true });
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [fetchAll]);

  useEffect(() => {
    const unsubscribe = api.teams.onTeamChange?.((_event, change) => {
      if (scopedTeamName && change.teamName !== scopedTeamName) {
        return;
      }
      // Only refresh the session list on events that may change session state.
      // Skip high-frequency events like lead-context, tool-activity, lead-activity
      // that don't affect the session list.
      const sessionRelevantTypes: ReadonlySet<string> = new Set([
        'inbox',
        'lead-message',
        'task',
        'config',
        'process',
        'member-spawn',
      ]);
      if (!sessionRelevantTypes.has(change.type)) {
        return;
      }
      // Incremental refresh for the changed team — lightweight, no blocking
      void refreshTeam(change.teamName);
    });
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [fetchAll, scopedTeamName]);

  const handleCancel = useCallback(
    async (teamName: string, sessionId: string) => {
      setCancellingId(sessionId);
      try {
        await api.teams.cancelSession(teamName, sessionId);
        // Remove from list immediately
        setAllSessions((prev) => prev.filter((s) => s.id !== sessionId));
        // Clear expanded state if this session was expanded
        if (expandedId === sessionId) {
          setExpandedId(null);
        }
      } catch (err) {
        console.error('Failed to close session:', err);
      } finally {
        setCancellingId(null);
      }
    },
    [expandedId]
  );

  const handleExpand = useCallback((teamName: string, sessionId: string) => {
    setExpandedId((prev) => (prev === sessionId ? null : sessionId));
  }, []);

  // Filter + sort
  const filtered = allSessions.filter((s) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const title = (s.title || '').toLowerCase();
    const team = s.teamDisplayName.toLowerCase();
    const lastMsg = (s.lastMessage?.content || '').toLowerCase();
    return title.includes(q) || team.includes(q) || lastMsg.includes(q);
  });

  const allSorted = [...filtered].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
  const liveSessions = allSorted.filter((s) => s.live);
  const inactiveSessions = allSorted.filter((s) => !s.live);
  const displayed = allSorted.slice(0, visibleCount);
  const hasMore = visibleCount < allSorted.length;

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <div className="shrink-0 border-b px-2 py-1.5">
          <div className="h-6 animate-pulse rounded bg-[var(--color-surface-raised)]" />
        </div>
        <div className="space-y-1 p-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded bg-[var(--color-surface-raised)]" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertCircle size={24} className="text-red-400 opacity-60" />
        <p className="text-xs text-red-400">{error}</p>
        <button
          type="button"
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)]"
          onClick={() => void fetchAll()}
        >
          <RefreshCw size={12} />
          重试
        </button>
      </div>
    );
  }

  if (allSessions.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <MessageSquare size={28} className="opacity-30" />
        <p className="text-sm text-[var(--color-text-muted)]">
          {scopedTeamName ? '当前团队暂无会话' : '暂无会话'}
        </p>
        <p className="text-xs text-[var(--color-text-muted)] opacity-60">
          {scopedTeamName ? '切换团队后会自动隔离展示' : '团队收到消息后会显示在这里'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Search */}
      <div className="flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5">
        <Search size={12} className="shrink-0 text-[var(--color-text-muted)]" />
        <input
          type="text"
          placeholder="搜索会话..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setVisibleCount(PAGE_SIZE);
          }}
          className="min-w-0 flex-1 bg-transparent text-[11px] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none"
        />
        {searchQuery && (
          <button
            type="button"
            className="shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            onClick={() => setSearchQuery('')}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {/* Live section */}
        {liveSessions.length > 0 && (
          <>
            <div className="px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-emerald-400/70">
              运行中 ({liveSessions.length})
            </div>
            {displayed
              .filter((s) => s.live)
              .map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  onCancel={handleCancel}
                  onExpand={handleExpand}
                  isExpanded={expandedId === s.id}
                  cancelling={cancellingId === s.id}
                />
              ))}
          </>
        )}

        {/* Inactive section */}
        {inactiveSessions.length > 0 && (
          <>
            <div className="px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              历史 ({inactiveSessions.length})
            </div>
            {displayed
              .filter((s) => !s.live)
              .map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  onCancel={handleCancel}
                  onExpand={handleExpand}
                  isExpanded={expandedId === s.id}
                  cancelling={false}
                />
              ))}
          </>
        )}

        {/* Load more */}
        {hasMore && (
          <button
            type="button"
            className="mx-auto mt-2 block rounded-md px-3 py-1 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text)]"
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
          >
            加载更多 ({allSorted.length - visibleCount} 条)
          </button>
        )}
      </div>
    </div>
  );
};

interface SessionRowProps {
  session: TaggedSession;
  onCancel: (teamName: string, sessionId: string) => void;
  onExpand: (teamName: string, sessionId: string) => void;
  isExpanded: boolean;
  cancelling: boolean;
}

const SessionRow = ({
  session,
  onCancel,
  onExpand,
  isExpanded,
  cancelling,
}: Readonly<SessionRowProps>): React.JSX.Element => {
  const timeAgo = formatShortTime(new Date(session.updatedAt));
  const label = session.chatName || session.title || session.userName || session.sessionKey;
  const platformLabel = session.platform === 'bridge' ? 'Bridge' : session.platform;
  const [detail, setDetail] = useState<CcSessionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(SESSION_DETAIL_PAGE_SIZE);
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);
  const hasMoreHistory =
    detail != null &&
    Array.isArray(detail.history) &&
    detail.history.length < Math.max(detail.historyCount ?? 0, detail.history.length);

  // Fetch detail when expanded
  useEffect(() => {
    if (!isExpanded) {
      setDetail(null);
      setLoadingDetail(false);
      setLoadingMoreHistory(false);
      setHistoryLimit(SESSION_DETAIL_PAGE_SIZE);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    const isIncrementalLoad = historyLimit > SESSION_DETAIL_PAGE_SIZE;
    setLoadingMoreHistory(isIncrementalLoad);
    void (async () => {
      try {
        const d = await api.teams.getSessionDetail(session.teamName, session.id, historyLimit);
        if (!cancelled) setDetail(d);
      } catch {
        if (!cancelled) setDetail(null);
      } finally {
        if (!cancelled) {
          setLoadingDetail(false);
          setLoadingMoreHistory(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [historyLimit, isExpanded, session.teamName, session.id]);

  // While a live session stays expanded, keep its detail fresh with a silent
  // refetch (no skeleton flash) so newly arrived messages show without needing
  // to collapse and reopen.
  useEffect(() => {
    if (!isExpanded || !session.live) {
      return;
    }
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      void (async () => {
        try {
          const d = await api.teams.getSessionDetail(session.teamName, session.id, historyLimit);
          setDetail(d);
        } catch {
          // silent — transient fetch failures are retried on the next tick
        }
      })();
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [isExpanded, session.live, session.teamName, session.id, historyLimit]);

  // SSE-driven immediate refresh: when inbox or lead-message events arrive for
  // this session's team, refresh the detail right away instead of waiting for
  // the next polling cycle. This makes agent replies appear in <100ms.
  useEffect(() => {
    if (!isExpanded) {
      return;
    }
    const unsubscribe = api.teams.onTeamChange?.((_event, change: TeamChangeEvent) => {
      if (change.teamName !== session.teamName) {
        return;
      }
      if (change.type !== 'inbox' && change.type !== 'lead-message') {
        return;
      }
      void (async () => {
        try {
          const d = await api.teams.getSessionDetail(session.teamName, session.id, historyLimit);
          setDetail(d);
        } catch {
          // silent
        }
      })();
    });
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [isExpanded, session.teamName, session.id, historyLimit]);

  // Final refresh when session transitions from live → non-live.
  // The polling useEffect above stops when live becomes false, which can miss
  // the last few messages. This effect ensures we capture the complete
  // conversation when the agent finishes.
  const prevLiveRef = useRef(session.live);
  useEffect(() => {
    const wasLive = prevLiveRef.current;
    prevLiveRef.current = session.live;
    if (wasLive && !session.live && isExpanded) {
      void (async () => {
        try {
          const d = await api.teams.getSessionDetail(session.teamName, session.id, historyLimit);
          setDetail(d);
        } catch {
          // silent
        }
      })();
    }
  }, [session.live, isExpanded, session.teamName, session.id, historyLimit]);

  const handleLoadMoreHistory = useCallback(() => {
    if (loadingDetail || loadingMoreHistory || !hasMoreHistory) {
      return;
    }
    setHistoryLimit((prev) => prev + SESSION_DETAIL_PAGE_SIZE);
  }, [hasMoreHistory, loadingDetail, loadingMoreHistory]);

  return (
    <>
      <div
        className={`group relative flex w-full items-start gap-2 px-2.5 py-2 text-xs transition-colors ${
          isExpanded ? 'bg-[var(--color-surface-raised)]' : 'hover:bg-[var(--color-surface-raised)]'
        }`}
      >
        {/* Expand chevron */}
        <button
          type="button"
          className="mt-0.5 shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          onClick={() => onExpand(session.teamName, session.id)}
          title={isExpanded ? '收起' : '展开会话详情'}
        >
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>

        {/* Status */}
        <div className="mt-0.5 shrink-0">
          {session.live ? (
            <Radio size={12} className="animate-pulse text-emerald-400" />
          ) : (
            <MessageSquare size={12} className="text-[var(--color-text-muted)] opacity-50" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {session.live && (
              <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400" />
            )}
            <span className="truncate font-medium text-[var(--color-text)]">{label}</span>
          </div>

          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
            <span className="rounded bg-[var(--color-surface-raised)] px-1 py-0.5">
              {platformLabel}
            </span>
            <span className="truncate">{session.teamDisplayName}</span>
            <span className="tabular-nums">{timeAgo}</span>
          </div>

          {session.lastMessage?.content && (
            <p className="mt-1 truncate text-[10px] text-[var(--color-text-muted)]">
              <span
                className={
                  session.lastMessage.role === 'user'
                    ? 'text-blue-400'
                    : 'text-[var(--color-text-muted)]'
                }
              >
                {session.lastMessage.role === 'user' ? '用户' : 'Agent'}：
              </span>
              {session.lastMessage.content.slice(0, 80)}
              {session.lastMessage.content.length > 80 ? '…' : ''}
            </p>
          )}
        </div>

        {/* Cancel button */}
        {session.live && (
          <button
            type="button"
            className="absolute right-2 top-2 shrink-0 rounded p-1 opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50 group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              onCancel(session.teamName, session.id);
            }}
            disabled={cancelling}
            title="关闭会话并归档"
          >
            {cancelling ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
          </button>
        )}
      </div>

      {/* Inline expanded messages */}
      {isExpanded && (
        <div className="ml-5 border-l-2 border-[var(--color-border)]">
          {loadingDetail && !detail && (
            <div className="px-3 py-3">
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-3 animate-pulse rounded bg-[var(--color-surface-raised)]"
                  />
                ))}
              </div>
            </div>
          )}
          {detail && (
            <>
              {detail.history.length === 0 ? (
                <div className="px-3 py-3 text-xs text-[var(--color-text-muted)]">暂无消息</div>
              ) : (
                <>
                  <div className="divide-[var(--color-border)]/50 max-h-64 divide-y overflow-y-auto">
                    {[...detail.history].reverse().map((msg, i) => (
                      <div key={i} className="px-3 py-2 text-[11px]">
                        <div className="flex items-center gap-2">
                          <span
                            className={`shrink-0 text-[10px] font-medium ${
                              msg.role === 'user'
                                ? 'text-blue-400'
                                : 'text-[var(--color-text-muted)]'
                            }`}
                          >
                            {msg.role === 'user' ? '用户' : 'Agent'}
                          </span>
                          <span className="text-[10px] text-[var(--color-text-muted)] opacity-60">
                            {formatMessageTime(msg.timestamp)}
                          </span>
                        </div>
                        <div className="mt-1 whitespace-pre-wrap break-words text-[var(--color-text)]">
                          {msg.content.slice(0, 500)}
                          {msg.content.length > 500 ? '…' : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                  {hasMoreHistory && (
                    <div className="border-[var(--color-border)]/50 border-t px-3 py-2">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={handleLoadMoreHistory}
                        disabled={loadingDetail || loadingMoreHistory}
                      >
                        {loadingMoreHistory ? (
                          <>
                            <Loader2 size={12} className="animate-spin" />
                            正在加载更早消息...
                          </>
                        ) : (
                          <>
                            加载更早消息 ({Math.max(detail.historyCount - detail.history.length, 0)}{' '}
                            条)
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
};

function formatShortTime(date: Date): string {
  try {
    const distance = formatDistanceToNowStrict(date, { addSuffix: false });
    return distance
      .replace(' seconds', 's')
      .replace(' second', 's')
      .replace(' minutes', 'm')
      .replace(' minute', 'm')
      .replace(' hours', 'h')
      .replace(' hour', 'h')
      .replace(' days', 'd')
      .replace(' day', 'd')
      .replace(' weeks', 'w')
      .replace(' week', 'w')
      .replace(' months', 'mo')
      .replace(' month', 'mo')
      .replace(' years', 'y')
      .replace(' year', 'y');
  } catch {
    return '';
  }
}

function formatMessageTime(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);

    if (diffSec < 60) return '刚刚';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m 前`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h 前`;
    return `${Math.floor(diffSec / 86400)}d 前`;
  } catch {
    return '';
  }
}
