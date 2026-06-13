/**
 * Worker Society — 应用层测试用 Fake 实现（仿 teams-mvp/TaskDispatchService.test.ts）
 *
 * 供 application use case / adapter mapping / renderer utility 测试复用。
 * 不含业务规则，只是 Map/数组的薄封装。
 */

import type {
  PublishedNeed,
  Relationship,
  SocialEvent,
  WorkerProfile,
} from '../domain/models/society';
import type {
  ClockPort,
  MessageGateway,
  NeedStore,
  RelationshipStore,
  SocialEventSink,
  SocialMessageOut,
  WorkerProfileStore,
} from './ports';
import { ACTIVE_NEED_STATUSES } from '../domain/policies/societyPolicies';

export class FakeClock implements ClockPort {
  constructor(private t: string) {}
  now(): string {
    return this.t;
  }
  set(iso: string): void {
    this.t = iso;
  }
}

export class FakeProfileStore implements WorkerProfileStore {
  private map = new Map<string, WorkerProfile>();
  async get(workerId: string): Promise<WorkerProfile | undefined> {
    return this.map.get(workerId);
  }
  async list(): Promise<WorkerProfile[]> {
    return [...this.map.values()];
  }
  async upsert(profile: WorkerProfile): Promise<WorkerProfile> {
    this.map.set(profile.workerId, profile);
    return profile;
  }
  async delete(workerId: string): Promise<void> {
    this.map.delete(workerId);
  }
}

export class FakeNeedStore implements NeedStore {
  private map = new Map<string, PublishedNeed>();
  async get(needId: string): Promise<PublishedNeed | undefined> {
    return this.map.get(needId);
  }
  async list(): Promise<PublishedNeed[]> {
    return [...this.map.values()];
  }
  async listOpen(): Promise<PublishedNeed[]> {
    return [...this.map.values()].filter((n) => n.status === 'open');
  }
  async listActive(): Promise<PublishedNeed[]> {
    return [...this.map.values()].filter((n) => ACTIVE_NEED_STATUSES.includes(n.status));
  }
  async upsert(need: PublishedNeed): Promise<PublishedNeed> {
    this.map.set(need.needId, need);
    return need;
  }
}

export class FakeRelationshipStore implements RelationshipStore {
  private rels: Relationship[] = [];
  async list(): Promise<Relationship[]> {
    return [...this.rels];
  }
  async bulkSet(relationships: Relationship[]): Promise<void> {
    this.rels = [...relationships];
  }
}

export class FakeMessageGateway implements MessageGateway {
  sent: SocialMessageOut[] = [];
  async send(msg: SocialMessageOut): Promise<{ delivered: boolean }> {
    this.sent.push(msg);
    return { delivered: true };
  }
}

export class MemoryEventSink implements SocialEventSink {
  private events: SocialEvent[] = [];
  append(event: SocialEvent): void {
    this.events.push(event);
  }
  all(): SocialEvent[] {
    return [...this.events];
  }
  recent(limit: number): SocialEvent[] {
    return this.events.slice(-limit);
  }
}
