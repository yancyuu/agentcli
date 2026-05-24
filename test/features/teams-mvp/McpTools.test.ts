/**
 * Tests: MCP Server tools (executeMcpTool logic via TeamWorkspaceService)
 *
 * MCP 工具的逻辑直接依赖 svc.readTasks / patchTask / createTask，
 * 这里通过 in-process 调用来测试 MCP 工具语义，不需要起 HTTP server。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { TeamProvisioningService } from '@main/services/teams-mvp/TeamProvisioningService';
import { TeamWorkspaceService } from '@main/services/teams-mvp/TeamWorkspaceService';

// ---------------------------------------------------------------------------
// 内联 executeMcpTool 逻辑（复制自 server.ts 的同名函数，以便独立测试）
// ---------------------------------------------------------------------------

function makeMcpExecutor(svc: TeamProvisioningService) {
  return async function executeMcpTool(
    toolName: string,
    args: Record<string, string>
  ): Promise<{ type: string; text: string }[]> {
    const text = (result: unknown) => [{ type: 'text', text: JSON.stringify(result, null, 2) }];

    if (toolName === 'list_tasks') {
      return text(await svc.readTasks(args.team_slug));
    }
    if (toolName === 'claim_task') {
      return text(await svc.patchTask(args.team_slug, args.task_id, { status: 'doing' }));
    }
    if (toolName === 'complete_task') {
      const patch: Record<string, unknown> = { status: 'done' };
      if (args.result) patch.result = args.result;
      return text(await svc.patchTask(args.team_slug, args.task_id, patch));
    }
    if (toolName === 'create_task') {
      const task = await svc.createTask(args.team_slug, {
        title: args.title,
        description: args.description,
        assignee: args.assignee ?? null,
      });
      return text(task);
    }
    throw new Error(`Unknown tool: ${toolName}`);
  };
}

// ---------------------------------------------------------------------------

let tmpDir: string;
let workspace: TeamWorkspaceService;
let svc: TeamProvisioningService;
let exec: ReturnType<typeof makeMcpExecutor>;
let teamSlug: string;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-mcp-test-'));
  process.env.HERMIT_HOME = tmpDir;
  workspace = new TeamWorkspaceService();
  svc = new TeamProvisioningService(
    { createProject: vi.fn(), restart: vi.fn() } as never,
    { sendUserMessage: vi.fn() } as never,
    workspace
  );
  exec = makeMcpExecutor(svc);

  const { slug } = await svc.createTeam({
    displayName: 'mcp-test',
    bindProject: 'mcp-cc',
    harness: 'claudecode',
    workDir: path.join(tmpDir, 'work'),
    createCcProject: false,
  });
  teamSlug = slug;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.HERMIT_HOME;
});

// ---------------------------------------------------------------------------
describe('MCP tool: list_tasks', () => {
  it('returns empty array when no tasks', async () => {
    const [result] = await exec('list_tasks', { team_slug: teamSlug });
    const tasks = JSON.parse(result.text);
    expect(tasks).toEqual([]);
  });

  it('returns tasks after creation', async () => {
    await svc.createTask(teamSlug, { title: 'task-a' });
    await svc.createTask(teamSlug, { title: 'task-b' });
    const [result] = await exec('list_tasks', { team_slug: teamSlug });
    const tasks = JSON.parse(result.text);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].title).toBe('task-a');
  });
});

// ---------------------------------------------------------------------------
describe('MCP tool: claim_task', () => {
  it('sets status to doing', async () => {
    const task = await svc.createTask(teamSlug, { title: 'claimable' });
    const [result] = await exec('claim_task', { team_slug: teamSlug, task_id: task.id });
    const claimed = JSON.parse(result.text);
    expect(claimed.status).toBe('doing');
    expect(claimed.id).toBe(task.id);
  });

  it('throws for non-existent task id', async () => {
    await expect(exec('claim_task', { team_slug: teamSlug, task_id: 'bad-id' })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
describe('MCP tool: complete_task', () => {
  it('sets status to done', async () => {
    const task = await svc.createTask(teamSlug, { title: 'completable' });
    const [result] = await exec('complete_task', { team_slug: teamSlug, task_id: task.id });
    const done = JSON.parse(result.text);
    expect(done.status).toBe('done');
    expect(done.result).toBeNull();
  });

  it('stores result string', async () => {
    const task = await svc.createTask(teamSlug, { title: 'with result' });
    const [result] = await exec('complete_task', {
      team_slug: teamSlug,
      task_id: task.id,
      result: 'PR #99 merged',
    });
    const done = JSON.parse(result.text);
    expect(done.result).toBe('PR #99 merged');
    expect(done.status).toBe('done');
  });
});

// ---------------------------------------------------------------------------
describe('MCP tool: create_task', () => {
  it('creates task with title only', async () => {
    const [result] = await exec('create_task', { team_slug: teamSlug, title: 'new task' });
    const task = JSON.parse(result.text);
    expect(task.id).toMatch(/^t_/);
    expect(task.title).toBe('new task');
    expect(task.status).toBe('todo');
  });

  it('creates task with description and assignee', async () => {
    // Create target team first so assignee is valid slug
    await svc.createTeam({
      displayName: 'backend',
      bindProject: 'backend-cc',
      harness: 'codex',
      workDir: path.join(tmpDir, 'backend'),
      createCcProject: false,
    });

    const [result] = await exec('create_task', {
      team_slug: teamSlug,
      title: 'backend work',
      description: '需要后端处理',
      assignee: 'backend',
    });
    const task = JSON.parse(result.text);
    expect(task.assignee).toBe('backend');
    expect(task.description).toBe('需要后端处理');
  });
});

// ---------------------------------------------------------------------------
describe('MCP tool: unknown tool', () => {
  it('throws for unknown tool name', async () => {
    await expect(exec('do_magic', { team_slug: teamSlug })).rejects.toThrow('Unknown tool: do_magic');
  });
});
