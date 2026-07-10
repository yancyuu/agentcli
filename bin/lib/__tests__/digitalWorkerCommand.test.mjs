import { describe, expect, it, vi } from 'vitest';

import {
  buildDigitalWorkerCommandOptions,
  provisionDigitalWorker,
} from '../digitalWorkerCommand.mjs';

function findArg(args, flag) {
  const index = args.indexOf(flag);
  if (index >= 0 && index + 1 < args.length) return args[index + 1];
  const prefixed = args.find((arg) => arg.startsWith(`${flag}=`));
  return prefixed ? prefixed.slice(flag.length + 1) : null;
}

function dependencies(overrides = {}) {
  return {
    ensureLocalServer: vi.fn(async () => ({ ready: true })),
    createTeam: vi.fn(async (_port, request) => ({ ok: true, teamSlug: request.bindProject })),
    ensureRuntime: vi.fn(async () => ({ ok: true })),
    beginQr: vi.fn(async () => ({ qr_url: 'https://qr', device_code: 'device' })),
    waitForQr: vi.fn(async (_port, _platform, _begin, onStatus) => {
      onStatus?.('completed');
      return { status: 'completed', app_id: 'app', app_secret: 'secret', platform: 'lark' };
    }),
    saveQr: vi.fn(async () => ({ message: 'saved', restart_required: false, restart_handled: true })),
    bindManual: vi.fn(async () => ({ message: 'bound', restart_required: false, restart_handled: false })),
    rollback: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

const base = {
  name: '客服员工',
  bindProject: 'support-worker',
  workDir: '/repo/app',
  agentType: 'claudecode',
  platform: 'feishu',
  platformOptions: {},
};

describe('digitalWorkerCommand — command option parsing', () => {
  it('builds a non-interactive digital worker request from CLI flags', () => {
    const options = buildDigitalWorkerCommandOptions([
      'create-digital-worker', '--name', '客服员工', '--description=接待用户',
      '--bind-project', 'support-worker', '--work-dir', '/repo/app', '--agent-type', 'codex',
      '--platform', 'slack', '--platform-options', '{"bot_token":"xoxb","app_token":"xapp"}',
    ], findArg);

    expect(options).toMatchObject({
      ok: true,
      name: '客服员工',
      description: '接待用户',
      bindProject: 'support-worker',
      workDir: '/repo/app',
      agentType: 'codex',
      platform: 'slack',
      platformOptions: { bot_token: 'xoxb', app_token: 'xapp' },
    });
  });

  it('defaults to Claude Code and Feishu for quick QR setup', () => {
    const options = buildDigitalWorkerCommandOptions(['create-digital-worker', '--name', '测试'], findArg);
    expect(options).toMatchObject({ ok: true, agentType: 'claudecode', platform: 'feishu', platformOptions: {} });
  });

  it('rejects invalid platform options JSON before doing network work', () => {
    expect(buildDigitalWorkerCommandOptions([
      'create-digital-worker', '--name', '测试', '--platform-options', 'not-json',
    ], findArg)).toEqual({ ok: false, message: '--platform-options 必须是 JSON 对象' });
  });
});

describe('provisionDigitalWorker', () => {
  it('validates manual credentials before any side effect', async () => {
    const deps = dependencies();
    const result = await provisionDigitalWorker(5680, {
      ...base,
      platform: 'slack',
      platformOptions: {},
    }, {}, deps);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('bot_token');
    expect(deps.ensureLocalServer).not.toHaveBeenCalled();
    expect(deps.createTeam).not.toHaveBeenCalled();
  });

  it('rolls back when the runtime never becomes ready', async () => {
    const deps = dependencies({
      ensureRuntime: vi.fn(async () => ({ ok: false, message: '渠道连接服务未就绪' })),
    });

    const result = await provisionDigitalWorker(5680, base, {}, deps);

    expect(result).toMatchObject({
      ok: false,
      failedStage: '启动渠道连接服务',
      message: '渠道连接服务未就绪',
    });
    expect(deps.ensureRuntime).toHaveBeenCalledWith(5680);
    expect(deps.rollback).toHaveBeenCalledTimes(1);
    expect(deps.beginQr).not.toHaveBeenCalled();
  });

  it('completes QR begin, poll, and save before reporting success', async () => {
    const order = [];
    const deps = dependencies({
      beginQr: vi.fn(async () => { order.push('begin'); return { qr_url: 'https://qr', device_code: 'd' }; }),
      waitForQr: vi.fn(async () => { order.push('poll'); return { app_id: 'app', app_secret: 'secret', platform: 'lark' }; }),
      saveQr: vi.fn(async () => { order.push('save'); return { restart_required: false, restart_handled: true }; }),
    });
    const onQrCode = vi.fn(async () => order.push('show'));

    const result = await provisionDigitalWorker(5680, base, { onQrCode }, deps);

    expect(order).toEqual(['begin', 'show', 'poll', 'save']);
    expect(result).toMatchObject({
      ok: true,
      status: 'bound',
      teamSlug: 'support-worker',
    });
    expect(result.binding).toMatchObject({ restartHandled: true });
  });

  it('reports that QR setup restarted and connected the channel', async () => {
    const deps = dependencies({
      saveQr: vi.fn(async () => ({ restart_required: false, restart_handled: true })),
    });

    const result = await provisionDigitalWorker(5680, base, {}, deps);

    expect(result.binding).toMatchObject({ restartRequired: false, restartHandled: true });
  });

  it('rolls back once and preserves both provisioning and rollback failures', async () => {
    const deps = dependencies({
      waitForQr: vi.fn(async () => { throw new Error('二维码已过期'); }),
      rollback: vi.fn(async () => { throw new Error('外部项目删除失败'); }),
    });

    const result = await provisionDigitalWorker(5680, base, {}, deps);

    expect(result).toMatchObject({
      ok: false,
      failedStage: '绑定渠道',
      message: '二维码已过期',
      rollback: { attempted: true, ok: false, message: '外部项目删除失败' },
    });
    expect(deps.rollback).toHaveBeenCalledTimes(1);
  });

  it('rolls back when post-binding authorization fails', async () => {
    const deps = dependencies();
    const result = await provisionDigitalWorker(5680, base, {
      afterPlatformBound: vi.fn(async () => ({ ok: false, message: '个人授权未完成' })),
    }, deps);

    expect(result).toMatchObject({ ok: false, failedStage: '完成渠道授权' });
    expect(deps.rollback).toHaveBeenCalledTimes(1);
  });
});
