// configEnvBackup.mjs — timestamped snapshots + restore of the LOCAL runtime
// configs (Claude Code + Codex) changed by the token-pool claim flow.
//
// Every claim captures a new snapshot. Restore deliberately does NOT remove a
// snapshot: users choose a time point in the CLI and may restore it again later.
// Snapshot contents include live API keys, so every file is written mode 0o600.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { chmodBestEffort } from './settings.mjs';

const SCHEMA_VERSION = 2;
const BACKUP_DIR_NAME = 'agentcli.env.bak';
const LEGACY_BACKUP_DIR_NAME = '.hermit-env.bak';
const SNAPSHOTS_DIR_NAME = 'snapshots';
const MAX_SNAPSHOTS = 20;

export function originalEnvBackupRoot(home = os.homedir()) {
  return path.join(home, '.hermit', BACKUP_DIR_NAME);
}

function snapshotsRoot(home) {
  return path.join(originalEnvBackupRoot(home), SNAPSHOTS_DIR_NAME);
}

function manifestPath(snapshotRoot) {
  return path.join(snapshotRoot, 'manifest.json');
}

// The files the claim flow can mutate, keyed by a stable runtime tag.
export function listOriginalTargets(home = os.homedir()) {
  return [
    { runtime: 'claude', dir: 'claude', file: 'settings.json', livePath: path.join(home, '.claude', 'settings.json') },
    { runtime: 'codex-auth', dir: 'codex', file: 'auth.json', livePath: path.join(home, '.codex', 'auth.json') },
    { runtime: 'codex-config', dir: 'codex', file: 'config.toml', livePath: path.join(home, '.codex', 'config.toml') },
    { runtime: 'pi-auth', dir: 'pi', file: 'auth.json', livePath: path.join(home, '.pi', 'agent', 'auth.json') },
    { runtime: 'pi-models', dir: 'pi', file: 'models.json', livePath: path.join(home, '.pi', 'agent', 'models.json') },
    { runtime: 'pi-settings', dir: 'pi', file: 'settings.json', livePath: path.join(home, '.pi', 'agent', 'settings.json') },
  ];
}

function backupPathFor(target, snapshotRoot) {
  return path.join(snapshotRoot, target.dir, target.file);
}

function parseManifest(snapshotRoot, id, legacy = false) {
  const file = manifestPath(snapshotRoot);
  if (!existsSync(file)) return null;
  try {
    const manifest = JSON.parse(readFileSync(file, 'utf-8'));
    if (!manifest || typeof manifest !== 'object' || !manifest.files) return null;
    return {
      id,
      root: snapshotRoot,
      manifest,
      legacy,
      createdAt: typeof manifest.createdAt === 'string' ? manifest.createdAt : '',
    };
  } catch {
    return null;
  }
}

// One-time relocation for pre-1.9.32 snapshots. A legacy root holds a single
// manifest directly under ~/.hermit-env.bak; preserve it as one selectable
// legacy entry rather than re-capturing the now-modified live configs.
function migrateLegacyRootIfNeeded(home) {
  const legacy = path.join(home, LEGACY_BACKUP_DIR_NAME);
  if (!existsSync(legacy)) return;
  const next = originalEnvBackupRoot(home);
  if (existsSync(manifestPath(next)) || existsSync(snapshotsRoot(home))) return;
  try {
    mkdirSync(path.dirname(next), { recursive: true });
    renameSync(legacy, next);
  } catch {
    // Keep the old directory intact if the move cannot be completed.
  }
}

