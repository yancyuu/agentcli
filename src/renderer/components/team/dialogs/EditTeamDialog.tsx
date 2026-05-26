import { useEffect, useState } from 'react';

import { api } from '@renderer/api';
import { ALL_AGENT_TYPES, AGENT_TYPE_LABELS } from '@renderer/components/team/HarnessCards';
import { Button } from '@renderer/components/ui/button';
import { Checkbox } from '@renderer/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Loader2, Trash2 } from 'lucide-react';

import type { ResolvedTeamMember } from '@shared/types';
import type { CcAgentType } from '@shared/types/ccConnect';
import type { GlobalProvider } from '@shared/types/providers';

interface EditTeamDialogProps {
  open: boolean;
  teamName: string;
  currentName: string;
  currentDescription: string;
  currentColor: string;
  currentAgentType?: string;
  currentWorkDir?: string;
  currentPermissionMode?: string;
  currentLanguage?: string;
  currentShowContextIndicator?: boolean;
  currentReplyFooter?: boolean;
  currentInjectSender?: boolean;
  currentManagedSources?: string;
  currentDisabledCommands?: string[];
  currentPlatformAllowFrom?: Record<string, string>;
  currentProviderRefs?: string[];
  globalProviders?: GlobalProvider[];
  currentMembers: ResolvedTeamMember[];
  leadMember?: ResolvedTeamMember | null;
  resolvedMemberColorMap?: ReadonlyMap<string, string>;
  isTeamAlive?: boolean;
  isTeamProvisioning?: boolean;
  projectPath?: string | null;
  /** Deprecated in cc-connect mode: runtime edits are managed from Harness configuration. */
  savedLaunchRequest?: unknown;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  onRestartTeam?: () => Promise<void> | void;
  onDeleteTeam?: () => void;
}

const PERMISSION_MODE_OPTIONS = [
  { value: 'default', label: '默认' },
  { value: 'acceptEdits', label: '自动接受编辑' },
  { value: 'bypassPermissions', label: '跳过权限确认' },
  { value: 'plan', label: '计划模式' },
] as const;

