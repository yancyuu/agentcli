import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WorkflowPromptService } from '@main/services/system-manager/WorkflowPromptService';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-workflow-prompts-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('WorkflowPromptService', () => {
  it('lists nested Claude command folders as namespaced slash commands', async () => {
    const hermitDir = path.join(tmpDir, '.claude', 'commands', 'hermit');
    fs.mkdirSync(hermitDir, { recursive: true });
    fs.writeFileSync(path.join(hermitDir, 'daily-workflow-extraction.md'), '# Daily Workflow Extraction\n', 'utf8');

    const result = await new WorkflowPromptService().list(hermitDir);

    expect(result.prompts).toHaveLength(1);
    expect(result.prompts[0]).toMatchObject({
      filename: 'daily-workflow-extraction.md',
      source: 'claude-command',
      commandName: '/hermit:daily-workflow-extraction',
      builtin: true,
      label: 'Daily Workflow Extraction',
      safety: 'read-only',
    });
  });

  it('keeps plain workflow folders as non-command prompt folders', async () => {
    const workflowsDir = path.join(tmpDir, 'workflows');
    fs.mkdirSync(workflowsDir, { recursive: true });
    fs.writeFileSync(path.join(workflowsDir, 'nightly-triage.md'), '# Triage\n', 'utf8');

    const result = await new WorkflowPromptService().list(workflowsDir);

    expect(result.prompts[0]).toMatchObject({
      filename: 'nightly-triage.md',
      source: 'workflow-folder',
      commandName: undefined,
    });
    expect(result.prompts[0]).not.toHaveProperty('builtin');
  });
});
