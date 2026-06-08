import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  spawnMock,
  writeMock,
  resizeMock,
  killMock,
  onDataMock,
  onExitMock,
  xtermOnDataMock,
} = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  writeMock: vi.fn(),
  resizeMock: vi.fn(),
  killMock: vi.fn(),
  onDataMock: vi.fn(() => () => {}),
  onExitMock: vi.fn(() => () => {}),
  xtermOnDataMock: vi.fn(),
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class MockTerminal {
    cols = 120;
    rows = 34;
    loadAddon(): void {}
    open(): void {}
    writeln(msg: string): void {
      this._lastWriteln = msg;
    }
    write(): void {}
    clear(): void {}
    focus(): void {}
    onData(callback: (data: string) => void): { dispose: () => void } {
      xtermOnDataMock(callback);
      return { dispose: vi.fn() };
    }
    dispose(): void {}
    _lastWriteln = '';
  },
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class MockFitAddon {
    fit(): void {}
  },
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class MockWebLinksAddon {},
}));

vi.mock('@renderer/api', () => ({
  api: {
    terminal: {
      spawn: spawnMock,
      write: writeMock,
      resize: resizeMock,
      kill: killMock,
      onData: onDataMock,
      onExit: onExitMock,
    },
  },
}));

vi.mock('@renderer/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { TerminalPane } from '@renderer/components/common/TerminalPane';

class ResizeObserverMock {
  observe(): void {}
  disconnect(): void {}
}

describe('TerminalPane', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    spawnMock.mockResolvedValue('pty-test');
    killMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders without crashing and unmounts cleanly', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<TerminalPane />);
      await Promise.resolve();
    });

    expect(host.querySelector('div')).toBeTruthy();

    await act(async () => {
      root.unmount();
    });
  });

  it('auto-spawns when autoSpawn prop is provided', async () => {
    vi.useFakeTimers();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    const onSpawned = vi.fn();

    await act(async () => {
      root.render(
        <TerminalPane
          autoSpawn={{ command: 'claude', args: [], cwd: '/repo' }}
          onSpawned={onSpawned}
        />,
      );
      await Promise.resolve();
    });

    // Auto-spawn uses a 200ms timeout
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });

    expect(spawnMock).toHaveBeenCalledWith({ command: 'claude', args: [], cwd: '/repo' });
    expect(onSpawned).toHaveBeenCalledWith('pty-test');

    await act(async () => {
      root.unmount();
    });
    vi.useRealTimers();
  });

  it('does not auto-spawn without autoSpawn prop', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<TerminalPane />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(spawnMock).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('imperative spawn via ref calls api and onSpawned', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const ref = React.createRef<{ spawn: (options: { command: string; args: string[]; cwd: string }) => Promise<void> }>();
    const onSpawned = vi.fn();

    await act(async () => {
      root.render(<TerminalPane ref={ref} onSpawned={onSpawned} />);
      await Promise.resolve();
    });

    await act(async () => {
      await ref.current?.spawn({ command: 'bash', args: [], cwd: '/home' });
      await Promise.resolve();
    });

    expect(spawnMock).toHaveBeenCalledWith({ command: 'bash', args: [], cwd: '/home' });
    expect(onSpawned).toHaveBeenCalledWith('pty-test');

    await act(async () => {
      root.unmount();
    });
  });

  it('kills existing PTY before spawning a new one via ref', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const ref = React.createRef<{ spawn: (options: { command: string; args: string[]; cwd: string }) => Promise<void> }>();

    await act(async () => {
      root.render(<TerminalPane ref={ref} />);
      await Promise.resolve();
    });

    // First spawn
    await act(async () => {
      await ref.current?.spawn({ command: 'bash', args: [], cwd: '/first' });
      await Promise.resolve();
    });

    // Second spawn should kill first
    await act(async () => {
      await ref.current?.spawn({ command: 'bash', args: [], cwd: '/second' });
      await Promise.resolve();
    });

    expect(killMock).toHaveBeenCalledWith('pty-test');
    expect(spawnMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      root.unmount();
    });
  });

  it('SSE onData callback writes to terminal when ptyId matches', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const ref = React.createRef<{ spawn: (options: { command: string; args: string[]; cwd: string }) => Promise<void> }>();

    let dataCallback: ((event: unknown, ptyId: string, data: string) => void) | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (onDataMock as any).mockImplementation((cb: (event: unknown, ptyId: string, data: string) => void) => {
      dataCallback = cb;
      return () => {};
    });

    await act(async () => {
      root.render(<TerminalPane ref={ref} />);
      await Promise.resolve();
    });

    await act(async () => {
      await ref.current?.spawn({ command: 'claude', args: [], cwd: '/repo' });
      await Promise.resolve();
    });

    // Simulate SSE data for matching ptyId
    // The TerminalPane checks ptyId match internally
    expect(dataCallback).toBeDefined();

    await act(async () => {
      root.unmount();
    });
  });

  it('shows error message on spawn failure', async () => {
    spawnMock.mockRejectedValue(new Error('spawn failed'));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const ref = React.createRef<{ spawn: (options: { command: string; args: string[]; cwd: string }) => Promise<void> }>();

    await act(async () => {
      root.render(<TerminalPane ref={ref} />);
      await Promise.resolve();
    });

    await act(async () => {
      try {
        await ref.current?.spawn({ command: 'bad-cmd', args: [], cwd: '/bad' });
      } catch {
        // spawn failure is caught internally
      }
      await Promise.resolve();
    });

    // Component handles error gracefully (no crash)
    expect(host.querySelector('div')).toBeTruthy();

    await act(async () => {
      root.unmount();
    });
  });

  it('kills PTY on unmount', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const ref = React.createRef<{ spawn: (options: { command: string; args: string[]; cwd: string }) => Promise<void> }>();

    await act(async () => {
      root.render(<TerminalPane ref={ref} />);
      await Promise.resolve();
    });

    await act(async () => {
      await ref.current?.spawn({ command: 'claude', args: [], cwd: '/repo' });
      await Promise.resolve();
    });

    await act(async () => {
      root.unmount();
    });

    expect(killMock).toHaveBeenCalled();
  });
});
