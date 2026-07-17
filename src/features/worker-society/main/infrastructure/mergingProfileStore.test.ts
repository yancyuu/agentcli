/**
 * MergingProfileStore 测试 —— 「真实数字员工 ↔ 社会层 overlay」合并的不变量。
 *
 * 核心断言：花名册以真实员工为单一事实源；身份/在线态恒取真实，社会属性取 overlay 或默认；
 * overlay 里真实员工已不存在的孤儿（旧假数据）在读取时被丢弃。
 */
import { describe, expect, it } from 'vitest';

import { mergeRealWorker, MergingProfileStore } from './mergingProfileStore';

import type { WorkerProfileStore } from '../../core/application/ports';
import type { WorkerProfile } from '../../core/domain/models/society';
import type { DiscoverableWorker } from '@shared/types/worker';

// ── 工厂 ──────────────────────────────────────────────────────────────────────

function realWorker(overrides: Partial<DiscoverableWorker> = {}): DiscoverableWorker {
  return {
    workerId: 'hermit-dev',
    name: 'Hermit 开发',
    kind: 'composite',
    harness: 'claudecode',
    location: 'local',
    status: 'online',
    capabilities: [
      { skill: 'claudecode', description: 'claudecode' },
      { skill: 'general', description: 'general' },
    ],
    description: '本地 hermit 团队',
    workDir: '/Users/yancyyu/code/hermit',
    ...overrides,
  };
}

function overlay(workerId: string, overrides: Partial<WorkerProfile> = {}): WorkerProfile {
  return {
    workerId,
    name: 'SHOULD BE OVERWRITTEN',
    kind: 'atomic',
    harness: 'SHOULD-BE-OVERWRITTEN',
    capabilities: [],
    interests: [],
    maxConcurrent: 3,
    activeTaskCount: 0,
    reputation: 50,
    status: 'busy',
    ...overrides,
  };
}

/** 内存版 overlay store，供 MergingProfileStore 装饰。 */
function fakeBase(
  initial: WorkerProfile[] = []
): WorkerProfileStore & { data: Map<string, WorkerProfile> } {
  const data = new Map(initial.map((p) => [p.workerId, p]));
  return {
    data,
    get: async (id) => data.get(id),
    list: async () => [...data.values()],
    upsert: async (p) => {
      data.set(p.workerId, p);
      return p;
    },
    delete: async (id) => {
      data.delete(id);
    },
  };
}

// ── mergeRealWorker（纯函数）──────────────────────────────────────────────────

