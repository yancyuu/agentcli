#!/usr/bin/env node

import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let version = 'unknown';
try {
  version = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf-8')).version;
} catch {
  // Keep install non-blocking.
}

let runtimeVersion = 'bundled';
try {
  runtimeVersion = JSON.parse(readFileSync(require.resolve('hermit-bridge/package.json'), 'utf-8')).version;
} catch {
  // Keep install non-blocking.
}

const hermitHome = process.env.HERMIT_HOME || path.join(os.homedir(), '.hermit');

const legacyRuntimeBridgeDir = path.join(hermitHome, 'cc-connect');
const hermitBridgeDir = path.join(hermitHome, 'hermit-bridge');
const legacyRuntimeBridgeConfigPath = path.join(legacyRuntimeBridgeDir, 'config.toml');
const hermitBridgeConfigPath = path.join(hermitBridgeDir, 'config.toml');
const legacyRuntimeBridgeDataDir = path.join(legacyRuntimeBridgeDir, 'data');
const hermitBridgeDataDir = path.join(hermitBridgeDir, 'data');

function normalizeHermitBridgeConfig(raw) {
  return raw
    .split(legacyRuntimeBridgeDataDir)
    .join(hermitBridgeDataDir)
    .split('~/.hermit/cc-connect/data')
    .join('~/.hermit/hermit-bridge/data');
}

function migrateLegacyHermitBridgeFiles() {
  mkdirSync(hermitBridgeDir, { recursive: true });
  let changed = false;
  if (!existsSync(hermitBridgeDataDir) && existsSync(legacyRuntimeBridgeDataDir)) {
    try {
      renameSync(legacyRuntimeBridgeDataDir, hermitBridgeDataDir);
    } catch {
      cpSync(legacyRuntimeBridgeDataDir, hermitBridgeDataDir, { recursive: true });
      rmSync(legacyRuntimeBridgeDataDir, { recursive: true, force: true });
    }
    changed = true;
  }

  if (!existsSync(hermitBridgeConfigPath) && existsSync(legacyRuntimeBridgeConfigPath)) {
    copyFileSync(legacyRuntimeBridgeConfigPath, hermitBridgeConfigPath);
    rmSync(legacyRuntimeBridgeConfigPath, { force: true });
    changed = true;
  }
  if (existsSync(hermitBridgeConfigPath)) {
    const raw = readFileSync(hermitBridgeConfigPath, 'utf-8');
    const migrated = normalizeHermitBridgeConfig(raw);
    if (migrated !== raw) {
      writeFileSync(hermitBridgeConfigPath, migrated, 'utf-8');
      changed = true;
    }
  }
  return changed;
}

const migratedRuntimeConfig = migrateLegacyHermitBridgeFiles();

console.log(`[openHermit] Installed ${version}`);
console.log(`[openHermit] Bundled hermit-bridge runtime service: ${runtimeVersion}`);
console.log(`[openHermit] Data directory: ${hermitHome}`);
if (migratedRuntimeConfig) console.log('[openHermit] Migrated runtime files to ~/.hermit/hermit-bridge/');
console.log('[openHermit] Start with: openhermit');
console.log('[openHermit] Background mode: openhermit --daemon');
