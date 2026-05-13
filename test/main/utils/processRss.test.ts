// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execFile: vi.fn(),
  };
});

import * as child from 'child_process';
import {
  readProcessRssBytes,
  parseTasklistMemBytes,
} from '@main/utils/processRss';

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

function setPlatform(value: string) {
  Object.defineProperty(process, 'platform', {
    value,
    configurable: true,
    writable: true,
  });
}

const originalPlatform = process.platform;

describe('parseTasklistMemBytes', () => {
  it('parses common en-US format', () => {
    expect(parseTasklistMemBytes('12,345 K')).toBe(12_345 * 1024);
  });

  it('parses de-DE format with periods as thousand separators', () => {
    expect(parseTasklistMemBytes('12.345 K')).toBe(12_345 * 1024);
  });

  it('parses single-digit memory values', () => {
    expect(parseTasklistMemBytes('6 K')).toBe(6 * 1024);
  });

  it('returns null for unrelated columns', () => {
    expect(parseTasklistMemBytes('Running')).toBeNull();
    expect(parseTasklistMemBytes('chrome.exe')).toBeNull();
    expect(parseTasklistMemBytes('')).toBeNull();
  });
});

describe('readProcessRssBytes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it('returns empty map for empty / invalid PID input', async () => {
    setPlatform('linux');
    const result = await readProcessRssBytes([]);
    expect(result.size).toBe(0);
    expect(child.execFile).not.toHaveBeenCalled();
  });

  it('on Windows: parses tasklist /v /fo csv output for requested PIDs', async () => {
    setPlatform('win32');
    const execFileMock = child.execFile as unknown as Mock;
    execFileMock.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: ExecCallback) => {
        const stdout = [
          '"chrome.exe","12345","Console","1","123,456 K","Running","user","0:00:01","N/A"',
          '"claude.exe","67890","Console","1","234,567 K","Running","user","0:00:02","N/A"',
          '"other.exe","99999","Console","1","11,111 K","Running","user","0:00:03","N/A"',
        ].join('\r\n');
        cb(null, stdout, '');
        return {} as never;
      }
    );

    const result = await readProcessRssBytes([12345, 67890]);
    expect(result.get(12345)).toBe(123_456 * 1024);
    expect(result.get(67890)).toBe(234_567 * 1024);
    expect(result.has(99999)).toBe(false);

    const callArgs = execFileMock.mock.calls[0];
    expect(String(callArgs[0])).toMatch(/tasklist\.exe$/i);
    expect(callArgs[1]).toEqual(['/v', '/fo', 'csv', '/nh']);
  });

  it('on Windows: skips rows with malformed memory column', async () => {
    setPlatform('win32');
    (child.execFile as unknown as Mock).mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: ExecCallback) => {
        const stdout = [
          '"chrome.exe","12345","Console","1","N/A","Not Responding","user","0:00:01","N/A"',
          '"claude.exe","67890","Console","1","234,567 K","Running","user","0:00:02","N/A"',
        ].join('\r\n');
        cb(null, stdout, '');
        return {} as never;
      }
    );

    const result = await readProcessRssBytes([12345, 67890]);
    expect(result.has(12345)).toBe(false);
    expect(result.get(67890)).toBe(234_567 * 1024);
  });

  it('on Unix: parses ps -o pid=,rss= output', async () => {
    setPlatform('linux');
    const execFileMock = child.execFile as unknown as Mock;
    execFileMock.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: ExecCallback) => {
        const stdout = ['  12345  1024', '  67890  2048', '  99999    16'].join('\n');
        cb(null, stdout, '');
        return {} as never;
      }
    );

    const result = await readProcessRssBytes([12345, 67890, 99999]);
    expect(result.get(12345)).toBe(1024 * 1024);
    expect(result.get(67890)).toBe(2048 * 1024);
    expect(result.get(99999)).toBe(16 * 1024);

    expect(execFileMock.mock.calls[0][0]).toBe('ps');
    expect(execFileMock.mock.calls[0][1]).toEqual([
      '-o',
      'pid=,rss=',
      '-p',
      '12345,67890,99999',
    ]);
  });

  it('on Unix: skips lines that do not start with a numeric PID', async () => {
    setPlatform('linux');
    (child.execFile as unknown as Mock).mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: ExecCallback) => {
        const stdout = ['  PID  RSS', '  12345  1024'].join('\n');
        cb(null, stdout, '');
        return {} as never;
      }
    );

    const result = await readProcessRssBytes([12345]);
    expect(result.size).toBe(1);
    expect(result.get(12345)).toBe(1024 * 1024);
  });

  it('deduplicates PIDs before querying', async () => {
    setPlatform('linux');
    const execFileMock = child.execFile as unknown as Mock;
    execFileMock.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: ExecCallback) => {
        cb(null, '  12345  1024', '');
        return {} as never;
      }
    );

    await readProcessRssBytes([12345, 12345, 12345]);
    expect(execFileMock.mock.calls[0][1]).toEqual(['-o', 'pid=,rss=', '-p', '12345']);
  });

  it('filters out non-positive PIDs', async () => {
    setPlatform('linux');
    const execFileMock = child.execFile as unknown as Mock;
    execFileMock.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: ExecCallback) => {
        cb(null, '  12345  1024', '');
        return {} as never;
      }
    );

    await readProcessRssBytes([0, -1, Number.NaN, 12345]);
    expect(execFileMock.mock.calls[0][1]).toEqual(['-o', 'pid=,rss=', '-p', '12345']);
  });

  it('propagates exec errors to the caller', async () => {
    setPlatform('linux');
    (child.execFile as unknown as Mock).mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: ExecCallback) => {
        cb(new Error('ps failed'), '', '');
        return {} as never;
      }
    );

    await expect(readProcessRssBytes([12345])).rejects.toThrow('ps failed');
  });
});
