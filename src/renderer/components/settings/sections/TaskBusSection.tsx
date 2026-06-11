import { useEffect, useState } from 'react';

import { Button } from '@renderer/components/ui/button';
import { SettingRow, SettingsSectionHeader, SettingsToggle } from '../components';
import type { TaskBusConfig } from '@shared/types/team';
import {
  Loader2,
  Radio,
  Wifi,
  WifiOff,
  BarChart3,
  Clock,
  MessageSquare,
  Zap,
  Calendar,
  AlertCircle,
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
  activeDays: number;
  hourly: number[];
  projects: Array<{
    cwd: string;
    sessions: number;
    messages: number;
    tokensIn: number;
    tokensOut: number;
  }>;
  workSecondsByDay: Record<string, number>;
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
          label="Loop runs"
          value={formatNum(status.sessions)}
        />
        <StatCard
          icon={<MessageSquare size={14} />}
          label="指令事件"
          value={formatNum(status.messages)}
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
          24小时 Loop 分布
        </div>
        <div className="flex h-16 items-end gap-0.5">
          {status.hourly.map((count, i) => {
            const pct = (count / maxHourly) * 100;
            return (
              <div
                key={i}
                className="flex-1 rounded-sm bg-[var(--color-accent-muted)] transition-all hover:bg-[var(--color-accent)]"
                style={{ height: `${Math.max(pct, 2)}%` }}
                title={`${i}:00 - ${count} Loop events`}
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

      {status.projects.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-medium text-[var(--color-text-muted)]">
            项目 Loop 吞吐（累计）
          </div>
          {/* Header row */}
          <div className="grid grid-cols-[1fr_64px_64px] items-center gap-2 pb-1 text-[10px] text-[var(--color-text-muted)]">
            <span>项目</span>
            <span className="text-right">事件</span>
            <span className="text-right">Token</span>
          </div>
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {status.projects.slice(0, 10).map((proj, i) => (
              <div key={i} className="grid grid-cols-[1fr_64px_64px] items-center gap-2 text-xs">
                <span className="truncate text-[var(--color-text-secondary)]" title={proj.cwd}>
                  {proj.cwd.split('/').pop() || proj.cwd}
                </span>
                <span className="text-right text-[var(--color-text-muted)]">
                  {formatNum(proj.messages)}
                </span>
                <span className="text-right text-[var(--color-text-muted)]">
                  {formatNum(proj.tokensIn + proj.tokensOut)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
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

  const [collectionEnabled, setCollectionEnabled] = useState(false);
  const [uploadEnabled, setUploadEnabled] = useState(false);
  const [collaborationEnabled, setCollaborationEnabled] = useState(false);
  const [telemetryPlatform, setTelemetryPlatform] = useState('claudecode');
  const [scanning, setScanning] = useState(false);
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
          setCollectionEnabled(data.telemetry.enabled);
          setUploadEnabled(data.telemetry.uploadEnabled ?? false);
          setTelemetryPlatform(data.telemetry.platform ?? 'claudecode');
        }
        setCollaborationEnabled(data.collaboration ?? false);
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    // Restore telemetry status on mount. Local data collection does not depend on Redis/task bus.
    fetch('/api/telemetry/status')
      .then((r) => r.json())
      .then((s: TelemetryStatus) => {
        setTelemetryStatus(s);
        setConnected(s.connected === true);
      })
      .catch(() => {});

    const poll = setInterval(() => {
      if (collectionEnabled) {
        fetch('/api/telemetry/status')
          .then((r) => r.json())
          .then((s: TelemetryStatus) => {
            setTelemetryStatus(s);
            setConnected(s.connected === true);
          })
          .catch(() => {});
      }
    }, 30000);
    return () => clearInterval(poll);
  }, [enabled, collectionEnabled]);

  const buildConfig = (
    overrides: Partial<{
      enabled: boolean;
      collectionEnabled: boolean;
      uploadEnabled: boolean;
      collaborationEnabled: boolean;
      telemetryPlatform: string;
    }> = {}
  ): TaskBusConfig => ({
    enabled: overrides.enabled ?? enabled,
    redis: { host, port, password: password || undefined },
    collaboration: overrides.collaborationEnabled ?? collaborationEnabled,
    telemetry: {
      enabled: overrides.collectionEnabled ?? collectionEnabled,
      uploadEnabled: overrides.uploadEnabled ?? uploadEnabled,
      platform: (overrides.telemetryPlatform ?? telemetryPlatform) as 'claudecode',
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

  const toggleCollection = async (value: boolean) => {
    setCollectionEnabled(value);
    const config = buildConfig({ collectionEnabled: value });
    try {
      await fetch('/api/settings/task-bus', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (value) triggerScan();
      else setTelemetryStatus(null);
    } catch {
      setCollectionEnabled(!value);
      setMessage('操作失败');
    }
  };

  const toggleUpload = async (value: boolean) => {
    if (!value) {
      setUploadEnabled(false);
      const config = buildConfig({ uploadEnabled: false });
      fetch('/api/settings/task-bus', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      }).catch(() => setMessage('操作失败'));
      return;
    }

    // Upload requires Redis
    let redisReady = connected;
    if (!redisReady) {
      setMessage('正在测试 Redis 连接...');
      redisReady = await testRedisConnection();
      if (!redisReady) {
        setUploadEnabled(false);
        setMessage('Redis 连接失败，无法启用数据上报');
        return;
      }
    }

    setUploadEnabled(true);
    setMessage(null);
    const config = buildConfig({ uploadEnabled: true });
    try {
      await fetch('/api/settings/task-bus', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
    } catch {
      setUploadEnabled(false);
      setMessage('操作失败');
    }
  };

  const triggerScan = () => {
    if (scanning) return;
    setScanning(true);
    fetch('/api/telemetry/scan', { method: 'POST' })
      .then((r) => r.json())
      .then((result: TelemetryStatus & { ok?: boolean }) => {
        if ('sessions' in result) {
          setTelemetryStatus(result);
        }
      })
      .catch(() => setMessage('采集失败，请检查本地 Claude Code 会话目录'))
      .finally(() => setScanning(false));
  };

  const saveTelemetryPlatform = (nextPlatform = telemetryPlatform) => {
    const config = buildConfig({ telemetryPlatform: nextPlatform });
    fetch('/api/settings/task-bus', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    }).catch(() => {});
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
      <SettingsSectionHeader title="本地数据采集" icon={<BarChart3 size={12} />} />

      <SettingRow
        label="数据采集"
        description="扫描本机 ~/.claude/projects 会话文件，采集 Loop 使用指标；不需要 Redis，也不会上传对话内容"
      >
        <div className="flex items-center gap-2">
          <select
            value={telemetryPlatform}
            onChange={(e) => {
              const nextPlatform = e.target.value;
              setTelemetryPlatform(nextPlatform);
              saveTelemetryPlatform(nextPlatform);
            }}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs outline-none focus:border-[var(--color-accent-border)]"
          >
            <option value="claudecode">Claude Code</option>
          </select>
          <SettingsToggle
            enabled={collectionEnabled}
            onChange={(value) => void toggleCollection(value)}
          />
        </div>
      </SettingRow>

      <div
        className="flex items-center gap-3 border-b py-3"
        style={{ borderColor: 'var(--color-border-subtle)' }}
      >
        <Button
          size="sm"
          variant="outline"
          onClick={triggerScan}
          disabled={scanning || !collectionEnabled}
          className="gap-1.5"
        >
          {scanning ? <Loader2 size={12} className="animate-spin" /> : <BarChart3 size={12} />}
          {scanning ? '采集中...' : '立即采集'}
        </Button>
        <span className="text-[10px] text-[var(--color-text-muted)]">
          本地扫描，不依赖团队总线或 Redis。{!collectionEnabled ? '开启数据采集后可手动刷新。' : ''}
        </span>
      </div>

      <div className="py-3">
        {telemetryStatus ? (
          <UsageDashboard status={telemetryStatus} />
        ) : (
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 text-xs text-[var(--color-text-muted)]">
            Loop 使用概览加载中；开启数据采集后会扫描本机 Claude Code 会话文件。
          </div>
        )}
      </div>

      <SettingsSectionHeader title="团队总线" icon={<Radio size={12} />} />

      <SettingRow
        label="启用团队总线"
        description="用于 Redis 连接、数据上报和跨团队协作；本地数据采集不依赖它"
      >
        <SettingsToggle enabled={enabled} onChange={toggle} />
      </SettingRow>

      {enabled && (
        <>
          {/* Redis 配置 - 必填 */}
          <div className="border-b pb-4" style={{ borderColor: 'var(--color-border-subtle)' }}>
            <div className="flex items-center gap-2 px-1 pb-2">
              <span className="text-sm font-medium text-red-500">*</span>
              <span className="text-sm font-medium">Redis</span>
              <span className="text-xs text-[var(--color-text-muted)]">
                （上报和跨团队协作必填）
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

          {/* 数据上报 - 依赖 Redis，最下面 */}
          <div>
            <SettingRow label="数据上报" description="将采集数据上报到 Redis，供团队看板使用">
              <SettingsToggle
                enabled={uploadEnabled}
                onChange={(value) => void toggleUpload(value)}
              />
            </SettingRow>

            {!connected && (
              <div className="flex items-center gap-2 px-1 py-2 text-xs text-amber-500">
                <AlertCircle size={12} />
                <span>数据上报需要 Redis；请先配置并测试 Redis 连接。</span>
              </div>
            )}
          </div>

          {/* 分布式团队协作 - 最下面 */}
          <div>
            <SettingRow
              label="分布式团队协作"
              description="开启后 Hermit 平台识别 @团队 并创建跨团队协作任务；Agent 只读取团队列表，不直接派发"
            >
              <SettingsToggle
                enabled={collaborationEnabled}
                onChange={(value) => void toggleCollaboration(value)}
              />
            </SettingRow>

            {!connected && collaborationEnabled && (
              <div className="flex items-center gap-2 px-1 py-2 text-xs text-amber-500">
                <AlertCircle size={12} />
                <span>跨团队协作需要 Redis 连接。</span>
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
