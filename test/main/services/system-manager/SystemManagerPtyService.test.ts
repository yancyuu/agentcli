import { afterEach, describe, expect, it } from 'vitest';

import { SystemManagerPtyService } from '@main/services/system-manager/SystemManagerPtyService';

describe('SystemManagerPtyService', () => {
  let service: SystemManagerPtyService | null = null;

  afterEach(() => {
    service?.killAll();
    service = null;
  });

  it('provides a TTY even when node-pty falls back', async () => {
    service = new SystemManagerPtyService();
    const chunks: string[] = [];
    let exitCode: number | null = null;

    service.on('data', (event) => chunks.push(event.data));
    service.on('exit', (event) => {
      exitCode = event.exitCode;
    });

    await service.spawn({
      command: 'node',
      args: ['-e', "console.log('tty', process.stdin.isTTY, process.stdout.isTTY)"],
      cwd: process.cwd(),
    });

    await expect
      .poll(
        () => ({ exitCode, output: chunks.join('') }),
        { timeout: 5_000, interval: 50 }
      )
      .toMatchObject({ exitCode: 0 });

    expect(chunks.join('')).toContain('tty');
    expect(chunks.join('')).toContain('true');
  });
});
