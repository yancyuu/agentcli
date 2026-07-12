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

describe('originalEnvBackupRoot', () => {
  it('lives inside ~/.hermit as agentcli.env.bak (not a sibling of ~/.hermit)', () => {
    // The snapshot used to sit at ~/.hermit-env.bak (a sibling of ~/.hermit). It
    // now lives INSIDE the .hermit folder, renamed, so the token pool keeps all
    // its data under one root.
    expect(originalEnvBackupRoot('/tmp/fake-home')).toBe(
      path.join('/tmp/fake-home', '.hermit', 'agentcli.env.bak'),
    );
  });
});

describe('legacy snapshot migration', () => {
  it('moves a legacy ~/.hermit-env.bak snapshot into ~/.hermit/agentcli.env.bak, preserving content', async () => {
    // A prior install captured originals at the legacy path. After upgrade the
    // snapshot must relocate to the new path WITHOUT losing the captured content
    // or re-snapshotting the (now pool-overwritten) live files as "original".
    const home = await freshHome();
    try {
      const legacyRoot = path.join(home, '.hermit-env.bak');
      const legacyManifest = path.join(legacyRoot, 'manifest.json');
      await mkdir(path.dirname(legacyManifest), { recursive: true });
      const legacyContent = JSON.stringify({
        schemaVersion: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        files: { claude: { existed: true, livePath: 'x', backupPath: 'y' } },
      });
      await writeFile(legacyManifest, legacyContent);

      // Trigger migration via hasSnapshot (read entry point — migration is idempotent).
      expect(hasSnapshot({ home })).toBe(true);
      // Legacy root is gone; new root holds the manifest verbatim.
      expect(existsSync(legacyRoot)).toBe(false);
      const moved = JSON.parse(await readFile(path.join(originalEnvBackupRoot(home), 'manifest.json'), 'utf-8'));
      expect(moved.files.claude.existed).toBe(true);
      // snapshotOriginals must NOT re-snapshot now that the (migrated) manifest exists.
      const snap = snapshotOriginals({ home });
      expect(snap.created).toBe(false);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
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

  it('restores even when manifest.backupPath points at a stale legacy location', async () => {
    // Reproduces the real 1.9.8→1.9.9 regression: the snapshot dir moved from
    // ~/.hermit-env.bak to ~/.hermit/agentcli.env.bak, but an already-written
    // manifest still records `backupPath` under the OLD legacy root. restore
    // must resolve the CURRENT canonical path (not the stale one) and succeed.
    const home = await freshHome();
    try {
      const paths = livePaths(home);
      await mkdir(path.dirname(paths.claude), { recursive: true });
      await writeFile(paths.claude, JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'ORIGINAL' } }));
      await mkdir(path.dirname(paths.codexConfig), { recursive: true });
      await writeFile(paths.codexConfig, '# ORIGINAL\nmodel = "gpt-4o"\n');

      // Build the snapshot normally (creates canonical paths).
      snapshotOriginals({ home });
      // Simulate the bug: rewrite manifest.backupPath to the legacy root.
      const manifestFile = path.join(originalEnvBackupRoot(home), 'manifest.json');
      const manifest = JSON.parse(await readFile(manifestFile, 'utf-8'));
      for (const entry of Object.values(manifest.files)) {
        if (entry.backupPath) {
          entry.backupPath = entry.backupPath.replace(
            originalEnvBackupRoot(home),
            path.join(home, '.hermit-env.bak'),
          );
        }
      }
      await writeFile(manifestFile, JSON.stringify(manifest, null, 2));

      // Mutate live files (simulate token pool write).
      await writeFile(paths.claude, JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'POOL-KEY' } }));
      await writeFile(paths.codexConfig, '# POOL\nmodel = "qwen-max"\n');

      // restoreOriginals must NOT trust the stale backupPath — it resolves the
      // current canonical path and restores successfully.
      const result = restoreOriginals({ home });
      expect(result.ok).toBe(true);
      const byRuntime = Object.fromEntries(result.results.map((r) => [r.runtime, r]));
      expect(byRuntime.claude.action).toBe('restored');
      expect(byRuntime['codex-config'].action).toBe('restored');
      expect(JSON.parse(await readFile(paths.claude, 'utf-8')).env.ANTHROPIC_AUTH_TOKEN).toBe('ORIGINAL');
      expect(await readFile(paths.codexConfig, 'utf-8')).toContain('gpt-4o');
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('migration rewrites stale legacy backupPaths in the manifest to the new root', async () => {
    // A legacy snapshot's manifest records backupPath under the old
    // ~/.hermit-env.bak root. After migration to ~/.hermit/agentcli.env.bak,
    // the manifest's backupPaths must be rewritten so restore can find the files.
    const home = await freshHome();
    try {
      const legacyRoot = path.join(home, '.hermit-env.bak');
      const legacyClaudeBackup = path.join(legacyRoot, 'claude', 'settings.json');
      const legacyManifest = path.join(legacyRoot, 'manifest.json');
      await mkdir(path.dirname(legacyClaudeBackup), { recursive: true });
      await writeFile(legacyClaudeBackup, JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'ORIGINAL' } }));
      // Manifest's backupPath still points at the legacy root (pre-rename).
      await writeFile(
        legacyManifest,
        JSON.stringify({
          schemaVersion: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          files: {
            claude: { existed: true, livePath: path.join(home, '.claude', 'settings.json'), backupPath: legacyClaudeBackup },
          },
        }),
      );

      // hasSnapshot triggers migration (dir rename + manifest path rewrite).
      expect(hasSnapshot({ home })).toBe(true);
      const moved = JSON.parse(await readFile(path.join(originalEnvBackupRoot(home), 'manifest.json'), 'utf-8'));
      expect(moved.files.claude.backupPath).toBe(path.join(originalEnvBackupRoot(home), 'claude', 'settings.json'));
      // And restore now works end-to-end against the rewritten path.
      const paths = livePaths(home);
      await mkdir(path.dirname(paths.claude), { recursive: true });
      await writeFile(paths.claude, JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'POOL-KEY' } }));
      const result = restoreOriginals({ home });
      expect(result.results[0].action).toBe('restored');
      expect(JSON.parse(await readFile(paths.claude, 'utf-8')).env.ANTHROPIC_AUTH_TOKEN).toBe('ORIGINAL');
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
