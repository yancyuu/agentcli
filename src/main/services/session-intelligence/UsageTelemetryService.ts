/**
 * UsageTelemetryService - scans Claude Code JSONL sessions and uploads
 * metadata-only usage metrics to Redis.
 */

import type Redis from 'ioredis';
import { scanSessions } from './SessionUsageParser';
import type { TaskBusConfig } from '@shared/types/team';
import type { ParseResult } from './SessionUsageParser';

const KEY_DAILY = (slug: string, date: string) => `hermit:usage:${slug}:daily:${date}`;
const KEY_SUMMARY = (slug: string) => `hermit:usage:${slug}:summary`;
const KEY_LAST_SCAN = (slug: string) => `hermit:usage:${slug}:lastScan`;
const KEY_HOURLY = (slug: string) => `hermit:usage:${slug}:hourly`;
const KEY_EVENTS7D = (slug: string) => `hermit:usage:${slug}:events7d`;
const KEY_WORK_SECONDS = (slug: string) => `hermit:usage:${slug}:workSeconds`;
const KEY_PROJECTS = (slug: string) => `hermit:usage:${slug}:projects`;

let scanInterval: ReturnType<typeof setInterval> | null = null;
let lastLocalScan: TelemetryStatusResult | null = null;

function redisConfig(cfg: TaskBusConfig) {
  return {
    host: cfg.redis.host,
    port: cfg.redis.port,
    password: cfg.redis.password,
    db: cfg.redis.db,
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  };
}

async function getRedis(cfg: TaskBusConfig): Promise<Redis | null> {
  let Redis: typeof import('ioredis').default;
  try {
    const mod = await import('ioredis');
    Redis = mod.default;
  } catch {
    return null;
  }

  const r = new Redis(redisConfig(cfg));
  r.on('error', () => {
    /* handled by connect/ping fallback */
  });
  try {
    await r.connect();
    await r.ping();
    return r;
  } catch {
    try {
      r.disconnect();
    } catch {
      /* ignore */
    }
    return null;
  }
}

async function uploadMetrics(client: Redis, slug: string, result: ParseResult): Promise<void> {
  const { aggregate } = result;
  const pipe = client.pipeline();

  // Per-day metrics (90 day TTL)
  for (const [day, m] of Object.entries(aggregate.daily)) {
    pipe.hset(KEY_DAILY(slug, day), {
      sessions: m.sessions,
      messages: m.messages,
      tokens_in: m.tokensIn,
      tokens_out: m.tokensOut,
      cache_read: m.cacheRead,
      cache_creation: m.cacheCreation,
      work_seconds: m.workSeconds,
    });
    pipe.expire(KEY_DAILY(slug, day), 90 * 86400);
  }

  // Summary
  pipe.hset(KEY_SUMMARY(slug), {
    sessions: aggregate.sessions,
    messages: aggregate.messages,
    tokens_in: aggregate.tokens.input,
    tokens_out: aggregate.tokens.output,
    cache_read: aggregate.tokens.cacheRead,
    cache_creation: aggregate.tokens.cacheCreation,
    active_days: aggregate.activeDays,
    last_scan: new Date().toISOString(),
  });

  // Hourly distribution
  pipe.set(KEY_HOURLY(slug), JSON.stringify(aggregate.hourly));

  // 7-day events for rolling window
  pipe.set(KEY_EVENTS7D(slug), JSON.stringify(aggregate.events7d));

  // Work seconds by day
  pipe.set(KEY_WORK_SECONDS(slug), JSON.stringify(aggregate.workSecondsByDay));

  // Projects ranking
  pipe.set(KEY_PROJECTS(slug), JSON.stringify(aggregate.projects));

  // Last scan time
  pipe.set(KEY_LAST_SCAN(slug), new Date().toISOString());

  await pipe.exec();
}

