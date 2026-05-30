import { useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@renderer/api';
import { useStore } from '@renderer/store';
import { isTeamProvisioningActive } from '@renderer/store/slices/teamSlice';
import { useShallow } from 'zustand/react/shallow';

import type { GlobalProvider } from '@shared/types';
import type { CcAgentType } from '@shared/types/ccConnect';

type SavePhase = 'idle' | 'saving' | 'restarting' | 'done';

export interface UseTeamEditFormReturn {
  loading: boolean;
  isProvisioning: boolean;
  name: string;
  setName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  agentType: string;
  setAgentType: (v: string) => void;
  permissionMode: string;
  setPermissionMode: (v: string) => void;
  workDir: string;
  setWorkDir: (v: string) => void;
  language: string;
  setLanguage: (v: string) => void;
  managedSources: string;
  setManagedSources: (v: string) => void;
  feishuAllowFrom: string;
  setFeishuAllowFrom: (v: string) => void;
  disabledCommandsInput: string;
  setDisabledCommandsInput: (v: string) => void;
  providerRef: string;
  setProviderRef: (v: string) => void;
  showContextIndicator: boolean;
  setShowContextIndicator: (v: boolean) => void;
  replyFooter: boolean;
  setReplyFooter: (v: boolean) => void;
  injectSender: boolean;
  setInjectSender: (v: boolean) => void;
  color: string;
  compatibleProviders: GlobalProvider[];
  canDelete: boolean;
  /** Current phase of the save+restart lifecycle */
  savePhase: SavePhase;
  /** true while saving or restarting (button spinner / disable) */
  saving: boolean;
  error: string | null;
  clearError: () => void;
  handleSave: () => void;
}

const PERMISSION_MODE_OPTIONS = [
  { value: 'default', label: '默认' },
  { value: 'acceptEdits', label: '自动接受编辑' },
  { value: 'bypassPermissions', label: '跳过权限确认' },
  { value: 'plan', label: '计划模式' },
] as const;

export { PERMISSION_MODE_OPTIONS };

export function useTeamEditForm(teamName: string, open: boolean): UseTeamEditFormReturn {
  // ── Store reads ──────────────────────────────────────────────
  const { data, fetchTeams, selectTeam } = useStore(
    useShallow((s) => ({
      data: s.selectedTeamName === teamName ? s.selectedTeamData : null,
      fetchTeams: s.fetchTeams,
      selectTeam: s.selectTeam,
    }))
  );
  const isProvisioning = useStore((s) => isTeamProvisioningActive(s, teamName));

  // ── Derived defaults ─────────────────────────────────────────
  const rawSettings = useMemo(
    () => (data?.settings ?? {}) as Record<string, unknown>,
    [data?.settings]
  );

  const defaults = useMemo(() => {
    const cfg = data?.config;
    const d = data as Record<string, unknown> | null;
    return {
      name: cfg?.name ?? '',
      description: cfg?.description ?? '',
      color: cfg?.color ?? '',
      agentType: cfg?.agentType ?? (d?.harness as string | undefined) ?? 'cursor',
      workDir: (d?.workDir as string | undefined) ?? cfg?.projectPath ?? '',
      permissionMode: cfg?.permissionMode ?? (d?.permissionMode as string | undefined) ?? 'default',
      language:
        cfg?.language ?? (typeof rawSettings.language === 'string' ? rawSettings.language : 'zh'),
      managedSources:
        cfg?.managedSources ??
        (typeof rawSettings.admin_from === 'string' ? rawSettings.admin_from : '*'),
      disabledCommands: Array.isArray(cfg?.disabledCommands)
        ? cfg.disabledCommands
        : Array.isArray(rawSettings.disabled_commands)
          ? (rawSettings.disabled_commands as unknown[]).filter(
              (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0
            )
          : [],
      platformAllowFrom:
        cfg?.platformAllowFrom ??
        (typeof rawSettings.platform_allow_from === 'object' &&
        rawSettings.platform_allow_from !== null &&
        !Array.isArray(rawSettings.platform_allow_from)
          ? (rawSettings.platform_allow_from as Record<string, string>)
          : {}),
      providerRefs: data?.providerRefs ?? [],
      globalProviders: data?.globalProviders ?? [],
      showContextIndicator:
        cfg?.showContextIndicator ??
        (typeof rawSettings.show_context_indicator === 'boolean'
          ? rawSettings.show_context_indicator
          : true),
      replyFooter:
        cfg?.replyFooter ??
        (typeof rawSettings.reply_footer === 'boolean' ? rawSettings.reply_footer : true),
      injectSender:
        cfg?.injectSender ??
        (typeof rawSettings.inject_sender === 'boolean' ? rawSettings.inject_sender : false),
    };
  }, [data, rawSettings]);

  // ── Local form state ─────────────────────────────────────────
  const [name, setName] = useState(defaults.name);
  const [description, setDescription] = useState(defaults.description);
  const [agentType, setAgentType] = useState(defaults.agentType);
  const [permissionMode, setPermissionMode] = useState(defaults.permissionMode);
  const [workDir, setWorkDir] = useState(defaults.workDir);
  const [language, setLanguage] = useState(defaults.language);
  const [managedSources, setManagedSources] = useState(defaults.managedSources);
  const [disabledCommandsInput, setDisabledCommandsInput] = useState(
    defaults.disabledCommands.join(', ')
  );
  const [feishuAllowFrom, setFeishuAllowFrom] = useState(defaults.platformAllowFrom.feishu ?? '*');
  const [providerRef, setProviderRef] = useState(defaults.providerRefs[0] ?? '');
  const [showContextIndicator, setShowContextIndicator] = useState(defaults.showContextIndicator);
  const [replyFooter, setReplyFooter] = useState(defaults.replyFooter);
  const [injectSender, setInjectSender] = useState(defaults.injectSender);

  // ── Single async lifecycle state ─────────────────────────────
  const [savePhase, setSavePhase] = useState<SavePhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const saving = savePhase === 'saving' || savePhase === 'restarting';

  // ── Refs ─────────────────────────────────────────────────────
  const defaultsRef = useRef(defaults);
  if (defaults.name) {
    defaultsRef.current = defaults;
  }

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
    setName(d.name);
    setDescription(d.description);
    setAgentType(d.agentType);
    setPermissionMode(d.permissionMode);
    setWorkDir(d.workDir);
    setLanguage(d.language);
    setManagedSources(d.managedSources);
    setDisabledCommandsInput(d.disabledCommands.join(', '));
    setFeishuAllowFrom(d.platformAllowFrom.feishu ?? '*');
    setProviderRef(d.providerRefs[0] ?? '');
    setShowContextIndicator(d.showContextIndicator);
    setReplyFooter(d.replyFooter);
    setInjectSender(d.injectSender);
  }, [open]);

  // ── Computed values ──────────────────────────────────────────
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
  const canDelete = teamName !== 'default' && teamName !== 'my-project';

  // ── Actions ──────────────────────────────────────────────────
  const clearError = (): void => setError(null);

  const handleSave = (): void => {
    if (!name.trim()) {
      setError('团队名称不能为空');
      return;
    }
    if (savePhase !== 'idle') return;

    const disabledCommands = disabledCommandsInput
      .split(',')
      .map((e) => e.trim())
      .filter((e) => e.length > 0);
    const feishu = feishuAllowFrom.trim();

    setSavePhase('saving');
    setError(null);

    void (async () => {
      try {
        await api.teams.updateConfig(teamName, {
          name: name.trim(),
          description: description.trim(),
          color: defaultsRef.current.color,
          agentType: agentType.trim() || undefined,
          workDir: workDir.trim() || undefined,
          permissionMode: permissionMode.trim() || undefined,
          showContextIndicator,
          replyFooter,
          injectSender,
          language: language.trim() || undefined,
          managedSources: managedSources.trim() || undefined,
          disabledCommands,
          platformAllowFrom: feishu ? { feishu } : {},
          providerRefs: providerRef ? [providerRef] : [],
        });

        setSavePhase('restarting');
        await api.ccSettings.restart();

        await Promise.all([fetchTeams(), selectTeam(teamName)]);
        setSavePhase('done');
      } catch (err) {
        setError(err instanceof Error ? err.message : '保存失败');
        setSavePhase('idle');
      }
    })();
  };

  return {
    loading: !data,
    isProvisioning,
    name,
    setName,
    description,
    setDescription,
    agentType,
    setAgentType,
    permissionMode,
    setPermissionMode,
    workDir,
    setWorkDir,
    language,
    setLanguage,
    managedSources,
    setManagedSources,
    feishuAllowFrom,
    setFeishuAllowFrom,
    disabledCommandsInput,
    setDisabledCommandsInput,
    providerRef,
    setProviderRef,
    showContextIndicator,
    setShowContextIndicator,
    replyFooter,
    setReplyFooter,
    injectSender,
    setInjectSender,
    color: defaults.color,
    compatibleProviders,
    canDelete,
    savePhase,
    saving,
    error,
    clearError,
    handleSave,
  };
}
