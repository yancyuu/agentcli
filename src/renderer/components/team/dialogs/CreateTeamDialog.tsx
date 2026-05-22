import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Stubs for removed anthropic-runtime-profile feature
function resolveAnthropicRuntimeSelection(_opts: {
  source: { modelCatalog?: unknown; runtimeCapabilities?: unknown };
  selectedModel?: string;
  limitContext: boolean;
}) {
  return { fastModeAvailable: false };
}
function resolveAnthropicFastMode(_opts: {
  selection: ReturnType<typeof resolveAnthropicRuntimeSelection>;
  selectedFastMode: unknown;
  providerFastModeDefault: boolean;
}) {
  return {
    showFastModeControl: false,
    resolvedFastMode: false,
    selectable: false,
    disabledReason: null,
  };
}
function reconcileAnthropicRuntimeSelections(_opts: {
  selection: ReturnType<typeof resolveAnthropicRuntimeSelection>;
  selectedEffort: string;
  selectedFastMode: 'inherit' | 'on' | 'off';
  providerFastModeDefault: boolean;
}) {
  return {
    nextEffort: _opts.selectedEffort,
    effortResetReason: null as string | null,
    nextFastMode: _opts.selectedFastMode as 'inherit' | 'on' | 'off',
    fastModeResetReason: null as string | null,
  };
}

import { api } from '@renderer/api';
import { AutoResizeTextarea } from '@renderer/components/ui/auto-resize-textarea';
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
import { MentionableTextarea } from '@renderer/components/ui/MentionableTextarea';
import { getTeamColorSet, getThemedBadge } from '@renderer/constants/teamColors';
import { useChipDraftPersistence } from '@renderer/hooks/useChipDraftPersistence';
import { useCreateTeamDraft } from '@renderer/hooks/useCreateTeamDraft';
import { useDraftPersistence } from '@renderer/hooks/useDraftPersistence';
import { useFileListCacheWarmer } from '@renderer/hooks/useFileListCacheWarmer';
import { useTaskSuggestions } from '@renderer/hooks/useTaskSuggestions';
import { useTeamSuggestions } from '@renderer/hooks/useTeamSuggestions';
import { useTheme } from '@renderer/hooks/useTheme';
import { cn } from '@renderer/lib/utils';
import {
  getStoredCreateTeamEffort,
  getStoredCreateTeamFastMode as getStoredTeamFastMode,
  getStoredCreateTeamLimitContext,
  getStoredCreateTeamModel as getStoredTeamModel,
  getStoredCreateTeamProvider as getStoredTeamProvider,
  getStoredCreateTeamSkipPermissions,
  migrateLegacyCreateTeamPreferences,
  setStoredCreateTeamEffort,
  setStoredCreateTeamFastMode,
  setStoredCreateTeamLimitContext,
  setStoredCreateTeamModel,
  setStoredCreateTeamProvider,
  setStoredCreateTeamSkipPermissions,
} from '@renderer/services/createTeamPreferences';
import { useStore } from '@renderer/store';
import { createLoadingMultimodelCliStatus } from '@renderer/store/slices/cliInstallerSlice';
import { normalizePath } from '@renderer/utils/pathNormalize';
import { resolveUiOwnedProviderBackendId } from '@renderer/utils/providerBackendIdentity';
import { refreshCliStatusForCurrentMode } from '@renderer/utils/refreshCliStatus';
import { resolveTeamEffortForLaunch } from '@renderer/utils/teamEffortOptions';
import {
  getTeamModelSelectionError,
  normalizeExplicitTeamModelForUi,
} from '@renderer/utils/teamModelAvailability';
import { getTeamProviderLabel as getCatalogTeamProviderLabel } from '@renderer/utils/teamModelCatalog';
import { isEphemeralProjectPath } from '@shared/utils/ephemeralProjectPath';
import { CANONICAL_LEAD_MEMBER_NAME } from '@shared/utils/leadDetection';
import { DEFAULT_PROVIDER_MODEL_SELECTION } from '@shared/utils/providerModelSelection';
import { resolveTeamLeadColorName } from '@shared/utils/teamMemberColors';
import { normalizeLeadProviderForMode } from '@renderer/components/team/members/MembersEditorSection';
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from 'lucide-react';

import { AdvancedCliSection } from './AdvancedCliSection';
import { AnthropicFastModeSelector } from './AnthropicFastModeSelector';
import { OptionalSettingsSection } from './OptionalSettingsSection';
import { ProjectPathSelector } from './ProjectPathSelector';
import { runProviderPrepareDiagnostics } from './providerPrepareDiagnostics';
import {
  buildProviderPrepareRequestSignature,
  buildProviderPrepareRuntimeStatusSignature,
} from './providerPrepareRequestSignature';
import { getProvisioningModelIssue } from './provisioningModelIssues';
import {
  deriveEffectiveProvisioningPrepareState,
  failIncompleteProviderChecks,
  getPrimaryProvisioningFailureDetail,
  getProvisioningFailureHint,
  getProvisioningProviderBackendSummary,
  type ProvisioningProviderCheck,
  ProvisioningProviderStatusList,
  shouldHideProvisioningProviderStatusList,
  updateProviderCheck,
} from './ProvisioningProviderStatusList';
import { SkipPermissionsCheckbox } from './SkipPermissionsCheckbox';
import { buildLaunchExtraCliArgs, buildTeammateModeCliArgs } from './teammateLaunchMode';
import { analyzeTeammateRuntimeCompatibility } from './teammateRuntimeCompatibility';
import { TeammateRuntimeCompatibilityNotice } from './TeammateRuntimeCompatibilityNotice';
import { computeEffectiveTeamModel, TeamModelSelector } from './TeamModelSelector';
import { getNextSuggestedTeamName } from './teamNameSets';

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

const APP_TEAM_RUNTIME_DISALLOWED_TOOLS = 'TeamDelete,TodoWrite,TaskCreate,TaskUpdate';

import type {
  EffortLevel,
  Project,
  TeamCreateRequest,
  TeamFastMode,
  TeamProviderId,
} from '@shared/types';

function getProviderLabel(providerId: TeamProviderId): string {
  return getCatalogTeamProviderLabel(providerId) ?? 'Anthropic';
}

function alignProvisioningChecks(
  existingChecks: ProvisioningProviderCheck[],
  providerIds: TeamProviderId[]
): ProvisioningProviderCheck[] {
  const existingByProviderId = new Map(
    existingChecks.map((check) => [check.providerId, check] as const)
  );
  return providerIds.map(
    (providerId) =>
      existingByProviderId.get(providerId) ?? {
        providerId,
        status: 'pending',
        backendSummary: null,
        details: [],
      }
  );
}

/**
 * Initial-data payload used by both "copy team" and "use template" flows.
 * In the workspace-scoped team model the dialog never pre-fills a roster:
 * even if a template bundles members, they are ignored — the lead spawns
 * members at runtime. `templateSourceId`/`templateDirectoryId` still flow
 * through so the backend copies template skills/memory assets.
 */