export const EditTeamDialog = ({
  open,
  teamName,
  currentName,
  currentDescription,
  currentColor,
  currentAgentType = 'cursor',
  currentWorkDir = '',
  currentPermissionMode = 'default',
  currentLanguage = 'zh',
  currentShowContextIndicator = true,
  currentReplyFooter = true,
  currentInjectSender = false,
  currentManagedSources = '*',
  currentDisabledCommands = [],
  currentPlatformAllowFrom = {},
  currentProviderRefs = [],
  globalProviders = [],
  isTeamAlive = false,
  isTeamProvisioning = false,
  onClose,
  onSaved,
  onRestartTeam,
  onDeleteTeam,
}: EditTeamDialogProps): React.JSX.Element => {
  const [name, setName] = useState(currentName);
  const [description, setDescription] = useState(currentDescription);
  const [agentType, setAgentType] = useState(currentAgentType);
  const [teamWorkDir, setTeamWorkDir] = useState(currentWorkDir);
  const [permissionMode, setPermissionMode] = useState(currentPermissionMode);
  const [language, setLanguage] = useState(currentLanguage);
  const [showContextIndicator, setShowContextIndicator] = useState(currentShowContextIndicator);
  const [replyFooter, setReplyFooter] = useState(currentReplyFooter);
  const [injectSender, setInjectSender] = useState(currentInjectSender);
  const [managedSources, setManagedSources] = useState(currentManagedSources);
  const [disabledCommandsInput, setDisabledCommandsInput] = useState(
    currentDisabledCommands.join(', ')
  );
  const [feishuAllowFrom, setFeishuAllowFrom] = useState(currentPlatformAllowFrom.feishu ?? '*');
  const [providerRefs, setProviderRefs] = useState<string>(currentProviderRefs[0] ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(currentName);
    setDescription(currentDescription);
    setAgentType(currentAgentType);
    setTeamWorkDir(currentWorkDir);
    setPermissionMode(currentPermissionMode);
    setLanguage(currentLanguage);
    setShowContextIndicator(currentShowContextIndicator);
    setReplyFooter(currentReplyFooter);
    setInjectSender(currentInjectSender);
    setManagedSources(currentManagedSources);
    setDisabledCommandsInput(currentDisabledCommands.join(', '));
    setFeishuAllowFrom(currentPlatformAllowFrom.feishu ?? '*');
    setProviderRefs(currentProviderRefs[0] ?? '');
    setError(null);
  }, [
    open,
    currentName,
    currentDescription,
    currentAgentType,
    currentWorkDir,
    currentPermissionMode,
    currentLanguage,
    currentShowContextIndicator,
    currentReplyFooter,
    currentInjectSender,
    currentManagedSources,
    currentDisabledCommands,
    currentPlatformAllowFrom,
    currentProviderRefs,
  ]);

  const clearError = (): void => setError(null);

  const handleSave = (): void => {
    if (!name.trim()) {
      setError('团队名称不能为空');
      return;
    }
    if (isTeamProvisioning) {
      setError('团队仍在启动准备中，暂时不能编辑设置。请等待启动完成后再试。');
      return;
    }

    const disabledCommands = disabledCommandsInput
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    const feishu = feishuAllowFrom.trim();

    setSaving(true);
    setError(null);
    void (async () => {
      try {
        await api.teams.updateConfig(teamName, {
          name: name.trim(),
          description: description.trim(),
          color: currentColor,
          agentType: agentType.trim() || undefined,
          workDir: teamWorkDir.trim() || undefined,
          permissionMode: permissionMode.trim() || undefined,
          showContextIndicator,
          replyFooter,
          injectSender,
          language: language.trim() || undefined,
          managedSources: managedSources.trim() || undefined,
          disabledCommands,
          platformAllowFrom: feishu ? { feishu } : {},
          providerRefs: providerRefs ? [providerRefs] : [],
        });
        await Promise.resolve(onSaved());
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : '保存失败');
      } finally {
        setSaving(false);
      }
    })();
  };

  const compatibleProviders = globalProviders.filter(
    (provider) =>
      !provider.agent_types ||
      provider.agent_types.length === 0 ||
      (provider.agent_types as string[]).includes(agentType)
  );

  const toggleProviderRef = (providerName: string): void => {
    clearError();
    setProviderRefs((prev) => (prev === providerName ? '' : providerName));
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>编辑团队</DialogTitle>
          <DialogDescription>修改团队名称、描述和 cc-connect 项目参数</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label
              htmlFor="edit-team-name"
              className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]"
            >
              名称
            </label>
            <input
              id="edit-team-name"
              type="text"
              value={name}
              onChange={(event) => {
                clearError();
                setName(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !saving && name.trim()) handleSave();
              }}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-border-emphasis)]"
              placeholder="团队名称"
            />
          </div>

          <div>
            <label
              htmlFor="edit-team-description"
              className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]"
            >
              描述
            </label>
            <textarea
              id="edit-team-description"
              value={description}
              onChange={(event) => {
                clearError();
                setDescription(event.target.value);
              }}
              rows={3}
              className="w-full resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-border-emphasis)]"
              placeholder="团队描述（可选）"
            />
          </div>

          <div className="space-y-3 rounded-md border border-[var(--color-border)] p-3">
            <div>
              <h3 className="text-sm font-medium text-[var(--color-text)]">Agent 配置</h3>
              <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                这里直接维护 cc-connect 项目的基础运行参数。运行时模型和 Provider 请到 Harness
                配置中管理。
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">
                  Agent 类型
                </label>
                <select
                  value={agentType}
                  onChange={(event) => {
                    clearError();
                    setAgentType(event.target.value);
                  }}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-border-emphasis)]"
                >
                  {ALL_AGENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {AGENT_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">
                  权限模式
                </label>
                <select
                  value={permissionMode}
                  onChange={(event) => {
                    clearError();
                    setPermissionMode(event.target.value);
                  }}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-border-emphasis)]"
                >
                  {PERMISSION_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">
                工作目录
              </label>
              <input
                type="text"
                value={teamWorkDir}
                onChange={(event) => {
                  clearError();
                  setTeamWorkDir(event.target.value);
                }}
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 font-mono text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-border-emphasis)]"
                placeholder="/Users/you/code/project"
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">
                  语言
                </label>
                <input
                  type="text"
                  value={language}
                  onChange={(event) => {
                    clearError();
                    setLanguage(event.target.value);
                  }}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-border-emphasis)]"
                  placeholder="zh"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">
                  管理来源
                </label>
                <input
                  type="text"
                  value={managedSources}
                  onChange={(event) => {
                    clearError();
                    setManagedSources(event.target.value);
                  }}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-border-emphasis)]"
                  placeholder="user1,user2 或 *"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">
                已禁用命令
              </label>
              <input
                type="text"
                value={disabledCommandsInput}
                onChange={(event) => {
                  clearError();
                  setDisabledCommandsInput(event.target.value);
                }}
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-border-emphasis)]"
                placeholder="restart, upgrade, cron"
              />
            </div>

            <div className="rounded-lg border border-[var(--color-border-subtle)] bg-white/[0.02] p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-[var(--color-text)]">Provider（可选）</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                    留空时使用本机 {AGENT_TYPE_LABELS[agentType as CcAgentType] ?? agentType}{' '}
                    默认配置和登录状态。 只有需要给该团队指定模型供应商时，才绑定下面的全局
                    Provider。
                  </p>
                </div>
                {providerRefs ? (
                  <button
                    type="button"
                    className="shrink-0 rounded-md border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text-muted)] hover:bg-white/5"
                    onClick={() => setProviderRefs('')}
                  >
                    使用本机默认
                  </button>
                ) : null}
              </div>

              <div className="mt-3 space-y-2">
                {compatibleProviders.length > 0 ? (
                  compatibleProviders.map((provider) => {
                    const checked = providerRefs === provider.name;
                    const at = agentType as CcAgentType;
                    const endpoint = provider.endpoints?.[at] ?? provider.base_url ?? '默认端点';
                    const model =
                      provider.agent_models?.[at] ??
                      provider.model ??
                      provider.models?.[0]?.model ??
                      '未指定模型';
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
                            <p className="truncate text-xs font-medium text-[var(--color-text)]">
                              {provider.name}
                            </p>
                            <p className="mt-0.5 truncate text-[11px] text-[var(--color-text-muted)]">
                              {model} · {endpoint}
                            </p>
                          </div>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${
                              checked
                                ? 'bg-indigo-400/20 text-indigo-200'
                                : 'bg-white/5 text-[var(--color-text-muted)]'
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
                    暂无适用于 {AGENT_TYPE_LABELS[agentType as CcAgentType] ?? agentType} 的全局
                    Provider。 可先在「设置 → Harness 配置」中添加；不添加也会使用本机默认登录态。
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">
                平台访问控制（Feishu 允许的用户）
              </label>
              <input
                type="text"
                value={feishuAllowFrom}
                onChange={(event) => {
                  clearError();
                  setFeishuAllowFrom(event.target.value);
                }}
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-border-emphasis)]"
                placeholder="*"
              />
            </div>

            <div className="grid gap-2 md:grid-cols-3">
              <label
                htmlFor="edit-team-show-context-indicator"
                className="flex cursor-pointer items-center gap-2 rounded-md border border-[var(--color-border)] px-2 py-1.5 text-xs text-[var(--color-text-secondary)]"
              >
                <Checkbox
                  id="edit-team-show-context-indicator"
                  checked={showContextIndicator}
                  onCheckedChange={(checked) => {
                    clearError();
                    setShowContextIndicator(checked === true);
                  }}
                />
                上下文指示
              </label>
              <label
                htmlFor="edit-team-reply-footer"
                className="flex cursor-pointer items-center gap-2 rounded-md border border-[var(--color-border)] px-2 py-1.5 text-xs text-[var(--color-text-secondary)]"
              >
                <Checkbox
                  id="edit-team-reply-footer"
                  checked={replyFooter}
                  onCheckedChange={(checked) => {
                    clearError();
                    setReplyFooter(checked === true);
                  }}
                />
                回复尾部信息
              </label>
              <label
                htmlFor="edit-team-inject-sender"
                className="flex cursor-pointer items-center gap-2 rounded-md border border-[var(--color-border)] px-2 py-1.5 text-xs text-[var(--color-text-secondary)]"
              >
                <Checkbox
                  id="edit-team-inject-sender"
                  checked={injectSender}
                  onCheckedChange={(checked) => {
                    clearError();
                    setInjectSender(checked === true);
                  }}
                />
                注入发送者
              </label>
            </div>

            {onDeleteTeam && (
              <div className="rounded-md border border-red-500/40 bg-red-500/5 p-3">
                <p className="text-xs font-medium text-red-300">危险操作</p>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  删除项目会将团队从当前控制面板移除。
                </p>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="mt-2"
                  onClick={() => {
                    onClose();
                    window.setTimeout(onDeleteTeam, 0);
                  }}
                >
                  <Trash2 size={14} className="mr-1.5" />
                  删除项目
                </Button>
              </div>
            )}
          </div>

          {isTeamProvisioning ? (
            <p className="text-xs text-amber-300">团队仍在启动准备中，启动完成前暂时锁定编辑。</p>
          ) : null}
          {error ? <p className="text-xs text-red-400">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || isTeamProvisioning || !name.trim()}
          >
            {saving && <Loader2 size={14} className="mr-1.5 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
