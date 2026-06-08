import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@renderer/components/ui/button';
import { getTeamColorSet } from '@renderer/constants/teamColors';
import { useStore } from '@renderer/store';
import { nameColorSet } from '@renderer/utils/projectColor';
import { Calendar, Plus } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { ScheduleCalendarBoard } from './calendar';
import type { CalendarViewMode } from './calendar';
import { CcCronScheduleDialog } from '../team/schedule/CcCronScheduleDialog';

import type { Schedule } from '@shared/types';

export const SchedulesView = (): React.JSX.Element => {
  const {
    schedules,
    schedulesLoading,
    fetchSchedules,
    openTeamTab,
    teamByName,
  } = useStore(
    useShallow((s) => ({
      schedules: s.schedules,
      schedulesLoading: s.schedulesLoading,
      fetchSchedules: s.fetchSchedules,
      openTeamTab: s.openTeamTab,
      teamByName: s.teamByName,
    }))
  );

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

  const [calendarView, setCalendarView] = useState<CalendarViewMode>('week');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);

  useEffect(() => {
    void fetchSchedules();
  }, [fetchSchedules]);

  const sortedSchedules = useMemo(
    () =>
      [...schedules].sort((a, b) => {
        const statusOrder = { active: 0, paused: 1, disabled: 2 };
        const statusDiff = statusOrder[a.status] - statusOrder[b.status];
        if (statusDiff !== 0) return statusDiff;
        if (a.nextRunAt && b.nextRunAt) {
          return new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime();
        }
        if (a.nextRunAt) return -1;
        if (b.nextRunAt) return 1;
        return 0;
      }),
    [schedules]
  );

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

  const handleTeamClick = useCallback(
    (teamName: string) => {
      openTeamTab(teamName);
    },
    [openTeamTab]
  );

  return (
    <div className="flex h-full flex-col bg-[var(--color-surface)]">
      {/* Minimal header */}
      <div className="flex shrink-0 items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <h1 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
            <span className="text-cyan-400/40">#</span>
            定时任务
          </h1>
          {schedules.length > 0 && (
            <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ color: 'var(--color-text-muted)', background: 'rgba(148,163,184,0.06)' }}>
              {schedules.filter((s) => s.status === 'active').length} 运行中
            </span>
          )}
        </div>
        <Button size="sm" variant="ghost" className="gap-1.5 text-xs" onClick={handleCreate}>
          <Plus className="size-3.5" />
          添加计划
        </Button>
      </div>

      {/* Content — fills remaining space */}
      <div className="flex-1 min-h-0 overflow-auto px-2 pb-4">
        {schedulesLoading && schedules.length === 0 ? (
          <div className="flex items-center justify-center py-24 text-sm text-[var(--color-text-muted)]">
            正在加载计划...
          </div>
        ) : schedules.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[var(--color-border)] py-20 text-center">
            <Calendar className="size-6" style={{ color: 'var(--color-text-muted)', opacity: 0.4 }} />
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              暂无定时任务。在团队中创建计划即可自动运行。
            </p>
            <Button size="sm" variant="ghost" className="mt-1 gap-1.5 text-xs" onClick={handleCreate}>
              <Plus className="size-3.5" />
              创建计划
            </Button>
          </div>
        ) : (
          <ScheduleCalendarBoard
            schedules={sortedSchedules}
            viewMode={calendarView}
            onViewModeChange={setCalendarView}
            onEdit={handleEdit}
            onTeamClick={handleTeamClick}
            getTeamColor={getTeamColor}
            getTeamDisplayName={getTeamDisplayName}
          />
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
