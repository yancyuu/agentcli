/**
 * societyStore 测试 —— Zustand 数据层（TDD 先行）。
 *
 * 注入一个 mock API（不触网络），断言：loadAll 聚合四类数据并管理 loading/error；
 * 每个 mutation（注册/发布/自荐/选派/交付/社交）调用对应 API 后**只刷新受影响切片**。
 */
import { describe, expect, it, vi } from 'vitest';

import { createSocietyStore } from './societyStore';
import type { SocietyApiClient } from './societyApi';

function mockApi(overrides: Partial<SocietyApiClient> = {}): SocietyApiClient {
  return {
    listWorkers: vi.fn().mockResolvedValue([]),
    registerWorker: vi.fn().mockResolvedValue({}),
    getWorker: vi.fn().mockResolvedValue(null),
    listOpenNeeds: vi.fn().mockResolvedValue([]),
    listActiveNeeds: vi.fn().mockResolvedValue([]),
    listAllNeeds: vi.fn().mockResolvedValue([]),
    publishNeed: vi.fn().mockResolvedValue({}),
    volunteer: vi.fn().mockResolvedValue({}),
    selectAssignee: vi.fn().mockResolvedValue({}),
    startNeed: vi.fn().mockResolvedValue({}),
    deliverNeed: vi.fn().mockResolvedValue({}),
    acceptDelivery: vi.fn().mockResolvedValue({}),
    cancelNeed: vi.fn().mockResolvedValue({}),
    listRelationships: vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn().mockResolvedValue({}),
    getFeed: vi.fn().mockResolvedValue([]),
    runAutonomyTick: vi.fn().mockResolvedValue({ ok: true, applied: 0 }),
    autoSelectPending: vi.fn().mockResolvedValue({ ok: true, selected: 0 }),
    ...overrides,
  };
}

