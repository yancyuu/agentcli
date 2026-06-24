#!/usr/bin/env node

import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BRAND, brandCommand, brandLogPrefix } from './branding.mjs';

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
const bundledWorkflowsDir = path.join(packageRoot, 'src/main/services/system-manager/builtin-workflows');
const hermitWorkflowDir = path.join(hermitHome, '.claude', 'workflow');
const builtinWorkflowMarker = '<!-- hermit-builtin-workflow:v2-loop -->';

function normalizeHermitBridgeConfig(raw) {
  return raw
    .split(legacyRuntimeBridgeDataDir)
    .join(hermitBridgeDataDir)
    .split('~/.hermit/cc-connect/data')
    .join(`~/${BRAND.defaultLocalHomeName}/${BRAND.runtimeBridgeName}/data`);
}

function seedBuiltinWorkflows() {
  if (!existsSync(bundledWorkflowsDir)) return { copied: 0, refreshed: 0, skipped: 0 };
  mkdirSync(hermitWorkflowDir, { recursive: true });
  let copied = 0;
  let refreshed = 0;
  let skipped = 0;

  for (const filename of readdirSync(bundledWorkflowsDir)) {
    if (!filename.endsWith('.md') && !filename.endsWith('.js')) continue;
    const sourcePath = path.join(bundledWorkflowsDir, filename);
    const targetPath = path.join(hermitWorkflowDir, filename);
    const bundled = readFileSync(sourcePath, 'utf-8');

    if (!existsSync(targetPath)) {
      writeFileSync(targetPath, bundled, 'utf-8');
      copied += 1;
      continue;
    }

    const existing = readFileSync(targetPath, 'utf-8');
    if (!existing.includes(builtinWorkflowMarker)) {
      skipped += 1;
      continue;
    }
    if (existing !== bundled) {
      writeFileSync(targetPath, bundled, 'utf-8');
      refreshed += 1;
    }
  }

  return { copied, refreshed, skipped };
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
let seededWorkflows = { copied: 0, refreshed: 0, skipped: 0 };
let workflowSeedError = null;
try {
  seededWorkflows = seedBuiltinWorkflows();
} catch (err) {
  workflowSeedError = err;
}

console.log(`${brandLogPrefix()} Installed ${version}`);
console.log(`${brandLogPrefix()} Bundled ${BRAND.runtimeBridgeName} runtime service: ${runtimeVersion}`);
console.log(`${brandLogPrefix()} Data directory: ${hermitHome}`);
if (migratedRuntimeConfig) console.log(`${brandLogPrefix()} Migrated runtime files to ~/${BRAND.defaultLocalHomeName}/${BRAND.runtimeBridgeName}/`);
if (workflowSeedError) {
  console.log(`${brandLogPrefix()} Skipped workflow installation: ${workflowSeedError.message ?? String(workflowSeedError)}`);
} else {
  const changedWorkflows = seededWorkflows.copied + seededWorkflows.refreshed;
  console.log(
    `${brandLogPrefix()} Installed ${changedWorkflows} workflow(s) to ${hermitWorkflowDir}` +
      (seededWorkflows.skipped ? `; skipped ${seededWorkflows.skipped} user-managed file(s)` : '')
  );
}
console.log(`${brandLogPrefix()} Start with: ${brandCommand()}`);
console.log(`${brandLogPrefix()} Background mode: ${brandCommand('--daemon')}`);
