import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import type { CollabTask } from '@shared/types';
import { ArrowRight, CheckCircle2, Clock, RefreshCw, RotateCcw, Send, XCircle } from 'lucide-react';

import { api } from '@renderer/api';

const DEFAULT_VISIBLE_TASK_LIMIT = 4;

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending_accept: <Clock size={12} />,
  accepted: <ArrowRight size={12} />,
  delivered: <CheckCircle2 size={12} />,
  revision: <RotateCcw size={12} />,
  approved: <CheckCircle2 size={12} />,
  rejected: <XCircle size={12} />,
  failed: <XCircle size={12} />,
};

const COLLAB_STATUS_STYLE: Record<
  string,
  { bg: string; text: string; ring: string; label: string }
> = {
  pending_accept: {
    bg: 'bg-yellow-500/15',
    text: 'text-yellow-700 dark:text-yellow-300',
    ring: 'ring-yellow-500/20',
    label: '待接单',
  },
  accepted: {
    bg: 'bg-blue-500/15',
    text: 'text-blue-700 dark:text-blue-300',
    ring: 'ring-blue-500/20',
    label: '执行中',
  },
  delivered: {
    bg: 'bg-violet-500/15',
    text: 'text-violet-700 dark:text-violet-300',
    ring: 'ring-violet-500/20',
    label: '待审核',
  },
  revision: {
    bg: 'bg-orange-500/15',
    text: 'text-orange-700 dark:text-orange-300',
    ring: 'ring-orange-500/20',
    label: '修改中',
  },
  approved: {
    bg: 'bg-emerald-500/15',
    text: 'text-emerald-700 dark:text-emerald-300',
    ring: 'ring-emerald-500/20',
    label: '已完成',
  },
  rejected: {
    bg: 'bg-red-500/15',
    text: 'text-red-700 dark:text-red-300',
    ring: 'ring-red-500/20',
    label: '已拒绝',
  },
  failed: {
    bg: 'bg-red-500/15',
    text: 'text-red-700 dark:text-red-300',
    ring: 'ring-red-500/20',
    label: '失败',
  },
};

type CollabViewFilter = 'all' | 'outgoing' | 'incoming' | 'action_needed' | 'exception';

const VIEW_FILTERS: { id: CollabViewFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'outgoing', label: '我派出的' },
  { id: 'incoming', label: '派给我的' },
  { id: 'action_needed', label: '待我处理' },
  { id: 'exception', label: '异常' },
];

function isActionNeeded(task: CollabTask, teamName: string): boolean {
  if (task.toTeam === teamName && task.status === 'pending_accept') return true;
  if (task.toTeam === teamName && (task.status === 'accepted' || task.status === 'revision')) {
    return true;
  }
  if (task.fromTeam === teamName && task.status === 'delivered') return true;
  return false;
}

function isException(task: CollabTask): boolean {
  if (task.status === 'rejected' || task.status === 'failed') return true;
  if (!task.deadline) return false;
  const overdue = new Date(task.deadline).getTime() < Date.now();
  return overdue && !['approved', 'rejected', 'failed'].includes(task.status);
}

function filterTasks(tasks: CollabTask[], teamName: string, view: CollabViewFilter): CollabTask[] {
  const related = tasks.filter((t) => t.fromTeam === teamName || t.toTeam === teamName);
  switch (view) {
    case 'outgoing':
      return related.filter((t) => t.fromTeam === teamName);
    case 'incoming':
      return related.filter((t) => t.toTeam === teamName);
    case 'action_needed':
      return related.filter((t) => isActionNeeded(t, teamName));
    case 'exception':
      return related.filter((t) => isException(t));
    default:
      return related;
  }
}

// ── Props ───────────────────────────────────────────────────────────

interface CollabBoardPanelProps {
  teamName: string;
}

// ── Component ───────────────────────────────────────────────────────

