import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format, isToday } from 'date-fns';

import { cn } from '@renderer/lib/utils';

import { CalendarEventBlock } from './CalendarEventBlock';
import type { CalendarOccurrence } from './types';

// =============================================================================
// Constants
// =============================================================================

const HOUR_ROW_HEIGHT = 80; // taller than week view for more detail

// =============================================================================
// CalendarDayView
// =============================================================================

interface CalendarDayViewProps {
  occurrences: CalendarOccurrence[];
  date: Date;
  onEventClick: (occurrence: CalendarOccurrence) => void;
  onSlotClick?: (date: Date) => void;
}

export const CalendarDayView = React.memo(function CalendarDayView({
  occurrences,
  date,
  onEventClick,
  onSlotClick,
}: CalendarDayViewProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [nowMinute, setNowMinute] = useState(() => Date.now());

  // Update current-time indicator every 60s
  useEffect(() => {
    const timer = setInterval(() => setNowMinute(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Auto-scroll to current hour
  useEffect(() => {
    if (scrollRef.current) {
      const currentHour = new Date().getHours();
      const scrollTo = Math.max(0, (currentHour - 1) * HOUR_ROW_HEIGHT);
      scrollRef.current.scrollTop = scrollTo;
    }
  }, []);

  // Current time line
  const nowDate = new Date(nowMinute);
  const nowHour = nowDate.getHours();
  const nowMin = nowDate.getMinutes();
  const nowY = (nowHour * 60 + nowMin) / 60 * HOUR_ROW_HEIGHT;
  const showNowLine = isToday(date);

  const handleSlotClick = useCallback(
    (hour: number) => {
      if (!onSlotClick) return;
      const d = new Date(date);
      d.setHours(hour, 0, 0, 0);
      onSlotClick(d);
    },
    [onSlotClick, date],
  );

  return (
    <div className="flex flex-col">
      {/* Day header */}
      <div
        className={cn(
          'flex items-center justify-center gap-2 border-b border-[var(--color-border-subtle)] py-2.5',
          showNowLine && 'bg-[var(--color-accent)]/5',
        )}
      >
        <span
          className={cn(
            'text-xs',
            showNowLine ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]',
          )}
        >
          {format(date, 'EEEE')}
        </span>
        <span
          className={cn(
            'inline-flex size-7 items-center justify-center rounded-full text-sm font-medium',
            showNowLine
              ? 'bg-[var(--color-accent)] text-white'
              : 'text-[var(--color-text)]',
          )}
        >
          {format(date, 'd')}
        </span>
      </div>

      {/* Scrollable grid */}
      <div ref={scrollRef} className="relative overflow-y-auto" style={{ maxHeight: 520 }}>
        <div className="relative" style={{ height: 24 * HOUR_ROW_HEIGHT }}>
          {/* Hour rows */}
          {Array.from({ length: 24 }, (_, hour) => {
            const y = hour * HOUR_ROW_HEIGHT;
            return (
              <React.Fragment key={hour}>
                {/* Hour label */}
                <div
                  className="absolute right-auto flex items-start justify-end pr-3 pt-0 text-[10px] text-[var(--color-text-muted)]"
                  style={{ left: 0, top: y, width: 56, height: HOUR_ROW_HEIGHT }}
                >
                  <span className="translate-y-[-6px]">
                    {String(hour).padStart(2, '0')}:00
                  </span>
                </div>
                {/* Grid line */}
                <div
                  className="absolute border-t border-[var(--color-border-subtle)]"
                  style={{ left: 56, top: y, right: 0 }}
                />
              </React.Fragment>
            );
          })}

          {/* Event column */}
          <div className="absolute top-0 bottom-0" style={{ left: 56, right: 0 }}>
            {/* Events */}
            {occurrences.map((occ) => {
              const topPx = (occ.hour * 60 + occ.minute) / 60 * HOUR_ROW_HEIGHT;
              const heightPx = (occ.durationMinutes / 60) * HOUR_ROW_HEIGHT;
              const widthPct = 100 / occ.totalColumns;
              const leftPct = occ.column * widthPct;

              return (
                <CalendarEventBlock
                  key={`${occ.scheduleId}-${occ.date.toISOString()}`}
                  occurrence={occ}
                  variant="day"
                  className="absolute"
                  style={{
                    top: topPx,
                    height: Math.max(heightPx, 28),
                    width: `calc(${widthPct}% - 4px)`,
                    left: `calc(${leftPct}% + 2px)`,
                  }}
                  onClick={() => onEventClick(occ)}
                />
              );
            })}

            {/* Clickable slots */}
            {onSlotClick &&
              Array.from({ length: 24 }, (_, hour) => (
                <div
                  key={`slot-${hour}`}
                  className="absolute left-0 right-0 cursor-pointer transition-colors hover:bg-white/[0.02]"
                  style={{ top: hour * HOUR_ROW_HEIGHT, height: HOUR_ROW_HEIGHT }}
                  onClick={() => handleSlotClick(hour)}
                />
              ))}
          </div>

          {/* Current time line */}
          {showNowLine && (
            <div className="pointer-events-none absolute z-20" style={{ top: nowY, left: 56, right: 0 }}>
              <div className="flex items-center">
                <div className="size-2.5 shrink-0 rounded-full bg-red-500" />
                <div className="h-px flex-1 bg-red-500" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
