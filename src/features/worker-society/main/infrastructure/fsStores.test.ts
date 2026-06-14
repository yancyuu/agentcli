/**
 * FsStores 测试 —— 基础设施层持久化（TDD 先行）。
 *
 * 用 os.tmpdir() 隔离每个用例，断言：
 *   - 基本增删查（get / list / upsert / delete / listOpen / bulkSet）
 *   - 跨实例持久化（new 一个同 rootDir 的 store 仍能读到磁盘数据）—— 这是「社交平台」声誉/关系
 *     跨重启存活的核心不变量。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PublishedNeed, Relationship, WorkerProfile } from '../../core/domain/models/society';
import { FsNeedStore, FsProfileStore, FsRelationshipStore } from './fsStores';

function profile(workerId: string, reputation = 50): WorkerProfile {
  return {
    workerId,
    name: workerId.toUpperCase(),
    kind: 'composite',
    capabilities: [],
    interests: [],
    maxConcurrent: 3,
    activeTaskCount: 0,
    reputation,
    status: 'online',
  };
}

function need(needId: string, status: PublishedNeed['status'] = 'open'): PublishedNeed {
  return {
    needId,
    postedBy: 'user',
    subject: needId,
    requiredCapabilities: [],
    priority: 5,
    status,
    volunteers: [],
    createdAt: '2026-06-13T10:00:00.000Z',
    revisionCount: 0,
  };
}

function rel(from: string, to: string): Relationship {
  return {
    fromWorker: from,
    toWorker: to,
    collaborations: 1,
    successes: 1,
    trust: 1,
    lastInteractedAt: '2026-06-13T10:00:00.000Z',
  };
}

describe('FsProfileStore', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ws-profile-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns undefined for a missing worker', async () => {
    const store = new FsProfileStore(root);
    expect(await store.get('ghost')).toBeUndefined();
  });
  it('upserts and retrieves a profile', async () => {
    const store = new FsProfileStore(root);
    await store.upsert(profile('w1', 60));
    const got = await store.get('w1');
    expect(got?.workerId).toBe('w1');
    expect(got?.reputation).toBe(60);
  });
  it('upsert overwrites an existing profile', async () => {
    const store = new FsProfileStore(root);
    await store.upsert(profile('w1', 50));
    await store.upsert({ ...profile('w1'), name: 'Renamed', reputation: 90 });
    const got = await store.get('w1');
    expect(got?.name).toBe('Renamed');
    expect(got?.reputation).toBe(90);
  });
  it('lists all profiles', async () => {
    const store = new FsProfileStore(root);
    await store.upsert(profile('a'));
    await store.upsert(profile('b'));
    const list = await store.list();
    expect(list.map((p) => p.workerId).sort()).toEqual(['a', 'b']);
  });
  it('deletes a profile', async () => {
    const store = new FsProfileStore(root);
    await store.upsert(profile('w1'));
    await store.delete('w1');
    expect(await store.get('w1')).toBeUndefined();
  });
  it('delete is a no-op for a worker that was never stored (idempotent)', async () => {
    // L65 真臂 `if (!(workerId in map)) return`：删一个不存在的 worker（未注册/已删过）应是
    // 幂等 no-op——不抛、不写、不误伤既有数据。既有 delete 测删的是已存在的 w1（假臂）。
    const store = new FsProfileStore(root);
    await store.upsert(profile('w1'));
    await store.delete('ghost'); // ghost 不在 map → 提前 return，无写
    expect((await store.get('w1'))?.workerId).toBe('w1'); // 既有数据未被误伤
    expect(await store.get('ghost')).toBeUndefined();
  });
  it('persists across instances (reload from disk)', async () => {
    const a = new FsProfileStore(root);
    await a.upsert(profile('w1', 77));
    const b = new FsProfileStore(root);
    expect((await b.get('w1'))?.reputation).toBe(77);
  });
  it('survives a missing/corrupt file by returning empty data', async () => {
    // 全新 rootDir 下文件不存在 → list 不抛、返回空。
    const store = new FsProfileStore(root);
    expect(await store.list()).toEqual([]);
  });
});

describe('FsNeedStore', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ws-need-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns undefined for a missing need', async () => {
    expect(await new FsNeedStore(root).get('nope')).toBeUndefined();
  });
  it('upserts and retrieves a need', async () => {
    const store = new FsNeedStore(root);
    await store.upsert(need('n1'));
    expect((await store.get('n1'))?.subject).toBe('n1');
  });
  it('lists all needs', async () => {
    const store = new FsNeedStore(root);
    await store.upsert(need('n1'));
    await store.upsert(need('n2', 'closed'));
    expect((await store.list()).map((n) => n.needId).sort()).toEqual(['n1', 'n2']);
  });
  it('listOpen returns only open needs', async () => {
    const store = new FsNeedStore(root);
    await store.upsert(need('open1', 'open'));
    await store.upsert(need('closed1', 'closed'));
    await store.upsert(need('prog1', 'in_progress'));
    expect((await store.listOpen()).map((n) => n.needId)).toEqual(['open1']);
  });
  it('listActive returns needs across the open→delivered lifecycle (excludes terminal)', async () => {
    const store = new FsNeedStore(root);
    await store.upsert(need('open1', 'open'));
    await store.upsert(need('asg1', 'assigned'));
    await store.upsert(need('prog1', 'in_progress'));
    await store.upsert(need('deliv1', 'delivered'));
    await store.upsert(need('closed1', 'closed'));
    await store.upsert(need('expired1', 'expired'));
    await store.upsert(need('cancel1', 'cancelled'));
    const active = (await store.listActive()).map((n) => n.needId).sort();
    // 画布要看到完整生命周期：选派后/执行中/待审核都保留；仅排除已终结状态。
    expect(active).toEqual(['asg1', 'deliv1', 'open1', 'prog1']);
  });
  it('upsert overwrites a need (e.g. status transition open→closed)', async () => {
    const store = new FsNeedStore(root);
    await store.upsert(need('n1', 'open'));
    await store.upsert({ ...need('n1'), status: 'closed' });
    expect((await store.get('n1'))?.status).toBe('closed');
    expect(await store.listOpen()).toHaveLength(0);
  });
  it('persists across instances', async () => {
    const a = new FsNeedStore(root);
    await a.upsert(need('n1'));
    const b = new FsNeedStore(root);
    expect((await b.get('n1'))?.needId).toBe('n1');
  });
});

describe('FsRelationshipStore', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ws-rel-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('starts empty when no file exists', async () => {
    expect(await new FsRelationshipStore(root).list()).toEqual([]);
  });
  it('survives a corrupt relationships.json by returning [] (covers readJson catch branch)', async () => {
    // 写入半截/非法 JSON —— 模拟崩溃导致的半写文件；list 不抛、降级为空。
    await writeFile(join(root, 'relationships.json'), '{ not valid json', 'utf8');
    expect(await new FsRelationshipStore(root).list()).toEqual([]);
  });
  it('bulkSet round-trips relationships', async () => {
    const store = new FsRelationshipStore(root);
    await store.bulkSet([rel('a', 'b'), rel('b', 'c')]);
    expect((await store.list()).map((r) => `${r.fromWorker}->${r.toWorker}`).sort()).toEqual([
      'a->b',
      'b->c',
    ]);
  });
  it('bulkSet replaces (not appends) the full set', async () => {
    const store = new FsRelationshipStore(root);
    await store.bulkSet([rel('a', 'b')]);
    await store.bulkSet([rel('c', 'd')]);
    expect(await store.list()).toHaveLength(1);
    expect((await store.list())[0].fromWorker).toBe('c');
  });
  it('persists across instances', async () => {
    const a = new FsRelationshipStore(root);
    await a.bulkSet([rel('a', 'b')]);
    const b = new FsRelationshipStore(root);
    expect(await b.list()).toHaveLength(1);
  });
});
