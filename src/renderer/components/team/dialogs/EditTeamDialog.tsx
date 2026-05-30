import { useEffect } from 'react';

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
import { AGENT_TYPE_LABELS } from '@renderer/components/team/HarnessCards';
import { HarnessSelect } from '@renderer/components/team/HarnessSelect';
import { Loader2, Trash2 } from 'lucide-react';

import type { CcAgentType } from '@shared/types/ccConnect';

import { PERMISSION_MODE_OPTIONS, useTeamEditForm } from './useTeamEditForm';

interface EditTeamDialogProps {
  open: boolean;
  teamName: string;
  onClose: () => void;
  onDeleteTeam?: () => void;
}

// ── Section wrapper ──────────────────────────────────────────
function FormSection({
  title,
  description,
  variant = 'default',
  children,
}: {
  title: string;
  description?: string;
  variant?: 'default' | 'danger';
  children: React.ReactNode;
}): React.JSX.Element {
  const border = variant === 'danger' ? 'border-red-500/40' : 'border-[var(--color-border)]';
  const bg = variant === 'danger' ? 'bg-red-500/5' : '';
  const titleColor = variant === 'danger' ? 'text-red-300' : 'text-[var(--color-text)]';

  return (
    <div className={`rounded-md border ${border} ${bg} p-3`}>
      <h3 className={`text-sm font-medium ${titleColor}`}>{title}</h3>
      {description && (
        <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{description}</p>
      )}
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  );
}

// ── Shared input class ───────────────────────────────────────
const inputCls =
  'w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-border-emphasis)]';

const labelCls = 'mb-1 block text-xs font-medium text-[var(--color-text-secondary)]';

