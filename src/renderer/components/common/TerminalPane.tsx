/**
 * TerminalPane - Reusable xterm.js terminal pane.
 *
 * Extracted from SystemManagerView so any team or panel can embed
 * a terminal connected to a PTY process.
 *
 * Lifecycle:
 *  - Mount: creates Terminal + FitAddon, registers SSE listeners
 *  - `spawn()` call or autoSpawn: starts a CLI process via the terminal API
 *  - Unmount: kills PTY, disposes terminal
 */
import React, { useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';

import { api } from '@renderer/api';
import { cn } from '@renderer/lib/utils';

// =============================================================================
// Types
// =============================================================================

export interface TerminalSpawnOptions {
  command: string;
  args: string[];
  cwd: string;
}

interface TerminalPaneProps {
  /** Extra class names for the container */
  className?: string;
  /** Called after a PTY is spawned successfully */
  onSpawned?: (ptyId: string) => void;
  /** Called when the PTY exits */
  onExit?: (ptyId: string, exitCode: number) => void;
  /** Auto-spawn config. When provided, auto-spawns on mount. */
  autoSpawn?: TerminalSpawnOptions;
}

export interface TerminalPaneRef {
  spawn: (options: TerminalSpawnOptions) => Promise<void>;
}

// =============================================================================
// TerminalPane
// =============================================================================

export const TerminalPane = React.forwardRef<TerminalPaneRef, TerminalPaneProps>(
  function TerminalPane({ className, onSpawned, onExit, autoSpawn }, ref) {
    const hostRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const ptyIdRef = useRef<string | null>(null);
    const spawnedRef = useRef(false);

    const fitTerminal = useCallback(() => {
      try {
        fitAddonRef.current?.fit();
        if (ptyIdRef.current && terminalRef.current) {
          api.terminal.resize(ptyIdRef.current, terminalRef.current.cols, terminalRef.current.rows);
        }
      } catch {
        // xterm fit can throw when the element is not measurable yet
      }
    }, []);

    // Expose spawn method via ref
    useImperativeHandle(ref, () => ({
      spawn: async (options: TerminalSpawnOptions) => {
        // Kill existing PTY if any
        if (ptyIdRef.current) {
          try { await api.terminal.kill(ptyIdRef.current); } catch {}
          ptyIdRef.current = null;
        }
        // Clear stale terminal content before spawning new process
        terminalRef.current?.clear();
        try {
          const ptyId = await api.terminal.spawn(options);
          ptyIdRef.current = ptyId;
          spawnedRef.current = true;
          fitTerminal();
          onSpawned?.(ptyId);
        } catch (err) {
          terminalRef.current?.writeln(
            `\x1b[31m[Failed to spawn: ${err instanceof Error ? err.message : String(err)}]\x1b[0m`
          );
        }
      },
    }), [fitTerminal, onSpawned]);

    // Create terminal instance
    useEffect(() => {
      const host = hostRef.current;
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
          cyan: '#67e8f9',
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

      // SSE listeners
      const dataDispose = api.terminal.onData((_event, ptyId, data) => {
        if (ptyId === ptyIdRef.current) term.write(data);
      });
      const exitDispose = api.terminal.onExit((_event, ptyId, exitCode) => {
        if (ptyId === ptyIdRef.current) {
          term.writeln(`\r\n\x1b[90m[process exited with code ${exitCode}]\x1b[0m`);
          onExit?.(ptyId, exitCode);
          ptyIdRef.current = null;
          spawnedRef.current = false;
        }
      });

      // Input forwarding
      const inputDispose = term.onData((data) => {
        if (ptyIdRef.current) api.terminal.write(ptyIdRef.current, data);
      });

      // Resize observer
      const resizeObserver = new ResizeObserver(() => fitTerminal());
      resizeObserver.observe(host);

      return () => {
        dataDispose();
        exitDispose();
        inputDispose.dispose();
        resizeObserver.disconnect();
        if (ptyIdRef.current) {
          void api.terminal.kill(ptyIdRef.current).catch(() => {});
        }
        term.dispose();
        terminalRef.current = null;
        fitAddonRef.current = null;
        ptyIdRef.current = null;
      };
    }, [fitTerminal, onExit]);

    // Auto-spawn
    // Two issues combined to prevent the CLI from ever spawning:
    //  1. React StrictMode mounts → unmounts → remounts. The first mount set
    //     spawnedRef = true and started a 200ms timer; cleanup cleared the timer
    //     but NOT the ref. The second mount saw spawnedRef === true → skipped.
    //  2. The parent passes an inline object literal as autoSpawn, producing a
    //     new reference each render. With the raw object in deps, every render
    //     re-ran the effect, whose cleanup cleared the timeout. spawnedRef was
    //     already true, so the retry path was blocked.
    // Fix: reset spawnedRef in cleanup so StrictMode remount can retry, and use
    // a stable string key derived from autoSpawn content instead of the object.
    const autoSpawnKey = autoSpawn
      ? `${autoSpawn.command}\0${autoSpawn.args.join(',')}\0${autoSpawn.cwd}`
      : undefined;

    useEffect(() => {
      if (!autoSpawnKey || spawnedRef.current) return;
      spawnedRef.current = true;

      const spawnOpts = autoSpawn!;

      const doSpawn = async () => {
        try {
          const ptyId = await api.terminal.spawn(spawnOpts);
          ptyIdRef.current = ptyId;
          fitTerminal();
          onSpawned?.(ptyId);
        } catch (err) {
          terminalRef.current?.writeln(
            `\x1b[31m[Failed to spawn: ${err instanceof Error ? err.message : String(err)}]\x1b[0m`
          );
        }
      };

      const timer = setTimeout(doSpawn, 200);
      return () => {
        clearTimeout(timer);
        spawnedRef.current = false;
      };
      // autoSpawnKey is a stable primitive; autoSpawn is captured via closure.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoSpawnKey, fitTerminal, onSpawned]);

    return (
      <div className={cn('size-full overflow-hidden', className)}>
        <div ref={hostRef} className="size-full" />
      </div>
    );
  }
);
