import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import '@xterm/xterm/css/xterm.css';

import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { SYSTEM_MANAGER_DISPLAY_NAME } from '@shared/types/team';
import type {
  SystemManagerConfig,
  SystemManagerStatus,
  WorkflowPromptSummary,
} from '@shared/types/systemManager';
import { Loader2, Play, RefreshCw, Square, TerminalSquare } from 'lucide-react';

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

  const [status, setStatus] = useState<SystemManagerStatus | null>(null);
  const [config, setConfig] = useState<SystemManagerConfig | null>(null);
  const [workDirInput, setWorkDirInput] = useState('');
  const [workflowPrompts, setWorkflowPrompts] = useState<WorkflowPromptSummary[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        background: '#0b0b0c',
        foreground: '#e8e8e8',
        cursor: '#f4f4f5',
        selectionBackground: '#3f3f46',
        black: '#09090b',
        red: '#f87171',
        green: '#86efac',
        yellow: '#fde68a',
        blue: '#93c5fd',
        magenta: '#d8b4fe',
        cyan: '#67e8f9',
        white: '#f4f4f5',
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
      if (ptyIdRef.current) api.terminal.kill(ptyIdRef.current);
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      ptyIdRef.current = null;
    };
  }, [fitTerminal]);

  const load = useCallback(async () => {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const startClaude = useCallback(async () => {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      const nextConfig = await api.systemManager.updateConfig({ selectedWorkDir: workDirInput });
      setConfig(nextConfig);
      if (ptyIdRef.current) api.terminal.kill(ptyIdRef.current);
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
  }, [starting, workDirInput, writeTerminalLine]);

  const stopClaude = useCallback(() => {
    if (ptyIdRef.current) {
      api.terminal.kill(ptyIdRef.current);
      ptyIdRef.current = null;
    }
    setRunning(false);
    writeTerminalLine('[stopped]');
  }, [writeTerminalLine]);

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
    <div className="flex size-full flex-col bg-[#171717] p-4 text-zinc-100">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b0c] shadow-2xl shadow-black/40">
        <div className="flex items-center justify-between border-b border-white/10 bg-[#202124] px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="size-3 rounded-full bg-[#ff5f57]" />
            <span className="size-3 rounded-full bg-[#febc2e]" />
            <span className="size-3 rounded-full bg-[#28c840]" />
          </div>
          <div className="flex items-center gap-2 font-mono text-xs text-zinc-300">
            <TerminalSquare size={14} className="text-zinc-400" />
            {SYSTEM_MANAGER_DISPLAY_NAME} — {titlePath || 'loading'}
          </div>
          <div className="text-[11px] text-zinc-500">
            {running ? 'claude running' : (status?.localStatus ?? 'starting')}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-[#141415] px-4 py-3">
          <Input
            value={workDirInput}
            onChange={(event) => setWorkDirInput(event.target.value)}
            className="h-8 min-w-[260px] flex-1 border-white/10 bg-black/30 font-mono text-xs text-zinc-200"
            placeholder="工作目录"
          />
          <Button size="sm" className="h-8" onClick={() => void startClaude()} disabled={starting}>
            {starting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Start Claude
          </Button>
          <Button size="sm" variant="outline" className="h-8 border-white/10" onClick={stopClaude}>
            <Square size={13} /> Stop
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-white/10"
            onClick={() => void load()}
          >
            <RefreshCw size={13} /> Refresh
          </Button>
        </div>

        <div className="min-h-0 flex-1 bg-[#0b0b0c] p-2">
          <div
            ref={terminalHostRef}
            className="size-full overflow-hidden rounded-lg bg-[#0b0b0c]"
          />
        </div>

        {(workflowPrompts.length || warnings.length || error || loading) && (
          <div className="border-t border-white/10 bg-[#141415] px-4 py-3">
            {workflowPrompts.length ? (
              <div className="flex flex-wrap gap-2">
                {workflowPrompts.map((prompt) => (
                  <button
                    key={prompt.id}
                    type="button"
                    className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-mono text-[11px] text-zinc-200 hover:border-zinc-400 hover:bg-white/[0.08]"
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
            {loading ? <div className="mt-2 text-xs text-zinc-500">加载控制台配置中...</div> : null}
          </div>
        )}
      </div>
    </div>
  );
};