describe('mergeRealWorker', () => {
  it('身份字段恒取真实员工（overlay 的 name/kind/harness 被忽略）', () => {
    const m = mergeRealWorker(
      realWorker(),
      overlay('hermit-dev', { name: 'FAKE', kind: 'atomic', harness: 'FAKE' })
    );
    expect(m.workerId).toBe('hermit-dev');
    expect(m.name).toBe('Hermit 开发');
    expect(m.kind).toBe('composite');
    expect(m.harness).toBe('claudecode');
    expect(m.workDir).toBe('/Users/yancyyu/code/hermit'); // 绑定目录恒取真实员工
    expect(m.description).toBe('本地 hermit 团队');
  });

  it('status 由真实员工决定：online→online', () => {
    expect(mergeRealWorker(realWorker({ status: 'online' })).status).toBe('online');
  });

  it('status 由真实员工决定：offline（及其它值）→offline，不合成 busy', () => {
    expect(mergeRealWorker(realWorker({ status: 'offline' })).status).toBe('offline');
    // overlay 的 'busy' 不能渗透——真实员工只有 online/offline。
    expect(
      mergeRealWorker(realWorker({ status: 'online' }), overlay('hermit-dev', { status: 'busy' }))
        .status
    ).toBe('online');
  });

  it('overlay 非空能力时覆盖真实员工的推断能力', () => {
    const m = mergeRealWorker(
      realWorker(),
      overlay('hermit-dev', { capabilities: [{ skill: 'react', description: 'react' }] })
    );
    expect(m.capabilities.map((c) => c.skill)).toEqual(['react']);
  });

  it('overlay 缺省 / 能力为空时回退到真实员工被推断的能力', () => {
    expect(mergeRealWorker(realWorker()).capabilities.map((c) => c.skill)).toEqual([
      'claudecode',
      'general',
    ]);
    expect(
      mergeRealWorker(realWorker(), overlay('hermit-dev', { capabilities: [] })).capabilities.map(
        (c) => c.skill
      )
    ).toEqual(['claudecode', 'general']);
  });

  it('真实员工无能力且无 overlay → 能力为空（不凭空造）', () => {
    expect(mergeRealWorker(realWorker({ capabilities: undefined })).capabilities).toEqual([]);
  });

  it('reputation 默认 50；overlay 给值时夹取到 [0,100]', () => {
    expect(mergeRealWorker(realWorker()).reputation).toBe(50);
    expect(
      mergeRealWorker(realWorker(), overlay('hermit-dev', { reputation: 150 })).reputation
    ).toBe(100);
    expect(
      mergeRealWorker(realWorker(), overlay('hermit-dev', { reputation: -20 })).reputation
    ).toBe(0);
    expect(
      mergeRealWorker(realWorker(), overlay('hermit-dev', { reputation: 80 })).reputation
    ).toBe(80);
  });

  it('maxConcurrent 默认 2；overlay 覆盖', () => {
    expect(mergeRealWorker(realWorker()).maxConcurrent).toBe(2);
    expect(
      mergeRealWorker(realWorker(), overlay('hermit-dev', { maxConcurrent: 5 })).maxConcurrent
    ).toBe(5);
  });

  it('interests / activeTaskCount 默认空 / 0', () => {
    const m = mergeRealWorker(realWorker());
    expect(m.interests).toEqual([]);
    expect(m.activeTaskCount).toBe(0);
  });
});

// ── MergingProfileStore（list/get 写入语义）────────────────────────────────────

describe('MergingProfileStore', () => {
  it('list() 合并真实员工 + overlay，并丢弃 overlay 里的孤儿（假数据）', async () => {
    const base = fakeBase([
      overlay('hermit-dev', { reputation: 77 }), // 真实员工 → 合并
      overlay('frontend', { reputation: 99 }), // 真实列表里没有 → 孤儿丢弃
    ]);
    const store = new MergingProfileStore(base, async () => [realWorker()]);

    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0].workerId).toBe('hermit-dev');
    expect(list[0].reputation).toBe(77); // overlay 的声誉生效
    expect(list.map((w) => w.workerId)).not.toContain('frontend');
  });

  it('get() 对真实员工返回合并档案；对非真实员工返回 undefined', async () => {
    const base = fakeBase([overlay('hermit-dev', { maxConcurrent: 4 })]);
    const store = new MergingProfileStore(base, async () => [realWorker()]);

    const got = await store.get('hermit-dev');
    expect(got?.name).toBe('Hermit 开发'); // 真实身份
    expect(got?.maxConcurrent).toBe(4); // overlay 社会属性

    expect(await store.get('frontend')).toBeUndefined(); // 非真实 → 不可见
  });

  it('upsert 只写 overlay（身份字段下次读取被真实员工覆盖）', async () => {
    const base = fakeBase();
    const store = new MergingProfileStore(base, async () => [realWorker()]);

    await store.upsert(overlay('hermit-dev', { reputation: 88, name: 'STALE-NAME' }));
    expect(base.data.get('hermit-dev')?.reputation).toBe(88); // 写进了 overlay
    const got = await store.get('hermit-dev');
    expect(got?.reputation).toBe(88); // overlay 生效
    expect(got?.name).toBe('Hermit 开发'); // 但身份仍取真实员工（STALE-NAME 被忽略）
  });

  it('delete 委托给 base', async () => {
    const base = fakeBase([overlay('hermit-dev')]);
    const store = new MergingProfileStore(base, async () => [realWorker()]);
    await store.delete('hermit-dev');
    expect(base.data.has('hermit-dev')).toBe(false);
  });
});