/** List available restore points, newest first. Metadata contains no secrets. */
export function listSnapshots({ home = os.homedir() } = {}) {
  migrateLegacyRootIfNeeded(home);
  const root = originalEnvBackupRoot(home);
  const snapshots = [];

  // A pre-history snapshot was stored directly at the backup root. Continue to
  // expose it so upgrades do not discard the only recoverable configuration.
  const legacy = parseManifest(root, 'legacy', true);
  if (legacy) snapshots.push(legacy);

  const historyRoot = snapshotsRoot(home);
  if (existsSync(historyRoot)) {
    for (const entry of readdirSync(historyRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const snapshot = parseManifest(path.join(historyRoot, entry.name), entry.name);
      if (snapshot) snapshots.push(snapshot);
    }
  }

  return snapshots
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map(({ id, createdAt, legacy: isLegacy, manifest }) => ({
      id,
      createdAt,
      legacy: isLegacy,
      fileCount: Object.keys(manifest.files).length,
    }));
}

export function hasSnapshot({ home = os.homedir() } = {}) {
  return listSnapshots({ home }).length > 0;
}

function snapshotId(now) {
  return `${now.replace(/[-:.TZ]/g, '')}-${Math.random().toString(36).slice(2, 8)}`;
}

function pruneSnapshots(home) {
  const historyRoot = snapshotsRoot(home);
  const all = listSnapshots({ home }).filter((snapshot) => !snapshot.legacy);
  for (const snapshot of all.slice(MAX_SNAPSHOTS)) {
    rmSync(path.join(historyRoot, snapshot.id), { recursive: true, force: true });
  }
}

/** Capture a new restore point immediately before token-pool config writes. */
export function snapshotOriginals({ home = os.homedir() } = {}) {
  migrateLegacyRootIfNeeded(home);
  const now = new Date().toISOString();
  const id = snapshotId(now);
  const root = path.join(snapshotsRoot(home), id);
  const files = {};
  mkdirSync(root, { recursive: true });

  for (const target of listOriginalTargets(home)) {
    const existed = existsSync(target.livePath) && statSync(target.livePath).isFile();
    const entry = { existed, livePath: target.livePath, backupPath: backupPathFor(target, root) };
    if (existed) {
      mkdirSync(path.dirname(entry.backupPath), { recursive: true });
      copyFileSync(target.livePath, entry.backupPath);
      chmodBestEffort(entry.backupPath, 0o600);
    }
    files[target.runtime] = entry;
  }

  const manifest = manifestPath(root);
  writeFileSync(manifest, `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, createdAt: now, files }, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: 0o600,
  });
  chmodBestEffort(manifest, 0o600);
  pruneSnapshots(home);
  return { created: true, id, root, manifest, createdAt: now, files };
}

function readSnapshot(home, requestedId) {
  migrateLegacyRootIfNeeded(home);
  const root = originalEnvBackupRoot(home);
  const candidates = [];
  const legacy = parseManifest(root, 'legacy', true);
  if (legacy) candidates.push(legacy);
  const historyRoot = snapshotsRoot(home);
  if (existsSync(historyRoot)) {
    for (const entry of readdirSync(historyRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const snapshot = parseManifest(path.join(historyRoot, entry.name), entry.name);
        if (snapshot) candidates.push(snapshot);
      }
    }
  }
  candidates.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return requestedId ? candidates.find((snapshot) => snapshot.id === requestedId) ?? null : candidates[0] ?? null;
}

/**
 * Restore one selected snapshot. Existing target files are copied back; files
 * that did not exist at capture time are deleted. The selected snapshot remains
 * available afterwards, so users can select it again or choose another time.
 */
export function restoreOriginals({ home = os.homedir(), snapshotId: requestedId } = {}) {
  const snapshot = readSnapshot(home, requestedId);
  if (!snapshot) {
    return { ok: false, reason: requestedId ? 'snapshot-not-found' : 'no-snapshot', results: [] };
  }

  const byRuntime = new Map(listOriginalTargets(home).map((target) => [target.runtime, target]));
  const results = [];
  for (const [runtime, entry] of Object.entries(snapshot.manifest.files || {})) {
    const target = byRuntime.get(runtime);
    if (entry.existed) {
      // New snapshots have exact paths. For legacy manifests that record the
      // old root, use the selected snapshot root as a safe canonical fallback.
      const backupPath = existsSync(entry.backupPath)
        ? entry.backupPath
        : target
          ? backupPathFor(target, snapshot.root)
          : entry.backupPath;
      if (!backupPath || !existsSync(backupPath)) {
        results.push({ runtime, action: 'skipped', reason: 'backup-missing' });
        continue;
      }
      mkdirSync(path.dirname(entry.livePath), { recursive: true });
      copyFileSync(backupPath, entry.livePath);
      chmodBestEffort(entry.livePath, 0o600);
      results.push({ runtime, action: 'restored', path: entry.livePath });
    } else if (existsSync(entry.livePath)) {
      rmSync(entry.livePath, { force: true });
      results.push({ runtime, action: 'deleted', path: entry.livePath });
    } else {
      results.push({ runtime, action: 'skipped', reason: 'already-absent' });
    }
  }
  const ok = results.every((result) => result.reason !== 'backup-missing');
  return { ok, ...(ok ? {} : { reason: 'incomplete' }), snapshotId: snapshot.id, results };
}
