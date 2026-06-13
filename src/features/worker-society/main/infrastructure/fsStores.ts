/**
 * Worker Society — 基础设施层：文件系统持久化 store。
 *
 * 把应用层 ports（WorkerProfileStore / NeedStore / RelationshipStore）落地为
 * `~/.hermit/society/` 下的 JSON 文件，使声誉 / 关系 / 需求跨重启持久——
 * 这是「worker 社交平台」区别于一次性内存调度的核心。
 *
 * 设计：
 *   - 注入 rootDir（生产用 ~/.hermit/society，测试用 os.tmpdir() 隔离）。
 *   - 原子写：先写 .tmp 再 rename，避免半写损坏。
 *   - 容错读：文件不存在或损坏时返回空数据，不抛——保证服务在冷启动时可启动。
 *   - 不引入任何业务规则（纯 I/O），业务规则全部留在 core/domain。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { PublishedNeed, Relationship, WorkerProfile } from '../../core/domain/models/society';
import type {
  NeedStore,
  RelationshipStore,
  WorkerProfileStore,
} from '../../core/application/ports';
import { ACTIVE_NEED_STATUSES } from '../../core/domain/policies/societyPolicies';

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    // 文件不存在或解析失败 → 返回 fallback，保证冷启动可用。
    return fallback;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await rename(tmp, filePath);
}

type ProfileMap = Record<string, WorkerProfile>;
type NeedMap = Record<string, PublishedNeed>;

/** 声誉/能力档案的文件持久化（profiles.json）。 */
export class FsProfileStore implements WorkerProfileStore {
  private readonly file: string;
  constructor(rootDir: string) {
    this.file = join(rootDir, 'profiles.json');
  }
  async get(workerId: string): Promise<WorkerProfile | undefined> {
    return (await readJson<ProfileMap>(this.file, {}))[workerId];
  }
  async list(): Promise<WorkerProfile[]> {
    return Object.values(await readJson<ProfileMap>(this.file, {}));
  }
  async upsert(profile: WorkerProfile): Promise<WorkerProfile> {
    const map = await readJson<ProfileMap>(this.file, {});
    map[profile.workerId] = profile;
    await writeJsonAtomic(this.file, map);
    return profile;
  }
  async delete(workerId: string): Promise<void> {
    const map = await readJson<ProfileMap>(this.file, {});
    if (!(workerId in map)) return;
    delete map[workerId];
    await writeJsonAtomic(this.file, map);
  }
}

/** 广场需求（任务帖）的文件持久化（needs.json）。 */
export class FsNeedStore implements NeedStore {
  private readonly file: string;
  constructor(rootDir: string) {
    this.file = join(rootDir, 'needs.json');
  }
  async get(needId: string): Promise<PublishedNeed | undefined> {
    return (await readJson<NeedMap>(this.file, {}))[needId];
  }
  async list(): Promise<PublishedNeed[]> {
    return Object.values(await readJson<NeedMap>(this.file, {}));
  }
  async listOpen(): Promise<PublishedNeed[]> {
    const map = await readJson<NeedMap>(this.file, {});
    return Object.values(map).filter((n) => n.status === 'open');
  }
  async listActive(): Promise<PublishedNeed[]> {
    // 活跃需求 = 仍在交互生命周期内（未终结）：选派后/执行中/待审核也保留，
    // 这样画布上的 worker 会在整个生命周期停在任务锚点，而非选派后即丢下任务飘走。
    const map = await readJson<NeedMap>(this.file, {});
    return Object.values(map).filter((n) => ACTIVE_NEED_STATUSES.includes(n.status));
  }
  async upsert(need: PublishedNeed): Promise<PublishedNeed> {
    const map = await readJson<NeedMap>(this.file, {});
    map[need.needId] = need;
    await writeJsonAtomic(this.file, map);
    return need;
  }
}

/** worker 间关系图（有向边）的文件持久化（relationships.json）。 */
export class FsRelationshipStore implements RelationshipStore {
  private readonly file: string;
  constructor(rootDir: string) {
    this.file = join(rootDir, 'relationships.json');
  }
  async list(): Promise<Relationship[]> {
    return readJson<Relationship[]>(this.file, []);
  }
  async bulkSet(relationships: Relationship[]): Promise<void> {
    await writeJsonAtomic(this.file, relationships);
  }
}
