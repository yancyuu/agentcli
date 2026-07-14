import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { runUpdate } from '../update.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliEntry = path.resolve(testDir, '../../hermit.mjs');

describe('agentcli update dispatch', () => {
  it('reloads a running usage worker after updating code', () => {
    const source = readFileSync(cliEntry, 'utf-8');

    expect(source).toMatch(
      /runUpdate\(\{\s*onUpdated:\s*restartUsageWorkerIfRunning\s*\}\)/
    );
  });
});

function releaseResponse(latest) {
  return {
    ok: true,
    json: async () => ({ tag_name: `v${latest}` }),
  };
}

describe('agentcli update transcript (Claude-CLI style)', () => {
  it('prints the full sequence for a git checkout install', async () => {
    const logs = [];
    const exec = vi.fn();
    const onUpdated = vi.fn();
    const fetchImpl = vi.fn(async () => releaseResponse('2.1.209'));

    await runUpdate({
      currentVersion: '2.1.197',
      isGitRepo: true,
      fetchImpl,
      exec,
      migrate: vi.fn(),
      onUpdated,
      log: (m) => logs.push(m),
      error: vi.fn(),
    });

    expect(logs).toEqual([
      'Current version: 2.1.197',
      'Checking for updates to latest version...',
      'New version available: 2.1.209 (current: 2.1.197)',
      'Installing update...',
      'Using git installation update method...',
      'Successfully updated from 2.1.197 to version 2.1.209',
    ]);
    // fetch + checkout + install + build
    expect(exec).toHaveBeenCalledTimes(4);
    expect(onUpdated).toHaveBeenCalledTimes(1);
  });

  it('prints the full sequence for a global npm install', async () => {
    const logs = [];
    const calls = [];
    const exec = vi.fn((cmd) => calls.push(cmd));
    const fetchImpl = vi.fn(async () => releaseResponse('2.1.209'));

    await runUpdate({
      currentVersion: '2.1.197',
      isGitRepo: false,
      fetchImpl,
      exec,
      migrate: vi.fn(),
      onUpdated: vi.fn(),
      log: (m) => logs.push(m),
      error: vi.fn(),
    });

    expect(logs).toEqual([
      'Current version: 2.1.197',
      'Checking for updates to latest version...',
      'New version available: 2.1.209 (current: 2.1.197)',
      'Installing update...',
      'Using global installation update method...',
      'Successfully updated from 2.1.197 to version 2.1.209',
    ]);
    // Single npm install, pinned to the official registry.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('npm install -g');
    expect(calls[0]).toContain('--registry=https://registry.npmjs.org/');
  });

  it('stops at already-latest without installing', async () => {
    const logs = [];
    const exec = vi.fn();
    const onUpdated = vi.fn();
    const fetchImpl = vi.fn(async () => releaseResponse('2.1.197'));

    await runUpdate({
      currentVersion: '2.1.197',
      isGitRepo: true,
      fetchImpl,
      exec,
      migrate: vi.fn(),
      onUpdated,
      log: (m) => logs.push(m),
      error: vi.fn(),
    });

    expect(logs).toEqual([
      'Current version: 2.1.197',
      'Checking for updates to latest version...',
      'Already on latest version (2.1.197)',
    ]);
    expect(exec).not.toHaveBeenCalled();
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it('runs onUpdated after install and before the success line', async () => {
    const order = [];
    const exec = vi.fn(() => order.push('install'));
    const onUpdated = vi.fn(async () => order.push('reload'));

    await runUpdate({
      currentVersion: '1.0.0',
      isGitRepo: false,
      fetchImpl: vi.fn(async () => releaseResponse('1.0.1')),
      exec,
      migrate: vi.fn(),
      onUpdated,
      log: (m) => m.startsWith('Successfully') && order.push('success'),
      error: vi.fn(),
    });

    expect(order).toEqual(['install', 'reload', 'success']);
  });

  it('surfaces a global npm install failure with the platform hint', async () => {
    const errors = [];
    const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit:${code}`);
    });
    const exec = vi.fn(() => {
      throw new Error('npm EACCES');
    });

    await expect(
      runUpdate({
        currentVersion: '1.0.0',
        isGitRepo: false,
        fetchImpl: vi.fn(async () => releaseResponse('1.0.1')),
        exec,
        migrate: vi.fn(),
        onUpdated: vi.fn(),
        log: vi.fn(),
        error: (m) => errors.push(m),
      })
    ).rejects.toThrow('exit:1');

    expect(errors.join(' ')).toContain('npm update failed');
    exit.mockRestore();
  });
});
