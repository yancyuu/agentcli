import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ImLiveWatcher } from '../ImLiveWatcher';

import type { ImLiveWorker } from '@shared/types/imLiveWorker';

const NOW = Date.parse('2026-06-21T13:00:00+08:00');

/** Raw hermit-bridge session-store shape (see hermitBridgeSessionStore.ts). */
function rawStore(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessions: {
      s1: {
        agent_session_id: 'claude-im-1',
        agent_type: 'claude',
        name: 'r1',
        history: [
          { role: 'user', content: '帮我跑测试', timestamp: new Date(NOW - 5_000).toISOString() },
          {
            role: 'assistant',
            content: '好的，这就跑',
            timestamp: new Date(NOW - 2_000).toISOString(),
          },
        ],
        created_at: new Date(NOW - 60_000).toISOString(),
        updated_at: new Date(NOW - 2_000).toISOString(),
      },
    },
    active_session: { 'feishu:oc_CHAT:ou_SENDER': 'claude-im-1' },
    user_sessions: { 'feishu:oc_CHAT:ou_SENDER': ['claude-im-1'] },
    user_meta: { 'feishu:oc_CHAT:ou_SENDER': { chat_name: '产品群', user_name: '老王' } },
    counter: {},
    past_id_tracking: {},
    version: 1,
    ...overrides,
  };
}

describe('ImLiveWatcher', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'im-live-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('scan() reads every *.json in the dir, detects workers, and emits them', async () => {
    // Underscored project name exercises projectFromFileName (keeps the stem).
    writeFileSync(path.join(dir, 'hermit开发_abc12345.json'), JSON.stringify(rawStore()));
    const emitted: ImLiveWorker[][] = [];
    const watcher = new ImLiveWatcher({
      sessionsDir: dir,
      emit: (w) => emitted.push(w),
      now: () => NOW,
    });

    await watcher.scan();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toHaveLength(1);
    expect(emitted[0][0]).toMatchObject({
      agentSessionId: 'claude-im-1',
      state: 'busy',
      project: 'hermit开发',
      chatName: '产品群',
      senderName: '老王',
      lastUserSnippet: '帮我跑测试',
    });
    watcher.stop();
  });

  it('scan() ignores non-json files and corrupt json without throwing', async () => {
    writeFileSync(path.join(dir, 'p_abc12345.json'), JSON.stringify(rawStore()));
    writeFileSync(path.join(dir, 'readme.txt'), 'not json');
    writeFileSync(path.join(dir, 'broken_deadbeef.json'), '{not valid json');
    const emitted: ImLiveWorker[][] = [];
    const watcher = new ImLiveWatcher({
      sessionsDir: dir,
      emit: (w) => emitted.push(w),
      now: () => NOW,
    });

    await watcher.scan();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toHaveLength(1); // only the one valid store yielded a worker
    watcher.stop();
  });

  it('scan() emits an empty list when the sessions dir is missing', async () => {
    const missing = path.join(dir, 'does-not-exist');
    const emitted: ImLiveWorker[][] = [];
    const watcher = new ImLiveWatcher({
      sessionsDir: missing,
      emit: (w) => emitted.push(w),
      now: () => NOW,
    });

    await watcher.scan();

    expect(emitted).toEqual([[]]);
    watcher.stop();
  });

  it('scan() reflects newly-added files on the next call (watchdog re-scan contract)', async () => {
    const emitted: ImLiveWorker[][] = [];
    const watcher = new ImLiveWatcher({
      sessionsDir: dir,
      emit: (w) => emitted.push(w),
      now: () => NOW,
    });

    await watcher.scan();
    expect(emitted.at(-1)).toEqual([]);

    writeFileSync(path.join(dir, 'p_abc12345.json'), JSON.stringify(rawStore()));
    await watcher.scan();

    expect(emitted.at(-1)).toHaveLength(1);
    watcher.stop();
  });

  it('start() then stop() does not throw and cleans up without leaking emits', async () => {
    writeFileSync(path.join(dir, 'p_abc12345.json'), JSON.stringify(rawStore()));
    const emitted: ImLiveWorker[][] = [];
    const watcher = new ImLiveWatcher({
      sessionsDir: dir,
      emit: (w) => emitted.push(w),
      now: () => NOW,
      intervalMs: 5_000,
    });

    expect(() => watcher.start()).not.toThrow();
    // drain the initial fire-and-forget async scan (it does real file IO)
    for (let i = 0; i < 50 && emitted.length === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 0));
    }
    watcher.stop();

    expect(emitted.length).toBeGreaterThanOrEqual(1);
    expect(emitted[0]).toHaveLength(1);
  });

  it('does not attach a filesystem watcher when run from a missing dir (self-heals via watchdog only)', async () => {
    const missing = path.join(dir, 'nope');
    const emitted: ImLiveWorker[][] = [];
    const watcher = new ImLiveWatcher({
      sessionsDir: missing,
      emit: (w) => emitted.push(w),
      now: () => NOW,
    });

    await watcher.scan();

    expect(emitted).toEqual([[]]);
    // stop must still be safe even though nothing was attached
    expect(() => watcher.stop()).not.toThrow();
  });
});
