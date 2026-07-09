import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { scanProjectStats, scanSessions } from '@main/services/session-intelligence/SessionUsageParser';
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
  process.env.CODEX_HOME = path.join(tmpDir, '.codex');
  setClaudeBasePathOverride(claudeBase);
});

afterEach(() => {
  setClaudeBasePathOverride(null);
  delete process.env.CODEX_HOME;
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

  it('prefers Claude total_tokens over recomputing cache-inclusive totals', async () => {
    const workDir = path.join(tmpDir, 'claude-total-tokens-project');
    const sessionPath = path.join(projectDirFor(workDir), 'session-total-tokens.jsonl');
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(
      sessionPath,
      `${JSON.stringify({
        type: 'assistant',
        cwd: workDir,
        timestamp: '2026-01-01T00:00:10.000Z',
        message: {
          role: 'assistant',
          content: 'Assistant response',
          usage: {
            input_tokens: 12,
            output_tokens: 34,
            cache_read_input_tokens: 56,
            cache_creation_input_tokens: 78,
            total_tokens: 46,
          },
        },
      })}\n`
    );

    const stats = await scanProjectStats(workDir);
    const result = await scanSessions();
    const session = result.sessions.find((item) => item.projectPath === workDir);

    expect(stats).toMatchObject({
      tokensIn: 12,
      tokensOut: 34,
      cacheRead: 56,
      cacheCreation: 78,
      totalTokens: 46,
    });
    expect(session?.tokens.total).toBe(46);
    expect(result.aggregate.tokens.total).toBe(46);
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

describe('scanSessions', () => {
  it('includes Codex token_count records in provider aggregates', async () => {
    const codexHome = path.join(tmpDir, '.codex');
    process.env.CODEX_HOME = codexHome;
    const sessionDir = path.join(codexHome, 'sessions', '2026', '07', '02');
    fs.mkdirSync(sessionDir, { recursive: true });
    const projectPath = path.join(tmpDir, 'codex-project');
    fs.writeFileSync(
      path.join(sessionDir, 'rollout-session-1.jsonl'),
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        type: 'session_meta',
        payload: {
          type: 'session_meta',
          session_id: 'rollout-session-1',
          cwd: projectPath,
          model_provider: 'glm',
        },
      })}\n${JSON.stringify({
        timestamp: new Date().toISOString(),
        type: 'event_msg',
        payload: {
          type: 'token_count',
          turn_id: 'turn-1',
          cwd: projectPath,
          model: 'glm-5.2',
          info: {
            last_token_usage: {
              input_tokens: 11,
              cached_input_tokens: 2,
              output_tokens: 4,
              reasoning_output_tokens: 1,
              total_tokens: 18,
            },
          },
        },
      })}\n`
    );

    const result = await scanSessions();

    expect(result.aggregate.byProvider.codex).toMatchObject({
      sessions: 1,
      messages: 1,
      tokensIn: 11,
      tokensOut: 5,
      cacheRead: 2,
      tokensTotal: 18,
    });
    expect(result.aggregate.events7d.some((event) => event.provider === 'codex')).toBe(true);
    expect(result.sessions.some((session) => session.provider === 'codex')).toBe(true);
  });
});
