/**
 * Hermit MVP — 简化的前端 API 客户端,不依赖任何 store。
 *
 * - 团队(/api/teams + /api/teams/:slug/* tasks/messages/group-send)
 * - cc-connect 原子能力代理(/api/cc/*)
 *
 * 所有调用都同源,后端是 src/main/server.ts (5680);
 * vite dev 通过 vite.web.config 的 proxy 转发 /api → 5680。
 */

export type CcStatus = {
  version?: string;
  uptime_seconds?: number;
  projects_count?: number;
  bridge?: { enabled?: boolean };
  connected_platforms?: string[];
};

export type CcProject = {
  name: string;
  agent_type: string;
  platforms: string[];
  sessions_count: number;
  heartbeat_enabled?: boolean;
};

export type CcProjectDetail = CcProject & {
  work_dir?: string;
  agent_mode?: string;
  provider_refs?: string[];
  active_session_keys?: string[];
  platform_configs?: Array<{ type: string; allow_from?: string }>;
  settings?: { language?: string; admin_from?: string; disabled_commands?: string[] };
};

export type CcProvider = {
  name: string;
  api_key?: string;
  base_url?: string;
  model?: string;
  agent_types?: string[];
};

export type CcSession = {
  id: string;
  name?: string;
  platform?: string;
  session_key?: string;
  user_name?: string;
  chat_name?: string;
  agent_type?: string;
  active?: boolean;
  live?: boolean;
  history_count?: number;
  created_at?: string;
  updated_at?: string;
  last_message?: { role: string; content: string; timestamp: string } | null;
};

export type CcSkillPreset = {
  name: string;
  description?: string;
  source_url?: string;
};

export type Member = {
  slug: string;
  name: string;
  role: string;
  agentType: string | null;
  bindProject: string | null;
  workDir: string;
  systemPrompt?: string | null;
  model?: string | null;
};

export type Team = {
  schemaVersion: number;
  slug: string;
  displayName: string;
  mode: 'managed' | 'bound';
  rootPath: string;
  createdAt: string;
  members: Member[];
};

export type GroupMessage = {
  id: string;
  ts: string;
  from: string;
  to: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  meta?: {
    durationMs?: number;
    ccProjectName?: string;
    sessionKey?: string;
    error?: boolean;
  } | null;
};

export type Task = {
  id: string;
  teamSlug: string;
  title: string;
  description?: string;
  status: 'todo' | 'doing' | 'done';
  assignee?: string | null;
  createdAt: string;
  updatedAt: string;
  order: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const ct = res.headers.get('content-type') || '';
  let body: unknown = null;
  if (ct.includes('application/json')) body = await res.json();
  else body = await res.text();
  if (!res.ok || (body && typeof body === 'object' && (body as { ok?: boolean }).ok === false)) {
    const msg =
      (body as { error?: string; message?: string })?.error ??
      (body as { error?: string; message?: string })?.message ??
      `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return body as T;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  return jsonOrThrow<T>(res);
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  });
  return jsonOrThrow<T>(res);
}

async function patch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  });
  return jsonOrThrow<T>(res);
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(path, { method: 'DELETE' });
  return jsonOrThrow<T>(res);
}

// ---------------------------------------------------------------------------
// hermit-managed
// ---------------------------------------------------------------------------

export type HermitConfig = {
  ccBaseUrl: string;
  ccToken: string; // 脱敏显示
  ccTokenSet: boolean;
  ccBridgeUrl: string;
};

export async function getHermitConfig(): Promise<HermitConfig> {
  const r = await get<{ ok: boolean; data: HermitConfig }>('/api/hermit-config');
  return r.data;
}

export async function saveHermitConfig(patch: {
  ccBaseUrl?: string;
  ccToken?: string;
  ccBridgeUrl?: string;
}): Promise<{ ccBaseUrl: string; ccTokenSet: boolean }> {
  const r = await post<{ ok: boolean; data: { ccBaseUrl: string; ccTokenSet: boolean } }>(
    '/api/hermit-config',
    patch
  );
  return r.data;
}

export async function getStatus() {
  return get<{ ok: true; data: CcStatus }>('/api/status');
}

export async function listTeams(): Promise<Team[]> {
  // /api/teams 返回 hermit TeamSummary[],我们用其原始 manifest 形态
  // 此处在前端不依赖 TeamSummary 字段,只做轻封装。
  type Wire = {
    teamName: string;
    displayName: string;
    memberCount: number;
    members: Array<{ name: string; role: string; agentId?: string; color?: string }>;
    projectPath: string;
  };
  const list = await get<Wire[]>('/api/teams');
  // 拼装成 mvp 期望的 Team 形态(等价适配)
  return list.map((t) => ({
    schemaVersion: 1,
    slug: t.teamName,
    displayName: t.displayName,
    mode: 'managed' as const,
    rootPath: t.projectPath,
    createdAt: '',
    members: t.members.map((m) => ({
      slug: m.name,
      name: m.name,
      role: m.role,
      agentType: null,
      bindProject: m.agentId ?? null,
      workDir: '',
    })),
  }));
}

export async function createTeam(payload: {
  displayName: string;
  members: Array<{ name: string; bindProject: string; role?: string; systemPrompt?: string }>;
}) {
  const r = await post<{ ok: true; team: Team }>('/api/teams', payload);
  return r.team;
}

export async function stopTeam(slug: string) {
  return post<{ ok: true; cleared?: number }>(`/api/teams/${encodeURIComponent(slug)}/stop`);
}

export async function listGroupMessages(slug: string, limit = 200) {
  const r = await get<{ ok: true; messages: GroupMessage[] }>(
    `/api/teams/${encodeURIComponent(slug)}/messages?limit=${limit}`
  );
  return r.messages;
}

export async function listTasks(slug: string) {
  const r = await get<{ ok: true; tasks: Task[] }>(`/api/teams/${encodeURIComponent(slug)}/tasks`);
  return r.tasks;
}

export async function createTask(
  slug: string,
  body: { title: string; description?: string; assignee?: string | null; status?: Task['status'] }
) {
  const r = await post<{ ok: true; task: Task }>(
    `/api/teams/${encodeURIComponent(slug)}/tasks`,
    body
  );
  return r.task;
}

export async function patchTask(slug: string, taskId: string, body: Partial<Task>) {
  const r = await patch<{ ok: true; task: Task }>(
    `/api/teams/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(taskId)}`,
    body
  );
  return r.task;
}

export async function deleteTask(slug: string, taskId: string) {
  return del<{ ok: true }>(
    `/api/teams/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(taskId)}`
  );
}

/**
 * 群聊 SSE 发送。
 */
export function groupSend(
  slug: string,
  payload: { target: string; text: string; author?: string },
  onEvent: (event: string, data: unknown) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    void (async () => {
      let res: Response;
      try {
        res = await fetch(`/api/teams/${encodeURIComponent(slug)}/group-send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (err: unknown) {
        return reject(err instanceof Error ? err : new Error(String(err)));
      }
      if (!res.ok || !res.body) {
        try {
          const j = (await res.json()) as { error?: string };
          return reject(new Error(j.error || `${res.status}`));
        } catch {
          return reject(new Error(`${res.status} ${res.statusText}`));
        }
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let errored: Error | null = null;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split(/\n\n/);
        buf = events.pop() || '';
        for (const ev of events) {
          const lines = ev.split('\n');
          const evType = (lines.find((l) => l.startsWith('event:')) || '').slice(6).trim();
          const evData = (lines.find((l) => l.startsWith('data:')) || '').slice(5).trim();
          let data: unknown = {};
          try {
            data = JSON.parse(evData);
          } catch {
            /* keep empty */
          }
          if (!evType) continue;
          onEvent(evType, data);
          if (evType === 'error') {
            const msg = (data as { message?: string }).message ?? '上游错误';
            errored = new Error(msg);
          }
        }
      }
      if (errored) reject(errored);
      else resolve();
    })();
  });
}

