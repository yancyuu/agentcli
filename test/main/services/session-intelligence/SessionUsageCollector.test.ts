import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SessionUsageCollector } from '@main/services/session-intelligence/SessionUsageCollector';
import type { ConversationTelemetryRow } from '@shared/types/api';
import { setClaudeBasePathOverride } from '@main/utils/pathDecoder';

let tmpDir: string;
let claudeBase: string;

const externalConversation: ConversationTelemetryRow = {
  teamName: 'team-alpha',
  teamDisplayName: 'Team Alpha',
  projectName: 'team-alpha',
  session: {
    sessionKey: 'lark:user:ou_123',
    updatedAt: '2026-06-18T00:00:00.000Z',
    matchStatus: 'matched',
  },
  identity: {
    platform: 'lark',
    type: 'person',
    id: 'ou_123',
    userId: 'ou_123',
    displayName: 'Alice',
    userName: 'Alice',
    confidence: 'exact-id',
  },
  content: {
    messageCount: 2,
    userMessageCount: 1,
    assistantMessageCount: 1,
    toolResultCount: 0,
  },
  usage: {
    inputTokens: 10,
    outputTokens: 20,
    cacheReadTokens: 30,
    cacheCreationTokens: 40,
    totalTokens: 100,
    assistantTurnsWithUsage: 1,
    models: {},
    toolCalls: {},
    usageSource: 'claude-jsonl',
  },
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-session-usage-collector-'));
  claudeBase = path.join(tmpDir, '.claude');
  fs.mkdirSync(path.join(claudeBase, 'projects'), { recursive: true });
  setClaudeBasePathOverride(claudeBase);
});

afterEach(() => {
  setClaudeBasePathOverride(null);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('SessionUsageCollector', () => {
  it('collects parse aggregate and external conversation rows in one result', async () => {
    const collector = new SessionUsageCollector(async () => [externalConversation]);

    const result = await collector.collect();

    expect(result.computedAt).toBeTruthy();
    expect(result.legacyParseResult.aggregate.sessions).toBe(0);
    expect(result.conversations).toEqual([externalConversation]);
  });

  it('keeps usage scanning available when conversation loading fails', async () => {
    const collector = new SessionUsageCollector(async () => {
      throw new Error('cc-connect unavailable');
    });

    const result = await collector.collect();

    expect(result.legacyParseResult.aggregate.sessions).toBe(0);
    expect(result.conversations).toEqual([]);
  });
});