export interface TeamCopyData {
  teamName: string;
  description?: string;
  color?: string;
  providerId?: TeamProviderId;
  model?: string;
  effort?: EffortLevel;
  fastMode?: TeamFastMode;
  limitContext?: boolean;
  skipPermissions?: boolean;
  /** Template source for copying skill/memory files (set when using a template). */
  templateSourceId?: string;
  templateDirectoryId?: string;
}

export interface ActiveTeamRef {
  teamName: string;
  displayName: string;
  projectPath: string;
}

interface CreateTeamDialogProps {
  open: boolean;
  canCreate: boolean;
  provisioningErrorsByTeam: Record<string, string | null>;
  clearProvisioningError?: (teamName?: string) => void;
  existingTeamNames: string[];
  /** Team names currently in active provisioning (launching) — used to prevent name conflicts. */
  provisioningTeamNames?: string[];
  activeTeams?: ActiveTeamRef[];
  initialData?: TeamCopyData;
  defaultProjectPath?: string | null;
  onClose: () => void;
  onCreate: (request: TeamCreateRequest) => Promise<void>;
  onOpenTeam: (teamName: string, projectPath?: string) => void;
}

interface ValidationResult {
  valid: boolean;
  errors?: {
    teamName?: string;
    cwd?: string;
  };
}

/** Mirrors Claude CLI's `zuA()` sanitization: non-alphanumeric → `-`, then lowercase. */
function sanitizeTeamName(name: string): string {
  const trimmed = name.trim();
  let result = name
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-{2,}/g, '-')
    .toLowerCase();
  while (result.startsWith('-')) result = result.slice(1);
  while (result.endsWith('-')) result = result.slice(0, -1);
  if (!result && trimmed) {
    result = buildUnicodeTeamSlug(trimmed);
  }
  return result;
}

