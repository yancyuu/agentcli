/**
 * TeamWorkspace — 托管模式团队目录管理 + 任务看板 + 群聊持久化。
 *
 * 布局(托管模式 ~/.hermit/teams/<team-slug>/):
 *   ├─ team.json              # 团队元数据(displayName / mode / members)
 *   ├─ mappings.json          # team member ↔ cc-connect project 映射(此文件由 ProjectMappingStore 全局管,在这里仅供未来扩展)
 *   ├─ messages/group.jsonl   # 群聊持久化
 *   ├─ tasks/board.json       # 任务看板
 *   └─ members/<member-slug>/ # 成员 work_dir
 *
 * 关键设计:
 *   - 团队 = 一个独立目录(支持托管/绑定两种模式,本文件仅实现托管模式)
 *   - 群聊采用共享 session_key(`hermit:<team-slug>:group`),让 cc-connect
 *     把整个团队看作单一连续会话,而不是按发言人切上下文。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { createLogger } from '@shared/utils/logger';
import { getErrorMessage } from '@shared/utils/errorHandling';

const logger = createLogger('TeamWorkspace');

const HERMIT_HOME = process.env.HERMIT_HOME || path.join(os.homedir(), '.hermit');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TeamMode = 'managed' | 'bound';

export interface TeamMember {
  slug: string;
  name: string;
  role: string;
  agentType: string | null;
  provider?: string | null;
  systemPrompt?: string | null;
  model?: string | null;
  workDir: string;
  /**
   * MVP 关键字段:绑定到 cc-connect 中的某个已有 project。
   * 当 bindProject 存在时,Hermit 不会尝试创建/修改该 project,
   * 只把消息路由到它,并读取其 session 历史。
   */
  bindProject: string | null;
}

export interface TeamManifest {
  schemaVersion: number;
  slug: string;
  displayName: string;
  mode: TeamMode;
  rootPath: string;
  createdAt: string;
  members: TeamMember[];
}

export interface TeamMemberInput {
  name: string;
  role?: string;
  agentType?: string | null;
  provider?: string | null;
  systemPrompt?: string | null;
  model?: string | null;
  bindProject?: string | null;
}

export interface CreateTeamInput {
  displayName: string;
  members: TeamMemberInput[];
}

export interface GroupMessage {
  id: string;
  ts: string;
  /** 'user' | memberSlug */
  from: string;
  /** 'group' | memberSlug */
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
  assignee?: string | null;
  createdAt: string;
  updatedAt: string;
  order: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  return path.join(HERMIT_HOME, 'teams');
}

export function teamRoot(teamSlug: string): string {
  return path.join(teamsRoot(), teamSlug);
}

export function memberWorkDir(teamSlug: string, memberSlug: string): string {
  return path.join(teamRoot(teamSlug), 'members', memberSlug);
}

export function groupSessionKey(teamSlug: string): string {
  return `hermit:${teamSlug}:group`;
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

async function pickUniqueSlug(baseSlug: string): Promise<string> {
  let candidate = baseSlug;
  let n = 2;
  while (await pathExists(teamRoot(candidate))) {
    candidate = `${baseSlug}-${n++}`;
    if (n > 1000) {
      throw new Error(`无法为 "${baseSlug}" 找到可用的 slug(已尝试 1000 次)`);
    }
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class TeamWorkspaceService {
  /**
   * 创建一个托管模式团队目录与 team.json。
   */
  async createManagedTeam(
    input: CreateTeamInput
  ): Promise<{ slug: string; root: string; manifest: TeamManifest }> {
    if (!input.displayName) throw new Error('displayName is required');
    if (!Array.isArray(input.members) || input.members.length === 0) {
      throw new Error('至少需要一个成员');
    }

    const baseSlug = toSlug(input.displayName);
    const slug = await pickUniqueSlug(baseSlug);
    const root = teamRoot(slug);

    await fs.promises.mkdir(root, { recursive: true });
    await fs.promises.mkdir(path.join(root, 'messages'), { recursive: true });
    await fs.promises.mkdir(path.join(root, 'tasks'), { recursive: true });
    await fs.promises.mkdir(path.join(root, 'members'), { recursive: true });

    const manifest: TeamManifest = {
      schemaVersion: 1,
      slug,
      displayName: input.displayName,
      mode: 'managed',
      rootPath: root,
      createdAt: new Date().toISOString(),
      members: input.members.map((m) => {
        const memberSlug = toSlug(m.name, 'member');
        return {
          slug: memberSlug,
          name: m.name,
          role: m.role || 'worker',
          agentType: m.agentType ?? null,
          provider: m.provider ?? null,
          systemPrompt: m.systemPrompt ?? null,
          model: m.model ?? null,
          workDir: memberWorkDir(slug, memberSlug),
          bindProject: m.bindProject ?? null,
        };
      }),
    };

    for (const m of manifest.members) {
      await fs.promises.mkdir(m.workDir, { recursive: true });
    }

    await writeJson(path.join(root, 'team.json'), manifest);
    return { slug, root, manifest };
  }

  async readTeamManifest(teamSlug: string): Promise<TeamManifest> {
    const root = teamRoot(teamSlug);
    const manifest = await readJson<TeamManifest | null>(path.join(root, 'team.json'), null);
    if (!manifest) throw new Error(`团队 "${teamSlug}" 不存在(${root})`);
    return manifest;
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

  async deleteTeam(teamSlug: string, opts: { deleteFiles?: boolean } = {}): Promise<void> {
    const manifest = await this.readTeamManifest(teamSlug);
    const root = manifest.rootPath;
    if (manifest.mode === 'managed' && opts.deleteFiles) {
      await fs.promises.rm(root, { recursive: true, force: true });
    } else if (manifest.mode === 'managed') {
      const archive = path.join(teamsRoot(), `.archived-${teamSlug}-${Date.now()}`);
      await fs.promises.rename(root, archive);
    }
  }

  // ---- 群聊 JSONL ----

  async appendGroupMessage(teamSlug: string, msg: AppendGroupMessageInput): Promise<GroupMessage> {
    const file = path.join(teamRoot(teamSlug), 'messages', 'group.jsonl');
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const entry: GroupMessage = {
      id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      ts: new Date().toISOString(),
      from: msg.from,
      to: msg.to || 'group',
      role: msg.role || (msg.from === 'user' ? 'user' : 'agent'),
      content: msg.content,
      meta: msg.meta ?? null,
    };
    await fs.promises.appendFile(file, JSON.stringify(entry) + '\n');
    return entry;
  }

  async readGroupMessages(
    teamSlug: string,
    opts: { limit?: number } = {}
  ): Promise<GroupMessage[]> {
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
        // skip
      }
    }
    return all.length <= limit ? all : all.slice(all.length - limit);
  }

  // ---- 任务看板 ----

  private async readBoard(teamSlug: string): Promise<{ tasks: Task[] }> {
    return readJson<{ tasks: Task[] }>(path.join(teamRoot(teamSlug), 'tasks', 'board.json'), {
      tasks: [],
    });
  }

  private async writeBoard(teamSlug: string, board: { tasks: Task[] }): Promise<void> {
    await writeJson(path.join(teamRoot(teamSlug), 'tasks', 'board.json'), board);
  }

  async readTasks(teamSlug: string): Promise<Task[]> {
    const board = await this.readBoard(teamSlug);
    return Array.isArray(board.tasks) ? board.tasks : [];
  }

  async createTask(
    teamSlug: string,
    payload: { title: string; description?: string; assignee?: string | null; status?: TaskStatus }
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
      createdAt: now,
      updatedAt: now,
      order,
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