// ── Main component ───────────────────────────────────────────
export const EditTeamDialog = ({
  open,
  teamName,
  onClose,
  onDeleteTeam,
}: EditTeamDialogProps): React.JSX.Element => {
  const form = useTeamEditForm(teamName, open);

  // No auto-close — user closes manually after seeing "保存成功"

  const toggleProviderRef = (providerName: string): void => {
    form.clearError();
    const next = form.providerRef === providerName ? '' : providerName;
    form.setProviderRef(next);
  };

  const saveLabel =
    form.savePhase === 'done'
      ? '保存成功'
      : form.savePhase === 'restarting'
        ? '重启服务中...'
        : form.savePhase === 'saving'
          ? '保存中...'
          : '保存并重启';

  return (
    <Dialog
      open={form.saving ? true : open}
      onOpenChange={(nextOpen) => {
        if (form.saving) return;
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>编辑团队</DialogTitle>
          <DialogDescription>修改团队名称、描述和运行参数</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* ── Section 1: 基本信息 ─────────────────────────── */}
          <FormSection title="基本信息">
            <div>
              <label htmlFor="edit-team-name" className={labelCls}>
                名称
              </label>
              <input
                id="edit-team-name"
                type="text"
                value={form.name}
                onChange={(e) => {
                  form.clearError();
                  form.setName(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !form.saving && form.name.trim()) form.handleSave();
                }}
                className={inputCls}
                placeholder="团队名称"
              />
            </div>
            <div>
              <label htmlFor="edit-team-description" className={labelCls}>
                描述
              </label>
              <textarea
                id="edit-team-description"
                value={form.description}
                onChange={(e) => {
                  form.clearError();
                  form.setDescription(e.target.value);
                }}
                rows={2}
                className={`${inputCls} resize-none`}
                placeholder="团队描述（可选）"
              />
            </div>
          </FormSection>

          {/* ── Section 2: Agent 配置 ───────────────────────── */}
          <FormSection
            title="Agent 配置"
            description="运行参数配置。运行时模型和 Provider 请到 Harness 配置中管理。"
          >
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className={labelCls}>Agent 类型</label>
                <HarnessSelect
                  value={form.agentType as CcAgentType}
                  onChange={(v) => {
                    form.clearError();
                    form.setAgentType(v);
                  }}
                  className="w-full"
                />
              </div>
              <div>
                <label className={labelCls}>权限模式</label>
                <select
                  value={form.permissionMode}
                  onChange={(e) => {
                    form.clearError();
                    form.setPermissionMode(e.target.value);
                  }}
                  className={inputCls}
                >
                  {PERMISSION_MODE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls}>工作目录</label>
              <input
                type="text"
                value={form.workDir}
                onChange={(e) => {
                  form.clearError();
                  form.setWorkDir(e.target.value);
                }}
                className={`${inputCls} font-mono`}
                placeholder="/Users/you/code/project"
              />
            </div>
          </FormSection>

          {/* ── Section 3: 通信与平台 ───────────────────────── */}
          <FormSection title="通信与平台">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className={labelCls}>语言</label>
                <input
                  type="text"
                  value={form.language}
                  onChange={(e) => {
                    form.clearError();
                    form.setLanguage(e.target.value);
                  }}
                  className={inputCls}
                  placeholder="zh"
                />
              </div>
              <div>
                <label className={labelCls}>管理来源</label>
                <input
                  type="text"
                  value={form.managedSources}
                  onChange={(e) => {
                    form.clearError();
                    form.setManagedSources(e.target.value);
                  }}
                  className={inputCls}
                  placeholder="user1,user2 或 *"
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>平台访问控制（Feishu 允许的用户）</label>
              <input
                type="text"
                value={form.feishuAllowFrom}
                onChange={(e) => {
                  form.clearError();
                  form.setFeishuAllowFrom(e.target.value);
                }}
                className={inputCls}
                placeholder="*"
              />
            </div>
          </FormSection>

          {/* ── Section 4: 高级开关 ─────────────────────────── */}
          <div className="grid gap-2 md:grid-cols-3">
            <label
              htmlFor="edit-team-show-context-indicator"
              className="flex cursor-pointer items-center gap-2 rounded-md border border-[var(--color-border)] px-2 py-1.5 text-xs text-[var(--color-text-secondary)]"
            >
              <Checkbox
                id="edit-team-show-context-indicator"
                checked={form.showContextIndicator}
                onCheckedChange={(checked) => {
                  form.clearError();
                  form.setShowContextIndicator(checked === true);
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
                checked={form.replyFooter}
                onCheckedChange={(checked) => {
                  form.clearError();
                  form.setReplyFooter(checked === true);
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
                checked={form.injectSender}
                onCheckedChange={(checked) => {
                  form.clearError();
                  form.setInjectSender(checked === true);
                }}
              />
              注入发送者
            </label>
          </div>

          {/* ── Section 5: Provider 绑定 ────────────────────── */}
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-white/[0.02] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-[var(--color-text)]">Provider（可选）</p>
                <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                  留空时使用本机{' '}
                  {AGENT_TYPE_LABELS[form.agentType as CcAgentType] ?? form.agentType}{' '}
                  默认配置和登录状态。只有需要给该团队指定模型供应商时，才绑定下面的全局 Provider。
                </p>
              </div>
              {form.providerRef ? (
                <button
                  type="button"
                  className="shrink-0 rounded-md border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text-muted)] hover:bg-white/5"
                  onClick={() => form.setProviderRef('')}
                >
                  使用本机默认
                </button>
              ) : null}
            </div>

            <div className="mt-3 space-y-2">
              {form.compatibleProviders.length > 0 ? (
                form.compatibleProviders.map((provider) => {
                  const checked = form.providerRef === provider.name;
                  const at = form.agentType as CcAgentType;
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
                  暂无适用于 {AGENT_TYPE_LABELS[form.agentType as CcAgentType] ?? form.agentType}{' '}
                  的全局 Provider。可先在「设置 → Harness
                  配置」中添加；不添加也会使用本机默认登录态。
                </div>
              )}
            </div>
          </div>

          {/* ── Section 6: 危险操作 ─────────────────────────── */}
          <FormSection title="危险操作" variant="danger">
            <div>
              <label className={labelCls}>已禁用命令</label>
              <input
                type="text"
                value={form.disabledCommandsInput}
                onChange={(e) => {
                  form.clearError();
                  form.setDisabledCommandsInput(e.target.value);
                }}
                className={inputCls}
                placeholder="restart, upgrade, cron"
              />
            </div>
            {onDeleteTeam && form.canDelete && (
              <>
                <p className="text-xs text-[var(--color-text-muted)]">
                  删除项目会将团队从当前控制面板移除。
                </p>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    onClose();
                    window.setTimeout(onDeleteTeam, 0);
                  }}
                >
                  <Trash2 size={14} className="mr-1.5" />
                  删除项目
                </Button>
              </>
            )}
          </FormSection>

          {/* ── Status messages ──────────────────────────────── */}
          {form.error && <p className="text-xs text-red-400">{form.error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={form.saving}>
            {form.savePhase === 'done' ? '关闭' : '取消'}
          </Button>
          <Button
            size="sm"
            onClick={form.handleSave}
            disabled={form.saving || form.savePhase === 'done' || !form.name.trim()}
          >
            {form.saving && <Loader2 size={14} className="mr-1.5 animate-spin" />}
            {saveLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
