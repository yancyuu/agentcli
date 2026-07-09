import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const childProcessMocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => {
  const mocked = { spawn: childProcessMocks.spawn, execSync: () => '', exec: () => {}, fork: () => {} };
  return { ...mocked, default: mocked };
});

describe('servicesCommand', () => {
  let tmpHome;

  beforeEach(async () => {
    tmpHome = await mkdtemp(path.join(os.tmpdir(), 'hermit-services-'));
    process.env.HERMIT_HOME = tmpHome;
    process.env.OPENHERMIT_SERVICE_WEB_MODE = 'test';
    process.env.OPENHERMIT_USAGE_WORKER_MODE = 'test';
    vi.resetModules();
  });

  afterEach(async () => {
    delete process.env.HERMIT_HOME;
    delete process.env.OPENHERMIT_SERVICE_WEB_MODE;
    delete process.env.OPENHERMIT_USAGE_WORKER_MODE;
    await rm(tmpHome, { recursive: true, force: true });
  });

  it('collects service status through the exported usage status reader', async () => {
    const { collectServicesStatus } = await import('../servicesCommand.mjs');

    const status = await collectServicesStatus();

    expect(status.web.running).toBe(false);
    expect(status.usage.worker).toBeTruthy();
    expect(status.usage.source).toBe('claude-jsonl');
  });

  it('renders enabled usage as not running when the worker is stopped', async () => {
    const { servicesStatusRows } = await import('../servicesCommand.mjs');

    const rows = servicesStatusRows({
      web: { running: false },
      usage: { enabled: true, worker: { running: false } },
      collaboration: { enabled: true },
      auth: { authorized: true },
    });

    expect(rows).toContainEqual(['用量后台', '未运行', 'off']);
    expect(rows).toContainEqual(['用量统计', '已开启，后台未运行', 'warn']);
    expect(rows).toContainEqual(['IM 协作', '配置已开启（非本地进程）', 'info']);
  });
});
