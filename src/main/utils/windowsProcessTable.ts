import { execFile } from 'child_process';
import path from 'path';

export interface WindowsHostProcess {
  pid: number;
  command: string;
}

const HOST_PROCESSES_CACHE_TTL_MS = 60_000;
const DEFAULT_HOST_PROCESSES_TIMEOUT_MS = 4_000;

let cachedHostProcesses: { expiresAtMs: number; rows: WindowsHostProcess[] } | null = null;
let inFlightHostProcesses: Promise<WindowsHostProcess[]> | null = null;

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let buf = '';
  let inQuotes = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        buf += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i += 1;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      fields.push(buf);
      buf = '';
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  fields.push(buf);
  return fields;
}

function parsePositivePid(value: string | undefined): number | null {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

// tasklist `/v /fo csv /nh` columns:
// "Image Name","PID","Session Name","Session#","Mem Usage","Status","User Name","CPU Time","Window Title"
export function parseTasklistVerboseCsv(stdout: string): WindowsHostProcess[] {
  const result: WindowsHostProcess[] = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const fields = splitCsvLine(line);
    if (fields.length < 2) continue;
    const pid = parsePositivePid(fields[1]);
    const command = fields[0]?.trim() ?? '';
    if (!pid || !command) continue;
    result.push({ pid, command });
  }
  return result;
}

function runTasklist(args: readonly string[], timeoutMs: number): Promise<string> {
  const bin = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tasklist.exe');
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      [...args],
      {
        encoding: 'utf8',
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      },
      (error, stdout) => {
        if (error) {
          reject(
            error instanceof Error ? error : new Error(`tasklist failed: ${JSON.stringify(error)}`)
          );
          return;
        }
        resolve(String(stdout ?? ''));
      }
    );
  });
}

export async function listWindowsHostProcesses(
  timeoutMs = DEFAULT_HOST_PROCESSES_TIMEOUT_MS
): Promise<WindowsHostProcess[]> {
  const now = Date.now();
  if (cachedHostProcesses && cachedHostProcesses.expiresAtMs > now) {
    return cachedHostProcesses.rows;
  }
  if (inFlightHostProcesses) return inFlightHostProcesses;

  const next = runTasklist(['/v', '/fo', 'csv', '/nh'], timeoutMs)
    .then((stdout) => {
      const rows = parseTasklistVerboseCsv(stdout);
      cachedHostProcesses = { expiresAtMs: Date.now() + HOST_PROCESSES_CACHE_TTL_MS, rows };
      return rows;
    })
    .finally(() => {
      inFlightHostProcesses = null;
    });
  inFlightHostProcesses = next;
  return next;
}
