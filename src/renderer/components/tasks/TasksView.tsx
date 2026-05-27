import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { deriveTaskDisplayId } from '@shared/utils/taskIdentity';
import { Calendar, CheckCircle2, Circle, Columns3, Loader2, RefreshCw } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { SchedulesView } from '../schedules/SchedulesView';

import type { GlobalTask, TeamTaskStatus } from '@shared/types';

type TasksSubTab = 'overview' | 'schedules';
type OverviewStatus = Extract<TeamTaskStatus, 'pending' | 'in_progress' | 'completed'>;

const SUB_TABS: { id: TasksSubTab; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: '总览池', icon: <Columns3 size={14} /> },
  { id: 'schedules', label: '定时任务', icon: <Calendar size={14} /> },
];

const COLUMNS: {
  id: OverviewStatus;
  title: string;
  icon: React.ReactNode;
  headerBg: string;
  bodyBg: string;
}[] = [
  {
    id: 'pending',
    title: 'TODO',
    icon: <Circle size={14} className="shrink-0 text-[var(--color-text-muted)]" />,
    headerBg: 'rgba(59, 130, 246, 0.22)',
    bodyBg: 'rgba(59, 130, 246, 0.05)',
  },
  {
    id: 'in_progress',
    title: 'IN PROGRESS',
    icon: <Loader2 size={14} className="shrink-0 text-[var(--color-text-muted)]" />,
    headerBg: 'rgba(234, 179, 8, 0.24)',
    bodyBg: 'rgba(234, 179, 8, 0.06)',
  },
  {
    id: 'completed',
    title: 'DONE',
    icon: <CheckCircle2 size={14} className="shrink-0 text-[var(--color-text-muted)]" />,
    headerBg: 'rgba(34, 197, 94, 0.22)',
    bodyBg: 'rgba(34, 197, 94, 0.05)',
  },
];

function isOverviewStatus(status: TeamTaskStatus): status is OverviewStatus {
  return status === 'pending' || status === 'in_progress' || status === 'completed';
}

