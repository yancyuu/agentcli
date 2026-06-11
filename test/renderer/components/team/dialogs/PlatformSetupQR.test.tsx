import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => <div data-testid="qr-code">{value}</div>,
}));

vi.mock('@renderer/api', () => ({
  api: {
    ccSetup: {
      feishuBegin: vi.fn(async () => ({
        device_code: 'device-1',
        qr_url: 'https://example.com/qr',
        interval: 0,
      })),
      feishuPoll: vi.fn(async () => ({
        status: 'completed',
        app_id: 'app-id',
        app_secret: 'app-secret',
        platform: 'lark',
        owner_open_id: 'owner-open-id',
      })),
      feishuSave: vi.fn(async () => undefined),
      weixinBegin: vi.fn(),
      weixinPoll: vi.fn(),
      weixinSave: vi.fn(),
    },
  },
}));

import PlatformSetupQR from '@renderer/components/team/dialogs/PlatformSetupQR';
import { api } from '@renderer/api';

describe('PlatformSetupQR', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('shows restarting feedback immediately after clicking restart-and-complete', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const onComplete = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <PlatformSetupQR
          platformType="lark"
          projectName="test-project"
          workDir="/repo"
          agentType="claudecode"
          onComplete={onComplete}
          onCancel={vi.fn()}
        />
      );
      await Promise.resolve();
    });

    const startButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('开始扫码绑定')
    );
    expect(startButton).toBeTruthy();

    await act(async () => {
      startButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.ccSetup.feishuSave).toHaveBeenCalledWith(
      expect.objectContaining({ project: 'test-project', platform_type: 'lark' })
    );
    const completeButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('重启并完成')
    );
    expect(completeButton).toBeTruthy();

    await act(async () => {
      completeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('正在重启服务并刷新平台长连接');
    expect(host.textContent).toContain('正在重启');

    await act(async () => {
      root.unmount();
    });
  });
});
