/**
 * CreateTeamDialog — simplified to match cc-connect project creation flow.
 *
 * Wizard steps:
 *   1. Name + Agent type + Work directory
 *   2. Platform selection grid
 *   3a. QR code setup (feishu/weixin)
 *   3b. Manual credential form (telegram/slack/etc.)
 *   3c. Bridge (no setup needed)
 *
 * Uses Hermit's existing UI components (Dialog, Button, Input, etc.)
 * but with cc-connect's parameters and flow.
 */

import React, { useEffect, useMemo, useState } from 'react';

import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { getTeamColorSet, getThemedBadge } from '@renderer/constants/teamColors';
import { useCreateTeamDraft } from '@renderer/hooks/useCreateTeamDraft';
import { useTheme } from '@renderer/hooks/useTheme';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { isEphemeralProjectPath } from '@shared/utils/ephemeralProjectPath';
import { normalizePath } from '@renderer/utils/pathNormalize';
import {
  AlertTriangle,
  CheckCircle2,
  FolderKanban,
  Info,
  Loader2,
  Settings2,
  Smartphone,
  X,
} from 'lucide-react';

import { ALL_AGENT_TYPES, AGENT_TYPE_LABELS } from '../HarnessCards';
import { ProjectPathSelector } from './ProjectPathSelector';
import { OptionalSettingsSection } from './OptionalSettingsSection';
import { AutoResizeTextarea } from '@renderer/components/ui/auto-resize-textarea';
import { platformMeta, isQRPlatform } from './platformMeta';
import PlatformSetupQR from './PlatformSetupQR';
import PlatformManualForm from './PlatformManualForm';

import type { Project, TeamCreateRequest } from '@shared/types';
import type { CcAgentType } from '@shared/types/ccConnect';

export interface ActiveTeamRef {
  teamName: string;
  displayName: string;
  projectPath: string;
}

/** Legacy type — preserved for backward compatibility with LaunchTeamDialog. */
export interface TeamCopyData {
  teamName: string;
  description?: string;
  color?: string;
}

// ---------------------------------------------------------------------------
// Platform selection grid data
// ---------------------------------------------------------------------------

interface PlatformOption {
  key: string;
  label: string;
  color: string;
  icon: 'qr' | 'settings';
}

const PLATFORM_OPTIONS: PlatformOption[] = [
  {
    key: 'feishu',
    label: '飞书 / Lark',
    color: 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
    icon: 'qr',
  },
  {
    key: 'weixin',
    label: '微信',
    color: 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400',
    icon: 'qr',
  },
  {
    key: 'telegram',
    label: 'Telegram',
    color: 'bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400',
    icon: 'settings',
  },
  {
    key: 'discord',
    label: 'Discord',
    color: 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400',
    icon: 'settings',
  },
  {
    key: 'slack',
    label: 'Slack',
    color: 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
    icon: 'settings',
  },
  {
    key: 'dingtalk',
    label: '钉钉',
    color: 'bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400',
    icon: 'settings',
  },
  {
    key: 'wecom',
    label: '企业微信',
    color: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
    icon: 'settings',
  },
  {
    key: 'qq',
    label: 'QQ (OneBot)',
    color: 'bg-cyan-50 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400',
    icon: 'settings',
  },
  {
    key: 'qqbot',
    label: 'QQ Bot (官方)',
    color: 'bg-cyan-50 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400',
    icon: 'settings',
  },
  {
    key: 'line',
    label: 'LINE',
    color: 'bg-lime-50 dark:bg-lime-900/30 text-lime-600 dark:text-lime-400',
    icon: 'settings',
  },
  {
    key: 'weibo',
    label: '微博',
    color: 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400',
    icon: 'settings',
  },
  {
    key: 'bridge',
    label: 'Bridge (默认)',
    color: 'bg-gray-50 dark:bg-gray-800/30 text-gray-600 dark:text-gray-400',
    icon: 'settings',
  },
];

const TEAM_COLOR_NAMES = [
  'blue',
  'green',
  'red',
  'yellow',
  'purple',
  'cyan',
  'orange',
  'pink',
] as const;

// ---------------------------------------------------------------------------
// Wizard step types
// ---------------------------------------------------------------------------

type WizardStep = 'name' | 'platform' | 'qr' | 'form' | 'done';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface CreateTeamDialogProps {
  open: boolean;
  canCreate: boolean;
  provisioningErrorsByTeam: Record<string, string | null>;
  clearProvisioningError?: (teamName?: string) => void;
  existingTeamNames: string[];
  provisioningTeamNames?: string[];
  activeTeams?: ActiveTeamRef[];
  initialData?: unknown;
  defaultProjectPath?: string | null;
  onClose: () => void;
  onCreate: (request: TeamCreateRequest) => Promise<void>;
  onOpenTeam: (teamName: string, projectPath?: string) => void;
}

