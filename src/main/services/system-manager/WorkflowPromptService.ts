import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type {
  WorkflowPromptContentResponse,
  WorkflowPromptListResponse,
  WorkflowPromptSummary,
} from '@shared/types/systemManager';

const SUPPORTED_EXTENSIONS = new Set(['.md', '.txt', '.prompt', '.workflow']);
const MAX_PROMPT_BYTES = 256 * 1024;

function expandHome(input: string): string {
  const normalized = input.trim().replace(/^～/, '~');
  if (normalized === '~') return os.homedir();
  if (normalized.startsWith('~/')) return path.join(os.homedir(), normalized.slice(2));
  return normalized;
}

function promptId(filePath: string): string {
  return createHash('sha256').update(filePath).digest('hex').slice(0, 16);
}

function labelFromFilename(filename: string): string {
  return path.basename(filename, path.extname(filename)).replace(/[-_]+/g, ' ').trim() || filename;
}

function getClaudeCommandRoot(folder: string): string | null {
  const normalized = path.normalize(folder);
  const commandsSuffix = path.join('.claude', 'commands');
  if (normalized.endsWith(commandsSuffix)) return normalized;
  const parent = path.dirname(normalized);
  return parent.endsWith(commandsSuffix) ? parent : null;
}

function commandNameFromRelativePath(relativePath: string): `/${string}` {
  const withoutExt = relativePath.slice(0, -path.extname(relativePath).length);
  const commandName = withoutExt.split(path.sep).filter(Boolean).join(':');
  return `/${commandName}`;
}

export class WorkflowPromptService {
  async list(folderInput: string): Promise<WorkflowPromptListResponse> {
    const folder = path.resolve(expandHome(folderInput));
    const folderStat = await stat(folder);
    if (!folderStat.isDirectory()) {
      throw new Error(`Loop command folder 不是有效目录: ${folder}`);
    }

    const warnings: string[] = [];
    const prompts: WorkflowPromptSummary[] = [];
    const commandRoot = getClaudeCommandRoot(folder);
    if (!commandRoot) {
      throw new Error(`Claude command folder 必须位于 .claude/commands 下: ${folder}`);
    }
    const pendingDirs = [folder];

    for (const currentDir of pendingDirs) {
      const entries = await readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const filePath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          pendingDirs.push(filePath);
          continue;
        }
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
        const fileStat = await stat(filePath);
        if (fileStat.size > MAX_PROMPT_BYTES) {
          warnings.push(`${path.relative(folder, filePath)} 超过 256 KiB，已跳过`);
          continue;
        }

        const relativeCommandPath = path.relative(commandRoot, filePath);
        const commandName = commandNameFromRelativePath(relativeCommandPath);
        const summary: WorkflowPromptSummary = {
          id: promptId(filePath),
          label: labelFromFilename(entry.name),
          filename: path.relative(folder, filePath),
          path: filePath,
          folder,
          sizeBytes: fileStat.size,
          updatedAt: fileStat.mtime.toISOString(),
          source: 'claude-command',
          commandName,
          safety: 'unknown',
        };
        prompts.push(summary);
      }
    }

    prompts.sort((a, b) => {
      const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return a.filename.localeCompare(b.filename);
    });
    return { folder, prompts, warnings };
  }

  async read(folderInput: string, id: string): Promise<WorkflowPromptContentResponse> {
    const list = await this.list(folderInput);
    const prompt = list.prompts.find((item) => item.id === id || item.filename === id);
    if (!prompt) {
      throw new Error(`未找到 Loop workflow: ${id}`);
    }
    const content = await readFile(prompt.path, 'utf-8');
    return { prompt, content };
  }
}
