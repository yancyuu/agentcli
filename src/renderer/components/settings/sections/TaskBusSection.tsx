import { useEffect, useState } from 'react';

import { Button } from '@renderer/components/ui/button';
import { SettingRow, SettingsSectionHeader, SettingsToggle } from '../components';
import type {
  CapabilityTelemetrySummary,
  TeamCapabilityTelemetrySnapshot,
} from '@shared/types/extensions';
import type { TaskBusConfig } from '@shared/types/team';
import {
  AlertCircle,
  Calendar,
  Clock,
  Loader2,
  MessageSquare,
  Radio,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react';

interface TelemetryStatus {
  connected: boolean;
  lastScan: string | null;
  sessions: number;
  messages: number;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheCreation: number;
  totalTokens: number;
  activeDays: number;
  hourly: number[];
  projects: Array<{
    cwd: string;
    displayName?: string;
    teamSlug?: string;
    bindProject?: string;
    deletedAt?: string;
    sessions: number;
    messages: number;
    tokensIn: number;
    tokensOut: number;
    tokensTotal: number;
  }>;
  workSecondsByDay: Record<string, number>;
  localUsers?: UsageUserRow[];
  teamCapabilitySnapshots?: TeamCapabilityTelemetrySnapshot[];
  capabilitySummary?: CapabilityTelemetrySummary;
  unresolvedUsage?: { sessions: number; messages: number; tokensTotal: number };
}

interface UsageUserRow {
  key: string;
  kind: 'local' | 'unresolved';
  identity: {
    platform: string;
    type: 'person' | 'group' | 'unknown';
    displayName: string;
    userId?: string;
    userName?: string;
    chatId?: string;
    chatName?: string;
    confidence: string;
  };
  teamSlug?: string;
  teamName?: string;
  teamDisplayName?: string;
  projectName?: string;
  bindProject?: string;
  workDir?: string;
  agentType?: string;
  model?: string;
  provider?: string;
  sessions: number;
  messages: number;
  tokensTotal: number;
  lastActiveAt?: string;
}

function formatNum(n: number | undefined): string {
  if (n == null) return '采集中...';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function formatDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  return `${(secs / 3600).toFixed(1)}h`;
}

type CapabilityAsset = TeamCapabilityTelemetrySnapshot['assets'][number];
type CapabilityAssetKind = CapabilityAsset['kind'];

const CAPABILITY_KIND_LABELS: Record<CapabilityAssetKind, string> = {
  command: 'Commands',
  skill: 'Skills',
  workflow: 'Workflows',
  cron: 'Cron',
  mcp: 'MCP',
};
const CAPABILITY_KIND_ORDER: CapabilityAssetKind[] = [
  'skill',
  'workflow',
  'cron',
  'mcp',
  'command',
];

type BusSettingsPatch = Partial<{
  enabled: boolean;
  collaborationEnabled: boolean;
}>;

function UsageDashboard({ status }: { status: TelemetryStatus }): React.JSX.Element {
  const maxHourly = Math.max(...status.hourly, 1);
  const recentDays = Object.keys(status.workSecondsByDay).sort().slice(-7);
  const maxWorkSecs = Math.max(...Object.values(status.workSecondsByDay), 1);

  return (
    <div className="space-y-4 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--color-text-muted)]">Loop 使用概览</span>
        <span className="text-[10px] text-[var(--color-text-muted)]">
          累计 Loop 数据（全部历史）
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          icon={<MessageSquare size={14} />}
          label="采集会话"
          value={formatNum(status.sessions)}
        />
        <StatCard
          icon={<MessageSquare size={14} />}
          label="Messages"
          value={formatNum(status.messages)}
        />
        <StatCard
          icon={<Zap size={14} />}
          label="Total Tokens"
          value={formatNum(status.totalTokens)}
        />
        <StatCard icon={<Zap size={14} />} label="Input" value={formatNum(status.tokensIn)} />
        <StatCard icon={<Zap size={14} />} label="Output" value={formatNum(status.tokensOut)} />
        <StatCard icon={<Calendar size={14} />} label="活跃天" value={String(status.activeDays)} />
        <StatCard icon={<Zap size={14} />} label="Cache Read" value={formatNum(status.cacheRead)} />
        <StatCard
          icon={<Zap size={14} />}
          label="Cache Create"
          value={formatNum(status.cacheCreation)}
        />
        <StatCard
          icon={<Clock size={14} />}
          label="最近采集"
          value={status.lastScan ? new Date(status.lastScan).toLocaleDateString('zh-CN') : '-'}
        />
      </div>

      <div>
        <div className="mb-2 text-xs font-medium text-[var(--color-text-muted)]">
          24小时 Messages 分布
        </div>
        <div className="flex h-16 items-end gap-0.5">
          {status.hourly.map((count, i) => {
            const pct = (count / maxHourly) * 100;
            return (
              <div
                key={i}
                className="flex-1 rounded-sm bg-[var(--color-accent-muted)] transition-all hover:bg-[var(--color-accent)]"
                style={{ height: `${Math.max(pct, 2)}%` }}
                title={`${i}:00 - ${count} messages`}
              />
            );
          })}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-[var(--color-text-muted)]">
          <span>0h</span>
          <span>6h</span>
          <span>12h</span>
          <span>18h</span>
          <span>24h</span>
        </div>
      </div>

      {recentDays.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-medium text-[var(--color-text-muted)]">
            日工作时长（近 {recentDays.length} 天）
          </div>
          <div className="flex h-16 items-end gap-1">
            {recentDays.map((day) => {
              const secs = status.workSecondsByDay[day] ?? 0;
              const pct = (secs / maxWorkSecs) * 100;
              const label = day.slice(5);
              return (
                <div key={day} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-[10px] text-[var(--color-text-muted)]">
                    {formatDuration(secs)}
                  </span>
                  <div
                    className="w-full rounded-sm bg-emerald-500/60 transition-all hover:bg-emerald-500"
                    style={{ height: `${Math.max(pct, 2)}%` }}
                    title={`${day} - ${formatDuration(secs)}`}
                  />
                  <span className="text-[10px] text-[var(--color-text-muted)]">{label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <UsageUserTable title="本地生成用量（source=local）" rows={status.localUsers ?? []} />
      <CapabilitySnapshotTable
        summary={status.capabilitySummary}
        snapshots={status.teamCapabilitySnapshots ?? []}
      />
      {status.unresolvedUsage && status.unresolvedUsage.sessions > 0 && (
        <div className="rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
          未映射会话：{status.unresolvedUsage.sessions} sessions ·{' '}
          {formatNum(status.unresolvedUsage.messages)} messages ·{' '}
          {formatNum(status.unresolvedUsage.tokensTotal)} tokens
        </div>
      )}
    </div>
  );
}

function UsageUserTable({
  rows,
  title,
}: {
  title: string;
  rows: UsageUserRow[];
}): React.JSX.Element {
  return (
    <div>
      <div className="mb-2 text-xs font-medium text-[var(--color-text-muted)]">{title}</div>
      {rows.length === 0 ? (
        <div className="rounded bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
          暂无数据
        </div>
      ) : (
        <UsageUserRows rows={rows} />
      )}
    </div>
  );
}

function getUsageProjectName(row: UsageUserRow): string {
  return row.projectName || row.teamDisplayName || row.teamName || row.identity.displayName;
}

function normalizeUsageProjectPath(value: string | undefined): string {
  return String(value || '')
    .trim()
    .replace(/\\+/g, '/')
    .replace(/\/+$/g, '');
}

function getUsageProjectPath(row: UsageUserRow): string {
  return normalizeUsageProjectPath(
    row.workDir || row.bindProject || row.projectName || row.identity.confidence
  );
}

function mergeUsageProjectName(existing: UsageUserRow, row: UsageUserRow): string {
  const existingName = getUsageProjectName(existing);
  const nextName = getUsageProjectName(row);
  return existingName.length >= nextName.length ? existingName : nextName;
}

function aggregateUsageRowsByProject(rows: UsageUserRow[]): UsageUserRow[] {
  const grouped = new Map<string, UsageUserRow>();

  for (const row of rows) {
    const projectPath = getUsageProjectPath(row);
    const projectName = getUsageProjectName(row);
    const key = projectPath || projectName;
    const existing = grouped.get(key);

    if (!existing) {
      grouped.set(key, {
        ...row,
        key,
        identity: {
          ...row.identity,
          displayName: projectName,
        },
        workDir: projectPath,
      });
      continue;
    }

    const displayName = mergeUsageProjectName(existing, row);
    grouped.set(key, {
      ...existing,
      identity: {
        ...existing.identity,
        displayName,
      },
      sessions: existing.sessions + row.sessions,
      messages: existing.messages + row.messages,
      tokensTotal: existing.tokensTotal + row.tokensTotal,
      lastActiveAt:
        !existing.lastActiveAt || (row.lastActiveAt && row.lastActiveAt > existing.lastActiveAt)
          ? row.lastActiveAt
          : existing.lastActiveAt,
    });
  }

  return Array.from(grouped.values()).sort((a, b) => b.tokensTotal - a.tokensTotal);
}

function UsageUserRows({ rows }: { rows: UsageUserRow[] }): React.JSX.Element {
  const projectRows = aggregateUsageRowsByProject(rows);

  return (
    <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
      {projectRows.map((row) => (
        <div
          key={row.key}
          className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-2.5 py-2 text-xs"
        >
          <div className="flex items-start justify-between gap-3">
            <span className="min-w-0 text-[var(--color-text-secondary)]" title={row.key}>
              <span className="block truncate font-medium">{row.identity.displayName}</span>
              <span className="block truncate text-[10px] text-[var(--color-text-muted)]">
                {row.workDir ||
                  row.projectName ||
                  row.teamDisplayName ||
                  row.teamName ||
                  row.identity.confidence}
              </span>
              {row.identity.chatName && (
                <span className="block truncate text-[10px] text-[var(--color-text-muted)]">
                  群：{row.identity.chatName}
                </span>
              )}
            </span>
            <span className="shrink-0 text-right text-[10px] text-[var(--color-text-muted)]">
              <span className="block uppercase">{row.identity.platform}</span>
              <span className="block">
                {formatNum(row.messages)} msg · {formatNum(row.tokensTotal)} tokens
              </span>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function CapabilityCountPills({
  counts,
}: {
  counts: TeamCapabilityTelemetrySnapshot['counts'];
}): React.JSX.Element {
  const items = [
    ['Skills', counts.skills],
    ['Workflows', counts.workflows],
    ['Cron', counts.cron],
    ['MCP', counts.mcpServers],
    ['Commands', counts.commands],
  ] as const;
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {items.map(([label, value]) => (
        <span
          key={label}
          className="rounded-full border border-[var(--color-border-subtle)] px-2 py-0.5 text-[10px] text-[var(--color-text-muted)]"
        >
          {label} {value}
        </span>
      ))}
    </span>
  );
}

function CapabilitySnapshotTable({
  snapshots,
  summary,
}: {
  summary?: CapabilityTelemetrySummary;
  snapshots: TeamCapabilityTelemetrySnapshot[];
}): React.JSX.Element {
  const [expandedTeams, setExpandedTeams] = useState<Record<string, boolean>>({});
  const [expandedKinds, setExpandedKinds] = useState<Record<string, boolean>>({});
  if (snapshots.length === 0) return <></>;

  const counts = summary ?? {
    teams: snapshots.length,
    commands: snapshots.reduce((total, item) => total + item.counts.commands, 0),
    skills: snapshots.reduce((total, item) => total + item.counts.skills, 0),
    workflows: snapshots.reduce((total, item) => total + item.counts.workflows, 0),
    cron: snapshots.reduce((total, item) => total + item.counts.cron, 0),
    mcpServers: snapshots.reduce((total, item) => total + item.counts.mcpServers, 0),
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs font-medium text-[var(--color-text-muted)]">
        <span>数字员工能力资产</span>
        <span className="text-[10px]">
          {formatNum(counts.teams)} agents · {formatNum(counts.skills)} skills ·{' '}
          {formatNum(counts.workflows)} workflows · {formatNum(counts.cron)} cron ·{' '}
          {formatNum(counts.mcpServers)} MCP
        </span>
      </div>
      <div className="max-h-80 space-y-1 overflow-y-auto pr-1">
        {snapshots.map((snapshot) => {
          const teamKey = snapshot.teamSlug || snapshot.teamName;
          const isTeamExpanded = expandedTeams[teamKey] ?? false;
          return (
            <div key={teamKey} className="rounded bg-[var(--color-bg)] p-2">
              <button
                type="button"
                className="flex w-full items-start justify-between gap-3 text-left text-xs"
                onClick={() =>
                  setExpandedTeams((prev) => ({ ...prev, [teamKey]: !isTeamExpanded }))
                }
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-[var(--color-text-secondary)]">
                    {snapshot.teamDisplayName || snapshot.teamName}
                  </span>
                  <span className="block truncate text-[10px] text-[var(--color-text-muted)]">
                    {isTeamExpanded ? '收起能力明细' : '展开查看 Skills / Workflows / Cron / MCP'}
                  </span>
                </span>
                <CapabilityCountPills counts={snapshot.counts} />
              </button>
              {isTeamExpanded && (
                <div className="mt-2 space-y-1 border-t border-[var(--color-border-subtle)] pt-2">
                  {CAPABILITY_KIND_ORDER.map((kind) => {
                    const assets = snapshot.assets.filter((asset) => asset.kind === kind);
                    if (assets.length === 0) return null;
                    const kindKey = `${teamKey}:${kind}`;
                    const isKindExpanded = expandedKinds[kindKey] ?? false;
                    return (
                      <div
                        key={kind}
                        className="rounded border border-[var(--color-border-subtle)] p-2 text-[10px]"
                      >
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-2 text-left"
                          onClick={() =>
                            setExpandedKinds((prev) => ({ ...prev, [kindKey]: !isKindExpanded }))
                          }
                        >
                          <span className="font-medium text-[var(--color-text-secondary)]">
                            {CAPABILITY_KIND_LABELS[kind]}
                          </span>
                          <span className="text-[var(--color-text-muted)]">
                            {assets.length} · {isKindExpanded ? '收起' : '展开'}
                          </span>
                        </button>
                        {isKindExpanded && (
                          <div className="mt-2 grid gap-1 sm:grid-cols-2">
                            {assets.map((asset) => (
                              <div
                                key={asset.id}
                                className="rounded bg-[var(--color-surface-raised)] px-2 py-1"
                              >
                                <div className="truncate text-[var(--color-text-secondary)]">
                                  {asset.name}
                                </div>
                                {asset.description && (
                                  <div className="truncate text-[var(--color-text-muted)]">
                                    {asset.description}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 rounded bg-[var(--color-bg)] p-2">
      <div className="flex items-center gap-1 text-[var(--color-text-muted)]">
        {icon}
        <span className="text-[10px]">{label}</span>
      </div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

export function TaskBusSection(): React.JSX.Element {
  const [enabled, setEnabled] = useState(false);
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState(6379);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [collaborationEnabled, setCollaborationEnabled] = useState(false);
  const [telemetryEnabled, setTelemetryEnabled] = useState(false);
  const [telemetryPlatform, setTelemetryPlatform] = useState<'claudecode' | 'codex'>('claudecode');
  const [telemetryConfig, setTelemetryConfig] = useState<TaskBusConfig['telemetry'] | undefined>(
    undefined
  );
  const [telemetryStatus, setTelemetryStatus] = useState<TelemetryStatus | null>(null);

  useEffect(() => {
    fetch('/api/settings/task-bus')
      .then((r) => r.json())
      .then((data: TaskBusConfig) => {
        setEnabled(data.enabled);
        if (data.redis) {
          setHost(data.redis.host ?? '127.0.0.1');
          setPort(data.redis.port ?? 6379);
          setPassword(data.redis.password ?? '');
        }
        if (data.telemetry) {
          setTelemetryEnabled(data.telemetry.enabled);
          setTelemetryPlatform(data.telemetry.platform ?? 'claudecode');
        }
        setCollaborationEnabled(data.collaboration ?? false);
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    fetch('/api/telemetry/status')
      .then((r) => r.json())
      .then((status: TelemetryStatus) => {
        setTelemetryStatus(status);
        setConnected(status.connected === true);
      })
      .catch(() => {});
  }, []);

  const buildConfig = (overrides: BusSettingsPatch = {}): TaskBusConfig => ({
    enabled: overrides.enabled ?? enabled,
    redis: { host, port, password: password || undefined },
    collaboration: overrides.collaborationEnabled ?? collaborationEnabled,
    telemetry: {
      enabled: telemetryEnabled,
      platform: telemetryPlatform,
    },
  });

  const testRedisConnection = async (): Promise<boolean> => {
    setConnecting(true);
    setMessage(null);
    const config = buildConfig();
    try {
      const res = await fetch('/api/settings/task-bus', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      const ok = !!data.connected;
      setConnected(ok);
      setMessage(ok ? 'Redis 连接成功' : 'Redis 连接失败，请检查配置');
      return ok;
    } catch (err) {
      setMessage(`连接失败: ${err}`);
      return false;
    } finally {
      setConnecting(false);
    }
  };

  const toggle = (value: boolean) => {
    setEnabled(value);
    const config = buildConfig({ enabled: value });
    fetch('/api/settings/task-bus', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
      .then((r) => r.json())
      .then(() => setMessage(value ? '团队总线已激活' : '已关闭'))
      .catch(() => setMessage('操作失败'));
  };

  const toggleCollaboration = (value: boolean) => {
    setCollaborationEnabled(value);
    const config = buildConfig({ collaborationEnabled: value });
    fetch('/api/settings/task-bus', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
      .then(() => setMessage(value ? '已开启分布式团队协作' : '已关闭分布式团队协作'))
      .catch(() => setMessage('操作失败'));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={16} className="animate-spin text-[var(--color-text-muted)]" />
      </div>
    );
  }

  return (
    <div>
      <SettingsSectionHeader title="Usage 监测" icon={<Clock size={12} />} />
      <div className="py-3">
        {telemetryStatus ? (
          <UsageDashboard status={telemetryStatus} />
        ) : (
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 text-xs text-[var(--color-text-muted)]">
            Usage 监测概览加载中。
          </div>
        )}
      </div>

      <SettingsSectionHeader title="团队总线（本地 / 自托管）" icon={<Radio size={12} />} />

      <SettingRow
        label="启用团队总线"
        description="用于本地/自托管 Redis 和跨团队协作；Usage 统计不依赖 Redis"
      >
        <SettingsToggle enabled={enabled} onChange={toggle} />
      </SettingRow>

      {enabled && (
        <>
          <div className="border-b pb-4" style={{ borderColor: 'var(--color-border-subtle)' }}>
            <div className="flex items-center gap-2 px-1 pb-2">
              <span className="text-sm font-medium text-red-500">*</span>
              <span className="text-sm font-medium">Redis</span>
              <span className="text-xs text-[var(--color-text-muted)]">
                （仅用于本地/自托管协作）
              </span>
              <div className="ml-auto flex items-center gap-2">
                {connected ? (
                  <span className="flex items-center gap-1 text-xs text-emerald-500">
                    <Wifi size={12} />
                    已连接
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-red-500">
                    <WifiOff size={12} />
                    未连接
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-3 px-1 pt-2">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-[var(--color-text-muted)]">主机</label>
                  <input
                    type="text"
                    value={host}
                    onChange={(e) => {
                      setHost(e.target.value);
                      setConnected(false);
                    }}
                    className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--color-accent-border)] focus:ring-1 focus:ring-[var(--color-accent-border)]"
                    placeholder="127.0.0.1"
                  />
                </div>
                <div className="w-24">
                  <label className="mb-1 block text-xs text-[var(--color-text-muted)]">端口</label>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => {
                      setPort(Number(e.target.value));
                      setConnected(false);
                    }}
                    className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--color-accent-border)] focus:ring-1 focus:ring-[var(--color-accent-border)]"
                    placeholder="6379"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--color-text-muted)]">密码</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setConnected(false);
                  }}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--color-accent-border)] focus:ring-1 focus:ring-[var(--color-accent-border)]"
                  placeholder="可选"
                />
              </div>
              <div className="flex items-center gap-3 pt-1">
                <Button
                  size="sm"
                  onClick={testRedisConnection}
                  disabled={connecting}
                  className="gap-1.5"
                >
                  {connecting ? <Loader2 size={12} className="animate-spin" /> : <Wifi size={12} />}
                  {connecting ? '连接中...' : '测试连接'}
                </Button>
                {message && (
                  <span className={`text-xs ${connected ? 'text-emerald-500' : 'text-red-500'}`}>
                    {message}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div>
            <SettingRow
              label="分布式团队协作"
              description="开启本地/自托管团队总线基础能力，供后续任务池和协作视图使用；"
            >
              <SettingsToggle
                enabled={collaborationEnabled}
                onChange={(value) => void toggleCollaboration(value)}
              />
            </SettingRow>

            {!connected && collaborationEnabled && (
              <div className="flex items-center gap-2 px-1 py-2 text-xs text-amber-500">
                <AlertCircle size={12} />
                <span>跨团队协作需要本地/自托管 Redis 连接。</span>
              </div>
            )}
          </div>
        </>
      )}

      {!enabled && message && (
        <div
          className="border-b py-2 text-xs text-[var(--color-text-muted)]"
          style={{ borderColor: 'var(--color-border-subtle)' }}
        >
          {message}
        </div>
      )}
    </div>
  );
}
