import type Redis from 'ioredis';
import type { TaskBusConfig } from '@shared/types/team';

import { parseExternalPlatformSessionKey } from '@main/utils/externalPlatformSessionKey';
import { normalizeRedisHost } from '@main/utils/redisConfig';

export interface ExternalImUsageMetrics {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
}

export interface ExternalImUsageReportInput {
  sessionKey: string;
  teamName: string;
  projectName?: string;
  runtime?: string;
  turnId?: string;
  occurredAt?: string;
  userId?: string;
  userName?: string;
  chatId?: string;
  chatName?: string;
  rawIdentity?: Record<string, unknown>;
  metrics: ExternalImUsageMetrics;
}

export interface ExternalImUsageReportResult {
  reported: boolean;
  reason?: 'not-external-im' | 'missing-user' | 'empty-usage' | 'redis-unavailable' | 'duplicate';
}

type RedisConfig = TaskBusConfig['redis'];
type RedisFactory = (cfg: RedisConfig) => Promise<Redis | null>;

const KEY_TURN = (turnKey: string) => `hermit:usage:external-im:turn:${turnKey}`;
const KEY_EVENTS = 'hermit:usage:external-im:events';
const KEY_USERS = 'hermit:usage:external-im:users';
const KEY_USER_SUMMARY = (platform: string, userId: string) =>
  `hermit:usage:external-im:user:${platform}:${userId}:summary`;

function redisConfig(cfg: RedisConfig) {
  return {
    host: normalizeRedisHost(cfg.host),
    port: cfg.port,
    password: cfg.password,
    db: cfg.db,
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  };
}

async function defaultRedisFactory(cfg: RedisConfig): Promise<Redis | null> {
  let Redis: typeof import('ioredis').default;
  try {
    const mod = await import('ioredis');
    Redis = mod.default;
  } catch {
    return null;
  }

  const client = new Redis(redisConfig(cfg));
  client.on('error', () => {
    /* handled by connect/ping fallback */
  });
  try {
    await client.connect();
    await client.ping();
    return client;
  } catch {
    try {
      client.disconnect();
    } catch {
      /* ignore */
    }
    return null;
  }
}

function normalizeTokenCount(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function extractExternalImUsageMetrics(raw: unknown): ExternalImUsageMetrics | null {
  if (!raw || typeof raw !== 'object') return null;
  const event = raw as Record<string, unknown>;
  const usage =
    event.usage && typeof event.usage === 'object'
      ? (event.usage as Record<string, unknown>)
      : event.token_usage && typeof event.token_usage === 'object'
        ? (event.token_usage as Record<string, unknown>)
        : event;

  const inputTokens = normalizeTokenCount(
    usage.input_tokens ?? usage.inputTokens ?? usage.prompt_tokens ?? usage.promptTokens
  );
  const outputTokens = normalizeTokenCount(
    usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens ?? usage.completionTokens
  );
  const cacheReadTokens = normalizeTokenCount(
    usage.cache_read_input_tokens ?? usage.cacheReadTokens ?? usage.cache_read_tokens
  );
  const cacheCreationTokens = normalizeTokenCount(
    usage.cache_creation_input_tokens ?? usage.cacheCreationTokens ?? usage.cache_creation_tokens
  );
  const totalTokens =
    normalizeTokenCount(usage.total_tokens ?? usage.totalTokens) ||
    inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;

  if (totalTokens <= 0) return null;
  return { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, totalTokens };
}

function stableTurnKey(
  input: Required<Pick<ExternalImUsageReportInput, 'sessionKey'>> & ExternalImUsageReportInput
): string {
  const explicit = input.turnId?.trim();
  if (explicit) return `${input.sessionKey}:${explicit}`;
  const occurredAt = input.occurredAt?.trim() || 'unknown-time';
  return `${input.sessionKey}:${occurredAt}:${input.metrics.totalTokens}`;
}

const SAFE_IDENTITY_KEYS = new Set([
  'session_key',
  'project',
  'project_name',
  'platform',
  'user_id',
  'user_name',
  'userId',
  'userName',
  'sender_user_id',
  'sender_user_name',
  'senderUserId',
  'senderUserName',
  'sender_name',
  'senderName',
  'chat_id',
  'chat_name',
  'chatId',
  'chatName',
  'open_id',
  'openId',
  'open_chat_id',
  'openChatId',
  'union_id',
  'unionId',
  'tenant_key',
  'tenantKey',
  'msg_id',
  'msgId',
  'reply_ctx',
]);

function sanitizeIdentityMetadata(
  raw: Record<string, unknown> | undefined
): Record<string, string> | undefined {
  if (!raw) return undefined;
  const metadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!SAFE_IDENTITY_KEYS.has(key)) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      metadata[key] = String(value);
    }
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

