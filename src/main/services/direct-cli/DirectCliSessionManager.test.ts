import { EventEmitter } from 'events';

import type { SpawnOptions } from 'child_process';

import { describe, expect, it } from 'vitest';

import {
  buildClaudeStreamArgs,
  DirectCliSessionManager,
  formatClaudeStdinUserTurn,
} from './DirectCliSessionManager';

/** Minimal fake ChildProcess: stdout/stderr/stdin as EventEmitters + kill. */
interface FakeChild {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: (data: string) => boolean; destroyed: boolean };
  kill: (signal?: string) => void;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  emitExit: (code: number | null) => void;
}

function createFakeChild(): FakeChild {
  const bus = new EventEmitter();
  const child: FakeChild = {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: { write: () => true, destroyed: false },
    kill: () => undefined,
    on: (event, cb) => bus.on(event, cb),
    emitExit: (code) => bus.emit('exit', code),
  };
  return child;
}

function createManager(providerArgs: string[] = []): {
  manager: DirectCliSessionManager;
  child: FakeChild;
} {
  const child = createFakeChild();
  const manager = new DirectCliSessionManager({
    spawnFn: () => child as unknown as import('child_process').ChildProcess,
    envResolver: async () => ({ env: { PATH: '/fake' }, providerArgs }),
    binaryResolver: { resolve: async () => '/fake/claude' } as never,
    store: new Map<string, string>() as never,
  });
  return { manager, child };
}

describe('buildClaudeStreamArgs', () => {
  it('emits the base stream-json flags with --verbose by default', () => {
    expect(buildClaudeStreamArgs()).toEqual([
      '--output-format',
      'stream-json',
      '--input-format',
      'stream-json',
      '--permission-prompt-tool',
      'stdio',
      '--verbose',
    ]);
  });

  it('adds --resume / --append-system-prompt / provider args when provided', () => {
    expect(
      buildClaudeStreamArgs({
        resumeSessionId: 'sid-1',
        appendSystemPrompt: 'You are admin.',
        verbose: false,
        providerArgs: ['--model', 'opus'],
      })
    ).toEqual([
      '--output-format',
      'stream-json',
      '--input-format',
      'stream-json',
      '--permission-prompt-tool',
      'stdio',
      // no --verbose because verbose:false
      '--resume',
      'sid-1',
      '--append-system-prompt',
      'You are admin.',
      '--model',
      'opus',
    ]);
  });

  it('omits --resume / --append-system-prompt when their values are blank', () => {
    const args = buildClaudeStreamArgs({ resumeSessionId: '   ', appendSystemPrompt: '' });
    expect(args).not.toContain('--resume');
    expect(args).not.toContain('--append-system-prompt');
  });
});

describe('formatClaudeStdinUserTurn', () => {
  it('produces a single NDJSON user line terminated by a newline', () => {
    const out = formatClaudeStdinUserTurn('fix the bug');
    expect(out.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(out.trim());
    expect(parsed).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'fix the bug' }] },
    });
  });
});

