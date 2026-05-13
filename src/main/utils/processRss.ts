import { execFile } from 'child_process';
import path from 'path';

import { splitCsvLine } from './windowsProcessTable';

const DEFAULT_TIMEOUT_MS = 4_000;
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

/**
 * Read RSS (resident set size) in bytes for the given PIDs.
 *
 * Windows: parses `tasklist /v /fo csv /nh` (Mem Usage column, "12,345 K").
 * Unix:    parses `ps -o pid=,rss= -p <pids>` (rss column in KiB).
 *
 * Returns a Map keyed by PID; missing PIDs (already exited, permission denied,
 * filtered out by the kernel) are simply absent from the result — callers
 * should not treat absence as an error.
 *
 * Replaces the previous `pidusage` dependency, which spawned a fresh
 * PowerShell per call on Windows and accumulated dozens of long-running
 * shell processes during normal use.
 */
export async function readProcessRssBytes(pids: readonly number[]): Promise<Map<number, number>> {
  const uniquePids = [...new Set(pids.filter((p) => Number.isFinite(p) && p > 0))];
  if (uniquePids.length === 0) return new Map();
  if (process.platform === 'win32') {
    return readWindowsRss(uniquePids);
  }
  return readUnixRss(uniquePids);
}

async function readWindowsRss(pids: number[]): Promise<Map<number, number>> {
  // tasklist `/v /fo csv /nh` columns:
  // "Image Name","PID","Session Name","Session#","Mem Usage","Status","User Name","CPU Time","Window Title"
  const bin = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tasklist.exe');
  const stdout = await execChild(bin, ['/v', '/fo', 'csv', '/nh']);
  const wanted = new Set(pids);
  const result = new Map<number, number>();
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const fields = splitCsvLine(line);
    if (fields.length < 5) continue;
    const pid = Number.parseInt(fields[1] ?? '', 10);
    if (!Number.isFinite(pid) || !wanted.has(pid)) continue;
    const bytes = parseTasklistMemBytes(fields[4] ?? '');
    if (bytes != null) result.set(pid, bytes);
  }
  return result;
}

// Tasklist reports memory as a locale-formatted KiB count followed by " K",
// e.g. "12,345 K" (en-US) or "12.345 K" (de-DE). Strip non-digits, parse,
// convert to bytes. Returns null for any field that doesn't look like memory.
export function parseTasklistMemBytes(field: string): number | null {
  const trimmed = field.trim();
  if (!/^[\d.,\s]+K$/i.test(trimmed)) return null;
  const digits = trimmed.replace(/[^\d]/g, '');
  if (!digits) return null;
  const kib = Number.parseInt(digits, 10);
  if (!Number.isFinite(kib) || kib < 0) return null;
  return kib * 1024;
}

async function readUnixRss(pids: number[]): Promise<Map<number, number>> {
  const stdout = await execChild('ps', ['-o', 'pid=,rss=', '-p', pids.join(',')]);
  const result = new Map<number, number>();
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const pid = Number.parseInt(parts[0] ?? '', 10);
    const rssKib = Number.parseInt(parts[1] ?? '', 10);
    if (Number.isFinite(pid) && pid > 0 && Number.isFinite(rssKib) && rssKib >= 0) {
      result.set(pid, rssKib * 1024);
    }
  }
  return result;
}

function execChild(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      {
        encoding: 'utf8',
        timeout: DEFAULT_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: MAX_BUFFER_BYTES,
      },
      (error, stdout) => {
        if (error) {
          reject(
            error instanceof Error
              ? error
              : new Error(`processRss exec failed: ${JSON.stringify(error)}`)
          );
          return;
        }
        resolve(String(stdout ?? ''));
      }
    );
  });
}
