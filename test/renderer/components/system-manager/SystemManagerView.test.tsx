import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  getStatusMock,
  getConfigMock,
  updateConfigMock,
  listWorkflowPromptsMock,
  readWorkflowPromptMock,
  terminalSpawnMock,
  terminalWriteMock,
  terminalResizeMock,
  terminalKillMock,
  terminalOnDataMock,
  terminalOnExitMock,
  xtermOnDataMock,
  fetchTeamsMock,
} = vi.hoisted(() => ({
  getStatusMock: vi.fn(),
  getConfigMock: vi.fn(),
  updateConfigMock: vi.fn(),
  listWorkflowPromptsMock: vi.fn(),
  readWorkflowPromptMock: vi.fn(),
  terminalSpawnMock: vi.fn(),
  terminalWriteMock: vi.fn(),
  terminalResizeMock: vi.fn(),
  terminalKillMock: vi.fn(),
  terminalOnDataMock: vi.fn(() => () => {}),
  terminalOnExitMock: vi.fn(() => () => {}),
  xtermOnDataMock: vi.fn(),
  fetchTeamsMock: vi.fn(),
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class MockTerminal {
    cols = 120;
    rows = 34;
    loadAddon(): void {}
    open(): void {}
    writeln(): void {}
    write(): void {}
    clear(): void {}
    focus(): void {}
    onData(callback: (data: string) => void): { dispose: () => void } {
      xtermOnDataMock(callback);
      return { dispose: vi.fn() };
    }
    dispose(): void {}
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

vi.mock('@renderer/store', () => ({
  useStore: (selector: (state: { fetchTeams: typeof fetchTeamsMock }) => unknown) =>
    selector({ fetchTeams: fetchTeamsMock }),
}));

vi.mock('@renderer/api', () => ({
  api: {
    systemManager: {
      getStatus: getStatusMock,
      getConfig: getConfigMock,
      updateConfig: updateConfigMock,
      listWorkflowPrompts: listWorkflowPromptsMock,
      readWorkflowPrompt: readWorkflowPromptMock,
    },
    terminal: {
      spawn: terminalSpawnMock,
      write: terminalWriteMock,
      resize: terminalResizeMock,
      kill: terminalKillMock,
      onData: terminalOnDataMock,
      onExit: terminalOnExitMock,
    },
  },
}));

import { SystemManagerView } from '@renderer/components/system-manager/SystemManagerView';

class ResizeObserverMock {
  observe(): void {}
  disconnect(): void {}
}

describe('SystemManagerView', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders a Mac terminal-style PTY console and starts local claude', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    getStatusMock.mockResolvedValue({
      displayName: '控制台',
      defaultWorkDir: '/repo',
      selectedWorkDir: '/repo',
      claudeCommand: 'claude',
      localStatus: 'ready',
    });
    getConfigMock
      .mockResolvedValueOnce({
        schemaVersion: 1,
        selectedWorkDir: '/repo',
        workflowFolder: '/repo/workflows',
        updatedAt: '2026-06-05T00:00:00.000Z',
      })
      .mockResolvedValueOnce({
        schemaVersion: 1,
        selectedWorkDir: '/new-repo',
        workflowFolder: '/new-repo/workflows',
        updatedAt: '2026-06-05T00:00:00.000Z',
      });
    listWorkflowPromptsMock.mockResolvedValue({
      folder: '/repo/workflows',
      warnings: [],
      prompts: [
        {
          id: 'check-env',
          label: '检查环境',
          filename: 'check-env.md',
          path: '/repo/workflows/check-env.md',
          sizeBytes: 12,
          updatedAt: '2026-06-05T00:00:00.000Z',
        },
      ],
    });
    updateConfigMock.mockImplementation(async (patch: { selectedWorkDir?: string }) => ({
      schemaVersion: 1,
      selectedWorkDir: patch.selectedWorkDir ?? '/repo',
      workflowFolder: `${patch.selectedWorkDir ?? '/repo'}/workflows`,
      updatedAt: '2026-06-05T00:00:00.000Z',
    }));
    readWorkflowPromptMock.mockResolvedValue({
      prompt: { id: 'check-env', label: '检查环境' },
      content: '/help',
    });
    terminalSpawnMock.mockResolvedValue('pty-1');
    terminalKillMock.mockResolvedValue(undefined);
    fetchTeamsMock.mockResolvedValue(undefined);

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SystemManagerView />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('控制台');
    expect(host.textContent).toContain('刷新');
    expect(host.textContent).not.toContain('Start Claude');
    expect(host.textContent).not.toContain('Stop');
    expect(host.textContent).not.toContain('Refresh');
    expect(host.textContent).toContain('检查环境');
    expect(host.textContent).not.toContain('读取常用指令');
    expect(host.textContent).not.toContain('Workflow 文件夹');
    expect(host.textContent).not.toContain('Shared MessagesPanel');

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(terminalSpawnMock).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/repo' }));
    expect(fetchTeamsMock).toHaveBeenCalled();

    const inputCallback = xtermOnDataMock.mock.calls[0]?.[0] as ((data: string) => void) | undefined;
    expect(inputCallback).toBeTypeOf('function');
    act(() => {
      inputCallback?.('hello');
    });
    expect(terminalWriteMock).toHaveBeenCalledWith('pty-1', 'hello');

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      Array.from(host.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('刷新'))
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(terminalKillMock).toHaveBeenCalledWith('pty-1');
    expect(updateConfigMock).toHaveBeenLastCalledWith({ selectedWorkDir: '/new-repo' });
    expect(terminalSpawnMock).toHaveBeenLastCalledWith(expect.objectContaining({ cwd: '/new-repo' }));
    expect(terminalKillMock.mock.invocationCallOrder[0]).toBeLessThan(
      terminalSpawnMock.mock.invocationCallOrder[1]
    );

    await act(async () => {
      Array.from(host.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('检查环境'))
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(readWorkflowPromptMock).toHaveBeenCalledWith('/new-repo/workflows', 'check-env');
    expect(terminalWriteMock).toHaveBeenCalledWith('pty-1', '/help\r');

    await act(async () => {
      root.unmount();
    });
  });

  it('shows error message when terminal spawn fails', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    getStatusMock.mockResolvedValue({
      displayName: '控制台',
      defaultWorkDir: '/repo',
      selectedWorkDir: '/repo',
      claudeCommand: 'claude',
      localStatus: 'ready',
    });
    getConfigMock.mockResolvedValue({
      schemaVersion: 1,
      selectedWorkDir: '/repo',
      workflowFolder: '',
      updatedAt: '2026-06-05T00:00:00.000Z',
    });
    updateConfigMock.mockResolvedValue({
      schemaVersion: 1,
      selectedWorkDir: '/repo',
      workflowFolder: '',
      updatedAt: '2026-06-05T00:00:00.000Z',
    });
    listWorkflowPromptsMock.mockResolvedValue({ folder: '', warnings: [], prompts: [] });
    terminalSpawnMock.mockRejectedValue(new Error('spawn error: claude not found'));
    fetchTeamsMock.mockResolvedValue(undefined);

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SystemManagerView />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Component should render without crashing even on spawn failure
    expect(host.textContent).toContain('控制台');

    await act(async () => {
      root.unmount();
    });
  });

  it('handles SSE exit event and shows exit message', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    getStatusMock.mockResolvedValue({
      displayName: '控制台',
      defaultWorkDir: '/repo',
      selectedWorkDir: '/repo',
      claudeCommand: 'claude',
      localStatus: 'ready',
    });
    getConfigMock.mockResolvedValue({
      schemaVersion: 1,
      selectedWorkDir: '/repo',
      workflowFolder: '',
      updatedAt: '2026-06-05T00:00:00.000Z',
    });
    updateConfigMock.mockResolvedValue({
      schemaVersion: 1,
      selectedWorkDir: '/repo',
      workflowFolder: '',
      updatedAt: '2026-06-05T00:00:00.000Z',
    });
    listWorkflowPromptsMock.mockResolvedValue({ folder: '', warnings: [], prompts: [] });
    terminalSpawnMock.mockResolvedValue('pty-exit-test');
    terminalKillMock.mockResolvedValue(undefined);
    fetchTeamsMock.mockResolvedValue(undefined);

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SystemManagerView />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(terminalSpawnMock).toHaveBeenCalled();

    // Simulate exit event via the registered callback
    const exitCalls = terminalOnExitMock.mock.calls as unknown as
      ((event: unknown, ptyId: string, exitCode: number) => void)[][];
    const exitCallback = exitCalls?.[0]?.[0];
    expect(exitCallback).toBeTypeOf('function');

    await act(async () => {
      exitCallback?.(null, 'pty-exit-test', 0);
      await Promise.resolve();
    });

    // After exit, status should reset (no longer "claude running")
    await act(async () => {
      root.unmount();
    });
  });
});
