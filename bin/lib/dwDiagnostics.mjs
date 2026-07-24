// dwDiagnostics.mjs — structured milestone log for the digital-worker
// provisioning flow (团队创建 → cc-connect 运行时 → 扫码绑定 → 个人授权 →
// restart/rollback). These steps fail differently on different machines
// (Windows spawn quirks, cc-connect 500s, lark-cli version drift, DPAPI…),
// and the interactive CLI output is gone once the terminal closes — this
// NDJSON trail is the post-mortem record. One line per event, appended to
// ~/.hermit/logs/digital-worker.ndjson.
//
// Rules:
// - NEVER log secrets: app_secret, tokens, device codes, Authorization
//   headers. Only ids, statuses, durations and sanitized error text.
// - Never throw: diagnostics must not change the flow's outcome.
// - Bounded: the file is truncated (oldest half dropped) past MAX_BYTES.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { hermitHome } from './env.mjs';

const MAX_BYTES = 2 * 1024 * 1024;

const SECRET_KEY = /secret|token|password|credential|device_?code|authorization|verify|ticket|access_?key/i;

function sanitizeValue(key, value) {
  if (value == null) return value;
  if (SECRET_KEY.test(key)) {
    const text = String(value);
    return text.length ? `<redacted:${text.length}>` : '';
  }
  if (value instanceof Error) return value.message;
  if (typeof value === 'object') {
    try {
      return JSON.parse(JSON.stringify(value, (k, v) => (SECRET_KEY.test(k) ? undefined : v)));
    } catch {
      return String(value);
    }
  }
  return value;
}

export function dwLogPath() {
  return path.join(hermitHome, 'logs', 'digital-worker.ndjson');
}

/**
 * Append one milestone event. `fields` should be small and flat; secret-looking
 * keys are redacted to their length only.
 */
export function logDwEvent(event, fields = {}) {
  try {
    const file = dwLogPath();
    mkdirSync(path.dirname(file), { recursive: true });
    if (existsSync(file) && statSync(file).size > MAX_BYTES) {
      const old = readFileSync(file, 'utf-8');
      writeFileSync(file, old.slice(old.length / 2), 'utf-8');
    }
    const safe = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) safe[key] = sanitizeValue(key, value);
    }
    appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), event, ...safe })}\n`, 'utf-8');
  } catch {
    /* diagnostics must never break the flow */
  }
}

/**
 * Measure a stage: logs `<event>.start` and `<event>.ok`/`<event>.fail` with
 * durationMs, re-throwing any error after logging it (message only).
 */
export async function measureDwStage(event, fn, fields = {}) {
  const startedAt = Date.now();
  logDwEvent(`${event}.start`, fields);
  try {
    const result = await fn();
    logDwEvent(`${event}.ok`, { ...fields, durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    logDwEvent(`${event}.fail`, {
      ...fields,
      durationMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
