import { spawn as spawnChild } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { stat } from 'node:fs/promises';

import type { PtySpawnOptions } from '@shared/types/terminal';
import * as pty from 'node-pty';

const PYTHON_PTY_BRIDGE = String.raw`
import errno
import os
import pty
import select
import signal
import sys

cmd = sys.argv[1:]
child_pid = None


def terminate(signum, _frame):
    if child_pid:
        try:
            os.kill(child_pid, signum)
        except OSError:
            pass
    sys.exit(128 + signum)


signal.signal(signal.SIGTERM, terminate)
signal.signal(signal.SIGINT, terminate)

child_pid, fd = pty.fork()
if child_pid == 0:
    os.execvpe(cmd[0], cmd, os.environ)

while True:
    try:
        readable, _, _ = select.select([fd, sys.stdin.fileno()], [], [])
    except OSError:
        break

    if fd in readable:
        try:
            data = os.read(fd, 4096)
        except OSError:
            break
        if not data:
            break
        os.write(sys.stdout.fileno(), data)

    if sys.stdin.fileno() in readable:
        try:
            data = os.read(sys.stdin.fileno(), 4096)
        except OSError as err:
            if err.errno == errno.EIO:
                data = b''
            else:
                raise
        if data:
            os.write(fd, data)

try:
    _, status = os.waitpid(child_pid, 0)
except ChildProcessError:
    sys.exit(0)
sys.exit(os.waitstatus_to_exitcode(status))
`;

interface ManagedProcess {
  id: string;
  pid: number;
  command: string;
  args: string[];
  cwd: string;
  createdAt: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: NodeJS.Signals): void;
}

const TERMINAL_KILL_TIMEOUT_MS = 1_500;
const TERMINAL_FORCE_KILL_TIMEOUT_MS = 1_500;

export type TerminalDataEvent = { ptyId: string; data: string };
export type TerminalExitEvent = { ptyId: string; exitCode: number };

export class SystemManagerPtyService extends EventEmitter {
  private readonly sessions = new Map<string, ManagedProcess>();

  async spawn(options: PtySpawnOptions = {}): Promise<string> {
    const command = options.command || 'claude';
    const args = options.args ?? [];
    const cwd = options.cwd || process.cwd();
    const cwdStat = await stat(cwd);
    if (!cwdStat.isDirectory()) {
      throw new Error(`cwd 不是有效目录: ${cwd}`);
    }

    const id = `pty-${randomUUID()}`;
    const env = {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      ...(options.env ?? {}),
    } as Record<string, string>;

    try {
      const proc = pty.spawn(command, args, {
        name: 'xterm-256color',
        cols: options.cols ?? 120,
        rows: options.rows ?? 34,
        cwd,
        env,
      });

      this.sessions.set(id, {
        id,
        pid: proc.pid,
        command,
        args,
        cwd,
        createdAt: new Date().toISOString(),
        write: (data) => proc.write(data),
        resize: (cols, rows) => proc.resize(Math.max(20, cols), Math.max(5, rows)),
        kill: (signal) => proc.kill(signal),
      });

      proc.onData((data) => {
        this.emit('data', { ptyId: id, data } satisfies TerminalDataEvent);
      });
      proc.onExit(({ exitCode }) => {
        if (!this.sessions.delete(id)) return;
        this.emit('exit', { ptyId: id, exitCode } satisfies TerminalExitEvent);
      });
    } catch (err) {
      const child = spawnChild('python3', ['-u', '-c', PYTHON_PTY_BRIDGE, command, ...args], {
        cwd,
        env,
        stdio: 'pipe',
      });
      this.sessions.set(id, {
        id,
        pid: child.pid ?? -1,
        command,
        args,
        cwd,
        createdAt: new Date().toISOString(),
        write: (data) => child.stdin.write(data),
        resize: () => {},
        kill: (signal) => child.kill(signal),
      });
      this.emit('data', {
        ptyId: id,
        data: `[33m[Hermit] node-pty unavailable (${err instanceof Error ? err.message : String(err)}); using python PTY fallback.[0m\r\n`,
      } satisfies TerminalDataEvent);
      child.stdout.on('data', (data) => {
        this.emit('data', { ptyId: id, data: data.toString() } satisfies TerminalDataEvent);
      });
      child.stderr.on('data', (data) => {
        this.emit('data', { ptyId: id, data: data.toString() } satisfies TerminalDataEvent);
      });
      child.on('error', (error) => {
        if (!this.sessions.delete(id)) return;
        this.emit('data', {
          ptyId: id,
          data: `[31m[Hermit] failed to start process: ${error.message}[0m\r\n`,
        } satisfies TerminalDataEvent);
        this.emit('exit', { ptyId: id, exitCode: 1 } satisfies TerminalExitEvent);
      });
      child.on('exit', (exitCode) => {
        if (!this.sessions.delete(id)) return;
        this.emit('exit', { ptyId: id, exitCode: exitCode ?? 0 } satisfies TerminalExitEvent);
      });
    }

    return id;
  }

  write(ptyId: string, data: string): void {
    const session = this.sessions.get(ptyId);
    if (!session) throw new Error(`PTY 不存在: ${ptyId}`);
    session.write(data);
  }

  resize(ptyId: string, cols: number, rows: number): void {
    const session = this.sessions.get(ptyId);
    if (!session) return;
    session.resize(cols, rows);
  }

  async kill(ptyId: string): Promise<void> {
    const session = this.sessions.get(ptyId);
    if (!session) return;

    await new Promise<void>((resolve) => {
      let settled = false;
      let forceTimer: ReturnType<typeof setTimeout> | null = null;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        if (forceTimer) clearTimeout(forceTimer);
        this.off('exit', onExit);
        resolve();
      };
      const onExit = (event: TerminalExitEvent): void => {
        if (event.ptyId === ptyId) finish();
      };

      this.on('exit', onExit);
      session.kill();
      forceTimer = setTimeout(() => {
        if (!this.sessions.has(ptyId)) {
          finish();
          return;
        }
        session.kill('SIGKILL');
      }, TERMINAL_KILL_TIMEOUT_MS);
      setTimeout(() => {
        if (this.sessions.delete(ptyId)) {
          this.emit('exit', { ptyId, exitCode: 0 } satisfies TerminalExitEvent);
        }
        finish();
      }, TERMINAL_KILL_TIMEOUT_MS + TERMINAL_FORCE_KILL_TIMEOUT_MS);
    });
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) {
      void this.kill(id);
    }
  }
}
