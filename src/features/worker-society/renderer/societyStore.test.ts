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

  it('refresh reloads all data (loadAllInto alias)', async () => {
    // refresh 是 loadAll 的公开别名（两者都调 loadAllInto），此前无测试调用 → funcs 覆盖缺口。
    const api = mockApi({
      listWorkers: vi.fn().mockResolvedValue([{ workerId: 'a' }]),
    });
    const store = createSocietyStore(api);
    await store.getState().refresh();
    expect(store.getState().workers).toEqual([{ workerId: 'a' }]);
    expect(store.getState().loading).toBe(false);
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

  it('startNeed and cancelNeed each reload BOTH open and active needs (graph stays in sync)', async () => {
    // reloadNeeds（旧名 reloadOpenNeeds）同时刷新 open + active：画布据 activeNeeds 渲染
    // worker→task 锚点。锁住「需求生命周期 mutation 后两切片都刷新」——否则 cancel 一个
    // assigned 需求（assigned→cancelled 合法，见 iter-9）会让画布 activeNeeds 留陈旧节点，
    // 或诱导后人把 reload「优化」成只刷 open（函数名曾误导，本轮已正名）。
    const api = mockApi({
      listOpenNeeds: vi.fn().mockResolvedValue([{ needId: 'n1' }]),
      listActiveNeeds: vi.fn().mockResolvedValue([{ needId: 'a1', status: 'in_progress' }]),
    });
    const store = createSocietyStore(api);

    await store.getState().startNeed('n1', 'dev');
    expect(api.startNeed).toHaveBeenCalledWith('n1', 'dev');
    expect(api.listOpenNeeds).toHaveBeenCalledTimes(1);
    expect(api.listActiveNeeds).toHaveBeenCalledTimes(1); // ← 关键：active 也刷新

    await store.getState().cancelNeed('n1');
    expect(api.cancelNeed).toHaveBeenCalledWith('n1');
    expect(api.listOpenNeeds).toHaveBeenCalledTimes(2);
    expect(api.listActiveNeeds).toHaveBeenCalledTimes(2); // ← cancel 同样双切片刷新
  });

  it('sets error (and preserves prior data, leaves loading untouched) when a mutation fails', async () => {
    // iter-3 标记的缺口：此前只测了 loadAll 失败；mutation 失败的 error 契约未覆盖。
    // mutate 捕获异常 → 写 error；不触碰数据切片（既有数据保留）；mutations 不动 loading。
    const api = mockApi({
      listWorkers: vi.fn().mockResolvedValue([{ workerId: 'a' }]),
      registerWorker: vi.fn().mockRejectedValue(new Error('already exists')),
    });
    const store = createSocietyStore(api);
    await store.getState().loadAll(); // 先装好数据
    expect(store.getState().workers).toEqual([{ workerId: 'a' }]);

    await store.getState().registerWorker({ workerId: 'a', name: 'A', capabilities: '' });

    const s = store.getState();
    expect(s.error).toBe('already exists'); // 失败 → 写 error（mutate 的 catch 分支）
    expect(s.loading).toBe(false); // mutation 不动 loading（loadAll 已结束为 false）
    expect(s.workers).toEqual([{ workerId: 'a' }]); // 既有数据未被清空
  });

  it('stringifies a non-Error thrown value into the error state (loadAll and mutations)', async () => {
    // store 的 catch 兜底 `e instanceof Error ? e.message : String(e)`：非 Error 抛值（裸字符串/
    // 数字等）须 String() 化——error 状态恒为 string 是 UI 渲染前提（否则 React 渲染 number/对象报错）。
    // 现有 loadAll/mutation 失败用例都用 new Error（真臂 e.message）；本测补两处 false 臂 String(e)。
    const api = mockApi({
      listWorkers: vi.fn().mockRejectedValue('network down'), // 非 Error（裸字符串）
      registerWorker: vi.fn().mockRejectedValue(42), // 非 Error（数字）
    });
    const store = createSocietyStore(api);

    await store.getState().loadAll();
    expect(store.getState().error).toBe('network down'); // String('network down') → L63 兜底

    await store.getState().registerWorker({ workerId: 'x', name: 'X' });
    expect(store.getState().error).toBe('42'); // String(42) → L96 兜底
  });
});
