import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@renderer/api', () => ({
  api: {
    teams: {
      updateConfig: vi.fn(async () => ({})),
    },
    ccSettings: {
      restart: vi.fn(async () => ({})),
    },
  },
}));

const mockFetchTeams = vi.fn(async () => {});
const mockSelectTeam = vi.fn(async () => {});

const mockStoreState: Record<string, unknown> = {
  selectedTeamName: 'test-team',
  selectedTeamData: {
    teamName: 'test-team',
    bindProject: 'test-project',
    config: {
      agentType: 'claudecode',
      projectPath: '/tmp/project',
      permissionMode: 'default',
      disabledCommands: [],
    },
    providerRefs: [],
    globalProviders: [],
    platforms: [],
  },
  fetchTeams: mockFetchTeams,
  selectTeam: mockSelectTeam,
  provisioningProgressByTeam: {},
};

vi.mock('@renderer/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => selector(mockStoreState),
}));

vi.mock('@renderer/store/slices/teamSlice', () => ({
  isTeamProvisioningActive: () => false,
}));

vi.mock('@renderer/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => React.createElement('button', { onClick, disabled }, children),
}));

vi.mock('@renderer/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? React.createElement('div', null, children) : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  DialogDescription: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  DialogFooter: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  DialogHeader: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  DialogTitle: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}));

vi.mock('@renderer/components/team/HarnessCards', () => ({
  AGENT_TYPE_LABELS: { claudecode: 'Claude Code' },
}));

vi.mock('@renderer/components/team/HarnessSelect', () => ({
  HarnessSelect: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) =>
    React.createElement(
      'select',
      {
        value,
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value),
        'data-testid': 'harness-select',
      },
      React.createElement('option', { value: 'claudecode' }, 'Claude Code')
    ),
}));

vi.mock('@renderer/components/team/dialogs/PlatformBindingDialog', () => ({
  PlatformBindingContent: ({
    onComplete,
    platformAllowFrom,
    platformAllowChat,
  }: {
    onComplete: (options?: { restartHandled?: boolean }) => void;
    platformAllowFrom?: Record<string, string>;
    platformAllowChat?: Record<string, string>;
  }) =>
    React.createElement(
      'div',
      {
        'data-testid': 'binding-content',
        'data-allow-from': JSON.stringify(platformAllowFrom ?? {}),
        'data-allow-chat': JSON.stringify(platformAllowChat ?? {}),
      },
      'Binding UI',
      React.createElement(
        'button',
        { type: 'button', onClick: () => onComplete() },
        'Complete binding'
      ),
      React.createElement(
        'button',
        { type: 'button', onClick: () => onComplete({ restartHandled: true }) },
        'Complete binding without restart'
      )
    ),
}));

import { api } from '@renderer/api';
import { RuntimeConfigDialog } from '@renderer/components/team/dialogs/RuntimeConfigDialog';

