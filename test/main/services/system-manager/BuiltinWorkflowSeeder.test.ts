import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getGlobalHermitWorkflowDir,
  seedGlobalHermitWorkflows,
} from '@main/services/system-manager/BuiltinWorkflowSeeder';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-builtin-workflows-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('BuiltinWorkflowSeeder', () => {
  it('seeds built-in workflows into the global Hermit command namespace', async () => {
    const copied = await seedGlobalHermitWorkflows(tmpDir);
    const hermitWorkflowDir = getGlobalHermitWorkflowDir(tmpDir);

    expect(copied).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(hermitWorkflowDir, 'daily-workflow-extraction.md'))).toBe(true);
    expect(fs.readFileSync(path.join(hermitWorkflowDir, 'daily-workflow-extraction.md'), 'utf8')).toContain(
      'hermit-builtin-workflow:v2-loop'
    );
  });

  it('seeds the create-team workflow that provisions a team via the HTTP API', async () => {
    const copied = await seedGlobalHermitWorkflows(tmpDir);
    const hermitWorkflowDir = getGlobalHermitWorkflowDir(tmpDir);
    const target = path.join(hermitWorkflowDir, 'create-team.md');

    expect(copied).toBeGreaterThan(0);
    expect(fs.existsSync(target)).toBe(true);
    const content = fs.readFileSync(target, 'utf8');
    expect(content).toContain('hermit-builtin-workflow:v2-loop');
    // Points at the local Hermit server with an env override.
    expect(content).toContain('/api/teams/create');
    expect(content).toContain('${HERMIT_API_URL:-http://127.0.0.1:5680}');
    // bindProject slug rule is surfaced for the admin agent.
    expect(content).toContain('^[a-z0-9][a-z0-9_-]*$');
    // Provision-only safety boundary: must not auto-start agents.
    expect(content).toMatch(/不自动启动|不要.*启动.*agent/);
  });

  it('refreshes managed command files when bundled content changes', async () => {
    const hermitWorkflowDir = getGlobalHermitWorkflowDir(tmpDir);
    fs.mkdirSync(hermitWorkflowDir, { recursive: true });
    fs.writeFileSync(
      path.join(hermitWorkflowDir, 'doctor.md'),
      '<!-- hermit-builtin-workflow:v2-loop -->\n# Stale Doctor\n',
      'utf8'
    );

    await seedGlobalHermitWorkflows(tmpDir);

    const content = fs.readFileSync(path.join(hermitWorkflowDir, 'doctor.md'), 'utf8');
    expect(content).toContain('# Loop Runtime Doctor');
    expect(content).not.toContain('# Stale Doctor');
  });

  it('does not overwrite user-edited command files', async () => {
    const hermitWorkflowDir = getGlobalHermitWorkflowDir(tmpDir);
    fs.mkdirSync(hermitWorkflowDir, { recursive: true });
    fs.writeFileSync(path.join(hermitWorkflowDir, 'doctor.md'), '# Custom Doctor\n', 'utf8');

    await seedGlobalHermitWorkflows(tmpDir);

    expect(fs.readFileSync(path.join(hermitWorkflowDir, 'doctor.md'), 'utf8')).toBe('# Custom Doctor\n');
  });
});
