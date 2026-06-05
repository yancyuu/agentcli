import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpAPIClient } from '../../../src/renderer/api/httpClient';

type Listener = (event: MessageEvent) => void;
const listeners = new Map<string, Listener>();

class MockEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public readonly url: string) {}
  addEventListener(eventName: string, listener: Listener): void {
    listeners.set(eventName, listener);
  }
  close(): void {}
}

describe('HttpAPIClient terminal API', () => {
  afterEach(() => {
    listeners.clear();
    vi.unstubAllGlobals();
  });

  it('maps terminal commands to HTTP and SSE events', async () => {
    vi.stubGlobal('EventSource', MockEventSource);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/terminal/spawn')) {
        expect(init?.method).toBe('POST');
        expect(init?.body).toBe(JSON.stringify({ command: 'claude', cwd: '/repo' }));
        return new Response(JSON.stringify({ ptyId: 'pty-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new HttpAPIClient('http://127.0.0.1:5681');
    const ptyId = await client.terminal.spawn({ command: 'claude', cwd: '/repo' });
    expect(ptyId).toBe('pty-1');

    client.terminal.write('pty-1', '/help\r');
    client.terminal.resize('pty-1', 100, 30);
    client.terminal.kill('pty-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:5681/api/terminal/pty-1/write',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ data: '/help\r' }) })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:5681/api/terminal/pty-1/resize',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ cols: 100, rows: 30 }) })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:5681/api/terminal/pty-1',
      expect.objectContaining({ method: 'DELETE' })
    );

    const onData = vi.fn();
    const onExit = vi.fn();
    client.terminal.onData(onData);
    client.terminal.onExit(onExit);
    listeners.get('terminal:data')?.(
      new MessageEvent('terminal:data', { data: JSON.stringify({ ptyId: 'pty-1', data: 'hello' }) })
    );
    listeners.get('terminal:exit')?.(
      new MessageEvent('terminal:exit', { data: JSON.stringify({ ptyId: 'pty-1', exitCode: 0 }) })
    );

    expect(onData).toHaveBeenCalledWith(null, 'pty-1', 'hello');
    expect(onExit).toHaveBeenCalledWith(null, 'pty-1', 0);
  });
});
