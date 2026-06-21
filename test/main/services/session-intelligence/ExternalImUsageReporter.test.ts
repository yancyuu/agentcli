import { describe, expect, it } from 'vitest';

import {
  ExternalImUsageReporter,
  externalImUsageRedisKeys,
  extractExternalImUsageMetrics,
} from '@main/services/session-intelligence/ExternalImUsageReporter';
import type { TaskBusConfig } from '@shared/types/team';

class FakePipeline {
  constructor(private readonly redis: FakeRedis) {}

  sadd(key: string, value: string): this {
    const set = this.redis.sets.get(key) ?? new Set<string>();
    set.add(value);
    this.redis.sets.set(key, set);
    return this;
  }

  hincrby(key: string, field: string, increment: number): this {
    const hash = this.redis.hashes.get(key) ?? {};
    hash[field] = String(Number(hash[field] ?? 0) + increment);
    this.redis.hashes.set(key, hash);
    return this;
  }

  hset(key: string, value: Record<string, unknown>): this {
    const hash = this.redis.hashes.get(key) ?? {};
    for (const [field, fieldValue] of Object.entries(value)) {
      hash[field] = String(fieldValue ?? '');
    }
    this.redis.hashes.set(key, hash);
    return this;
  }

  lpush(key: string, value: string): this {
    const list = this.redis.lists.get(key) ?? [];
    list.unshift(value);
    this.redis.lists.set(key, list);
    return this;
  }

  ltrim(key: string, start: number, stop: number): this {
    const list = this.redis.lists.get(key) ?? [];
    this.redis.lists.set(key, list.slice(start, stop + 1));
    return this;
  }

  async exec(): Promise<[]> {
    return [];
  }
}

class FakeRedis {
  readonly values = new Map<string, string>();
  readonly hashes = new Map<string, Record<string, string>>();
  readonly lists = new Map<string, string[]>();
  readonly sets = new Map<string, Set<string>>();

  pipeline(): FakePipeline {
    return new FakePipeline(this);
  }

  async set(key: string, value: string, ...args: string[]): Promise<'OK' | null> {
    const nx = args.includes('NX');
    if (nx && this.values.has(key)) return null;
    this.values.set(key, value);
    return 'OK';
  }

  disconnect(): void {
    // noop
  }
}

const redisConfig: TaskBusConfig['redis'] = { host: '127.0.0.1', port: 6379 };

describe('ExternalImUsageReporter', () => {
  it('extracts usage from runtime-agnostic bridge payloads', () => {
    expect(
      extractExternalImUsageMetrics({
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 40,
        },
      })
    ).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheCreationTokens: 40,
      totalTokens: 100,
    });

    expect(
      extractExternalImUsageMetrics({
        token_usage: { inputTokens: 1, outputTokens: 2, totalTokens: 9 },
      })
    ).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 9,
    });
  });

  it('reports one external IM turn to Redis with user identity and token counts only', async () => {
    const redis = new FakeRedis();
    const reporter = new ExternalImUsageReporter({
      getRedisConfig: async () => redisConfig,
      redisFactory: async () => redis as never,
      now: () => '2026-06-18T00:00:00.000Z',
    });

    const result = await reporter.reportTurn({
      sessionKey: 'feishu:oc_chat:ou_user',
      teamName: 'support-team',
      projectName: 'support-project',
      runtime: 'claudecode',
      turnId: 'turn-1',
      userName: 'Alice',
      chatName: 'Customer Group',
      rawIdentity: {
        content: 'SECRET BODY',
        full_text: 'SECRET REPLY',
        message_text: 'SECRET MESSAGE TEXT',
        msg_content: 'SECRET MSG CONTENT',
        user_id: 'ou_user',
      },
      metrics: {
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 30,
        cacheCreationTokens: 40,
        totalTokens: 100,
      },
    });

    expect(result).toEqual({ reported: true });
    expect(redis.sets.get(externalImUsageRedisKeys.users)?.has('feishu:user:ou_user')).toBe(true);
    expect(redis.hashes.get(externalImUsageRedisKeys.userSummary('feishu', 'ou_user'))).toMatchObject({
      platform: 'feishu',
      user_id: 'ou_user',
      user_name: 'Alice',
      chat_id: 'oc_chat',
      chat_name: 'Customer Group',
      team_name: 'support-team',
      project_name: 'support-project',
      runtime: 'claudecode',
      turns: '1',
      messages: '1',
      input_tokens: '10',
      output_tokens: '20',
      cache_read_tokens: '30',
      cache_creation_tokens: '40',
      total_tokens: '100',
    });

    const event = redis.lists.get(externalImUsageRedisKeys.events)?.[0] ?? '';
    expect(event).toContain('Alice');
    expect(event).toContain('100');
    expect(event).not.toContain('SECRET BODY');
    expect(event).not.toContain('SECRET REPLY');
    expect(event).not.toContain('SECRET MESSAGE TEXT');
    expect(event).not.toContain('SECRET MSG CONTENT');
  });

  it('deduplicates the same external IM turn', async () => {
    const redis = new FakeRedis();
    const reporter = new ExternalImUsageReporter({
      getRedisConfig: async () => redisConfig,
      redisFactory: async () => redis as never,
    });
    const input = {
      sessionKey: 'feishu:oc_chat:ou_user',
      teamName: 'support-team',
      turnId: 'turn-1',
      metrics: {
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 3,
      },
    };

    expect(await reporter.reportTurn(input)).toEqual({ reported: true });
    expect(await reporter.reportTurn(input)).toEqual({ reported: false, reason: 'duplicate' });
    expect(redis.hashes.get(externalImUsageRedisKeys.userSummary('feishu', 'ou_user'))?.turns).toBe('1');
  });

  it('ignores non-external sessions, missing users, empty usage, and missing Redis', async () => {
    const reporter = new ExternalImUsageReporter({ getRedisConfig: async () => redisConfig });
    const metrics = {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 2,
    };

    expect(
      await reporter.reportTurn({ sessionKey: 'hermit:team:session', teamName: 'team', metrics })
    ).toEqual({ reported: false, reason: 'not-external-im' });
    expect(
      await reporter.reportTurn({ sessionKey: 'feishu:oc_chat', teamName: 'team', metrics })
    ).toEqual({ reported: false, reason: 'missing-user' });
    expect(
      await reporter.reportTurn({
        sessionKey: 'feishu:oc_chat:ou_user',
        teamName: 'team',
        metrics: { ...metrics, totalTokens: 0 },
      })
    ).toEqual({ reported: false, reason: 'empty-usage' });
    expect(
      await new ExternalImUsageReporter({ getRedisConfig: async () => null }).reportTurn({
        sessionKey: 'feishu:oc_chat:ou_user',
        teamName: 'team',
        metrics,
      })
    ).toEqual({ reported: false, reason: 'redis-unavailable' });
  });
});
