/**
 * ChannelsSection — Global AI model providers (渠道) management.
 *
 * Ported from cc-connect's Providers page. Each provider corresponds to an
 * upstream AI model endpoint (Claude API, MiniMax, AIHubMix, etc.) and may
 * support multiple agent CLIs (claudecode, codex, gemini, ...) with per-agent
 * overrides for base URL and model.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { providersApi } from '@renderer/api/providers';
import { Badge } from '@renderer/components/ui/badge';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select';
import { cn } from '@renderer/lib/utils';
import {
  Check,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  PlugZap,
  Plus,
  RefreshCw,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react';

import { SettingsSectionHeader } from '../components/SettingsSectionHeader';

import type {
  AgentType,
  CCSwitchProvider,
  GlobalProvider,
  ProviderModelEntry,
  ProviderPreset,
} from '@shared/types/providers';

type Tab = 'providers' | 'presets';

const ALL_AGENT_TYPES: AgentType[] = [
  'claudecode',
  'codex',
  'gemini',
  'opencode',
  'cursor',
  'kimi',
  'qoder',
  'acp',
];

export const ChannelsSection = (): React.JSX.Element => {
  const [tab, setTab] = useState<Tab>('providers');
  const [providers, setProviders] = useState<GlobalProvider[]>([]);
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [editing, setEditing] = useState<GlobalProvider | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [ccSwitchOpen, setCcSwitchOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await providersApi.list();
      setProviders(res.providers ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载渠道失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPresets = useCallback(async (forceRefresh = false) => {
    setPresetsLoading(true);
    try {
      const res = await providersApi.fetchPresets({ forceRefresh });
      setPresets(res.providers ?? []);
    } catch {
      /* ignore */
    } finally {
      setPresetsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (tab === 'presets' && presets.length === 0) {
      void loadPresets();
    }
  }, [tab, presets.length, loadPresets]);

  const handleDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    try {
      await providersApi.remove(deleteTarget);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleAddFromPreset = (preset: ProviderPreset): void => {
    const agentTypes = Object.keys(preset.agents ?? {}) as AgentType[];
    const firstAt = agentTypes[0] ?? 'claudecode';
    const firstAc = preset.agents?.[firstAt];

    const endpoints: Partial<Record<AgentType, string>> = {};
    const agentModels: Partial<Record<AgentType, string>> = {};
    const agentModelLists: Partial<Record<AgentType, ProviderModelEntry[]>> = {};
    let codex: GlobalProvider['codex'];

    for (const [at, cfg] of Object.entries(preset.agents ?? {})) {
      const key = at as AgentType;
      if (key !== firstAt && cfg.base_url) endpoints[key] = cfg.base_url;
      if (key !== firstAt && cfg.model) agentModels[key] = cfg.model;
      const models = cfg.models?.map((m): ProviderModelEntry => ({ model: m }));
      if (models?.length && key !== firstAt) agentModelLists[key] = models;
      if (key === 'codex' && cfg.codex_config?.wire_api) {
        codex = {
          wire_api: cfg.codex_config.wire_api,
          http_headers: cfg.codex_config.http_headers,
        };
      }
    }

    const draft: GlobalProvider = {
      name: preset.name,
      base_url: firstAc?.base_url ?? '',
      model: firstAc?.model ?? '',
      thinking: preset.thinking ?? '',
      models: firstAc?.models?.map((m): ProviderModelEntry => ({ model: m })),
      agent_types: agentTypes,
      endpoints: Object.keys(endpoints).length ? endpoints : undefined,
      agent_models: Object.keys(agentModels).length ? agentModels : undefined,
      agent_model_lists: Object.keys(agentModelLists).length ? agentModelLists : undefined,
      codex,
    };

    setEditing(draft);
    setFormOpen(true);
  };

  return (
    <div className="space-y-4">
      <SettingsSectionHeader icon={<PlugZap className="size-3.5" />} title="模型渠道" />
      <p className="-mt-4 text-xs text-[var(--color-text-muted)]">
        统一管理团队可用的 AI 模型供应商。支持 Claude Code、Codex、Gemini、OpenCode 等多种 Agent
        CLI，可从预设中一键拉起，或从 cc-switch 导入已有配置。
      </p>

      {/* Header actions */}
      <div className="flex items-center justify-between">
        <div className="inline-flex h-8 items-center gap-0.5 rounded-md bg-[var(--color-surface-raised)] p-0.5">
          {(['providers', 'presets'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                'rounded px-3 py-1 text-xs font-medium transition-colors',
                tab === key
                  ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              )}
            >
              {key === 'providers' ? `已添加 (${providers.length})` : '预设市场'}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => setCcSwitchOpen(true)}
          >
            <Download className="mr-1 size-3" />从 cc-switch 导入
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="mr-1 size-3" />
            新增渠道
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      ) : null}

      {tab === 'providers' && (
        <ProviderGrid
          providers={providers}
          loading={loading}
          onEdit={(p) => {
            setEditing(p);
            setFormOpen(true);
          }}
          onDelete={(name) => setDeleteTarget(name)}
        />
      )}
      {tab === 'presets' && (
        <PresetGrid
          presets={presets}
          loading={presetsLoading}
          existingNames={new Set(providers.map((p) => p.name))}
          onAdd={handleAddFromPreset}
          onRefresh={() => loadPresets(true)}
        />
      )}

      {formOpen ? (
        <ProviderFormDialog
          provider={editing}
          onClose={() => setFormOpen(false)}
          onSave={async (p, isEdit) => {
            try {
              if (isEdit) await providersApi.update(p.name, p);
              else await providersApi.add(p);
              setFormOpen(false);
              await refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : '保存失败');
            }
          }}
          existingNames={new Set(providers.map((p) => p.name))}
        />
      ) : null}

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除渠道</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[var(--color-text-muted)]">
            确定要删除「{deleteTarget}」吗？相关团队成员需要重新选择渠道。
          </p>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button variant="destructive" size="sm" onClick={() => void handleDelete()}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {ccSwitchOpen ? (
        <CCSwitchImportDialog
          existingNames={new Set(providers.map((p) => p.name))}
          onClose={() => setCcSwitchOpen(false)}
          onImported={async () => {
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
};

/* ─── Provider grid ─── */

interface ProviderGridProps {
  providers: GlobalProvider[];
  loading: boolean;
  onEdit: (p: GlobalProvider) => void;
  onDelete: (name: string) => void;
}

function ProviderGrid({
  providers,
  loading,
  onEdit,
  onDelete,
}: ProviderGridProps): React.JSX.Element {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <Loader2 className="size-3.5 animate-spin" />
        正在加载…
      </div>
    );
  }
  if (providers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-[var(--color-border)] py-12 text-center">
        <PlugZap className="size-8 text-[var(--color-text-muted)]" />
        <p className="mt-3 text-sm font-medium text-[var(--color-text-secondary)]">
          还没有添加渠道
        </p>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          从「预设市场」一键添加，或点击「新增渠道」手动配置。
        </p>
      </div>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {providers.map((p) => (
        <div
          key={p.name}
          className="group relative rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3 transition-colors hover:border-[var(--color-border-emphasis)]"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <PlugZap className="size-3.5 shrink-0 text-[var(--color-text-secondary)]" />
                <h3 className="truncate text-sm font-medium text-[var(--color-text)]">{p.name}</h3>
              </div>
              {p.base_url ? (
                <p
                  className="mt-1 truncate text-[11px] text-[var(--color-text-muted)]"
                  title={p.base_url}
                >
                  {p.base_url}
                </p>
              ) : null}
              {p.model ? <Badge className="mt-2 text-[10px]">{p.model}</Badge> : null}
              {p.models && p.models.length > 0 ? (
                <ModelChipRow models={p.models.map((m) => m.alias ?? m.model)} limit={3} />
              ) : null}
              {p.agent_types && p.agent_types.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.agent_types.map((a) => (
                    <span
                      key={a}
                      className="rounded border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-300"
                    >
                      {a}
                    </span>
                  ))}
                </div>
              ) : null}
              {p.thinking ? (
                <p className="mt-1.5 text-[10px] text-amber-300">thinking: {p.thinking}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                onClick={() => onEdit(p)}
                className="rounded p-1 text-[var(--color-text-muted)] hover:bg-white/5 hover:text-[var(--color-text)]"
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onDelete(p.name)}
                className="rounded p-1 text-[var(--color-text-muted)] hover:bg-red-500/10 hover:text-red-300"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Preset grid ─── */

interface PresetGridProps {
  presets: ProviderPreset[];
  loading: boolean;
  existingNames: Set<string>;
  onAdd: (p: ProviderPreset) => void;
  onRefresh: () => void;
}

function PresetGrid({
  presets,
  loading,
  existingNames,
  onAdd,
  onRefresh,
}: PresetGridProps): React.JSX.Element {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <Loader2 className="size-3.5 animate-spin" />
        正在拉取预设…
      </div>
    );
  }
  if (presets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-[var(--color-border)] py-12 text-center">
        <Sparkles className="size-8 text-[var(--color-text-muted)]" />
        <p className="mt-3 text-sm font-medium text-[var(--color-text-secondary)]">暂无可用预设</p>
        <Button variant="ghost" size="sm" className="mt-3 text-xs" onClick={onRefresh}>
          <RefreshCw className="mr-1 size-3" />
          重试
        </Button>
      </div>
    );
  }
  const sorted = [...presets].sort((a, b) => a.tier - b.tier);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {sorted.map((p) => {
        const added = existingNames.has(p.name);
        const agentKeys = Object.keys(p.agents ?? {});
        const firstAc = p.agents?.[agentKeys[0]];
        return (
          <div
            key={p.name}
            className="relative flex flex-col overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3"
          >
            {p.featured ? (
              <div className="absolute right-0 top-0 rounded-bl bg-amber-400 px-1.5 py-0.5 text-[9px] font-bold text-amber-950">
                <Star className="-mt-px mr-0.5 inline size-2.5" />
                推荐
              </div>
            ) : null}
            <div className="flex-1 space-y-2">
              <h3 className="text-sm font-medium text-[var(--color-text)]">
                {p.display_name || p.name}
              </h3>
              {p.description_zh || p.description ? (
                <p className="line-clamp-2 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                  {p.description_zh || p.description}
                </p>
              ) : null}
              {agentKeys.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {agentKeys.map((a) => (
                    <span
                      key={a}
                      className="rounded border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-300"
                    >
                      {a}
                    </span>
                  ))}
                </div>
              ) : null}
              {p.features && p.features.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {p.features.map((f) => (
                    <Badge key={f} variant="outline" className="text-[10px]">
                      {f}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {firstAc?.models && firstAc.models.length > 0 ? (
                <ModelChipRow models={firstAc.models} limit={5} />
              ) : null}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-[var(--color-border)] pt-2">
              {p.invite_url ? (
                <a
                  href={p.invite_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-[10px] text-blue-300 hover:underline"
                >
                  注册 <ExternalLink className="size-2.5" />
                </a>
              ) : (
                <span />
              )}
              <Button
                type="button"
                size="sm"
                variant={added ? 'ghost' : 'default'}
                className="h-7 text-[11px]"
                disabled={added}
                onClick={() => onAdd(p)}
              >
                {added ? '已添加' : '一键添加'}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Model chip row (collapsible) ─── */

function ModelChipRow({
  models,
  limit = 3,
}: {
  models: string[];
  limit?: number;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? models : models.slice(0, limit);
  const remaining = models.length - limit;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      {visible.map((m) => (
        <Badge key={m} variant="outline" className="text-[10px]">
          {m}
        </Badge>
      ))}
      {remaining > 0 && !expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-[10px] text-[var(--color-text-secondary)] hover:underline"
        >
          +{remaining}
        </button>
      ) : null}
      {expanded && remaining > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-[10px] text-[var(--color-text-muted)] hover:underline"
        >
          收起
        </button>
      ) : null}
    </div>
  );
}

/* ─── Provider form dialog ─── */

interface ProviderFormDialogProps {
  provider: GlobalProvider | null;
  existingNames: Set<string>;
  onClose: () => void;
  onSave: (provider: GlobalProvider, isEdit: boolean) => Promise<void>;
}

interface AgentDraft {
  base_url: string;
  model: string;
  models: ProviderModelEntry[];
  wire_api?: string;
}

function buildAgentDrafts(p: GlobalProvider): Record<string, AgentDraft> {
  const map: Record<string, AgentDraft> = {};
  const types = p.agent_types ?? [];
  for (const at of types) {
    map[at] = {
      base_url: p.endpoints?.[at] ?? p.base_url ?? '',
      model: p.agent_models?.[at] ?? p.model ?? '',
      models: p.agent_model_lists?.[at] ?? p.models ?? [],
      wire_api: at === 'codex' ? (p.codex?.wire_api ?? '') : undefined,
    };
  }
  return map;
}

function mergeAgentDrafts(
  base: GlobalProvider,
  drafts: Record<string, AgentDraft>
): GlobalProvider {
  const agents = Object.keys(drafts);
  if (agents.length === 0) return base;
  const first = agents[0];
  const baseDraft = drafts[first];
  const endpoints: Partial<Record<AgentType, string>> = {};
  const agentModels: Partial<Record<AgentType, string>> = {};
  const agentModelLists: Partial<Record<AgentType, ProviderModelEntry[]>> = {};
  let codex: GlobalProvider['codex'];

  for (const at of agents) {
    const draft = drafts[at];
    if (at !== first) {
      if (draft.base_url && draft.base_url !== baseDraft.base_url) {
        endpoints[at as AgentType] = draft.base_url;
      }
      if (draft.model && draft.model !== baseDraft.model) {
        agentModels[at as AgentType] = draft.model;
      }
      if (
        draft.models.length > 0 &&
        JSON.stringify(draft.models) !== JSON.stringify(baseDraft.models)
      ) {
        agentModelLists[at as AgentType] = draft.models;
      }
    }
    if (at === 'codex' && draft.wire_api) {
      codex = { wire_api: draft.wire_api };
    }
  }

  return {
    ...base,
    base_url: baseDraft.base_url,
    model: baseDraft.model,
    models: baseDraft.models.length > 0 ? baseDraft.models : undefined,
    endpoints: Object.keys(endpoints).length ? endpoints : undefined,
    agent_models: Object.keys(agentModels).length ? agentModels : undefined,
    agent_model_lists: Object.keys(agentModelLists).length ? agentModelLists : undefined,
    codex,
  };
}

function ProviderFormDialog({
  provider,
  existingNames,
  onClose,
  onSave,
}: ProviderFormDialogProps): React.JSX.Element {
  const isEdit = !!provider && existingNames.has(provider.name);
  const [form, setForm] = useState<GlobalProvider>(provider ?? { name: '' });
  const [drafts, setDrafts] = useState<Record<string, AgentDraft>>(() =>
    provider ? buildAgentDrafts(provider) : {}
  );
  const [activeTab, setActiveTab] = useState<string>(form.agent_types?.[0] ?? '');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agents = form.agent_types ?? [];
  const multiAgent = agents.length >= 2;

  const set = <K extends keyof GlobalProvider>(key: K, value: GlobalProvider[K]): void => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const toggleAgent = (at: AgentType): void => {
    const has = agents.includes(at);
    const next = has ? agents.filter((x) => x !== at) : [...agents, at];
    set('agent_types', next as AgentType[]);
    setDrafts((prev) => {
      const updated = { ...prev };
      if (!has && !updated[at]) {
        updated[at] = {
          base_url: form.base_url ?? '',
          model: form.model ?? '',
          models: [...(form.models ?? [])],
          wire_api: at === 'codex' ? (form.codex?.wire_api ?? '') : undefined,
        };
      } else if (has) {
        delete updated[at];
      }
      return updated;
    });
    if (next.length >= 2 && !next.includes(activeTab as AgentType)) {
      setActiveTab(next[0]);
    }
  };

  const submit = async (): Promise<void> => {
    if (!form.name.trim()) {
      setError('请填写渠道名称');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = multiAgent ? mergeAgentDrafts(form, drafts) : form;
      await onSave(payload, isEdit);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `编辑渠道：${provider?.name ?? ''}` : '新增渠道'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="provider-name">渠道名称 *</Label>
            <Input
              id="provider-name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="如 minimax / anthropic-main"
              disabled={isEdit}
            />
          </div>

          {/* API key */}
          <div className="space-y-1.5">
            <Label htmlFor="provider-key">API Key</Label>
            <div className="relative">
              <Input
                id="provider-key"
                type={showKey ? 'text' : 'password'}
                value={form.api_key ?? ''}
                onChange={(e) => set('api_key', e.target.value)}
                placeholder="sk-…"
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              >
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          {/* Agent types */}
          <div className="space-y-1.5">
            <Label>支持的 Agent CLI</Label>
            <div className="flex flex-wrap gap-1.5">
              {ALL_AGENT_TYPES.map((at) => {
                const selected = agents.includes(at);
                return (
                  <button
                    key={at}
                    type="button"
                    onClick={() => toggleAgent(at)}
                    className={cn(
                      'rounded border px-2 py-1 text-[11px] font-medium transition-colors',
                      selected
                        ? 'border-blue-500/40 bg-blue-500/10 text-blue-300'
                        : 'border-[var(--color-border)] bg-transparent text-[var(--color-text-muted)] hover:border-[var(--color-border-emphasis)]'
                    )}
                  >
                    {at}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-[var(--color-text-muted)]">
              支持多种 Agent CLI 时，可在下方为每种 CLI 单独设置 base URL 和模型。
            </p>
          </div>

          {/* Base URL / Model / Models */}
          {!multiAgent ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="provider-baseurl">Base URL</Label>
                <Input
                  id="provider-baseurl"
                  value={form.base_url ?? ''}
                  onChange={(e) => set('base_url', e.target.value)}
                  placeholder="https://api.example.com/v1"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="provider-model">默认模型</Label>
                <Input
                  id="provider-model"
                  value={form.model ?? ''}
                  onChange={(e) => set('model', e.target.value)}
                  placeholder="claude-sonnet-4-20250514"
                />
              </div>
              <div className="space-y-1.5">
                <Label>可用模型列表</Label>
                <ModelListEditor
                  models={form.models ?? []}
                  onChange={(models) => set('models', models)}
                  defaultModel={form.model}
                  onSetDefault={(model) => set('model', model)}
                />
              </div>
            </>
          ) : (
            <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-raised)]">
              <p className="border-b border-[var(--color-border)] px-3 py-2 text-[10px] text-[var(--color-text-muted)]">
                为每种 Agent CLI 独立配置（base URL / model / models）
              </p>
              <div className="flex gap-1 border-b border-[var(--color-border)] px-3 pt-2">
                {agents.map((at) => (
                  <button
                    key={at}
                    type="button"
                    onClick={() => setActiveTab(at)}
                    className={cn(
                      'rounded-t px-3 py-1 text-[11px] font-medium transition-colors',
                      (activeTab || agents[0]) === at
                        ? 'bg-[var(--color-surface)] text-[var(--color-text)]'
                        : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                    )}
                  >
                    {at}
                  </button>
                ))}
              </div>
              <div className="space-y-3 p-3">
                {agents.map((at) => {
                  if ((activeTab || agents[0]) !== at) return null;
                  const draft = drafts[at] ?? { base_url: '', model: '', models: [] };
                  const update = (patch: Partial<AgentDraft>): void => {
                    setDrafts((prev) => ({ ...prev, [at]: { ...draft, ...patch } }));
                  };
                  return (
                    <div key={at} className="space-y-3">
                      <div className="space-y-1.5">
                        <Label className="text-[11px]">Base URL</Label>
                        <Input
                          value={draft.base_url}
                          onChange={(e) => update({ base_url: e.target.value })}
                          placeholder="https://api.example.com/v1"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[11px]">默认模型</Label>
                        <Input
                          value={draft.model}
                          onChange={(e) => update({ model: e.target.value })}
                          placeholder="model-name"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[11px]">可用模型列表</Label>
                        <ModelListEditor
                          models={draft.models}
                          onChange={(models) => update({ models })}
                          defaultModel={draft.model}
                          onSetDefault={(model) => update({ model })}
                        />
                      </div>
                      {at === 'codex' ? (
                        <div className="space-y-1.5">
                          <Label className="text-[11px]">Codex Wire API</Label>
                          <Select
                            value={draft.wire_api ?? ''}
                            onValueChange={(v) => update({ wire_api: v })}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="default" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="responses">responses</SelectItem>
                              <SelectItem value="chat">chat</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Thinking */}
          <div className="space-y-1.5">
            <Label>Thinking 模式</Label>
            <Select value={form.thinking ?? ''} onValueChange={(v) => set('thinking', v)}>
              <SelectTrigger>
                <SelectValue placeholder="跟随渠道默认" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="enabled">enabled</SelectItem>
                <SelectItem value="disabled">disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {error ? (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" onClick={() => void submit()} disabled={!form.name.trim() || saving}>
            {saving ? <Loader2 className="mr-1 size-3 animate-spin" /> : null}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Model list editor ─── */

function ModelListEditor({
  models,
  onChange,
  defaultModel,
  onSetDefault,
}: {
  models: ProviderModelEntry[];
  onChange: (models: ProviderModelEntry[]) => void;
  defaultModel?: string;
  onSetDefault?: (model: string) => void;
}): React.JSX.Element {
  const [input, setInput] = useState('');

  const addModel = (): void => {
    const name = input.trim();
    if (!name || models.some((m) => m.model === name)) return;
    onChange([...models, { model: name }]);
    setInput('');
  };

  const removeModel = (model: string): void => {
    onChange(models.filter((m) => m.model !== model));
  };

  return (
    <div className="space-y-2">
      {models.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {models.map((m) => {
            const isDefault = defaultModel === m.model;
            return (
              <span
                key={m.model}
                className={cn(
                  'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px]',
                  isDefault
                    ? 'border-blue-500/40 bg-blue-500/10 text-blue-200'
                    : 'border-[var(--color-border)] bg-[var(--color-surface-raised)] text-[var(--color-text-secondary)]'
                )}
              >
                {onSetDefault && !isDefault ? (
                  <button
                    type="button"
                    onClick={() => onSetDefault(m.model)}
                    title="设为默认"
                    className="text-[var(--color-text-muted)] hover:text-blue-300"
                  >
                    <Check className="size-2.5" />
                  </button>
                ) : null}
                {isDefault ? <Check className="size-2.5 text-blue-300" /> : null}
                {m.model}
                <button
                  type="button"
                  onClick={() => removeModel(m.model)}
                  className="text-[var(--color-text-muted)] hover:text-red-300"
                >
                  <X className="size-2.5" />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addModel();
            }
          }}
          placeholder="model-name"
          className="flex-1"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addModel}
          disabled={!input.trim()}
        >
          <Plus className="size-3" />
        </Button>
      </div>
    </div>
  );
}

/* ─── cc-switch import dialog ─── */

interface CCSwitchDialogProps {
  existingNames: Set<string>;
  onClose: () => void;
  onImported: () => Promise<void>;
}

function CCSwitchImportDialog({
  existingNames,
  onClose,
  onImported,
}: CCSwitchDialogProps): React.JSX.Element {
  const [providers, setProviders] = useState<CCSwitchProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: string[]; skipped: string[] } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await providersApi.listCCSwitch();
        if (!res.available) {
          setError(res.error ?? '未找到 cc-switch 配置');
        } else {
          setProviders(res.providers);
          const selectable = res.providers.filter((p) => !existingNames.has(p.name));
          setSelected(new Set(selectable.map((p) => p.name)));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '读取失败');
      } finally {
        setLoading(false);
      }
    })();
  }, [existingNames]);

  const toggle = (name: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const doImport = async (): Promise<void> => {
    setImporting(true);
    try {
      const res = await providersApi.importCCSwitch([...selected]);
      setResult(res);
      await onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败');
    } finally {
      setImporting(false);
    }
  };

  const importableCount = useMemo(
    () => providers.filter((p) => !existingNames.has(p.name)).length,
    [providers, existingNames]
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>从 cc-switch 导入渠道</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-[var(--color-text-muted)]">
            <Loader2 className="mr-2 size-4 animate-spin" />
            正在读取 cc-switch 配置…
          </div>
        ) : error ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-xs text-amber-300">
            {error}
            {error.includes('better-sqlite3') ? (
              <p className="mt-2 text-[10px] text-[var(--color-text-muted)]">
                提示：安装 better-sqlite3 后可启用此功能。
              </p>
            ) : null}
          </div>
        ) : result ? (
          <div className="space-y-2">
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
              已导入 {result.imported.length} 个，跳过 {result.skipped.length} 个。
            </div>
            <DialogFooter>
              <Button size="sm" onClick={onClose}>
                完成
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <p className="text-xs text-[var(--color-text-muted)]">
              在 cc-switch 中发现 {providers.length} 个渠道，其中 {importableCount}{' '}
              个可导入（已存在的会被跳过）。
            </p>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {providers.map((p) => {
                const exists = existingNames.has(p.name);
                return (
                  <label
                    key={p.name}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 transition-colors',
                      exists
                        ? 'cursor-not-allowed opacity-50'
                        : selected.has(p.name)
                          ? 'border-blue-500/40 bg-blue-500/5'
                          : 'border-[var(--color-border)] hover:bg-[var(--color-surface-raised)]'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(p.name)}
                      disabled={exists}
                      onChange={() => !exists && toggle(p.name)}
                      className="size-3.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-xs font-medium text-[var(--color-text)]">
                          {p.name}
                        </span>
                        <Badge variant="outline" className="text-[9px]">
                          {p.app_type}
                        </Badge>
                        {p.is_current ? (
                          <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1 py-px text-[9px] text-emerald-300">
                            当前
                          </span>
                        ) : null}
                        {exists ? (
                          <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1 py-px text-[9px] text-amber-300">
                            已存在
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 truncate text-[10px] text-[var(--color-text-muted)]">
                        {p.model ? <span>{p.model}</span> : null}
                        {p.model && p.base_url ? <span> · </span> : null}
                        {p.base_url ? <span>{p.base_url}</span> : null}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={onClose}>
                取消
              </Button>
              <Button
                size="sm"
                onClick={() => void doImport()}
                disabled={selected.size === 0 || importing}
              >
                {importing ? <Loader2 className="mr-1 size-3 animate-spin" /> : null}
                导入 {selected.size} 个
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
