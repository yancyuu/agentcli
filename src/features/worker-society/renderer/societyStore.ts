/**
 * Worker Society — 前端状态层（Zustand）。
 *
 * 把 SocietyApiClient 聚合成一个可被 React 组件订阅的 store：workers / 公告板需求 /
 * 关系图 / 活动流，外加 loading/error。每个 mutation（注册/发布/自荐/选派/交付/社交）
 * 调用 API 后**只刷新受影响切片**，避免全量重拉。
 *
 * api 可注入（测试用 mock；生产用 createSocietyApi()）。store 是 factory 形式，便于
 * 在测试里每次拿到干净实例。
 */
import { create } from 'zustand';

import {
  createSocietyApi,
  type PublishNeedInput,
  type RegisterWorkerInput,
  type SocietyApiClient,
} from './societyApi';
import type { PublishedNeed, Relationship, WorkerProfile } from '../core/domain/models/society';
import type { SocialMessageRecord } from '../main/infrastructure/crossTeamMessageGateway';

export interface SocietyStoreState {
  workers: WorkerProfile[];
  openNeeds: PublishedNeed[];
  /** 仍在生命周期内的需求（open/assigned/in_progress/delivered）—— 画布据此渲染 worker 跑向任务。 */
  activeNeeds: PublishedNeed[];
  relationships: Relationship[];
  feed: SocialMessageRecord[];
  loading: boolean;
  error: string | null;

  loadAll(): Promise<void>;
  refresh(): Promise<void>;
  registerWorker(input: RegisterWorkerInput): Promise<void>;
  publishNeed(input: PublishNeedInput): Promise<void>;
  volunteer(needId: string, workerId: string): Promise<void>;
  selectAssignee(needId: string): Promise<void>;
  startNeed(needId: string, workerId: string): Promise<void>;
  deliverNeed(needId: string, result: string): Promise<void>;
  acceptDelivery(needId: string): Promise<void>;
  cancelNeed(needId: string): Promise<void>;
  sendMessage(fromWorker: string, toWorker: string, text: string): Promise<void>;
  runAutonomyTick(): Promise<void>;
  autoSelectPending(): Promise<void>;
}

/** 拉取四类数据并写入 store；统一管理 loading/error。 */
async function loadAllInto(
  set: (partial: Partial<SocietyStoreState>) => void,
  api: SocietyApiClient
): Promise<void> {
  set({ loading: true, error: null });
  try {
    const [workers, openNeeds, activeNeeds, relationships, feed] = await Promise.all([
      api.listWorkers(),
      api.listOpenNeeds(),
      api.listActiveNeeds(),
      api.listRelationships(),
      api.getFeed(),
    ]);
    set({ workers, openNeeds, activeNeeds, relationships, feed, loading: false });
  } catch (e) {
    set({ loading: false, error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * 创建一个 society store（默认指向同源 /api/society/*）。
 * @param api 注入的 API 客户端；省略则用 createSocietyApi()。
 */
export function createSocietyStore(api: SocietyApiClient = createSocietyApi()) {
  const useSocietyStore = create<SocietyStoreState>((set) => {
    // 局部刷新：只重拉受影响的切片，避免全量 loadAll。
    const reloadWorkers = async (): Promise<void> => set({ workers: await api.listWorkers() });
    // 需求切片刷新：open（看板的待办）与 active（画布的生命周期）同源，一起刷新，
    // 这样任意状态流转（自荐/选派/执行/交付）后两处视图都同步。
    const reloadOpenNeeds = async (): Promise<void> => {
      const [openNeeds, activeNeeds] = await Promise.all([
        api.listOpenNeeds(),
        api.listActiveNeeds(),
      ]);
      set({ openNeeds, activeNeeds });
    };
    const reloadFeed = async (): Promise<void> => set({ feed: await api.getFeed() });

    // 统一 mutation：调命令 → 捕获错误 → 仅刷受影响切片。
    const mutate = async (
      run: () => Promise<unknown>,
      after: () => Promise<void>
    ): Promise<void> => {
      set({ error: null });
      try {
        await run();
        await after();
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e) });
      }
    };

    return {
      workers: [],
      openNeeds: [],
      activeNeeds: [],
      relationships: [],
      feed: [],
      loading: false,
      error: null,

      loadAll: () => loadAllInto(set, api),
      refresh: () => loadAllInto(set, api),

      registerWorker: (input) => mutate(() => api.registerWorker(input), reloadWorkers),
      publishNeed: (input) => mutate(() => api.publishNeed(input), reloadOpenNeeds),
      volunteer: (needId, workerId) =>
        mutate(() => api.volunteer(needId, workerId), reloadOpenNeeds),
      selectAssignee: (needId) => mutate(() => api.selectAssignee(needId), reloadOpenNeeds),
      startNeed: (needId, workerId) =>
        mutate(() => api.startNeed(needId, workerId), reloadOpenNeeds),
      deliverNeed: (needId, result) =>
        mutate(() => api.deliverNeed(needId, result), reloadOpenNeeds),
      acceptDelivery: (needId) => mutate(() => api.acceptDelivery(needId), reloadOpenNeeds),
      cancelNeed: (needId) => mutate(() => api.cancelNeed(needId), reloadOpenNeeds),
      sendMessage: (fromWorker, toWorker, text) =>
        mutate(() => api.sendMessage(fromWorker, toWorker, text), reloadFeed),
      runAutonomyTick: () =>
        mutate(
          () => api.runAutonomyTick(),
          // 自治自荐同时改变「需求的自荐者」与「社交活动流」。
          async () => {
            await reloadOpenNeeds();
            await reloadFeed();
          }
        ),
      autoSelectPending: () =>
        mutate(
          () => api.autoSelectPending(),
          // 选派改变需求状态并产生通知消息。
          async () => {
            await reloadOpenNeeds();
            await reloadFeed();
          }
        ),
    };
  });

  return useSocietyStore;
}
