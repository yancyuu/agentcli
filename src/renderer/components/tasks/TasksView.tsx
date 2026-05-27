import { useCallback, useEffect, useState } from 'react';

import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import type { CollabTask, CollabTaskStatus } from '@shared/types';
import {
  ArrowRight,
  Calendar,
  CheckCircle2,
  Clock,
  Columns3,
  Eye,
  MessageSquare,
  RotateCcw,
  XCircle,
} from 'lucide-react';

import { api } from '@renderer/api';
import { SchedulesView } from '../schedules/SchedulesView';

// ── Sub-tab definitions ────────────────────────────────────────────

type TasksSubTab = 'collab' | 'schedules';

const SUB_TABS: { id: TasksSubTab; label: string; icon: React.ReactNode }[] = [
  { id: 'collab', label: '协作看板', icon: <Columns3 size={14} /> },
  { id: 'schedules', label: '定时任务', icon: <Calendar size={14} /> },
];

// ── Collab column definitions ──────────────────────────────────────

interface CollabColumn {
  id: CollabTaskStatus;
  title: string;
  accent: string;
}

const COLLAB_COLUMNS: CollabColumn[] = [
  { id: 'pending_accept', title: '待接受', accent: 'rgba(234,179,8,0.2)' },
  { id: 'accepted', title: '进行中', accent: 'rgba(59,130,246,0.2)' },
  { id: 'delivered', title: '待审核', accent: 'rgba(168,85,247,0.2)' },
  { id: 'revision', title: '修改中', accent: 'rgba(249,115,22,0.2)' },
  { id: 'approved', title: '已完成', accent: 'rgba(34,197,94,0.2)' },
];

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending_accept: <Clock size={12} />,
  accepted: <ArrowRight size={12} />,
  delivered: <Eye size={12} />,
  revision: <RotateCcw size={12} />,
  approved: <CheckCircle2 size={12} />,
  rejected: <XCircle size={12} />,
};

// ── Collaboration View ─────────────────────────────────────────────

export function TasksView() {
  const [activeTab, setActiveTab] = useState<TasksSubTab>('collab');

  return (
    <div className="flex h-full flex-col">
      {/* Sub-tab header */}
      <div className="flex items-center border-b border-[var(--color-border)] px-4 pt-2">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex items-center gap-1.5 border-b-2 px-4 pb-2 text-sm font-medium transition-colors',
              activeTab === tab.id
                ? 'border-[var(--color-primary)] text-[var(--color-text)]'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Sub-tab content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'collab' && <CollabBoardSection />}
        {activeTab === 'schedules' && <SchedulesView />}
      </div>
    </div>
  );
}

// ── Collab Board Section ───────────────────────────────────────────