function getTaskUpdatedAt(task: GlobalTask): number {
  const raw = task.updatedAt ?? task.createdAt;
  const time = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function buildOptionLabel(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

export const TasksView = (): React.JSX.Element => {
  const [activeTab, setActiveTab] = useState<TasksSubTab>('overview');

  return (
    <div className="flex h-full flex-col">
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

      <div className="flex-1 overflow-auto">
        {activeTab === 'overview' && <TaskOverviewPool />}
        {activeTab === 'schedules' && <SchedulesView />}
      </div>
    </div>
  );
};

const TaskOverviewPool = (): React.JSX.Element => {
  const {
    globalTasks,
    globalTasksLoading,
    globalTasksInitialized,
    fetchAllTasks,
    openGlobalTaskDetail,
  } = useStore(
    useShallow((s) => ({
      globalTasks: s.globalTasks,
      globalTasksLoading: s.globalTasksLoading,
      globalTasksInitialized: s.globalTasksInitialized,
      fetchAllTasks: s.fetchAllTasks,
      openGlobalTaskDetail: s.openGlobalTaskDetail,
    }))
  );
  const [teamFilter, setTeamFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | OverviewStatus>('all');
  const [ownerFilter, setOwnerFilter] = useState('all');

  useEffect(() => {
    void fetchAllTasks();
  }, [fetchAllTasks]);

  const overviewTasks = useMemo(
    () => globalTasks.filter((task) => isOverviewStatus(task.status) && !task.teamDeleted),
    [globalTasks]
  );

  const teamOptions = useMemo(
    () =>
      Array.from(
        new Map(overviewTasks.map((task) => [task.teamName, task.teamDisplayName])).entries()
      ).sort((a, b) => a[1].localeCompare(b[1])),
    [overviewTasks]
  );

  const ownerOptions = useMemo(() => {
    const owners = new Set<string>();
    for (const task of overviewTasks) {
      if (task.owner?.trim()) owners.add(task.owner.trim());
    }
    return Array.from(owners).sort((a, b) => a.localeCompare(b));
  }, [overviewTasks]);

  const filteredTasks = useMemo(
    () =>
      overviewTasks
        .filter((task) => teamFilter === 'all' || task.teamName === teamFilter)
        .filter((task) => statusFilter === 'all' || task.status === statusFilter)
        .filter((task) => ownerFilter === 'all' || task.owner === ownerFilter)
        .sort((a, b) => getTaskUpdatedAt(b) - getTaskUpdatedAt(a)),
    [overviewTasks, ownerFilter, statusFilter, teamFilter]
  );

  const grouped = useMemo(() => {
    const map = new Map<OverviewStatus, GlobalTask[]>();
    for (const column of COLUMNS) {
      map.set(column.id, []);
    }
    for (const task of filteredTasks) {
      if (isOverviewStatus(task.status)) {
        map.get(task.status)?.push(task);
      }
    }
    return map;
  }, [filteredTasks]);

  const clearFilters = useCallback(() => {
    setTeamFilter('all');
    setStatusFilter('all');
    setOwnerFilter('all');
  }, []);

  if (globalTasksLoading && !globalTasksInitialized) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--color-text-muted)]">
        加载团队任务…
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[180px]">
          <label
            htmlFor="tasks-overview-team-filter"
            className="mb-1 block text-[11px] font-medium text-[var(--color-text-muted)]"
          >
            团队
          </label>
          <select
            id="tasks-overview-team-filter"
            value={teamFilter}
            onChange={(event) => setTeamFilter(event.target.value)}
            className="h-8 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)]"
          >
            <option value="all">全部团队</option>
            {teamOptions.map(([teamName, displayName]) => (
              <option key={teamName} value={teamName}>
                {displayName}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-[160px]">
          <label
            htmlFor="tasks-overview-status-filter"
            className="mb-1 block text-[11px] font-medium text-[var(--color-text-muted)]"
          >
            状态
          </label>
          <select
            id="tasks-overview-status-filter"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as 'all' | OverviewStatus)}
            className="h-8 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)]"
          >
            <option value="all">全部状态</option>
            <option value="pending">TODO</option>
            <option value="in_progress">IN PROGRESS</option>
            <option value="completed">DONE</option>
          </select>
        </div>

        <div className="min-w-[160px]">
          <label
            htmlFor="tasks-overview-owner-filter"
            className="mb-1 block text-[11px] font-medium text-[var(--color-text-muted)]"
          >
            负责人
          </label>
          <select
            id="tasks-overview-owner-filter"
            value={ownerFilter}
            onChange={(event) => setOwnerFilter(event.target.value)}
            className="h-8 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)]"
          >
            <option value="all">全部负责人</option>
            {ownerOptions.map((owner) => (
              <option key={owner} value={owner}>
                {owner}
              </option>
            ))}
          </select>
        </div>

        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={clearFilters}>
          清空筛选
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-8 gap-1.5 text-xs text-[var(--color-text-muted)]"
          onClick={() => void fetchAllTasks()}
        >
          <RefreshCw size={12} />
          刷新
        </Button>
      </div>

      <div className="w-full min-w-0 max-w-full overflow-x-auto overflow-y-hidden pb-6">
        <div className="grid min-w-[900px] grid-cols-3 items-start gap-3">
          {COLUMNS.map((column) => {
            const tasks = grouped.get(column.id) ?? [];
            return (
              <section
                key={column.id}
                className="relative rounded-md"
                style={{ backgroundColor: column.bodyBg }}
              >
                {tasks.length > 0 ? (
                  <span className="absolute -right-2 -top-2 z-10 min-w-5 rounded-full bg-[var(--color-surface-raised)] px-1.5 py-0 text-center text-[10px] font-medium leading-5 text-[var(--color-text-secondary)] ring-1 ring-[var(--color-border)]">
                    {tasks.length}
                  </span>
                ) : null}
                <header
                  className="rounded-t-md px-3 py-2"
                  style={{ backgroundColor: column.headerBg }}
                >
                  <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text)]">
                    {column.icon}
                    {column.title}
                  </h4>
                </header>
                <div className="flex flex-col gap-1.5 p-2">
                  {tasks.length === 0 ? (
                    <div className="rounded-md border border-dashed border-[var(--color-border)] p-3 text-xs text-[var(--color-text-muted)]">
                      No tasks
                    </div>
                  ) : (
                    tasks.map((task) => (
                      <GlobalOverviewTaskCard
                        key={`${task.teamName}:${task.id}`}
                        task={task}
                        onOpen={() => openGlobalTaskDetail(task.teamName, task.id)}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const GlobalOverviewTaskCard = ({
  task,
  onOpen,
}: {
  task: GlobalTask;
  onOpen: () => void;
}): React.JSX.Element => {
  const ownerLabel = buildOptionLabel(task.owner, '未分配');
  const dispatchFrom = task.dispatchMeta?.originTeam;
  const dispatchTo = task.dispatchMeta?.targetTeam;
  return (
    <button
      type="button"
      className="relative w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-1.5 py-3 text-left text-xs transition-colors hover:border-[var(--color-border-emphasis)]"
      onClick={onOpen}
    >
      <span className="absolute left-[3px] top-[2px] text-[9px] leading-none text-[var(--color-text-muted)]">
        #{task.displayId ?? deriveTaskDisplayId(task.id)}
      </span>
      <div className="mb-2 pt-[11px]">
        <h5 className="line-clamp-2 text-xs font-medium text-[var(--color-text)]">
          {task.subject}
        </h5>
        {task.dispatchMeta ? (
          <span className="mt-1 inline-flex items-center rounded-full bg-yellow-500/15 px-1.5 py-0.5 text-[10px] font-medium text-yellow-600 dark:text-yellow-400">
            {dispatchFrom} 给 {dispatchTo} 派单
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
        <span className="rounded bg-white/5 px-1.5 py-0.5">{task.teamDisplayName}</span>
        <span className="rounded bg-white/5 px-1.5 py-0.5">{ownerLabel}</span>
      </div>
    </button>
  );
};
