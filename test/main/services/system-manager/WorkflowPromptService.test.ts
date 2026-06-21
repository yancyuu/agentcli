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
    });
  });

  it('lists workspace root Claude command folders using native slash command names', async () => {
    const commandsDir = path.join(tmpDir, '.claude', 'commands');
    fs.mkdirSync(path.join(commandsDir, 'ops'), { recursive: true });
    fs.writeFileSync(path.join(commandsDir, 'nightly-triage.md'), '# Triage\n', 'utf8');
    fs.writeFileSync(path.join(commandsDir, 'ops', 'summary.md'), '# Summary\n', 'utf8');

    const result = await new WorkflowPromptService().list(commandsDir);

    expect(result.prompts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filename: 'nightly-triage.md',
          source: 'claude-command',
          commandName: '/nightly-triage',
        }),
        expect.objectContaining({
          filename: path.join('ops', 'summary.md'),
          source: 'claude-command',
          commandName: '/ops:summary',
        }),
      ])
    );
  });

  it('rejects legacy workflow folders so command boards only use native Claude commands', async () => {
    const workflowsDir = path.join(tmpDir, 'workflows');
    fs.mkdirSync(workflowsDir, { recursive: true });
    fs.writeFileSync(path.join(workflowsDir, 'nightly-triage.md'), '# Triage\n', 'utf8');

    await expect(new WorkflowPromptService().list(workflowsDir)).rejects.toThrow(/\.claude\/commands/);
  });
});
