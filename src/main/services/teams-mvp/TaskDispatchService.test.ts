import { describe, expect, it, vi } from 'vitest';

import { TaskDispatchService } from './TaskDispatchService';

import type { CollabTask, CollabTaskStatus, DispatchMeta } from '@shared/types/team';
import type { Task, TaskStatus, TeamManifest, TeamWorkspaceService } from './TeamWorkspaceService';
import type { CollaborationBoardService } from './CollaborationBoardService';

class FakeCollabBoard {
  tasks = new Map<string, CollabTask>();

  addTask(task: CollabTask): CollabTask {
    if (this.tasks.has(task.dispatchId)) return this.tasks.get(task.dispatchId)!;
    this.tasks.set(task.dispatchId, { ...task, version: task.version ?? 1 });
    return this.tasks.get(task.dispatchId)!;
  }

  getTask(dispatchId: string): CollabTask | undefined {
    return this.tasks.get(dispatchId);
  }

  transition(input: {
    dispatchId: string;
    expected: CollabTaskStatus | CollabTaskStatus[];
    next: CollabTaskStatus;
    extra?: Partial<CollabTask>;
  }): CollabTask {
    const task = this.tasks.get(input.dispatchId);
    if (!task) throw new Error(`missing task: ${input.dispatchId}`);
    const expected = Array.isArray(input.expected) ? input.expected : [input.expected];
    if (!expected.includes(task.status)) {
      throw new Error(`bad transition: ${task.status} -> ${input.next}`);
    }
    const next = {
      ...task,
      ...input.extra,
      status: input.next,
      version: (task.version ?? 1) + 1,
      updatedAt: new Date().toISOString(),
    };
    this.tasks.set(input.dispatchId, next);
    return next;
  }

  getBoard(): CollabTask[] {
    return Array.from(this.tasks.values());
  }

  getEvents(): [] {
    return [];
  }

  setRedis(): void {
    // no-op
  }
}

class FakeWorkspace {
  manifests = new Map<string, TeamManifest>();
  tasks = new Map<string, Task[]>();
  messages: { teamSlug: string; content: string }[] = [];
  nextTaskId = 1;

  constructor(teamSlugs: string[]) {
    for (const slug of teamSlugs) {
      this.manifests.set(slug, {
        schemaVersion: 2,
        slug,
        displayName: slug,
        bindProject: slug,
        harness: 'claudecode',
        workDir: `/tmp/${slug}`,
        collaboration: true,
        rootPath: `/tmp/${slug}`,
        createdAt: '2026-06-11T00:00:00.000Z',
      });
      this.tasks.set(slug, []);
    }
  }

  async listTeams(): Promise<TeamManifest[]> {
    return Array.from(this.manifests.values());
  }

  async readTeamManifest(teamSlug: string): Promise<TeamManifest> {
    const manifest = this.manifests.get(teamSlug);
    if (!manifest) throw new Error(`missing team: ${teamSlug}`);
    return manifest;
  }

  async readTasks(teamSlug: string): Promise<Task[]> {
    return this.tasks.get(teamSlug) ?? [];
  }

  async createTask(
    teamSlug: string,
    payload: {
      title: string;
      description?: string;
      assignee?: string | null;
      status?: TaskStatus;
      dispatchMeta?: DispatchMeta;
    }
  ): Promise<Task> {
    const now = new Date().toISOString();
    const task: Task = {
      id: `task-${this.nextTaskId++}`,
      teamSlug,
      title: payload.title,
      description: payload.description ?? '',
      status: payload.status ?? 'todo',
      assignee: payload.assignee ?? null,
      result: null,
      createdAt: now,
      updatedAt: now,
      order: this.tasks.get(teamSlug)?.length ?? 0,
      dispatchMeta: payload.dispatchMeta,
    };
    this.tasks.set(teamSlug, [...(this.tasks.get(teamSlug) ?? []), task]);
    return task;
  }

