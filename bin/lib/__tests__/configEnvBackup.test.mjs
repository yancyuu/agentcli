// Tests for bin/lib/configEnvBackup.mjs — the one-time original-env snapshot +
// one-click restore that brackets the token-pool claim flow.
//
// Invariants under test:
//   • snapshotOriginals is CREATE-ONCE — a second call is a no-op and never
//     overwrites the prior snapshot, even if the live files changed in between.
//   • restoreOriginals replays the snapshot: existed files are copied back with
//     their ORIGINAL content; files the token pool created (originally absent)
//     are deleted, leaving no residue.
//
// All paths redirect under a temp `home` so the test never touches the
// developer's real ~/.claude or ~/.codex.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  hasSnapshot,
  listOriginalTargets,
  originalEnvBackupRoot,
  restoreOriginals,
  snapshotOriginals,
} from '../configEnvBackup.mjs';

function livePaths(home) {
  return {
    claude: path.join(home, '.claude', 'settings.json'),
    codexAuth: path.join(home, '.codex', 'auth.json'),
    codexConfig: path.join(home, '.codex', 'config.toml'),
  };
}

async function freshHome() {
  const home = await mkdtemp(path.join(os.tmpdir(), 'hermit-envbak-'));
  return home;
}

describe('listOriginalTargets', () => {
  it('returns the three files the claim flow can mutate, tagged by runtime', () => {
    const home = '/tmp/fake-home';
    const targets = listOriginalTargets(home);
    const tags = targets.map((t) => t.runtime);
    expect(tags).toEqual(['claude', 'codex-auth', 'codex-config']);
    expect(targets[0].livePath).toBe(path.join(home, '.claude', 'settings.json'));
    expect(targets[1].livePath).toBe(path.join(home, '.codex', 'auth.json'));
    expect(targets[2].livePath).toBe(path.join(home, '.codex', 'config.toml'));
  });
});

describe('snapshotOriginals — create-once', () => {
  let home;
  afterAll(async () => {
    if (home) await rm(home, { recursive: true, force: true });
  });

  it('captures existing files and records absent ones; second call is a no-op', async () => {
    home = await freshHome();
    const paths = livePaths(home);
    // Claude + codex-config exist; codex auth.json is ABSENT (will be created by token pool later).
    await mkdir(path.dirname(paths.claude), { recursive: true });
    await writeFile(paths.claude, JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'ORIGINAL' } }));
    await mkdir(path.dirname(paths.codexConfig), { recursive: true });
    await writeFile(paths.codexConfig, '# ORIGINAL codex config\nmodel = "gpt-4o"\n');

    expect(hasSnapshot({ home })).toBe(false);

    const first = snapshotOriginals({ home });
    expect(first.created).toBe(true);
    expect(hasSnapshot({ home })).toBe(true);
    expect(existsSync(originalEnvBackupRoot(home))).toBe(true);

    // The manifest records what existed vs. what didn't.
    const manifest = JSON.parse(await readFile(path.join(originalEnvBackupRoot(home), 'manifest.json'), 'utf-8'));
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.files.claude.existed).toBe(true);
    expect(manifest.files['codex-auth'].existed).toBe(false);
    expect(manifest.files['codex-config'].existed).toBe(true);

    // Captured files hold their ORIGINAL content.
    expect(await readFile(manifest.files.claude.backupPath, 'utf-8')).toContain('ORIGINAL');
    expect(await readFile(manifest.files['codex-config'].backupPath, 'utf-8')).toContain('gpt-4o');

    // --- mutate the live files (simulate a token-pool claim) ---
    await writeFile(paths.claude, JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'POOL-KEY' } }));
    await writeFile(paths.codexAuth, JSON.stringify({ OPENAI_API_KEY: 'POOL-KEY' }));

    // Second snapshot must NOT overwrite — manifest + captured content unchanged.
    const second = snapshotOriginals({ home });
    expect(second.created).toBe(false);

    const manifest2 = JSON.parse(await readFile(path.join(originalEnvBackupRoot(home), 'manifest.json'), 'utf-8'));
    expect(manifest2.files.claude.existed).toBe(true);
    expect(manifest2.files['codex-auth'].existed).toBe(false); // still recorded as originally absent
    // Captured Claude content is still the ORIGINAL, not the pool key.
    expect(await readFile(manifest2.files.claude.backupPath, 'utf-8')).toContain('ORIGINAL');
  });
});

describe('restoreOriginals', () => {
  it('restores existed files to original content and deletes token-pool-created files', async () => {
    const home = await freshHome();
    try {
      const paths = livePaths(home);
      // Pre-pool originals: claude + codex-config exist; auth.json absent.
      await mkdir(path.dirname(paths.claude), { recursive: true });
      await writeFile(paths.claude, JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'ORIGINAL' } }));
      await mkdir(path.dirname(paths.codexConfig), { recursive: true });
      await writeFile(paths.codexConfig, '# ORIGINAL\nmodel = "gpt-4o"\n');

      snapshotOriginals({ home });

      // --- simulate token pool writing all three (incl. creating auth.json) ---
      await writeFile(paths.claude, JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'POOL-KEY' } }));
      await writeFile(paths.codexConfig, '# POOL\nmodel = "qwen-max"\n');
      await mkdir(path.dirname(paths.codexAuth), { recursive: true });
      await writeFile(paths.codexAuth, JSON.stringify({ OPENAI_API_KEY: 'POOL-KEY' }));

      const result = restoreOriginals({ home });
      expect(result.ok).toBe(true);
      const byRuntime = Object.fromEntries(result.results.map((r) => [r.runtime, r]));
      expect(byRuntime.claude.action).toBe('restored');
      expect(byRuntime['codex-config'].action).toBe('restored');
      expect(byRuntime['codex-auth'].action).toBe('deleted');

      // Existed files back to ORIGINAL content (pool keys gone).
      expect(JSON.parse(await readFile(paths.claude, 'utf-8')).env.ANTHROPIC_AUTH_TOKEN).toBe('ORIGINAL');
      expect(await readFile(paths.codexConfig, 'utf-8')).toContain('gpt-4o');
      // Token-pool-created file is GONE, no residue.
      expect(existsSync(paths.codexAuth)).toBe(false);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('returns ok:false when no snapshot exists', async () => {
    const home = await freshHome();
    try {
      const result = restoreOriginals({ home });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('no-snapshot');
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('skips already-absent files without error when nothing was created', async () => {
    const home = await freshHome();
    try {
      // Everything absent at snapshot time, nothing created after.
      snapshotOriginals({ home });
      const result = restoreOriginals({ home });
      expect(result.ok).toBe(true);
      expect(result.results.every((r) => r.action === 'skipped')).toBe(true);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
