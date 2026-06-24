// daemon.mjs — background-daemon process management: pidfile helpers, signal
// forwarding, fallback-process cleanup, daemon status, and start/stop/ready-wait.

import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  currentVersion,
  daemonLogPath,
  daemonPidPath,
  hermitHome,
  jsonRequested,
  port,
  repoRoot,
} from './env.mjs';
import { brandCommand } from '../branding.mjs';
import { printCliRows, printJson } from './terminal.mjs';
import { checkExistingOpenHermitServer } from './runtime.mjs';

function readDaemonPid() {
  try {
    const raw = readFileSync(daemonPidPath, 'utf-8').trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function refreshDaemonPidFromReadyServer(pid) {
  if (!pid || !isPidRunning(pid)) return;
  try {
    mkdirSync(path.dirname(daemonPidPath), { recursive: true });
    writeFileSync(daemonPidPath, String(pid), 'utf-8');
  } catch {
    // PID refresh must not block the menu; server readiness is the source of truth.
  }
}

function isPidRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function removeDaemonPidFile() {
  try {
    unlinkSync(daemonPidPath);
  } catch {
    // Already gone.
  }
}

function signalDaemon(pid, signal) {
  if (!pid) return false;
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    // Fall back to direct process signal.
  }
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

function collectFallbackPids() {
  const pids = new Set();
  const commands = [
    `lsof -tiTCP:${port} -sTCP:LISTEN 2>/dev/null || true`,
    'lsof -tiTCP:9810 -sTCP:LISTEN 2>/dev/null || true',
    'lsof -tiTCP:9820 -sTCP:LISTEN 2>/dev/null || true',
    "pgrep -f '@yancyyu/openhermit|openhermit/bin/hermit\\.mjs|src/main/server\\.ts|hermit-bridge' 2>/dev/null || true",
  ];

  for (const command of commands) {
    try {
      const out = execSync(command, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
      for (const line of out.split(/\s+/)) {
        const pid = Number.parseInt(line, 10);
        if (Number.isFinite(pid) && pid > 0 && pid !== process.pid) {
          pids.add(pid);
        }
      }
    } catch {
      // Ignore missing lsof/pgrep or races with exiting processes.
    }
  }

  return [...pids];
}

async function stopFallbackProcesses() {
  const pids = collectFallbackPids();
  if (pids.length === 0) return false;

  for (const pid of pids) {
    signalDaemon(pid, 'SIGTERM');
  }
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  for (const pid of pids) {
    if (isPidRunning(pid)) {
      signalDaemon(pid, 'SIGKILL');
    }
  }
  return true;
}

async function collectDaemonStatus() {
  const pid = readDaemonPid();
  const pidRunning = Boolean(pid && isPidRunning(pid));
  const fallbackPids = pidRunning ? [] : collectFallbackPids();
  const server = await checkExistingOpenHermitServer();

  return {
    running: pidRunning || fallbackPids.length > 0 || server.running,
    version: currentVersion,
    port: Number.parseInt(port, 10),
    url: `http://127.0.0.1:${port}`,
    hermitHome,
    daemonPidPath,
    daemonLogPath,
    pid: pidRunning ? pid : null,
    pidfilePresent: Boolean(pid),
    fallbackPids,
    server,
  };
}


async function printDaemonStatus({ exitOnDone = true } = {}) {
  const status = await collectDaemonStatus();
  if (jsonRequested) {
    printJson({ ok: status.running, command: 'status', status }, status.running ? 0 : 1);
  }

  if (status.pid) {
    printCliRows('后台服务', [
      ['状态', `运行中 (pid ${status.pid})`],
      ['地址', status.url],
      ['日志', daemonLogPath],
    ], `停止服务可运行：${brandCommand('stop')}`);
    if (exitOnDone) process.exit(0);
    return status;
  }
  if (status.fallbackPids.length > 0) {
    printCliRows('后台服务', [
      ['状态', `运行中，无 daemon pidfile (pids ${status.fallbackPids.join(', ')})`],
      ['地址', status.url],
    ], '需要清理时可运行：openhermit stop');
    if (exitOnDone) process.exit(0);
    return status;
  }
  if (status.server.running) {
    printCliRows('后台服务', [
      ['状态', '运行中'],
      ['地址', status.server.url],
      ['版本', status.server.version],
    ], '复杂设置请在 Web 控制台中完成。');
    if (exitOnDone) process.exit(0);
    return status;
  }
  printCliRows('后台服务', [
    ['状态', '未运行'],
    ['地址', status.url],
  ], `启动服务可运行：${brandCommand('--daemon')}`);
  if (exitOnDone) process.exit(1);
  return status;
}

async function stopDaemon({ exitOnDone = true, quiet = false } = {}) {
  clearWebRunningOptimistic();
  const pid = readDaemonPid();
  if (!pid || !isPidRunning(pid)) {
    if (pid) removeDaemonPidFile();
    const stoppedFallback = await stopFallbackProcesses();
    if (!quiet) {
      printCliRows('后台服务', [
        ['状态', stoppedFallback ? '已停止残留服务进程' : '未运行'],
        ['地址', `http://127.0.0.1:${port}`],
      ], stoppedFallback ? `如需重新启动可运行：${brandCommand('--daemon')}` : '无需处理。');
    }
    if (exitOnDone) process.exit(0);
    return { stopped: stoppedFallback, pid: null };
  }
  if (!quiet) {
    printCliRows('后台服务', [
      ['状态', `正在停止 (pid ${pid})`],
      ['地址', `http://127.0.0.1:${port}`],
    ]);
  }
  signalDaemon(pid, 'SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  if (isPidRunning(pid)) {
    signalDaemon(pid, 'SIGKILL');
  }
  removeDaemonPidFile();
  if (!quiet) {
    printCliRows('后台服务', [
      ['状态', '已停止'],
      ['地址', `http://127.0.0.1:${port}`],
    ], `如需重新启动可运行：${brandCommand('--daemon')}`);
  }
  if (exitOnDone) process.exit(0);
  return { stopped: true, pid };
}

async function waitForOpenHermitServerReady(pid, timeoutMs = 20_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (pid && !isPidRunning(pid)) {
      return { ready: false, reason: '服务进程已退出，请查看日志', url: `http://127.0.0.1:${port}` };
    }

    const server = await checkExistingOpenHermitServer();
    if (server.running) return { ready: true, ...server };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { ready: false, reason: '服务还没准备好，请稍后刷新或查看日志', url: `http://127.0.0.1:${port}` };
}

function startDaemon({ exitOnDone = true, quiet = false, childArgs } = {}) {
  const url = `http://127.0.0.1:${port}`;
  const existingPid = readDaemonPid();
  if (existingPid && isPidRunning(existingPid)) {
    if (!quiet) {
      printCliRows('后台服务', [
        ['状态', `已运行 (pid ${existingPid})`],
        ['地址', url],
        ['日志', daemonLogPath],
      ], `停止服务可运行：${brandCommand('stop')}`);
    }
    if (exitOnDone) process.exit(0);
    return { started: false, pid: existingPid, url, logPath: daemonLogPath };
  }

  mkdirSync(path.dirname(daemonPidPath), { recursive: true });
  mkdirSync(path.dirname(daemonLogPath), { recursive: true });
  const out = openSync(daemonLogPath, 'a');
  const err = openSync(daemonLogPath, 'a');
  const daemonChildArgs = childArgs ?? process.argv.slice(2).filter((arg) => arg !== '--daemon');
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...daemonChildArgs], {
    cwd: repoRoot,
    detached: true,
    env: {
      ...process.env,
      HERMIT_DAEMON_CHILD: '1',
    },
    stdio: ['ignore', out, err],
  });
  child.unref();
  closeSync(out);
  closeSync(err);
  writeFileSync(daemonPidPath, String(child.pid), 'utf-8');
  if (!quiet) {
    printCliRows('后台服务', [
      ['状态', `已启动 (pid ${child.pid})`],
      ['地址', url],
      ['日志', daemonLogPath],
    ], `停止服务可运行：${brandCommand('stop')}`);
  }
  if (exitOnDone) process.exit(0);
  return { started: true, pid: child.pid, url, logPath: daemonLogPath };
}


export {
readDaemonPid,
refreshDaemonPidFromReadyServer,
isPidRunning,
removeDaemonPidFile,
signalDaemon,
collectFallbackPids,
stopFallbackProcesses,
collectDaemonStatus,
printDaemonStatus,
stopDaemon,
waitForOpenHermitServerReady,
startDaemon,
};
