import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SystemManagerConfigService, adminWorkDir } from '../SystemManagerConfigService';

const PREV_HERMIT_HOME = process.env.HERMIT_HOME;
let workdir: string;

beforeAll(async () => {
  workdir = await mkdtemp(path.join(tmpdir(), 'hermit-admin-cfg-'));
  process.env.HERMIT_HOME = workdir;
});

afterAll(() => {
  if (PREV_HERMIT_HOME === undefined) delete process.env.HERMIT_HOME;
  else process.env.HERMIT_HOME = PREV_HERMIT_HOME;
  void rm(workdir, { recursive: true, force: true });
});

describe('adminWorkDir', () => {
  it('points at <hermit-home>/admin-workspace', () => {
    expect(adminWorkDir()).toBe(path.join(workdir, 'admin-workspace'));
  });
});

describe('SystemManagerConfigService.adminInitialized', () => {
  it('round-trips the marker and persists it across instances', async () => {
    const svc = new SystemManagerConfigService(workdir);

    expect((await svc.getConfig()).adminInitialized).toBeUndefined();

    await svc.updateConfig({ adminInitialized: true });
    expect((await svc.getConfig()).adminInitialized).toBe(true);

    // A fresh instance reads the same file → marker survives a restart.
    const reopened = new SystemManagerConfigService(workdir);
    expect((await reopened.getConfig()).adminInitialized).toBe(true);
  });

  it('preserves adminInitialized when patching an unrelated field', async () => {
    const svc = new SystemManagerConfigService(workdir);
    await svc.updateConfig({ adminInitialized: true });
    await svc.updateConfig({ selectedWorkDir: workdir });

    const config = await svc.getConfig();
    expect(config.selectedWorkDir).toBe(workdir);
    expect(config.adminInitialized).toBe(true);
  });
});

describe('SystemManagerConfigService.getStatus', () => {
  it('reports the Helm Loop identity and the admin workDir', async () => {
    const svc = new SystemManagerConfigService(workdir);
    const status = await svc.getStatus();
    expect(status.displayName).toBe('Helm Loop');
    expect(status.adminWorkDir).toBe(path.join(workdir, 'admin-workspace'));
  });
});
