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
  ensureSystemManagerMock,
  getTeamDataMock,
  getTeamSessionsMock,
  createLoopSessionMock,
  refreshTeamMessagesHeadMock,
  loopConsolePanelPropsMock,
  runtimeConfigDialogPropsMock,
} = vi.hoisted(() => ({
  getStatusMock: vi.fn(),
  getConfigMock: vi.fn(),
  updateConfigMock: vi.fn(),
  listWorkflowPromptsMock: vi.fn(),
  readWorkflowPromptMock: vi.fn(),
  terminalOpenExternalMock: vi.fn(),
  fetchTeamsMock: vi.fn(),
  ensureSystemManagerMock: vi.fn(),
  getTeamDataMock: vi.fn(),
  getTeamSessionsMock: vi.fn(),
  createLoopSessionMock: vi.fn(),
  refreshTeamMessagesHeadMock: vi.fn(),
  loopConsolePanelPropsMock: vi.fn(),
  runtimeConfigDialogPropsMock: vi.fn(),
}));

const storeState = {
  fetchTeams: fetchTeamsMock,
  refreshTeamMessagesHead: refreshTeamMessagesHeadMock,
};

vi.mock('@renderer/store', () => {
  const useStore = (selector: (state: typeof storeState) => unknown) => selector(storeState);
  useStore.getState = () => storeState;
  return { useStore };
});

vi.mock('@renderer/components/team/loop-console/LoopConsolePanel', () => ({
  LoopConsolePanel: (props: { commandSuggestions?: Array<{ command?: string; name?: string }> }) => {
    loopConsolePanelPropsMock(props);
    return <div data-testid="admin-loop-panel">Embedded Admin Loop Panel</div>;
  },
}));

