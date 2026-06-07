import React from 'react';
import { addMonths, addWeeks, addDays, format } from 'date-fns';

import { cn } from '@renderer/lib/utils';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import type { CalendarViewMode } from './types';

// =============================================================================
// CalendarHeader
// =============================================================================

interface CalendarHeaderProps {
  viewMode: CalendarViewMode;
  onViewModeChange: (mode: CalendarViewMode) => void;
  currentDate: Date;
  onNavigate: (date: Date) => void;
}

const VIEW_MODE_LABELS: { value: CalendarViewMode; label: string }[] = [
  { value: 'day', label: '日' },
  { value: 'week', label: '周' },
  { value: 'month', label: '月' },
];

export const CalendarHeader = React.memo(function CalendarHeader({
  viewMode,
  onViewModeChange,
  currentDate,
  onNavigate,
}: CalendarHeaderProps): React.JSX.Element {
  const handlePrev = () => {
    switch (viewMode) {
      case 'day':
        onNavigate(addDays(currentDate, -1));
        break;
      case 'week':
        onNavigate(addWeeks(currentDate, -1));
        break;
      case 'month':
        onNavigate(addMonths(currentDate, -1));
        break;
    }
  };

  const handleNext = () => {
    switch (viewMode) {
      case 'day':
        onNavigate(addDays(currentDate, 1));
        break;
      case 'week':
        onNavigate(addWeeks(currentDate, 1));
        break;
      case 'month':
        onNavigate(addMonths(currentDate, 1));
        break;
    }
  };

  const handleToday = () => {
    onNavigate(new Date());
  };

  const rangeLabel = getRangeLabel(viewMode, currentDate);

  return (
    <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-4 py-3">
      {/* Navigation */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex size-7 items-center justify-center rounded-md text-[var(--color-text-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--color-text)]"
          onClick={handlePrev}
        >
          <ChevronLeft className="size-4" />
        </button>
        <button
          type="button"
          className="flex size-7 items-center justify-center rounded-md text-[var(--color-text-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--color-text)]"
          onClick={handleNext}
        >
          <ChevronRight className="size-4" />
        </button>
        <button
          type="button"
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2.5 py-1 text-xs text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text)]"
          onClick={handleToday}
        >
          今天
        </button>
      </div>

      {/* Date range label */}
      <h2 className="text-sm font-medium text-[var(--color-text)]">{rangeLabel}</h2>

      {/* View mode toggle */}
      <div className="inline-flex rounded-lg border border-white/10 bg-black/20 p-0.5">
        {VIEW_MODE_LABELS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            className={cn(
              'rounded-md px-2.5 py-1 text-xs transition-colors',
              viewMode === value
                ? 'bg-white/10 text-[var(--color-text)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
            )}
            onClick={() => onViewModeChange(value)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
});

// =============================================================================
// Helpers
// =============================================================================

function getRangeLabel(mode: CalendarViewMode, date: Date): string {
  switch (mode) {
    case 'day':
      return format(date, 'yyyy年M月d日 EEEE', { locale: undefined });
    case 'week': {
      // Show week range: "6月8日 - 6月14日"
      const weekStart = startOfWeekCustom(date);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      const startStr = format(weekStart, 'M月d日');
      const endStr = format(weekEnd, 'M月d日');
      return `${startStr} – ${endStr}`;
    }
    case 'month':
      return format(date, 'yyyy年M月');
  }
}

function startOfWeekCustom(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  // Monday = 0 offset, Sunday = 6 offset
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
