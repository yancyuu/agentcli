import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@renderer/api';
import { useStore } from '@renderer/store';
import { Button } from '@renderer/components/ui/button';
import { buildCapabilityPackCommandSuggestions } from '@renderer/utils/slashCommandRegistry';
import { SYSTEM_MANAGER_DISPLAY_NAME, SYSTEM_MANAGER_TEAM_NAME } from '@shared/types/team';
import type { SystemManagerConfig, SystemManagerStatus } from '@shared/types/systemManager';
import { Settings2, TerminalSquare } from 'lucide-react';

import type { MentionSuggestion } from '@renderer/types/mention';

import { LoopConsolePanel } from '../team/loop-console/LoopConsolePanel';
import { RuntimeConfigDialog } from '../team/dialogs/RuntimeConfigDialog';

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

const EMPTY_ADMIN_TASKS: TeamTaskWithKanban[] = [];
const EMPTY_CAPABILITY_PACKS = [] as const;
const NOOP_FETCH_CAPABILITY_PACKS = () => Promise.resolve();

function buildAdminLoopMember(teamData: TeamViewSnapshot | null): ResolvedTeamMember[] {
  const lead = teamData?.members[0];
  return [
    {
      name: SYSTEM_MANAGER_TEAM_NAME,
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
  const [loading, setLoading] = useState(true);
  const [adminTeamData, setAdminTeamData] = useState<TeamViewSnapshot | null>(null);
  const [adminSessions, setAdminSessions] = useState<CcSession[]>([]);
  const [pendingRepliesByMember, setPendingRepliesByMember] = useState<Record<string, number>>({});
  const [bindingDialogOpen, setBindingDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      setAdminTeamData(nextTeamData);
      setAdminSessions(nextSessions);
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

  const adminWorkflowCommandSuggestions = useMemo(
    () => buildCapabilityPackCommandSuggestions(capabilityPacks, 'admin-loop', {}),
    [capabilityPacks]
  );
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
          <div className="ml-auto shrink-0 text-[11px] text-[var(--color-text-muted)]">
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
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--color-surface)] p-4">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
            <div className="rounded-xl border border-indigo-500/20 bg-[var(--color-surface-raised)] p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono text-sm text-[var(--color-text)]">helm 指令台</div>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-text-secondary)]">
                    全局巡检、诊断、复盘、治理和改进提案。团队消息、runtime 注入和派单在 Team Loop
                    指令台。
                  </p>
                </div>
              </div>
              <div className="mt-3 grid gap-2 text-[11px] text-[var(--color-text-muted)] sm:grid-cols-3">
                <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2">
                  作用域：{formatPathForTitle(status?.adminWorkDir ?? '—')}
                </div>
                <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2">
                  命令源：当前工作空间 `.claude/commands`
                </div>
                <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2">
                  默认边界：只读/报告/提案优先
                </div>
              </div>
            </div>

            {(error || loading) && (
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-xs">
                {error ? <div className="text-red-300">{error}</div> : null}
                {loading ? (
                  <div className="text-[var(--color-text-muted)]">加载 Helm Loop 配置中...</div>
                ) : null}
              </div>
            )}

            <LoopConsolePanel
              teamName={SYSTEM_MANAGER_TEAM_NAME}
              members={adminMembers}
              tasks={adminTasks}
              isTeamAlive={status?.localStatus === 'ready'}
              statusLabel={status?.localStatus === 'ready' ? '本地可用' : '本地异常'}
              sessionPendingRecipient={SYSTEM_MANAGER_TEAM_NAME}
              isProvisioning={loading}
              currentLeadSessionId={adminTeamData?.config.leadSessionId}
              leadProjectPath={adminTeamData?.config.projectPath}
              sessions={adminSessions}
              commandSuggestions={adminWorkflowCommandSuggestions}
              slashCommandMode="session"
              pendingRepliesByMember={pendingRepliesByMember}
              onPendingReplyChange={setPendingRepliesByMember}
            />
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
