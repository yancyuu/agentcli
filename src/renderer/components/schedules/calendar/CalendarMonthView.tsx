import React, { useMemo } from 'react';
import {
  addDays,
  addMonths,
  endOfMonth,
  format,
  getDate,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from 'date-fns';

import { cn } from '@renderer/lib/utils';

import { CalendarEventBlock } from './CalendarEventBlock';
import type { CalendarOccurrence } from './types';

// =============================================================================
// Constants
// =============================================================================

const WEEK_STARTS_ON = 1; // Monday
const DAY_NAMES = ['一', '二', '三', '四', '五', '六', '日'];
const MAX_VISIBLE_EVENTS = 3;

// =============================================================================
// CalendarMonthView
// =============================================================================

interface CalendarMonthViewProps {
  occurrences: CalendarOccurrence[];
  currentDate: Date;
  onEventClick: (occurrence: CalendarOccurrence) => void;
  onDayClick?: (date: Date) => void;
}

export const CalendarMonthView = React.memo(function CalendarMonthView({
  occurrences,
  currentDate,
  onEventClick,
  onDayClick,
}: CalendarMonthViewProps): React.JSX.Element {
  // Build 6×7 grid of days
  const gridDays = useMemo(() => {
    const monthStart = startOfMonth(currentDate);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: WEEK_STARTS_ON });
    const monthEnd = endOfMonth(currentDate);

    // How many weeks to show (5 or 6)
    const totalDays = Math.ceil((monthEnd.getDate() + (gridStart.getDay() === 0 ? 6 : gridStart.getDay() - 1)) / 7) * 7;
    const rows = Math.max(5, Math.ceil(totalDays / 7));
    const count = rows * 7;

    return Array.from({ length: count }, (_, i) => addDays(gridStart, i));
  }, [currentDate]);

  // Group occurrences by day
  const occurrencesByDay = useMemo(() => {
    const map = new Map<string, CalendarOccurrence[]>();
    for (const occ of occurrences) {
      const key = format(occ.date, 'yyyy-MM-dd');
      const list = map.get(key);
      if (list) list.push(occ);
      else map.set(key, [occ]);
    }
    return map;
  }, [occurrences]);

  return (
    <div className="flex flex-col">
      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 border-b border-[var(--color-border-subtle)]">
        {DAY_NAMES.map((name) => (
          <div
            key={name}
            className="flex items-center justify-center py-2 text-xs text-[var(--color-text-muted)]"
          >
            {name}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 auto-rows-fr">
        {gridDays.map((day) => {
          const key = format(day, 'yyyy-MM-dd');
          const inMonth = isSameMonth(day, currentDate);
          const today = isToday(day);
          const dayOccurrences = occurrencesByDay.get(key) ?? [];
          const visible = dayOccurrences.slice(0, MAX_VISIBLE_EVENTS);
          const hiddenCount = dayOccurrences.length - MAX_VISIBLE_EVENTS;

          return (
            <div
              key={key}
              className={cn(
                'group relative flex min-h-[80px] flex-col border-b border-r border-[var(--color-border-subtle)] p-1.5 transition-colors',
                !inMonth && 'bg-black/20',
                today && 'bg-[var(--color-accent)]/5',
                onDayClick && 'cursor-pointer hover:bg-white/[0.02]',
              )}
              onClick={() => onDayClick?.(day)}
            >
              {/* Date number */}
              <span
                className={cn(
                  'mb-1 inline-flex size-6 items-center justify-center rounded-full text-xs font-medium',
                  today
                    ? 'bg-[var(--color-accent)] text-white'
                    : inMonth
                      ? 'text-[var(--color-text-secondary)]'
                      : 'text-[var(--color-text-muted)]',
                )}
              >
                {getDate(day)}
              </span>

              {/* Event pills */}
              <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
                {visible.map((occ) => (
                  <CalendarEventBlock
                    key={`${occ.scheduleId}-${occ.date.toISOString()}`}
                    occurrence={occ}
                    variant="month"
                    onClick={() => onEventClick(occ)}
                  />
                ))}
                {hiddenCount > 0 && (
                  <span className="px-1 text-[10px] text-[var(--color-text-muted)]">
                    +{hiddenCount} 更多
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
