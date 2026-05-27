/**
 * TeamWorkspaceService — 团队本地存储管理。
 *
 * 设计（v2）:
 *   - 一个 Team = 一个 cc-connect project
 *   - 无 Member 子层级，team 本身就是 agent
 *   - 渠道（platform）配置在 cc-connect project 上，hermit 不重复存储
 *
 * 目录布局 (~/.hermit/teams/<team-slug>/):
 *   ├─ team.json              # 团队元数据
 *   ├─ messages/group.jsonl   # 消息记录
 *   └─ tasks/board.json       # 任务看板
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { createLogger } from '@shared/utils/logger';

const logger = createLogger('TeamWorkspace');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 团队元数据，存储在 team.json */
export interface TeamManifest {
  schemaVersion: 2;
  slug: string;
  displayName: string;
  /** cc-connect project name — 渠道和 agent 运行时的载体 */
  bindProject: string;
  /** agent 类型，用于 MCP 配置注入等 harness 特定逻辑 */
  harness: string;
  /** agent 工作目录（cc-connect project work_dir） */
  workDir: string;
  color?: string;
  description?: string;
  language?: string;
  permissionMode?: string;
  showContextIndicator?: boolean;
  replyFooter?: boolean;
  injectSender?: boolean;
  managedSources?: string;
  disabledCommands?: string[];
  platformAllowFrom?: Record<string, string>;
  pendingDelete?: boolean;
  restartRequired?: boolean;
  /**
   * 协同模式开关（默认 true）。
   * true  = 团队可作为任务 assignee 接收其他团队派发的任务（Task Dispatcher 推消息）。
   * false = 独立作战，不接收跨团队任务派发，也不对外派发。
   */
  collaboration?: boolean;
  /** 平台/渠道类型（默认 bridge） */
  platform?: string;
  /** 平台特定选项 */
  platformOptions?: Record<string, string>;
  rootPath: string;
  createdAt: string;
}

export interface CreateTeamInput {
  displayName: string;
  /** cc-connect project name */
  bindProject: string;
  harness: string;
  workDir: string;
  color?: string;
  description?: string;
  language?: string;
  /** 协同模式，默认 true */
  collaboration?: boolean;
  /** 平台/渠道类型 */
  platform?: string;
  /** 平台特定选项 */
  platformOptions?: Record<string, string>;
}

export interface GroupMessage {
  id: string;
  ts: string;
  from: string;
  to: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  meta?: Record<string, unknown> | null;
}

export interface AppendGroupMessageInput {
  from: string;
  to?: string;
  role?: GroupMessage['role'];
  content: string;
  meta?: Record<string, unknown> | null;
}

export type TaskStatus = 'todo' | 'doing' | 'done';