describe('RuntimeConfigDialog', () => {

  it('does not default missing Feishu allow fields to wildcard', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mockStoreState.selectedTeamData = {
      ...(mockStoreState.selectedTeamData as Record<string, unknown>),
      config: {
        agentType: 'claudecode',
        projectPath: '/tmp/project',
        permissionMode: 'default',
        disabledCommands: [],
        managedSources: 'A,B',
      },
      settings: { admin_from: 'A,B' },
      platforms: [{ type: 'feishu', connected: true }],
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<RuntimeConfigDialog open teamName="test-team" onClose={vi.fn()} />);
      await Promise.resolve();
    });

    const allowFromInput = host.querySelector('input[placeholder*="允许所有用户"]') as HTMLInputElement | null;
    const allowChatInput = host.querySelector('input[placeholder*="允许所有群聊"]') as HTMLInputElement | null;
    expect(allowFromInput?.value).toBe('');
    expect(allowChatInput?.value).toBe('');
    // managedSources is now an editable input in the Loop 动态设置 section (#21).
    expect(
      (host.querySelector('[data-testid="loop-managed-sources"]') as HTMLInputElement | null)?.value
    ).toBe('A,B');

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('displays explicit Feishu allow fields', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mockStoreState.selectedTeamData = {
      ...(mockStoreState.selectedTeamData as Record<string, unknown>),
      config: {
        agentType: 'claudecode',
        projectPath: '/tmp/project',
        permissionMode: 'default',
        disabledCommands: [],
        managedSources: 'A,B',
        platformAllowFrom: { feishu: 'ou_A,ou_B' },
        platformAllowChat: { feishu: 'chat_A' },
      },
      platforms: [{ type: 'feishu', connected: true }],
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<RuntimeConfigDialog open teamName="test-team" onClose={vi.fn()} />);
      await Promise.resolve();
    });

    const allowFromInput = host.querySelector('input[placeholder*="允许所有用户"]') as HTMLInputElement | null;
    const allowChatInput = host.querySelector('input[placeholder*="允许所有群聊"]') as HTMLInputElement | null;
    expect(allowFromInput?.value).toBe('ou_A,ou_B');
    expect(allowChatInput?.value).toBe('chat_A');

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('displays Lark-keyed values in the Feishu/Lark permission row', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mockStoreState.selectedTeamData = {
      ...(mockStoreState.selectedTeamData as Record<string, unknown>),
      config: {
        agentType: 'claudecode',
        projectPath: '/tmp/project',
        permissionMode: 'default',
        disabledCommands: [],
        platformAllowFrom: { lark: 'ou_lark' },
        platformAllowChat: { lark: 'chat_lark' },
      },
      platforms: [{ type: 'feishu', connected: true }],
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<RuntimeConfigDialog open teamName="test-team" onClose={vi.fn()} />);
      await Promise.resolve();
    });

    const allowFromInput = host.querySelector('input[placeholder*="允许所有用户"]') as HTMLInputElement | null;
    const allowChatInput = host.querySelector('input[placeholder*="允许所有群聊"]') as HTMLInputElement | null;
    expect(allowFromInput?.value).toBe('ou_lark');
    expect(allowChatInput?.value).toBe('chat_lark');

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('displays legacy WeChat-keyed values in the Weixin permission row', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mockStoreState.selectedTeamData = {
      ...(mockStoreState.selectedTeamData as Record<string, unknown>),
      config: {
        agentType: 'claudecode',
        projectPath: '/tmp/project',
        permissionMode: 'default',
        disabledCommands: [],
        platformAllowFrom: { wechat: 'wx_user' },
        platformAllowChat: { wechat: 'wx_chat' },
      },
      platforms: [{ type: 'weixin', connected: true }],
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<RuntimeConfigDialog open teamName="test-team" onClose={vi.fn()} />);
      await Promise.resolve();
    });

    const allowFromInput = host.querySelector('input[placeholder*="允许所有用户"]') as HTMLInputElement | null;
    const allowChatInput = host.querySelector('input[placeholder*="允许所有群聊"]') as HTMLInputElement | null;
    expect(host.textContent).toContain('微信 入口权限');
    expect(allowFromInput?.value).toBe('wx_user');
    expect(allowChatInput?.value).toBe('wx_chat');

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });
  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mockStoreState.selectedTeamName = 'test-team';
    mockStoreState.selectedTeamData = {
      teamName: 'test-team',
      bindProject: 'test-project',
      config: {
        agentType: 'claudecode',
        projectPath: '/tmp/project',
        permissionMode: 'default',
        disabledCommands: [],
      },
      providerRefs: [],
      globalProviders: [],
      platforms: [],
    };
  });

  it('saves selected permission mode before entering platform binding', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <RuntimeConfigDialog open teamName="test-team" onClose={vi.fn()} />
      );
      await Promise.resolve();
    });

    const permissionSelect = Array.from(host.querySelectorAll('select')).find((select) =>
      Array.from(select.options).some((option) => option.value === 'bypassPermissions')
    ) as HTMLSelectElement | undefined;
    expect(permissionSelect).toBeTruthy();

    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setValue?.call(permissionSelect, 'bypassPermissions');
      permissionSelect!.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    const bindButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('绑定新渠道')
    );
    expect(bindButton).toBeTruthy();

    await act(async () => {
      bindButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.teams.updateConfig).toHaveBeenCalledWith(
      'test-team',
      expect.objectContaining({ permissionMode: 'bypassPermissions' })
    );
    expect(mockFetchTeams).toHaveBeenCalled();
    expect(mockSelectTeam).toHaveBeenCalledWith('test-team');
    expect(host.querySelector('[data-testid="binding-content"]')).toBeTruthy();
    expect(api.ccSettings.restart).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('returns save button to save-and-restart after editing a completed config', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<RuntimeConfigDialog open teamName="test-team" onClose={vi.fn()} />);
      await Promise.resolve();
    });

    const saveButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('保存并重启')
    );
    expect(saveButton).toBeTruthy();

    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('已完成');

    const permissionSelect = Array.from(host.querySelectorAll('select')).find((select) =>
      Array.from(select.options).some((option) => option.value === 'bypassPermissions')
    ) as HTMLSelectElement | undefined;
    expect(permissionSelect).toBeTruthy();

    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setValue?.call(permissionSelect, 'bypassPermissions');
      permissionSelect!.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    const resetSaveButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('保存并重启')
    );
    expect(resetSaveButton).toBeTruthy();
    expect(resetSaveButton?.disabled).toBe(false);

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('stays on runtime step when saving before binding fails', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.mocked(api.teams.updateConfig).mockRejectedValueOnce(new Error('network error'));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<RuntimeConfigDialog open teamName="test-team" onClose={vi.fn()} />);
      await Promise.resolve();
    });

    const bindButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('绑定新渠道')
    );

    await act(async () => {
      bindButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="binding-content"]')).toBeNull();
    expect(host.textContent).toContain('network error');
    expect(api.ccSettings.restart).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('does not restart after platform binding when the server already handled it', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<RuntimeConfigDialog open teamName="test-team" onClose={vi.fn()} />);
      await Promise.resolve();
    });

    const bindButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('绑定新渠道')
    );

    await act(async () => {
      bindButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const completeButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Complete binding without restart')
    );
    expect(completeButton).toBeTruthy();

    vi.clearAllMocks();

    await act(async () => {
      completeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.ccSettings.restart).not.toHaveBeenCalled();
    expect(mockFetchTeams).toHaveBeenCalled();
    expect(mockSelectTeam).toHaveBeenCalledWith('test-team');
    expect(host.querySelector('[data-testid="binding-content"]')).toBeNull();

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('saves and forwards edited Feishu allow fields before binding', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mockStoreState.selectedTeamData = {
      ...(mockStoreState.selectedTeamData as Record<string, unknown>),
      platforms: [{ type: 'feishu', connected: true }],
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<RuntimeConfigDialog open teamName="test-team" onClose={vi.fn()} />);
      await Promise.resolve();
    });

    const allowFromInput = host.querySelector('input[placeholder*="允许所有用户"]') as HTMLInputElement;
    const allowChatInput = host.querySelector('input[placeholder*="允许所有群聊"]') as HTMLInputElement;

    await act(async () => {
      const inputSetValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      inputSetValue?.call(allowFromInput, 'A,B');
      allowFromInput.dispatchEvent(new Event('input', { bubbles: true }));
      inputSetValue?.call(allowChatInput, 'chat_1');
      allowChatInput.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });

    const bindButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('绑定新渠道')
    );

    await act(async () => {
      bindButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.teams.updateConfig).toHaveBeenCalledWith(
      'test-team',
      expect.objectContaining({
        platformAllowFrom: { feishu: 'A,B' },
        platformAllowChat: { feishu: 'chat_1' },
      })
    );
    const bindingContent = host.querySelector('[data-testid="binding-content"]') as HTMLElement | null;
    expect(bindingContent).toBeTruthy();
    expect(JSON.parse(bindingContent?.getAttribute('data-allow-from') ?? '{}')).toEqual({ feishu: 'A,B' });
    expect(JSON.parse(bindingContent?.getAttribute('data-allow-chat') ?? '{}')).toEqual({ feishu: 'chat_1' });

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

  it('seeds Loop 动态设置 fields from config and persists them on save', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mockStoreState.selectedTeamData = {
      ...(mockStoreState.selectedTeamData as Record<string, unknown>),
      config: {
        agentType: 'claudecode',
        projectPath: '/tmp/project',
        permissionMode: 'default',
        disabledCommands: [],
        language: 'zh',
        managedSources: '*',
        showContextIndicator: true,
        replyFooter: false,
        injectSender: true,
      },
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<RuntimeConfigDialog open teamName="test-team" onClose={vi.fn()} />);
      await Promise.resolve();
    });

    // Defaults seeded from config.
    expect(
      (host.querySelector('[data-testid="loop-language"]') as HTMLInputElement | null)?.value
    ).toBe('zh');
    expect(
      (host.querySelector('[data-testid="loop-managed-sources"]') as HTMLInputElement | null)?.value
    ).toBe('*');
    expect(
      (host.querySelector('[data-testid="loop-inject-sender"]') as HTMLInputElement | null)?.checked
    ).toBe(true);

    const saveButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('保存并重启')
    );
    expect(saveButton).toBeTruthy();

    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.teams.updateConfig).toHaveBeenCalledWith(
      'test-team',
      expect.objectContaining({
        language: 'zh',
        managedSources: '*',
        showContextIndicator: true,
        replyFooter: false,
        injectSender: true,
      })
    );

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });

});
