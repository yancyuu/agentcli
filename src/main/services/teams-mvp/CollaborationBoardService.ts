/**
 * CollaborationBoardService — canonical state store for cross-team tasks.
 *
 * The collaboration board is a projection of CollabTask state. All meaningful
 * changes must go through transition(), which validates the previous status,
 * bumps version, appends an event, persists locally, and syncs to Redis.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type {
  CollabTask,
  CollabTaskEvent,
  CollabTaskEventType,
  CollabTaskStatus,
} from '@shared/types/team';
import type Redis from 'ioredis';

const HERMIT_HOME = process.env.HERMIT_HOME || path.join(os.homedir(), '.hermit');
const COLLAB_BOARD_FILE = path.join(HERMIT_HOME, 'collab-board.json');
const COLLAB_EVENTS_FILE = path.join(HERMIT_HOME, 'collab-events.jsonl');

interface TransitionInput {
  dispatchId: string;
  expected: CollabTaskStatus | CollabTaskStatus[];
  next: CollabTaskStatus;
  actor: CollabTaskEvent['actor'];
  eventType: CollabTaskEventType;
  payload?: Record<string, unknown>;
  extra?: Partial<CollabTask>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeTask(task: CollabTask): CollabTask {
  const now = nowIso();
  return {
    ...task,
    version: task.version ?? 1,
    revisionCount: task.revisionCount ?? 0,
    createdAt: task.createdAt || now,
    updatedAt: task.updatedAt || now,
  };
}

function eventTypeForStatus(status: CollabTaskStatus): CollabTaskEventType {
  switch (status) {
    case 'pending_accept':
    case 'received':
      return 'task_sent';
    case 'accepted':
    case 'in_progress':
      return 'task_accepted';
    case 'delivered':
      return 'task_delivered';
    case 'approved':
      return 'task_approved';
    case 'revision':
      return 'revision_requested';
    case 'rejected':
      return 'task_rejected';
    case 'failed':
      return 'task_failed';
    default:
      return 'task_failed';
  }
}

export class CollaborationBoardService {
  private tasks: Map<string, CollabTask> = new Map();
  private redis: Redis | null = null;
  private loaded = false;

  constructor() {
    this.loadFromDisk();
  }

  setRedis(redis: Redis | null): void {
    this.redis = redis;
    if (redis) {
      this.syncFromRedis().catch(() => {});
    }
  }

  getBoard(): CollabTask[] {
    return Array.from(this.tasks.values()).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  getTask(dispatchId: string): CollabTask | undefined {
    return this.tasks.get(dispatchId);
  }

  getEvents(dispatchId: string): CollabTaskEvent[] {
    try {
      if (!fs.existsSync(COLLAB_EVENTS_FILE)) return [];
      return fs
        .readFileSync(COLLAB_EVENTS_FILE, 'utf-8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as CollabTaskEvent)
        .filter((event) => event.dispatchId === dispatchId);
    } catch {
      return [];
    }
  }

  addTask(task: CollabTask): CollabTask {
    const existing = this.tasks.get(task.dispatchId);
    if (existing) return existing;

    const normalized = normalizeTask(task);
    this.tasks.set(normalized.dispatchId, normalized);
    this.appendEvent({
      eventId: crypto.randomUUID(),
      dispatchId: normalized.dispatchId,
      version: normalized.version ?? 1,
      type: 'task_sent',
      actor: { type: 'team', id: normalized.fromTeam },
      payload: {
        fromTeam: normalized.fromTeam,
        toTeam: normalized.toTeam,
        subject: normalized.subject,
      },
      createdAt: nowIso(),
    });
    this.persistToDisk();
    this.syncTaskToRedis(normalized).catch(() => {});
    return normalized;
  }

  transition(input: TransitionInput): CollabTask {
    const task = this.tasks.get(input.dispatchId);
    if (!task) {
      throw new Error(`Collab task not found: ${input.dispatchId}`);
    }

    const expected = Array.isArray(input.expected) ? input.expected : [input.expected];
    if (!expected.includes(task.status)) {
      throw new Error(
        `Invalid collab task transition: ${task.status} -> ${input.next}; expected ${expected.join(', ')}`
      );
    }

    const nextVersion = (task.version ?? 1) + 1;
    const nextTask: CollabTask = {
      ...task,
      ...input.extra,
      status: input.next,
      version: nextVersion,
      updatedAt: nowIso(),
    };

    this.tasks.set(input.dispatchId, nextTask);
    this.appendEvent({
      eventId: crypto.randomUUID(),
      dispatchId: input.dispatchId,
      version: nextVersion,
      type: input.eventType,
      actor: input.actor,
      payload: input.payload,
      createdAt: nowIso(),
    });
    this.persistToDisk();
    this.syncTaskToRedis(nextTask).catch(() => {});
    return nextTask;
  }

  /**
   * Compatibility method for older call sites. New code should prefer transition().
   */
  updateStatus(
    dispatchId: string,
    status: CollabTaskStatus,
    extra?: Partial<CollabTask>
  ): CollabTask | undefined {
    const current = this.tasks.get(dispatchId);
    if (!current) return undefined;
    return this.transition({
      dispatchId,
      expected: current.status,
      next: status,
      actor: { type: 'system', id: 'legacy-updateStatus' },
      eventType: eventTypeForStatus(status),
      payload: extra as Record<string, unknown> | undefined,
      extra,
    });
  }

  private loadFromDisk(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (!fs.existsSync(COLLAB_BOARD_FILE)) return;
      const raw = fs.readFileSync(COLLAB_BOARD_FILE, 'utf-8');
      const arr = JSON.parse(raw) as CollabTask[];
      for (const task of arr) {
        const normalized = normalizeTask(task);
        this.tasks.set(normalized.dispatchId, normalized);
      }
    } catch {
      // corrupted or missing — start empty
    }
  }

  private persistToDisk(): void {
    try {
      const dir = path.dirname(COLLAB_BOARD_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(COLLAB_BOARD_FILE, JSON.stringify(this.getBoard(), null, 2), 'utf-8');
    } catch {
      // best-effort
    }
  }

  private appendEvent(event: CollabTaskEvent): void {
    try {
      const dir = path.dirname(COLLAB_EVENTS_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.appendFileSync(COLLAB_EVENTS_FILE, `${JSON.stringify(event)}\n`, 'utf-8');
    } catch {
      // best-effort
    }
  }

  private async syncTaskToRedis(task: CollabTask): Promise<void> {
    if (!this.redis) return;
    try {
      const score = new Date(task.updatedAt).getTime();
      await this.redis.zadd('collab:board', score, task.dispatchId);
      await this.redis.hset(`collab:task:${task.dispatchId}`, {
        id: task.id,
        dispatchId: task.dispatchId,
        subject: task.subject,
        description: task.description ?? '',
        fromTeam: task.fromTeam,
        fromTeamDisplay: task.fromTeamDisplay,
        toTeam: task.toTeam,
        toTeamDisplay: task.toTeamDisplay,
        status: task.status,
        version: String(task.version ?? 1),
        result: task.result ?? '',
        feedback: task.feedback ?? '',
        deadline: task.deadline ?? '',
        needsHumanReview: String(task.needsHumanReview),
        revisionCount: String(task.revisionCount),
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        acceptedAt: task.acceptedAt ?? '',
        deliveredAt: task.deliveredAt ?? '',
        approvedAt: task.approvedAt ?? '',
      });
    } catch {
      // degraded
    }
  }

  async syncToRedis(): Promise<void> {
    if (!this.redis) return;
    for (const task of this.tasks.values()) {
      await this.syncTaskToRedis(task);
    }
  }

  async syncFromRedis(): Promise<void> {
    if (!this.redis) return;
    try {
      const ids = await this.redis.zrange('collab:board', 0, -1);
      for (const id of ids) {
        if (this.tasks.has(id)) continue;
        const hash = await this.redis.hgetall(`collab:task:${id}`);
        if (!hash || !hash.dispatchId) continue;

        const task: CollabTask = normalizeTask({
          id: hash.id,
          dispatchId: hash.dispatchId,
          subject: hash.subject,
          description: hash.description || undefined,
          fromTeam: hash.fromTeam,
          fromTeamDisplay: hash.fromTeamDisplay,
          toTeam: hash.toTeam,
          toTeamDisplay: hash.toTeamDisplay,
          status: hash.status as CollabTaskStatus,
          version: Number(hash.version) || 1,
          result: hash.result || undefined,
          feedback: hash.feedback || undefined,
          deadline: hash.deadline || undefined,
          needsHumanReview: hash.needsHumanReview === 'true',
          revisionCount: Number(hash.revisionCount) || 0,
          createdAt: hash.createdAt,
          updatedAt: hash.updatedAt,
          acceptedAt: hash.acceptedAt || undefined,
          deliveredAt: hash.deliveredAt || undefined,
          approvedAt: hash.approvedAt || undefined,
        });
        this.tasks.set(id, task);
      }
      this.persistToDisk();
    } catch {
      // degraded
    }
  }
}
