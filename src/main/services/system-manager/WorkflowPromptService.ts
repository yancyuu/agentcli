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

export class WorkflowPromptService {
  async list(folderInput: string): Promise<WorkflowPromptListResponse> {
    const folder = path.resolve(expandHome(folderInput));
    const folderStat = await stat(folder);
    if (!folderStat.isDirectory()) {
      throw new Error(`workflow folder 不是有效目录: ${folder}`);
    }

    const warnings: string[] = [];
    const prompts: WorkflowPromptSummary[] = [];
    const entries = await readdir(folder, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
      const filePath = path.join(folder, entry.name);
      const fileStat = await stat(filePath);
      if (fileStat.size > MAX_PROMPT_BYTES) {
        warnings.push(`${entry.name} 超过 256 KiB，已跳过`);
        continue;
      }
      prompts.push({
        id: promptId(filePath),
        label: labelFromFilename(entry.name),
        filename: entry.name,
        path: filePath,
        sizeBytes: fileStat.size,
        updatedAt: fileStat.mtime.toISOString(),
      });
    }

    prompts.sort((a, b) => a.filename.localeCompare(b.filename));
    return { folder, prompts, warnings };
  }

  async read(folderInput: string, id: string): Promise<WorkflowPromptContentResponse> {
    const list = await this.list(folderInput);
    const prompt = list.prompts.find((item) => item.id === id || item.filename === id);
    if (!prompt) {
      throw new Error(`未找到 workflow: ${id}`);
    }
    const content = await readFile(prompt.path, 'utf-8');
    return { prompt, content };
  }
}