vi.mock('@renderer/components/team/dialogs/RuntimeConfigDialog', () => ({
  RuntimeConfigDialog: (props: { open: boolean; teamName: string; onClose: () => void }) => {
    runtimeConfigDialogPropsMock(props);
    return props.open ? <div data-testid="admin-runtime-config">Admin runtime config</div> : null;
  },
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
    teams: {
      ensureSystemManager: ensureSystemManagerMock,
      getData: getTeamDataMock,
      getTeamSessions: getTeamSessionsMock,
      createLoopSession: createLoopSessionMock,
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
    displayName: 'Admin Loop' as const,
    defaultWorkDir: '/repo',
    selectedWorkDir: '/repo',
    globalHermitWorkflowFolder: '/Users/test/.claude/commands/hermit',
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

function baseTeamData(workDir = '/repo') {
  return {
    teamName: 'system-manager',
    config: {
      teamName: 'system-manager',
      displayName: 'Admin Loop',
      projectPath: workDir,
      members: [],
      leadSessionId: 'lead-session',
      sessionHistory: [],
    },
    tasks: [],
    members: [],
    kanbanState: { teamName: 'system-manager', reviewers: [], tasks: {} },
    processes: [],
    isAlive: true,
    bindProject: 'my-project',
    settings: {
      platform_allow_from: { feishu: 'ou_admin' },
      platform_allow_chat: { feishu: 'chat_admin' },
    },
  };
}

function mockAdminLoopRuntime(workDir = '/repo') {
  ensureSystemManagerMock.mockResolvedValue({
    teamName: 'system-manager',
    displayName: 'Admin Loop',
    bindProject: 'my-project',
    workDir,
    projectPath: workDir,
    description: 'Admin Loop',
    localStatus: 'ready',
    ccConnectProjectStatus: 'bound',
    feishuStatus: 'unbound',
  });
  getTeamDataMock.mockResolvedValue(baseTeamData(workDir));
  getTeamSessionsMock.mockResolvedValue([]);
  createLoopSessionMock.mockResolvedValue({
    session: {
      id: 'loop-session',
      sessionKey: 'loop-session-key',
      title: 'Loop Session',
      updatedAt: '2026-06-05T00:00:00.000Z',
      createdAt: '2026-06-05T00:00:00.000Z',
      active: true,
      live: true,
      historyCount: 0,
      platform: 'bridge',
    },
    reused: false,
    messageSent: true,
  });
  refreshTeamMessagesHeadMock.mockResolvedValue({ changed: false });
}

describe('SystemManagerView', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('renders embedded Admin Loop panel and loads workflow commands', async () => {
    getStatusMock.mockResolvedValue(baseStatus());
    getConfigMock.mockResolvedValue(baseConfig());
    updateConfigMock.mockImplementation(async (patch: { selectedWorkDir?: string }) =>
      baseConfig(patch.selectedWorkDir ?? '/repo')
    );
    mockAdminLoopRuntime();
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
    fetchTeamsMock.mockResolvedValue(undefined);

    const { host, root } = renderSystemManager();

    await act(async () => {
      root.render(<SystemManagerView />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Admin Loop 指令台');
    expect(host.textContent).toContain('Embedded Admin Loop Panel');
    expect(host.textContent).toContain('运行时');
    expect(host.textContent).not.toContain('打开终端');
    expect(host.textContent).not.toContain('Loop Scan');
    expect(host.textContent).not.toContain('read-only');
    expect(loopConsolePanelPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        slashCommandMode: 'session',
        commandSuggestions: expect.arrayContaining([
          expect.objectContaining({ command: '/loop-scan', name: 'loop-scan' }),
        ]),
      })
    );
    expect(listWorkflowPromptsMock).toHaveBeenCalledWith(expect.stringContaining('/.claude/commands/hermit'));
    expect(listWorkflowPromptsMock).toHaveBeenCalledWith('/repo/.claude/commands');
    expect(ensureSystemManagerMock).toHaveBeenCalled();
    expect(runtimeConfigDialogPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        open: false,
        teamName: 'system-manager',
      })
    );

    await act(async () => {
      root.unmount();
    });
  });

  it('loads Admin Loop sessions only after the system manager team exists', async () => {
    getStatusMock.mockResolvedValue(baseStatus());
    getConfigMock.mockResolvedValue(baseConfig());
    updateConfigMock.mockResolvedValue(baseConfig('/repo'));
    listWorkflowPromptsMock.mockResolvedValue({ folder: '/repo/workflows', warnings: [], prompts: [] });
    fetchTeamsMock.mockResolvedValue(undefined);

    const order: string[] = [];
    ensureSystemManagerMock.mockImplementation(async () => {
      order.push('ensure');
      return {
        teamName: 'system-manager',
        displayName: 'Admin Loop',
        bindProject: 'my-project',
        workDir: '/repo',
        projectPath: '/repo',
        description: 'Admin Loop',
        localStatus: 'ready',
        ccConnectProjectStatus: 'bound',
        feishuStatus: 'bound',
      };
    });
    getTeamDataMock.mockImplementation(async () => {
      order.push('data');
      return baseTeamData('/repo');
    });
    getTeamSessionsMock.mockImplementation(async () => {
      order.push('sessions');
      return [
        {
          id: 'oc_admin',
          title: 'Admin Loop 飞书',
          projectId: 'system-manager',
          sessionKey: 'feishu:chat_admin:ou_admin',
          platform: 'feishu',
          userName: null,
          chatName: '管理员群',
          active: true,
          live: true,
          historyCount: 1,
          createdAt: '2026-06-05T00:00:00.000Z',
          updatedAt: '2026-06-05T00:00:00.000Z',
          lastMessage: null,
        },
      ];
    });

    const { root } = renderSystemManager();

    await act(async () => {
      root.render(<SystemManagerView />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(order[0]).toBe('ensure');
    expect(order).toEqual(expect.arrayContaining(['data', 'sessions']));
    expect(loopConsolePanelPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sessions: [expect.objectContaining({ sessionKey: 'feishu:chat_admin:ou_admin' })],
      })
    );

    await act(async () => {
      root.unmount();
    });
  });

  it('passes workflow commands to slash suggestions by priority', async () => {
    getStatusMock.mockResolvedValue(baseStatus());
    getConfigMock.mockResolvedValue(baseConfig());
    updateConfigMock.mockResolvedValue(baseConfig('/repo'));
    mockAdminLoopRuntime();
    listWorkflowPromptsMock.mockResolvedValueOnce({
      folder: '/Users/test/.claude/commands/hermit',
      warnings: [],
      prompts: [
        {
          id: 'daily-workflow-extraction',
          label: 'Daily Workflow Extraction',
          filename: 'daily-workflow-extraction.md',
          path: '/Users/test/.claude/commands/hermit/daily-workflow-extraction.md',
          folder: '/Users/test/.claude/commands/hermit',
          sizeBytes: 12,
          updatedAt: '2026-06-05T00:00:00.000Z',
          source: 'claude-command',
          commandName: '/hermit:daily-workflow-extraction',
          safety: 'read-only',
          description: '提炼 workflow',
          builtin: true,
          order: 5,
        },
      ],
    });
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
          order: 10,
        },
      ],
    });
    listWorkflowPromptsMock.mockResolvedValue({ folder: '/repo/workflows', warnings: [], prompts: [] });
    fetchTeamsMock.mockResolvedValue(undefined);

    const { host, root } = renderSystemManager();

    await act(async () => {
      root.render(<SystemManagerView />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const lastProps = loopConsolePanelPropsMock.mock.calls.at(-1)?.[0] as {
      commandSuggestions?: Array<{ command?: string }>;
    };
    expect(lastProps.commandSuggestions?.map((suggestion) => suggestion.command)).toEqual([
      '/hermit:daily-workflow-extraction',
      '/nightly-triage',
      '/loop-design',
    ]);
    expect(host.textContent).not.toContain('Nightly Triage');
    expect(createLoopSessionMock).not.toHaveBeenCalled();
    expect(readWorkflowPromptMock).not.toHaveBeenCalled();
    expect(terminalOpenExternalMock).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });
});
