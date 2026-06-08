import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { AGENT_TYPE_LABELS } from '@renderer/components/team/HarnessCards';
import { HarnessSelect } from '@renderer/components/team/HarnessSelect';
import { Loader2, Settings2 } from 'lucide-react';

import { api } from '@renderer/api';
import { useStore } from '@renderer/store';
import { isTeamProvisioningActive } from '@renderer/store/slices/teamSlice';
import type { GlobalProvider } from '@shared/types';
import type { CcAgentType } from '@shared/types/ccConnect';
import { PERMISSION_MODE_OPTIONS } from './useTeamEditForm';
import { PlatformBindingContent } from './PlatformBindingDialog';

// ── Section wrapper ──────────────────────────────────────────
function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="rounded-md border border-[var(--color-border)] p-3">
      <h3 className="text-sm font-medium text-[var(--color-text)]">{title}</h3>
      {description && (
        <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{description}</p>
      )}
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  );
}

const inputCls =
  'w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-border-emphasis)]';
const labelCls = 'mb-1 block text-xs font-medium text-[var(--color-text-secondary)]';

interface RuntimeConfigDialogProps {
  open: boolean;
  teamName: string;
  onClose: () => void;
}

export function RuntimeConfigDialog({
  open,
  teamName,
  onClose,
}: RuntimeConfigDialogProps): React.JSX.Element {
  const { data, fetchTeams, selectTeam } = useStore((s) => ({
    data: s.selectedTeamName === teamName ? s.selectedTeamData : null,
    fetchTeams: s.fetchTeams,
    selectTeam: s.selectTeam,
  }));
  const isProvisioning = useStore((s) => isTeamProvisioningActive(s, teamName));

  // ── Derived defaults ─────────────────────────────────────────
  const defaults = useMemo(() => {
    const cfg = data?.config;
    const d = data as Record<string, unknown> | null;
    return {
      agentType: cfg?.agentType ?? (d?.harness as string | undefined) ?? 'claudecode',
      workDir: (d?.workDir as string | undefined) ?? cfg?.projectPath ?? '',
      permissionMode: cfg?.permissionMode ?? (d?.permissionMode as string | undefined) ?? 'default',
      disabledCommands: Array.isArray(cfg?.disabledCommands)
        ? cfg.disabledCommands
        : [],
      providerRefs: data?.providerRefs ?? [],
      globalProviders: data?.globalProviders ?? [],
      bindProject: (d?.bindProject as string | undefined) ?? teamName,
    };
  }, [data, teamName]);

  // ── Local form state ─────────────────────────────────────────
  const [agentType, setAgentType] = useState(defaults.agentType);
  const [permissionMode, setPermissionMode] = useState(defaults.permissionMode);
  const [workDir, setWorkDir] = useState(defaults.workDir);
  const [disabledCommandsInput, setDisabledCommandsInput] = useState(
    defaults.disabledCommands.join(', ')
  );
  const [providerRef, setProviderRef] = useState(defaults.providerRefs[0] ?? '');

  const [savePhase, setSavePhase] = useState<'idle' | 'saving' | 'restarting' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const saving = savePhase === 'saving' || savePhase === 'restarting';

  const defaultsRef = useRef(defaults);
  if (defaults.agentType) defaultsRef.current = defaults;

  // ── Reset form when dialog opens ─────────────────────────────
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (!open || prevOpenRef.current) {
      prevOpenRef.current = open;
      return;
    }
    prevOpenRef.current = true;
    const d = defaultsRef.current;
    setSavePhase('idle');
    setError(null);
    setAgentType(d.agentType);
    setPermissionMode(d.permissionMode);
    setWorkDir(d.workDir);
    setDisabledCommandsInput(d.disabledCommands.join(', '));
    setProviderRef(d.providerRefs[0] ?? '');
  }, [open]);

  // ── Computed ─────────────────────────────────────────────────
  const compatibleProviders = useMemo(
    () =>
      defaults.globalProviders.filter(
        (p) =>
          !p.agent_types ||
          p.agent_types.length === 0 ||
          (p.agent_types as string[]).includes(agentType)
      ),
    [defaults.globalProviders, agentType]
  );

  const toggleProviderRef = (providerName: string): void => {
    setError(null);
    setProviderRef(providerRef === providerName ? '' : providerName);
  };

  // ── Save ─────────────────────────────────────────────────────
  const handleSave = (): void => {
    if (savePhase !== 'idle') return;
    const disabledCommands = disabledCommandsInput
      .split(',')
      .map((e) => e.trim())
      .filter((e) => e.length > 0);

    setSavePhase('saving');
    setError(null);

    void (async () => {
      try {
        await api.teams.updateConfig(teamName, {
          agentType: agentType.trim() || undefined,
          workDir: workDir.trim() || undefined,
          permissionMode: permissionMode.trim() || undefined,
          disabledCommands,
          providerRefs: providerRef ? [providerRef] : [],
        });
        await Promise.all([fetchTeams(), selectTeam(teamName)]);

        setSavePhase('restarting');
        try {
          await api.ccSettings.restart();
          setSavePhase('done');
        } catch (restartErr) {
          setError(
            `配置已保存，但重启失败：${restartErr instanceof Error ? restartErr.message : '未知错误'}`
          );
          setSavePhase('idle');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '保存失败');
        setSavePhase('idle');
      }
    })();
  };

  const saveLabel =
    savePhase === 'done'
      ? '已完成'
      : savePhase === 'restarting'
        ? '正在重启...'
        : savePhase === 'saving'
          ? '保存中...'
          : '保存并重启';

  const [bindingStep, setBindingStep] = useState<'runtime' | 'bind'>('runtime');

  return (
    <Dialog
      open={savePhase === 'saving' ? true : open}
      onOpenChange={(nextOpen) => {
        if (saving) return;
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 size={16} />
            运行时配置
          </DialogTitle>
          <DialogDescription>
            修改 Agent 类型、渠道、消息设置等运行时参数。部分变更需要重启服务。
          </DialogDescription>
        </DialogHeader>

        {bindingStep === 'bind' ? (
          <PlatformBindingContent
            projectName={defaults.bindProject}
            workDir={workDir}
            agentType={agentType}
            onComplete={() => setBindingStep('runtime')}
            onCancel={() => setBindingStep('runtime')}
          />
        ) : (
          <div className="space-y-4">
            {/* Agent & 权限 */}
            <FormSection title="Agent & 权限">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className={labelCls}>Agent 类型</label>
                  <HarnessSelect
                    value={agentType as CcAgentType}
                    onChange={(v) => { setError(null); setAgentType(v); }}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className={labelCls}>权限模式</label>
                  <select
                    value={permissionMode}
                    onChange={(e) => { setError(null); setPermissionMode(e.target.value); }}
                    className={inputCls}
                  >
                    {PERMISSION_MODE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className={labelCls}>工作目录</label>
                <input
                  type="text"
                  value={workDir}
                  onChange={(e) => { setError(null); setWorkDir(e.target.value); }}
                  className={`${inputCls} font-mono`}
                  placeholder="/Users/you/code/project"
                />
              </div>
            </FormSection>

            {/* 渠道 */}
            <FormSection title="渠道" description="绑定外部消息平台（飞书、Telegram 等）。">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBindingStep('bind')}
              >
                绑定新渠道
              </Button>
            </FormSection>

            {/* Provider */}
            <div className="rounded-lg border border-[var(--color-border-subtle)] bg-white/[0.02] p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-[var(--color-text)]">Provider（可选）</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                    留空时使用本机 {AGENT_TYPE_LABELS[agentType as CcAgentType] ?? agentType} 默认配置。
                  </p>
                </div>
                {providerRef ? (
                  <button
                    type="button"
                    className="shrink-0 rounded-md border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text-muted)] hover:bg-white/5"
                    onClick={() => setProviderRef('')}
                  >
                    使用本机默认
                  </button>
                ) : null}
              </div>
              <div className="mt-3 space-y-2">
                {compatibleProviders.length > 0 ? (
                  compatibleProviders.map((provider) => {
                    const checked = providerRef === provider.name;
                    const at = agentType as CcAgentType;
                    const endpoint = provider.endpoints?.[at] ?? provider.base_url ?? '默认端点';
                    const model =
                      provider.agent_models?.[at] ?? provider.model ?? provider.models?.[0]?.model ?? '未指定模型';
                    return (
                      <button
                        key={provider.name}
                        type="button"
                        onClick={() => toggleProviderRef(provider.name)}
                        className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                          checked
                            ? 'border-indigo-400/60 bg-indigo-500/10'
                            : 'border-[var(--color-border-subtle)] bg-black/10 hover:border-[var(--color-border)] hover:bg-white/[0.04]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-[var(--color-text)]">{provider.name}</p>
                            <p className="mt-0.5 truncate text-[11px] text-[var(--color-text-muted)]">
                              {model} · {endpoint}
                            </p>
                          </div>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${
                              checked ? 'bg-indigo-400/20 text-indigo-200' : 'bg-white/5 text-[var(--color-text-muted)]'
                            }`}
                          >
                            {checked ? '已绑定' : '可绑定'}
                          </span>
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="rounded-md border border-dashed border-[var(--color-border)] px-3 py-3 text-xs text-[var(--color-text-muted)]">
                    暂无适用于 {AGENT_TYPE_LABELS[agentType as CcAgentType] ?? agentType} 的全局 Provider。
                  </div>
                )}
              </div>
            </div>

            {/* 高级 */}
            <FormSection title="高级">
              <div>
                <label className={labelCls}>已禁用命令</label>
                <input
                  type="text"
                  value={disabledCommandsInput}
                  onChange={(e) => { setError(null); setDisabledCommandsInput(e.target.value); }}
                  className={inputCls}
                  placeholder="restart, upgrade, cron"
                />
              </div>
            </FormSection>

            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>
        )}

        {bindingStep === 'runtime' && (
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
              {savePhase === 'done' ? '关闭' : '取消'}
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || savePhase === 'done'}
            >
              {saving && <Loader2 size={14} className="mr-1.5 animate-spin" />}
              {saveLabel}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
