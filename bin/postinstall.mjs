#!/usr/bin/env node

import { readFileSync } from 'node:fs';
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
  runtimeVersion = JSON.parse(readFileSync(require.resolve('cc-connect/package.json'), 'utf-8')).version;
} catch {
  // Keep install non-blocking.
}

const hermitHome = process.env.HERMIT_HOME || path.join(os.homedir(), '.hermit');

console.log(`[openHermit] Installed ${version}`);
console.log(`[openHermit] Bundled runtime service: ${runtimeVersion}`);
console.log(`[openHermit] Data directory: ${hermitHome}`);
console.log('[openHermit] Start with: openhermit');
console.log('[openHermit] Background mode: openhermit --daemon');
