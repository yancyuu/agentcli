import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('dwDiagnostics', () => {
  let tmpHome;
  let previousHome;
  let mod;

  beforeEach(async () => {
    tmpHome = mkdtempSync(path.join(os.tmpdir(), 'dw-diag-'));
    previousHome = process.env.HERMIT_HOME;
    process.env.HERMIT_HOME = tmpHome;
    // Fresh module instance per test so hermitHome is re-read.
    vi.resetModules();
    mod = await import('../dwDiagnostics.mjs');
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.HERMIT_HOME;
    else process.env.HERMIT_HOME = previousHome;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  function readEvents() {
    const file = path.join(tmpHome, 'logs', 'digital-worker.ndjson');
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf-8').trim().split('\n').map((line) => JSON.parse(line));
  }

  it('appends NDJSON events with timestamps', () => {
    mod.logDwEvent('dw.test', { bindProject: 'demo', ok: true });
    mod.logDwEvent('dw.test2', {});
    const events = readEvents();
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ event: 'dw.test', bindProject: 'demo', ok: true });
    expect(events[0].ts).toBeTruthy();
  });

  it('redacts secret-looking fields to length only', () => {
    mod.logDwEvent('dw.secret', {
      appSecret: 'super-secret-value',
      accessToken: 'tok-123',
      nested: { app_secret: 'abc', keep: 'visible' },
      message: 'plain',
    });
    const [event] = readEvents();
    expect(event.appSecret).toBe('<redacted:18>');
    expect(event.accessToken).toBe('<redacted:7>');
    expect(event.nested.keep).toBe('visible');
    expect(event.nested.app_secret).toBeUndefined();
    expect(event.message).toBe('plain');
    expect(JSON.stringify(event)).not.toContain('super-secret-value');
  });

  it('measureDwStage logs ok with duration and returns the result', async () => {
    const result = await mod.measureDwStage('dw.stage', async () => 42, { bindProject: 'p' });
    expect(result).toBe(42);
    const events = readEvents();
    expect(events.map((e) => e.event)).toEqual(['dw.stage.start', 'dw.stage.ok']);
    expect(events[1].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('measureDwStage logs fail with the error message and rethrows', async () => {
    await expect(
      mod.measureDwStage('dw.stage', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    const events = readEvents();
    expect(events.map((e) => e.event)).toEqual(['dw.stage.start', 'dw.stage.fail']);
    expect(events[1].message).toBe('boom');
    expect(events[1].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('never throws even when the log directory is not writable', () => {
    // Point HERMIT_HOME at a path that is a FILE, so mkdir/append must fail.
    const blocker = path.join(tmpHome, 'blocker');
    require('node:fs').writeFileSync(blocker, 'x');
    process.env.HERMIT_HOME = blocker;
    expect(() => mod.logDwEvent('dw.test', { a: 1 })).not.toThrow();
  });
});