export interface Task {
  id: string;
  teamSlug: string;
  title: string;
  description?: string;
  status: TaskStatus;
  /** 分配给哪个团队（team slug） */
  assignee?: string | null;
  /** agent 完成任务后写入的结果摘要 */
  result?: string | null;
  createdAt: string;
  updatedAt: string;
  order: number;
  /** Cross-team dispatch metadata */
  dispatchMeta?: import('@shared/types/team').DispatchMeta;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hermitHome(): string {
  return process.env.HERMIT_HOME || path.join(os.homedir(), '.hermit');
}

export function toSlug(input: string, fallback = 'team'): string {
  const ascii = String(input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return ascii || fallback;
}

export function teamsRoot(): string {
  return path.join(hermitHome(), 'teams');
}

export function teamRoot(teamSlug: string): string {
  return path.join(teamsRoot(), teamSlug);
}

export function groupSessionKey(teamSlug: string): string {
  return `hermit:${teamSlug}:session`;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.promises.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(p: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.promises.readFile(p, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeJson(p: string, data: unknown): Promise<void> {
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.promises.rename(tmp, p);
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class TeamWorkspaceService {
  private async resolveStorageSlug(teamSlug: string): Promise<string> {
    if (await pathExists(path.join(teamRoot(teamSlug), 'team.json'))) {
      return teamSlug;
    }
    const match = (await this.listTeams()).find((manifest) => manifest.bindProject === teamSlug);
    return match?.slug ?? teamSlug;
  }

  async createTeam(
    input: CreateTeamInput
  ): Promise<{ slug: string; root: string; manifest: TeamManifest }> {
    if (!input.displayName) throw new Error('displayName is required');
    if (!input.bindProject) throw new Error('bindProject is required');
    if (!input.workDir) throw new Error('workDir is required');

    const slug = toSlug(input.bindProject);
    const root = teamRoot(slug);

    await fs.promises.mkdir(root, { recursive: true });
    await fs.promises.mkdir(path.join(root, 'messages'), { recursive: true });
    await fs.promises.mkdir(path.join(root, 'tasks'), { recursive: true });

    const manifest: TeamManifest = {
      schemaVersion: 2,
      slug,
      displayName: input.displayName,
      bindProject: input.bindProject,
      harness: input.harness,
      workDir: input.workDir,
      color: input.color,
      description: input.description,
      language: input.language,
      collaboration: input.collaboration ?? true,
      platform: input.platform,
      platformOptions: input.platformOptions,
      rootPath: root,
      createdAt: new Date().toISOString(),
    };

    await writeJson(path.join(root, 'team.json'), manifest);
    logger.info(`created team ${slug} → cc-project:${input.bindProject}`);
    return { slug, root, manifest };
  }

  async readTeamManifest(teamSlug: string): Promise<TeamManifest> {
    const root = teamRoot(teamSlug);
    const manifest = await readJson<TeamManifest | null>(path.join(root, 'team.json'), null);
    if (!manifest) {
      if (!(await pathExists(root))) {
        throw new Error(`团队 "${teamSlug}" 不存在 (${root})`);
      }
      const stat = await fs.promises.stat(root).catch(() => null);
      return {
        schemaVersion: 2,
        slug: teamSlug,
        displayName: teamSlug,
        bindProject: teamSlug,
        harness: 'claudecode',
        workDir: '',
        collaboration: true,
        rootPath: root,
        createdAt: (stat?.birthtime ?? stat?.mtime ?? new Date()).toISOString(),
      };
    }
    return manifest;
  }

  async readTeamManifestByProject(projectName: string): Promise<TeamManifest> {
    try {
      return await this.readTeamManifest(projectName);
    } catch {
      const match = (await this.listTeams()).find(
        (manifest) => manifest.bindProject === projectName
      );
      if (match) return match;
      throw new Error(`团队 "${projectName}" 不存在 (${teamsRoot()})`);
    }
  }

  async listTeams(): Promise<TeamManifest[]> {
    const dir = teamsRoot();
    if (!(await pathExists(dir))) return [];
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const out: TeamManifest[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      try {
        out.push(await this.readTeamManifest(e.name));
      } catch {
        // skip broken dirs
      }
    }
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async updateTeam(
    teamSlug: string,
    patch: Partial<
      Pick<
        TeamManifest,
        | 'displayName'
        | 'color'
        | 'description'
        | 'collaboration'
        | 'harness'
        | 'workDir'
        | 'language'
        | 'permissionMode'
        | 'showContextIndicator'
        | 'replyFooter'
        | 'injectSender'
        | 'managedSources'
        | 'disabledCommands'
        | 'platformAllowFrom'
        | 'pendingDelete'
        | 'restartRequired'
      >
    >
  ): Promise<TeamManifest> {
    const manifest = await this.readTeamManifest(teamSlug);
    const updated: TeamManifest = { ...manifest, ...patch };
    await writeJson(path.join(manifest.rootPath, 'team.json'), updated);
    return updated;
  }

  async deleteTeam(teamSlug: string, opts: { deleteFiles?: boolean } = {}): Promise<void> {
    const manifest = await this.readTeamManifest(teamSlug);
    const root = manifest.rootPath;
    if (opts.deleteFiles) {
      await fs.promises.rm(root, { recursive: true, force: true });
    } else {
      const archive = path.join(teamsRoot(), `.archived-${teamSlug}-${Date.now()}`);
      await fs.promises.rename(root, archive);
    }
    logger.info(`deleted team ${teamSlug} (deleteFiles=${opts.deleteFiles ?? false})`);
  }

  // ---- 消息记录 ----

  async appendMessage(teamSlug: string, msg: AppendGroupMessageInput): Promise<GroupMessage> {
    const file = path.join(teamRoot(teamSlug), 'messages', 'group.jsonl');
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const entry: GroupMessage = {
      id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      ts: new Date().toISOString(),
      from: msg.from,
      to: msg.to || 'team',
      role: msg.role || (msg.from === 'user' ? 'user' : 'agent'),
      content: msg.content,
      meta: msg.meta ?? null,
    };
    await fs.promises.appendFile(file, JSON.stringify(entry) + '\n');
    return entry;
  }

  async readMessages(teamSlug: string, opts: { limit?: number } = {}): Promise<GroupMessage[]> {
    const limit = opts.limit ?? 200;
    const file = path.join(teamRoot(teamSlug), 'messages', 'group.jsonl');
    let raw: string;
    try {
      raw = await fs.promises.readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const lines = raw.split(/\n+/).filter(Boolean);
    const all: GroupMessage[] = [];
    for (const line of lines) {
      try {
        all.push(JSON.parse(line) as GroupMessage);
      } catch {
        /* skip */
      }
    }
    return all.length <= limit ? all : all.slice(all.length - limit);
  }

  // ---- 任务看板 ----

  private async readBoard(teamSlug: string): Promise<{ tasks: Task[] }> {
    const storageSlug = await this.resolveStorageSlug(teamSlug);
    return readJson<{ tasks: Task[] }>(path.join(teamRoot(storageSlug), 'tasks', 'board.json'), {
      tasks: [],
    });
  }

  private async writeBoard(teamSlug: string, board: { tasks: Task[] }): Promise<void> {
    const storageSlug = await this.resolveStorageSlug(teamSlug);
    await writeJson(path.join(teamRoot(storageSlug), 'tasks', 'board.json'), board);
  }

  async readTasks(teamSlug: string): Promise<Task[]> {
    const board = await this.readBoard(teamSlug);
    return Array.isArray(board.tasks) ? board.tasks : [];
  }

  async createTask(
    teamSlug: string,
    payload: {
      title: string;
      description?: string;
      assignee?: string | null;
      status?: TaskStatus;
      dispatchMeta?: import('@shared/types/team').DispatchMeta;
    }
  ): Promise<Task> {
    if (!payload?.title) throw new Error('title is required');
    const board = await this.readBoard(teamSlug);
    const status: TaskStatus = payload.status || 'todo';
    const sameCol = (board.tasks || []).filter((t) => t.status === status);
    const order = sameCol.length > 0 ? Math.max(...sameCol.map((t) => t.order || 0)) + 1 : 0;
    const now = new Date().toISOString();
    const task: Task = {
      id: `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      teamSlug,
      title: payload.title,
      description: payload.description || '',
      status,
      assignee: payload.assignee ?? null,
      result: null,
      createdAt: now,
      updatedAt: now,
      order,
      dispatchMeta: payload.dispatchMeta,
    };
    board.tasks = [...(board.tasks || []), task];
    await this.writeBoard(teamSlug, board);
    return task;
  }

  async patchTask(teamSlug: string, taskId: string, patch: Partial<Task>): Promise<Task> {
    const board = await this.readBoard(teamSlug);
    const idx = (board.tasks || []).findIndex((t) => t.id === taskId);
    if (idx < 0) throw new Error(`task not found: ${taskId}`);
    const next: Task = {
      ...board.tasks[idx],
      ...patch,
      id: board.tasks[idx].id,
      teamSlug: board.tasks[idx].teamSlug,
      updatedAt: new Date().toISOString(),
    };
    board.tasks[idx] = next;
    await this.writeBoard(teamSlug, board);
    return next;
  }

  async deleteTask(teamSlug: string, taskId: string): Promise<boolean> {
    const board = await this.readBoard(teamSlug);
    const before = (board.tasks || []).length;
    board.tasks = (board.tasks || []).filter((t) => t.id !== taskId);
    if (board.tasks.length === before) return false;
    await this.writeBoard(teamSlug, board);
    return true;
  }
}