describe('DirectCliSessionManager', () => {
  it('spawns on first ensureSession with cwd=workDir and base args', async () => {
    let spawnArgs: string[] = [];
    let spawnOpts: SpawnOptions = {};
    const child = createFakeChild();
    const manager = new DirectCliSessionManager({
      spawnFn: (_bin, args, opts) => {
        spawnArgs = args;
        spawnOpts = opts;
        return child as unknown as import('child_process').ChildProcess;
      },
      envResolver: async () => ({ env: { X: '1' }, providerArgs: [] }),
      binaryResolver: { resolve: async () => '/fake/claude' } as never,
      store: new Map<string, string>() as never,
    });

    await manager.ensureSession({ sessionKey: 't:lead', workDir: '/proj' });

    expect(manager.has('t:lead')).toBe(true);
    expect(spawnOpts.cwd).toBe('/proj');
    expect(spawnOpts.env).toEqual({ X: '1' });
    expect(spawnArgs).toContain('--output-format');
    expect(spawnArgs).toContain('stream-json');
    expect(spawnArgs).toContain('--verbose');
  });

  it('does not spawn twice for the same session key (dedupes concurrent ensureSession)', async () => {
    let spawnCount = 0;
    const child = createFakeChild();
    const manager = new DirectCliSessionManager({
      spawnFn: () => {
        spawnCount += 1;
        return child as unknown as import('child_process').ChildProcess;
      },
      envResolver: async () => ({ env: {}, providerArgs: [] }),
      binaryResolver: { resolve: async () => '/fake/claude' } as never,
      store: new Map<string, string>() as never,
    });

    await Promise.all([
      manager.ensureSession({ sessionKey: 't:lead', workDir: '/proj' }),
      manager.ensureSession({ sessionKey: 't:lead', workDir: '/proj' }),
    ]);
    await manager.ensureSession({ sessionKey: 't:lead', workDir: '/proj' });

    expect(spawnCount).toBe(1);
  });

  it('emits init → delta → tool → complete for a real stream and captures session id', async () => {
    const { manager, child } = createManager(['--model', 'sonnet']);

    const events: string[] = [];
    manager.on('event', (e: { kind: string }) => events.push(e.kind));

    await manager.send('t:lead', { text: 'fixbug', messageId: 'm1', workDir: '/proj' });

    // system init carries the claude session id (captured for --resume next time)
    child.stdout.emit(
      'data',
      JSON.stringify({ type: 'system', session_id: 'claude-sid-9', model: 'claude-sonnet-4-6' }) +
        '\n'
    );
    // assistant text delta
    child.stdout.emit(
      'data',
      JSON.stringify({
        type: 'assistant',
        message: { id: 'msg_1', content: [{ type: 'text', text: 'working on it' }] },
      }) + '\n'
    );
    // assistant tool_use
    child.stdout.emit(
      'data',
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'tu', name: 'Bash', input: { command: 'ls' } }],
        },
      }) + '\n'
    );
    // result
    child.stdout.emit(
      'data',
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'done',
        session_id: 'claude-sid-9',
      }) + '\n'
    );

    expect(events).toEqual(['init', 'delta', 'tool', 'complete']);
    // getSessionId reads the handle's captured session id
    expect(manager.getSessionId('t:lead')).toBe('claude-sid-9');
  });

  it('writes the user turn to stdin as NDJSON on send', async () => {
    const child = createFakeChild();
    let written = '';
    child.stdin.write = (data: string) => {
      written = data;
      return true;
    };
    const manager = new DirectCliSessionManager({
      spawnFn: () => child as unknown as import('child_process').ChildProcess,
      envResolver: async () => ({ env: {}, providerArgs: [] }),
      binaryResolver: { resolve: async () => '/fake/claude' } as never,
      store: new Map<string, string>() as never,
    });
    await manager.send('t:lead', { text: 'hello', messageId: 'm1', workDir: '/proj' });
    expect(JSON.parse(written.trim())).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    });
  });

  it('falls back to accumulated text when result has no result field', async () => {
    const { manager, child } = createManager();
    await manager.send('t:lead', { text: 'x', messageId: 'm1', workDir: '/proj' });
    child.stdout.emit(
      'data',
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'partial reply' }] },
      }) + '\n'
    );
    let completeText = '';
    manager.on('event', (e: { kind: string; text?: string }) => {
      if (e.kind === 'complete') completeText = e.text ?? '';
    });
    child.stdout.emit('data', JSON.stringify({ type: 'result', subtype: 'success' }) + '\n');
    expect(completeText).toBe('partial reply');
  });

  it('ignores parse-error and unknown lines without emitting', async () => {
    const { manager, child } = createManager();
    await manager.send('t:lead', { text: 'x', messageId: 'm1', workDir: '/proj' });
    const events: string[] = [];
    manager.on('event', (e: { kind: string }) => events.push(e.kind));
    child.stdout.emit('data', 'this is not json\n');
    child.stdout.emit('data', JSON.stringify({ type: 'stream_event' }) + '\n');
    expect(events).toEqual([]);
  });

  it('emits error and drops the handle when the process exits non-zero mid-turn', async () => {
    const { manager, child } = createManager();
    const events: { kind: string; error?: string }[] = [];
    manager.on('event', (e: { kind: string; error?: string }) => events.push(e));
    await manager.send('t:lead', { text: 'x', messageId: 'm1', workDir: '/proj' });
    child.emitExit(1);
    expect(events.some((e) => e.kind === 'error')).toBe(true);
    expect(manager.has('t:lead')).toBe(false);
  });

  it('synthesizes a complete event on clean exit mid-turn (no stuck bubble)', async () => {
    const { manager, child } = createManager();
    const events: { kind: string; text?: string }[] = [];
    manager.on('event', (e: { kind: string; text?: string }) => events.push(e));
    await manager.send('t:lead', { text: 'x', messageId: 'm1', workDir: '/proj' });
    // No `result` line ever arrives — claude exits cleanly (e.g. bailed after a
    // permission prompt). The turn must still terminate so the optimistic bubble
    // doesn't hang forever.
    child.emitExit(0);
    expect(events.some((e) => e.kind === 'complete')).toBe(true);
    expect(manager.has('t:lead')).toBe(false);
  });

  it('shutdown kills all live sessions', async () => {
    const killed: string[] = [];
    const child = createFakeChild();
    child.kill = (signal?: string) => {
      killed.push(signal ?? 'none');
    };
    const manager = new DirectCliSessionManager({
      spawnFn: () => child as unknown as import('child_process').ChildProcess,
      envResolver: async () => ({ env: {}, providerArgs: [] }),
      binaryResolver: { resolve: async () => '/fake/claude' } as never,
      store: new Map<string, string>() as never,
    });
    await manager.ensureSession({ sessionKey: 'a:lead', workDir: '/p' });
    await manager.ensureSession({ sessionKey: 'b:lead', workDir: '/p' });
    manager.shutdown();
    expect(killed.length).toBe(2);
    expect(manager.has('a:lead')).toBe(false);
  });

  it('throws a clear error when workDir is missing', async () => {
    const manager = new DirectCliSessionManager({
      spawnFn: () => createFakeChild() as unknown as import('child_process').ChildProcess,
      envResolver: async () => ({ env: {}, providerArgs: [] }),
      binaryResolver: { resolve: async () => '/fake/claude' } as never,
      store: new Map<string, string>() as never,
    });
    await expect(manager.ensureSession({ sessionKey: 't:lead', workDir: '' })).rejects.toThrow(
      /workDir/
    );
  });
});
