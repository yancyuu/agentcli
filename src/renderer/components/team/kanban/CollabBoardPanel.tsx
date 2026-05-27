import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import type { CollabTask, CollabTaskStatus } from '@shared/types';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Eye,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  XCircle,
} from 'lucide-react';

import { api } from '@renderer/api';

// ── Column definitions ──────────────────────────────────────────────

interface CollabColumn {
  id: CollabTaskStatus;
  title: string;
  accent: string;
}

const COLLAB_COLUMNS: CollabColumn[] = [
  { id: 'pending_accept', title: '待接单', accent: 'rgba(234,179,8,0.2)' },
  { id: 'accepted', title: '进行中', accent: 'rgba(59,130,246,0.2)' },
  { id: 'delivered', title: '待审核', accent: 'rgba(168,85,247,0.2)' },
  { id: 'revision', title: '修改中', accent: 'rgba(249,115,22,0.2)' },
  { id: 'approved', title: '已完成', accent: 'rgba(34,197,94,0.2)' },
];

const TERMINAL_STATUSES: CollabTaskStatus[] = ['rejected', 'failed'];

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending_accept: <Clock size={12} />,
  accepted: <ArrowRight size={12} />,
  delivered: <Eye size={12} />,
  revision: <RotateCcw size={12} />,
  approved: <CheckCircle2 size={12} />,
  rejected: <XCircle size={12} />,
  failed: <XCircle size={12} />,
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

  const fetchBoard = useCallback(async () => {
    try {
      const res = await api.collab.getBoard();
      setTasks(res.tasks);
    } catch {
      // degraded
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

  const grouped = useMemo(() => {
    const map = new Map<CollabTaskStatus, CollabTask[]>();
    for (const task of visibleTasks) {
      const list = map.get(task.status) ?? [];
      list.push(task);
      map.set(task.status, list);
    }
    return map;
  }, [visibleTasks]);

  const terminalTasks = useMemo(
    () => visibleTasks.filter((t) => TERMINAL_STATUSES.includes(t.status) || isException(t)),
    [visibleTasks]
  );

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
              'rounded-md px-2.5 py-1 text-xs transition-colors',
              viewFilter === filter.id
                ? 'bg-[var(--color-primary)] text-white'
                : 'bg-[var(--color-surface-raised)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {visibleTasks.length === 0 ? (
        <div className="flex w-full justify-center rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-6">
          <div className="mx-auto flex max-w-lg flex-col items-center text-center">
            <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-300">
              <MessageSquare size={18} />
            </div>
            <p className="text-sm font-medium text-[var(--color-text)]">
              {viewFilter === 'all' ? '暂无跨团队协作任务' : '当前筛选下没有协作任务'}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
              跨团队任务会先进入状态机，经过接单、执行、交付和审核后完成。 这里展示的是 CollabTask
              的投影，不会直接打断 Agent 当前上下文。
            </p>
            <div className="mt-4 grid w-full gap-2 text-left text-[11px] text-[var(--color-text-muted)] sm:grid-cols-3">
              <div className="rounded-lg border border-[var(--color-border-subtle)] bg-black/10 p-2">
                <p className="font-medium text-[var(--color-text-secondary)]">1. 派发</p>
                <p className="mt-0.5">在任务中 @目标团队，或由 Agent 使用跨团队任务工具派发。</p>
              </div>
              <div className="rounded-lg border border-[var(--color-border-subtle)] bg-black/10 p-2">
                <p className="font-medium text-[var(--color-text-secondary)]">2. 人工确认</p>
                <p className="mt-0.5">接收方人工接单或拒绝，避免任务自动打断团队工作。</p>
              </div>
              <div className="rounded-lg border border-[var(--color-border-subtle)] bg-black/10 p-2">
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
        <div className="flex gap-2 overflow-x-auto pb-2">
          {COLLAB_COLUMNS.map((col) => {
            const colTasks = (grouped.get(col.id) ?? []).filter(
              (t) => !TERMINAL_STATUSES.includes(t.status) && !isException(t)
            );
            if (colTasks.length === 0 && viewFilter === 'exception') return null;
            return (
              <div
                key={col.id}
                className="flex min-w-[200px] flex-shrink-0 flex-col rounded-lg"
                style={{ backgroundColor: col.accent }}
              >
                <div className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[var(--color-text)]">
                  {STATUS_ICONS[col.id]}
                  <span>{col.title}</span>
                  <span className="ml-auto text-[var(--color-text-muted)]">{colTasks.length}</span>
                </div>
                <div className="flex flex-col gap-1.5 px-2 pb-2">
                  {colTasks.map((task) => (
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
                </div>
              </div>
            );
          })}

          {terminalTasks.length > 0 && (
            <div className="flex min-w-[200px] flex-shrink-0 flex-col rounded-lg bg-[rgba(239,68,68,0.15)]">
              <div className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[var(--color-text)]">
                <XCircle size={12} />
                <span>异常/已拒绝</span>
                <span className="ml-auto text-[var(--color-text-muted)]">
                  {terminalTasks.length}
                </span>
              </div>
              <div className="flex flex-col gap-1.5 px-2 pb-2">
                {terminalTasks.map((task) => (
                  <CollabTaskCard
                    key={task.dispatchId}
                    task={task}
                    teamName={teamName}
                    revisionInput=""
                    onRevisionInputChange={() => {}}
                    onAccept={() => {}}
                    onReject={() => {}}
                    onApprove={() => {}}
                    onRevision={() => {}}
                    onDeliver={() => {}}
                  />
                ))}
              </div>
            </div>
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

  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-2.5 text-xs shadow-sm">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="rounded bg-[rgba(59,130,246,0.15)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">
          {task.fromTeamDisplay}
        </span>
        <ArrowRight size={10} className="text-[var(--color-text-muted)]" />
        <span className="rounded bg-[rgba(34,197,94,0.15)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">
          {task.toTeamDisplay}
        </span>
        {task.version != null && (
          <span className="ml-auto text-[10px] text-[var(--color-text-muted)]">
            v{task.version}
          </span>
        )}
      </div>

      <div className="line-clamp-2 font-medium text-[var(--color-text)]">{task.subject}</div>

      {task.description && (
        <div className="mt-1 line-clamp-2 text-[var(--color-text-muted)]">{task.description}</div>
      )}

      {overdue && (
        <div className="mt-1.5 rounded bg-[rgba(239,68,68,0.12)] px-1.5 py-1 text-[10px] text-red-400">
          已超过截止时间
        </div>
      )}

      {task.result && (
        <div className="mt-1.5 rounded bg-[rgba(34,197,94,0.1)] p-1.5 text-[var(--color-text-muted)]">
          <span className="font-medium text-[var(--color-text)]">交付: </span>
          {task.result}
        </div>
      )}

      {task.feedback && (
        <div className="mt-1.5 rounded bg-[rgba(249,115,22,0.1)] p-1.5 text-[var(--color-text-muted)]">
          <span className="font-medium text-[var(--color-text)]">退回: </span>
          {task.feedback}
        </div>
      )}

      {task.reason && (task.status === 'failed' || task.status === 'rejected') && (
        <div className="mt-1.5 rounded bg-[rgba(239,68,68,0.12)] p-1.5 text-red-400">
          <span className="font-medium">原因: </span>
          {task.reason}
        </div>
      )}

      {task.revisionCount > 0 && (
        <div className="mt-1 text-[10px] text-[var(--color-text-muted)]">
          修改次数: {task.revisionCount}/3
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
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

      <div className="mt-1.5 text-[10px] text-[var(--color-text-muted)]">
        {new Date(task.updatedAt).toLocaleString()}
      </div>
    </div>
  );
}
