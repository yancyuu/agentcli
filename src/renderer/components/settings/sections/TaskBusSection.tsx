import { useEffect, useState } from 'react';

import { Button } from '@renderer/components/ui/button';
import { SettingRow, SettingsSectionHeader, SettingsToggle } from '../components';
import type { TaskBusConfig } from '@shared/types/team';
import { Loader2, Radio, Wifi, WifiOff } from 'lucide-react';

export function TaskBusSection(): React.JSX.Element {
  const [enabled, setEnabled] = useState(false);
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState(6379);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async (connectRedis = false) => {
    setMessage(null);
    if (connectRedis) setConnecting(true);
    const config: TaskBusConfig = {
      enabled,
      redis: { host, port, password: password || undefined },
    };
    try {
      const res = await fetch('/api/settings/task-bus', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (connectRedis) {
        setConnected(!!data.connected);
        setMessage(
          data.connected ? 'Redis 连接成功，分布式派发已启用' : 'Redis 连接失败，仅本地派发'
        );
      } else {
        setConnected(false);
        setMessage(enabled ? '已开启，指令已注入到团队工作目录' : '已关闭');
      }
    } catch (err) {
      setMessage(`操作失败: ${err}`);
    } finally {
      setConnecting(false);
    }
  };

  const toggle = (value: boolean) => {
    setEnabled(value);
    const config: TaskBusConfig = {
      enabled: value,
      redis: { host, port, password: password || undefined },
    };
    fetch('/api/settings/task-bus', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
      .then((r) => r.json())
      .then(() => setMessage(value ? '已开启，指令已注入到团队工作目录' : '已关闭'))
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
      <SettingsSectionHeader title="任务总线" icon={<Radio size={12} />} />

      <SettingRow
        label="启用任务总线"
        description="开启后自动为所有团队注入跨团队任务派发指令到 CLAUDE.md"
      >
        <SettingsToggle enabled={enabled} onChange={toggle} />
      </SettingRow>

      {/* Redis */}
      <SettingRow label="Redis" description="可选，配置后启用跨主机分布式派发">
        <div className="flex items-center gap-2">
          {connected ? (
            <span className="flex items-center gap-1 text-xs text-emerald-500">
              <Wifi size={12} />
              已连接
            </span>
          ) : enabled ? (
            <span className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
              <WifiOff size={12} />
              本地模式
            </span>
          ) : null}
        </div>
      </SettingRow>

      {enabled && (
        <div className="border-b pb-4" style={{ borderColor: 'var(--color-border-subtle)' }}>
          <div className="space-y-3 px-1 pt-2">
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="mb-1 block text-xs text-[var(--color-text-muted)]">主机</label>
                <input
                  type="text"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-sm outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30"
                  placeholder="127.0.0.1"
                />
              </div>
              <div className="w-24">
                <label className="mb-1 block text-xs text-[var(--color-text-muted)]">端口</label>
                <input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value))}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-sm outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30"
                  placeholder="6379"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--color-text-muted)]">密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-sm outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30"
                placeholder="可选"
              />
            </div>
            <div className="flex items-center gap-3 pt-1">
              <Button
                size="sm"
                onClick={() => save(true)}
                disabled={connecting}
                className="gap-1.5"
              >
                {connecting && <Loader2 size={12} className="animate-spin" />}
                {connecting ? '连接中...' : '测试连接'}
              </Button>
              {message && <span className="text-xs text-[var(--color-text-muted)]">{message}</span>}
            </div>
          </div>
        </div>
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