/** Sanitize team name: non-alphanumeric → `-`, then lowercase. */
function sanitizeTeamName(name: string): string {
  const trimmed = name.trim();
  let result = name
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-{2,}/g, '-')
    .toLowerCase();
  while (result.startsWith('-')) result = result.slice(1);
  while (result.endsWith('-')) result = result.slice(0, -1);
  if (!result && trimmed) {
    let hash = 2166136261;
    for (const ch of name) {
      hash ^= ch.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 16777619);
    }
    result = `team-${(hash >>> 0).toString(36)}`;
  }
  return result;
}

export const CreateTeamDialog = ({
  open,
  canCreate,
  provisioningErrorsByTeam,
  clearProvisioningError,
  existingTeamNames,
  provisioningTeamNames = [],
  activeTeams,
  defaultProjectPath,
  onClose,
  onCreate,
  onOpenTeam,
}: CreateTeamDialogProps): React.JSX.Element => {
  const { isLight } = useTheme();

  // ── Draft state (persisted) ──────────────────────────────────────────
  const {
    teamName,
    setTeamName,
    cwdMode,
    setCwdMode,
    selectedProjectPath,
    setSelectedProjectPath,
    customCwd,
    setCustomCwd,
    teamColor,
    setTeamColor,
    isLoaded: draftLoaded,
    clearDraft,
  } = useCreateTeamDraft();

  // ── Wizard state ─────────────────────────────────────────────────────
  const [step, setStep] = useState<WizardStep>('name');
  const [selectedHarness, setSelectedHarness] = useState<CcAgentType>('claudecode');
  const [selectedPlatform, setSelectedPlatform] = useState('');
  const [description, setDescription] = useState('');

  // ── Projects (for path selector) ─────────────────────────────────────
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  // ── Errors / submission ──────────────────────────────────────────────
  const [localError, setLocalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ teamName?: string; cwd?: string }>({});

  // ── Conflict detection ───────────────────────────────────────────────
  const allTakenTeamNames = useMemo(
    () => [...new Set([...existingTeamNames, ...provisioningTeamNames])],
    [existingTeamNames, provisioningTeamNames]
  );
  const sanitizedTeamName = sanitizeTeamName(teamName.trim());
  const isNameTaken = existingTeamNames.includes(sanitizedTeamName);
  const isNameProvisioning = provisioningTeamNames.includes(sanitizedTeamName) && !isNameTaken;

  const effectiveCwd =
    cwdMode === 'project'
      ? isEphemeralProjectPath(selectedProjectPath)
        ? ''
        : selectedProjectPath.trim()
      : customCwd.trim();

  const conflictingTeam = useMemo(() => {
    if (!activeTeams?.length || !effectiveCwd) return null;
    const norm = normalizePath(effectiveCwd);
    return activeTeams.find((t) => normalizePath(t.projectPath) === norm) ?? null;
  }, [activeTeams, effectiveCwd]);
  const [conflictDismissed, setConflictDismissed] = useState(false);
  useEffect(() => {
    setConflictDismissed(false);
  }, [conflictingTeam?.teamName, effectiveCwd]);

  // ── Load projects on open ────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setProjectsLoading(true);
    setProjectsError(null);
    let cancelled = false;
    void (async () => {
      try {
        const next = (await api.getProjects()).filter((p) => !isEphemeralProjectPath(p.path));
        if (!cancelled) {
          setProjects(next);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setProjectsError(e instanceof Error ? e.message : '加载项目列表失败');
          setProjects([]);
        }
      } finally {
        if (!cancelled) setProjectsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // ── Auto-select default project path ─────────────────────────────────
  useEffect(() => {
    if (!open || cwdMode !== 'project' || selectedProjectPath) return;
    const selectable = projects.filter((p) => !isEphemeralProjectPath(p.path));
    if (selectable.length === 0) return;
    if (defaultProjectPath && !isEphemeralProjectPath(defaultProjectPath)) {
      const match = selectable.find(
        (p) => normalizePath(p.path) === normalizePath(defaultProjectPath)
      );
      if (match) {
        setSelectedProjectPath(match.path);
        return;
      }
    }
    setSelectedProjectPath(selectable[0].path);
  }, [open, cwdMode, projects, selectedProjectPath, defaultProjectPath]);

  // ── Clear provisioning error on open ─────────────────────────────────
  useEffect(() => {
    if (open && sanitizedTeamName) clearProvisioningError?.(sanitizedTeamName);
  }, [open, clearProvisioningError, sanitizedTeamName]);

  // ── Reset state on close ─────────────────────────────────────────────
  const resetState = () => {
    setLocalError(null);
    setFieldErrors({});
    setIsSubmitting(false);
    setConflictDismissed(false);
  };

  // ── Platform selection ───────────────────────────────────────────────
  const handlePlatformSelect = (key: string) => {
    setSelectedPlatform(key);
    if (isQRPlatform(key)) {
      setStep('qr');
    } else if (platformMeta[key]) {
      setStep('form');
    } else {
      // bridge or unknown — skip to done
      setStep('done');
    }
  };

  // ── Completion handlers ──────────────────────────────────────────────
  const handleQRComplete = () => {
    // QR setup already created the project via cc-connect
    clearDraft();
    resetState();
    setStep('done');
  };

  const handleManualComplete = () => {
    // Manual form already created the project via cc-connect
    clearDraft();
    resetState();
    setStep('done');
  };

  const handleBridgeDone = () => {
    setStep('done');
  };

  // ── Final submission (for bridge or non-QR platforms that need server call) ──
  const handleCreate = async () => {
    if (allTakenTeamNames.includes(sanitizedTeamName)) {
      setLocalError(isNameProvisioning ? '团队正在启动中' : '团队名称已存在');
      return;
    }
    if (!sanitizedTeamName) {
      setLocalError('请输入团队名称');
      return;
    }
    if (!effectiveCwd) {
      setLocalError('请选择工作目录');
      return;
    }

    setFieldErrors({});
    setLocalError(null);
    setIsSubmitting(true);

    try {
      const request: TeamCreateRequest = {
        teamName: sanitizedTeamName,
        displayName: teamName.trim() || undefined,
        description: description.trim() || undefined,
        color: teamColor || undefined,
        members: [],
        cwd: effectiveCwd,
        executionTarget: { type: 'local', cwd: effectiveCwd || undefined },
        harness: selectedHarness,
        platform: selectedPlatform || 'bridge',
        platformOptions: {},
      };
      await onCreate(request);
      onOpenTeam(request.teamName, effectiveCwd || undefined);
      clearDraft();
      resetState();
      onClose();
    } catch {
      // error shown via provisioningErrorsByTeam
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => {
        if (!next) {
          resetState();
          onClose();
        }
      }}
    >
      <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl sm:w-[40rem]">
        <DialogHeader>
          <DialogTitle className="text-sm">创建团队</DialogTitle>
          <DialogDescription className="text-xs">
            {step === 'name' && '设置团队名称、Agent 类型和工作目录'}
            {step === 'platform' && '选择要绑定的平台渠道'}
            {step === 'qr' && '扫描二维码绑定平台'}
            {step === 'form' && '填写平台凭证信息'}
            {step === 'done' && '团队创建完成'}
          </DialogDescription>
        </DialogHeader>

        {conflictingTeam && !conflictDismissed ? (
          <div
            className="rounded-md border p-3 text-xs"
            style={{
              backgroundColor: 'var(--warning-bg)',
              borderColor: 'var(--warning-border)',
              color: 'var(--warning-text)',
            }}
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-medium">
                  该工作目录下已有团队"{conflictingTeam.displayName}"正在运行
                </p>
                <p className="opacity-80">在同一目录同时运行两个团队存在风险。</p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100"
                onClick={() => setConflictDismissed(true)}
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        ) : null}

        {/* ── Step 1: Name + Harness + Work Dir ── */}
        {step === 'name' && (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="team-name">团队名称</Label>
              <Input
                id="team-name"
                className={cn(
                  'h-8 text-xs',
                  fieldErrors.teamName && 'border-[var(--field-error-border)]'
                )}
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="my-team"
                autoFocus
              />
              {isNameTaken && (
                <p className="text-[11px]" style={{ color: 'var(--field-error-text)' }}>
                  团队名称已存在
                </p>
              )}
              {isNameProvisioning && (
                <p className="text-[11px]" style={{ color: 'var(--warning-text)' }}>
                  同名团队正在启动中
                </p>
              )}
              {sanitizedTeamName && sanitizedTeamName !== teamName.trim() && (
                <p className="text-[11px] text-[var(--color-text-muted)]">
                  内部标识：<span className="font-mono">{sanitizedTeamName}</span>
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="team-harness">Agent 类型</Label>
              <select
                id="team-harness"
                className="flex w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm"
                value={selectedHarness}
                onChange={(e) => setSelectedHarness(e.target.value as CcAgentType)}
              >
                {ALL_AGENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {AGENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>

            <ProjectPathSelector
              cwdMode={cwdMode}
              onCwdModeChange={setCwdMode}
              selectedProjectPath={selectedProjectPath}
              onSelectedProjectPathChange={setSelectedProjectPath}
              customCwd={customCwd}
              onCustomCwdChange={setCustomCwd}
              projects={projects}
              projectsLoading={projectsLoading}
              projectsError={projectsError}
              fieldError={fieldErrors.cwd}
            />
          </div>
        )}

        {/* ── Step 2: Platform selection ── */}
        {step === 'platform' && (
          <div className="space-y-3 py-2">
            <p className="mb-2 text-sm text-gray-500 dark:text-gray-400">选择要绑定的平台渠道：</p>
            <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto">
              {PLATFORM_OPTIONS.map(({ key, label, color, icon }) => (
                <button
                  key={key}
                  onClick={() => handlePlatformSelect(key)}
                  className="flex items-center gap-2.5 rounded-xl border border-gray-200 p-3 text-left transition-all hover:border-blue-500/50 hover:bg-blue-500/5 dark:border-gray-700"
                >
                  <div
                    className={`h-9 w-9 rounded-lg ${color} flex shrink-0 items-center justify-center`}
                  >
                    {icon === 'qr' ? <Smartphone size={16} /> : <Settings2 size={16} />}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-gray-900 dark:text-white">
                      {label}
                    </div>
                    <div className="text-[11px] text-gray-400">
                      {icon === 'qr' ? '扫码绑定' : '手动配置'}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <div className="flex justify-start pt-2">
              <Button variant="outline" size="sm" onClick={() => setStep('name')}>
                返回
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 3a: QR setup (feishu/weixin) ── */}
        {step === 'qr' &&
          (selectedPlatform === 'feishu' ||
            selectedPlatform === 'lark' ||
            selectedPlatform === 'weixin') && (
            <PlatformSetupQR
              platformType={selectedPlatform as 'feishu' | 'lark' | 'weixin'}
              projectName={sanitizedTeamName}
              workDir={effectiveCwd}
              agentType={selectedHarness}
              onComplete={handleQRComplete}
              onCancel={() => setStep('platform')}
            />
          )}

        {/* ── Step 3b: Manual form (telegram/slack/etc.) ── */}
        {step === 'form' && platformMeta[selectedPlatform] && (
          <PlatformManualForm
            platformType={selectedPlatform}
            platformMeta={platformMeta[selectedPlatform]}
            projectName={sanitizedTeamName}
            workDir={effectiveCwd}
            agentType={selectedHarness}
            onComplete={handleManualComplete}
            onCancel={() => setStep('platform')}
          />
        )}

        {/* ── Step 3c: Bridge (no setup) ── */}
        {step === 'done' && (
          <div className="space-y-4 py-4">
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle2 size={48} className="text-green-500" />
              <p className="text-sm font-medium text-green-700 dark:text-green-400">
                团队已创建成功！
              </p>
              <p className="text-center text-xs text-gray-500">
                {selectedPlatform && selectedPlatform !== 'bridge'
                  ? '平台绑定完成，重启服务使配置生效'
                  : 'Bridge 模式已启用，无需额外配置'}
              </p>
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <DialogFooter className="pt-4 sm:justify-between">
          <div className="min-w-0">
            {localError && (
              <p
                className="rounded border p-2 text-xs"
                style={{
                  color: 'var(--field-error-text)',
                  borderColor: 'var(--field-error-border)',
                  backgroundColor: 'var(--field-error-bg)',
                }}
              >
                {localError}
              </p>
            )}
            {provisioningErrorsByTeam[sanitizedTeamName] && (
              <p
                className="mt-1 rounded border p-2 text-xs"
                style={{
                  color: 'var(--field-error-text)',
                  borderColor: 'var(--field-error-border)',
                  backgroundColor: 'var(--field-error-bg)',
                }}
              >
                {provisioningErrorsByTeam[sanitizedTeamName]}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {step === 'done' ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    clearDraft();
                    resetState();
                    onClose();
                  }}
                >
                  关闭
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    onOpenTeam(sanitizedTeamName, effectiveCwd);
                    clearDraft();
                    resetState();
                    onClose();
                  }}
                >
                  打开团队
                </Button>
              </>
            ) : step === 'name' ? (
              <>
                <Button variant="outline" size="sm" onClick={onClose}>
                  取消
                </Button>
                <Button
                  size="sm"
                  disabled={!sanitizedTeamName || !effectiveCwd}
                  onClick={() => setStep('platform')}
                >
                  下一步
                </Button>
              </>
            ) : step === 'platform' ? (
              <Button variant="outline" size="sm" onClick={() => setStep('name')}>
                返回
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
