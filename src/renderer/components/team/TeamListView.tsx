import { useCallback, useEffect, useMemo, useState } from 'react';

import { recordRecentProjectOpenPaths } from '@features/recent-projects/renderer';
import { api } from '@renderer/api';
import { confirm } from '@renderer/components/common/ConfirmDialog';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Input } from '@renderer/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@renderer/components/ui/tooltip';
import { getTeamColorSet, getThemedBadge } from '@renderer/constants/teamColors';
import { useBranchSync } from '@renderer/hooks/useBranchSync';
import { useTheme } from '@renderer/hooks/useTheme';
import { useStore } from '@renderer/store';
import {
  getCurrentProvisioningProgressForTeam,
  isTeamProvisioningActive,
} from '@renderer/store/slices/teamSlice';
import {
  getProjectSelectionResetState,
  getWorktreeNavigationState,
} from '@renderer/store/utils/stateResetHelpers';
import { agentAvatarUrl, buildMemberColorMap } from '@renderer/utils/memberHelpers';
import { buildTaskCountsByTeam, normalizePath } from '@renderer/utils/pathNormalize';
import { emitOpenHermitEvent, OPEN_HERMIT_EVENTS } from '@renderer/utils/openHermitEvents';
import { getBaseName } from '@renderer/utils/pathUtils';
import { nameColorSet } from '@renderer/utils/projectColor';
import { formatRelativeTime, formatTokensCompact } from '@renderer/utils/formatters';
import {
  CheckCircle,
  Clock,
  Copy,
  Download,
  FolderOpen,
  GitBranch,
  Loader2,
  Play,
  RotateCcw,
  Search,
  Trash2,
  Users,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { SYSTEM_MANAGER_TEAM_NAME } from '@shared/types/team';

import { CreateTeamDialog } from './dialogs/CreateTeamDialog';
import { LaunchTeamDialog } from './dialogs/LaunchTeamDialog';
import { TeamEmptyState } from './TeamEmptyState';
import { EMPTY_TEAM_FILTER, TeamListFilterPopover } from './TeamListFilterPopover';
import {
  findTeamProjectSelectionTarget,
  resolveTeamProjectSelection,
  teamMatchesProjectSelection,
} from './teamProjectSelection';

import type {
  ResolvedTeamMember,
  TeamCreateRequest,
  TeamLaunchRequest,
  TeamMemberSnapshot,
  TeamSummary,
  TeamSummaryMember,
  TeamTemplateSource,
  TeamTemplateSummary,
} from '@shared/types';
import type { ActiveTeamRef, TeamCopyData } from './dialogs/CreateTeamDialog';
import type { TeamListFilterState } from './TeamListFilterPopover';

function generateUniqueName(sourceName: string, existingNames: string[]): string {
  const base = sourceName.replace(/-\d+$/, '');
  const existing = new Set(existingNames);
  for (let i = 1; ; i++) {
    const candidate = `${base}-${i}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
}

type TeamStatus = 'active' | 'idle' | 'provisioning';

function getRecentProjects(team: TeamSummary): string[] {
  const history = team.projectPathHistory;
  if (!history || history.length === 0) {
    return team.projectPath ? [team.projectPath] : [];
  }
  return history.slice(-3).reverse();
}

function folderName(fullPath: string): string {
  return getBaseName(fullPath) || fullPath;
}

function resolveLaunchDialogMembers(members: readonly TeamMemberSnapshot[]): ResolvedTeamMember[] {
  return members.map((member) => {
    return {
      ...member,
      status: member.currentTaskId ? 'active' : 'idle',
      messageCount: 0,
      lastActiveAt: null,
    };
  });
}

function formatTeamRoleLabel(role: string): string {
  const normalized = role.trim().toLowerCase();
  const labels: Record<string, string> = {
    reviewer: '审查',
    architect: '架构',
    developer: '开发',
    engineer: '工程',
    tester: '测试',
    pm: '产品',
    'product-manager': '产品',
    designer: '设计',
  };
  return labels[normalized] ?? role;
}

function renderMemberChips(members: TeamSummaryMember[], isLight: boolean): React.JSX.Element {
  const teamColorMap = buildMemberColorMap(members);
  return (
    <>
      {members.map((m) => {
        const resolvedColor = teamColorMap.get(m.name);
        const memberColor = resolvedColor ? getTeamColorSet(resolvedColor) : null;
        return (
          <span key={m.name} className="inline-flex items-center gap-1">
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide"
              style={
                memberColor
                  ? {
                      backgroundColor: getThemedBadge(memberColor, isLight),
                      color: memberColor.text,
                      border: `1px solid ${memberColor.border}40`,
                    }
                  : undefined
              }
            >
              {m.name}
            </span>
            {m.role ? (
              <span className="text-[9px] text-[var(--color-text-muted)]">
                {formatTeamRoleLabel(m.role)}
              </span>
            ) : null}
          </span>
        );
      })}
    </>
  );
}

function renderTeamRecentPaths(
  team: TeamSummary,
  status: TeamStatus | null,
  matchesCurrentProject: boolean,
  isLight: boolean
): React.JSX.Element | null {
  const recentPaths = getRecentProjects(team);
  if (recentPaths.length === 0) return null;
  return (
    <div className="mt-2 flex items-center gap-1 text-[10px] text-[var(--color-text-muted)]">
      {matchesCurrentProject ? (
        <span
          className={`inline-flex items-center gap-1 truncate rounded-full px-2 py-0.5 text-[12px] font-medium ${
            isLight ? 'bg-emerald-100 text-emerald-700' : 'bg-emerald-500/15 text-emerald-400'
          }`}
        >
          <FolderOpen size={12} className="shrink-0" />
          {recentPaths.map((p, i) => (
            <span key={p} title={p}>
              {folderName(p)}
              {i < recentPaths.length - 1 ? ', ' : ''}
            </span>
          ))}
        </span>
      ) : (
        <>
          <FolderOpen size={10} className="shrink-0" />
          <span className="truncate">
            {recentPaths.map((p, i) => (
              <span key={p} title={p}>
                {i === 0 && (status === 'active' || status === 'idle') ? (
                  <span className="text-emerald-400">{folderName(p)}</span>
                ) : (
                  folderName(p)
                )}
                {i < recentPaths.length - 1 ? ', ' : ''}
              </span>
            ))}
          </span>
        </>
      )}
    </div>
  );
}

function resolveTeamStatus(
  team: TeamSummary,
  teamName: string,
  aliveTeams: string[],
  currentProgress: ReturnType<typeof getCurrentProvisioningProgressForTeam>,
  leadActivityByTeam: Record<string, string>
): TeamStatus | null {
  if (aliveTeams.includes(teamName)) {
    return leadActivityByTeam[teamName] === 'active' ? 'active' : 'idle';
  }
  if (
    currentProgress &&
    ['validating', 'spawning', 'configuring', 'assembling', 'finalizing', 'verifying'].includes(
      currentProgress.state
    )
  ) {
    return 'provisioning';
  }
  return null;
}

function formatDurationShort(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  if (hours < 24) return `${hours}h ${remainMin}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

const StatusBadge = ({ status }: { status: TeamStatus | null }): React.JSX.Element | null => {
  if (!status) return null;
  switch (status) {
    case 'active':
      return (
        <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
          <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
          活跃
        </span>
      );
    case 'idle':
      return (
        <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
          <span className="size-1.5 rounded-full bg-emerald-400" />
          运行中
        </span>
      );
    case 'provisioning':
      return (
        <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
          <span className="size-1.5 animate-pulse rounded-full bg-amber-400" />
          启动中...
        </span>
      );
  }
};

const PendingDeleteBadge = (): React.JSX.Element => (
  <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
    待重启生效
  </span>
);

export const TeamListView = (): React.JSX.Element => {
  const { isLight } = useTheme();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templateSources, setTemplateSources] = useState<TeamTemplateSource[]>([]);
  const [teamTemplates, setTeamTemplates] = useState<TeamTemplateSummary[]>([]);
  const [newTemplateSourceUrl, setNewTemplateSourceUrl] = useState('');
  const [copyData, setCopyData] = useState<TeamCopyData | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<TeamListFilterState>(EMPTY_TEAM_FILTER);
  const [deletingTeamName, setDeletingTeamName] = useState<string | null>(null);
  const [aliveTeams, setAliveTeams] = useState<string[]>([]);
  const {
    teams,
    teamsLoading,
    teamsError,
    fetchTeams,
    openTeamTab,
    openSystemManager,
    deleteTeam,
    restoreTeam,
    permanentlyDeleteTeam,
    projects,
    globalTasks,
    fetchAllTasks,
    repositoryGroups,
    selectedRepositoryId,
    selectedWorktreeId,
    selectedProjectId,
    activeProjectId,
    branchByPath,
  } = useStore(
    useShallow((s) => ({
      teams: s.teams,
      teamsLoading: s.teamsLoading,
      teamsError: s.teamsError,
      fetchTeams: s.fetchTeams,
      openTeamTab: s.openTeamTab,
      openSystemManager: s.openSystemManager,
      deleteTeam: s.deleteTeam,
      restoreTeam: s.restoreTeam,
      permanentlyDeleteTeam: s.permanentlyDeleteTeam,
      projects: s.projects,
      globalTasks: s.globalTasks,
      fetchAllTasks: s.fetchAllTasks,
      repositoryGroups: s.repositoryGroups,
      selectedRepositoryId: s.selectedRepositoryId,
      selectedWorktreeId: s.selectedWorktreeId,
      selectedProjectId: s.selectedProjectId,
      activeProjectId: s.activeProjectId,
      branchByPath: s.branchByPath,
    }))
  );
  const {
    createTeam,
    launchTeam,
    provisioningErrorByTeam,
    clearProvisioningError,
    provisioningRuns,
    provisioningSnapshotByTeam,
    currentProvisioningRunIdByTeam,
    leadActivityByTeam,
  } = useStore(
    useShallow((s) => ({
      createTeam: s.createTeam,
      launchTeam: s.launchTeam,
      provisioningErrorByTeam: s.provisioningErrorByTeam,
      clearProvisioningError: s.clearProvisioningError,
      provisioningRuns: s.provisioningRuns,
      provisioningSnapshotByTeam: s.provisioningSnapshotByTeam,
      currentProvisioningRunIdByTeam: s.currentProvisioningRunIdByTeam,
      leadActivityByTeam: s.leadActivityByTeam,
    }))
  );
  const canCreate = true;
  const provisioningState = useMemo(
    () => ({ currentProvisioningRunIdByTeam, provisioningRuns }),
    [currentProvisioningRunIdByTeam, provisioningRuns]
  );

  /** Team names currently in active provisioning — prevents name conflicts in create dialog. */
  const provisioningTeamNames = useMemo(() => {
    return Object.keys(currentProvisioningRunIdByTeam).filter((teamName) =>
      isTeamProvisioningActive(provisioningState, teamName)
    );
  }, [currentProvisioningRunIdByTeam, provisioningState]);

  /** Merge real teams with synthetic launching cards for active provisioning. */
  const teamsWithProvisioning = useMemo(() => {
    const existingNames = new Set(teams.map((t) => t.teamName));
    const synthetic = provisioningTeamNames
      .filter((name) => !existingNames.has(name) && provisioningSnapshotByTeam[name])
      .map((name) => provisioningSnapshotByTeam[name]);
    return synthetic.length > 0 ? [...teams, ...synthetic] : teams;
  }, [teams, provisioningTeamNames, provisioningSnapshotByTeam]);

  // Fetch alive teams on mount and when teams list changes
  useEffect(() => {
    let cancelled = false;
    const fetchAlive = async (): Promise<void> => {
      try {
        const list = await api.teams.aliveList();
        if (!cancelled) setAliveTeams(list);
      } catch {
        // best-effort
      }
    };
    void fetchAlive();
    return () => {
      cancelled = true;
    };
  }, [teams]);

  // Refresh alive teams when opening the create dialog so conflict warning is accurate.
  useEffect(() => {
    if (!showCreateDialog) return;
    let cancelled = false;
    void api.teams
      .aliveList()
      .then((list) => {
        if (!cancelled) setAliveTeams(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [showCreateDialog]);

  const currentProjectSelection = useMemo(
    () =>
      resolveTeamProjectSelection({
        repositoryGroups,
        projects,
        selectedRepositoryId,
        selectedWorktreeId,
        selectedProjectId,
        activeProjectId,
      }),
    [
      repositoryGroups,
      projects,
      selectedRepositoryId,
      selectedWorktreeId,
      selectedProjectId,
      activeProjectId,
    ]
  );
  const currentProjectPath = currentProjectSelection.projectPath;

  const filteredTeams = useMemo<TeamSummary[]>(() => {
    let result = teamsWithProvisioning;

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (t) =>
          t.teamName.toLowerCase().includes(q) ||
          t.displayName.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q)
      );
    }

    if (filter.selectedStatuses.size > 0) {
      result = result.filter((t) => {
        const status = resolveTeamStatus(
          t,
          t.teamName,
          aliveTeams,
          getCurrentProvisioningProgressForTeam(provisioningState, t.teamName),
          leadActivityByTeam
        );
        const isRunning = status !== null;
        if (filter.selectedStatuses.has('running') && isRunning) return true;
        return false;
      });
    }

    const matchesCurrentProject = currentProjectPath
      ? (team: TeamSummary): boolean => teamMatchesProjectSelection(team, currentProjectPath)
      : null;

    result = [...result].sort((a, b) => {
      // 0. Project-level system manager is a namespace node, not a regular worker team.
      const managerA = a.teamName === SYSTEM_MANAGER_TEAM_NAME ? 0 : 1;
      const managerB = b.teamName === SYSTEM_MANAGER_TEAM_NAME ? 0 : 1;
      if (managerA !== managerB) return managerA - managerB;

      // 1. Teams related to the selected project are prioritized next.
      if (matchesCurrentProject) {
        const projectA = matchesCurrentProject(a) ? 0 : 1;
        const projectB = matchesCurrentProject(b) ? 0 : 1;
        if (projectA !== projectB) return projectA - projectB;
      }

      // 2. Most recently active teams first.
      const tsA = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
      const tsB = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
      if (tsA !== tsB) return tsB - tsA;

      // 3. Fallback: alphabetical by team name for deterministic order.
      // Runtime liveness is intentionally not part of ordering: aliveTeams is
      // loaded asynchronously after mount, and sorting by it makes cards jump on refresh.
      return a.teamName.localeCompare(b.teamName);
    });

    return result;
  }, [
    teamsWithProvisioning,
    searchQuery,
    currentProjectPath,
    aliveTeams,
    filter,
    provisioningState,
    leadActivityByTeam,
  ]);

  const handleProjectSelectionChange = useCallback(
    (projectPath: string | null): void => {
      if (!projectPath) {
        useStore.setState(getProjectSelectionResetState());
        return;
      }

      const target = findTeamProjectSelectionTarget(repositoryGroups, projects, projectPath);
      if (!target) {
        console.warn('Unable to resolve selected team project path:', projectPath);
        return;
      }

      if (target.kind === 'grouped') {
        useStore.setState(getWorktreeNavigationState(target.repositoryId, target.worktreeId));
        void useStore.getState().fetchSessionsInitial(target.worktreeId);
        recordRecentProjectOpenPaths([projectPath]);
        return;
      }

      useStore.getState().selectProject(target.projectId);
      recordRecentProjectOpenPaths([projectPath]);
    },
    [projects, repositoryGroups]
  );

  // Fetch branches once for all visible team project paths (no live polling)
  const teamPaths = useMemo(
    () => filteredTeams.map((t) => t.projectPath?.trim()).filter(Boolean) as string[],
    [filteredTeams]
  );
  useBranchSync(teamPaths, { live: false });

  const handleDeleteTeam = useCallback(
    (teamName: string, isDraft: boolean, e: React.MouseEvent) => {
      e.stopPropagation();
      void (async () => {
        const teamDisplayName =
          teams.find((team) => team.teamName === teamName)?.displayName || teamName;
        if (isDraft) {
          const confirmed = await confirm({
            title: '删除草稿',
            message: `确定删除草稿数字员工“${teamDisplayName}”吗？此操作无法撤销。`,
            confirmLabel: '删除',
            cancelLabel: '取消',
            variant: 'danger',
          });
          if (confirmed) {
            void api.teams.deleteDraft(teamName).catch(() => {});
          }
          return;
        }
        const confirmed = await confirm({
          title: '删除数字员工',
          message: `确定删除数字员工”${teamDisplayName}”吗？此操作会移除本地配置数据。`,
          confirmLabel: '删除',
          cancelLabel: '取消',
          variant: 'danger',
        });
        if (confirmed) {
          setDeletingTeamName(teamName);
          try {
            const result = await deleteTeam(teamName);
            if (result.restartRequired) {
              await api.ccSettings.restart();
            }
            await fetchTeams();
          } catch (err) {
            console.error('Failed to delete team:', err);
          } finally {
            setDeletingTeamName(null);
          }
        }
      })();
    },
    [deleteTeam, teams, fetchTeams]
  );

  const handleRestoreTeam = useCallback(
    (teamName: string, e: React.MouseEvent) => {
      e.stopPropagation();
      void (async () => {
        try {
          await restoreTeam(teamName);
        } catch {
          // error via store
        }
      })();
    },
    [restoreTeam]
  );

  const handlePermanentlyDeleteTeam = useCallback(
    (teamName: string, e: React.MouseEvent) => {
      e.stopPropagation();
      void (async () => {
        const teamDisplayName =
          teams.find((team) => team.teamName === teamName)?.displayName || teamName;
        const confirmed = await confirm({
          title: '永久删除',
          message: `确定永久删除团队“${teamDisplayName}”吗？所有数据都将丢失。`,
          confirmLabel: '永久删除',
          cancelLabel: '取消',
          variant: 'danger',
        });
        if (confirmed) {
          try {
            await permanentlyDeleteTeam(teamName);
          } catch {
            // error via store
          }
        }
      })();
    },
    [permanentlyDeleteTeam, teams]
  );

  const handleCopyTeam = useCallback(
    (teamName: string, e: React.MouseEvent) => {
      e.stopPropagation();
      void (async () => {
        try {
          const data = await api.teams.getData(teamName);
          const existingNames = teams.map((t) => t.teamName);
          const uniqueName = generateUniqueName(teamName, existingNames);
          setCopyData({
            teamName: uniqueName,
            description: data.config.description,
            color: data.config.color,
          });
          setShowCreateDialog(true);
        } catch {
          // silently ignore — team data may be unavailable
        }
      })();
    },
    [teams]
  );

  const [launchingTeamName, setLaunchingTeamName] = useState<string | null>(null);
  const [launchDialogOpen, setLaunchDialogOpen] = useState(false);
  const [launchDialogTeamName, setLaunchDialogTeamName] = useState('');
  const [launchDialogMembers, setLaunchDialogMembers] = useState<ResolvedTeamMember[]>([]);
  const [launchDialogDefaultPath, setLaunchDialogDefaultPath] = useState<string | undefined>();

  const handleLaunchTeam = useCallback(
    async (teamName: string, projectPath: string | undefined, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!projectPath) return;
      try {
        const data = await api.teams.getData(teamName);
        setLaunchDialogTeamName(teamName);
        setLaunchDialogMembers(resolveLaunchDialogMembers(data.members ?? []));
        setLaunchDialogDefaultPath(data.config.projectPath ?? projectPath);
        setLaunchDialogOpen(true);
      } catch (err) {
        // Draft teams (no config.json) throw TEAM_DRAFT — expected, use fallback
        if (!(err instanceof Error && err.message.includes('TEAM_DRAFT'))) {
          console.error('Failed to load team data for launch dialog:', err);
        }
        // Fallback: open dialog with minimal data
        setLaunchDialogTeamName(teamName);
        setLaunchDialogMembers([]);
        setLaunchDialogDefaultPath(projectPath);
        setLaunchDialogOpen(true);
      }
    },
    []
  );

  const handleLaunchSubmit = useCallback(
    async (request: TeamLaunchRequest) => {
      setLaunchingTeamName(request.teamName);
      try {
        await launchTeam(request);
        await Promise.all([fetchTeams(), fetchAllTasks()]);
      } catch (err) {
        console.error('Failed to launch team:', err);
        throw err;
      } finally {
        setLaunchingTeamName(null);
      }
    },
    [fetchAllTasks, fetchTeams, launchTeam]
  );

  useEffect(() => {
    void fetchTeams();
    void fetchAllTasks();
  }, [fetchTeams, fetchAllTasks]);

  useEffect(() => {
    const refresh = () => {
      void fetchTeams();
      void fetchAllTasks();
    };
    window.addEventListener(OPEN_HERMIT_EVENTS.runtimeRestarted, refresh);
    window.addEventListener(OPEN_HERMIT_EVENTS.teamsChanged, refresh);
    return () => {
      window.removeEventListener(OPEN_HERMIT_EVENTS.runtimeRestarted, refresh);
      window.removeEventListener(OPEN_HERMIT_EVENTS.teamsChanged, refresh);
    };
  }, [fetchTeams, fetchAllTasks]);

  const taskCountsByTeam = useMemo(() => buildTaskCountsByTeam(globalTasks), [globalTasks]);

  const activeTeams = useMemo<ActiveTeamRef[]>(() => {
    const aliveSet = new Set(aliveTeams);
    return teams
      .filter((t) => aliveSet.has(t.teamName) && t.projectPath)
      .map((t) => ({
        teamName: t.teamName,
        displayName: t.displayName,
        projectPath: t.projectPath!,
      }));
  }, [teams, aliveTeams]);

  const handleCreateDialogClose = useCallback(() => {
    setShowCreateDialog(false);
    setCopyData(null);
  }, []);

  const loadTemplates = useCallback(async (refresh = false): Promise<void> => {
    setTemplateLoading(true);
    setTemplateError(null);
    try {
      const snapshot = refresh
        ? await api.teams.refreshTemplateSources()
        : await api.teams.listTemplateSources();
      setTemplateSources(snapshot.sources);
      setTeamTemplates(snapshot.templates);
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : '读取团队模板失败');
    } finally {
      setTemplateLoading(false);
    }
  }, []);

  const openTemplateDialog = useCallback((): void => {
    setShowTemplateDialog(true);
    void loadTemplates(false);
  }, [loadTemplates]);

  const handleAddTemplateSource = useCallback(async (): Promise<void> => {
    const url = newTemplateSourceUrl.trim();
    if (!url) return;
    setTemplateLoading(true);
    setTemplateError(null);
    try {
      const sourceId = url
        .replace(/\.git$/, '')
        .split(/[/:]/)
        .filter(Boolean)
        .slice(-2)
        .join('-')
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-');
      const nextSources: TeamTemplateSource[] = [
        ...templateSources,
        {
          id: sourceId || `source-${Date.now().toString(36)}`,
          name: sourceId || '自定义模板源',
          url,
          enabled: true,
          branch: 'main',
        },
      ];
      const saved = await api.teams.saveTemplateSources(nextSources);
      setTemplateSources(saved.sources);
      const refreshed = await api.teams.refreshTemplateSources();
      setTemplateSources(refreshed.sources);
      setTeamTemplates(refreshed.templates);
      setNewTemplateSourceUrl('');
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : '添加模板源失败');
    } finally {
      setTemplateLoading(false);
    }
  }, [newTemplateSourceUrl, templateSources]);

  const handleRemoveTemplateSource = useCallback(
    async (source: TeamTemplateSource): Promise<void> => {
      if (source.isDefault) return;
      setTemplateLoading(true);
      setTemplateError(null);
      try {
        const saved = await api.teams.saveTemplateSources(
          templateSources.filter((item) => item.id !== source.id)
        );
        setTemplateSources(saved.sources);
        setTeamTemplates(saved.templates);
      } catch (error) {
        setTemplateError(error instanceof Error ? error.message : '删除模板源失败');
      } finally {
        setTemplateLoading(false);
      }
    },
    [templateSources]
  );

  const handleUseTemplate = useCallback(
    (template: TeamTemplateSummary): void => {
      setCopyData({
        teamName: generateUniqueName(
          template.templateId,
          teams.map((team) => team.teamName)
        ),
        description: template.description,
        color: template.color,
        providerId: template.providerId ?? 'anthropic',
        model: template.model,
        effort: template.effort,
        fastMode: template.fastMode,
        limitContext: template.limitContext,
        skipPermissions: template.skipPermissions,
        templateSourceId: template.sourceId,
        templateDirectoryId: template.templateDirectoryId,
      });
      setShowTemplateDialog(false);
      setShowCreateDialog(true);
    },
    [teams]
  );

  const handleCreateSubmit = useCallback(
    async (request: TeamCreateRequest) => {
      await createTeam(request);
      await Promise.all([fetchTeams(), fetchAllTasks()]);
      emitOpenHermitEvent(OPEN_HERMIT_EVENTS.teamsChanged);
      window.setTimeout(() => {
        void fetchTeams();
        void fetchAllTasks();
      }, 1200);
    },
    [createTeam, fetchAllTasks, fetchTeams]
  );

  const createDialogElement = (
    <CreateTeamDialog
      open={showCreateDialog}
      canCreate={canCreate}
      provisioningErrorsByTeam={provisioningErrorByTeam}
      clearProvisioningError={clearProvisioningError}
      existingTeamNames={teams.map((t) => t.teamName)}
      existingBindProjects={teams.map((t) => t.bindProject).filter(Boolean) as string[]}
      provisioningTeamNames={provisioningTeamNames}
      activeTeams={activeTeams}
      initialData={copyData ?? undefined}
      defaultProjectPath={currentProjectPath}
      onClose={handleCreateDialogClose}
      onCreate={handleCreateSubmit}
      onOpenTeam={openTeamTab}
    />
  );

  const launchDialogElement = (
    <LaunchTeamDialog
      mode="launch"
      open={launchDialogOpen}
      teamName={launchDialogTeamName}
      members={launchDialogMembers}
      defaultProjectPath={launchDialogDefaultPath}
      provisioningError={provisioningErrorByTeam[launchDialogTeamName] ?? null}
      clearProvisioningError={clearProvisioningError}
      activeTeams={activeTeams}
      onClose={() => setLaunchDialogOpen(false)}
      onLaunch={handleLaunchSubmit}
    />
  );

  const templateDialogElement = (
    <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-sm">从模板创建数字员工</DialogTitle>
          <DialogDescription className="text-xs">
            从团队模板仓库读取可复用团队。默认源为 Hermit 官方团队模板
            https://github.com/yancyuu/HermitTeams.git，仓库根目录下含有 hermit-team.json
            的一级目录会被识别为模板。
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <label className="text-[11px] font-medium text-[var(--color-text-secondary)]">
                添加模板源
              </label>
              <Input
                className="h-8 text-xs"
                value={newTemplateSourceUrl}
                onChange={(event) => setNewTemplateSourceUrl(event.target.value)}
                placeholder="https://github.com/yancyuu/HermitTeams.git"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={templateLoading || !newTemplateSourceUrl.trim()}
              onClick={() => void handleAddTemplateSource()}
            >
              添加并刷新
            </Button>
          </div>
          {templateSources.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {templateSources.map((source) => (
                <span
                  key={source.id}
                  className="inline-flex max-w-full items-center gap-1 rounded bg-[var(--color-surface-raised)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]"
                  title={source.url}
                >
                  <span className="max-w-44 truncate">
                    {source.name}
                    {source.isDefault ? ' · 默认' : ''}
                    {source.lastError ? ' · 同步失败' : ''}
                  </span>
                  {!source.isDefault ? (
                    <button
                      type="button"
                      className="-mr-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded text-[var(--color-text-muted)] transition-colors hover:bg-red-500/10 hover:text-red-300"
                      aria-label={`删除模板源 ${source.name}`}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void handleRemoveTemplateSource(source);
                      }}
                    >
                      <Trash2 size={10} />
                    </button>
                  ) : null}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-[var(--color-text-muted)]">
            {teamTemplates.length > 0 ? `已发现 ${teamTemplates.length} 个模板` : '暂无模板缓存'}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            disabled={templateLoading}
            onClick={() => void loadTemplates(true)}
          >
            <Download size={12} className={templateLoading ? 'animate-pulse' : ''} />
            {templateLoading ? '刷新中...' : '刷新模板源'}
          </Button>
        </div>
        {templateError ? (
          <p className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {templateError}
          </p>
        ) : null}
        <div className="max-h-[56vh] space-y-2 overflow-auto pr-1">
          {teamTemplates.map((template) => (
            <div
              key={`${template.sourceId}:${template.templateId}`}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-medium text-[var(--color-text)]">
                      {template.displayName}
                    </h3>
                    <span className="rounded bg-[var(--color-surface-raised)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">
                      {template.templateId}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-[var(--color-text-muted)]">
                    {template.description || '暂无描述'}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {template.members.map((member) => (
                      <span
                        key={member.name}
                        className="rounded bg-[var(--color-accent-soft)] px-1.5 py-0.5 text-[10px] text-[var(--color-accent)]"
                      >
                        {member.name}
                        {member.role ? ` · ${formatTeamRoleLabel(member.role)}` : ''}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-[10px] text-[var(--color-text-muted)]">
                    来源：{template.sourceName}
                  </p>
                </div>
                <Button
                  size="sm"
                  className="h-7 shrink-0 text-xs"
                  onClick={() => handleUseTemplate(template)}
                >
                  使用模板
                </Button>
              </div>
            </div>
          ))}
          {!templateLoading && teamTemplates.length === 0 ? (
            <div className="rounded-md border border-dashed border-[var(--color-border)] p-6 text-center text-xs text-[var(--color-text-muted)]">
              没有发现模板。请刷新模板源，或确认仓库根目录下存在 */hermit-team.json。
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );

  const renderHeader = (): React.JSX.Element => (
    <div className="mb-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--color-text)]">选择数字员工</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-[var(--color-accent-border)] text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
            onClick={() => void openSystemManager()}
          >
            Admin Loop
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!canCreate}
            onClick={() => setShowCreateDialog(true)}
          >
            创建数字员工
          </Button>
        </div>
      </div>

      {teamsWithProvisioning.length > 0 ? (
        <div className="mt-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
            />
            <Input
              type="text"
              placeholder="搜索数字员工..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 text-xs"
            />
          </div>
          <TeamListFilterPopover
            filter={filter}
            selectedProjectPath={currentProjectPath}
            teams={teamsWithProvisioning}
            aliveTeams={aliveTeams}
            onFilterChange={setFilter}
            onProjectChange={handleProjectSelectionChange}
          />
        </div>
      ) : null}
    </div>
  );

  const renderContent = (): React.JSX.Element => {
    if (teamsLoading) {
      return (
        <div className="flex size-full items-center justify-center text-sm text-[var(--color-text-muted)]">
          正在加载团队...
        </div>
      );
    }

    if (teamsError) {
      return (
        <div className="flex size-full items-center justify-center p-6">
          <div className="text-center">
            <p className="text-sm font-medium text-red-400">数字员工加载失败</p>
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">{teamsError}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => {
                void fetchTeams();
              }}
            >
              重试
            </Button>
          </div>
        </div>
      );
    }

    if (teamsWithProvisioning.length === 0) {
      return (
        <TeamEmptyState
          canCreate={canCreate}
          onCreateTeam={() => setShowCreateDialog(true)}
          onSelectHarness={() => setShowCreateDialog(true)}
        />
      );
    }

    const hasActiveFilters = filter.selectedStatuses.size > 0;
    if (filteredTeams.length === 0 && (searchQuery.trim() || hasActiveFilters)) {
      return (
        <div className="flex items-center justify-center py-12 text-sm text-[var(--color-text-muted)]">
          没有匹配当前筛选条件的数字员工
        </div>
      );
    }

    const activeFiltered = filteredTeams.filter((t) => !t.deletedAt);
    const deletedFiltered = filteredTeams.filter((t) => t.deletedAt);

    return (
      <>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {activeFiltered.map((team) => {
            const status = resolveTeamStatus(
              team,
              team.teamName,
              aliveTeams,
              getCurrentProvisioningProgressForTeam(provisioningState, team.teamName),
              leadActivityByTeam
            );
            const teamColorSet = team.color
              ? getTeamColorSet(team.color)
              : nameColorSet(team.displayName);
            const matchesCurrentProject = currentProjectPath
              ? teamMatchesProjectSelection(team, currentProjectPath)
              : false;
            const isDeleting = deletingTeamName === team.teamName;
            const isSystemManager = team.teamName === SYSTEM_MANAGER_TEAM_NAME;
            return (
              <div
                key={team.teamName}
                role="button"
                tabIndex={0}
                className="group relative flex cursor-pointer flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition-colors hover:border-[var(--color-border-emphasis)] hover:bg-[var(--color-surface-raised)]"
                onClick={
                  isDeleting ? undefined : () => openTeamTab(team.teamName, team.projectPath)
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (!isDeleting) openTeamTab(team.teamName, team.projectPath);
                  }
                }}
              >
                {isDeleting && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-black/60 text-sm text-white">
                    <Loader2 size={16} className="animate-spin" />
                    删除并重启中…
                  </div>
                )}
                <div className="flex flex-1 flex-col">
                  {/* Row 1: Avatar + Name + Status + Actions */}
                  <div className="flex items-center gap-2.5">
                    <img
                      src={agentAvatarUrl(team.teamName)}
                      alt={team.displayName}
                      className="size-8 shrink-0 rounded-md border border-transparent"
                      style={teamColorSet ? { borderColor: teamColorSet.border + '60' } : undefined}
                      draggable={false}
                    />
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <h3 className="min-w-0 truncate text-[13px] font-medium text-[var(--color-text)]">
                        {team.displayName}
                      </h3>
                      {isSystemManager ? (
                        <span className="shrink-0 rounded bg-[var(--color-accent-soft)] px-1.5 py-px text-[9px] font-medium text-[var(--color-accent)]">
                          SYS
                        </span>
                      ) : null}
                      <StatusBadge status={status} />
                      {team.pendingDelete || team.restartRequired ? <PendingDeleteBadge /> : null}
                      {team.projectPath &&
                        (() => {
                          const branch = branchByPath[normalizePath(team.projectPath)];
                          if (!branch) return null;
                          return (
                            <span
                              className="flex shrink-0 items-center gap-1 text-[10px] text-[var(--color-text-muted)] opacity-60"
                              title={branch}
                            >
                              <GitBranch size={9} />
                              <span className="max-w-20 truncate">{branch}</span>
                            </span>
                          );
                        })()}
                    </div>
                    <div className="flex shrink-0 gap-0.5">
                      {!team.pendingCreate && !isSystemManager && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="rounded p-1 text-[var(--color-text-muted)] opacity-0 transition-opacity hover:bg-[var(--color-surface-raised)] hover:!opacity-100 group-hover:opacity-60"
                              onClick={(e) => handleCopyTeam(team.teamName, e)}
                            >
                              <Copy size={13} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">复制数字员工</TooltipContent>
                        </Tooltip>
                      )}
                      {team.teamName !== 'default' &&
                        team.teamName !== 'my-project' &&
                        !isSystemManager && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="rounded p-1 text-[var(--color-text-muted)] opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-400 hover:!opacity-100 group-hover:opacity-60"
                                onClick={(e) =>
                                  handleDeleteTeam(team.teamName, !!team.pendingCreate, e)
                                }
                              >
                                <Trash2 size={13} />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">删除数字员工</TooltipContent>
                          </Tooltip>
                        )}
                    </div>
                  </div>

                  {/* Row 2: Description */}
                  <p className="mt-1.5 line-clamp-1 min-w-0 pl-[42px] text-[11px] leading-snug text-[var(--color-text-muted)]">
                    {team.description || '暂无描述'}
                  </p>

                  {/* Row 3: Stats bar */}
                  <div className="mt-2 flex items-center gap-1.5 pl-[42px] text-[10px] tabular-nums">
                    {team.stats && team.stats.sessions > 0 ? (
                      <>
                        <span className="text-[var(--color-accent)]">
                          {team.stats.sessions} sessions
                        </span>
                        <span className="text-[var(--color-text-muted)] opacity-30">·</span>
                        <span className="text-emerald-400">
                          {formatTokensCompact(team.stats.tokens)}
                        </span>
                        {team.stats.durationMs > 0 && (
                          <>
                            <span className="text-[var(--color-text-muted)] opacity-30">·</span>
                            <span className="text-amber-400">
                              {formatDurationShort(team.stats.durationMs)}
                            </span>
                          </>
                        )}
                      </>
                    ) : (
                      <span className="text-[var(--color-text-muted)] opacity-50">no activity</span>
                    )}
                    {team.lastActivity && (
                      <>
                        <span className="text-[var(--color-text-muted)] opacity-30">·</span>
                        <span className="text-[var(--color-text-muted)]">
                          {formatRelativeTime(team.lastActivity)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {deletedFiltered.length > 0 && (
          <>
            <div className="my-6 flex items-center gap-3">
              <div className="h-px flex-1 bg-[var(--color-border)]" />
              <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                Trash ({deletedFiltered.length})
              </span>
              <div className="h-px flex-1 bg-[var(--color-border)]" />
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {deletedFiltered.map((team) => (
                <div
                  key={team.teamName}
                  className="group relative cursor-default overflow-hidden rounded-lg border border-[var(--color-border)] bg-zinc-800/40 p-4 opacity-60"
                >
                  <Trash2
                    size={64}
                    className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-zinc-400 opacity-[0.06]"
                  />
                  <div className="relative z-10">
                    <div className="flex items-start justify-between">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-[var(--color-text)]">
                          {team.displayName}
                        </h3>
                        <span className="inline-flex items-center gap-1 rounded-full bg-zinc-500/15 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
                          已删除
                        </span>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="shrink-0 rounded p-1 text-[var(--color-text-muted)] opacity-0 transition-opacity hover:bg-emerald-500/10 hover:text-emerald-300 group-hover:opacity-100"
                              onClick={(e) => handleRestoreTeam(team.teamName, e)}
                              aria-label="恢复团队"
                            >
                              <RotateCcw size={14} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">恢复</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="shrink-0 rounded p-1 text-[var(--color-text-muted)] opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-300 group-hover:opacity-100"
                              onClick={(e) => handlePermanentlyDeleteTeam(team.teamName, e)}
                              aria-label="永久删除"
                            >
                              <Trash2 size={14} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">永久删除</TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs text-[var(--color-text-muted)]">
                      {team.description || '暂无描述'}
                    </p>
                    {team.members && team.members.length > 0 && (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        {renderMemberChips(team.members, isLight)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </>
    );
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="size-full overflow-auto p-4">
        {renderHeader()}
        {renderContent()}
        {templateDialogElement}
        {createDialogElement}
        {launchDialogElement}
      </div>
    </TooltipProvider>
  );
};