function CollabBoardSection() {
  const [tasks, setTasks] = useState<CollabTask[]>([]);
  const [loading, setLoading] = useState(true);
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
    const interval = setInterval(fetchBoard, 10_000);
    return () => clearInterval(interval);
  }, [fetchBoard]);

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
    const result = prompt('输入交付结果:');
    if (!result?.trim()) return;
    try {
      await api.collab.deliver(task.toTeam, task.dispatchId, result.trim());
      await fetchBoard();
    } catch {
      // error
    }
  };

  // Group tasks by status
  const grouped = new Map<CollabTaskStatus, CollabTask[]>();
  for (const task of tasks) {
    const list = grouped.get(task.status) ?? [];
    list.push(task);
    grouped.set(task.status, list);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-[var(--color-text-muted)]">
        Loading...
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex w-full flex-col items-center justify-center gap-3 py-16 text-sm text-[var(--color-text-muted)]">
        <MessageSquare size={28} />
        <span>暂无协作任务</span>
        <span className="text-xs">
          通过{' '}
          <code className="rounded bg-[var(--color-surface-raised)] px-1.5 py-0.5 text-xs">
            /api/cross-team/send
          </code>{' '}
          向其他团队派发任务
        </span>
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto p-4 pb-4">
      {COLLAB_COLUMNS.map((col) => {
        const colTasks = grouped.get(col.id) ?? [];
        return (
          <div
            key={col.id}
            className="flex min-w-[240px] flex-shrink-0 flex-col rounded-lg"
            style={{ backgroundColor: col.accent }}
          >
            <div className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium text-[var(--color-text)]">
              {STATUS_ICONS[col.id]}
              <span>{col.title}</span>
              <span className="ml-auto text-[var(--color-text-muted)]">{colTasks.length}</span>
            </div>
            <div className="flex flex-col gap-2 px-2 pb-2">
              {colTasks.map((task) => (
                <CollabTaskCard
                  key={task.dispatchId}
                  task={task}
                  revisionInput={revisionInput[task.dispatchId] ?? ''}
                  onRevisionInputChange={(v) =>
                    setRevisionInput((prev) => ({ ...prev, [task.dispatchId]: v }))
                  }
                  onApprove={() => handleApprove(task)}
                  onRevision={() => handleRevision(task)}
                  onDeliver={() => handleDeliver(task)}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Rejected/failed bucket */}
      {(grouped.get('rejected')?.length ?? grouped.get('failed')?.length ?? 0) > 0 && (
        <div className="flex min-w-[240px] flex-shrink-0 flex-col rounded-lg bg-[rgba(239,68,68,0.15)]">
          <div className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium text-[var(--color-text)]">
            <XCircle size={12} />
            <span>已拒绝/失败</span>
          </div>
          <div className="flex flex-col gap-2 px-2 pb-2">
            {(grouped.get('rejected') ?? []).map((task) => (
              <CollabTaskCard
                key={task.dispatchId}
                task={task}
                revisionInput=""
                onRevisionInputChange={() => {}}
                onApprove={() => {}}
                onRevision={() => {}}
                onDeliver={() => {}}
              />
            ))}
            {(grouped.get('failed') ?? []).map((task) => (
              <CollabTaskCard
                key={task.dispatchId}
                task={task}
                revisionInput=""
                onRevisionInputChange={() => {}}
                onApprove={() => {}}
                onRevision={() => {}}
                onDeliver={() => {}}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Single task card ────────────────────────────────────────────────

interface CollabTaskCardProps {
  task: CollabTask;
  revisionInput: string;
  onRevisionInputChange: (value: string) => void;
  onApprove: () => void;
  onRevision: () => void;
  onDeliver: () => void;
}

function CollabTaskCard({
  task,
  revisionInput,
  onRevisionInputChange,
  onApprove,
  onRevision,
  onDeliver,
}: CollabTaskCardProps) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3 text-xs shadow-sm">
      {/* Team tags */}
      <div className="mb-2 flex items-center gap-1.5">
        <span className="rounded bg-[rgba(59,130,246,0.15)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">
          {task.fromTeamDisplay}
        </span>
        <ArrowRight size={10} className="text-[var(--color-text-muted)]" />
        <span className="rounded bg-[rgba(34,197,94,0.15)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">
          {task.toTeamDisplay}
        </span>
      </div>

      {/* Subject */}
      <div className="line-clamp-2 font-medium text-[var(--color-text)]">{task.subject}</div>

      {/* Description */}
      {task.description && (
        <div className="mt-1 line-clamp-2 text-[var(--color-text-muted)]">{task.description}</div>
      )}

      {/* Result */}
      {task.result && (
        <div className="mt-2 rounded bg-[rgba(34,197,94,0.1)] p-2 text-[var(--color-text-muted)]">
          <span className="font-medium text-[var(--color-text)]">交付: </span>
          {task.result}
        </div>
      )}

      {/* Feedback */}
      {task.feedback && (
        <div className="mt-2 rounded bg-[rgba(249,115,22,0.1)] p-2 text-[var(--color-text-muted)]">
          <span className="font-medium text-[var(--color-text)]">退回: </span>
          {task.feedback}
        </div>
      )}

      {/* Revision count */}
      {task.revisionCount > 0 && (
        <div className="mt-1 text-[10px] text-[var(--color-text-muted)]">
          修改次数: {task.revisionCount}/3
        </div>
      )}

      {/* Actions */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {task.status === 'delivered' && (
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
            <div className="flex flex-1 gap-1">
              <input
                type="text"
                placeholder="退回原因..."
                value={revisionInput}
                onChange={(e) => onRevisionInputChange(e.target.value)}
                className={cn(
                  'h-6 flex-1 rounded border border-[var(--color-border)] bg-transparent px-2 text-xs',
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

        {(task.status === 'accepted' || task.status === 'revision') && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-xs text-blue-500 hover:text-blue-400"
            onClick={onDeliver}
          >
            <CheckCircle2 size={12} />
            {task.status === 'revision' ? '重新交付' : '交付结果'}
          </Button>
        )}
      </div>

      {/* Timestamp */}
      <div className="mt-2 text-[10px] text-[var(--color-text-muted)]">
        {new Date(task.updatedAt).toLocaleString()}
      </div>
    </div>
  );
}
