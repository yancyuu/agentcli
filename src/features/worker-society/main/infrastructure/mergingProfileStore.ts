/**
 * MergingProfileStore —— 把「真实数字员工」与「社会层 overlay」在读取时合并的 WorkerProfileStore。
 *
 * 为什么需要它：society 成员的花名册来源必须是 hermit 的真实团队（GET /api/workers →
 * listDiscoverableWorkers），而不是 profiles.json 里堆出的假数据。但社会层的能力 / 声誉 /
 * 并发 / 兴趣属于「真实员工没有、社会层叠加」的属性，仍需持久化。因此本类在 *读取* 时把两者
 * 合并：身份 / 在线态取真实员工，社会属性取 overlay（无则给默认）。
 *
 * 关键：合并点放在 store 层而非 service。WorkerSocietyService 有 ~10 处读 roster
 * （discoverWorkers / volunteerFor.get / selectAssignee.list / runAutonomyTick.list /
 * reward.get / cancelNeed.get …），只有把合并下沉到 store，所有读路径才能一致看到真实成员——
 * 否则真实员工会在 volunteerFor 被判 worker_not_found。service 代码零改动（DRY，单一合并点）。
 *
 * 写（upsert / delete）只作用于 overlay：身份字段即便被写入也会在下次读取时被真实员工覆盖，
 * 因此注册一个非真实 workerId 是不可见的无害操作（强制「成员 = 真实员工」语义）。
 *
 * 依赖注入：realWorkersProvider 由组合根（server.ts）注入 listDiscoverableWorkers，本层只用
 * @shared/types/worker 的 TYPE 导入，不引入 @main 运行时依赖——society 保持独立可演进。
 */
import { clampReputation, DEFAULT_REPUTATION } from '../../core/domain/policies/societyPolicies';

import type { WorkerProfileStore } from '../../core/application/ports';
import type { WorkerProfile } from '../../core/domain/models/society';
import type { DiscoverableWorker } from '@shared/types/worker';

/** 真实员工未配置 overlay 时的并发上限（保守默认；可由 overlay 覆盖）。 */
const DEFAULT_MAX_CONCURRENT = 2;

/**
 * 把一个真实员工与（可选）overlay 合并成社会档案。纯函数、可单测。
 *
 * 身份 / 在线态 / 绑定目录恒取真实员工；overlay 仅决定社会属性，且都允许缺省：
 *   - capabilities：overlay 非空则用 overlay（人工策展），否则用真实员工被推断的能力
 *     （inferCapabilities → {skill:harness}+{skill:'general'}，保证自治匹配可用）；
 *   - reputation：夹取到 [0,100]，默认 50；
 *   - maxConcurrent / interests / activeTaskCount：overlay 或默认。
 *
 * activeTaskCount 刻意不耦合真实团队任务系统——那是 society 自身的负载计数
 * （select→+1 / accept·cancel→−1），跨层耦合会过度嵌套。
 */
export function mergeRealWorker(real: DiscoverableWorker, overlay?: WorkerProfile): WorkerProfile {
  return {
    workerId: real.workerId,
    name: real.name,
    kind: real.kind,
    harness: real.harness,
    workDir: real.workDir,
    // DiscoverableWorker.status 只有 online/offline；社会的 'busy' 不由真实态合成。
    status: real.status === 'online' ? 'online' : 'offline',
    description: real.description,
    capabilities:
      overlay && overlay.capabilities.length > 0 ? overlay.capabilities : (real.capabilities ?? []),
    interests: overlay?.interests ?? [],
    maxConcurrent: overlay?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
    activeTaskCount: overlay?.activeTaskCount ?? 0,
    reputation: clampReputation(overlay?.reputation ?? DEFAULT_REPUTATION),
  };
}

/**
 * 装饰一个 overlay store：读取时合并真实员工，写入时只动 overlay。
 * base 通常是 FsProfileStore（~/.hermit/society/profiles.json）；realWorkersProvider 注入真实花名册。
 */
export class MergingProfileStore implements WorkerProfileStore {
  constructor(
    private readonly base: WorkerProfileStore,
    private readonly realWorkersProvider: () => Promise<DiscoverableWorker[]>
  ) {}

  async list(): Promise<WorkerProfile[]> {
    // overlay 索引只读一次（FsProfileStore.list 读一次 profiles.json），N 个真实成员复用之，
    // 而非逐个 base.get 触发 N 次整文件读取（动态规划：算一次，复用）。
    const [real, overlays] = await Promise.all([this.realWorkersProvider(), this.base.list()]);
    const overlayById = new Map(overlays.map((o) => [o.workerId, o]));
    // overlay 中存在但真实员工已不存在的 workerId（旧假数据）自动丢弃——
    // 花名册只反映真实成员，不残留 profiles.json 里的孤儿。
    return real.map((r) => mergeRealWorker(r, overlayById.get(r.workerId)));
  }

  async get(workerId: string): Promise<WorkerProfile | undefined> {
    const real = await this.realWorkersProvider();
    const r = real.find((w) => w.workerId === workerId);
    if (!r) return undefined; // 非真实员工：不可见（注册假 workerId 的写入因此被忽略）。
    const overlay = await this.base.get(workerId);
    return mergeRealWorker(r, overlay);
  }

  async upsert(profile: WorkerProfile): Promise<WorkerProfile> {
    // 只写 overlay；身份字段下次读取时被真实员工覆盖。
    return this.base.upsert(profile);
  }

  async delete(workerId: string): Promise<void> {
    await this.base.delete?.(workerId);
  }
}
