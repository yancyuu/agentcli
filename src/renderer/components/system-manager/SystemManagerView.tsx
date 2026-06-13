import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@renderer/api';
import { useStore } from '@renderer/store';
import { Button } from '@renderer/components/ui/button';
import {
  buildCapabilityPackCommandSuggestions,
  collectSlashSuggestionAliases,
} from '@renderer/utils/slashCommandRegistry';
import { buildWorkflowCommandSuggestion } from '@renderer/utils/workflowCommandSuggestions';
import { Input } from '@renderer/components/ui/input';
import { SYSTEM_MANAGER_DISPLAY_NAME, SYSTEM_MANAGER_TEAM_NAME } from '@shared/types/team';
import type {
  SystemManagerConfig,
  SystemManagerStatus,
  WorkflowPromptSummary,
} from '@shared/types/systemManager';
import { Loader2, RefreshCw, Settings2, TerminalSquare } from 'lucide-react';

import type { MentionSuggestion } from '@renderer/types/mention';

import { LoopConsolePanel } from '../team/loop-console/LoopConsolePanel';
import { RuntimeConfigDialog } from '../team/dialogs/RuntimeConfigDialog';
import { FolderBrowser } from './FolderBrowser';

import type {
  CcSession,
  ResolvedTeamMember,
  TeamTaskWithKanban,
  TeamViewSnapshot,
} from '@shared/types';

interface SystemManagerViewProps {
  isPaneFocused?: boolean;
  isActive?: boolean;
}

function formatPathForTitle(pathValue: string): string {
  const home = typeof process !== 'undefined' ? process.env.HOME : undefined;
  if (home && pathValue.startsWith(home)) return `~${pathValue.slice(home.length)}`;
  return pathValue;
}

function joinPath(basePath: string, childPath: string): string {
  const trimmedBase = basePath.replace(/[\\/]+$/, '');
  return `${trimmedBase}/${childPath}`;
}

const EMPTY_ADMIN_TASKS: TeamTaskWithKanban[] = [];
const EMPTY_CAPABILITY_PACKS = [] as const;
const NOOP_FETCH_CAPABILITY_PACKS = () => Promise.resolve();

function buildAdminLoopMember(teamData: TeamViewSnapshot | null): ResolvedTeamMember[] {
  const lead = teamData?.members[0];
  return [
    {
      name: lead?.name ?? SYSTEM_MANAGER_DISPLAY_NAME,
      agentId: lead?.agentId,
      status: teamData?.isAlive ? 'active' : 'idle',
      currentTaskId: null,
      taskCount: teamData?.tasks.length ?? 0,
      lastActiveAt: null,
      messageCount: 0,
      color: 'slate',
      agentType: 'admin-loop',
      role: 'Workspace loop manager',
      workflow: lead?.workflow,
      providerId: lead?.providerId,
      model: lead?.model,
      effort: lead?.effort,
      cwd: teamData?.config.projectPath,
      gitBranch: lead?.gitBranch,
      runtimeAdvisory: lead?.runtimeAdvisory,
    },
  ];
}

