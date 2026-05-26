/**
 * CollaborationBoardService — 全局协作看板数据管理。
 *
 * 职责:
 *   - 本地存储协作任务（~/.hermit/collab-board.json）
 *   - Redis 同步（collab:board sorted set + collab:task:{id} hash）
 *   - 供 TaskDispatchService 调用以追踪跨团队任务状态
 */

import * as fs from 'fs';
import * as path from 'path';
import os from 'os';

import type { CollabTask, CollabTaskStatus } from '@shared/types/team';
import type Redis from 'ioredis';

const COLLAB_BOARD_FILE = path.join(os.homedir(), '.hermit', 'collab-board.json');

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

  // ── Read ────────────────────────────────────────────────────────

  getBoard(): CollabTask[] {
    return Array.from(this.tasks.values()).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  getTask(dispatchId: string): CollabTask | undefined {
    return this.tasks.get(dispatchId);
  }

  // ── Write ───────────────────────────────────────────────────────

  addTask(task: CollabTask): void {
    this.tasks.set(task.dispatchId, task);
    this.persistToDisk();
    this.syncTaskToRedis(task).catch(() => {});
  }

  updateStatus(
    dispatchId: string,
    status: CollabTaskStatus,
    extra?: Partial<CollabTask>
  ): CollabTask | undefined {
    const task = this.tasks.get(dispatchId);
    if (!task) return undefined;

    task.status = status;
    task.updatedAt = new Date().toISOString();
    if (extra) {
      Object.assign(task, extra);
    }

    this.tasks.set(dispatchId, task);
    this.persistToDisk();
    this.syncTaskToRedis(task).catch(() => {});
    return task;
  }

  // ── Persistence ─────────────────────────────────────────────────

  private loadFromDisk(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (!fs.existsSync(COLLAB_BOARD_FILE)) return;
      const raw = fs.readFileSync(COLLAB_BOARD_FILE, 'utf-8');
      const arr = JSON.parse(raw) as CollabTask[];
      for (const t of arr) {
        this.tasks.set(t.dispatchId, t);
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
      const arr = this.getBoard();
      fs.writeFileSync(COLLAB_BOARD_FILE, JSON.stringify(arr, null, 2), 'utf-8');
    } catch {
      // best-effort
    }
  }

  // ── Redis sync ──────────────────────────────────────────────────

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
        const hash = await this.redis!.hgetall(`collab:task:${id}`);
        if (!hash || !hash.dispatchId) continue;

        const task: CollabTask = {
          id: hash.id,
          dispatchId: hash.dispatchId,
          subject: hash.subject,
          description: hash.description || undefined,
          fromTeam: hash.fromTeam,
          fromTeamDisplay: hash.fromTeamDisplay,
          toTeam: hash.toTeam,
          toTeamDisplay: hash.toTeamDisplay,
          status: hash.status as CollabTaskStatus,
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
        };
        this.tasks.set(id, task);
      }
      this.persistToDisk();
    } catch {
      // degraded
    }
  }
}
