/**
 * PlatformsSection — 消息渠道管理（飞书、微信、Telegram 等）。
 *
 * 数据来源: cc-connect /api/v1/projects (projects[].platform_configs)
 * 支持查看每个项目下已接入的平台，并可新增渠道。
 */

import { useCallback, useEffect, useState } from 'react';

import { api } from '@renderer/api';
import { confirm } from '@renderer/components/common/ConfirmDialog';
import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { emitOpenHermitEvent, OPEN_HERMIT_EVENTS } from '@renderer/utils/openHermitEvents';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select';
import { cn } from '@renderer/lib/utils';
import { ChevronDown, ChevronRight, Plus, RefreshCw, Wifi, WifiOff } from 'lucide-react';

import { SettingsSectionHeader } from '../components/SettingsSectionHeader';

// ---------------------------------------------------------------------------
// 平台枚举 + 字段配置
// ---------------------------------------------------------------------------

type PlatformType = 'feishu' | 'lark' | 'wechat' | 'telegram' | 'dingtalk' | 'slack' | 'bridge';

interface PlatformField {
  key: string;
  label: string;
  placeholder: string;
  required?: boolean;
  secret?: boolean;
  type?: 'text' | 'select';
  options?: { value: string; label: string }[];
}

const PLATFORM_META: Record<PlatformType, { label: string; fields: PlatformField[] }> = {
  feishu: {
    label: '飞书',
    fields: [
      { key: 'app_id', label: 'App ID', placeholder: 'cli_xxxxxxxxxxxxxxxx', required: true },
      { key: 'app_secret', label: 'App Secret', placeholder: '...', required: true, secret: true },
      { key: 'allow_from', label: '允许来源（用户 ID 或 *）', placeholder: '* 或 ou_xxxx' },
      {
        key: 'share_session_in_channel',
        label: '群内共享记忆',
        placeholder: '',
        type: 'select',
        options: [
          { value: 'false', label: '关闭（默认）— 每人独立上下文' },
          { value: 'true', label: '开启 — 群内所有人共享同一 Agent 会话' },
        ],
      },
      {
        key: 'thread_isolation',
        label: '按回复串隔离',
        placeholder: '',
        type: 'select',
        options: [
          { value: 'false', label: '关闭（默认）' },
          { value: 'true', label: '开启 — 每个飞书回复串独立会话' },
        ],
      },
    ],
  },
  lark: {
    label: 'Lark（国际版飞书）',
    fields: [
      { key: 'app_id', label: 'App ID', placeholder: 'cli_xxxxxxxxxxxxxxxx', required: true },
      { key: 'app_secret', label: 'App Secret', placeholder: '...', required: true, secret: true },
      { key: 'allow_from', label: '允许来源', placeholder: '* 或 ou_xxxx' },
      {
        key: 'share_session_in_channel',
        label: '群内共享记忆',
        placeholder: '',
        type: 'select',
        options: [
          { value: 'false', label: '关闭（默认）— 每人独立上下文' },
          { value: 'true', label: '开启 — 群内共享同一会话' },
        ],
      },
    ],
  },
  wechat: {
    label: '企业微信',
    fields: [
      { key: 'corp_id', label: 'Corp ID', placeholder: 'wx...', required: true },
      { key: 'agent_id', label: 'Agent ID', placeholder: '1000001', required: true },
      { key: 'token', label: 'Token', placeholder: '...', required: true, secret: true },
      { key: 'aes_key', label: 'AES Key', placeholder: '...', secret: true },
    ],
  },
  telegram: {
    label: 'Telegram',
    fields: [
      {
        key: 'bot_token',
        label: 'Bot Token',
        placeholder: '1234567890:AAH...',
        required: true,
        secret: true,
      },
      { key: 'allow_from', label: '允许的 Chat ID', placeholder: '* 或 123456789' },
      {
        key: 'share_session_in_channel',
        label: '群内共享记忆',
        placeholder: '',
        type: 'select',
        options: [
          { value: 'false', label: '关闭（默认）— 每人独立上下文' },
          { value: 'true', label: '开启 — 群内共享同一会话' },
        ],
      },
    ],
  },
  dingtalk: {
    label: '钉钉',
    fields: [
      { key: 'app_key', label: 'App Key', placeholder: 'dingxxxxxxxx', required: true },
      { key: 'app_secret', label: 'App Secret', placeholder: '...', required: true, secret: true },
      { key: 'allow_from', label: '允许来源', placeholder: '*' },
      {
        key: 'share_session_in_channel',
        label: '群内共享记忆',
        placeholder: '',
        type: 'select',
        options: [
          { value: 'false', label: '关闭（默认）— 每人独立上下文' },
          { value: 'true', label: '开启 — 群内共享同一会话' },
        ],
      },
    ],
  },
  slack: {
    label: 'Slack',
    fields: [
      {
        key: 'bot_token',
        label: 'Bot Token',
        placeholder: 'xoxb-...',
        required: true,
        secret: true,
      },
      { key: 'app_token', label: 'App Token', placeholder: 'xapp-...', secret: true },
    ],
  },
  bridge: {
    label: 'Bridge（内部）',
    fields: [{ key: 'allow_from', label: '允许来源', placeholder: '* 或平台名' }],
  },
};

