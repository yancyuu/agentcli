// Shared read-only CLI environment: parsed args, version, and all derived paths.
// Computed once at import time; every other bin/lib module imports from here.
//
// No mutable state lives here. Module-local mutable handles (daemon child
// processes, shutdown guards, nav UI flags) stay in the modules that own them.

import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { BRAND } from '../branding.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const binDir = path.resolve(__dirname, '..');
export const repoRoot = path.resolve(binDir, '..');
export const require = createRequire(import.meta.url);

const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
export { pkg };
export const currentVersion = pkg.version;

// Re-export branding primitives so consumers can import everything CLI-wide
// from a single surface if they wish.
export { BRAND };

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------

export const args = process.argv.slice(2);
export const jsonRequested = args.includes('--json');

function parseCommandArgs(rawArgs) {
  const parsed = [];
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === '--json' || arg === '--daemon' || arg === '--no-hermit-bridge') continue;
    if (arg === '--port' || arg === '--control-url') {
      i += 1;
      continue;
    }
    parsed.push(arg);
  }
  return parsed;
}

export const commandArgs = parseCommandArgs(args);

// ---------------------------------------------------------------------------
// Derived paths and daemon/runtime flags
// ---------------------------------------------------------------------------

const portIndex = args.indexOf('--port');
export const port = portIndex !== -1 && args[portIndex + 1] ? args[portIndex + 1] : '5680';
export const skipHermitBridge =
  args.includes('--no-hermit-bridge') || process.env.HERMIT_NO_HERMIT_BRIDGE === '1';
export const hermitHome = process.env.HERMIT_HOME || path.join(os.homedir(), '.hermit');
export const daemonRequested = args.includes('--daemon');
export const daemonChild = process.env.HERMIT_DAEMON_CHILD === '1';

export const daemonPidPath = path.join(hermitHome, 'openhermit.pid');
export const daemonLogPath = path.join(hermitHome, 'logs', 'openhermit.log');
export const runtimeLogPath = path.join(hermitHome, 'logs', 'openhermit-runtime.log');
export const serverLogPath = path.join(hermitHome, 'logs', 'openhermit-server.log');
export const hermitSettingsPath = path.join(hermitHome, 'settings.json');

export const telemetryDir = path.join(hermitHome, 'telemetry');
export const telemetryWorkerPidPath = path.join(telemetryDir, 'worker.pid');
export const telemetryWorkerStatusPath = path.join(telemetryDir, 'status.json');
export const telemetryWorkerLogPath = path.join(hermitHome, 'logs', 'telemetry-worker.log');
export const telemetryWorkerErrorLogPath = path.join(hermitHome, 'logs', 'telemetry-worker.err.log');
export const conversationUploadLogPath = path.join(hermitHome, 'logs', 'conversation-upload.log');

export const legacyRuntimeBridgeDir = path.join(hermitHome, 'cc-connect');
export const hermitBridgeDir = path.join(hermitHome, 'hermit-bridge');
export const legacyRuntimeBridgeConfigPath = path.join(legacyRuntimeBridgeDir, 'config.toml');
export const defaultHermitBridgeConfigPath = path.join(hermitBridgeDir, 'config.toml');
export const legacyRuntimeBridgeDataDir = path.join(legacyRuntimeBridgeDir, 'data');
export const defaultHermitBridgeDataDir = path.join(hermitBridgeDir, 'data');
export const hermitBridgeConfigPath =
  process.env.HERMIT_BRIDGE_CONFIG || defaultHermitBridgeConfigPath;
export const starterProjectName = 'my-project';
export function findOptionValue(name) {
  const index = commandArgs.indexOf(name);
  return index !== -1 ? commandArgs[index + 1] : undefined;
}

export function findOptionValues(name) {
  const values = [];
  for (let index = 0; index < commandArgs.length; index += 1) {
    if (commandArgs[index] === name && commandArgs[index + 1] && !commandArgs[index + 1].startsWith('--')) {
      values.push(commandArgs[index + 1]);
    }
  }
  return values;
}

export function findAnyOptionValues(names) {
  return names.flatMap((name) => findOptionValues(name));
}

export function findAnyOptionValue(names) {
  for (const name of names) {
    const value = findOptionValue(name);
    if (value !== undefined) return value;
  }

  return undefined;
}
