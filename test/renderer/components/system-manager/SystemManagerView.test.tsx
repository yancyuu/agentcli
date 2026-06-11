import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  getStatusMock,
  getConfigMock,
  updateConfigMock,
  listWorkflowPromptsMock,
  readWorkflowPromptMock,
  terminalOpenExternalMock,
  fetchTeamsMock,
} = vi.hoisted(() => ({
  getStatusMock: vi.fn(),
  getConfigMock: vi.fn(),
  updateConfigMock: vi.fn(),
  listWorkflowPromptsMock: vi.fn(),
  readWorkflowPromptMock: vi.fn(),
  terminalOpenExternalMock: vi.fn(),
  fetchTeamsMock: vi.fn(),
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
      openExternal: terminalOpenExternalMock,
    },
  },
}));

import { SystemManagerView } from '@renderer/components/system-manager/SystemManagerView';

function renderSystemManager(): { host: HTMLDivElement; root: ReturnType<typeof createRoot> } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  return { host, root };
}

function baseStatus() {
  return {
    displayName: '控制台' as const,
    defaultWorkDir: '/repo',
    selectedWorkDir: '/repo',
    claudeCommand: 'claude' as const,
    localStatus: 'ready' as const,
  };
}

function baseConfig(workDir = '/repo') {
  return {
    schemaVersion: 1 as const,
    selectedWorkDir: workDir,
    workflowFolder: `${workDir}/workflows`,
    updatedAt: '2026-06-05T00:00:00.000Z',
  };
}