export const SystemManagerView = ({
  isPaneFocused: _isPaneFocused = false,
  isActive: _isActive = true,
}: SystemManagerViewProps): React.JSX.Element => {
  const [status, setStatus] = useState<SystemManagerStatus | null>(null);
  const [config, setConfig] = useState<SystemManagerConfig | null>(null);
  const [workDirInput, setWorkDirInput] = useState('');
  const [workflowPrompts, setWorkflowPrompts] = useState<WorkflowPromptSummary[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [adminTeamData, setAdminTeamData] = useState<TeamViewSnapshot | null>(null);
  const [adminSessions, setAdminSessions] = useState<CcSession[]>([]);
  const [pendingRepliesByMember, setPendingRepliesByMember] = useState<Record<string, number>>({});
  const [bindingDialogOpen, setBindingDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchTeams = useStore((state) => state.fetchTeams);
  const capabilityPacks = useStore((state) => state.capabilityPacks ?? EMPTY_CAPABILITY_PACKS);
  const fetchCapabilityPacks = useStore(
    (state) => state.fetchCapabilityPacks ?? NOOP_FETCH_CAPABILITY_PACKS
  );

  const load = useCallback(async (): Promise<SystemManagerConfig | null> => {
    setLoading(true);
    setError(null);
    try {
      const [nextStatus, nextConfig] = await Promise.all([
        api.systemManager.getStatus(),
        api.systemManager.getConfig(),
        fetchCapabilityPacks().then(() => undefined),
      ]);
      await api.teams.ensureSystemManager();
      const [nextTeamData, nextSessions] = await Promise.all([
        api.teams.getData(SYSTEM_MANAGER_TEAM_NAME),
        api.teams.getTeamSessions(SYSTEM_MANAGER_TEAM_NAME),
      ]);
      setStatus(nextStatus);
      setConfig(nextConfig);
      setAdminTeamData(nextTeamData);
      setAdminSessions(nextSessions);
      setWorkDirInput(nextConfig.selectedWorkDir);
      const candidateFolders = [
        nextStatus.globalHermitWorkflowFolder,
        joinPath(nextConfig.selectedWorkDir, '.claude/commands'),
        nextConfig.workflowFolder,
        joinPath(nextConfig.selectedWorkDir, 'workflows'),
      ].filter((folder): folder is string => Boolean(folder));
      const seenFolders = new Set<string>();
      const seenPrompts = new Set<string>();
      const nextPrompts: WorkflowPromptSummary[] = [];
      const nextWarnings: string[] = [];
      for (const folder of candidateFolders) {
        if (seenFolders.has(folder)) continue;
        seenFolders.add(folder);
        try {
          const workflowResult = await api.systemManager.listWorkflowPrompts(folder);
          setConfig((current) =>
            current ? { ...current, workflowFolder: workflowResult.folder } : current
          );
          for (const prompt of workflowResult.prompts) {
            const basename = prompt.filename.replace(/\.[^.]+$/, '');
            const key = prompt.commandName ?? basename;
            if (seenPrompts.has(key) || seenPrompts.has(basename)) continue;
            seenPrompts.add(key);
            seenPrompts.add(basename);
            nextPrompts.push(prompt);
          }
          nextWarnings.push(...workflowResult.warnings);
        } catch {
          // Common commands are optional; missing folders should not interrupt opening the console.
        }
      }
      setWorkflowPrompts(nextPrompts);
      setWarnings(nextWarnings);
      return nextConfig;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setLoading(false);
    }
  }, [fetchCapabilityPacks]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshConsole = useCallback(async () => {
    const nextConfig = await load();
    const effectiveWorkDir = workDirInput || nextConfig?.selectedWorkDir;
    if (effectiveWorkDir && effectiveWorkDir !== nextConfig?.selectedWorkDir) {
      const updatedConfig = await api.systemManager.updateConfig({
        selectedWorkDir: effectiveWorkDir,
      });
      setConfig(updatedConfig);
      setWorkDirInput(updatedConfig.selectedWorkDir);
      void fetchTeams();
    }
  }, [fetchTeams, load, workDirInput]);

  const titlePath = useMemo(
    () =>
      formatPathForTitle(config?.selectedWorkDir ?? (workDirInput || status?.defaultWorkDir || '')),
    [config?.selectedWorkDir, status?.defaultWorkDir, workDirInput]
  );
  const adminWorkflowCommandSuggestions = useMemo(() => {
    const workflowSuggestions = [...workflowPrompts]
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
      .map((prompt) => buildWorkflowCommandSuggestion(prompt, 'admin-workflow'));
    const packSuggestions = buildCapabilityPackCommandSuggestions(capabilityPacks, 'admin-loop', {
      forceNamespacedAliases: collectSlashSuggestionAliases(workflowSuggestions),
    });
    return [...workflowSuggestions, ...packSuggestions];
  }, [capabilityPacks, workflowPrompts]);
  const adminMembers = useMemo(() => buildAdminLoopMember(adminTeamData), [adminTeamData]);
  const adminTasks = adminTeamData?.tasks ?? EMPTY_ADMIN_TASKS;

  return (
    <div className="flex size-full flex-col bg-[var(--color-surface)] p-4 text-[var(--color-text)]">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl shadow-black/20">
        <div className="flex min-h-12 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 py-2">
          <div className="flex shrink-0 items-center gap-2">
            <span className="size-3 rounded-full bg-[#ff5f57]" />
            <span className="size-3 rounded-full bg-[#febc2e]" />
            <span className="size-3 rounded-full bg-[#28c840]" />
          </div>
          <div className="flex shrink-0 items-center gap-2 font-mono text-xs text-[var(--color-text-secondary)]">
            <TerminalSquare size={14} className="text-[var(--color-text-muted)]" />
            {SYSTEM_MANAGER_DISPLAY_NAME}
          </div>
          <Input
            value={workDirInput}
            onChange={(event) => setWorkDirInput(event.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void refreshConsole();
            }}
            className="h-8 min-w-[220px] flex-1 border-[var(--color-border)] bg-[var(--color-surface)] font-mono text-xs text-[var(--color-text)]"
            placeholder={titlePath || '工作目录'}
          />
          <FolderBrowser
            value={workDirInput}
            onChange={(newPath) => {
              setWorkDirInput(newPath);
              if (newPath && newPath !== workDirInput) {
                void api.systemManager
                  .updateConfig({ selectedWorkDir: newPath })
                  .then((nextConfig) => {
                    setConfig(nextConfig);
                    setWorkDirInput(nextConfig.selectedWorkDir);
                    void fetchTeams();
                    void load();
                  })
                  .catch((err: unknown) =>
                    setError(err instanceof Error ? err.message : String(err))
                  );
              }
            }}
          />
          <div className="shrink-0 text-[11px] text-[var(--color-text-muted)]">
            {status?.localStatus ?? 'ready'}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 shrink-0 border-[var(--color-border)]"
            onClick={() => setBindingDialogOpen(true)}
          >
            <Settings2 size={13} />
            运行时
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 shrink-0 border-[var(--color-border)]"
            disabled={loading}
            onClick={() => void refreshConsole()}
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            刷新
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--color-surface)] p-4">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
            <div className="rounded-xl border border-indigo-500/20 bg-[var(--color-surface-raised)] p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono text-sm text-[var(--color-text)]">
                    Admin Loop 指令台
                  </div>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-text-secondary)]">
                    全局巡检、诊断、复盘、治理和改进提案。团队消息、runtime 注入和派单在 Team Loop
                    指令台。
                  </p>
                </div>
                <span className="rounded-full border border-[var(--color-border-subtle)] px-2 py-0.5 text-[10px] text-[var(--color-text-muted)]">
                  {workflowPrompts.length} workflows
                </span>
              </div>
              <div className="mt-3 grid gap-2 text-[11px] text-[var(--color-text-muted)] sm:grid-cols-3">
                <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2">
                  作用域：{formatPathForTitle(config?.selectedWorkDir ?? workDirInput)}
                </div>
                <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2">
                  命令源：全局 Hermit / 团队 `.claude/commands` / workflows
                </div>
                <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2">
                  默认边界：只读/报告/提案优先
                </div>
              </div>
            </div>

            {(warnings.length || error || loading) && (
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-xs">
                {warnings.length ? (
                  <div className="text-amber-300">{warnings.join('；')}</div>
                ) : null}
                {error ? <div className="text-red-300">{error}</div> : null}
                {loading ? (
                  <div className="text-[var(--color-text-muted)]">加载 Admin Loop 配置中...</div>
                ) : null}
              </div>
            )}

            <LoopConsolePanel
              teamName={SYSTEM_MANAGER_TEAM_NAME}
              members={adminMembers}
              tasks={adminTasks}
              isTeamAlive={adminTeamData?.isAlive}
              isProvisioning={loading}
              currentLeadSessionId={adminTeamData?.config.leadSessionId}
              leadProjectPath={adminTeamData?.config.projectPath}
              sessions={adminSessions}
              commandSuggestions={adminWorkflowCommandSuggestions}
              slashCommandMode="session"
              pendingRepliesByMember={pendingRepliesByMember}
              onPendingReplyChange={setPendingRepliesByMember}
            />

            {!workflowPrompts.length && !loading ? (
              <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-5 text-center text-sm text-[var(--color-text-muted)]">
                当前没有可用 Admin Loop workflow。Hermit 默认命令会预装到
                `~/.claude/commands/hermit`；团队自定义命令可添加到 `.claude/commands` 或
                workflows。
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <RuntimeConfigDialog
        open={bindingDialogOpen}
        teamName={SYSTEM_MANAGER_TEAM_NAME}
        onClose={() => setBindingDialogOpen(false)}
      />
    </div>
  );
};
