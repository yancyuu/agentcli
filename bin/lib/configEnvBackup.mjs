// configEnvBackup.mjs — one-time snapshot + one-click restore of the LOCAL
// runtime configs (Claude Code + Codex) that the token-pool claim flow writes.
//
// Semantics (deliberately NOT a per-write *.hermit-bak):
//   • snapshotOriginals() is CREATE-ONCE. The first time the token pool is about
//     to touch ~/.claude|~/.codex, it captures the user's PRE-token-pool originals
//     into ~/.hermit/agentcli.env.bak. Subsequent claims never overwrite it — the
//     snapshot always means "what the machine looked like before the token pool intervened".
//   • restoreOriginals() replays that snapshot: existed files are copied back,
//     files the token pool CREATED (originally absent) are deleted, so the machine
//     returns to its pre-token-pool state with no leftover residue.
//
// The snapshot files hold live API keys, so they are written mode 0o600.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { chmodBestEffort } from './settings.mjs';

const SCHEMA_VERSION = 1;
const BACKUP_DIR_NAME = 'agentcli.env.bak';
const LEGACY_BACKUP_DIR_NAME = '.hermit-env.bak'; // pre-rename sibling of ~/.hermit

export function originalEnvBackupRoot(home = os.homedir()) {
  return path.join(home, '.hermit', BACKUP_DIR_NAME);
}

// One-time relocation of a legacy snapshot. Snapshots used to live at
// ~/.hermit-env.bak (a sibling of ~/.hermit); they now live INSIDE ~/.hermit as
// agentcli.env.bak. If a legacy snapshot exists and the new location has no
// manifest yet, move it verbatim so the user's pre-token-pool originals survive
// (otherwise the next snapshotOriginals would re-capture the now pool-overwritten
// live files as "original"). Idempotent: a no-op once the new manifest exists.
function migrateLegacyRootIfNeeded(home) {
  const legacy = path.join(home, LEGACY_BACKUP_DIR_NAME);
  if (!existsSync(legacy)) return;
  const next = originalEnvBackupRoot(home);
  if (existsSync(path.join(next, 'manifest.json'))) return; // new location already populated — don't clobber
  try {
    mkdirSync(path.dirname(next), { recursive: true });
    renameSync(legacy, next); // same-filesystem rename under ~ → atomic, no cross-device risk
  } catch {
    // Leave the legacy dir in place on unexpected failure rather than risk
    // losing the snapshot; the user can restore once and the legacy dir becomes
    // harmless. Not worth a cross-device copy shim for a one-time migration.
  }
}

// The three files the claim flow can mutate, keyed by a stable runtime tag used
// both in the manifest and in the backup directory layout.
export function listOriginalTargets(home = os.homedir()) {
  return [
    { runtime: 'claude', dir: 'claude', file: 'settings.json', livePath: path.join(home, '.claude', 'settings.json') },
    { runtime: 'codex-auth', dir: 'codex', file: 'auth.json', livePath: path.join(home, '.codex', 'auth.json') },
    { runtime: 'codex-config', dir: 'codex', file: 'config.toml', livePath: path.join(home, '.codex', 'config.toml') },
  ];
}

function manifestPath(home) {
  return path.join(originalEnvBackupRoot(home), 'manifest.json');
}

function backupPathFor(target, home) {
  return path.join(originalEnvBackupRoot(home), target.dir, target.file);
}

export function hasSnapshot({ home = os.homedir() } = {}) {
  migrateLegacyRootIfNeeded(home);
  return existsSync(manifestPath(home));
}

/**
 * Create the original-env snapshot if it does not already exist. Idempotent: a
 * second call is a no-op and never overwrites a prior snapshot. Returns a summary
 * describing whether the snapshot was created this call and what it captured.
 */
export function snapshotOriginals({ home = os.homedir() } = {}) {
  migrateLegacyRootIfNeeded(home);
  const root = originalEnvBackupRoot(home);
  const manifest = manifestPath(home);
  if (existsSync(manifest)) {
    return { created: false, root, manifest };
  }

  const now = new Date().toISOString();
  const files = {};
  mkdirSync(root, { recursive: true });
  for (const target of listOriginalTargets(home)) {
    const existed = existsSync(target.livePath) && statSync(target.livePath).isFile();
    const entry = { existed, livePath: target.livePath, backupPath: backupPathFor(target, home) };
    if (existed) {
      mkdirSync(path.dirname(entry.backupPath), { recursive: true });
      copyFileSync(target.livePath, entry.backupPath);
      chmodBestEffort(entry.backupPath, 0o600);
    }
    files[target.runtime] = entry;
  }
  writeFileSync(manifest, `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, createdAt: now, files }, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: 0o600,
  });
  chmodBestEffort(manifest, 0o600);
  return { created: true, root, manifest, createdAt: now, files };
}

function readManifest(home) {
  if (!hasSnapshot({ home })) return null;
  try {
    return JSON.parse(readFileSync(manifestPath(home), 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Restore the original-env snapshot. For each tracked file: copy the backup back
 * over the live path when it originally existed, or DELETE the live path when the
 * token pool created it (originally absent). Returns a per-runtime result list.
 */
export function restoreOriginals({ home = os.homedir() } = {}) {
  const manifest = readManifest(home);
  if (!manifest) {
    return { ok: false, reason: 'no-snapshot', results: [] };
  }
  const results = [];
  for (const [runtime, entry] of Object.entries(manifest.files || {})) {
    if (entry.existed) {
      if (!existsSync(entry.backupPath)) {
        results.push({ runtime, action: 'skipped', reason: 'backup-missing' });
        continue;
      }
      mkdirSync(path.dirname(entry.livePath), { recursive: true });
      copyFileSync(entry.backupPath, entry.livePath);
      chmodBestEffort(entry.livePath, 0o600);
      results.push({ runtime, action: 'restored', path: entry.livePath });
    } else {
      if (existsSync(entry.livePath)) {
        rmSync(entry.livePath, { force: true });
        results.push({ runtime, action: 'deleted', path: entry.livePath });
      } else {
        results.push({ runtime, action: 'skipped', reason: 'already-absent' });
      }
    }
  }
  return { ok: true, results };
}