// ---------------------------------------------------------------------------
// cc-connect proxy
// ---------------------------------------------------------------------------

type CcEnvelope<T> = { ok: boolean; data: T; error?: string };

async function ccGet<T>(path: string): Promise<T> {
  const r = await get<CcEnvelope<T>>(`/api/cc${path}`);
  if (!r.ok) throw new Error(r.error || 'cc-connect error');
  return r.data;
}

async function ccPost<T>(path: string, body?: unknown): Promise<T> {
  const r = await post<CcEnvelope<T>>(`/api/cc${path}`, body);
  if (!r.ok) throw new Error(r.error || 'cc-connect error');
  return r.data;
}

async function ccPatch<T>(path: string, body?: unknown): Promise<T> {
  const r = await patch<CcEnvelope<T>>(`/api/cc${path}`, body);
  if (!r.ok) throw new Error(r.error || 'cc-connect error');
  return r.data;
}

async function ccDel<T>(path: string): Promise<T> {
  const r = await del<CcEnvelope<T>>(`/api/cc${path}`);
  if (!r.ok) throw new Error(r.error || 'cc-connect error');
  return r.data;
}

export const cc = {
  getStatus: () => ccGet<CcStatus>('/status'),
  listProviders: () => ccGet<{ providers: CcProvider[] }>('/providers').then((d) => d.providers),
  createProvider: (body: CcProvider) => ccPost<CcProvider>('/providers', body),
  updateProvider: (name: string, body: Partial<CcProvider>) =>
    ccPatch<CcProvider>(`/providers/${encodeURIComponent(name)}`, body),
  deleteProvider: (name: string) => ccDel<unknown>(`/providers/${encodeURIComponent(name)}`),

  listProjects: () => ccGet<{ projects: CcProject[] }>('/projects').then((d) => d.projects),
  getProject: (name: string) => ccGet<CcProjectDetail>(`/projects/${encodeURIComponent(name)}`),
  updateProject: (name: string, body: Partial<CcProjectDetail>) =>
    ccPatch<unknown>(`/projects/${encodeURIComponent(name)}`, body),
  deleteProject: (name: string) => ccDel<unknown>(`/projects/${encodeURIComponent(name)}`),
  addPlatform: (
    name: string,
    body: {
      type: string;
      agent_type?: string;
      work_dir?: string;
      options?: Record<string, unknown>;
    }
  ) => ccPost<unknown>(`/projects/${encodeURIComponent(name)}/add-platform`, body),

  listSessions: (project: string) =>
    ccGet<{ sessions: CcSession[]; active_keys?: Record<string, string> }>(
      `/projects/${encodeURIComponent(project)}/sessions`
    ).then((d) => d.sessions ?? []),

  getSkillPresets: () =>
    ccGet<{ skills?: CcSkillPreset[] }>('/skills/presets').then((d) => d.skills ?? []),

  reload: () => ccPost<unknown>('/reload'),
  restart: () => ccPost<unknown>('/restart'),
};
