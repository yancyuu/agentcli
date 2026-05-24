/**
 * CcSessionsSection — 显示 cc-connect 会话列表。
 * 直接消费 /api/teams/:name/sessions 返回的 CcSession 结构，
 * 不依赖旧 Electron 项目系统。
 *
 * 改进：
 * - 分组：live 会话在上，inactive 在下
 * - 分页：默认 8 条，"加载更多"
 * - 取消按钮：live 会话右侧红色 X（hover 可见）
 */

import { useState } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import {
  AlertCircle,
  Loader2,
  MessageSquare,
  Monitor,
  Radio,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';

import type { CcSession } from '@shared/types';

const PAGE_SIZE = 8;

interface CcSessionsSectionProps {
  sessions: CcSession[];
  loading: boolean;
  error: string | null;
  onCancelSession?: (sessionId: string) => void;
}

export function CcSessionsSection({
  sessions,
  loading,
  error,
  onCancelSession,
}: CcSessionsSectionProps): React.JSX.Element {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-xs text-[var(--color-text-muted)]">
        <Loader2 size={14} className="animate-spin" />
        正在加载会话...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center gap-2 py-4 text-xs text-red-400">
        <AlertCircle size={14} />
        {error}
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-[var(--color-text-muted)]">
        <Monitor size={20} className="mx-auto mb-2 opacity-40" />
        暂无会话
      </div>
    );
  }

  const allSorted = [...sessions].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
  const liveSessions = allSorted.filter((s) => s.live);
  const inactiveSessions = allSorted.filter((s) => !s.live);
  const displayed = allSorted.slice(0, visibleCount);
  const hasMore = visibleCount < allSorted.length;

  return (
    <div className="space-y-1">
      {/* Live 分组标题 */}
      {liveSessions.length > 0 && (
        <div className="px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-emerald-400/70">
          运行中 ({liveSessions.length})
        </div>
      )}
      {displayed
        .filter((s) => s.live)
        .map((s) => (
          <CcSessionRow key={s.id} session={s} onCancel={onCancelSession} />
        ))}

      {/* Inactive 分组标题 */}
      {inactiveSessions.length > 0 && (
        <div className="px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
          历史 ({inactiveSessions.length})
        </div>
      )}
      {displayed
        .filter((s) => !s.live)
        .map((s) => (
          <CcSessionRow key={s.id} session={s} onCancel={onCancelSession} />
        ))}

      {/* 加载更多 */}
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
  );
}

function CcSessionRow({
  session,
  onCancel,
}: {
  session: CcSession;
  onCancel?: (sessionId: string) => void;
}): React.JSX.Element {
  const timeAgo = formatShortTime(new Date(session.updatedAt));
  const label = session.chatName || session.userName || session.sessionKey;
  const platformLabel = session.platform === 'bridge' ? 'Bridge' : session.platform;

  return (
    <div
      className={`group relative flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-xs transition-colors ${
        session.live
          ? 'border border-emerald-500/20 bg-emerald-500/5'
          : 'hover:bg-[var(--color-surface-raised)]'
      }`}
    >
      {/* 状态指示 */}
      <div className="mt-0.5 shrink-0">
        {session.live ? (
          <Radio size={12} className="animate-pulse text-emerald-400" />
        ) : session.active ? (
          <Wifi size={12} className="text-blue-400" />
        ) : (
          <WifiOff size={12} className="text-[var(--color-text-muted)] opacity-50" />
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
          <span className="flex items-center gap-0.5">
            <MessageSquare size={9} />
            {session.historyCount}
          </span>
          <span className="tabular-nums">{timeAgo}</span>
          {session.live && <span className="text-emerald-500 dark:text-emerald-400">进行中</span>}
        </div>

        {session.lastMessage && (
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

      {/* 取消按钮 — 仅 live 会话，hover 可见 */}
      {session.live && onCancel && (
        <button
          type="button"
          className="absolute right-2 top-2 shrink-0 rounded p-1 opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
          onClick={() => onCancel(session.id)}
          title="终止会话"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

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