export class ExternalImUsageReporter {
  constructor(
    private readonly options: {
      getRedisConfig: () => Promise<RedisConfig | null | undefined>;
      redisFactory?: RedisFactory;
      now?: () => string;
    }
  ) {}

  async reportTurn(input: ExternalImUsageReportInput): Promise<ExternalImUsageReportResult> {
    const parsed = parseExternalPlatformSessionKey(input.sessionKey);
    if (parsed.kind !== 'external-platform' || !parsed.platform) {
      return { reported: false, reason: 'not-external-im' };
    }

    const userId = input.userId || parsed.userId;
    if (!userId) return { reported: false, reason: 'missing-user' };
    if (input.metrics.totalTokens <= 0) return { reported: false, reason: 'empty-usage' };

    const redisCfg = await this.options.getRedisConfig();
    if (!redisCfg) return { reported: false, reason: 'redis-unavailable' };

    const redisFactory = this.options.redisFactory ?? defaultRedisFactory;
    const client = await redisFactory(redisCfg);
    if (!client) return { reported: false, reason: 'redis-unavailable' };

    const occurredAt = input.occurredAt ?? this.options.now?.() ?? new Date().toISOString();
    const chatId = input.chatId || parsed.chatId;
    const turnKey = stableTurnKey({ ...input, occurredAt, sessionKey: input.sessionKey });
    const userKey = `${parsed.platform}:user:${userId}`;
    const eventPayload = {
      platform: parsed.platform,
      userId,
      userName: input.userName,
      chatId,
      chatName: input.chatName,
      identity: sanitizeIdentityMetadata(input.rawIdentity),
      teamName: input.teamName,
      projectName: input.projectName,
      sessionKey: input.sessionKey,
      turnId: input.turnId,
      runtime: input.runtime,
      occurredAt,
      messages: 1,
      inputTokens: input.metrics.inputTokens,
      outputTokens: input.metrics.outputTokens,
      cacheReadTokens: input.metrics.cacheReadTokens,
      cacheCreationTokens: input.metrics.cacheCreationTokens,
      totalTokens: input.metrics.totalTokens,
    };

    try {
      const inserted = await client.set(KEY_TURN(turnKey), '1', 'EX', 30 * 86400, 'NX');
      if (inserted !== 'OK') return { reported: false, reason: 'duplicate' };

      const pipe = client.pipeline();
      pipe.sadd(KEY_USERS, userKey);
      pipe.hincrby(KEY_USER_SUMMARY(parsed.platform, userId), 'turns', 1);
      pipe.hincrby(KEY_USER_SUMMARY(parsed.platform, userId), 'messages', 1);
      pipe.hincrby(
        KEY_USER_SUMMARY(parsed.platform, userId),
        'input_tokens',
        input.metrics.inputTokens
      );
      pipe.hincrby(
        KEY_USER_SUMMARY(parsed.platform, userId),
        'output_tokens',
        input.metrics.outputTokens
      );
      pipe.hincrby(
        KEY_USER_SUMMARY(parsed.platform, userId),
        'cache_read_tokens',
        input.metrics.cacheReadTokens
      );
      pipe.hincrby(
        KEY_USER_SUMMARY(parsed.platform, userId),
        'cache_creation_tokens',
        input.metrics.cacheCreationTokens
      );
      pipe.hincrby(
        KEY_USER_SUMMARY(parsed.platform, userId),
        'total_tokens',
        input.metrics.totalTokens
      );
      pipe.hset(KEY_USER_SUMMARY(parsed.platform, userId), {
        platform: parsed.platform,
        user_id: userId,
        user_name: input.userName ?? '',
        chat_id: chatId ?? '',
        chat_name: input.chatName ?? '',
        team_name: input.teamName,
        project_name: input.projectName ?? '',
        session_key: input.sessionKey,
        runtime: input.runtime ?? '',
        last_active_at: occurredAt,
      });
      pipe.lpush(KEY_EVENTS, JSON.stringify(eventPayload));
      pipe.ltrim(KEY_EVENTS, 0, 9999);
      await pipe.exec();
      return { reported: true };
    } finally {
      try {
        client.disconnect();
      } catch {
        /* ignore */
      }
    }
  }
}

export const externalImUsageRedisKeys = {
  turn: KEY_TURN,
  events: KEY_EVENTS,
  users: KEY_USERS,
  userSummary: KEY_USER_SUMMARY,
};
