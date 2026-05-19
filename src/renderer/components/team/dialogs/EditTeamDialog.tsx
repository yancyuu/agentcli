import { useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@renderer/api';
import { MemberDraftRow } from '@renderer/components/team/members/MemberDraftRow';
import {
  buildMembersFromDrafts,
  createMemberDraft,
  createMemberDraftsFromInputs,
  filterEditableMemberInputs,
  MembersEditorSection,
  validateMemberNameInline,
} from '@renderer/components/team/members/MembersEditorSection';
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
import { Label } from '@renderer/components/ui/label';
import { getTeamColorSet, getThemedBadge } from '@renderer/constants/teamColors';
import { useFileListCacheWarmer } from '@renderer/hooks/useFileListCacheWarmer';
import { useStore } from '@renderer/store';
import { useTheme } from '@renderer/hooks/useTheme';
import { cn } from '@renderer/lib/utils';
import {
  agentAvatarUrl,
  buildMemberColorMap,
  displayMemberName,
} from '@renderer/utils/memberHelpers';
import { isLeadMemberName } from '@shared/utils/leadDetection';
import { parseNumericSuffixName } from '@shared/utils/teamMemberName';
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, RotateCcw } from 'lucide-react';

import { AnthropicFastModeSelector } from './AnthropicFastModeSelector';
import { EffortLevelSelector } from './EffortLevelSelector';
import {
  buildEditTeamSourceSnapshot,
  getLiveRosterIdentityChanges,
  getMemberRuntimeContractKey,
  getMembersRequiringRuntimeRestart,
} from './editTeamRuntimeChanges';
import { TeamModelSelector } from './TeamModelSelector';

import type {
  EffortLevel,
  ResolvedTeamMember,
  TeamFastMode,
  TeamLaunchRequest,
  TeamProviderId,
} from '@shared/types';

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

interface EditTeamDialogProps {
  open: boolean;
  teamName: string;
  currentName: string;
  currentDescription: string;
  currentColor: string;
  currentMembers: ResolvedTeamMember[];
  leadMember?: ResolvedTeamMember | null;
  resolvedMemberColorMap?: ReadonlyMap<string, string>;
  isTeamAlive?: boolean;
  isTeamProvisioning?: boolean;
  projectPath?: string | null;
  savedLaunchRequest?: TeamLaunchRequest | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  onRestartTeam?: () => Promise<void> | void;
  onSaveAndRestart?: (runtimeConfig: {
    providerId: TeamProviderId;
    model: string | undefined;
    effort: EffortLevel | undefined;
    fastMode: TeamFastMode | undefined;
    clearContext: boolean;
  }) => Promise<void> | void;
}

function membersToDrafts(members: ResolvedTeamMember[]) {
  return createMemberDraftsFromInputs(filterEditableMemberInputs(members));
}

function deriveTeammateWorktreeDefault(members: readonly ResolvedTeamMember[]): boolean {
  const activeTeammates = filterEditableMemberInputs(members).filter((member) => !member.removedAt);
  return (
    activeTeammates.length > 0 && activeTeammates.every((member) => member.isolation === 'worktree')
  );
}

function useEditTeamErrorReset(
  setError: (value: string | null) => void,
  setSaveOutcomeError: (value: string | null) => void
): () => void {
  return () => {
    setError(null);
    setSaveOutcomeError(null);
  };
}

function getInvalidMemberNamesError(
  members: readonly {
    name: string;
    removedAt?: number | string | null;
  }[]
): string | null {
  for (const member of members) {
    if (member.removedAt) {
      continue;
    }
    const name = member.name.trim();
    if (!name) {
      return '成员名称不能为空';
    }
    if (validateMemberNameInline(name) !== null) {
      return '成员名称必须以字母、数字或中文开头，最多 128 个字符';
    }
    const lower = name.toLowerCase();
    if (lower === 'user' || isLeadMemberName(lower)) {
      return `成员名称"${name}"为保留名称`;
    }
    const suffixInfo = parseNumericSuffixName(name);
    if (suffixInfo && suffixInfo.suffix >= 2) {
      return `成员名称"${name}"不可用（保留给 Claude CLI 自动编号），请改用"${suffixInfo.base}"。`;
    }
  }
  return null;
}