async function doScan(cfg: TaskBusConfig): Promise<ParseResult | null> {
  if (!cfg.telemetry?.enabled) return null;

  const result = await scanSessions();
  lastLocalScan = statusFromParseResult(result, false);

  if (!cfg.enabled || !cfg.telemetry.uploadEnabled) {
    return result;
  }

  const client = await getRedis(cfg);
  if (!client) return result;

  try {
    await uploadMetrics(client, 'global', result);
    lastLocalScan = statusFromParseResult(result, true);
    return result;
  } finally {
    try {
      client.disconnect();
    } catch {
      /* ignore */
    }
  }
}

export async function startTelemetry(cfg: TaskBusConfig): Promise<void> {
  await stopTelemetry();
  if (!cfg.telemetry?.enabled) return;

  // Immediate first scan
  await doScan(cfg);

  // Periodic scan every 10 minutes
  scanInterval = setInterval(
    async () => {
      await doScan(cfg);
    },
    10 * 60 * 1000
  );
}

export async function stopTelemetry(): Promise<void> {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
}

export async function triggerScan(cfg: TaskBusConfig): Promise<ParseResult | null> {
  return doScan(cfg);
}

export function isTelemetryRunning(): boolean {
  return scanInterval !== null;
}

interface TelemetryStatusResult {
  connected: boolean;
  lastScan: string | null;
  sessions: number;
  messages: number;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheCreation: number;
  activeDays: number;
  hourly: number[];
  projects: Array<{
    cwd: string;
    sessions: number;
    messages: number;
    tokensIn: number;
    tokensOut: number;
  }>;
  workSecondsByDay: Record<string, number>;
}

function statusFromParseResult(result: ParseResult, connected: boolean): TelemetryStatusResult {
  const { aggregate } = result;
  return {
    connected,
    lastScan: new Date().toISOString(),
    sessions: aggregate.sessions,
    messages: aggregate.messages,
    tokensIn: aggregate.tokens.input,
    tokensOut: aggregate.tokens.output,
    cacheRead: aggregate.tokens.cacheRead,
    cacheCreation: aggregate.tokens.cacheCreation,
    activeDays: aggregate.activeDays,
    hourly: aggregate.hourly,
    projects: aggregate.projects,
    workSecondsByDay: aggregate.workSecondsByDay,
  };
}

export async function getTelemetryStatus(
  redisCfg?: TaskBusConfig['redis']
): Promise<TelemetryStatusResult | null> {
  if (!redisCfg) return lastLocalScan;

  let Redis: typeof import('ioredis').default;
  try {
    const mod = await import('ioredis');
    Redis = mod.default;
  } catch {
    return lastLocalScan;
  }

  const cfg = { redis: redisCfg };
  const client = new Redis(redisConfig(cfg as TaskBusConfig));
  client.on('error', () => {
    /* handled by connect/ping fallback */
  });
  try {
    await client.connect();
    await client.ping();
  } catch {
    try {
      client.disconnect();
    } catch {
      /* ignore */
    }
    return lastLocalScan;
  }

  try {
    const [lastScan, summary, hourlyRaw, projectsRaw, workSecondsRaw] = await Promise.all([
      client.get(KEY_LAST_SCAN('global')),
      client.hgetall(KEY_SUMMARY('global')),
      client.get(KEY_HOURLY('global')),
      client.get(KEY_PROJECTS('global')),
      client.get(KEY_WORK_SECONDS('global')),
    ]);

    return {
      connected: true,
      lastScan: lastScan ?? null,
      sessions: Number(summary.sessions ?? 0),
      messages: Number(summary.messages ?? 0),
      tokensIn: Number(summary.tokens_in ?? 0),
      tokensOut: Number(summary.tokens_out ?? 0),
      cacheRead: Number(summary.cache_read ?? 0),
      cacheCreation: Number(summary.cache_creation ?? 0),
      activeDays: Number(summary.active_days ?? 0),
      hourly: hourlyRaw ? JSON.parse(hourlyRaw) : new Array(24).fill(0),
      projects: projectsRaw ? JSON.parse(projectsRaw) : [],
      workSecondsByDay: workSecondsRaw ? JSON.parse(workSecondsRaw) : {},
    };
  } finally {
    try {
      client.disconnect();
    } catch {
      /* ignore */
    }
  }
}
