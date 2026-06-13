/**
 * Worker Society — 应用层 ports（被 main/infrastructure 实现）
 *
 * core/application 只依赖这些抽象端口，不触碰 FS/Redis/Fastify/cc-connect。
 * 这样 worker 自治引擎可被纯单测驱动（Fake 实现）。
 */

import type {
  PublishedNeed,
  Relationship,
  SocialEvent,
  WorkerProfile,
} from '../domain/models/society';

/** 时钟端口，保证应用层可注入确定性时间。 */
export interface ClockPort {
  now(): string;
}

/** Worker 社会档案存储。 */
export interface WorkerProfileStore {
  get(workerId: string): Promise<WorkerProfile | undefined>;
  list(): Promise<WorkerProfile[]>;
  upsert(profile: WorkerProfile): Promise<WorkerProfile>;
  delete?(workerId: string): Promise<void>;
}

/** 广场（Agora）需求存储。 */
export interface NeedStore {
  get(needId: string): Promise<PublishedNeed | undefined>;
  list(): Promise<PublishedNeed[]>;
  listOpen(): Promise<PublishedNeed[]>;
  /** 仍在交互生命周期内（open/assigned/in_progress/delivered，未终结）的需求。 */
  listActive(): Promise<PublishedNeed[]>;
  upsert(need: PublishedNeed): Promise<PublishedNeed>;
}

/** worker 间关系图存储。 */
export interface RelationshipStore {
  list(): Promise<Relationship[]>;
  bulkSet(relationships: Relationship[]): Promise<void>;
}

/** 出站社交消息（worker↔worker 或 worker→user）。由 cc-connect Bridge / inbox 实现。 */
export interface SocialMessageOut {
  fromWorker: string;
  toWorker: string;
  text: string;
  needId?: string;
}

export interface MessageGateway {
  send(msg: SocialMessageOut): Promise<{ delivered: boolean }>;
}

/** 社会活动流 sink —— 用于前端实时渲染社会视图。 */
export interface SocialEventSink {
  append(event: SocialEvent): void;
  recent?(limit: number): SocialEvent[];
}

/** 聚合依赖，构造 WorkerSocietyService 时注入。 */
export interface WorkerSocietyDeps {
  profiles: WorkerProfileStore;
  needs: NeedStore;
  relationships: RelationshipStore;
  messages: MessageGateway;
  clock: ClockPort;
  events?: SocialEventSink;
}
