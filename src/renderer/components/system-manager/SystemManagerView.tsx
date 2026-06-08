import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import '@xterm/xterm/css/xterm.css';

import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
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
import { Loader2, RefreshCw, TerminalSquare } from 'lucide-react';

import { FolderBrowser } from './FolderBrowser';

interface SystemManagerViewProps {
  isPaneFocused?: boolean;
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
}: SystemManagerViewProps): React.JSX.Element => {
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const autoStartedRef = useRef(false);
  const startClaudeRef = useRef<((workDirOverride?: string) => Promise<void>) | null>(null);

  const [status, setStatus] = useState<SystemManagerStatus | null>(null);
  const [config, setConfig] = useState<SystemManagerConfig | null>(null);
  const [workDirInput, setWorkDirInput] = useState('');
  const [workflowPrompts, setWorkflowPrompts] = useState<WorkflowPromptSummary[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchTeams = useStore((state) => state.fetchTeams);

  const writeTerminalLine = useCallback((line: string) => {
    terminalRef.current?.writeln(`\x1b[90m${line}\x1b[0m`);
  }, []);

  const fitTerminal = useCallback(() => {
    try {
      fitAddonRef.current?.fit();
      if (ptyIdRef.current && terminalRef.current) {
        api.terminal.resize(ptyIdRef.current, terminalRef.current.cols, terminalRef.current.rows);
      }
    } catch {
      // xterm fit can throw when the element is not measurable yet.
    }
  }, []);

  useEffect(() => {
    const host = terminalHostRef.current;
    if (!host) return;

    const term = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.28,
      theme: {
        background: 'var(--color-surface)',
        foreground: 'var(--color-text)',
        cursor: 'var(--color-text)',
        selectionBackground: 'var(--color-border-emphasis)',
        black: 'var(--color-surface-sidebar)',
        red: '#f87171',
        green: '#86efac',
        yellow: '#fde68a',
        blue: 'var(--color-accent)',
        magenta: '#d8b4fe',
        cyan: '#818cf8',
        white: 'var(--color-text)',
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(host);
    terminalRef.current = term;
    fitAddonRef.current = fitAddon;
    fitTerminal();
    term.writeln('\x1b[90m# Hermit 控制台 · 本地 Claude Code PTY\x1b[0m');
    term.writeln('\x1b[90m# 点击 Start Claude 等价于在当前目录运行 claude\x1b[0m');
    term.writeln('');

    const dataDispose = api.terminal.onData((_event, ptyId, data) => {
      if (ptyId === ptyIdRef.current) term.write(data);
    });
    const exitDispose = api.terminal.onExit((_event, ptyId, exitCode) => {
      if (ptyId === ptyIdRef.current) {
        setRunning(false);
        ptyIdRef.current = null;
        term.writeln(`\r\n\x1b[90m[claude exited with code ${exitCode}]\x1b[0m`);
      }
    });
    const inputDispose = term.onData((data) => {
      if (ptyIdRef.current) api.terminal.write(ptyIdRef.current, data);
    });
    const resizeObserver = new ResizeObserver(() => fitTerminal());
    resizeObserver.observe(host);

    return () => {
      dataDispose();
      exitDispose();
      inputDispose.dispose();
      resizeObserver.disconnect();
      if (ptyIdRef.current) {
        void api.terminal.kill(ptyIdRef.current).catch(() => {
          // Component is unmounting; there is no safe UI surface for this lifecycle error.
        });
      }
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      ptyIdRef.current = null;
    };
  }, [fitTerminal]);

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
        nextConfig.workflowFolder,
        joinPath(nextConfig.selectedWorkDir, 'workflows'),
      ].filter((folder): folder is string => Boolean(folder));
      let loadedWorkflow = false;
      for (const folder of candidateFolders) {
        try {
          const workflowResult = await api.systemManager.listWorkflowPrompts(folder);
          setConfig((current) =>
            current ? { ...current, workflowFolder: workflowResult.folder } : current
          );
          setWorkflowPrompts(workflowResult.prompts);
          setWarnings(workflowResult.warnings);
          loadedWorkflow = true;
          break;
        } catch {
          // Common commands are optional; missing folders should not interrupt opening the console.
        }
      }
      if (!loadedWorkflow) {
        setWorkflowPrompts([]);
        setWarnings([]);
      }
      return nextConfig;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const stopClaude = useCallback(async (): Promise<boolean> => {
    const ptyId = ptyIdRef.current;
    if (!ptyId) {
      setRunning(false);
      return true;
    }

    try {
      await api.terminal.kill(ptyId);
      if (ptyIdRef.current === ptyId) {
        ptyIdRef.current = null;
        setRunning(false);
        writeTerminalLine('[stopped]');
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      writeTerminalLine(`[failed to stop claude] ${message}`);
      return false;
    }
  }, [writeTerminalLine]);

  const startClaude = useCallback(
    async (workDirOverride?: string) => {
      setStarting(true);
      setError(null);
      try {
        const stopped = await stopClaude();
        if (!stopped) return;
        const effectiveWorkDir = workDirOverride ?? workDirInput;
        const nextConfig = await api.systemManager.updateConfig({
          selectedWorkDir: effectiveWorkDir,
        });
        setConfig(nextConfig);
        setWorkDirInput(nextConfig.selectedWorkDir);
        void fetchTeams();
        terminalRef.current?.clear();
        writeTerminalLine(`# cd ${nextConfig.selectedWorkDir}`);
        writeTerminalLine('$ claude');
        const ptyId = await api.terminal.spawn({
          cwd: nextConfig.selectedWorkDir,
          cols: terminalRef.current?.cols ?? 120,
          rows: terminalRef.current?.rows ?? 34,
        });
        ptyIdRef.current = ptyId;
        setRunning(true);
        terminalRef.current?.focus();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        writeTerminalLine(`[failed to start claude] ${message}`);
      } finally {
        setStarting(false);
      }
    },
    [fetchTeams, stopClaude, workDirInput, writeTerminalLine]
  );

  useEffect(() => {
    startClaudeRef.current = startClaude;
  }, [startClaude]);

  useEffect(() => {
    void load().then((nextConfig) => {
      if (nextConfig && !autoStartedRef.current) {
        autoStartedRef.current = true;
        void startClaudeRef.current?.(nextConfig.selectedWorkDir);
      }
    });
  }, [load]);

  const refreshConsole = useCallback(async () => {
    // Capture user's current input before load() overwrites it with server config
    const userPath = workDirInput;
    await load();
    await startClaude(userPath || undefined);
  }, [load, startClaude, workDirInput]);

  const runWorkflowPrompt = useCallback(
    async (prompt: WorkflowPromptSummary) => {
      if (!config?.workflowFolder) return;
      if (!ptyIdRef.current) {
        await startClaude();
      }
      const ptyId = ptyIdRef.current;
      if (!ptyId) return;
      const result = await api.systemManager.readWorkflowPrompt(config.workflowFolder, prompt.id);
      writeTerminalLine(`$ # workflow: ${prompt.label}`);
      api.terminal.write(ptyId, `${result.content}\r`);
    },
    [config?.workflowFolder, startClaude, writeTerminalLine]
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
                void startClaude(newPath);
              }
            }}
          />
          <div className="shrink-0 text-[11px] text-[var(--color-text-muted)]">
            {running ? 'claude running' : (status?.localStatus ?? 'starting')}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 shrink-0 border-[var(--color-border)]"
            disabled={starting}
            onClick={() => void refreshConsole()}
          >
            {starting ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            刷新
          </Button>
        </div>

        <div className="min-h-0 flex-1 bg-[var(--color-surface)] p-2">
          <div
            ref={terminalHostRef}
            className="size-full overflow-hidden rounded-lg bg-[var(--color-surface)]"
          />
        </div>

        {(workflowPrompts.length || warnings.length || error || loading) && (
          <div className="border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            {workflowPrompts.length ? (
              <div className="flex flex-wrap gap-2">
                {workflowPrompts.map((prompt) => (
                  <button
                    key={prompt.id}
                    type="button"
                    className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-1 font-mono text-[11px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-emphasis)] hover:text-[var(--color-text)]"
                    disabled={starting}
                    onClick={() => void runWorkflowPrompt(prompt)}
                  >
                    {prompt.label}
                  </button>
                ))}
              </div>
            ) : null}
            {warnings.length ? (
              <div className="mt-2 text-xs text-amber-300">{warnings.join('；')}</div>
            ) : null}
            {error ? <div className="mt-2 text-xs text-red-300">{error}</div> : null}
            {loading ? (
              <div className="mt-2 text-xs text-[var(--color-text-muted)]">加载控制台配置中...</div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};
