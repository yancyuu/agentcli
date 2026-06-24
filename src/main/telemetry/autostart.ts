import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { getUsageTelemetryWorkerPaths, resolveHermitHome } from './worker';

const execFileAsync = promisify(execFile);
export const USAGE_TELEMETRY_LAUNCHD_LABEL = 'com.openhermit.telemetry';

export interface UsageTelemetryAutostartOptions {
  hermitHome?: string;
  nodePath?: string;
  cliPath?: string;
  label?: string;
}

export interface UsageTelemetryAutostartStatus {
  supported: boolean;
  platform: NodeJS.Platform;
  enabled: boolean;
  loaded: boolean;
  label: string;
  plistPath: string;
  message?: string;
}

function launchAgentsDir(): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents');
}

export function getUsageTelemetryLaunchdPlistPath(label = USAGE_TELEMETRY_LAUNCHD_LABEL): string {
  return path.join(launchAgentsDir(), `${label}.plist`);
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function stringEntry(value: string): string {
  return `\t\t<string>${xmlEscape(value)}</string>`;
}

export function buildUsageTelemetryLaunchdPlist(
  options: Required<UsageTelemetryAutostartOptions>
): string {
  const paths = getUsageTelemetryWorkerPaths(options.hermitHome);
  const safePath =
    process.env.PATH || '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
  const programArguments = [options.nodePath, options.cliPath, '__telemetry-worker'];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>${xmlEscape(options.label)}</string>
\t<key>ProgramArguments</key>
\t<array>
${programArguments.map(stringEntry).join('\n')}
\t</array>
\t<key>EnvironmentVariables</key>
\t<dict>
\t\t<key>HERMIT_HOME</key>
\t\t<string>${xmlEscape(options.hermitHome)}</string>
\t\t<key>PATH</key>
\t\t<string>${xmlEscape(safePath)}</string>
\t</dict>
\t<key>RunAtLoad</key>
\t<true/>
\t<key>KeepAlive</key>
\t<dict>
\t\t<key>SuccessfulExit</key>
\t\t<false/>
\t</dict>
\t<key>ThrottleInterval</key>
\t<integer>30</integer>
\t<key>StandardOutPath</key>
\t<string>${xmlEscape(paths.logPath)}</string>
\t<key>StandardErrorPath</key>
\t<string>${xmlEscape(paths.errorLogPath)}</string>
\t<key>WorkingDirectory</key>
\t<string>${xmlEscape(path.dirname(options.cliPath))}</string>
</dict>
</plist>
`;
}

function normalizeOptions(
  options: UsageTelemetryAutostartOptions = {}
): Required<UsageTelemetryAutostartOptions> {
  return {
    hermitHome: options.hermitHome ?? resolveHermitHome(),
    nodePath: options.nodePath ?? process.execPath,
    cliPath: options.cliPath ?? path.resolve(process.cwd(), 'bin/hermit.mjs'),
    label: options.label ?? USAGE_TELEMETRY_LAUNCHD_LABEL,
  };
}

async function launchctl(args: string[]): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('launchctl', args, { timeout: 10_000 });
    return { ok: true, output: `${stdout}${stderr}` };
  } catch (err) {
    const error = err as Error & { stdout?: string; stderr?: string };
    return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}${error.message}` };
  }
}

export async function getUsageTelemetryAutostartStatus(
  options: UsageTelemetryAutostartOptions = {}
): Promise<UsageTelemetryAutostartStatus> {
  const normalized = normalizeOptions(options);
  const plistPath = getUsageTelemetryLaunchdPlistPath(normalized.label);
  if (process.platform !== 'darwin') {
    return {
      supported: false,
      platform: process.platform,
      enabled: false,
      loaded: false,
      label: normalized.label,
      plistPath,
      message: 'usage telemetry autostart is currently implemented for macOS launchd only',
    };
  }
  const print = await launchctl(['print', `gui/${process.getuid?.() ?? ''}/${normalized.label}`]);
  return {
    supported: true,
    platform: process.platform,
    enabled: existsSync(plistPath),
    loaded: print.ok,
    label: normalized.label,
    plistPath,
    ...(print.ok ? {} : { message: print.output }),
  };
}

export async function enableUsageTelemetryAutostart(
  options: UsageTelemetryAutostartOptions = {}
): Promise<UsageTelemetryAutostartStatus> {
  const normalized = normalizeOptions(options);
  const plistPath = getUsageTelemetryLaunchdPlistPath(normalized.label);
  if (process.platform !== 'darwin') return getUsageTelemetryAutostartStatus(normalized);
  const paths = getUsageTelemetryWorkerPaths(normalized.hermitHome);
  await mkdir(path.dirname(plistPath), { recursive: true });
  await mkdir(path.dirname(paths.logPath), { recursive: true, mode: 0o700 });
  await writeFile(plistPath, buildUsageTelemetryLaunchdPlist(normalized), 'utf-8');
  const uid = process.getuid?.();
  if (uid !== undefined && process.env.OPENHERMIT_SKIP_LAUNCHCTL !== '1') {
    await launchctl(['bootout', `gui/${uid}`, plistPath]);
    await launchctl(['bootstrap', `gui/${uid}`, plistPath]);
    await launchctl(['enable', `gui/${uid}/${normalized.label}`]);
    await launchctl(['kickstart', '-k', `gui/${uid}/${normalized.label}`]);
  }
  return getUsageTelemetryAutostartStatus(normalized);
}

export async function disableUsageTelemetryAutostart(
  options: UsageTelemetryAutostartOptions = {}
): Promise<UsageTelemetryAutostartStatus> {
  const normalized = normalizeOptions(options);
  const plistPath = getUsageTelemetryLaunchdPlistPath(normalized.label);
  if (process.platform === 'darwin' && process.env.OPENHERMIT_SKIP_LAUNCHCTL !== '1') {
    const uid = process.getuid?.();
    if (uid !== undefined) await launchctl(['bootout', `gui/${uid}`, plistPath]);
  }
  await rm(plistPath, { force: true });
  return getUsageTelemetryAutostartStatus(normalized);
}

export async function readUsageTelemetryLaunchdPlist(
  options: UsageTelemetryAutostartOptions = {}
): Promise<string | null> {
  const normalized = normalizeOptions(options);
  const plistPath = getUsageTelemetryLaunchdPlistPath(normalized.label);
  try {
    return await readFile(plistPath, 'utf-8');
  } catch {
    return null;
  }
}
