import { execFile } from 'child_process';

export interface PosixHostProcess {
  pid: number;
  command: string;
}

const HOST_PROCESSES_CACHE_TTL_MS = 60_000;
const DEFAULT_HOST_PROCESSES_TIMEOUT_MS = 4_000;

let cachedHostProcesses: { expiresAtMs: number; rows: PosixHostProcess[] } | null = null;
let inFlightHostProcesses: Promise<PosixHostProcess[]> | null = null;

export function parsePosixPsOutput(output: string): PosixHostProcess[] {
  const rows: PosixHostProcess[] = [];
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const pid = Number.parseInt(match[1] ?? '', 10);
    const command = match[2]?.trim() ?? '';
    if (Number.isFinite(pid) && pid > 0 && command) {
      rows.push({ pid, command });
    }
  }
  return rows;
}

function runPs(timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'ps',
      ['-ax', '-o', 'pid=,command='],
      { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error instanceof Error ? error : new Error(`ps failed: ${JSON.stringify(error)}`));
          return;
        }
        resolve(String(stdout ?? ''));
      }
    );
  });
}

export async function listPosixHostProcesses(
  timeoutMs = DEFAULT_HOST_PROCESSES_TIMEOUT_MS
): Promise<PosixHostProcess[]> {
  const now = Date.now();
  if (cachedHostProcesses && cachedHostProcesses.expiresAtMs > now) {
    return cachedHostProcesses.rows;
  }
  if (inFlightHostProcesses) return inFlightHostProcesses;

  const next = runPs(timeoutMs)
    .then((stdout) => {
      const rows = parsePosixPsOutput(stdout);
      cachedHostProcesses = { expiresAtMs: Date.now() + HOST_PROCESSES_CACHE_TTL_MS, rows };
      return rows;
    })
    .finally(() => {
      inFlightHostProcesses = null;
    });
  inFlightHostProcesses = next;
  return next;
}
