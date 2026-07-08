// utilsCommand.mjs — Small shared utilities used by multiple command modules.
// Avoids circular imports when multiple modules need the same helper.
import {
  port,
  daemonLogPath,
} from './env.mjs';
import {
  checkExistingOpenHermitServer,
} from './runtime.mjs';
import {
  readPidFile,
  isPidRunning,
} from './daemon.mjs';
import { ui } from './terminal.mjs';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { openSync, closeSync } from 'node:fs';

function readLogChunkSince(filePath, offset) {
  try {
    const stat = statSync(filePath);
    const safeOffset = stat.size < offset ? 0 : offset;
    if (stat.size <= safeOffset) return { chunk: '', offset: stat.size };
    const raw = readFileSync(filePath, 'utf-8');
    return { chunk: raw.slice(safeOffset), offset: stat.size };
  } catch {
    return { chunk: '', offset };
  }
}

function printStartupLogChunk(chunk) {
  const lines = String(chunk || '').split(/\r?\n/).filter(Boolean).slice(-12);
  for (const line of lines) {
    process.stdout.write(`${ui.dim('│')} ${line}\n`);
  }
}

export async function waitForOpenHermitServerReadyWithLogs(pid, timeoutMs = 30_000) {
  const { waitForOpenHermitServerReady } = await import('./daemon.mjs');
  if (!process.stdout.isTTY) return waitForOpenHermitServerReady(pid, timeoutMs);
  const startedAt = Date.now();
  let logOffset = 0;
  process.stdout.write(`${ui.dim('正在启动 Web 工作台，日志：')} ${daemonLogPath}\n`);
  while (Date.now() - startedAt < timeoutMs) {
    const log = readLogChunkSince(daemonLogPath, logOffset);
    logOffset = log.offset;
    if (log.chunk) printStartupLogChunk(log.chunk);

    if (pid && !isPidRunning(pid)) {
      return { ready: false, reason: '服务进程已退出，请查看日志', url: `http://127.0.0.1:${port}` };
    }
    const server = await checkExistingOpenHermitServer();
    if (server.running) return { ready: true, ...server };
    process.stdout.write(`${ui.dim('… 等待 Web 服务就绪')}\n`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return { ready: false, reason: '服务还没准备好，请稍后刷新或查看日志', url: `http://127.0.0.1:${port}` };
}
