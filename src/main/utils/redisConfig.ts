import type { TaskBusConfig } from '@shared/types/team';

/**
 * ioredis expects a bare TCP hostname in `host`. A URL like
 * `http://redis.example.com` is passed verbatim to the socket and fails DNS
 * resolution, so the connection never comes up — silently breaking both the
 * team bus and usage reporting. Strip any scheme / trailing slash so
 * operator-entered URLs work without manual cleanup.
 */
export function normalizeRedisHost(host: string | undefined | null): string {
  if (!host) return '';
  return host
    .trim()
    .replace(/^(rediss?|https?):\/\//i, '')
    .replace(/\/+$/, '');
}

/** Return a copy of a Redis config with a normalized `host`. */
export function normalizeRedisConfig(cfg: TaskBusConfig['redis']): TaskBusConfig['redis'] {
  if (!cfg) return cfg;
  return { ...cfg, host: normalizeRedisHost(cfg.host) };
}
