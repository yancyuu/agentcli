/**
 * Worker Society — 前端 API 客户端。
 *
 * 自包含的 fetch 封装，按 hermit httpClient 同款约定（baseUrl + /api/society/* 路径、
 * JSON 错误透传成异常）。刻意不耦合到庞大的 HttpAPIClient：society 是独立可演进的功能切片，
 * 这里的 client 可在 SocietyView / store 中直接复用，也可被任意 baseUrl 指向的实例调用。
 *
 * 路由形状严格对齐 main/adapters/input/societyRoutes.ts。
 */
import type { PublishedNeed, Relationship, WorkerProfile } from '../core/domain/models/society';
import type { SocialMessageRecord } from '../main/infrastructure/crossTeamMessageGateway';

/** 逗号分隔的 skill 字符串 → AgentCapability[]（与 MCP 层 csvSkills 同语义）。 */
function csvToCapabilities(value?: string): { skill: string; description: string }[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((skill) => ({ skill, description: skill }));
}

/** 逗号分隔 → 去空字符串数组。 */
function csvToArray(value?: string): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface RegisterWorkerInput {
  workerId: string;
  name: string;
  capabilities?: string;
  interests?: string;
  reputation?: number;
  maxConcurrent?: number;
  description?: string;
}

export interface PublishNeedInput {
  postedBy: string;
  subject: string;
  requiredCapabilities?: string;
  description?: string;
  priority?: number;
  deadline?: string;
}

export interface SocietyApiClient {
  listWorkers(): Promise<WorkerProfile[]>;
  registerWorker(input: RegisterWorkerInput): Promise<WorkerProfile>;
  getWorker(workerId: string): Promise<WorkerProfile | null>;
  listOpenNeeds(): Promise<PublishedNeed[]>;
  listActiveNeeds(): Promise<PublishedNeed[]>;
  listAllNeeds(): Promise<PublishedNeed[]>;
  publishNeed(input: PublishNeedInput): Promise<PublishedNeed>;
  volunteer(needId: string, workerId: string): Promise<unknown>;
  selectAssignee(needId: string): Promise<unknown>;
  startNeed(needId: string, workerId: string): Promise<unknown>;
  deliverNeed(needId: string, result: string): Promise<unknown>;
  acceptDelivery(needId: string): Promise<unknown>;
  cancelNeed(needId: string): Promise<unknown>;
  listRelationships(): Promise<Relationship[]>;
  sendMessage(fromWorker: string, toWorker: string, text: string): Promise<unknown>;
  getFeed(): Promise<SocialMessageRecord[]>;
  runAutonomyTick(): Promise<{ ok: boolean; applied: number }>;
  autoSelectPending(): Promise<{ ok: boolean; selected: number }>;
}

/** 非 2xx → 抛出 {error}（或兜底 HTTP 文案）；2xx 空体 → undefined。 */
async function parseResponse<T>(res: Response): Promise<T> {
  const body = await res.text();
  if (!res.ok) {
    if (!body.trim()) throw new Error(`HTTP ${res.status}`);
    try {
      const parsed = JSON.parse(body) as { error?: string };
      throw new Error(parsed.error ?? `HTTP ${res.status}`);
    } catch (e) {
      if (e instanceof SyntaxError) throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
      throw e;
    }
  }
  if (!body.trim()) return undefined as unknown as T;
  return JSON.parse(body) as T;
}

/**
 * 构造一个 society API 客户端。
 * @param baseUrl 服务基地址；浏览器同源时可传空串（路径相对解析）。
 */
export function createSocietyApi(baseUrl: string = ''): SocietyApiClient {
  const get = <T>(path: string): Promise<T> =>
    fetch(`${baseUrl}${path}`).then((r) => parseResponse<T>(r));
  const post = <T>(path: string, body?: unknown): Promise<T> =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then((r) => parseResponse<T>(r));

  const needPath = (needId: string, action: string): string =>
    `/api/society/needs/${encodeURIComponent(needId)}/${action}`;

  return {
    listWorkers: () => get<WorkerProfile[]>('/api/society/workers'),
    registerWorker: (input) =>
      post<WorkerProfile>('/api/society/workers/register', {
        workerId: input.workerId,
        name: input.name,
        capabilities: csvToCapabilities(input.capabilities),
        interests: input.interests ? csvToArray(input.interests) : undefined,
        reputation: input.reputation,
        maxConcurrent: input.maxConcurrent,
        description: input.description,
      }),
    getWorker: (workerId) =>
      get<WorkerProfile | null>(`/api/society/workers/${encodeURIComponent(workerId)}`),
    listOpenNeeds: () => get<PublishedNeed[]>('/api/society/needs/open'),
    listActiveNeeds: () => get<PublishedNeed[]>('/api/society/needs/active'),
    listAllNeeds: () => get<PublishedNeed[]>('/api/society/needs'),
    publishNeed: (input) =>
      post<PublishedNeed>('/api/society/needs', {
        postedBy: input.postedBy,
        subject: input.subject,
        description: input.description,
        requiredCapabilities: csvToArray(input.requiredCapabilities),
        priority: input.priority,
        deadline: input.deadline,
      }),
    volunteer: (needId, workerId) => post(needPath(needId, 'volunteer'), { workerId }),
    selectAssignee: (needId) => post(needPath(needId, 'select')),
    startNeed: (needId, workerId) => post(needPath(needId, 'start'), { workerId }),
    deliverNeed: (needId, result) => post(needPath(needId, 'deliver'), { result }),
    acceptDelivery: (needId) => post(needPath(needId, 'accept')),
    cancelNeed: (needId) => post(needPath(needId, 'cancel')),
    listRelationships: () => get<Relationship[]>('/api/society/relationships'),
    sendMessage: (fromWorker, toWorker, text) =>
      post('/api/society/messages', { fromWorker, toWorker, text }),
    getFeed: () => get<SocialMessageRecord[]>('/api/society/feed'),
    runAutonomyTick: () => post<{ ok: boolean; applied: number }>('/api/society/autonomy/tick'),
    autoSelectPending: () =>
      post<{ ok: boolean; selected: number }>('/api/society/autonomy/auto-select'),
  };
}
