import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, format, isToday } from 'date-fns';

import { cn } from '@renderer/lib/utils';

import { CalendarEventBlock } from './CalendarEventBlock';
import type { CalendarOccurrence } from './types';

// =============================================================================
// Constants
// =============================================================================

const HOUR_PX = 48;
const GUTTER = 40;

const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

// =============================================================================
// CalendarWeekView
// =============================================================================

interface CalendarWeekViewProps {
  occurrences: CalendarOccurrence[];
  weekStart: Date;
  onEventClick: (occurrence: CalendarOccurrence) => void;
  onSlotClick?: (date: Date) => void;
}

export const CalendarWeekView = React.memo(function CalendarWeekView({
  occurrences,
  weekStart,
  onEventClick,
  onSlotClick,
}: CalendarWeekViewProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!scrollRef.current) return;
    const h = new Date().getHours();
    scrollRef.current.scrollTop = Math.max(0, (h - 2) * HOUR_PX);
  }, []);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const byDay = useMemo(() => {
    const m = new Map<number, CalendarOccurrence[]>();
    for (const o of occurrences) {
      const idx = dayDiff(o.date, weekStart);
      if (idx < 0 || idx > 6) continue;
      (m.get(idx) ?? m.set(idx, []).get(idx)!).push(o);
    }
    return m;
  }, [occurrences, weekStart]);

  const nowDate = new Date(now);
  const nowY = ((nowDate.getHours() * 60 + nowDate.getMinutes()) / 1440) * 24 * HOUR_PX;
  const todayIdx = dayDiff(nowDate, weekStart);

  const handleSlotClick = useCallback(
    (di: number, h: number) => {
      if (!onSlotClick) return;
      const d = addDays(weekStart, di);
      d.setHours(h, 0, 0, 0);
      onSlotClick(d);
    },
    [onSlotClick, weekStart],
  );

  const gridH = 24 * HOUR_PX;

  return (
    <div className="select-none">
      {/* ── Day headers ── */}
      <div className="flex border-b border-[var(--color-border-subtle)]" style={{ paddingLeft: GUTTER }}>
        {days.map((day, i) => {
          const today = isToday(day);
          return (
            <div key={i} className={cn('flex flex-1 items-center justify-center gap-1 py-1.5')}>
              <span className={cn('text-[11px]', today ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]')}>
                {DAY_LABELS[i]}
              </span>
              <span
                className={cn(
                  'inline-flex size-5 items-center justify-center rounded-full text-[11px] font-semibold',
                  today ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-text)]',
                )}
              >
                {format(day, 'd')}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Grid body ── */}
      <div ref={scrollRef} className="overflow-y-auto" style={{ maxHeight: 400 }}>
        <div className="relative flex" style={{ height: gridH }}>
          {/* Time gutter — only render even hours */}
          <div className="relative shrink-0" style={{ width: GUTTER }}>
            {Array.from({ length: 12 }, (_, i) => i * 2).map((h) => (
              <div
                key={h}
                className="absolute right-0 flex items-start justify-end pr-1.5"
                style={{ top: h * HOUR_PX, width: GUTTER }}
              >
                <span className="-translate-y-[6px] text-[10px] tabular-nums text-[var(--color-text-muted)]">
                  {String(h).padStart(2, '0')}:00
                </span>
              </div>
            ))}
          </div>

          {/* 7 day columns */}
          {days.map((day, di) => {
            const events = byDay.get(di) ?? [];
            const today = isToday(day);

            return (
              <div
                key={di}
                className={cn(
                  'relative flex-1',
                  di > 0 && 'border-l border-[var(--color-border-subtle)]/40',
                  today && 'bg-[var(--color-accent)]/[0.015]',
                )}
              >
                {/* Hour lines — very subtle, only even hours */}
                {Array.from({ length: 12 }, (_, i) => i * 2).map((h) => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 border-t"
                    style={{
                      top: h * HOUR_PX,
                      borderColor: 'var(--color-border-subtle)',
                      opacity: 0.3,
                    }}
                  />
                ))}

                {/* Events */}
                {events.map((occ) => {
                  const topPx = ((occ.hour * 60 + occ.minute) / 1440) * gridH;
                  const hPx = Math.max((occ.durationMinutes / 1440) * gridH, 22);
                  const wPct = 100 / occ.totalColumns;
                  const lPct = occ.column * wPct;

                  return (
                    <CalendarEventBlock
                      key={`${occ.scheduleId}-${occ.date.toISOString()}`}
                      occurrence={occ}
                      variant="week"
                      className="absolute z-10"
                      style={{
                        top: topPx,
                        height: hPx,
                        width: `calc(${wPct}% - 2px)`,
                        left: `calc(${lPct}% + 1px)`,
                      }}
                      onClick={() => onEventClick(occ)}
                    />
                  );
                })}

                {/* Clickable slots */}
                {onSlotClick &&
                  Array.from({ length: 24 }, (_, h) => (
                    <div
                      key={`s-${h}`}
                      className="absolute left-0 right-0 cursor-pointer hover:bg-white/[0.01]"
                      style={{ top: h * HOUR_PX, height: HOUR_PX }}
                      onClick={() => handleSlotClick(di, h)}
                    />
                  ))}
              </div>
            );
          })}

          {/* Current time line */}
          {todayIdx >= 0 && todayIdx < 7 && (
            <div
              className="pointer-events-none absolute z-30"
              style={{
                top: nowY,
                left: GUTTER,
                right: 0,
              }}
            >
              <div className="relative flex" style={{ height: 0 }}>
                {/* Position within the correct day column */}
                <div
                  className="absolute flex items-center"
                  style={{
                    left: `${(todayIdx / 7) * 100}%`,
                    width: `${100 / 7}%`,
                  }}
                >
                  <span className="size-2 shrink-0 rounded-full bg-red-500" />
                  <span className="h-[1.5px] flex-1 bg-red-500" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

function dayDiff(d: Date, base: Date): number {
  const a = new Date(d); a.setHours(0,0,0,0);
  const b = new Date(base); b.setHours(0,0,0,0);
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}
