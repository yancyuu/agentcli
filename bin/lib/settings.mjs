// settings.mjs — ~/.hermit/settings.json read/write helpers and the team-
// collaboration / task-bus default-config builders. Shared leaf used by auth
// (safeReadJson), teams, services, and usage.

import path from 'node:path';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { hermitSettingsPath } from './env.mjs';

function chmodBestEffort(filePath, mode) {
  try {
    chmodSync(filePath, mode);
  } catch {
    // Permission hardening is best-effort across platforms.
  }
}

function safeReadJson(filePath) {
  try {
    return { value: JSON.parse(readFileSync(filePath, 'utf-8')) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function readHermitSettings() {
  if (!existsSync(hermitSettingsPath)) return {};
  const { value } = safeReadJson(hermitSettingsPath);
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function writeHermitSettings(settings) {
  const settingsDir = path.dirname(hermitSettingsPath);
  mkdirSync(settingsDir, { recursive: true, mode: 0o700 });
  chmodBestEffort(settingsDir, 0o700);
  writeFileSync(hermitSettingsPath, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
  chmodBestEffort(hermitSettingsPath, 0o600);
}

function buildTeamCollaborationTaskBusConfig(current = {}) {
  const existing = current && typeof current === 'object' ? current : {};
  const redis = existing.redis && typeof existing.redis === 'object'
    ? existing.redis
    : { host: '127.0.0.1', port: 6379 };
  const existingTelemetry = existing.telemetry && typeof existing.telemetry === 'object' ? existing.telemetry : {};
  return {
    ...existing,
    enabled: true,
    redis: {
      host: typeof redis.host === 'string' && redis.host.trim() ? redis.host : '127.0.0.1',
      port: Number.isFinite(Number(redis.port)) ? Number(redis.port) : 6379,
      ...(redis.password ? { password: redis.password } : {}),
      ...(redis.db !== undefined ? { db: redis.db } : {}),
    },
    collaboration: true,
    telemetry: {
      ...existingTelemetry,
      enabled: true,
      platform: 'claudecode',
    },
  };
}

function enableTeamCollaborationDefaults() {
  const settings = readHermitSettings();
  const taskBus = buildTeamCollaborationTaskBusConfig(settings.taskBus);
  writeHermitSettings({ ...settings, taskBus });
  return taskBus;
}


export {
chmodBestEffort,
safeReadJson,
readHermitSettings,
writeHermitSettings,
buildTeamCollaborationTaskBusConfig,
enableTeamCollaborationDefaults,
};
