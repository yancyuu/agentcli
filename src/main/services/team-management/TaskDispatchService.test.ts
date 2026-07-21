import { afterEach, describe, expect, it, vi } from 'vitest';

import { TaskDispatchService } from './TaskDispatchService';

import type { CollaborationBoardService } from './CollaborationBoardService';
import type { Task, TaskStatus, TeamManifest, TeamWorkspaceService } from './TeamWorkspaceService';
import type { CollabTask, CollabTaskStatus, DispatchMeta } from '@shared/types/team';

// connectRedis() does a dynamic `import('ioredis')`; stub it so the getter can
// be exercised without a real server. A mutable flag lets a test simulate a
// connection failure.
const redisMockState = vi.hoisted(() => ({ connectShouldFail: false }));
// Records every ioredis command issued after connect so a test can assert which
// Redis keys the team bus actually touched — e.g. that NO task:* keys are
// written when collaboration is disabled. Hoisted so the mock factory can close
// over it; cleared between tests in the collaboration-gate suite.
const redisCommands = vi.hoisted(() => [] as { cmd: string; key?: string }[]);

vi.mock('ioredis', () => {
  const createInstance = () => {
    const instance: Record<string, (...args: unknown[]) => unknown> = {
      on: () => undefined,
      connect: async () => {
        if (redisMockState.connectShouldFail) throw new Error('redis unreachable');
      },
      ping: async () => 'PONG',
      disconnect: () => undefined,
    };
    // Any other ioredis command (zadd/hset/xreadgroup/…) resolves harmlessly so
    // the post-connect heartbeat/consumer setup can run without throwing, and is
    // recorded so a test can verify exactly which keys the bus touched.
    return new Proxy(instance, {
      get(target, prop) {
        if (typeof prop === 'string' && prop in target) return target[prop];
        return async (...args: unknown[]) => {
          redisCommands.push({
            cmd: String(prop),
            key: typeof args[0] === 'string' ? args[0] : undefined,
          });
          return undefined;
        };
      },
    });
  };
  return {
    default: function MockRedis() {
      return createInstance();
    },
  };
});

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
  messages: { teamSlug: string; content: string; meta?: Record<string, unknown> }[] = [];
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

  async appendMessage(
    teamSlug: string,
    msg: { content: string; meta?: Record<string, unknown> }
  ): Promise<unknown> {
    this.messages.push({ teamSlug, content: msg.content, meta: msg.meta });
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
    expect(workspace.messages).toHaveLength(0);
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
    expect(workspace.messages).toHaveLength(0);
    expect(onRuntimeStart).not.toHaveBeenCalled();
  });

  it('rolls a cross-team task back to TODO when runtime start fails', async () => {
    const { service, workspace, collabBoard } = createService();
    service.onRuntimeStart = vi.fn().mockRejectedValue(new Error('runtime offline'));

    await service.dispatchTask('origin', { subject: 'Rollback failed start' }, 'target', {
      dispatchId: 'dispatch-4',
    });
    const [queued] = await workspace.readTasks('target');

    await expect(service.startDispatchedTask('target', queued.id)).rejects.toThrow(
      'runtime offline'
    );

    const [rolledBack] = await workspace.readTasks('target');
    expect(rolledBack.status).toBe('todo');
    expect(rolledBack.dispatchMeta).toMatchObject({
      dispatchId: 'dispatch-4',
      status: 'received',
    });
    expect(rolledBack.dispatchMeta).not.toHaveProperty('remoteTaskId');
    expect(collabBoard.getTask('dispatch-4')?.status).toBe('received');
    expect(service.onRuntimeStart).toHaveBeenCalledTimes(1);
    expect(workspace.messages).toHaveLength(0);
  });

  it('rejects a second start after a task has already moved to doing', async () => {
    const { service, workspace } = createService();
    const onRuntimeStart = vi.fn().mockResolvedValue(undefined);
    service.onRuntimeStart = onRuntimeStart;

    await service.dispatchTask('origin', { subject: 'Start once' }, 'target', {
      dispatchId: 'dispatch-5',
    });
    const [queued] = await workspace.readTasks('target');

    await service.startDispatchedTask('target', queued.id);
    await expect(service.startDispatchedTask('target', queued.id)).rejects.toThrow(
      'cross-team task has already been started or completed'
    );
    expect(onRuntimeStart).toHaveBeenCalledTimes(1);
  });

  it('rejects delivery before the target agent marks the local task done', async () => {
    const { service, workspace, collabBoard } = createService();
    service.onRuntimeStart = vi.fn().mockResolvedValue(undefined);

    await service.dispatchTask('origin', { subject: 'Cannot deliver early' }, 'target', {
      dispatchId: 'dispatch-4',
    });
    const [queued] = await workspace.readTasks('target');
    await service.startDispatchedTask('target', queued.id);
    const messageCountBeforeDelivery = workspace.messages.length;

    await expect(service.deliverTask('target', 'dispatch-4', 'premature result')).rejects.toThrow(
      'Task result cannot be delivered before the agent marks the task done.'
    );
    expect(collabBoard.getTask('dispatch-4')?.status).toBe('in_progress');
    expect(workspace.messages).toHaveLength(messageCountBeforeDelivery);
  });

  it('delivers only after the target agent marks the local task done', async () => {
    const { service, workspace, collabBoard } = createService();
    service.onRuntimeStart = vi.fn().mockResolvedValue(undefined);

    await service.dispatchTask('origin', { subject: 'Deliver after done' }, 'target', {
      dispatchId: 'dispatch-5',
      needsHumanReview: true,
    });
    const [queued] = await workspace.readTasks('target');
    await service.startDispatchedTask('target', queued.id);
    await workspace.patchTask('target', queued.id, { status: 'done', result: 'finished' });
    await service.onTaskCompleted('target', queued.id);

    expect(collabBoard.getTask('dispatch-5')?.status).toBe('in_progress');
    const originMessageCountBeforeDelivery = workspace.messages.filter(
      (message) => message.teamSlug === 'origin'
    ).length;

    await expect(service.deliverTask('target', 'dispatch-5', 'finished')).resolves.toEqual({
      ok: true,
    });
    expect(collabBoard.getTask('dispatch-5')?.status).toBe('delivered');
    const originMessagesAfterDelivery = workspace.messages.filter(
      (message) => message.teamSlug === 'origin'
    );
    expect(originMessagesAfterDelivery).toHaveLength(originMessageCountBeforeDelivery + 1);
    expect(originMessagesAfterDelivery.at(-1)).toEqual(
      expect.objectContaining({
        teamSlug: 'origin',
        content: expect.stringContaining('[跨团队任务待审核]'),
      })
    );
  });

  it('keeps the local lifecycle finite and emits each review/approval notification once', async () => {
    const { service, workspace, collabBoard } = createService();
    service.onRuntimeStart = vi.fn().mockResolvedValue(undefined);

    await service.dispatchTask('origin', { subject: 'Notify exactly once' }, 'target', {
      dispatchId: 'dispatch-7',
      needsHumanReview: true,
    });
    const [queued] = await workspace.readTasks('target');
    await service.startDispatchedTask('target', queued.id);
    await workspace.patchTask('target', queued.id, { status: 'done', result: 'finished' });
    await service.onTaskCompleted('target', queued.id);
    await service.deliverTask('target', 'dispatch-7', 'finished');
    await service.approveTask('origin', 'dispatch-7');

    expect(collabBoard.getTask('dispatch-7')?.status).toBe('approved');
    expect(workspace.messages.map((message) => message.meta?.source)).toEqual([
      'cross_team_started',
      'cross_team_delivered',
      'cross_team_approved',
      'cross_team_approved_target',
    ]);
    expect(
      workspace.messages.filter((message) => message.meta?.source === 'cross_team_approved_target')
    ).toHaveLength(1);
    expect(workspace.messages.filter((message) => message.teamSlug === 'target')).toHaveLength(1);
  });

  it('auto-approves delivery when needsHumanReview is false (skips manual review)', async () => {
    const { service, workspace, collabBoard } = createService();
    service.onRuntimeStart = vi.fn().mockResolvedValue(undefined);

    await service.dispatchTask('origin', { subject: 'Auto approve me' }, 'target', {
      dispatchId: 'dispatch-auto',
      needsHumanReview: false,
    });
    const [queued] = await workspace.readTasks('target');
    await service.startDispatchedTask('target', queued.id);
    await workspace.patchTask('target', queued.id, { status: 'done', result: 'finished' });
    await service.onTaskCompleted('target', queued.id);

    await service.deliverTask('target', 'dispatch-auto', 'finished');

    // Deliver + auto-approve in one step; no manual approveTask call needed.
    expect(collabBoard.getTask('dispatch-auto')?.status).toBe('approved');
    const originMessages = workspace.messages.filter((m) => m.teamSlug === 'origin');
    expect(originMessages.at(-1)).toEqual(
      expect.objectContaining({
        content: expect.stringContaining('[跨团队任务已自动通过]'),
      })
    );
  });

  it('rejects re-delivery after approval before callback side effects', async () => {
    const { service, workspace, collabBoard } = createService();
    service.onRuntimeStart = vi.fn().mockResolvedValue(undefined);

    await service.dispatchTask('origin', { subject: 'Do not deliver twice' }, 'target', {
      dispatchId: 'dispatch-6',
      needsHumanReview: true,
    });
    const [queued] = await workspace.readTasks('target');
    await service.startDispatchedTask('target', queued.id);
    await workspace.patchTask('target', queued.id, { status: 'done', result: 'finished' });
    await service.deliverTask('target', 'dispatch-6', 'finished');
    await service.approveTask('origin', 'dispatch-6');
    const originMessageCountBeforeRedelivery = workspace.messages.filter(
      (message) => message.teamSlug === 'origin'
    ).length;

    await expect(service.deliverTask('target', 'dispatch-6', 'again')).rejects.toThrow(
      'Task result has already been approved and cannot be delivered again.'
    );
    expect(collabBoard.getTask('dispatch-6')?.status).toBe('approved');
    expect(workspace.messages.filter((message) => message.teamSlug === 'origin')).toHaveLength(
      originMessageCountBeforeRedelivery
    );
  });
});

