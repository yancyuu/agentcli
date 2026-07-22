// Timestamped token-pool config snapshots. Tests use a temporary home and never
// read or write the developer's real Claude/Codex/Pi configuration.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  hasSnapshot,
  listOriginalTargets,
  listSnapshots,
  originalEnvBackupRoot,
  restoreOriginals,
  snapshotOriginals,
} from '../configEnvBackup.mjs';

async function freshHome() {
  return mkdtemp(path.join(os.tmpdir(), 'hermit-envbak-'));
}

function livePaths(home) {
  return {
    claude: path.join(home, '.claude', 'settings.json'),
    codexAuth: path.join(home, '.codex', 'auth.json'),
    codexConfig: path.join(home, '.codex', 'config.toml'),
    piAuth: path.join(home, '.pi', 'agent', 'auth.json'),
    piModels: path.join(home, '.pi', 'agent', 'models.json'),
    piSettings: path.join(home, '.pi', 'agent', 'settings.json'),
  };
}

async function writeAll(paths, suffix) {
  for (const [runtime, file] of Object.entries(paths)) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${runtime}:${suffix}\n`);
  }
}

describe('listOriginalTargets', () => {
  it('tracks every configuration file the token-pool claim flow can mutate', () => {
    const targets = listOriginalTargets('/tmp/fake-home');
    expect(targets.map((target) => target.runtime)).toEqual([
      'claude',
      'codex-auth',
      'codex-config',
      'pi-auth',
      'pi-models',
      'pi-settings',
    ]);
    expect(targets.find((target) => target.runtime === 'pi-settings')?.livePath).toBe(
      path.join('/tmp/fake-home', '.pi', 'agent', 'settings.json'),
    );
  });

  it('stores snapshots under ~/.hermit/agentcli.env.bak', () => {
    expect(originalEnvBackupRoot('/tmp/fake-home')).toBe(
      path.join('/tmp/fake-home', '.hermit', 'agentcli.env.bak'),
    );
  });
});

describe('timestamped snapshots and restore', () => {
  it('keeps multiple time points and restores the explicitly selected one, including Pi', async () => {
    const home = await freshHome();
    try {
      const paths = livePaths(home);
      await writeAll(paths, 'before-first-claim');
      const first = snapshotOriginals({ home });

      await writeAll(paths, 'before-second-claim');
      const second = snapshotOriginals({ home });

      await writeAll(paths, 'current-pool-write');
      const snapshots = listSnapshots({ home });
      expect(snapshots).toHaveLength(2);
      expect(snapshots.map((snapshot) => snapshot.id)).toContain(first.id);
      expect(snapshots.map((snapshot) => snapshot.id)).toContain(second.id);
      expect(hasSnapshot({ home })).toBe(true);

      const restored = restoreOriginals({ home, snapshotId: first.id });
      expect(restored.ok).toBe(true);
      expect(restored.snapshotId).toBe(first.id);
      expect(restored.results.map((result) => result.runtime)).toEqual([
        'claude',
        'codex-auth',
        'codex-config',
        'pi-auth',
        'pi-models',
        'pi-settings',
      ]);
      expect(await readFile(paths.claude, 'utf8')).toBe('claude:before-first-claim\n');
      expect(await readFile(paths.piAuth, 'utf8')).toBe('piAuth:before-first-claim\n');
      expect(await readFile(paths.piModels, 'utf8')).toBe('piModels:before-first-claim\n');
      expect(await readFile(paths.piSettings, 'utf8')).toBe('piSettings:before-first-claim\n');

      // Restoring no longer consumes history: the user can select another point.
      expect(listSnapshots({ home })).toHaveLength(2);
      restoreOriginals({ home, snapshotId: second.id });
      expect(await readFile(paths.piSettings, 'utf8')).toBe('piSettings:before-second-claim\n');
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('deletes files created by the token pool when they were absent at capture time', async () => {
    const home = await freshHome();
    try {
      const paths = livePaths(home);
      await mkdir(path.dirname(paths.claude), { recursive: true });
      await writeFile(paths.claude, 'claude:original\n');
      const snapshot = snapshotOriginals({ home });

      await mkdir(path.dirname(paths.piAuth), { recursive: true });
      await writeFile(paths.piAuth, 'pi:pool-created\n');
      const restored = restoreOriginals({ home, snapshotId: snapshot.id });
      expect(restored.ok).toBe(true);
      expect(existsSync(paths.piAuth)).toBe(false);
      expect(await readFile(paths.claude, 'utf8')).toBe('claude:original\n');
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('keeps a pre-history single snapshot selectable after migrating its legacy location', async () => {
    const home = await freshHome();
    try {
      const legacyRoot = path.join(home, '.hermit-env.bak');
      const legacyClaude = path.join(legacyRoot, 'claude', 'settings.json');
      const liveClaude = path.join(home, '.claude', 'settings.json');
      await mkdir(path.dirname(legacyClaude), { recursive: true });
      await writeFile(legacyClaude, 'legacy-claude\n');
      await writeFile(
        path.join(legacyRoot, 'manifest.json'),
        JSON.stringify({
          schemaVersion: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          files: {
            claude: { existed: true, livePath: liveClaude, backupPath: legacyClaude },
          },
        }),
      );
      await mkdir(path.dirname(liveClaude), { recursive: true });
      await writeFile(liveClaude, 'pool-value\n');

      const snapshots = listSnapshots({ home });
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].id).toBe('legacy');
      expect(existsSync(path.join(home, '.hermit-env.bak'))).toBe(false);
      expect(restoreOriginals({ home, snapshotId: 'legacy' }).ok).toBe(true);
      expect(await readFile(liveClaude, 'utf8')).toBe('legacy-claude\n');
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
