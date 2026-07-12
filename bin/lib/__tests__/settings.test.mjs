// Tests for bin/lib/settings.mjs::atomicWriteFile — the shared Windows-safe
// atomic write used by every file that holds a live key (auth store, Claude /
// Codex configs, env snapshots). The core Windows risk: fs.rename() throws
// EPERM over an EXISTING file, so a second claim or re-login would crash. We
// verify the overwrite path on the current platform AND with process.platform
// mocked to win32 (the copyFileSync+rmSync branch), so the Windows behavior is
// covered even when the test host is macOS/Linux.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { atomicWriteFile } from '../settings.mjs';

describe('atomicWriteFile', () => {
  let home;
  beforeAll(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'hermit-atomic-'));
  });
  afterAll(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('writes a new file, creating parent dirs', async () => {
    const file = path.join(home, 'nested', 'a.txt');
    atomicWriteFile(file, 'hello');
    expect(await readFile(file, 'utf-8')).toBe('hello');
  });

  it('overwrites an existing file — the case where fs.rename throws on Windows', async () => {
    const file = path.join(home, 'overwrite.txt');
    atomicWriteFile(file, 'first');
    atomicWriteFile(file, 'second');
    expect(await readFile(file, 'utf-8')).toBe('second');
  });

  it('leaves no temp file behind after overwriting', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'hermit-atomic-tmp-'));
    try {
      const file = path.join(dir, 'f.txt');
      atomicWriteFile(file, 'first');
      atomicWriteFile(file, 'second');
      expect(readdirSync(dir)).toEqual(['f.txt']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('overwrites via the Windows copy+rm branch when platform is win32', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'hermit-atomic-win-'));
    const realPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      const file = path.join(dir, 'win.txt');
      atomicWriteFile(file, 'first');
      // Second write would throw EPERM under a real fs.rename on Windows; the
      // copy+rm branch must handle the existing destination.
      atomicWriteFile(file, 'second');
      expect(await readFile(file, 'utf-8')).toBe('second');
      // The copy+rm branch must clean up its temp file.
      expect(readdirSync(dir)).toEqual(['win.txt']);
    } finally {
      Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
      await rm(dir, { recursive: true, force: true });
    }
  });
});