function applyRemovedMembersToSnapshot(
  members: readonly ResolvedTeamMember[],
  removedMemberNames: readonly string[]
): ResolvedTeamMember[] {
  if (removedMemberNames.length === 0) {
    return [...members];
  }
  const removedKeys = new Set(removedMemberNames.map((name) => name.trim().toLowerCase()));
  const removedAt = Date.now();
  return members.map((member) =>
    removedKeys.has(member.name.trim().toLowerCase()) ? { ...member, removedAt } : member
  );
}

export const EditTeamDialog = ({
  open,
  teamName,
  currentName,
  currentDescription,
  currentColor,
  currentMembers,
  leadMember = null,
  resolvedMemberColorMap,
  isTeamAlive = false,
  isTeamProvisioning = false,
  projectPath,
  savedLaunchRequest = null,
  onClose,
  onSaved,
  onSaveAndRestart,
}: EditTeamDialogProps): React.JSX.Element => {
  const { isLight } = useTheme();
  const [name, setName] = useState(currentName);
  const [description, setDescription] = useState(currentDescription);
  const [color, setColor] = useState(currentColor);
  const [members, setMembers] = useState(() => membersToDrafts(currentMembers));
  const [teammateWorktreeDefault, setTeammateWorktreeDefault] = useState(() =>
    deriveTeammateWorktreeDefault(currentMembers)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveOutcomeError, setSaveOutcomeError] = useState<string | null>(null);
  const [leadProviderId, setLeadProviderId] = useState<TeamProviderId>(
    leadMember?.providerId ?? 'anthropic'
  );
  const [leadModel, setLeadModel] = useState(leadMember?.model ?? '');
  const [leadEffort, setLeadEffort] = useState<EffortLevel | undefined>(leadMember?.effort);
  const [leadWorkflow, setLeadWorkflow] = useState(leadMember?.workflow ?? '');
  const [membersPendingRestartRetry, setMembersPendingRestartRetry] = useState<
    Record<string, string>
  >({});
  // Team-level runtime settings (separate from lead member settings)
  const [teamProviderId, setTeamProviderId] = useState<TeamProviderId>(
    savedLaunchRequest?.providerId ?? 'anthropic'
  );
  const [teamModel, setTeamModel] = useState(savedLaunchRequest?.model ?? '');
  const [teamEffort, setTeamEffort] = useState<EffortLevel | undefined>(
    savedLaunchRequest?.effort as EffortLevel | undefined
  );
  const [teamFastMode, setTeamFastMode] = useState<TeamFastMode>(
    savedLaunchRequest?.fastMode ?? 'inherit'
  );
  const [clearContext, setClearContext] = useState(true);
  const [restarting, setRestarting] = useState(false);
  const [showRuntimeSettings, setShowRuntimeSettings] = useState(isTeamAlive);
  const anthropicProviderFastModeDefault = useStore(
    (s) => s.appConfig?.providerConnections?.anthropic.fastModeDefault ?? false
  );
  const wasOpenRef = useRef(false);
  const initializedTeamNameRef = useRef<string | null>(null);
  const baselineSourceSnapshotRef = useRef<string | null>(null);
  const pendingCommittedSourceSnapshotRef = useRef<string | null>(null);

  useFileListCacheWarmer(projectPath ?? null);
  const clearTransientErrors = useEditTeamErrorReset(setError, setSaveOutcomeError);
  const effectiveResolvedMemberColorMap = useMemo(
    () => resolvedMemberColorMap ?? buildMemberColorMap(currentMembers),
    [currentMembers, resolvedMemberColorMap]
  );
  const leadDraft = useMemo(() => {
    if (!leadMember) return null;
    return createMemberDraft({
      id: `lead:${leadMember.name}`,
      name: displayMemberName(leadMember.name),
      originalName: leadMember.name,
      roleSelection: '',
      customRole: '团队负责人',
      workflow: leadWorkflow,
      providerId: leadProviderId,
      model: leadModel,
      effort: leadEffort,
    });
  }, [leadMember, leadProviderId, leadModel, leadEffort, leadWorkflow]);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    if (open) {
      const shouldInitialize = !wasOpen || initializedTeamNameRef.current !== teamName;
      if (shouldInitialize) {
        setName(currentName);
        setDescription(currentDescription);
        setColor(currentColor);
        setMembers(membersToDrafts(currentMembers));
        setTeammateWorktreeDefault(deriveTeammateWorktreeDefault(currentMembers));
        setLeadProviderId(leadMember?.providerId ?? 'anthropic');
        setLeadModel(leadMember?.model ?? '');
        setLeadEffort(leadMember?.effort);
        setLeadWorkflow(leadMember?.workflow ?? '');
        setTeamProviderId(savedLaunchRequest?.providerId ?? 'anthropic');
        setTeamModel(savedLaunchRequest?.model ?? '');
        setTeamEffort(savedLaunchRequest?.effort as EffortLevel | undefined);
        setTeamFastMode(savedLaunchRequest?.fastMode ?? 'inherit');
        setClearContext(true);
        setRestarting(false);
        setShowRuntimeSettings(isTeamAlive);
        setError(null);
        setSaveOutcomeError(null);
        setMembersPendingRestartRetry({});
        initializedTeamNameRef.current = teamName;
        baselineSourceSnapshotRef.current = buildEditTeamSourceSnapshot({
          name: currentName,
          description: currentDescription,
          color: currentColor,
          members: currentMembers,
        });
        pendingCommittedSourceSnapshotRef.current = null;
      } else if (pendingCommittedSourceSnapshotRef.current !== null) {
        const latestSourceSnapshot = buildEditTeamSourceSnapshot({
          name: currentName,
          description: currentDescription,
          color: currentColor,
          members: currentMembers,
        });
        if (latestSourceSnapshot === pendingCommittedSourceSnapshotRef.current) {
          baselineSourceSnapshotRef.current = latestSourceSnapshot;
          pendingCommittedSourceSnapshotRef.current = null;
        }
      }
    } else if (wasOpen) {
      initializedTeamNameRef.current = null;
      baselineSourceSnapshotRef.current = null;
      pendingCommittedSourceSnapshotRef.current = null;
    }
    wasOpenRef.current = open;
  }, [
    open,
    teamName,
    currentName,
    currentDescription,
    currentColor,
    currentMembers,
    leadMember,
    savedLaunchRequest,
    isTeamAlive,
  ]);

  const builtMembers = useMemo(() => buildMembersFromDrafts(members), [members]);
  const invalidMemberNamesError = useMemo(() => getInvalidMemberNamesError(members), [members]);
  const hasDuplicateMembers = useMemo(() => {
    const names = members
      .filter((member) => !member.removedAt)
      .map((member) => member.name.trim().toLowerCase())
      .filter(Boolean);
    return new Set(names).size !== names.length;
  }, [members]);
  const membersToRestart = useMemo(
    () =>
      isTeamAlive
        ? getMembersRequiringRuntimeRestart({
            previousMembers: currentMembers,
            nextMembers: builtMembers,
          })
        : [],
    [builtMembers, currentMembers, isTeamAlive]
  );
  const builtMembersByName = useMemo(
    () =>
      new Map(builtMembers.map((member) => [member.name.trim().toLowerCase(), member] as const)),
    [builtMembers]
  );
  const effectiveMembersToRestart = useMemo(() => {
    const retryMembers = Object.entries(membersPendingRestartRetry).flatMap(
      ([normalizedName, expectedRuntimeContractKey]) => {
        const nextMember = builtMembersByName.get(normalizedName);
        if (!nextMember) {
          return [];
        }
        return getMemberRuntimeContractKey(nextMember) === expectedRuntimeContractKey
          ? [nextMember.name.trim()]
          : [];
      }
    );
    return Array.from(
      new Set(
        [...membersToRestart, ...retryMembers]
          .map((memberName) => memberName.trim())
          .filter(Boolean)
      )
    );
  }, [builtMembersByName, membersPendingRestartRetry, membersToRestart]);
  const liveIdentityChanges = useMemo(
    () =>
      isTeamAlive
        ? getLiveRosterIdentityChanges({
            previousMembers: currentMembers,
            nextDrafts: members,
          })
        : { renamed: [], removed: [] },
    [currentMembers, isTeamAlive, members]
  );
  const hasBlockedLiveIdentityChanges = liveIdentityChanges.renamed.length > 0;
  const liveRemovedExistingMembers = useMemo(
    () => (isTeamAlive ? liveIdentityChanges.removed : []),
    [isTeamAlive, liveIdentityChanges.removed]
  );
  const hasNewLiveTeammates = useMemo(
    () =>
      isTeamAlive && members.some((member) => !member.removedAt && !member.originalName?.trim()),
    [isTeamAlive, members]
  );
  const memberWarningById = useMemo(() => {
    const restartNames = new Set(
      effectiveMembersToRestart.map((memberName) => memberName.trim().toLowerCase())
    );
    if (restartNames.size === 0) {
      return undefined;
    }
    return Object.fromEntries(
      members.map((member) => [
        member.id,
        restartNames.has(member.name.trim().toLowerCase())
          ? '保存后需要重启该成员或团队，才能应用角色、工作流、worktree 隔离、提供商、模型或推理强度变更。'
          : null,
      ])
    );
  }, [effectiveMembersToRestart, members]);

  const handleSave = (): void => {
    if (!name.trim()) {
      setError('团队名称不能为空');
      return;
    }
    if (invalidMemberNamesError) {
      setError(invalidMemberNamesError);
      return;
    }
    if (hasDuplicateMembers) {
      setError('保存前成员名称不能重复');
      return;
    }
    const latestSourceSnapshot = buildEditTeamSourceSnapshot({
      name: currentName,
      description: currentDescription,
      color: currentColor,
      members: currentMembers,
    });
    const allowedSourceSnapshots = new Set(
      [baselineSourceSnapshotRef.current, pendingCommittedSourceSnapshotRef.current].filter(
        (value): value is string => value !== null
      )
    );
    if (allowedSourceSnapshots.size > 0 && !allowedSourceSnapshots.has(latestSourceSnapshot)) {
      setError('打开此对话框后团队设置已发生变化，请重新打开并确认最新状态后再保存。');
      return;
    }
    if (hasBlockedLiveIdentityChanges) {
      setError(`团队运行中不能重命名已有成员。已重命名：${liveIdentityChanges.renamed.join(', ')}`);
      return;
    }
    if (isTeamProvisioning) {
      setError('团队仍在启动准备中，暂时不能编辑设置。请等待启动完成后再试。');
      return;
    }
    if (hasNewLiveTeammates) {
      setError('团队运行中请通过专用的添加成员对话框新增成员。编辑团队仅支持更新已有成员。');
      return;
    }
    setSaving(true);
    setError(null);
    setSaveOutcomeError(null);
    void (async () => {
      let configSaved = false;
      let membersSaved = false;
      let committedMembersForSnapshot: ResolvedTeamMember[] = currentMembers;
      try {
        await api.teams.updateConfig(teamName, {
          name: name.trim(),
          description: description.trim(),
          color,
          leadProviderId,
          leadModel: leadModel.trim() || undefined,
          leadEffort,
          leadWorkflow: leadWorkflow.trim(),
        });
        configSaved = true;
        for (const removedMemberName of liveRemovedExistingMembers) {
          await api.teams.removeMember(teamName, removedMemberName);
          committedMembersForSnapshot = applyRemovedMembersToSnapshot(committedMembersForSnapshot, [
            removedMemberName,
          ]);
        }
        await api.teams.replaceMembers(teamName, { members: builtMembers });
        membersSaved = true;
        pendingCommittedSourceSnapshotRef.current = buildEditTeamSourceSnapshot({
          name: name.trim(),
          description: description.trim(),
          color: color.trim(),
          members: builtMembers.map((member) => ({
            name: member.name,
            role: member.role,
            workflow: member.workflow,
            providerId: member.providerId,
            model: member.model,
            effort: member.effort,
            isolation: member.isolation,
          })) as ResolvedTeamMember[],
        });

        await Promise.resolve(onSaved());
        setMembersPendingRestartRetry({});
        if (effectiveMembersToRestart.length > 0) {
          setSaveOutcomeError(
            `团队已保存。请重启团队以应用 ${effectiveMembersToRestart.join(', ')} 的运行时变更。`
          );
          return;
        }
        if (effectiveMembersToRestart.length === 0) {
          onClose();
          return;
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : '保存失败';
        if (membersSaved) {
          setSaveOutcomeError(`团队变更已保存，但刷新最新视图失败：${message}`);
        } else if (configSaved) {
          pendingCommittedSourceSnapshotRef.current = buildEditTeamSourceSnapshot({
            name: name.trim(),
            description: description.trim(),
            color: color.trim(),
            members: committedMembersForSnapshot,
          });
          let refreshErrorDetail: string | null = null;
          try {
            await Promise.resolve(onSaved());
          } catch (refreshError) {
            refreshErrorDetail =
              refreshError instanceof Error ? refreshError.message : String(refreshError);
          }
          setSaveOutcomeError(
            refreshErrorDetail
              ? `团队设置已保存，但成员变更失败：${message}。刷新也失败：${refreshErrorDetail}`
              : `团队设置已保存，但成员变更失败：${message}`
          );
        } else {
          setError(message);
        }
      } finally {
        setSaving(false);
      }
    })();
  };

  const handleSaveAndRestart = (): void => {
    if (!name.trim()) {
      setError('团队名称不能为空');
      return;
    }
    if (invalidMemberNamesError) {
      setError(invalidMemberNamesError);
      return;
    }
    if (hasDuplicateMembers) {
      setError('保存前成员名称不能重复');
      return;
    }
    const latestSourceSnapshot = buildEditTeamSourceSnapshot({
      name: currentName,
      description: currentDescription,
      color: currentColor,
      members: currentMembers,
    });
    const allowedSourceSnapshots = new Set(
      [baselineSourceSnapshotRef.current, pendingCommittedSourceSnapshotRef.current].filter(
        (value): value is string => value !== null
      )
    );
    if (allowedSourceSnapshots.size > 0 && !allowedSourceSnapshots.has(latestSourceSnapshot)) {
      setError('打开此对话框后团队设置已发生变化，请重新打开并确认最新状态后再保存。');
      return;
    }
    if (hasBlockedLiveIdentityChanges) {
      setError(`团队运行中不能重命名已有成员。已重命名：${liveIdentityChanges.renamed.join(', ')}`);
      return;
    }
    if (isTeamProvisioning) {
      setError('团队仍在启动准备中，暂时不能编辑设置。请等待启动完成后再试。');
      return;
    }
    if (hasNewLiveTeammates) {
      setError('团队运行中请通过专用的添加成员对话框新增成员。编辑团队仅支持更新已有成员。');
      return;
    }
    if (!onSaveAndRestart) {
      setError('保存并重启功能不可用。');
      return;
    }

    setRestarting(true);
    setError(null);
    setSaveOutcomeError(null);

    void (async () => {
      let configSaved = false;
      let membersSaved = false;
      try {
        await api.teams.updateConfig(teamName, {
          name: name.trim(),
          description: description.trim(),
          color,
          leadProviderId,
          leadModel: leadModel.trim() || undefined,
          leadEffort,
          leadWorkflow: leadWorkflow.trim(),
        });
        configSaved = true;
        for (const removedMemberName of liveRemovedExistingMembers) {
          await api.teams.removeMember(teamName, removedMemberName);
        }
        await api.teams.replaceMembers(teamName, { members: builtMembers });
        membersSaved = true;

        await Promise.resolve(
          onSaveAndRestart({
            providerId: teamProviderId,
            model: teamModel.trim() || undefined,
            effort: teamEffort,
            fastMode: teamFastMode,
            clearContext,
          })
        );

        await Promise.resolve(onSaved());
        onClose();
      } catch (e) {
        const message = e instanceof Error ? e.message : '保存并重启失败';
        if (membersSaved) {
          setSaveOutcomeError(`团队变更已保存，但重启失败：${message}`);
        } else if (configSaved) {
          setSaveOutcomeError(`团队设置已保存，但成员变更失败：${message}`);
        } else {
          setError(message);
        }
      } finally {
        setRestarting(false);
      }
    })();
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>编辑团队</DialogTitle>
          <DialogDescription>修改团队名称、描述和颜色</DialogDescription>
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
              onChange={(e) => {
                clearTransientErrors();
                setName(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !saving && name.trim()) handleSave();
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
              onChange={(e) => {
                clearTransientErrors();
                setDescription(e.target.value);
              }}
              rows={3}
              className="w-full resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-border-emphasis)]"
              placeholder="团队描述（可选）"
            />
          </div>
          <div>
            <MembersEditorSection
              members={members}
              onChange={(nextMembers) => {
                clearTransientErrors();
                setMembers(nextMembers);
              }}
              fieldError={invalidMemberNamesError ?? undefined}
              validateMemberName={validateMemberNameInline}
              showWorkflow
              showJsonEditor={!isTeamAlive}
              draftKeyPrefix={`editTeam:${teamName}`}
              projectPath={projectPath ?? null}
              headerExtra={
                leadDraft ? (
                  <div className="space-y-2">
                    <MemberDraftRow
                      member={leadDraft}
                      index={0}
                      avatarSrc={agentAvatarUrl('lead', 32)}
                      resolvedColor={effectiveResolvedMemberColorMap.get(
                        leadDraft.originalName ?? leadDraft.name
                      )}
                      nameError={null}
                      onNameChange={() => undefined}
                      onRoleChange={() => undefined}
                      onCustomRoleChange={() => undefined}
                      onRemove={() => undefined}
                      onProviderChange={(_id, providerId) => {
                        clearTransientErrors();
                        setLeadProviderId(providerId);
                        setLeadModel('');
                      }}
                      onModelChange={(_id, model) => {
                        clearTransientErrors();
                        setLeadModel(model);
                      }}
                      onEffortChange={(_id, effort) => {
                        clearTransientErrors();
                        setLeadEffort((effort || undefined) as EffortLevel | undefined);
                      }}
                      showWorkflow
                      onWorkflowChange={(_id, workflow) => {
                        clearTransientErrors();
                        setLeadWorkflow(workflow);
                      }}
                      projectPath={projectPath ?? null}
                      lockRole
                      lockedRoleLabel="团队负责人"
                      lockIdentity
                      hideActionButton
                    />
                  </div>
                ) : null
              }
              existingMembers={currentMembers}
              existingMemberColorMap={effectiveResolvedMemberColorMap}
              showWorktreeIsolationControls
              teammateWorktreeDefault={teammateWorktreeDefault}
              onTeammateWorktreeDefaultChange={setTeammateWorktreeDefault}
              lockProviderModel={false}
              lockExistingMemberIdentity={isTeamAlive}
              identityLockReason={undefined}
              disableAddMember={isTeamAlive}
              addMemberLockReason="团队运行中请通过专用的添加成员对话框新增成员。"
              memberWarningById={memberWarningById}
            />
          </div>
          {isTeamProvisioning ? (
            <p className="text-xs text-amber-300">团队仍在启动准备中，启动完成前暂时锁定编辑。</p>
          ) : null}
          {isTeamAlive && hasNewLiveTeammates ? (
            <p className="text-xs text-red-300">
              团队运行中不能从“编辑团队”新增成员，请改用“添加成员”对话框。
            </p>
          ) : null}
          {isTeamAlive && hasBlockedLiveIdentityChanges ? (
            <p className="text-xs text-red-300">
              团队运行中无法保存：已有成员被重命名。请还原这些身份变更，或先停止团队。
            </p>
          ) : null}
          {isTeamAlive && effectiveMembersToRestart.length > 0 ? (
            <p className="text-xs text-amber-300">
              保存后将重启
              {effectiveMembersToRestart.length === 1 ? '该成员' : '这些成员'}
              以应用角色、工作流、worktree 隔离、提供商、模型或推理强度变更：
              {effectiveMembersToRestart.join(', ')}.
            </p>
          ) : null}
          {isTeamAlive && (
            <div className="rounded-md border border-[var(--color-border)]">
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium"
                onClick={() => setShowRuntimeSettings((prev) => !prev)}
              >
                <span>运行时设置（重启时生效）</span>
                {showRuntimeSettings ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              {showRuntimeSettings && (
                <div className="space-y-3 border-t border-[var(--color-border)] px-3 py-3">
                  <TeamModelSelector
                    providerId={teamProviderId}
                    onProviderChange={(id) => {
                      setTeamProviderId(id);
                      setTeamModel('');
                    }}
                    value={teamModel}
                    onValueChange={setTeamModel}
                    id="edit-team-model"
                    disableGeminiOption={true}
                  />
                  <EffortLevelSelector
                    value={teamEffort ?? ''}
                    onValueChange={(v) =>
                      setTeamEffort((v || undefined) as EffortLevel | undefined)
                    }
                    id="edit-team-effort"
                    providerId={teamProviderId}
                    model={teamModel}
                    limitContext={false}
                  />
                  {teamProviderId === 'anthropic' && (
                    <div className="mt-2">
                      <AnthropicFastModeSelector
                        value={teamFastMode}
                        onValueChange={setTeamFastMode}
                        providerFastModeDefault={anthropicProviderFastModeDefault}
                        model={teamModel}
                        limitContext={false}
                        id="edit-team-fast-mode"
                      />
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="edit-team-clear-context"
                      checked={clearContext}
                      onCheckedChange={(checked) => setClearContext(checked === true)}
                    />
                    <Label
                      htmlFor="edit-team-clear-context"
                      className="flex cursor-pointer items-center gap-1.5 text-xs font-normal text-text-secondary"
                    >
                      <RotateCcw className="size-3 shrink-0" />
                      清空上下文（新会话）
                    </Label>
                  </div>
                  {!clearContext && (
                    <div
                      className="rounded-md border px-3 py-2 text-xs"
                      style={{
                        backgroundColor: 'rgba(245, 158, 11, 0.08)',
                        borderColor: 'rgba(245, 158, 11, 0.25)',
                        color: '#fbbf24',
                      }}
                    >
                      恢复上次会话会带上旧上下文；当上下文较大或模型处于冷却时，重启更容易触发 API
                      频率限制。
                    </div>
                  )}
                  {clearContext && (
                    <div
                      className="rounded-md border px-3 py-2 text-xs"
                      style={{
                        backgroundColor: 'var(--warning-bg)',
                        borderColor: 'var(--warning-border)',
                        color: 'var(--warning-text)',
                      }}
                    >
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                        <p>
                          团队负责人会启动一个新会话，不再恢复之前的上下文。已积累的会话记忆和对话历史将不可用。
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          <div>
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- Color picker is a group of buttons, not a single input */}
            <label className="label-optional mb-1 block text-xs font-medium">颜色（可选）</label>
            <div className="flex flex-wrap gap-2">
              {TEAM_COLOR_NAMES.map((colorName) => {
                const colorSet = getTeamColorSet(colorName);
                const isSelected = color === colorName;
                return (
                  <button
                    key={colorName}
                    type="button"
                    className={cn(
                      'flex size-7 items-center justify-center rounded-full border-2 transition-all',
                      isSelected ? 'scale-110' : 'opacity-70 hover:opacity-100'
                    )}
                    style={{
                      backgroundColor: getThemedBadge(colorSet, isLight),
                      borderColor: isSelected ? colorSet.border : 'transparent',
                    }}
                    title={colorName}
                    onClick={() => {
                      clearTransientErrors();
                      setColor(isSelected ? '' : colorName);
                    }}
                  >
                    <span
                      className="size-3.5 rounded-full"
                      style={{ backgroundColor: colorSet.border }}
                    />
                  </button>
                );
              })}
            </div>
          </div>
          {(error || saveOutcomeError) && (
            <p className="text-xs text-red-400">{error ?? saveOutcomeError}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving || restarting}>
            取消
          </Button>
          <div className="flex items-center gap-2">
            {isTeamAlive && onSaveAndRestart && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleSaveAndRestart}
                disabled={
                  saving ||
                  restarting ||
                  isTeamProvisioning ||
                  !name.trim() ||
                  hasDuplicateMembers ||
                  Boolean(invalidMemberNamesError)
                }
              >
                {restarting && <Loader2 size={14} className="mr-1.5 animate-spin" />}
                保存并重启
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleSave}
              disabled={
                saving ||
                restarting ||
                isTeamProvisioning ||
                !name.trim() ||
                hasDuplicateMembers ||
                Boolean(invalidMemberNamesError)
              }
            >
              {saving && <Loader2 size={14} className="mr-1.5 animate-spin" />}
              保存
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
