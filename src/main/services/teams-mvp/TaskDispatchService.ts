import type {
  DiscoverableTeam,
  DispatchMeta,
  TaskBusConfig,
  TaskDispatchPayload,
  TaskStatusUpdate,
} from '@shared/types/team';
import type { TeamWorkspaceService, TeamManifest } from './TeamWorkspaceService';
import type Redis from 'ioredis';

const DISPATCH_RULES_DEFAULT = `When to dispatch a task to another team:
- Task requires access to a different codebase/project
- Task explicitly mentions another team's domain or ownership
- Task is blocked by work owned by another team
- Task requires expertise the current team doesn't have

Do NOT dispatch:
- Task is within current team's project scope
- Task can be completed with available tools
- Task is a small change (< estimated 5 min)`;

export interface DispatchResult {
  dispatchId: string;
  status: DispatchMeta['status'];
  targetTeam: string;
  message: string;
}

export class TaskDispatchService {
  private workspace: TeamWorkspaceService;
  private config: TaskBusConfig | null = null;
  private redis: Redis | null = null;
  private redisSub: Redis | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private consumerTimers: ReturnType<typeof setInterval>[] = [];
  private disposed = false;

  constructor(workspace: TeamWorkspaceService) {
    this.workspace = workspace;
  }

  get dispatchRulesText(): string {
    return DISPATCH_RULES_DEFAULT;
  }