export function CollabBoardPanel({ teamName }: CollabBoardPanelProps) {
  const [tasks, setTasks] = useState<CollabTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewFilter, setViewFilter] = useState<CollabViewFilter>('all');
  const [revisionInput, setRevisionInput] = useState<Record<string, string>>({});
  const [showAllTasks, setShowAllTasks] = useState(false);

  const fetchBoard = useCallback(async () => {
    try {
      const res = await api.collab.getBoard();
      const nextTasks = Array.isArray(res)
        ? (res as CollabTask[])
        : Array.isArray(res?.tasks)
          ? res.tasks
          : [];
      setTasks(nextTasks);
    } catch {
      // degraded
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBoard();
    const handleRefresh = () => void fetchBoard();
    window.addEventListener('collab:refresh', handleRefresh);
    const interval = setInterval(fetchBoard, 10_000);
    return () => {
      window.removeEventListener('collab:refresh', handleRefresh);
      clearInterval(interval);
    };
  }, [fetchBoard]);

  const visibleTasks = useMemo(
    () => filterTasks(tasks, teamName, viewFilter),
    [tasks, teamName, viewFilter]
  );

  const handleAccept = async (task: CollabTask) => {
    try {
      await api.collab.accept(task.toTeam, task.dispatchId);
      await fetchBoard();
    } catch {
      // error
    }
  };

  const handleReject = async (task: CollabTask) => {
    const reason = prompt('拒绝原因（可选）:');
    try {
      await api.collab.reject(task.toTeam, task.dispatchId, reason ?? undefined);
      await fetchBoard();
    } catch {
      // error
    }
  };

  const handleApprove = async (task: CollabTask) => {
    try {
      await api.collab.approve(task.fromTeam, task.dispatchId);
      await fetchBoard();
    } catch {
      // error
    }
  };

  const handleRevision = async (task: CollabTask) => {
    const feedback = revisionInput[task.dispatchId];
    if (!feedback?.trim()) return;
    try {
      await api.collab.revision(task.fromTeam, task.dispatchId, feedback.trim());
      setRevisionInput((prev) => {
        const next = { ...prev };
        delete next[task.dispatchId];
        return next;
      });
      await fetchBoard();
    } catch {
      // error
    }
  };

  const handleDeliver = async (task: CollabTask) => {
    const result = prompt('输入交付结果（摘要即可，大文件请用路径）:');
    if (!result?.trim()) return;
    try {
      await api.collab.deliver(task.toTeam, task.dispatchId, result.trim());
      await fetchBoard();
    } catch {
      // error
    }
  };

  const sortedVisibleTasks = useMemo(
    () =>
      [...visibleTasks].sort((a, b) => {
        const actionDelta =
          Number(isActionNeeded(b, teamName)) - Number(isActionNeeded(a, teamName));
        if (actionDelta !== 0) return actionDelta;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }),
    [visibleTasks, teamName]
  );
  const displayedTasks = useMemo(
    () =>
      showAllTasks ? sortedVisibleTasks : sortedVisibleTasks.slice(0, DEFAULT_VISIBLE_TASK_LIMIT),
    [showAllTasks, sortedVisibleTasks]
  );
  const hiddenTaskCount = Math.max(0, sortedVisibleTasks.length - displayedTasks.length);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-xs text-[var(--color-text-muted)]">
        加载中…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {VIEW_FILTERS.map((filter) => (
          <button
            key={filter.id}
            type="button"
            onClick={() => setViewFilter(filter.id)}
            className={cn(
              'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
              viewFilter === filter.id
                ? 'bg-yellow-500/15 text-yellow-700 ring-1 ring-yellow-500/20 dark:text-yellow-300'
                : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]'
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {visibleTasks.length === 0 ? (
        <div className="flex w-full justify-center rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-6">
          <div className="mx-auto flex max-w-lg flex-col items-center text-center">
            <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-yellow-500/15 text-yellow-600 dark:text-yellow-300">
              <Send size={18} />
            </div>
            <p className="text-sm font-medium text-[var(--color-text)]">
              {viewFilter === 'all' ? '暂无跨团队协作任务' : '当前筛选下没有协作任务'}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
              跨团队任务会先进入接单、执行、交付和审核流程，不会直接打断 Agent 当前上下文。
            </p>
            <div className="mt-4 grid w-full gap-2 text-left text-[11px] text-[var(--color-text-muted)] sm:grid-cols-3">
              <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-2">
                <p className="font-medium text-[var(--color-text-secondary)]">1. 派发</p>
                <p className="mt-0.5">在任务中 @目标团队，或由 Agent 使用跨团队任务工具派发。</p>
              </div>
              <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-2">
                <p className="font-medium text-[var(--color-text-secondary)]">2. 人工确认</p>
                <p className="mt-0.5">接收方人工接单或拒绝，避免任务自动打断团队工作。</p>
              </div>
              <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-2">
                <p className="font-medium text-[var(--color-text-secondary)]">3. 交付审核</p>
                <p className="mt-0.5">结果先交付，再由派发方审核通过或退回修改。</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-4 h-7 gap-1.5 text-xs"
              onClick={() => void fetchBoard()}
            >
              <RefreshCw size={12} />
              刷新协作任务
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {displayedTasks.map((task) => (
            <CollabTaskCard
              key={task.dispatchId}
              task={task}
              teamName={teamName}
              revisionInput={revisionInput[task.dispatchId] ?? ''}
              onRevisionInputChange={(v) =>
                setRevisionInput((prev) => ({ ...prev, [task.dispatchId]: v }))
              }
              onAccept={() => handleAccept(task)}
              onReject={() => handleReject(task)}
              onApprove={() => handleApprove(task)}
              onRevision={() => handleRevision(task)}
              onDeliver={() => handleDeliver(task)}
            />
          ))}
          {hiddenTaskCount > 0 && (
            <button
              type="button"
              className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2.5 py-1.5 text-left text-[11px] text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
              onClick={() => setShowAllTasks(true)}
            >
              还有 {hiddenTaskCount} 条跨团队派单，点击展开
            </button>
          )}
          {showAllTasks && sortedVisibleTasks.length > DEFAULT_VISIBLE_TASK_LIMIT && (
            <button
              type="button"
              className="rounded-md px-2 py-1 text-left text-[11px] text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
              onClick={() => setShowAllTasks(false)}
            >
              收起派单
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Single task card ─────────────────────────────────────────────────

interface CollabTaskCardProps {
  task: CollabTask;
  teamName: string;
  revisionInput: string;
  onRevisionInputChange: (value: string) => void;
  onAccept: () => void;
  onReject: () => void;
  onApprove: () => void;
  onRevision: () => void;
  onDeliver: () => void;
}

function CollabTaskCard({
  task,
  teamName,
  revisionInput,
  onRevisionInputChange,
  onAccept,
  onReject,
  onApprove,
  onRevision,
  onDeliver,
}: CollabTaskCardProps) {
  const isIncoming = task.toTeam === teamName;
  const isOrigin = task.fromTeam === teamName;
  const overdue =
    task.deadline &&
    new Date(task.deadline).getTime() < Date.now() &&
    !['approved', 'rejected', 'failed'].includes(task.status);
  const statusStyle = COLLAB_STATUS_STYLE[task.status] ?? COLLAB_STATUS_STYLE.pending_accept;
  const target = isOrigin ? task.toTeamDisplay : task.fromTeamDisplay;
  const displayLabel = task.status === 'pending_accept' && isOrigin ? '已派发' : statusStyle.label;
  const shortId = task.dispatchId.slice(0, 8);

  return (
    <div className="group relative rounded py-1.5 text-xs">
      <div className="pointer-events-none absolute inset-0 rounded transition-colors group-hover:bg-white/5" />
      <div className="relative flex min-w-0 items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-[9px] text-[var(--color-text-muted)]">#{shortId}</span>
            <span className="truncate text-sm font-medium text-[var(--color-text)]">
              {task.subject}
            </span>
            {overdue && (
              <span className="shrink-0 rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-300">
                逾期
              </span>
            )}
            {task.version != null && (
              <span className="shrink-0 text-[10px] text-[var(--color-text-muted)]">
                v{task.version}
              </span>
            )}
          </div>

          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] font-medium text-[var(--color-text-muted)]">
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 leading-none',
                statusStyle.bg,
                statusStyle.text
              )}
            >
              <Send size={10} />
              {displayLabel} → {target}
            </span>
            <span className="min-w-0 truncate">
              {task.fromTeamDisplay} → {task.toTeamDisplay}
            </span>
            <span className="shrink-0 opacity-60">•</span>
            <span className="shrink-0">{new Date(task.updatedAt).toLocaleString()}</span>
          </div>

          {(task.result || task.feedback || task.reason) && (
            <div className="mt-0.5 line-clamp-1 text-[11px] text-[var(--color-text-muted)]">
              {task.result ? `交付: ${task.result}` : null}
              {task.feedback ? `退回: ${task.feedback}` : null}
              {task.reason && (task.status === 'failed' || task.status === 'rejected')
                ? `原因: ${task.reason}`
                : null}
            </div>
          )}

          {task.revisionCount > 0 && (
            <div className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">
              修改次数: {task.revisionCount}/3
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-0.5">
          {task.status === 'pending_accept' && isIncoming && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-xs text-green-500 hover:text-green-400"
                onClick={onAccept}
              >
                <CheckCircle2 size={12} />
                接单
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-xs text-red-500 hover:text-red-400"
                onClick={onReject}
              >
                <XCircle size={12} />
                拒绝
              </Button>
            </>
          )}

          {task.status === 'delivered' && isOrigin && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-xs text-green-500 hover:text-green-400"
                onClick={onApprove}
              >
                <CheckCircle2 size={12} />
                通过
              </Button>
              <div className="flex min-w-0 flex-1 gap-1">
                <input
                  type="text"
                  placeholder="退回原因..."
                  value={revisionInput}
                  onChange={(e) => onRevisionInputChange(e.target.value)}
                  className={cn(
                    'h-6 min-w-0 flex-1 rounded border border-[var(--color-border)] bg-transparent px-2 text-xs',
                    'text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]',
                    'focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]'
                  )}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-xs text-orange-500 hover:text-orange-400"
                  onClick={onRevision}
                  disabled={!revisionInput.trim()}
                >
                  <RotateCcw size={12} />
                  退回
                </Button>
              </div>
            </>
          )}

          {task.status === 'accepted' && isIncoming && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-xs text-blue-500 hover:text-blue-400"
              onClick={onDeliver}
            >
              <CheckCircle2 size={12} />
              交付结果
            </Button>
          )}

          {task.status === 'revision' && isIncoming && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-xs text-orange-500 hover:text-orange-400"
              onClick={onDeliver}
            >
              <RotateCcw size={12} />
              重新交付
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
