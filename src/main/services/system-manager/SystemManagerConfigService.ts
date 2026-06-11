import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type {
  SystemManagerConfig,
  SystemManagerConfigPatch,
  SystemManagerStatus,
} from '@shared/types/systemManager';

const CONFIG_FILE = 'system-manager.json';

function hermitHome(): string {
  return process.env.HERMIT_HOME || path.join(os.homedir(), '.hermit');
}

function expandHome(input: string): string {
  const normalized = input.trim().replace(/^～/, '~');
  if (normalized === '~') return os.homedir();
  if (normalized.startsWith('~/')) return path.join(os.homedir(), normalized.slice(2));
  return normalized;
}

async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    return (await stat(dirPath)).isDirectory();
  } catch {
    return false;
  }
}

async function commandExists(command: string): Promise<boolean> {
  const paths = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of paths) {
    try {
      await access(path.join(dir, command));
      return true;
    } catch {
      // keep looking
    }
  }
  return false;
}

export class SystemManagerConfigService {
  private readonly configPath = path.join(hermitHome(), CONFIG_FILE);

  constructor(private readonly defaultWorkDir: string) {}

  async getConfig(): Promise<SystemManagerConfig> {
    try {
      const raw = await readFile(this.configPath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<SystemManagerConfig>;
      const selectedWorkDir = await this.normalizeDirectory(
        parsed.selectedWorkDir || this.defaultWorkDir,
        'selectedWorkDir'
      );
      const workflowFolder = parsed.workflowFolder
        ? await this.normalizeDirectory(parsed.workflowFolder, 'workflowFolder')
        : undefined;
      return {
        schemaVersion: 1,
        selectedWorkDir,
        ...(workflowFolder ? { workflowFolder } : {}),
        updatedAt:
          typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      };
    } catch {
      return {
        schemaVersion: 1,
        selectedWorkDir: this.defaultWorkDir,
        updatedAt: new Date().toISOString(),
      };
    }
  }

  async updateConfig(patch: SystemManagerConfigPatch): Promise<SystemManagerConfig> {
    const current = await this.getConfig();
    const next: SystemManagerConfig = {
      ...current,
      updatedAt: new Date().toISOString(),
    };

    if (typeof patch.selectedWorkDir === 'string') {
      next.selectedWorkDir = await this.normalizeDirectory(
        patch.selectedWorkDir,
        'selectedWorkDir'
      );
    }
    if (patch.workflowFolder === null) {
      delete next.workflowFolder;
    } else if (typeof patch.workflowFolder === 'string') {
      next.workflowFolder = await this.normalizeDirectory(patch.workflowFolder, 'workflowFolder');
    }

    await mkdir(path.dirname(this.configPath), { recursive: true });
    await writeFile(this.configPath, JSON.stringify(next, null, 2), 'utf-8');
    return next;
  }

  async getStatus(): Promise<SystemManagerStatus> {
    const config = await this.getConfig();
    const hasClaude = await commandExists('claude');
    return {
      displayName: 'Admin Loop',
      defaultWorkDir: this.defaultWorkDir,
      selectedWorkDir: config.selectedWorkDir,
      ...(config.workflowFolder ? { workflowFolder: config.workflowFolder } : {}),
      claudeCommand: 'claude',
      localStatus: hasClaude ? 'ready' : 'missing-claude',
      ...(hasClaude ? {} : { error: '未在 PATH 中找到 claude 命令' }),
    };
  }

  private async normalizeDirectory(input: string, fieldName: string): Promise<string> {
    const resolved = path.resolve(expandHome(input));
    if (!(await isDirectory(resolved))) {
      throw new Error(`${fieldName} 不是有效目录: ${resolved}`);
    }
    return resolved;
  }
}