function buildUnicodeTeamSlug(name: string): string {
  let hash = 2166136261;
  for (const ch of name) {
    hash ^= ch.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  const suffix = (hash >>> 0).toString(36);
  return `team-${suffix}`;
}

function validateTeamNameInline(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const sanitized = sanitizeTeamName(trimmed);
  if (!sanitized) {
    return '名称至少要包含一个字母或数字';
  }
  if (sanitized.length > 128) {
    return '名称过长（最多 128 个字符）';
  }
  return null;
}

function buildDefaultTeamDescription(teamName: string): string {
  const trimmedName = teamName.trim();
  return trimmedName.length > 0 ? `${trimmedName} 团队（用于任务编排）` : '用于任务编排的团队';
}

function validateRequest(request: TeamCreateRequest): ValidationResult {
  const sanitized = sanitizeTeamName(request.teamName);
  if (!sanitized) {
    return { valid: false, errors: { teamName: '名称至少要包含一个字母或数字' } };
  }
  if (sanitized.length > 128) {
    return { valid: false, errors: { teamName: '名称过长（最多 128 个字符）' } };
  }
  if (!request.cwd.trim()) {
    return { valid: false, errors: { cwd: '请选择工作目录（cwd）' } };
  }
  return { valid: true };
}

export const CreateTeamDialog = ({
  open,
  canCreate,
  provisioningErrorsByTeam,
  clearProvisioningError,
  existingTeamNames,
  provisioningTeamNames = [],
  activeTeams,
  initialData,
  defaultProjectPath,
  onClose,
  onCreate,
  onOpenTeam,
}: CreateTeamDialogProps): React.JSX.Element => {
  const { isLight } = useTheme();
  const multimodelEnabled = useStore((s) => s.appConfig?.general?.multimodelEnabled ?? false);
  const anthropicProviderFastModeDefault = useStore(
    (s) => s.appConfig?.providerConnections?.anthropic.fastModeDefault ?? false
  );
  const cliStatus = useStore((s) => s.cliStatus);
  const cliStatusLoading = useStore((s) => s.cliStatusLoading);
  const bootstrapCliStatus = useStore((s) => s.bootstrapCliStatus);
  const fetchCliStatus = useStore((s) => s.fetchCliStatus);
  const openDashboard = useStore((s) => s.openDashboard);
  const loadingCliStatus = useMemo(
    () =>
      !cliStatus && cliStatusLoading && multimodelEnabled
        ? createLoadingMultimodelCliStatus()
        : cliStatus,
    [cliStatus, cliStatusLoading, multimodelEnabled]
  );
  const effectiveCliStatus = loadingCliStatus;

  // ── Persisted draft state (survives tab navigation) ──────────────────
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

  const descriptionDraft = useDraftPersistence({ key: 'createTeam:description' });
  const promptDraft = useDraftPersistence({ key: 'createTeam:prompt' });
  const promptChipDraft = useChipDraftPersistence('createTeam:prompt:chips');

  // ── Transient UI state (NOT persisted) ───────────────────────────────
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [prepareState, setPrepareState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [prepareMessage, setPrepareMessage] = useState<string | null>(null);
  const [prepareWarnings, setPrepareWarnings] = useState<string[]>([]);
  const [prepareChecks, setPrepareChecks] = useState<ProvisioningProviderCheck[]>([]);
  const prepareRequestSeqRef = useRef(0);
  const lastAutoDescriptionRef = useRef<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    teamName?: string;
    cwd?: string;
  }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [conflictDismissed, setConflictDismissed] = useState(false);
  const [selectedProviderId, setSelectedProviderIdRaw] = useState<TeamProviderId>(() =>
    normalizeLeadProviderForMode(getStoredTeamProvider(), multimodelEnabled)
  );
  const [selectedModel, setSelectedModelRaw] = useState(() =>
    getStoredTeamModel(normalizeLeadProviderForMode(getStoredTeamProvider(), multimodelEnabled))
  );
  const [limitContext, setLimitContextRaw] = useState(getStoredCreateTeamLimitContext);
  const [skipPermissions, setSkipPermissionsRaw] = useState(getStoredCreateTeamSkipPermissions);
  const [selectedEffort, setSelectedEffortRaw] = useState(getStoredCreateTeamEffort);
  const [selectedFastMode, setSelectedFastModeRaw] = useState<TeamFastMode>(getStoredTeamFastMode);
  const [anthropicRuntimeNotice, setAnthropicRuntimeNotice] = useState<string | null>(null);

  // Advanced CLI section state (use teamName-derived key for localStorage)
  const advancedKey = sanitizeTeamName(teamName.trim()) || '_new_';
  const [worktreeEnabled, setWorktreeEnabledRaw] = useState(false);
  const [worktreeName, setWorktreeNameRaw] = useState('');
  const [customArgs, setCustomArgsRaw] = useState('');

  useEffect(() => {
    migrateLegacyCreateTeamPreferences();
  }, []);

  // Re-read localStorage when advancedKey changes
  useEffect(() => {
    const storedEnabled =
      localStorage.getItem(`team:lastWorktreeEnabled:${advancedKey}`) === 'true';
    const storedName = localStorage.getItem(`team:lastWorktreeName:${advancedKey}`) ?? '';
    setWorktreeEnabledRaw(storedEnabled && Boolean(storedName));
    setWorktreeNameRaw(storedName);
    setCustomArgsRaw(localStorage.getItem(`team:lastCustomArgs:${advancedKey}`) ?? '');
  }, [advancedKey]);

  const setSelectedModel = (value: string): void => {
    const normalizedValue = normalizeExplicitTeamModelForUi(selectedProviderId, value);
    setSelectedModelRaw(normalizedValue);
    setStoredCreateTeamModel(selectedProviderId, normalizedValue);
  };

  const setSelectedProviderId = (value: TeamProviderId): void => {
    const normalizedValue = normalizeLeadProviderForMode(value, multimodelEnabled);
    setSelectedProviderIdRaw(normalizedValue);
    setStoredCreateTeamProvider(normalizedValue);
    if (normalizedValue !== 'anthropic') {
      setLimitContextRaw(false);
      setStoredCreateTeamLimitContext(false);
    }
    setSelectedModelRaw(getStoredTeamModel(normalizedValue));
  };

  const setLimitContext = (value: boolean): void => {
    setLimitContextRaw(value);
    setStoredCreateTeamLimitContext(value);
  };

  const setSkipPermissions = (value: boolean): void => {
    setSkipPermissionsRaw(value);
    setStoredCreateTeamSkipPermissions(value);
  };

  const setSelectedEffort = (value: string): void => {
    setSelectedEffortRaw(value);
    setStoredCreateTeamEffort(value);
  };

  const setSelectedFastMode = (value: TeamFastMode): void => {
    setSelectedFastModeRaw(value);
    setStoredCreateTeamFastMode(value);
  };

  const setWorktreeEnabled = (value: boolean): void => {
    setWorktreeEnabledRaw(value);
    localStorage.setItem(`team:lastWorktreeEnabled:${advancedKey}`, String(value));
    if (!value) {
      setWorktreeNameRaw('');
      localStorage.setItem(`team:lastWorktreeName:${advancedKey}`, '');
    }
  };
  const setWorktreeName = (value: string): void => {
    setWorktreeNameRaw(value);
    localStorage.setItem(`team:lastWorktreeName:${advancedKey}`, value);
  };
  const setCustomArgs = (value: string): void => {
    setCustomArgsRaw(value);
    localStorage.setItem(`team:lastCustomArgs:${advancedKey}`, value);
  };

  const resetUIState = (): void => {
    setLocalError(null);
    setFieldErrors({});
    setIsSubmitting(false);
    setPrepareState('idle');
    setPrepareMessage(null);
    setPrepareWarnings([]);
    setPrepareChecks([]);
    setConflictDismissed(false);
  };

  const resetFormState = (): void => {
    clearDraft();
    lastAutoDescriptionRef.current = null;
    descriptionDraft.clearDraft();
    promptDraft.clearDraft();
    promptChipDraft.clearChipDraft();
    resetUIState();
  };

  const selectedProjectCwd = isEphemeralProjectPath(selectedProjectPath)
    ? ''
    : selectedProjectPath.trim();
  const effectiveCwd = cwdMode === 'project' ? selectedProjectCwd : customCwd.trim();
  const dialogTeamNameKey = sanitizeTeamName(teamName.trim());
  /** All taken names: existing teams + teams currently being provisioned. */
  const allTakenTeamNames = useMemo(
    () => [...new Set([...existingTeamNames, ...provisioningTeamNames])],
    [existingTeamNames, provisioningTeamNames]
  );
  const suggestedTeamName = getNextSuggestedTeamName(allTakenTeamNames);

  // Clear stale provisioning error when dialog opens
  useEffect(() => {
    if (open && dialogTeamNameKey) {
      clearProvisioningError?.(dialogTeamNameKey);
    }
  }, [open, clearProvisioningError, dialogTeamNameKey]);

  // Workspace-scoped teams only have one provider (the lead's). All teammates
  // are dynamically spawned at runtime, so we only prepare the lead provider.
  const selectedMemberProviders = useMemo<TeamProviderId[]>(
    () => [selectedProviderId],
    [selectedProviderId]
  );

  const runtimeBackendSummaryByProvider = useMemo(() => {
    const entries: (readonly [TeamProviderId, string | null])[] = (
      effectiveCliStatus?.providers ?? []
    ).map(
      (provider) =>
        [
          provider.providerId as TeamProviderId,
          getProvisioningProviderBackendSummary(provider),
        ] as const
    );
    return new Map<TeamProviderId, string | null>(entries);
  }, [effectiveCliStatus?.providers]);
  const runtimeProviderStatusById = useMemo(
    () =>
      new Map(
        (effectiveCliStatus?.providers ?? []).map(
          (provider) => [provider.providerId, provider] as const
        )
      ),
    [effectiveCliStatus?.providers]
  );
  const selectedProviderBackendId = useMemo(
    () =>
      resolveUiOwnedProviderBackendId(
        selectedProviderId,
        runtimeProviderStatusById.get(selectedProviderId)
      ),
    [runtimeProviderStatusById, selectedProviderId]
  );
  const runtimeBackendSummaryByProviderRef = useRef(runtimeBackendSummaryByProvider);
  const prepareChecksRef = useRef<ProvisioningProviderCheck[]>([]);
  const lastPrepareRequestSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    runtimeBackendSummaryByProviderRef.current = runtimeBackendSummaryByProvider;
  }, [runtimeBackendSummaryByProvider]);

  useEffect(() => {
    prepareChecksRef.current = prepareChecks;
  }, [prepareChecks]);

  useEffect(() => {
    if (!open) {
      lastPrepareRequestSignatureRef.current = null;
    }
  }, [open]);

  const prepareRuntimeStatusSignature = useMemo(
    () =>
      buildProviderPrepareRuntimeStatusSignature(
        selectedMemberProviders,
        runtimeProviderStatusById
      ),
    [runtimeProviderStatusById, selectedMemberProviders]
  );
  const prepareRequestSignature = useMemo(
    () =>
      buildProviderPrepareRequestSignature({
        cwd: effectiveCwd,
        selectedProviderId,
        selectedModel,
        selectedMemberProviders,
        limitContext,
        runtimeStatusSignature: prepareRuntimeStatusSignature,
        membersSignature: '',
      }),
    [
      effectiveCwd,
      limitContext,
      prepareRuntimeStatusSignature,
      selectedMemberProviders,
      selectedModel,
      selectedProviderId,
    ]
  );

  useEffect(() => {
    if (!open || cliStatus || cliStatusLoading) {
      return;
    }
    void refreshCliStatusForCurrentMode({
      multimodelEnabled,
      bootstrapCliStatus,
      fetchCliStatus,
    });
  }, [bootstrapCliStatus, cliStatus, cliStatusLoading, fetchCliStatus, multimodelEnabled, open]);

  useEffect(() => {
    if (!open || !canCreate) {
      prepareRequestSeqRef.current += 1;
      lastPrepareRequestSignatureRef.current = null;
      return;
    }

    if (typeof api.teams.prepareProvisioning !== 'function') {
      prepareRequestSeqRef.current += 1;
      lastPrepareRequestSignatureRef.current = null;
      setPrepareState('failed');
      setPrepareWarnings([]);
      setPrepareChecks([]);
      setPrepareMessage('当前 preload 版本不支持 team:prepareProvisioning，请重启开发应用。');
      return;
    }

    if (!effectiveCwd) {
      prepareRequestSeqRef.current += 1;
      lastPrepareRequestSignatureRef.current = null;
      setPrepareState('idle');
      setPrepareWarnings([]);
      setPrepareChecks([]);
      setPrepareMessage('请先选择工作目录，再进行启动环境检查。');
      return;
    }

    if (lastPrepareRequestSignatureRef.current === prepareRequestSignature) {
      return;
    }
    lastPrepareRequestSignatureRef.current = prepareRequestSignature;

    const requestSeq = ++prepareRequestSeqRef.current;
    const initialChecks = alignProvisioningChecks(
      prepareChecksRef.current,
      selectedMemberProviders
    );
    setPrepareState('loading');
    setPrepareMessage('正在并行检查所选提供商...');
    setPrepareWarnings([]);
    setPrepareChecks(initialChecks);

    void (async () => {
      await Promise.resolve();
      let checks = initialChecks;
      const providerPlans = selectedMemberProviders.map((providerId) => {
        const selectedModelChecks = (() => {
          const next = new Set<string>();
          let hasDefaultSelection = false;
          const supportsProviderDefaultCheck =
            providerId === 'anthropic' && selectedProviderId === 'anthropic';
          const leadModel = computeEffectiveTeamModel(
            selectedModel,
            limitContext,
            selectedProviderId
          );
          if (selectedProviderId === providerId && selectedModel.trim()) {
            if (leadModel?.trim()) {
              next.add(leadModel.trim());
            }
          } else if (selectedProviderId === providerId && supportsProviderDefaultCheck) {
            hasDefaultSelection = true;
          }
          if (supportsProviderDefaultCheck && hasDefaultSelection) {
            next.add(DEFAULT_PROVIDER_MODEL_SELECTION);
          }
          return Array.from(next);
        })();
        const backendSummary = runtimeBackendSummaryByProviderRef.current.get(providerId) ?? null;
        return {
          providerId,
          selectedModelChecks,
          backendSummary,
        };
      });

      try {
        for (const plan of providerPlans) {
          checks = updateProviderCheck(checks, plan.providerId, {
            status: 'checking',
            backendSummary: plan.backendSummary,
            details: [],
          });
        }
        if (prepareRequestSeqRef.current === requestSeq) {
          setPrepareChecks(checks);
        }
        const providerResults = await Promise.all(
          providerPlans.map(async (plan) => {
            const prepResult = await runProviderPrepareDiagnostics({
              cwd: effectiveCwd,
              providerId: plan.providerId,
              selectedModelIds: plan.selectedModelChecks,
              prepareProvisioning: api.teams.prepareProvisioning,
              limitContext,
              onModelProgress: ({ status, details }) => {
                checks = updateProviderCheck(checks, plan.providerId, {
                  status,
                  backendSummary: plan.backendSummary,
                  details,
                });
                if (prepareRequestSeqRef.current === requestSeq) {
                  setPrepareChecks(checks);
                }
              },
            });
            return { ...plan, prepResult };
          })
        );
        let anyFailure = false;
        let anyNotes = false;
        const collectedWarnings: string[] = [];
        for (const plan of providerResults) {
          if (plan.prepResult.warnings.length > 0) {
            anyNotes = true;
            collectedWarnings.push(
              ...plan.prepResult.warnings.map(
                (warning) => `${getProviderLabel(plan.providerId)}: ${warning}`
              )
            );
          }
          if (plan.prepResult.status === 'failed') {
            anyFailure = true;
          } else if (plan.prepResult.status === 'notes') {
            anyNotes = true;
          }
          checks = updateProviderCheck(checks, plan.providerId, {
            status: plan.prepResult.status,
            backendSummary: plan.backendSummary,
            details: plan.prepResult.details,
          });
        }
        if (prepareRequestSeqRef.current === requestSeq) {
          setPrepareChecks(checks);
        }
        if (prepareRequestSeqRef.current !== requestSeq) return;
        const failureMessage =
          getPrimaryProvisioningFailureDetail(checks) ?? '部分提供商状态异常，请先处理。';
        setPrepareChecks(checks);
        setPrepareState(anyFailure ? 'failed' : 'ready');
        setPrepareMessage(
          anyFailure
            ? failureMessage
            : anyNotes
              ? '所选提供商已就绪（含提示信息）。'
              : '所选提供商已就绪。'
        );
        setPrepareWarnings(
          anyFailure
            ? Array.from(new Set([...collectedWarnings, failureMessage]))
            : collectedWarnings
        );
      } catch (error) {
        if (prepareRequestSeqRef.current !== requestSeq) return;
        const failureMessage = error instanceof Error ? error.message : '预热 Agent CLI 环境失败';
        setPrepareState('failed');
        setPrepareWarnings([]);
        setPrepareChecks(failIncompleteProviderChecks(checks, failureMessage));
        setPrepareMessage(failureMessage);
      }
    })();
  }, [
    open,
    canCreate,
    effectiveCwd,
    limitContext,
    prepareRequestSignature,
    runtimeProviderStatusById,
    selectedModel,
    selectedProviderId,
    selectedMemberProviders,
  ]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setProjectsLoading(true);
    setProjectsError(null);

    let cancelled = false;
    void (async () => {
      try {
        const nextProjects = (await api.getProjects()).filter(
          (project) => !isEphemeralProjectPath(project.path)
        );
        if (cancelled) {
          return;
        }

        const normalizedDefaultProjectPath = defaultProjectPath
          ? normalizePath(defaultProjectPath)
          : null;
        if (
          defaultProjectPath &&
          normalizedDefaultProjectPath &&
          !isEphemeralProjectPath(defaultProjectPath) &&
          !nextProjects.some((p) => normalizePath(p.path) === normalizedDefaultProjectPath)
        ) {
          const folderName =
            defaultProjectPath.split(/[/\\]/).filter(Boolean).pop() ?? defaultProjectPath;
          nextProjects.unshift({
            id: defaultProjectPath.replace(/[/\\]/g, '-'),
            path: defaultProjectPath,
            name: folderName,
            sessions: [],
            createdAt: Date.now(),
          });
        }

        setProjects(nextProjects);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setProjectsError(error instanceof Error ? error.message : '加载项目列表失败');
        setProjects([]);
      } finally {
        if (!cancelled) {
          setProjectsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, defaultProjectPath]);

  // Apply initialData (copy team / use template) — name, description, color,
  // and lead runtime settings only. Any bundled members are intentionally
  // ignored in workspace-scoped mode; the lead spawns teammates dynamically.
  useEffect(() => {
    if (!open || !draftLoaded || !initialData) {
      return;
    }
    setTeamName(initialData.teamName);
    descriptionDraft.setValue(initialData.description ?? '');
    setTeamColor(initialData.color ?? '');
    const initialProviderId = normalizeLeadProviderForMode(
      initialData.providerId ?? 'anthropic',
      multimodelEnabled
    );
    setSelectedProviderIdRaw(initialProviderId);
    setSelectedModelRaw(
      normalizeExplicitTeamModelForUi(
        initialProviderId,
        initialData.model ?? getStoredTeamModel(initialProviderId)
      )
    );
    setSelectedEffortRaw(initialData.effort ?? getStoredCreateTeamEffort());
    setSelectedFastModeRaw(initialData.fastMode ?? getStoredTeamFastMode());
    if (typeof initialData.limitContext === 'boolean') {
      setLimitContextRaw(initialData.limitContext);
    } else if (initialProviderId !== 'anthropic') {
      setLimitContextRaw(false);
    } else {
      setLimitContextRaw(getStoredCreateTeamLimitContext());
    }
    if (typeof initialData.skipPermissions === 'boolean') {
      setSkipPermissionsRaw(initialData.skipPermissions);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialData processed once per open
  }, [open, draftLoaded]);

  useEffect(() => {
    if (!open || initialData || !draftLoaded) {
      return;
    }
    if (teamName.trim().length === 0) {
      setTeamName(suggestedTeamName);
    }
  }, [initialData, open, suggestedTeamName, draftLoaded]); // eslint-disable-line react-hooks/exhaustive-deps -- teamName read once

  useEffect(() => {
    if (!open || initialData) {
      return;
    }
    const resolvedTeamName = teamName.trim() || suggestedTeamName;
    const nextAutoDescription = buildDefaultTeamDescription(resolvedTeamName);
    const currentDescription = descriptionDraft.value.trim();
    const previousAutoDescription = lastAutoDescriptionRef.current?.trim() ?? '';
    const shouldSyncDescription =
      currentDescription.length === 0 || currentDescription === previousAutoDescription;

    if (shouldSyncDescription && descriptionDraft.value !== nextAutoDescription) {
      lastAutoDescriptionRef.current = nextAutoDescription;
      descriptionDraft.setValue(nextAutoDescription);
      return;
    }

    if (currentDescription === nextAutoDescription) {
      lastAutoDescriptionRef.current = nextAutoDescription;
    }
  }, [descriptionDraft, initialData, open, suggestedTeamName, teamName]);

  // Pre-select defaultProjectPath when projects loaded
  useEffect(() => {
    if (!open) return;
    if (cwdMode !== 'project') return;
    if (selectedProjectPath) return;
    const selectableProjects = projects.filter((project) => !isEphemeralProjectPath(project.path));
    if (selectableProjects.length === 0) return;
    if (defaultProjectPath && !isEphemeralProjectPath(defaultProjectPath)) {
      const normalizedDefaultProjectPath = normalizePath(defaultProjectPath);
      const match = selectableProjects.find(
        (p) => normalizePath(p.path) === normalizedDefaultProjectPath
      );
      if (match) {
        setSelectedProjectPath(match.path);
        return;
      }
    }
    setSelectedProjectPath(selectableProjects[0].path);
  }, [open, cwdMode, projects, selectedProjectPath, defaultProjectPath, initialData]);

  useEffect(() => {
    if (!open || cwdMode !== 'project' || !selectedProjectPath) {
      return;
    }
    if (!isEphemeralProjectPath(selectedProjectPath)) {
      return;
    }
    setSelectedProjectPath('');
  }, [open, cwdMode, selectedProjectPath, setSelectedProjectPath]);

  useFileListCacheWarmer(effectiveCwd || null);

  const { suggestions: taskSuggestions } = useTaskSuggestions(null);
  const { suggestions: teamMentionSuggestions } = useTeamSuggestions(null);

  const description = descriptionDraft.value;
  const prompt = promptDraft.value;

  const mentionSuggestions = useMemo(
    () => [
      {
        id: CANONICAL_LEAD_MEMBER_NAME,
        name: CANONICAL_LEAD_MEMBER_NAME,
        subtitle: '团队负责人',
        color: resolveTeamLeadColorName(),
      },
    ],
    []
  );

  const effectiveModel = useMemo(
    () =>
      computeEffectiveTeamModel(
        selectedModel,
        limitContext,
        selectedProviderId,
        runtimeProviderStatusById.get(selectedProviderId)
      ),
    [limitContext, runtimeProviderStatusById, selectedModel, selectedProviderId]
  );
  // Workspace-scoped teams are always lead-only at startup; pass solo=true so
  // the analysis only validates the lead's own runtime compatibility.
  const teammateRuntimeCompatibility = useMemo(
    () =>
      analyzeTeammateRuntimeCompatibility({
        leadProviderId: selectedProviderId,
        leadProviderBackendId: selectedProviderBackendId,
        members: [],
        soloTeam: true,
        extraCliArgs: buildLaunchExtraCliArgs(customArgs),
      }),
    [customArgs, selectedProviderBackendId, selectedProviderId]
  );
  const anthropicRuntimeSelection = useMemo(
    () =>
      selectedProviderId === 'anthropic'
        ? resolveAnthropicRuntimeSelection({
            source: {
              modelCatalog: runtimeProviderStatusById.get('anthropic')?.modelCatalog,
              runtimeCapabilities: runtimeProviderStatusById.get('anthropic')?.runtimeCapabilities,
            },
            selectedModel,
            limitContext,
          })
        : null,
    [limitContext, runtimeProviderStatusById, selectedModel, selectedProviderId]
  );
  const anthropicFastModeResolution = useMemo(
    () =>
      selectedProviderId === 'anthropic' && anthropicRuntimeSelection
        ? resolveAnthropicFastMode({
            selection: anthropicRuntimeSelection,
            selectedFastMode,
            providerFastModeDefault: anthropicProviderFastModeDefault,
          })
        : null,
    [
      anthropicProviderFastModeDefault,
      anthropicRuntimeSelection,
      selectedFastMode,
      selectedProviderId,
    ]
  );
  useEffect(() => {
    if (selectedProviderId !== 'anthropic') {
      setAnthropicRuntimeNotice(null);
      return;
    }

    const reconciliation = reconcileAnthropicRuntimeSelections({
      selection:
        anthropicRuntimeSelection ??
        resolveAnthropicRuntimeSelection({
          source: { modelCatalog: null, runtimeCapabilities: null },
          selectedModel,
          limitContext,
        }),
      selectedEffort,
      selectedFastMode,
      providerFastModeDefault: anthropicProviderFastModeDefault,
    });

    const notices: string[] = [];
    if (reconciliation.nextEffort !== selectedEffort) {
      setSelectedEffortRaw(reconciliation.nextEffort);
      setStoredCreateTeamEffort(reconciliation.nextEffort);
      if (reconciliation.effortResetReason) {
        notices.push(reconciliation.effortResetReason);
      }
    }
    if (reconciliation.nextFastMode !== selectedFastMode) {
      setSelectedFastModeRaw(reconciliation.nextFastMode);
      setStoredCreateTeamFastMode(reconciliation.nextFastMode);
      if (reconciliation.fastModeResetReason) {
        notices.push(reconciliation.fastModeResetReason);
      }
    }
    setAnthropicRuntimeNotice(notices.length > 0 ? notices.join(' ') : null);
  }, [
    anthropicProviderFastModeDefault,
    anthropicRuntimeSelection,
    limitContext,
    selectedEffort,
    selectedFastMode,
    selectedModel,
    selectedProviderId,
  ]);

  const sanitizedTeamName = sanitizeTeamName(teamName.trim());
  const teamNameInlineError = validateTeamNameInline(teamName);
  const isNameTakenByExistingTeam = existingTeamNames.includes(sanitizedTeamName);
  const isNameProvisioning =
    provisioningTeamNames.includes(sanitizedTeamName) && !isNameTakenByExistingTeam;
  const executionTarget = useMemo(
    () => ({ type: 'local' as const, cwd: effectiveCwd || undefined }),
    [effectiveCwd]
  );

  const request = useMemo<TeamCreateRequest>(() => {
    const launchEffort = resolveTeamEffortForLaunch({
      providerId: selectedProviderId,
      selectedEffort,
    });

    return {
      teamName: sanitizedTeamName,
      displayName: teamName.trim() || undefined,
      description: description.trim() || undefined,
      color: teamColor || undefined,
      members: [],
      cwd: effectiveCwd,
      executionTarget,
      prompt: prompt.trim() || undefined,
      providerId: selectedProviderId,
      providerBackendId: selectedProviderBackendId ?? undefined,
      model: effectiveModel,
      effort: launchEffort,
      fastMode: selectedFastMode,
      limitContext,
      skipPermissions,
      worktree: worktreeEnabled && worktreeName.trim() ? worktreeName.trim() : undefined,
      extraCliArgs: buildLaunchExtraCliArgs(customArgs),
      templateSourceId: initialData?.templateSourceId,
      templateDirectoryId: initialData?.templateDirectoryId,
    };
  }, [
    sanitizedTeamName,
    teamName,
    description,
    teamColor,
    effectiveCwd,
    executionTarget,
    prompt,
    selectedProviderId,
    selectedProviderBackendId,
    effectiveModel,
    selectedEffort,
    selectedFastMode,
    limitContext,
    skipPermissions,
    worktreeEnabled,
    worktreeName,
    customArgs,
    initialData?.templateSourceId,
    initialData?.templateDirectoryId,
  ]);
  const requestValidation = useMemo(() => validateRequest(request), [request]);
  const modelValidationError = useMemo(
    () =>
      getTeamModelSelectionError(
        selectedProviderId,
        selectedModel,
        runtimeProviderStatusById.get(selectedProviderId)
      ),
    [runtimeProviderStatusById, selectedModel, selectedProviderId]
  );
  const leadModelIssueText = useMemo(() => {
    const issue = getProvisioningModelIssue(
      prepareChecks,
      selectedProviderId,
      effectiveModel ?? selectedModel
    );
    return issue?.reason ?? issue?.detail ?? null;
  }, [effectiveModel, prepareChecks, selectedModel, selectedProviderId]);
  const hasCreateFormErrors =
    !!teamNameInlineError ||
    isNameTakenByExistingTeam ||
    isNameProvisioning ||
    !requestValidation.valid ||
    !!modelValidationError ||
    teammateRuntimeCompatibility.blocksSubmission;

  const internalArgs = useMemo(() => {
    const args: string[] = [];
    args.push('--input-format', 'stream-json', '--output-format', 'stream-json');
    args.push('--verbose', '--setting-sources', 'user,project,local');
    args.push('--mcp-config', '<auto>', '--disallowedTools', APP_TEAM_RUNTIME_DISALLOWED_TOOLS);
    if (skipPermissions) args.push('--dangerously-skip-permissions');
    if (effectiveModel) args.push('--model', effectiveModel);
    const effectiveEffort = resolveTeamEffortForLaunch({
      providerId: selectedProviderId,
      selectedEffort,
    });
    if (effectiveEffort) args.push('--effort', effectiveEffort);
    if (selectedProviderId === 'anthropic') {
      const fastSettings = anthropicFastModeResolution?.resolvedFastMode
        ? { fastMode: true, fastModePerSessionOptIn: false }
        : { fastMode: false };
      args.push('--settings', JSON.stringify(fastSettings));
    }
    args.push(...buildTeammateModeCliArgs());
    return args;
  }, [
    anthropicFastModeResolution?.resolvedFastMode,
    effectiveModel,
    selectedEffort,
    selectedProviderId,
    skipPermissions,
  ]);

  const launchOptionalSummary = useMemo(() => {
    const summary: string[] = [];
    if (prompt.trim()) summary.push('负责人提示词');
    if (skipPermissions) summary.push('自动批准工具');
    if (selectedProviderId === 'anthropic') {
      if (selectedFastMode === 'on') summary.push('快速模式');
      else if (selectedFastMode === 'off') summary.push('快速模式关闭');
      else if (anthropicProviderFastModeDefault) {
        summary.push('快速默认');
      }
    }
    if (worktreeEnabled && worktreeName.trim()) summary.push(`Worktree：${worktreeName.trim()}`);
    if (customArgs.trim()) summary.push('自定义 CLI 参数');
    return summary;
  }, [
    anthropicProviderFastModeDefault,
    customArgs,
    prompt,
    selectedFastMode,
    selectedProviderId,
    skipPermissions,
    worktreeEnabled,
    worktreeName,
  ]);

  const teamDetailsSummary = useMemo(() => {
    const summary: string[] = [];
    if (description.trim()) summary.push('描述');
    if (teamColor) summary.push(`颜色：${teamColor}`);
    return summary;
  }, [description, teamColor]);

  const activeError =
    localError ?? modelValidationError ?? provisioningErrorsByTeam[request.teamName] ?? null;
  const effectivePrepare = useMemo(
    () =>
      deriveEffectiveProvisioningPrepareState({
        state: prepareState,
        message: prepareMessage,
        warnings: prepareWarnings,
        checks: prepareChecks,
      }),
    [prepareChecks, prepareMessage, prepareState, prepareWarnings]
  );
  const canOpenExistingTeam =
    activeError?.includes('Team already exists') === true && request.teamName.length > 0;

  const conflictingTeam = useMemo(() => {
    if (!activeTeams?.length || !effectiveCwd) return null;
    const norm = normalizePath(effectiveCwd);
    return activeTeams.find((t) => normalizePath(t.projectPath) === norm) ?? null;
  }, [activeTeams, effectiveCwd]);

  // Reset dismiss when conflict target changes
  useEffect(() => {
    setConflictDismissed(false);
  }, [conflictingTeam?.teamName, effectiveCwd]);

  const handleSubmit = (): void => {
    if (allTakenTeamNames.includes(sanitizedTeamName)) {
      const msg = isNameProvisioning ? '团队正在启动中' : '团队名称已存在';
      setFieldErrors({ teamName: msg });
      setLocalError(msg);
      return;
    }
    const validation = validateRequest(request);
    if (!validation.valid) {
      const errors = validation.errors ?? {};
      setFieldErrors(errors);
      const messages = Object.values(errors).filter(Boolean);
      setLocalError(messages.join(' · ') || '请检查表单字段');
      return;
    }
    if (modelValidationError) {
      setLocalError(modelValidationError);
      return;
    }
    if (teammateRuntimeCompatibility.blocksSubmission) {
      setLocalError(teammateRuntimeCompatibility.message);
      return;
    }
    setFieldErrors({});
    setLocalError(null);
    setIsSubmitting(true);

    void (async () => {
      try {
        await onCreate(request);
        onOpenTeam(request.teamName, effectiveCwd || undefined);
        resetFormState();
        onClose();
      } catch {
        // error is shown via provisioningError prop
      } finally {
        setIsSubmitting(false);
      }
    })();
  };

  const handleTeamNameChange = (value: string): void => {
    setTeamName(value);
    setFieldErrors((prev) => {
      if (!prev.teamName) return prev;
      // eslint-disable-next-line sonarjs/no-unused-vars -- destructured to omit teamName from rest
      const { teamName: _teamName, ...rest } = prev;
      const remaining = Object.values(rest).filter(Boolean);
      if (remaining.length === 0) {
        setLocalError(null);
      } else {
        setLocalError(remaining.join(' · '));
      }
      return rest;
    });
  };

  const hasTemplateSource = Boolean(
    initialData?.templateSourceId && initialData?.templateDirectoryId
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          resetUIState();
          onClose();
        }
      }}
    >
      <DialogContent className="w-[calc(100vw-2rem)] max-w-3xl sm:w-[48rem]">
        <DialogHeader>
          <DialogTitle className="text-sm">{initialData ? '复制团队' : '创建团队'}</DialogTitle>
          <DialogDescription className="text-xs">
            {initialData
              ? '基于现有团队快速创建新团队。'
              : '通过本地 Agent CLI 完成团队编排与启动。'}
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
                  该工作目录下已有团队“{conflictingTeam.displayName}”正在运行
                </p>
                <p className="opacity-80">
                  在同一目录同时运行两个团队存在风险，可能会修改同一批文件。建议改用不同目录或 git
                  worktree 进行隔离。
                </p>
                <p className="text-[11px] opacity-70">
                  工作目录：<span className="font-mono">{effectiveCwd}</span>
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded p-0.5 opacity-60 transition-colors hover:opacity-100"
                onClick={() => setConflictDismissed(true)}
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        ) : null}

        <TeammateRuntimeCompatibilityNotice
          analysis={teammateRuntimeCompatibility}
          onOpenDashboard={() => {
            onClose();
            openDashboard();
          }}
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="team-name">团队名称</Label>
            <Input
              id="team-name"
              className={cn(
                'h-8 text-xs',
                (fieldErrors.teamName || teamNameInlineError || isNameTakenByExistingTeam) &&
                  'border-[var(--field-error-border)] bg-[var(--field-error-bg)] focus-visible:ring-[var(--field-error-border)]'
              )}
              value={teamName}
              onChange={(event) => handleTeamNameChange(event.target.value)}
              placeholder={suggestedTeamName}
            />
            {isNameTakenByExistingTeam ? (
              <p className="text-[11px]" style={{ color: 'var(--field-error-text)' }}>
                团队名称已存在
              </p>
            ) : teamNameInlineError ? (
              <p className="text-[11px]" style={{ color: 'var(--field-error-text)' }}>
                {teamNameInlineError}
              </p>
            ) : isNameProvisioning ? (
              <p className="text-[11px]" style={{ color: 'var(--warning-text)' }}>
                同名团队正在启动中
              </p>
            ) : fieldErrors.teamName ? (
              <p className="text-[11px]" style={{ color: 'var(--field-error-text)' }}>
                {fieldErrors.teamName}
              </p>
            ) : null}
            {sanitizedTeamName && sanitizedTeamName !== teamName.trim() ? (
              <p className="text-[11px] text-[var(--color-text-muted)]">
                内部标识：<span className="font-mono">{sanitizedTeamName}</span>
              </p>
            ) : null}
          </div>

          <div className="md:col-span-2">
            <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
              <div className="mb-2">
                <p className="text-xs font-medium text-[var(--color-text)]">团队运行时</p>
                <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
                  Provider 作用于整个团队；成员由负责人在运行时动态生成，并默认继承这里的 provider。
                </p>
              </div>
              <TeamModelSelector
                providerId={selectedProviderId}
                onProviderChange={setSelectedProviderId}
                value={selectedModel}
                onValueChange={setSelectedModel}
                id="create-team-provider-model"
                disableGeminiOption={true}
                modelIssueReasonByValue={
                  selectedModel.trim() ? { [selectedModel.trim()]: leadModelIssueText } : undefined
                }
              />
            </div>
          </div>

          <div className="space-y-2 md:col-span-2">
            <div className="flex items-start gap-2 rounded-md border border-sky-500/20 bg-sky-500/5 px-3 py-2">
              <Info className="mt-0.5 size-3.5 shrink-0 text-sky-400" />
              <p className="text-[11px] leading-relaxed text-sky-300">
                当前为目录工作空间模式：团队不再预置固定成员，目录中的文件就是团队长期记忆；启动后由负责人按任务动态生成子
                agent。
              </p>
            </div>
            {hasTemplateSource ? (
              <div className="flex items-start gap-2 rounded-md border border-violet-500/20 bg-violet-500/5 px-3 py-2">
                <Info className="mt-0.5 size-3.5 shrink-0 text-violet-400" />
                <p className="text-[11px] leading-relaxed text-violet-300">
                  已应用团队模板：模板自带的 skills / memory
                  文件会复制到工作目录；模板里的成员不会预置，由负责人按需创建。
                </p>
              </div>
            ) : null}
          </div>

          <div
            className="rounded-lg border border-[var(--color-border-emphasis)] p-4 shadow-sm md:col-span-2"
            style={{
              backgroundColor: isLight
                ? 'color-mix(in srgb, var(--color-surface-overlay) 24%, white 76%)'
                : 'var(--color-surface-overlay)',
            }}
          >
            <div className="space-y-4">
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

              <OptionalSettingsSection
                title="可选启动设置"
                description="需要时可在这里配置提示词、安全策略和 CLI 覆盖参数。"
                summary={launchOptionalSummary}
              >
                <div className="space-y-4">
                  {selectedProviderId === 'anthropic' ? (
                    <div className="space-y-2">
                      <AnthropicFastModeSelector
                        value={selectedFastMode}
                        onValueChange={setSelectedFastMode}
                        providerFastModeDefault={anthropicProviderFastModeDefault}
                        model={selectedModel}
                        limitContext={limitContext}
                        id="create-fast-mode"
                      />
                      {anthropicRuntimeNotice ? (
                        <div className="bg-amber-500/8 flex items-start gap-2 rounded-md border border-amber-500/25 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
                          <Info className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
                          <p>{anthropicRuntimeNotice}</p>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="space-y-1.5">
                    <Label htmlFor="team-prompt" className="label-optional">
                      团队负责人提示词（可选）
                    </Label>
                    <MentionableTextarea
                      id="team-prompt"
                      className="text-xs"
                      minRows={3}
                      maxRows={12}
                      value={prompt}
                      onValueChange={promptDraft.setValue}
                      suggestions={mentionSuggestions}
                      teamSuggestions={teamMentionSuggestions}
                      taskSuggestions={taskSuggestions}
                      projectPath={effectiveCwd || null}
                      chips={promptChipDraft.chips}
                      onChipRemove={promptChipDraft.removeChip}
                      onFileChipInsert={promptChipDraft.addChip}
                      placeholder="填写给团队负责人的启动说明..."
                      footerRight={
                        promptDraft.isSaved ? (
                          <span className="text-[10px] text-[var(--color-text-muted)]">已保存</span>
                        ) : null
                      }
                    />
                  </div>

                  <SkipPermissionsCheckbox
                    id="create-skip-permissions"
                    checked={skipPermissions}
                    onCheckedChange={setSkipPermissions}
                  />

                  <AdvancedCliSection
                    teamName={advancedKey}
                    internalArgs={internalArgs}
                    worktreeEnabled={worktreeEnabled}
                    onWorktreeEnabledChange={setWorktreeEnabled}
                    worktreeName={worktreeName}
                    onWorktreeNameChange={setWorktreeName}
                    customArgs={customArgs}
                    onCustomArgsChange={setCustomArgs}
                  />
                </div>
              </OptionalSettingsSection>
            </div>
          </div>

          <div className="md:col-span-2">
            <OptionalSettingsSection
              title="可选团队信息"
              description="默认流程保持简洁；当你需要补充上下文或自定义颜色时再展开。"
              summary={teamDetailsSummary}
            >
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="team-description" className="label-optional">
                    描述（可选）
                  </Label>
                  <AutoResizeTextarea
                    id="team-description"
                    className="text-xs"
                    minRows={2}
                    maxRows={8}
                    value={description}
                    onChange={(event) => descriptionDraft.setValue(event.target.value)}
                    placeholder="简要说明团队目标和职责"
                  />
                  {descriptionDraft.isSaved ? (
                    <span className="text-[10px] text-[var(--color-text-muted)]">已保存</span>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <Label className="label-optional">颜色（可选）</Label>
                  <div className="flex flex-wrap gap-2">
                    {TEAM_COLOR_NAMES.map((colorName) => {
                      const colorSet = getTeamColorSet(colorName);
                      const isSelected = teamColor === colorName;
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
                          onClick={() => setTeamColor(isSelected ? '' : colorName)}
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
              </div>
            </OptionalSettingsSection>
          </div>
        </div>

        {activeError ? (
          <p
            className="rounded border p-2 text-xs"
            style={{
              color: 'var(--field-error-text)',
              borderColor: 'var(--field-error-border)',
              backgroundColor: 'var(--field-error-bg)',
            }}
          >
            {activeError}
          </p>
        ) : null}

        <DialogFooter className="pt-4 sm:justify-between">
          <div className="min-w-0">
            {canCreate &&
            (effectivePrepare.state === 'idle' || effectivePrepare.state === 'loading') ? (
              <>
                <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                  <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  <div>
                    <span>
                      {effectivePrepare.message ??
                        (effectivePrepare.state === 'idle'
                          ? '正在预热 CLI 环境...'
                          : '正在准备环境...')}
                    </span>
                    <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)] opacity-70">
                      启动前检测：提前发现并阻断潜在错误
                    </p>
                  </div>
                </div>
                <ProvisioningProviderStatusList checks={prepareChecks} className="mt-2" />
              </>
            ) : null}

            {canCreate && effectivePrepare.state === 'ready' ? (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                  <CheckCircle2 className="size-3.5 shrink-0" />
                  <span>
                    {prepareChecks.some((check) => check.status === 'notes') ||
                    prepareWarnings.length > 0
                      ? 'CLI 环境已就绪（含提示）'
                      : 'CLI 环境已就绪'}
                  </span>
                </div>
                {effectivePrepare.message ? (
                  <p className="mt-0.5 pl-5 text-[11px] text-[var(--color-text-muted)]">
                    {effectivePrepare.message}
                  </p>
                ) : null}
                <ProvisioningProviderStatusList checks={prepareChecks} className="mt-1" />
                {prepareWarnings.length > 0 && prepareChecks.length === 0 ? (
                  <div className="mt-0.5 space-y-0.5 pl-5">
                    {prepareWarnings.map((warning) => (
                      <p key={warning} className="text-[11px] text-sky-300">
                        {warning}
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {canCreate && effectivePrepare.state === 'failed' ? (
              <div className="text-xs">
                <div className="flex items-start gap-2 text-red-300">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium">CLI 环境不可用，已阻止启动</p>
                    <p className="mt-0.5 text-red-300/80">
                      {effectivePrepare.message ?? '环境准备失败'}
                    </p>
                    <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)] opacity-70">
                      启动前检测：提前发现并阻断潜在错误
                    </p>
                  </div>
                </div>
                {!shouldHideProvisioningProviderStatusList(prepareChecks, prepareMessage) ? (
                  <ProvisioningProviderStatusList
                    checks={prepareChecks}
                    className="mt-2"
                    suppressDetailsMatching={prepareMessage}
                  />
                ) : null}
                {prepareWarnings.length > 0 && prepareChecks.length === 0 ? (
                  <div className="mt-1 space-y-0.5 pl-6">
                    {prepareWarnings.map((warning) => (
                      <p
                        key={warning}
                        className="text-[11px]"
                        style={{ color: 'var(--warning-text)' }}
                      >
                        {warning}
                      </p>
                    ))}
                  </div>
                ) : null}
                <p className="mt-1 pl-6 text-[11px] text-[var(--color-text-muted)]">
                  {getProvisioningFailureHint(effectivePrepare.message, prepareChecks)}
                </p>
              </div>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {canOpenExistingTeam ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onOpenTeam(request.teamName);
                  onClose();
                }}
              >
                打开已有团队
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={onClose}>
              关闭
            </Button>
            <Button
              size="sm"
              disabled={!canCreate || !draftLoaded || isSubmitting || hasCreateFormErrors}
              onClick={handleSubmit}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  创建中...
                </>
              ) : effectivePrepare.state === 'idle' || effectivePrepare.state === 'loading' ? (
                '跳过预检并创建'
              ) : (
                '创建'
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
