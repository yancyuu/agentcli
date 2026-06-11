import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@renderer/api';
import { useStore } from '@renderer/store';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { SYSTEM_MANAGER_DISPLAY_NAME } from '@shared/types/team';
import type {
  SystemManagerConfig,
  SystemManagerStatus,
  WorkflowPromptSummary,
} from '@shared/types/systemManager';
import { ExternalLink, Loader2, RefreshCw, TerminalSquare } from 'lucide-react';

import { FolderBrowser } from './FolderBrowser';

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
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchTeams = useStore((state) => state.fetchTeams);

  const load = useCallback(async (): Promise<SystemManagerConfig | null> => {
    setLoading(true);
    setError(null);
    try {
      const [nextStatus, nextConfig] = await Promise.all([
        api.systemManager.getStatus(),
        api.systemManager.getConfig(),
      ]);
      setStatus(nextStatus);
      setConfig(nextConfig);
      setWorkDirInput(nextConfig.selectedWorkDir);
      const candidateFolders = [
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
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openClaudeInSystemTerminal = useCallback(
    async (workDirOverride?: string, args?: string[]) => {
      setStarting(true);
      setError(null);
      try {
        const effectiveWorkDir = workDirOverride ?? workDirInput;
        const nextConfig = await api.systemManager.updateConfig({
          selectedWorkDir: effectiveWorkDir,
        });
        setConfig(nextConfig);
        setWorkDirInput(nextConfig.selectedWorkDir);
        void fetchTeams();
        await api.terminal.openExternal({
          command: 'claude',
          args,
          cwd: nextConfig.selectedWorkDir,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setStarting(false);
      }
    },
    [fetchTeams, workDirInput]
  );

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

  const runWorkflowPrompt = useCallback(
    async (prompt: WorkflowPromptSummary) => {
      if (prompt.commandName) {
        await openClaudeInSystemTerminal(undefined, [prompt.commandName]);
        return;
      }
      const folder = prompt.folder ?? config?.workflowFolder;
      if (!folder) return;
      const result = await api.systemManager.readWorkflowPrompt(folder, prompt.id);
      const content = result.content.trim();
      const args = content.startsWith('/') ? content.split(/\s+/) : ['-p', content];
      await openClaudeInSystemTerminal(undefined, args);
    },
    [config?.workflowFolder, openClaudeInSystemTerminal]
  );

  const titlePath = useMemo(
    () =>
      formatPathForTitle(config?.selectedWorkDir ?? (workDirInput || status?.defaultWorkDir || '')),
    [config?.selectedWorkDir, status?.defaultWorkDir, workDirInput]
  );

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
            disabled={starting}
            onClick={() => void openClaudeInSystemTerminal()}
          >
            {starting ? <Loader2 size={13} className="animate-spin" /> : <ExternalLink size={13} />}
            打开终端
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

        <div className="min-h-0 flex-1 bg-[var(--color-surface)] p-4">
          <div className="flex size-full flex-col justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <div className="space-y-4">
              <div>
                <div className="font-mono text-sm text-[var(--color-text)]">Loop Console</div>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-text-secondary)]">
                  Admin Loop 不再嵌入终端。选择工作区后，点击“打开终端”会在系统默认终端中运行 Claude
                  Code；点击下面的 Loop workflow 会在同一个工作区打开终端并执行对应斜杠命令。
                </p>
              </div>
              <div className="grid gap-2 text-xs text-[var(--color-text-muted)] sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3">
                  Automations：让循环有心跳
                </div>
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3">
                  Worktrees：并行不互相踩文件
                </div>
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3">
                  Skills / Plugins：把意图和工具外置
                </div>
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3">
                  Subagents：实现和验证分离
                </div>
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3">
                  State：状态落盘，循环可恢复
                </div>
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3">
                  Human review：工程师保留判断力
                </div>
              </div>
            </div>

            {(workflowPrompts.length || warnings.length || error || loading) && (
              <div className="mt-6 border-t border-[var(--color-border)] pt-4">
                {workflowPrompts.length ? (
                  <div className="flex flex-wrap gap-2">
                    {workflowPrompts.map((prompt) => (
                      <button
                        key={prompt.id}
                        type="button"
                        className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-1 font-mono text-[11px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-emphasis)] hover:text-[var(--color-text)] disabled:opacity-60"
                        title={prompt.description}
                        disabled={starting}
                        aria-label={`运行 ${prompt.label}${prompt.commandName ? ` (${prompt.commandName})` : ''}`}
                        onClick={() => void runWorkflowPrompt(prompt)}
                      >
                        <span>{prompt.label}</span>
                        {prompt.safety ? (
                          <span className="ml-1 text-[10px] text-[var(--color-text-muted)]">
                            {' '}
                            {prompt.safety}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : null}
                {warnings.length ? (
                  <div className="mt-2 text-xs text-amber-300">{warnings.join('；')}</div>
                ) : null}
                {error ? <div className="mt-2 text-xs text-red-300">{error}</div> : null}
                {loading ? (
                  <div className="mt-2 text-xs text-[var(--color-text-muted)]">
                    加载 Admin Loop 配置中...
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
