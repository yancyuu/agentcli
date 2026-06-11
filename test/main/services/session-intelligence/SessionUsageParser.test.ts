import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { scanProjectStats } from '@main/services/session-intelligence/SessionUsageParser';
import {
  encodePath,
  encodePathPortable,
  setClaudeBasePathOverride,
} from '@main/utils/pathDecoder';

let tmpDir: string;
let claudeBase: string;

function projectDirFor(workDir: string, encoded = encodePath(workDir)): string {
  return path.join(claudeBase, 'projects', encoded);
}

function writeSessionJsonl(filePath: string, workDir: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = [
    {
      type: 'user',
      cwd: workDir,
      timestamp: '2026-01-01T00:00:00.000Z',
      message: { role: 'user', content: 'Hello from user' },
    },
    {
      type: 'assistant',
      cwd: workDir,
      timestamp: '2026-01-01T00:00:10.000Z',
      message: {
        role: 'assistant',
        content: 'Assistant response',
        model: 'claude-sonnet-test',
        usage: {
          input_tokens: 12,
          output_tokens: 34,
          cache_read_input_tokens: 56,
          cache_creation_input_tokens: 78,
        },
      },
    },
  ];
  fs.writeFileSync(filePath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
}

function writeTopLevelUsageSessionJsonl(filePath: string, workDir: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = [
    {
      type: 'user',
      cwd: workDir,
      timestamp: '2026-01-01T00:00:00.000Z',
      content: 'Hello from user',
    },
    {
      type: 'assistant',
      cwd: workDir,
      timestamp: '2026-01-01T00:00:10.000Z',
      content: 'Assistant response',
      model: 'claude-sonnet-test',
      usage: {
        input_tokens: 12,
        output_tokens: 34,
        cache_read_input_tokens: 56,
        cache_creation_input_tokens: 78,
      },
    },
  ];
  fs.writeFileSync(filePath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-session-usage-parser-'));
  claudeBase = path.join(tmpDir, '.claude');
  fs.mkdirSync(path.join(claudeBase, 'projects'), { recursive: true });
  setClaudeBasePathOverride(claudeBase);
});

afterEach(() => {
  setClaudeBasePathOverride(null);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('scanProjectStats', () => {
  it('scans sessions stored in an alternate project directory candidate', async () => {
    const workDir = path.join(tmpDir, 'hermit_project');
    const portableDir = encodePathPortable(workDir);
    expect(portableDir).not.toBe(encodePath(workDir));
    writeSessionJsonl(path.join(projectDirFor(workDir, portableDir), 'session-portable.jsonl'), workDir);

    const stats = await scanProjectStats(workDir);

    expect(stats).toEqual({
      sessions: 1,
      messages: 2,
      tokensIn: 12,
      tokensOut: 34,
      cacheRead: 56,
      cacheCreation: 78,
      totalTokens: 180,
      durationMs: 10_000,
    });
  });

  it('includes top-level assistant usage in total tokens', async () => {
    const workDir = path.join(tmpDir, 'top_level_usage_project');
    writeTopLevelUsageSessionJsonl(
      path.join(projectDirFor(workDir), 'session-top-level.jsonl'),
      workDir
    );

    const stats = await scanProjectStats(workDir);

    expect(stats).toMatchObject({
      tokensIn: 12,
      tokensOut: 34,
      cacheRead: 56,
      cacheCreation: 78,
      totalTokens: 180,
    });
  });
});
