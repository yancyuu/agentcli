import type { TaskBusConfig } from '@shared/types/team';

/**
 * ioredis expects a bare TCP hostname in `host`. Operator-entered values are
 * often full URLs (`redis://user:pass@host:6379/0`, `rediss://host`, …). The old
 * implementation only stripped the scheme, leaving `user:pass@host:6379/0` as the
 * "host" — which never resolves and silently breaks the team bus + usage
 * reporting. Parse the URL properly and return just the hostname.
 */
export function normalizeRedisHost(host: string | undefined | null): string {
  if (!host) return '';
  const trimmed = host.trim();
  if (!trimmed) return '';
  // Bare hostname / IP (no scheme): return as-is, only trimming a trailing slash.
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    return trimmed.replace(/\/+$/, '');
  }
  // Full URL (redis(s)://[user:pass@]host[:port][/db], http(s)://host): extract hostname.
  try {
    return new URL(trimmed).hostname || '';
  } catch {
    // Malformed URL: fall back to legacy best-effort strip.
    return trimmed.replace(/^(rediss?|https?):\/\//i, '').replace(/\/+$/, '');
  }
}

/** Return a copy of a Redis config with a normalized `host`. */
export function normalizeRedisConfig(cfg: TaskBusConfig['redis']): TaskBusConfig['redis'] {
  if (!cfg) return cfg;
  return { ...cfg, host: normalizeRedisHost(cfg.host) };
}