describe('TaskDispatchService.isRedisConnected', () => {
  afterEach(() => {
    redisMockState.connectShouldFail = false;
  });

  it('is false on a fresh instance', () => {
    const { service } = createService();
    expect(service.isRedisConnected()).toBe(false);
    service.dispose();
  });

  it('reflects the live connection after a successful start and clears it on dispose', async () => {
    const { service } = createService();

    await service.start({ enabled: true, redis: { host: '127.0.0.1', port: 6379 } });
    expect(service.isRedisConnected()).toBe(true);

    // Let the fire-and-forget heartbeat setup (queued microtasks) finish before
    // tearing down — dispose() otherwise races an in-flight beat that would
    // dereference a nulled this.redis. All timer intervals here are ≥5s so they
    // never fire during the test; a single macrotask drains the microtask chain.
    await new Promise((resolve) => setTimeout(resolve, 0));
    service.dispose();
    expect(service.isRedisConnected()).toBe(false);
  });

  it('stays false when the Redis connection fails (start rejects, no false "connected")', async () => {
    redisMockState.connectShouldFail = true;
    const { service } = createService();

    await expect(
      service.start({ enabled: true, redis: { host: '127.0.0.1', port: 6379 } })
    ).rejects.toThrow('Redis connection failed');
    expect(service.isRedisConnected()).toBe(false);
    service.dispose();
  });
});

