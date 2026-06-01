import { memo } from 'react';

import { cn } from '@renderer/lib/utils';
import { CheckCircle2, Loader2, Users } from 'lucide-react';

/** Runtime presence of a digital worker. */
export type WorkerStatus = 'online' | 'provisioning' | 'offline';

export interface WorkerIdCardProps {
  /** Worker identity — the team name doubles as the worker ID. */
  workerId: string;
  /** Display name (usually same as workerId). */
  name: string;
  /** Deterministic avatar URL. */
  avatarUrl: string;
  /** Role / department line, e.g. "数据采集员". */
  role?: string;
  /** Runtime harness, e.g. "Claude" / "Codex". */
  harness?: string;
  status: WorkerStatus;
  /** Accent color (hex) used for the lanyard + ring. */
  accentColor?: string;
  /** Capability chips — distinct member roles or skills. */
  capabilities?: string[];
  /** Track record. */
  completedTasks?: number;
  inProgressTasks?: number;
  memberCount?: number;
  isLight?: boolean;
  className?: string;
}

const STATUS_META: Record<
  WorkerStatus,
  { label: string; dot: string; text: string; pulse?: boolean }
> = {
  online: { label: '在岗', dot: 'bg-emerald-400', text: 'text-emerald-400' },
  provisioning: { label: '启动中', dot: 'bg-yellow-400', text: 'text-yellow-400', pulse: true },
  offline: { label: '离线', dot: 'bg-zinc-400', text: 'text-[var(--color-text-muted)]' },
};

/**
 * 数字劳动力身份证 — employee-badge styled identity card for a worker (team).
 * The teamName IS the workerId; no extra fields are introduced.
 */
function WorkerIdCardImpl({
  workerId,
  name,
  avatarUrl,
  role,
  harness,
  status,
  accentColor = '#6366f1',
  capabilities = [],
  completedTasks = 0,
  inProgressTasks = 0,
  memberCount = 1,
  isLight = false,
  className,
}: WorkerIdCardProps) {
  const statusMeta = STATUS_META[status];
  const tint = (alpha: number) => withAlpha(accentColor, alpha);

  return (
    <div className={cn('relative w-[280px] shrink-0 select-none', className)}>
      {/* Lanyard clip notch */}
      <div className="absolute -top-2 left-1/2 z-10 -translate-x-1/2">
        <div
          className="h-2 w-10 rounded-full border"
          style={{ backgroundColor: tint(0.5), borderColor: accentColor }}
        />
      </div>

      <div
        className="overflow-hidden rounded-xl border shadow-sm"
        style={{
          borderColor: tint(0.45),
          backgroundColor: isLight ? tint(0.06) : tint(0.1),
        }}
      >
        {/* Top strip: worker class + status + harness */}
        <div
          className="flex items-center justify-between px-3 py-1.5"
          style={{ backgroundColor: tint(isLight ? 0.14 : 0.2) }}
        >
          <span
            className="text-[9px] font-bold uppercase tracking-[0.18em]"
            style={{ color: accentColor }}
          >
            数字员工
          </span>
          <span
            className={cn(
              'inline-flex items-center gap-1 text-[10px] font-medium',
              statusMeta.text
            )}
          >
            <span
              className={cn(
                'size-1.5 rounded-full',
                statusMeta.dot,
                statusMeta.pulse && 'animate-pulse'
              )}
            />
            {statusMeta.label}
          </span>
        </div>

        {/* Body: photo + identity */}
        <div className="flex items-center gap-3 px-3 py-2.5">
          <img
            src={avatarUrl}
            alt={name}
            className="size-12 shrink-0 rounded-lg border bg-[var(--color-surface-raised)] object-cover"
            style={{ borderColor: tint(0.5) }}
            draggable={false}
          />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-[var(--color-text)]">{name}</h2>
            <div className="mt-0.5 truncate text-[11px] text-[var(--color-text-secondary)]">
              {role || '数字员工'}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
              <span className="font-mono">工号 {workerId}</span>
              {harness && (
                <>
                  <span>·</span>
                  <span>{harness}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Capabilities */}
        {capabilities.length > 0 && (
          <div className="flex flex-wrap gap-1 px-3 pb-2">
            {capabilities.slice(0, 4).map((cap) => (
              <span
                key={cap}
                className="rounded px-1.5 py-0.5 text-[9px] font-medium"
                style={{ backgroundColor: tint(0.16), color: accentColor }}
              >
                {cap}
              </span>
            ))}
            {capabilities.length > 4 && (
              <span className="rounded bg-[var(--color-surface-raised)] px-1.5 py-0.5 text-[9px] text-[var(--color-text-muted)]">
                +{capabilities.length - 4}
              </span>
            )}
          </div>
        )}

        {/* Track record */}
        <div
          className="flex items-center gap-3 border-t px-3 py-1.5 text-[10px] text-[var(--color-text-secondary)]"
          style={{ borderColor: tint(0.25) }}
        >
          <span className="inline-flex items-center gap-1">
            <CheckCircle2 size={11} className="text-emerald-400" />
            {completedTasks} 完成
          </span>
          {inProgressTasks > 0 && (
            <span className="inline-flex items-center gap-1">
              <Loader2 size={11} className="text-amber-400" />
              {inProgressTasks} 进行
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Users size={11} className="text-[var(--color-text-muted)]" />
            {memberCount} 成员
          </span>
        </div>
      </div>
    </div>
  );
}

/** Apply alpha to a hex color → rgba string. Falls back to the input on parse failure. */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const WorkerIdCard = memo(WorkerIdCardImpl);
