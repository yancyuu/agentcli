import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  getStatusMock,
  getConfigMock,
  updateConfigMock,
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
    return <div data-testid="admin-loop-panel">Embedded Helm Loop Panel</div>;
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
    displayName: 'Helm Loop' as const,
    defaultWorkDir: '/repo',
    selectedWorkDir: '/repo',
    adminWorkDir: '/repo',
    claudeCommand: 'claude' as const,
    localStatus: 'ready' as const,
  };
}

function baseConfig(workDir = '/repo') {
  return {
    schemaVersion: 1 as const,
    selectedWorkDir: workDir,
    updatedAt: '2026-06-05T00:00:00.000Z',
  };
}

function baseTeamData(workDir = '/repo') {
  return {
    teamName: 'system-manager',
    config: {
      teamName: 'system-manager',
      displayName: 'Helm Loop',
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
    displayName: 'Helm Loop',
    bindProject: 'my-project',
    workDir,
    projectPath: workDir,
    description: 'Helm Loop',
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

  it('renders embedded Helm Loop panel and exposes only capability-pack commands', async () => {
    getStatusMock.mockResolvedValue(baseStatus());
    getConfigMock.mockResolvedValue(baseConfig());
    updateConfigMock.mockImplementation(async (patch: { selectedWorkDir?: string }) =>
      baseConfig(patch.selectedWorkDir ?? '/repo')
    );
    mockAdminLoopRuntime();
    fetchTeamsMock.mockResolvedValue(undefined);

    const { host, root } = renderSystemManager();

    await act(async () => {
      root.render(<SystemManagerView />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('helm 指令台');
    expect(host.textContent).toContain('Embedded Helm Loop Panel');
    expect(host.textContent).toContain('运行时');
    expect(host.textContent).not.toContain('打开终端');
    expect(host.textContent).not.toContain('Loop Scan');
    // workflow 列表已移除：不再展示按 .claude/commands 扫描的 workflow 命令。
    expect(host.textContent).not.toContain('read-only');
    expect(loopConsolePanelPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        slashCommandMode: 'session',
      })
    );
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

  it('loads Helm Loop sessions only after the system manager team exists', async () => {
    getStatusMock.mockResolvedValue(baseStatus());
    getConfigMock.mockResolvedValue(baseConfig());
    updateConfigMock.mockResolvedValue(baseConfig('/repo'));
    fetchTeamsMock.mockResolvedValue(undefined);

    const order: string[] = [];
    ensureSystemManagerMock.mockImplementation(async () => {
      order.push('ensure');
      return {
        teamName: 'system-manager',
        displayName: 'Helm Loop',
        bindProject: 'my-project',
        workDir: '/repo',
        projectPath: '/repo',
        description: 'Helm Loop',
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
          title: 'Helm Loop 飞书',
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
});