describe('TaskDispatchService collaboration gate (no team-bus writes when disabled)', () => {
  afterEach(() => {
    redisCommands.length = 0;
    redisMockState.connectShouldFail = false;
  });

  it('writes team discovery + dispatch/response streams when collaboration is enabled', async () => {
    const { service } = createService();

    await service.start({
      enabled: true,
      collaboration: true,
      redis: { host: '127.0.0.1', port: 6379 },
    });
    // Drain the fire-and-forget heartbeat's microtask chain (one macrotask is
    // enough — all awaits are microtasks queued before this fires).
    await new Promise((resolve) => setTimeout(resolve, 0));

    const keys = redisCommands.map((c) => c.key).filter(Boolean) as string[];
    expect(keys).toContain('task:teams');
    expect(keys.some((k) => k.startsWith('task:team:info:'))).toBe(true);
    // Consumers create the dispatch/response stream groups (xgroup ... MKSTREAM).
    expect(redisCommands.some((c) => c.cmd === 'xgroup')).toBe(true);

    service.dispose();
  });

  it('writes team-bus data by default when collaboration is left unspecified', async () => {
    const { service } = createService();

    await service.start({ enabled: true, redis: { host: '127.0.0.1', port: 6379 } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const keys = redisCommands.map((c) => c.key).filter(Boolean) as string[];
    expect(keys).toContain('task:teams');

    service.dispose();
  });

  it('does NOT write ANY task:* keys when collaboration is disabled, yet keeps the connection live for telemetry', async () => {
    const { service } = createService();

    await service.start({
      enabled: true,
      collaboration: false,
      redis: { host: '127.0.0.1', port: 6379 },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Connection survives so the telemetry status (wired to isRedisConnected)
    // still reads green — usage reporting shares the same Redis and is unaffected.
    expect(service.isRedisConnected()).toBe(true);

    // The whole point: no discovery, no dispatch/response streams, no status bus.
    const taskKeys = redisCommands
      .map((c) => c.key)
      .filter((k): k is string => typeof k === 'string' && k.startsWith('task:'));
    expect(taskKeys).toEqual([]);
    expect(redisCommands.some((c) => c.cmd === 'xgroup')).toBe(false);

    service.dispose();
  });
});
