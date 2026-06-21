import { describe, expect, it } from 'vitest';

import { normalizeRedisConfig, normalizeRedisHost } from './redisConfig';

describe('normalizeRedisHost', () => {
  it('strips http:// and https:// schemes', () => {
    expect(normalizeRedisHost('http://redis.example.com')).toBe('redis.example.com');
    expect(normalizeRedisHost('https://redis.example.com')).toBe('redis.example.com');
  });

  it('strips redis:// and rediss:// schemes', () => {
    expect(normalizeRedisHost('redis://redis.example.com')).toBe('redis.example.com');
    expect(normalizeRedisHost('rediss://redis.example.com')).toBe('redis.example.com');
  });

  it('leaves a bare hostname untouched', () => {
    expect(normalizeRedisHost('redis.example.com')).toBe('redis.example.com');
    expect(normalizeRedisHost('127.0.0.1')).toBe('127.0.0.1');
  });

  it('trims whitespace and trailing slashes', () => {
    expect(normalizeRedisHost('  http://redis.example.com/  ')).toBe('redis.example.com');
    expect(normalizeRedisHost('redis.example.com/')).toBe('redis.example.com');
  });

  it('returns empty string for nil/empty input', () => {
    expect(normalizeRedisHost(undefined)).toBe('');
    expect(normalizeRedisHost(null)).toBe('');
    expect(normalizeRedisHost('')).toBe('');
  });
});

describe('normalizeRedisConfig', () => {
  it('normalizes host while preserving the rest of the config', () => {
    const cfg = {
      host: 'http://redis.lazymind.vip',
      port: 6379,
      password: 'secret',
      db: 1,
    };
    expect(normalizeRedisConfig(cfg)).toEqual({
      host: 'redis.lazymind.vip',
      port: 6379,
      password: 'secret',
      db: 1,
    });
  });

  it('does not mutate the input config', () => {
    const cfg = { host: 'http://redis.example.com', port: 6379 };
    normalizeRedisConfig(cfg);
    expect(cfg.host).toBe('http://redis.example.com');
  });
});