describe('createSocietyStore', () => {
  it('loadAll aggregates workers, open needs, relationships, and feed', async () => {
    const api = mockApi({
      listWorkers: vi.fn().mockResolvedValue([{ workerId: 'a' }]),
      listOpenNeeds: vi.fn().mockResolvedValue([{ needId: 'n1' }]),
      listActiveNeeds: vi.fn().mockResolvedValue([{ needId: 'a1', status: 'assigned' }]),
      listRelationships: vi.fn().mockResolvedValue([{ fromWorker: 'a' }]),
      getFeed: vi.fn().mockResolvedValue([{ id: 'm1' }]),
    });
    const store = createSocietyStore(api);
    await store.getState().loadAll();
    const s = store.getState();
    expect(s.workers).toEqual([{ workerId: 'a' }]);
    expect(s.openNeeds).toEqual([{ needId: 'n1' }]);
    expect(s.activeNeeds).toEqual([{ needId: 'a1', status: 'assigned' }]);
    expect(s.relationships).toEqual([{ fromWorker: 'a' }]);
    expect(s.feed).toEqual([{ id: 'm1' }]);
    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();
  });

  it('sets error and clears loading when loadAll fails', async () => {
    const api = mockApi({ listWorkers: vi.fn().mockRejectedValue(new Error('down')) });
    const store = createSocietyStore(api);
    await store.getState().loadAll();
    const s = store.getState();
    expect(s.error).toBe('down');
    expect(s.loading).toBe(false);
  });

  it('registerWorker calls the API then reloads only workers (not needs/feed)', async () => {
    const api = mockApi({ listWorkers: vi.fn().mockResolvedValue([{ workerId: 'dev' }]) });
    const store = createSocietyStore(api);
    await store.getState().registerWorker({ workerId: 'dev', name: 'Dev', capabilities: 'code' });
    expect(api.registerWorker).toHaveBeenCalledWith({
      workerId: 'dev',
      name: 'Dev',
      capabilities: 'code',
    });
    expect(api.listWorkers).toHaveBeenCalledTimes(1); // targeted reload
    expect(api.listOpenNeeds).not.toHaveBeenCalled(); // unaffected slice untouched
    expect(api.getFeed).not.toHaveBeenCalled();
    expect(store.getState().workers).toEqual([{ workerId: 'dev' }]);
  });

  it('publishNeed calls the API then reloads only open needs', async () => {
    const api = mockApi({ listOpenNeeds: vi.fn().mockResolvedValue([{ needId: 'n1' }]) });
    const store = createSocietyStore(api);
    await store
      .getState()
      .publishNeed({ postedBy: 'u', subject: 'X', requiredCapabilities: 'code' });
    expect(api.publishNeed).toHaveBeenCalledWith({
      postedBy: 'u',
      subject: 'X',
      requiredCapabilities: 'code',
    });
    expect(api.listOpenNeeds).toHaveBeenCalledTimes(1);
    expect(api.listWorkers).not.toHaveBeenCalled();
    expect(store.getState().openNeeds).toEqual([{ needId: 'n1' }]);
  });

  it('volunteer -> select -> deliver -> accept each reload open needs', async () => {
    const api = mockApi();
    const store = createSocietyStore(api);
    const st = store.getState();
    await st.volunteer('n1', 'dev');
    await st.selectAssignee('n1');
    await st.deliverNeed('n1', 'v1');
    await st.acceptDelivery('n1');
    expect(api.volunteer).toHaveBeenCalledWith('n1', 'dev');
    expect(api.selectAssignee).toHaveBeenCalledWith('n1');
    expect(api.deliverNeed).toHaveBeenCalledWith('n1', 'v1');
    expect(api.acceptDelivery).toHaveBeenCalledWith('n1');
    expect(api.listOpenNeeds).toHaveBeenCalledTimes(4);
  });

  it('sendMessage reloads only the feed (not workers/needs)', async () => {
    const api = mockApi({ getFeed: vi.fn().mockResolvedValue([{ id: 'm1' }]) });
    const store = createSocietyStore(api);
    await store.getState().sendMessage('a', 'b', 'hi');
    expect(api.sendMessage).toHaveBeenCalledWith('a', 'b', 'hi');
    expect(api.getFeed).toHaveBeenCalledTimes(1);
    expect(api.listWorkers).not.toHaveBeenCalled();
    expect(api.listOpenNeeds).not.toHaveBeenCalled();
    expect(store.getState().feed).toEqual([{ id: 'm1' }]);
  });

  it('runAutonomyTick calls the API then reloads open needs and feed (autonomy changes both)', async () => {
    const api = mockApi({
      runAutonomyTick: vi.fn().mockResolvedValue({ ok: true, applied: 3 }),
      listOpenNeeds: vi.fn().mockResolvedValue([{ needId: 'n1' }]),
      getFeed: vi.fn().mockResolvedValue([{ id: 'm1' }]),
    });
    const store = createSocietyStore(api);
    await store.getState().runAutonomyTick();
    expect(api.runAutonomyTick).toHaveBeenCalledTimes(1);
    expect(api.listOpenNeeds).toHaveBeenCalledTimes(1); // 自荐改变需求的自荐者
    expect(api.getFeed).toHaveBeenCalledTimes(1); // 自荐产生社交消息
    expect(api.listWorkers).not.toHaveBeenCalled(); // 花名册不受影响
  });

  it('autoSelectPending calls the API then reloads open needs and feed', async () => {
    const api = mockApi({
      autoSelectPending: vi.fn().mockResolvedValue({ ok: true, selected: 2 }),
      listOpenNeeds: vi.fn().mockResolvedValue([{ needId: 'n1' }]),
      getFeed: vi.fn().mockResolvedValue([{ id: 'm1' }]),
    });
    const store = createSocietyStore(api);
    await store.getState().autoSelectPending();
    expect(api.autoSelectPending).toHaveBeenCalledTimes(1);
    expect(api.listOpenNeeds).toHaveBeenCalledTimes(1); // 选派改变需求状态
    expect(api.getFeed).toHaveBeenCalledTimes(1); // 选派产生通知消息
  });
});
