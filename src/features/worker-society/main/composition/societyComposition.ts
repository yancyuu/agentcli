/**
 * Worker Society — 组合根（composition root）。
 *
 * 把领域/应用层与基础设施层装配成一个可被 server.ts / MCP / 前端调用的活实例：
 *   - FS store（~/.hermit/society/*.json）让声誉/关系/需求持久。
 *   - CrossTeamMessageGateway 让 worker 间消息走 hermit cross-team 协议并持久化。
 *   - SystemClock 提供真实时间（应用层允许使用 Date；只有 workflow 脚本受限）。
 *
 * 镜像 server.ts:440-441（taskDispatch 构造）的注入式构造风格。
 * rootDir 可注入（生产默认 ~/.hermit/society，测试用临时目录）。
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

import { WorkerSocietyService } from '../../core/application/WorkerSocietyService';
import { CrossTeamMessageGateway } from '../infrastructure/crossTeamMessageGateway';
import { FsNeedStore, FsProfileStore, FsRelationshipStore } from '../infrastructure/fsStores';
import { MergingProfileStore } from '../infrastructure/mergingProfileStore';

import type { ClockPort, WorkerProfileStore } from '../../core/application/ports';
import type { DiscoverableWorker } from '@shared/types/worker';

/** 默认社会数据根目录：~/.hermit/society。 */
export function defaultSocietyRoot(): string {
  return join(homedir(), '.hermit', 'society');
}

/** 真实系统时钟（ISO 字符串）。 */
class SystemClock implements ClockPort {
  now(): string {
    return new Date().toISOString();
  }
}

export interface SocietyComponents {
  service: WorkerSocietyService;
  gateway: CrossTeamMessageGateway;
  /** 花名册存储：注入 realWorkersProvider 时为 MergingProfileStore（真实员工 + overlay），否则 FsProfileStore。 */
  profiles: WorkerProfileStore;
  needs: FsNeedStore;
  relationships: FsRelationshipStore;
}

/**
 * 真实员工来源（注入点）。society 的成员花名册以 hermit 真实数字员工为单一事实源——
 * 由 server.ts 注入 listDiscoverableWorkers（GET /api/workers 同款），让社会层身份与真实团队一致；
 * 社会属性（能力/声誉/并发）由 ~/.hermit/society/profiles.json overlay 叠加（见 MergingProfileStore）。
 * 缺省不注入 → 退化为纯 FsProfileStore（既有单测 / 离线场景零变化）。
 */
export interface WorkerSocietyDepsInput {
  realWorkersProvider?: () => Promise<DiscoverableWorker[]>;
}

/** 装配 worker-society 全栈。同一 rootDir 可多次调用以「重载」磁盘状态。 */
export function createWorkerSociety(
  rootDir: string = defaultSocietyRoot(),
  deps: WorkerSocietyDepsInput = {}
): SocietyComponents {
  const clock = new SystemClock();
  // 注入了 realWorkersProvider → 用 MergingProfileStore 把真实员工与 overlay 合并；
  // 否则用纯 FsProfileStore（离线/测试场景，成员即 profiles.json 本身，零行为变化）。
  const profiles: WorkerProfileStore = deps.realWorkersProvider
    ? new MergingProfileStore(new FsProfileStore(rootDir), deps.realWorkersProvider)
    : new FsProfileStore(rootDir);
  const needs = new FsNeedStore(rootDir);
  const relationships = new FsRelationshipStore(rootDir);
  const gateway = new CrossTeamMessageGateway(rootDir, clock);
  const service = new WorkerSocietyService(profiles, needs, relationships, gateway, clock);
  return { service, gateway, profiles, needs, relationships };
}