describe('SystemManagerView', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('renders external-terminal loop console and loads workflow commands', async () => {
    getStatusMock.mockResolvedValue(baseStatus());
    getConfigMock.mockResolvedValue(baseConfig());
    updateConfigMock.mockImplementation(async (patch: { selectedWorkDir?: string }) =>
      baseConfig(patch.selectedWorkDir ?? '/repo')
    );
    listWorkflowPromptsMock.mockResolvedValueOnce({
      folder: '/repo/.claude/commands',
      warnings: [],
      prompts: [
        {
          id: 'loop-scan',
          label: 'Loop Scan',
          filename: 'loop-scan.md',
          path: '/repo/.claude/commands/loop-scan.md',
          folder: '/repo/.claude/commands',
          sizeBytes: 12,
          updatedAt: '2026-06-05T00:00:00.000Z',
          source: 'claude-command',
          commandName: '/loop-scan',
          safety: 'read-only',
          description: '扫描循环资产',
          builtin: true,
          order: 5,
        },
      ],
    });
    listWorkflowPromptsMock.mockResolvedValue({ folder: '/repo/workflows', warnings: [], prompts: [] });
    terminalOpenExternalMock.mockResolvedValue(undefined);
    fetchTeamsMock.mockResolvedValue(undefined);

    const { host, root } = renderSystemManager();

    await act(async () => {
      root.render(<SystemManagerView />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Loop Console');
    expect(host.textContent).toContain('打开终端');
    expect(host.textContent).toContain('Loop Scan');
    expect(host.textContent).toContain('read-only');
    expect(host.textContent).not.toContain('Terminal input');
    expect(host.textContent).not.toContain('claude running');
    expect(listWorkflowPromptsMock).toHaveBeenCalledWith('/repo/.claude/commands');

    await act(async () => {
      root.unmount();
    });
  });

  it('opens the default terminal in the selected workspace', async () => {
    getStatusMock.mockResolvedValue(baseStatus());
    getConfigMock.mockResolvedValue(baseConfig());
    updateConfigMock.mockResolvedValue(baseConfig('/repo'));
    listWorkflowPromptsMock.mockResolvedValue({ folder: '/repo/.claude/commands', warnings: [], prompts: [] });
    terminalOpenExternalMock.mockResolvedValue(undefined);
    fetchTeamsMock.mockResolvedValue(undefined);

    const { host, root } = renderSystemManager();

    await act(async () => {
      root.render(<SystemManagerView />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      Array.from(host.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('打开终端'))
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updateConfigMock).toHaveBeenCalledWith({ selectedWorkDir: '/repo' });
    expect(terminalOpenExternalMock).toHaveBeenCalledWith({
      command: 'claude',
      args: undefined,
      cwd: '/repo',
    });
    expect(fetchTeamsMock).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('opens a workflow slash command in the default terminal', async () => {
    getStatusMock.mockResolvedValue(baseStatus());
    getConfigMock.mockResolvedValue(baseConfig());
    updateConfigMock.mockResolvedValue(baseConfig('/repo'));
    listWorkflowPromptsMock.mockResolvedValueOnce({
      folder: '/repo/.claude/commands',
      warnings: [],
      prompts: [
        {
          id: 'loop-design',
          label: 'Loop Design',
          filename: 'loop-design.md',
          path: '/repo/.claude/commands/loop-design.md',
          folder: '/repo/.claude/commands',
          sizeBytes: 12,
          updatedAt: '2026-06-05T00:00:00.000Z',
          source: 'claude-command',
          commandName: '/loop-design',
          safety: 'proposal-only',
          description: '设计循环',
          builtin: true,
          order: 70,
        },
      ],
    });
    listWorkflowPromptsMock.mockResolvedValue({ folder: '/repo/workflows', warnings: [], prompts: [] });
    terminalOpenExternalMock.mockResolvedValue(undefined);
    fetchTeamsMock.mockResolvedValue(undefined);

    const { host, root } = renderSystemManager();

    await act(async () => {
      root.render(<SystemManagerView />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      Array.from(host.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Loop Design'))
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(readWorkflowPromptMock).not.toHaveBeenCalled();
    expect(terminalOpenExternalMock).toHaveBeenCalledWith({
      command: 'claude',
      args: ['/loop-design'],
      cwd: '/repo',
    });

    await act(async () => {
      root.unmount();
    });
  });

  it('passes custom workflow content to claude -p in the default terminal', async () => {
    getStatusMock.mockResolvedValue(baseStatus());
    getConfigMock.mockResolvedValue(baseConfig());
    updateConfigMock.mockResolvedValue(baseConfig('/repo'));
    listWorkflowPromptsMock.mockResolvedValueOnce({ folder: '/repo/.claude/commands', warnings: [], prompts: [] });
    listWorkflowPromptsMock.mockResolvedValueOnce({
      folder: '/repo/workflows',
      warnings: [],
      prompts: [
        {
          id: 'nightly-triage',
          label: 'Nightly Triage',
          filename: 'nightly-triage.md',
          path: '/repo/workflows/nightly-triage.md',
          folder: '/repo/workflows',
          sizeBytes: 48,
          updatedAt: '2026-06-05T00:00:00.000Z',
          source: 'workflow-folder',
          description: 'Triage loop',
        },
      ],
    });
    listWorkflowPromptsMock.mockResolvedValue({ folder: '/repo/workflows', warnings: [], prompts: [] });
    readWorkflowPromptMock.mockResolvedValue({
      prompt: {
        id: 'nightly-triage',
        label: 'Nightly Triage',
        filename: 'nightly-triage.md',
        path: '/repo/workflows/nightly-triage.md',
        folder: '/repo/workflows',
        sizeBytes: 48,
        updatedAt: '2026-06-05T00:00:00.000Z',
        source: 'workflow-folder',
        description: 'Triage loop',
      },
      content: 'Scan failures\nThen propose next Loop actions',
    });
    terminalOpenExternalMock.mockResolvedValue(undefined);
    fetchTeamsMock.mockResolvedValue(undefined);

    const { host, root } = renderSystemManager();

    await act(async () => {
      root.render(<SystemManagerView />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      Array.from(host.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Nightly Triage'))
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(readWorkflowPromptMock).toHaveBeenCalledWith('/repo/workflows', 'nightly-triage');
    expect(terminalOpenExternalMock).toHaveBeenCalledWith({
      command: 'claude',
      args: ['-p', 'Scan failures\nThen propose next Loop actions'],
      cwd: '/repo',
    });

    await act(async () => {
      root.unmount();
    });
  });
});