const ALL_PLATFORM_TYPES = Object.keys(PLATFORM_META) as PlatformType[];

// ---------------------------------------------------------------------------
// API helpers（走 /api/v1 proxy）
// ---------------------------------------------------------------------------

interface ProjectSummary {
  name: string;
  agent_type: string;
  platforms: string[];
  sessions_count: number;
}

interface ProjectDetail {
  name: string;
  agent_type: string;
  platforms: Array<{ type: string; connected: boolean }>;
  platform_configs: Array<Record<string, string>>;
}

async function fetchProjects(): Promise<ProjectSummary[]> {
  const res = await fetch('/api/v1/projects');
  const json = (await res.json()) as { ok: boolean; data?: { projects: ProjectSummary[] } };
  return json.data?.projects ?? [];
}

async function fetchProjectDetail(name: string): Promise<ProjectDetail> {
  const res = await fetch(`/api/v1/projects/${encodeURIComponent(name)}`);
  const json = (await res.json()) as { ok: boolean; data?: ProjectDetail };
  if (!json.ok || !json.data) throw new Error('加载失败');
  return json.data;
}

async function addPlatform(
  projectName: string,
  type: string,
  options: Record<string, string>
): Promise<{ restartRequired: boolean }> {
  const res = await fetch(`/api/v1/projects/${encodeURIComponent(projectName)}/add-platform`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, options }),
  });
  const json = (await res.json()) as {
    ok: boolean;
    error?: string;
    data?: { restart_required?: boolean };
    restart_required?: boolean;
  };
  if (!json.ok) throw new Error(json.error ?? '添加失败');
  return {
    restartRequired: json.data?.restart_required === true || json.restart_required === true,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const PlatformsSection = (): React.JSX.Element => {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, ProjectDetail>>({});
  const [addOpen, setAddOpen] = useState<string | null>(null); // project name

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchProjects();
      setProjects(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleExpand = async (name: string) => {
    if (expanded === name) {
      setExpanded(null);
      return;
    }
    setExpanded(name);
    if (!details[name]) {
      try {
        const d = await fetchProjectDetail(name);
        setDetails((prev) => ({ ...prev, [name]: d }));
      } catch {
        /* ignore */
      }
    }
  };

  const handleAdded = async (projectName: string) => {
    setAddOpen(null);
    // Refresh detail
    try {
      const d = await fetchProjectDetail(projectName);
      setDetails((prev) => ({ ...prev, [projectName]: d }));
    } catch {
      /* ignore */
    }
    void refresh();
  };

  return (
    <div className="space-y-6">
      <SettingsSectionHeader title="渠道" />

      {error && (
        <div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          {projects.length} 个项目
        </span>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={cn('mr-1.5 size-3.5', loading && 'animate-spin')} />
          刷新
        </Button>
      </div>

      {loading && (
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          加载中…
        </p>
      )}

      <div className="space-y-2">
        {projects.map((proj) => {
          const isExpanded = expanded === proj.name;
          const detail = details[proj.name];
          return (
            <div
              key={proj.name}
              className="overflow-hidden rounded-lg border"
              style={{ borderColor: 'var(--color-border)' }}
            >
              {/* Project header */}
              <button
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-surface-raised)]"
                style={{ background: 'var(--color-surface-raised)' }}
                onClick={() => void toggleExpand(proj.name)}
              >
                {isExpanded ? (
                  <ChevronDown
                    className="size-4 shrink-0"
                    style={{ color: 'var(--color-text-muted)' }}
                  />
                ) : (
                  <ChevronRight
                    className="size-4 shrink-0"
                    style={{ color: 'var(--color-text-muted)' }}
                  />
                )}
                <span className="flex-1 text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                  {proj.name}
                </span>
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {proj.agent_type}
                </span>
                {/* Platform badges */}
                <div className="flex gap-1.5">
                  {proj.platforms.map((p) => (
                    <span
                      key={p}
                      className="rounded px-1.5 py-0.5 text-xs"
                      style={{
                        background: 'rgba(129,140,248,0.1)',
                        color: 'var(--color-accent)',
                        border: '1px solid rgba(129,140,248,0.2)',
                      }}
                    >
                      {PLATFORM_META[p as PlatformType]?.label ?? p}
                    </span>
                  ))}
                </div>
              </button>

              {/* Expanded detail */}
              {isExpanded && (
                <div
                  className="space-y-3 border-t px-4 py-3"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
                >
                  {detail ? (
                    <>
                      {detail.platforms.map((p) => {
                        const meta = PLATFORM_META[p.type as PlatformType];
                        const cfg = detail.platform_configs.find((c) => c.type === p.type);
                        return (
                          <div
                            key={p.type}
                            className="rounded-lg border p-3"
                            style={{
                              borderColor: 'var(--color-border)',
                              background: 'var(--color-surface-raised)',
                            }}
                          >
                            <div className="mb-2 flex items-center gap-2">
                              {p.connected ? (
                                <Wifi className="size-3.5 text-green-400" />
                              ) : (
                                <WifiOff className="size-3.5 text-red-400" />
                              )}
                              <span
                                className="text-sm font-medium"
                                style={{ color: 'var(--color-text)' }}
                              >
                                {meta?.label ?? p.type}
                              </span>
                              <span
                                className="ml-auto text-xs"
                                style={{ color: p.connected ? '#22c55e' : '#ef4444' }}
                              >
                                {p.connected ? '已连接' : '未连接'}
                              </span>
                            </div>
                            {cfg &&
                              Object.entries(cfg)
                                .filter(([k]) => k !== 'type')
                                .map(([k, v]) => (
                                  <div key={k} className="mt-1 flex gap-2 text-xs">
                                    <span
                                      className="w-28 shrink-0"
                                      style={{ color: 'var(--color-text-muted)' }}
                                    >
                                      {k}
                                    </span>
                                    <span
                                      className="truncate font-mono"
                                      style={{ color: 'var(--color-text-secondary)' }}
                                    >
                                      {k.toLowerCase().includes('secret') ||
                                      k.toLowerCase().includes('token') ||
                                      k.toLowerCase().includes('key')
                                        ? `${String(v).slice(0, 6)}••••`
                                        : String(v)}
                                    </span>
                                  </div>
                                ))}
                          </div>
                        );
                      })}
                    </>
                  ) : (
                    <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      加载中…
                    </p>
                  )}

                  <Button size="sm" variant="outline" onClick={() => setAddOpen(proj.name)}>
                    <Plus className="mr-1.5 size-3.5" />
                    添加渠道
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add platform dialog */}
      <AddPlatformDialog
        projectName={addOpen ?? ''}
        open={!!addOpen}
        onClose={() => setAddOpen(null)}
        onAdded={handleAdded}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Add platform dialog
// ---------------------------------------------------------------------------

function AddPlatformDialog({
  projectName,
  open,
  onClose,
  onAdded,
}: {
  projectName: string;
  open: boolean;
  onClose: () => void;
  onAdded: (projectName: string) => void;
}) {
  const [platformType, setPlatformType] = useState<PlatformType>('feishu');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPlatformType('feishu');
      setFields({});
      setError(null);
    }
  }, [open]);

  const meta = PLATFORM_META[platformType];

  const handleSave = async () => {
    const missing = meta.fields.filter((f) => f.required && !fields[f.key]?.trim());
    if (missing.length > 0) {
      setError(`请填写必填字段: ${missing.map((f) => f.label).join(', ')}`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Convert boolean-like string values to actual booleans for cc-connect
      const ccOptions: Record<string, string | boolean> = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v === 'true') ccOptions[k] = true;
        else if (v === 'false') ccOptions[k] = false;
        else ccOptions[k] = v;
      }
      const result = await addPlatform(
        projectName,
        platformType,
        ccOptions as Record<string, string>
      );
      onAdded(projectName);
      if (result.restartRequired) {
        const shouldRestart = await confirm({
          title: '重启服务',
          message: '渠道已添加。需要重启服务才会生效。',
          confirmLabel: '立即重启',
          cancelLabel: '稍后重启',
        });
        if (shouldRestart) {
          await api.ccSettings.restart();
          emitOpenHermitEvent(OPEN_HERMIT_EVENTS.runtimeRestarted);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '添加失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>为「{projectName}」添加渠道</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>平台类型</Label>
            <Select
              value={platformType}
              onValueChange={(v) => {
                setPlatformType(v as PlatformType);
                setFields({});
              }}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALL_PLATFORM_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {PLATFORM_META[t].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {meta.fields.map((f) => (
            <div key={f.key}>
              <Label>
                {f.label}
                {f.required && <span className="ml-1 text-red-400">*</span>}
              </Label>
              {f.type === 'select' && f.options ? (
                <Select
                  value={fields[f.key] ?? f.options[0].value}
                  onValueChange={(v) => setFields((prev) => ({ ...prev, [f.key]: v }))}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {f.options.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type={f.secret ? 'password' : 'text'}
                  value={fields[f.key] ?? ''}
                  onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="mt-1"
                />
              )}
            </div>
          ))}

          {error && <p className="text-sm text-red-400">{error}</p>}

          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            添加后需要重启服务才能生效。
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? '添加中…' : '添加'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