  async patchTask(teamSlug: string, taskId: string, patch: Partial<Task>): Promise<Task> {
    const tasks = this.tasks.get(teamSlug) ?? [];
    const index = tasks.findIndex((task) => task.id === taskId);
    if (index < 0) throw new Error(`missing task: ${taskId}`);
    const next = { ...tasks[index], ...patch, id: taskId, teamSlug } as Task;
    tasks[index] = next;
    return next;
  }

  async appendMessage(teamSlug: string, msg: { content: string }): Promise<unknown> {
    this.messages.push({ teamSlug, content: msg.content });
    return { id: `msg-${this.messages.length}` };
  }
}

function createService() {
  const workspace = new FakeWorkspace(['origin', 'target']);
  const collabBoard = new FakeCollabBoard();
  const service = new TaskDispatchService(
    workspace as unknown as TeamWorkspaceService,
    collabBoard as unknown as CollaborationBoardService
  );
  return { service, workspace, collabBoard };
}

describe('TaskDispatchService local dispatch start gate', () => {
  it('queues a local cross-team dispatch in TODO without starting runtime execution', async () => {
    const { service, workspace, collabBoard } = createService();
    const onRuntimeStart = vi.fn();
    service.onRuntimeStart = onRuntimeStart;

    const result = await service.dispatchTask(
      'origin',
      { subject: 'Fix external order state', description: 'Do not auto-start.' },
      'target',
      { dispatchId: 'dispatch-1' }
    );

    expect(result.status).toBe('received');
    expect(result.message).toContain('waiting for manual start');
    expect(onRuntimeStart).not.toHaveBeenCalled();

    const targetTasks = await workspace.readTasks('target');
    expect(targetTasks).toHaveLength(1);
    expect(targetTasks[0]).toMatchObject({
      status: 'todo',
      dispatchMeta: {
        dispatchId: 'dispatch-1',
        originTeam: 'origin',
        targetTeam: 'target',
        status: 'received',
      },
    });
    expect(collabBoard.getTask('dispatch-1')?.status).toBe('received');
  });

  it('only moves a received dispatch to doing/in_progress when Start is called', async () => {
    const { service, workspace, collabBoard } = createService();
    const onRuntimeStart = vi.fn().mockResolvedValue(undefined);
    service.onRuntimeStart = onRuntimeStart;

    await service.dispatchTask('origin', { subject: 'Start me manually' }, 'target', {
      dispatchId: 'dispatch-2',
    });
    const queued = (await workspace.readTasks('target'))[0];

    await service.startDispatchedTask('target', queued.id);

    const [started] = await workspace.readTasks('target');
    expect(started.status).toBe('doing');
    expect(started.dispatchMeta).toMatchObject({
      dispatchId: 'dispatch-2',
      status: 'in_progress',
      remoteTaskId: queued.id,
    });
    expect(collabBoard.getTask('dispatch-2')?.status).toBe('in_progress');
    expect(onRuntimeStart).toHaveBeenCalledTimes(1);
    expect(onRuntimeStart).toHaveBeenCalledWith(
      expect.objectContaining({ teamName: 'target', text: expect.stringContaining('请开始执行') })
    );
  });

  it('keeps legacy accept_task as receipt acknowledgement instead of execution start', async () => {
    const { service, workspace, collabBoard } = createService();
    const onRuntimeStart = vi.fn();
    service.onRuntimeStart = onRuntimeStart;

    await service.dispatchTask('origin', { subject: 'Legacy accept should not start' }, 'target', {
      dispatchId: 'dispatch-3',
    });

    const result = await service.acceptTask('target', 'dispatch-3');

    const [task] = await workspace.readTasks('target');
    expect(result.taskId).toBe(task.id);
    expect(task.status).toBe('todo');
    expect(task.dispatchMeta).toMatchObject({
      dispatchId: 'dispatch-3',
      status: 'received',
      remoteTaskId: task.id,
    });
    expect(collabBoard.getTask('dispatch-3')?.status).toBe('received');
    expect(onRuntimeStart).not.toHaveBeenCalled();
  });
});
