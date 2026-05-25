import { useCallback, useEffect, useState } from 'react';

import { Button } from '@renderer/components/ui/button';
import type { TaskBusConfig } from '@shared/types/team';

const defaultConfig: TaskBusConfig = {
  enabled: false,
  redis: { host: '127.0.0.1', port: 6379 },
};

export function TaskBusSection(): React.JSX.Element {
  const [config, setConfig] = useState<TaskBusConfig>(defaultConfig);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings/task-bus')
      .then((r) => r.json())
      .then((data) => {
        setConfig(data ?? defaultConfig);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/settings/task-bus', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (data.ok) {
        setTestResult('已保存');
      } else {
        setTestResult(`保存失败: ${data.error ?? 'unknown'}`);
      }
    } catch (err) {
      setTestResult(`保存失败: ${err}`);
    } finally {
      setSaving(false);
    }
  }, [config]);

  const testConnection = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/settings/task-bus', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, enabled: true }),
      });
      const data = await res.json();
      setTestResult(data.connected ? `连接成功: ${data.message}` : `连接失败: ${data.message}`);
    } catch (err) {
      setTestResult(`连接失败: ${err}`);
    } finally {
      setTesting(false);
    }
  }, [config]);

  if (loading) {
    return <div className="px-4 py-8 text-center text-[var(--color-text-muted)]">加载中...</div>;
  }

  return (
    <div className="space-y-6 px-2">
      {/* Enable toggle */}
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
          className="h-4 w-4 rounded border-[var(--color-border)]"
        />
        <div>
          <div className="text-sm font-medium">启用任务总线</div>
          <div className="text-xs text-[var(--color-text-muted)]">
            开启后可通过 Redis 与其他 Hermit 实例共享团队任务
          </div>
        </div>
      </label>

      {/* Redis config */}
      <fieldset
        className={`space-y-4 rounded-lg border border-[var(--color-border)] p-4 ${
          !config.enabled ? 'opacity-50' : ''
        }`}
        disabled={!config.enabled}
      >
        <legend className="px-2 text-sm font-medium">Redis 配置</legend>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-xs text-[var(--color-text-muted)]">主机</label>
            <input
              type="text"
              value={config.redis.host}
              onChange={(e) =>
                setConfig({ ...config, redis: { ...config.redis, host: e.target.value } })
              }
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-sm"
              placeholder="127.0.0.1"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--color-text-muted)]">端口</label>
            <input
              type="number"
              value={config.redis.port}
              onChange={(e) =>
                setConfig({ ...config, redis: { ...config.redis, port: Number(e.target.value) } })
              }
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-sm"
              placeholder="6379"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs text-[var(--color-text-muted)]">密码（可选）</label>
          <input
            type="password"
            value={config.redis.password ?? ''}
            onChange={(e) =>
              setConfig({
                ...config,
                redis: { ...config.redis, password: e.target.value || undefined },
              })
            }
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-sm"
            placeholder="留空则无密码"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-[var(--color-text-muted)]">数据库编号</label>
          <input
            type="number"
            min={0}
            max={15}
            value={config.redis.db ?? 0}
            onChange={(e) =>
              setConfig({ ...config, redis: { ...config.redis, db: Number(e.target.value) } })
            }
            className="w-24 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-sm"
          />
        </div>
      </fieldset>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          onClick={testConnection}
          disabled={!config.enabled || testing}
        >
          {testing ? '测试中...' : '测试连接'}
        </Button>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? '保存中...' : '保存'}
        </Button>
        {testResult && <span className="text-xs text-[var(--color-text-muted)]">{testResult}</span>}
      </div>
    </div>
  );
}
