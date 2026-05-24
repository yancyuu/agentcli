import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip';
import { getTeamColorSet } from '@renderer/constants/teamColors';
import { useStore } from '@renderer/store';
import { nameColorSet } from '@renderer/utils/projectColor';
import { formatNextRun, getCronDescription } from '@renderer/utils/scheduleFormatters';
import {
  AlertCircle,
  Calendar,
  ChevronDown,
  ChevronRight,
  Filter,
  Loader2,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Search,
  Square,
  Trash2,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { CcCronScheduleDialog } from '../team/schedule/CcCronScheduleDialog';
import { ScheduleRunLogDialog } from '../team/schedule/ScheduleRunLogDialog';
import { ScheduleRunRow } from '../team/schedule/ScheduleRunRow';
import { ScheduleStatusBadge } from '../team/schedule/ScheduleStatusBadge';

import type { Schedule, ScheduleRun } from '@shared/types';

// =============================================================================
// ScheduleListItem
// =============================================================================

interface ScheduleListItemProps {
  schedule: Schedule;
  onEdit: (schedule: Schedule) => void;
  onDelete: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onTeamClick: (teamName: string) => void;
  teamColor: string;
  teamDisplayName: string;
  deleting?: boolean;
}

const ScheduleListItem = ({
  schedule,
  onEdit,
  onDelete,
  onPause,
  onResume,
  onTeamClick,
  teamColor,
  teamDisplayName,
  deleting = false,
}: ScheduleListItemProps): React.JSX.Element => {
  const [expanded, setExpanded] = useState(false);
  const [selectedRun, setSelectedRun] = useState<ScheduleRun | null>(null);
  const runs = useStore(useShallow((s) => s.scheduleRuns[schedule.id] ?? []));
  const runsLoading = useStore((s) => s.scheduleRunsLoading[schedule.id] ?? false);
  const fetchRunHistory = useStore((s) => s.fetchRunHistory);

  const handleExpand = useCallback(() => {
    const next = !expanded;
    setExpanded(next);
    if (next && runs.length === 0 && !runsLoading) {
      void fetchRunHistory(schedule.id);
    }
  }, [expanded, runs.length, runsLoading, fetchRunHistory, schedule.id]);

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] font-sans">
      {/* Main row */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Expand toggle */}
        <button
          type="button"
          className="shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
          onClick={handleExpand}
        >
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>

        {/* Status badge */}
        <ScheduleStatusBadge status={schedule.status} />

        {/* Label & cron description */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-[var(--color-text)]">
              {schedule.label || getCronDescription(schedule.cronExpression)}
            </span>
          </div>
          {schedule.label ? (
            <span className="text-xs text-[var(--color-text-muted)]">
              {getCronDescription(schedule.cronExpression)}
            </span>
          ) : null}
        </div>

        {/* Team badge */}
        <button
          type="button"
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-emphasis)] hover:text-[var(--color-text)]"
          onClick={() => onTeamClick(schedule.teamName)}
        >
          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: teamColor }} />
          {teamDisplayName}
        </button>

        {/* Next run */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="shrink-0 text-xs text-[var(--color-text-muted)]">
              下次：{formatNextRun(schedule.nextRunAt)}
            </span>
          </TooltipTrigger>
          {schedule.nextRunAt ? (
            <TooltipContent side="top" className="text-xs">
              {new Date(schedule.nextRunAt).toLocaleString()}
            </TooltipContent>
          ) : null}
        </Tooltip>

        {/* Timezone */}
        <span className="hidden shrink-0 text-xs text-[var(--color-text-muted)] lg:inline">
          {schedule.timezone}
        </span>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="size-7 p-0 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                onClick={() => onDelete(schedule.id)}
                disabled={deleting}
              >
                {deleting ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">删除</TooltipContent>
          </Tooltip>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="size-7 p-0">
                <MoreHorizontal className="size-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-40 p-1">
              <button
                type="button"
                className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-raised)]"
                onClick={() => onEdit(schedule)}
              >
                <Pencil className="mr-2 size-3.5" />
                编辑
              </button>
              {schedule.status === 'active' ? (
                <button
                  type="button"
                  className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-raised)]"
                  onClick={() => onPause(schedule.id)}
                >
                  <Square className="mr-2 size-3.5" />
                  停止
                </button>
              ) : (
                <button
                  type="button"
                  className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-raised)]"
                  onClick={() => onResume(schedule.id)}
                >
                  <Play className="mr-2 size-3.5" />
                  启用
                </button>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Expanded: Run history */}
      {expanded ? (
        <div className="border-t border-[var(--color-border)]">
          {runsLoading ? (
            <div className="flex items-center justify-center py-4 text-xs text-[var(--color-text-muted)]">
              正在加载运行历史...
            </div>
          ) : runs.length === 0 ? (
            <div className="flex items-center justify-center py-4 text-xs text-[var(--color-text-muted)]">
              暂无运行记录
            </div>
          ) : (
            <div className="max-h-[240px] overflow-y-auto">
              {runs.slice(0, 15).map((run) => (
                <ScheduleRunRow key={run.id} run={run} onClick={setSelectedRun} />
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* Run Log Dialog */}
      <ScheduleRunLogDialog
        open={selectedRun != null}
        run={selectedRun}
        scheduleId={schedule.id}
        onClose={() => setSelectedRun(null)}
      />
    </div>
  );
};

// =============================================================================
// SchedulesView
// =============================================================================

export const SchedulesView = (): React.JSX.Element => {
  const {
    schedules,
    schedulesLoading,
    fetchSchedules,
    pauseSchedule,
    resumeSchedule,
    deleteSchedule,
    openTeamTab,
    teamByName,
  } = useStore(
    useShallow((s) => ({
      schedules: s.schedules,
      schedulesLoading: s.schedulesLoading,
      fetchSchedules: s.fetchSchedules,
      pauseSchedule: s.pauseSchedule,
      resumeSchedule: s.resumeSchedule,
      deleteSchedule: s.deleteSchedule,
      openTeamTab: s.openTeamTab,
      teamByName: s.teamByName,
    }))
  );

  /** Resolve team color dot style for a given team name */
  const getTeamColor = useCallback(
    (teamName: string): string => {
      const team = teamByName[teamName];
      if (team?.color) return getTeamColorSet(team.color).text;
      return nameColorSet(team?.displayName || teamName).text;
    },
    [teamByName]
  );

  const getTeamDisplayName = useCallback(
    (teamName: string): string => teamByName[teamName]?.displayName || teamName,
    [teamByName]
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [deletingScheduleId, setDeletingScheduleId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Fetch schedules on mount
  useEffect(() => {
    void fetchSchedules();
  }, [fetchSchedules]);

  // Derive unique team names
  const teamNames = useMemo(
    () =>
      [...new Set(schedules.map((s) => s.teamName))].sort((a, b) =>
        getTeamDisplayName(a).localeCompare(getTeamDisplayName(b))
      ),
    [getTeamDisplayName, schedules]
  );

  // Filter and sort schedules
  const filteredSchedules = useMemo(() => {
    let result = schedules;

    // Filter by team
    if (teamFilter) {
      result = result.filter((s) => s.teamName === teamFilter);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((s) => {
        const teamDisplayName = getTeamDisplayName(s.teamName).toLowerCase();
        return (
          (s.label ?? '').toLowerCase().includes(query) ||
          teamDisplayName.includes(query) ||
          s.teamName.toLowerCase().includes(query) ||
          s.launchConfig.prompt.toLowerCase().includes(query) ||
          getCronDescription(s.cronExpression).toLowerCase().includes(query)
        );
      });
    }

    // Sort: active first, then by next run ascending
    return [...result].sort((a, b) => {
      // Active schedules first
      const statusOrder = { active: 0, paused: 1, disabled: 2 };
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      if (statusDiff !== 0) return statusDiff;

      // Then by next run (soonest first)
      if (a.nextRunAt && b.nextRunAt) {
        return new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime();
      }
      if (a.nextRunAt) return -1;
      if (b.nextRunAt) return 1;
      return 0;
    });
  }, [getTeamDisplayName, schedules, teamFilter, searchQuery]);

  const handleEdit = useCallback((schedule: Schedule) => {
    setEditingSchedule(schedule);
    setDialogOpen(true);
  }, []);

  const handleCreate = useCallback(() => {
    setEditingSchedule(null);
    setDialogOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setDialogOpen(false);
    setEditingSchedule(null);
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      setDeletingScheduleId(id);
      setDeleteError(null);
      try {
        await deleteSchedule(id);
      } catch (err) {
        setDeleteError(err instanceof Error ? err.message : '删除计划失败');
      } finally {
        setDeletingScheduleId(null);
      }
    },
    [deleteSchedule]
  );

  const handleTeamClick = useCallback(
    (teamName: string) => {
      openTeamTab(teamName);
    },
    [openTeamTab]
  );

  return (
    <div className="h-full overflow-y-auto bg-[var(--color-surface)]">
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        {/* Header */}
        <div className="mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Calendar className="size-5 text-[var(--color-text-muted)]" />
              <h1 className="text-lg font-semibold text-[var(--color-text)]">计划任务</h1>
              {schedules.length > 0 && (
                <span className="rounded-full bg-[var(--color-surface-raised)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]">
                  {schedules.length}
                </span>
              )}
            </div>
            <Button size="sm" className="gap-1.5" onClick={handleCreate}>
              <Plus className="size-3.5" />
              添加计划
            </Button>
          </div>

          {/* Filters row */}
          {schedules.length > 0 && (
            <div className="mt-3 flex items-center gap-3">
              {/* Search */}
              <div className="relative max-w-xs flex-1">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-text-muted)]" />
                <Input
                  placeholder="搜索计划..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 pl-8 text-xs"
                />
              </div>

              {/* Team filter */}
              {teamNames.length > 1 && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                      <Filter className="size-3" />
                      {teamFilter ? (
                        <>
                          <span
                            className="size-2 shrink-0 rounded-full"
                            style={{ backgroundColor: getTeamColor(teamFilter) }}
                          />
                          {getTeamDisplayName(teamFilter)}
                        </>
                      ) : (
                        '全部团队'
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-48 p-1">
                    <button
                      type="button"
                      className={`flex w-full items-center rounded-sm px-2 py-1.5 text-xs ${
                        !teamFilter
                          ? 'font-medium text-[var(--color-text)]'
                          : 'text-[var(--color-text-secondary)]'
                      } hover:bg-[var(--color-surface-raised)]`}
                      onClick={() => setTeamFilter(null)}
                    >
                      全部团队
                    </button>
                    {teamNames.map((name) => (
                      <button
                        key={name}
                        type="button"
                        className={`flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-xs ${
                          teamFilter === name
                            ? 'font-medium text-[var(--color-text)]'
                            : 'text-[var(--color-text-secondary)]'
                        } hover:bg-[var(--color-surface-raised)]`}
                        onClick={() => setTeamFilter(name)}
                      >
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: getTeamColor(name) }}
                        />
                        {getTeamDisplayName(name)}
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
              )}
            </div>
          )}
        </div>

        {deleteError ? (
          <div className="mb-3 flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            <AlertCircle className="size-3.5 shrink-0" />
            {deleteError}
          </div>
        ) : null}

        {/* Content */}
        {schedulesLoading && schedules.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-sm text-[var(--color-text-muted)]">
            正在加载计划...
          </div>
        ) : schedules.length === 0 ? (
          /* Global empty state */
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <Calendar className="size-12 text-[var(--color-text-muted)]" />
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-[var(--color-text-secondary)]">暂无计划任务</p>
              <p className="max-w-sm text-xs text-[var(--color-text-muted)]">
                在任意团队中创建计划，即可使用 Cron 表达式自动执行团队任务。
                所有团队的计划都会显示在这里。
              </p>
            </div>
            <Button size="sm" variant="outline" className="mt-2 gap-1.5" onClick={handleCreate}>
              <Plus className="size-3.5" />
              创建计划
            </Button>
          </div>
        ) : filteredSchedules.length === 0 ? (
          /* No results for current filters */
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <Search className="size-8 text-[var(--color-text-muted)]" />
            <p className="text-sm text-[var(--color-text-muted)]">没有符合当前筛选条件的计划</p>
            <button
              type="button"
              className="text-xs text-[var(--color-text-secondary)] underline hover:text-[var(--color-text)]"
              onClick={() => {
                setSearchQuery('');
                setTeamFilter(null);
              }}
            >
              清除筛选
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredSchedules.map((schedule) => (
              <ScheduleListItem
                key={schedule.id}
                schedule={schedule}
                onEdit={handleEdit}
                onDelete={(id) => void handleDelete(id)}
                onPause={(id) => void pauseSchedule(id)}
                onResume={(id) => void resumeSchedule(id)}
                onTeamClick={handleTeamClick}
                teamColor={getTeamColor(schedule.teamName)}
                teamDisplayName={getTeamDisplayName(schedule.teamName)}
                deleting={deletingScheduleId === schedule.id}
              />
            ))}
          </div>
        )}
      </div>

      <CcCronScheduleDialog
        open={dialogOpen}
        teamName={editingSchedule?.teamName}
        schedule={editingSchedule}
        onClose={handleClose}
      />
    </div>
  );
};