  async start(config?: TaskBusConfig): Promise<void> {
    this.config = config ?? null;
    if (config?.enabled && config.redis) {
      await this.connectRedis();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stopHeartbeat();
    this.stopConsumers();
    this.redis?.disconnect();
    this.redisSub?.disconnect();
    this.redis = null;
    this.redisSub = null;
  }

  // ── Agent-facing ──────────────────────────────────────────────

  async listTeams(): Promise<DiscoverableTeam[]> {
    const teams: DiscoverableTeam[] = [];

    // Local teams
    const localTeams = await this.workspace.listTeams();
    for (const team of localTeams) {
      teams.push({
        slug: team.slug,
        displayName: team.displayName ?? team.slug,
        location: 'local',
        status: 'online',
        collaboration: team.collaboration !== false,
      });
    }

    // Remote teams (via Redis)
    if (this.redis) {
      try {
        const now = Date.now();
        const staleThreshold = 90_000; // 90s
        const entries = await this.redis.zrange('task:teams', 0, -1, 'WITHSCORES');
        const localSlugs = new Set(teams.map((t) => t.slug));
        for (let i = 0; i < entries.length; i += 2) {
          const slug = entries[i] as string;
          const ts = Number(entries[i + 1]);
          if (localSlugs.has(slug)) continue;
          teams.push({
            slug,
            displayName: slug,
            location: 'remote',
            status: now - ts < staleThreshold ? 'online' : 'offline',
            collaboration: true,
          });
        }
      } catch {
        // Redis read failure — return local teams only
      }
    }

    return teams;
  }

  async dispatchTask(
    fromTeam: string,
    task: { subject: string; description?: string; prompt?: string },
    targetTeam: string
  ): Promise<DispatchResult> {
    if (fromTeam === targetTeam) {
      return {
        dispatchId: '',
        status: 'failed',
        targetTeam,
        message: 'Cannot dispatch to self — use native task tools instead.',
      };
    }

    const dispatchId = crypto.randomUUID();
    const dispatchMeta: DispatchMeta = {
      dispatchId,
      originTeam: fromTeam,
      targetTeam,
      status: 'dispatched',
      dispatchedAt: new Date().toISOString(),
    };

    // Route: local or remote
    const isLocal = await this.isLocalTeam(targetTeam);
    if (isLocal) {
      await this.handleLocalDispatch(dispatchMeta, task);
    } else if (this.redis) {
      await this.handleRemoteDispatch(dispatchMeta, task);
    } else {
      return {
        dispatchId,
        status: 'failed',
        targetTeam,
        message: 'Redis not configured — remote dispatch unavailable.',
      };
    }

    return {
      dispatchId,
      status: 'dispatched',
      targetTeam,
      message: `Task dispatched to ${targetTeam}`,
    };
  }

  async onTaskCompleted(teamSlug: string, taskId: string): Promise<void> {
    const tasks = await this.workspace.readTasks(teamSlug);
    const task = tasks.find((t) => t.id === taskId);
    if (!task?.dispatchMeta) return;

    const meta = task.dispatchMeta;
    const update: TaskStatusUpdate = {
      dispatchId: meta.dispatchId,
      originTeam: meta.originTeam,
      status: 'completed',
      remoteTaskId: task.id,
      timestamp: new Date().toISOString(),
      result: task.result ?? undefined,
    };

    // Update local dispatchMeta
    await this.workspace.patchTask(teamSlug, taskId, {
      dispatchMeta: { ...meta, status: 'completed', completedAt: update.timestamp },
    } as any);

    // Notify origin team
    if (this.redis) {
      const channel = `task:status:${meta.originTeam}`;
      await this.redis.publish(channel, JSON.stringify(update)).catch((err: Error) => {
        console.error('[TaskDispatchService] status publish failed:', err.message);
      });
    }
  }

  // ── Local dispatch ────────────────────────────────────────────

  private async isLocalTeam(teamSlug: string): Promise<boolean> {
    try {
      await this.workspace.readTeamManifest(teamSlug);
      return true;
    } catch {
      return false;
    }
  }

  private async handleLocalDispatch(
    dispatchMeta: DispatchMeta,
    task: { subject: string; description?: string; prompt?: string }
  ): Promise<void> {
    const created = await this.workspace.createTask(dispatchMeta.targetTeam, {
      title: task.subject,
      description: task.description,
    });
    // Attach dispatchMeta after creation
    await this.workspace.patchTask(dispatchMeta.targetTeam, created.id, {
      dispatchMeta,
    } as any);
  }

  // ── Remote dispatch (Redis) ───────────────────────────────────

  private async connectRedis(): Promise<void> {
    if (!this.config?.redis) return;
    try {
      const ioredis = await import('ioredis');
      const { host, port, password, db } = this.config.redis;
      const opts = { host, port, password: password || undefined, db: db ?? 0 };

      this.redis = new ioredis.default(opts);
      this.redisSub = new ioredis.default(opts);

      this.redis.on('error', (err: Error) => {
        console.error('[TaskDispatchService] Redis error:', err.message);
      });

      await this.redis.ping();

      this.startHeartbeat();
      this.startConsumers();
      this.subscribeStatus();
    } catch (err) {
      console.error('[TaskDispatchService] Redis connect failed:', err);
      this.redis = null;
      this.redisSub = null;
    }
  }

  private async handleRemoteDispatch(
    dispatchMeta: DispatchMeta,
    task: { subject: string; description?: string; prompt?: string }
  ): Promise<void> {
    const payload: TaskDispatchPayload = {
      dispatchId: dispatchMeta.dispatchId,
      originTeam: dispatchMeta.originTeam,
      targetTeam: dispatchMeta.targetTeam,
      task: {
        subject: task.subject,
        description: task.description,
        prompt: task.prompt,
      },
      dispatchedAt: dispatchMeta.dispatchedAt,
    };

    const streamKey = `task:dispatch:${dispatchMeta.targetTeam}`;
    await this.redis!.xadd(streamKey, '*', 'payload', JSON.stringify(payload));
  }

  // ── Heartbeat ─────────────────────────────────────────────────

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const beat = async () => {
      if (!this.redis || this.disposed) return;
      const now = Date.now();
      const localTeams = await this.workspace.listTeams();
      for (const team of localTeams) {
        await this.redis.zadd('task:teams', now, team.slug).catch(() => {});
      }
    };
    beat();
    this.heartbeatTimer = setInterval(beat, 30_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ── Consumers (XREADGROUP) ────────────────────────────────────

  private startConsumers(): void {
    if (!this.redis || !this.redisSub) return;

    const startForTeam = async (teamSlug: string) => {
      const streamKey = `task:dispatch:${teamSlug}`;
      const groupName = `hermit-${teamSlug}`;
      const consumerId = `consumer-${process.pid}`;

      // Create consumer group (MKSTREAM creates stream if missing)
      try {
        await this.redis!.xgroup('CREATE', streamKey, groupName, '0', 'MKSTREAM');
      } catch {
        // Group already exists — ignore
      }

      const poll = async () => {
        if (this.disposed || !this.redisSub) return;
        try {
          const raw: unknown = await (this.redisSub as any).xreadgroup(
            'GROUP',
            groupName,
            consumerId,
            'BLOCK',
            5000,
            'COUNT',
            1,
            'STREAMS',
            streamKey,
            '>'
          );
          const results = raw as [string, [string, (string | Buffer)[]][]][] | null;

          if (!results || results.length === 0) return;

          for (const [, messages] of results) {
            if (!Array.isArray(messages)) continue;
            for (const [msgId, fields] of messages) {
              await this.handleIncomingDispatch(teamSlug, msgId, fields, groupName);
            }
          }
        } catch {
          // Read error — will retry next poll
        }
      };

      // Initial poll, then interval
      poll();
      const timer = setInterval(poll, 5000);
      this.consumerTimers.push(timer);
    };

    // Start consumer for each local team
    this.workspace.listTeams().then((teams) => {
      for (const team of teams) {
        startForTeam(team.slug);
      }
    });
  }

  private async handleIncomingDispatch(
    teamSlug: string,
    msgId: string,
    fields: (string | Buffer)[],
    groupName: string
  ): Promise<void> {
    try {
      // fields is [key, value, key, value, ...]
      const payloadStr = fields[1]?.toString();
      if (!payloadStr) return;

      const payload: TaskDispatchPayload = JSON.parse(payloadStr);

      // Write task to board.json
      const created = await this.workspace.createTask(teamSlug, {
        title: payload.task.subject,
        description: payload.task.description,
      });

      const dispatchMeta: DispatchMeta = {
        dispatchId: payload.dispatchId,
        originTeam: payload.originTeam,
        targetTeam: payload.targetTeam,
        status: 'received',
        dispatchedAt: payload.dispatchedAt,
        receivedAt: new Date().toISOString(),
        remoteTaskId: created.id,
      };

      await this.workspace.patchTask(teamSlug, created.id, {
        dispatchMeta,
      } as any);

      // Send ack
      if (this.redis) {
        const ackKey = `task:ack:${payload.dispatchId}`;
        const ackPayload = JSON.stringify({
          dispatchId: payload.dispatchId,
          status: 'received',
          remoteTaskId: created.id,
          timestamp: new Date().toISOString(),
        });
        await this.redis.xadd(ackKey, '*', 'ack', ackPayload);
        await this.redis.xack(`task:dispatch:${teamSlug}`, groupName, msgId);
      }
    } catch (err) {
      console.error('[TaskDispatchService] handleIncomingDispatch error:', err);
    }
  }

  private stopConsumers(): void {
    for (const t of this.consumerTimers) clearInterval(t);
    this.consumerTimers = [];
  }

  // ── Status subscribe ──────────────────────────────────────────

  private subscribeStatus(): void {
    if (!this.redisSub) return;

    this.workspace.listTeams().then((teams) => {
      for (const team of teams) {
        const channel = `task:status:${team.slug}`;

        this.redisSub!.subscribe(channel).catch((err: Error) => {
          console.error('[TaskDispatchService] subscribe failed:', err.message);
        });
      }
    });

    this.redisSub.on('message', (channel: string, message: string) => {
      // channel format: task:status:{teamSlug}
      if (!channel.startsWith('task:status:')) return;

      try {
        const update: TaskStatusUpdate = JSON.parse(message);
        const teamSlug = channel.replace('task:status:', '');

        // Find shadow task (dispatched from this team) and update status
        this.handleStatusSync(teamSlug, update);
      } catch {
        // Ignore malformed messages
      }
    });
  }

  private async handleStatusSync(teamSlug: string, update: TaskStatusUpdate): Promise<void> {
    const tasks = await this.workspace.readTasks(teamSlug);
    const shadowTask = tasks.find((t) => t.dispatchMeta?.dispatchId === update.dispatchId);
    if (!shadowTask) return;

    await this.workspace.patchTask(teamSlug, shadowTask.id, {
      dispatchMeta: {
        ...shadowTask.dispatchMeta!,
        status: update.status,
        completedAt:
          update.status === 'completed' ? update.timestamp : shadowTask.dispatchMeta!.completedAt,
        remoteTaskId: update.remoteTaskId ?? shadowTask.dispatchMeta!.remoteTaskId,
      },
    } as any);
  }
}
