/**
 * HTTP-based implementation of ElectronAPI for browser mode.
 *
 * Replaces Electron IPC with fetch() for request/response and
 * EventSource (SSE) for real-time events. Allows the renderer
 * to run in a regular browser connected to an HTTP server.
 */

import type { CodexAccountSnapshotDto } from '@features/codex-account/contracts';
import type { DashboardRecentProjectsPayload } from '@features/recent-projects/contracts';
import type { RuntimeProviderManagementApi } from '@features/runtime-provider-management/contracts';
import type {
  AddMemberRequest,
  AddTaskCommentRequest,
  AppConfig,
  AttachmentFileData,
  BoardTaskActivityDetailResult,
  BoardTaskExactLogDetailResult,
  BoardTaskExactLogSummariesResponse,
  BoardTaskLogStreamResponse,
  BoardTaskLogStreamSummary,
  ClaudeMdFileInfo,
  ClaudeRootFolderSelection,
  ClaudeRootInfo,
  CliInstallerAPI,
  ConfigAPI,
  ContextInfo,
  ConversationGroup,
  CreateScheduleInput,
  CreateTaskRequest,
  CrossTeamAPI,
  ElectronAPI,
  FileChangeEvent,
  GlobalTask,
  HttpServerAPI,
  HttpServerStatus,
  KanbanColumnId,
  MachineProfile,
  MachineRuntimeProcess,
  MemberLogSummary,
  NotificationsAPI,
  NotificationTrigger,
  PaginatedSessionsResult,
  Project,
  ReplaceMembersRequest,
  RepositoryGroup,
  Schedule,
  ScheduleRun,
  SearchSessionsResult,
  SendMessageRequest,
  SendMessageResult,
  Session,
  SessionAPI,
  SessionDetail,
  SessionMetrics,
  SessionsByIdsOptions,
  SessionsPaginationOptions,
  SnippetDiff,
  SshAPI,
  SshConfigHostEntry,
  SshConnectionConfig,
  SshConnectionStatus,
  SshLastConnection,
  SubagentDetail,
  TaskComment,
  TeamChangeEvent,
  TeamClaudeLogsQuery,
  TeamClaudeLogsResponse,
  TeamConfig,
  TeamCreateConfigRequest,
  TeamCreateRequest,
  TeamCreateResponse,
  TeamLaunchRequest,
  TeamLaunchResponse,
  TeamMemberActivityMeta,
  TeamProvisioningModelVerificationMode,
  TeamProvisioningPrepareResult,
  TeamProvisioningProgress,
  TeamsAPI,
  TeamSummary,
  TeamTask,
  TeamTaskStatus,
  TeamTemplateSource,
  SaveLeadChannelConfigRequest,
  TeamTemplateSourcesSnapshot,
  TeamUpdateConfigRequest,
  TeamViewSnapshot,
  TriggerTestResult,
  UpdateKanbanPatch,
  UpdaterAPI,
  UpdateSchedulePatch,
  WaterfallData,
  WslClaudeRootCandidate,
} from '@shared/types';
import type {
  AgentChangeSet,
  ApplyReviewResult,
  ChangeStats,
  FileChangeWithContent,
  RejectResult,
  TaskChangeSetV2,
} from '@shared/types/review';
import type { AgentConfig } from '@shared/types/api';
import type { EditorAPI, ProjectAPI } from '@shared/types/editor';
import type { ApplyReviewRequest } from '@shared/types/review';
import type { TerminalAPI } from '@shared/types/terminal';

export class HttpAPIClient implements ElectronAPI {
  private baseUrl: string;
  private eventSource: EventSource | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- event callbacks have varying signatures
  private eventListeners = new Map<string, Set<(...args: any[]) => void>>();

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    this.initEventSource();
  }

  // ---------------------------------------------------------------------------
  // SSE event infrastructure
  // ---------------------------------------------------------------------------

  private initEventSource(): void {
    this.eventSource = new EventSource(`${this.baseUrl}/api/events`);
    this.eventSource.onopen = () => console.log('[HttpAPIClient] SSE connected');
    this.eventSource.onerror = () => {
      // Auto-reconnect is built into EventSource
      console.warn('[HttpAPIClient] SSE connection error, will reconnect...');
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- event callbacks have varying signatures
  private addEventListener(channel: string, callback: (...args: any[]) => void): () => void {
    if (!this.eventListeners.has(channel)) {
      this.eventListeners.set(channel, new Set());
      // Register SSE listener for this channel once
      this.eventSource?.addEventListener(channel, ((event: MessageEvent) => {
        const data: unknown = JSON.parse(event.data as string);
        const listeners = this.eventListeners.get(channel);
        listeners?.forEach((cb) => cb(data));
      }) as EventListener);
    }
    this.eventListeners.get(channel)!.add(callback);

    return () => {
      this.eventListeners.get(channel)?.delete(callback);
    };
  }

  // ---------------------------------------------------------------------------
  // HTTP helpers
  // ---------------------------------------------------------------------------

  /**
   * JSON reviver that converts ISO 8601 date strings back to Date objects.
   * Electron IPC preserves Date instances via structured clone, but HTTP JSON
   * serialization turns them into strings. This restores them so that
   * `.getTime()` and other Date methods work in the renderer.
   */
  // eslint-disable-next-line security/detect-unsafe-regex -- anchored pattern with bounded quantifier; no backtracking risk
  private static readonly ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z?$/;

  private static reviveDates(_key: string, value: unknown): unknown {
    if (typeof value === 'string' && HttpAPIClient.ISO_DATE_RE.test(value)) {
      const d = new Date(value);
      if (!isNaN(d.getTime())) return d;
    }
    return value;
  }

  private async parseJson<T>(res: Response): Promise<T> {
    const text = await res.text();
    if (!res.ok) {
      const parsed = JSON.parse(text) as { error?: string };
      throw new Error(parsed.error ?? `HTTP ${res.status}`);
    }
    return JSON.parse(text, (key, value) => HttpAPIClient.reviveDates(key, value)) as T;
  }

  private async get<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, { signal: controller.signal });
      return this.parseJson<T>(res);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async post<T>(path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      return this.parseJson<T>(res);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async del<T>(path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      return this.parseJson<T>(res);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async put<T>(path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      return this.parseJson<T>(res);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async patch<T>(path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      return this.parseJson<T>(res);
    } finally {
      clearTimeout(timeout);
    }
  }

  // ---------------------------------------------------------------------------
  // Core session/project APIs
  // ---------------------------------------------------------------------------

  getAppVersion = (): Promise<string> => this.get<string>('/api/version');

  getCodexAccountSnapshot = (): Promise<CodexAccountSnapshotDto> =>
    Promise.reject(new Error('Codex account bridge is unavailable in browser mode'));

  refreshCodexAccountSnapshot = (_options?: {
    includeRateLimits?: boolean;
    forceRefreshToken?: boolean;
  }): Promise<CodexAccountSnapshotDto> =>
    Promise.reject(new Error('Codex account bridge is unavailable in browser mode'));

  startCodexChatgptLogin = (): Promise<CodexAccountSnapshotDto> =>
    Promise.reject(new Error('Codex account bridge is unavailable in browser mode'));

  cancelCodexChatgptLogin = (): Promise<CodexAccountSnapshotDto> =>
    Promise.reject(new Error('Codex account bridge is unavailable in browser mode'));

  logoutCodexAccount = (): Promise<CodexAccountSnapshotDto> =>
    Promise.reject(new Error('Codex account bridge is unavailable in browser mode'));

  onCodexAccountSnapshotChanged =
    (_callback: (event: unknown, snapshot: CodexAccountSnapshotDto) => void): (() => void) =>
    () =>
      undefined;

  getDashboardRecentProjects = (): Promise<DashboardRecentProjectsPayload> =>
    this.get<DashboardRecentProjectsPayload>('/api/dashboard/recent-projects');

  getProjects = (): Promise<Project[]> => this.get<Project[]>('/api/projects');

  getSessions = (projectId: string): Promise<Session[]> =>
    this.get<Session[]>(`/api/projects/${encodeURIComponent(projectId)}/sessions`);

  getSessionsPaginated = (
    projectId: string,
    cursor: string | null,
    limit?: number,
    options?: SessionsPaginationOptions
  ): Promise<PaginatedSessionsResult> => {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    if (limit) params.set('limit', String(limit));
    if (options?.includeTotalCount === false) params.set('includeTotalCount', 'false');
    if (options?.prefilterAll === false) params.set('prefilterAll', 'false');
    if (options?.metadataLevel) params.set('metadataLevel', options.metadataLevel);
    const qs = params.toString();
    const encodedId = encodeURIComponent(projectId);
    const path = `/api/projects/${encodedId}/sessions-paginated`;
    return this.get<PaginatedSessionsResult>(qs ? `${path}?${qs}` : path);
  };

  searchSessions = (
    projectId: string,
    query: string,
    maxResults?: number
  ): Promise<SearchSessionsResult> => {
    const params = new URLSearchParams({ q: query });
    if (maxResults) params.set('maxResults', String(maxResults));
    return this.get<SearchSessionsResult>(
      `/api/projects/${encodeURIComponent(projectId)}/search?${params}`
    );
  };

  searchAllProjects = (query: string, maxResults?: number): Promise<SearchSessionsResult> => {
    const params = new URLSearchParams({ q: query });
    if (maxResults) params.set('maxResults', String(maxResults));
    return this.get<SearchSessionsResult>(`/api/search?${params}`);
  };

  getSessionDetail = (
    projectId: string,
    sessionId: string,
    options?: { bypassCache?: boolean }
  ): Promise<SessionDetail | null> => {
    const params = new URLSearchParams();
    if (options?.bypassCache) params.set('bypassCache', 'true');
    const qs = params.toString();
    const suffix = qs ? `?${qs}` : '';
    return this.get<SessionDetail | null>(
      `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}${suffix}`
    );
  };

  getSessionMetrics = (projectId: string, sessionId: string): Promise<SessionMetrics | null> =>
    this.get<SessionMetrics | null>(
      `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/metrics`
    );

  getWaterfallData = (projectId: string, sessionId: string): Promise<WaterfallData | null> =>
    this.get<WaterfallData | null>(
      `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/waterfall`
    );

  getSubagentDetail = (
    projectId: string,
    sessionId: string,
    subagentId: string,
    options?: { bypassCache?: boolean }
  ): Promise<SubagentDetail | null> => {
    const params = new URLSearchParams();
    if (options?.bypassCache) params.set('bypassCache', 'true');
    const qs = params.toString();
    const suffix = qs ? `?${qs}` : '';
    return this.get<SubagentDetail | null>(
      `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/subagents/${encodeURIComponent(subagentId)}${suffix}`
    );
  };

  getSessionGroups = (projectId: string, sessionId: string): Promise<ConversationGroup[]> =>
    this.get<ConversationGroup[]>(
      `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/groups`
    );

  getSessionsByIds = (
    projectId: string,
    sessionIds: string[],
    options?: SessionsByIdsOptions
  ): Promise<Session[]> =>
    this.post<Session[]>(`/api/projects/${encodeURIComponent(projectId)}/sessions-by-ids`, {
      sessionIds,
      metadataLevel: options?.metadataLevel,
    });

  // ---------------------------------------------------------------------------
  // Repository grouping
  // ---------------------------------------------------------------------------

  getRepositoryGroups = (): Promise<RepositoryGroup[]> =>
    this.get<RepositoryGroup[]>('/api/repository-groups');

  getWorktreeSessions = (worktreeId: string): Promise<Session[]> =>
    this.get<Session[]>(`/api/worktrees/${encodeURIComponent(worktreeId)}/sessions`);

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  validatePath = (
    relativePath: string,
    projectPath: string
  ): Promise<{ exists: boolean; isDirectory?: boolean }> =>
    this.post<{ exists: boolean; isDirectory?: boolean }>('/api/validate/path', {
      relativePath,
      projectPath,
    });

  validateMentions = (
    mentions: { type: 'path'; value: string }[],
    projectPath: string
  ): Promise<Record<string, boolean>> =>
    this.post<Record<string, boolean>>('/api/validate/mentions', { mentions, projectPath });

  // ---------------------------------------------------------------------------
  // CLAUDE.md reading
  // ---------------------------------------------------------------------------

  readClaudeMdFiles = (projectRoot: string): Promise<Record<string, ClaudeMdFileInfo>> =>
    this.post<Record<string, ClaudeMdFileInfo>>('/api/read-claude-md', { projectRoot });

  readDirectoryClaudeMd = (dirPath: string): Promise<ClaudeMdFileInfo> =>
    this.post<ClaudeMdFileInfo>('/api/read-directory-claude-md', { dirPath });

  readMentionedFile = (
    absolutePath: string,
    projectRoot: string,
    maxTokens?: number
  ): Promise<ClaudeMdFileInfo | null> =>
    this.post<ClaudeMdFileInfo | null>('/api/read-mentioned-file', {
      absolutePath,
      projectRoot,
      maxTokens,
    });

  // ---------------------------------------------------------------------------
  // Agent config reading
  // ---------------------------------------------------------------------------

  readAgentConfigs = (projectRoot: string): Promise<Record<string, AgentConfig>> =>
    this.post<Record<string, AgentConfig>>('/api/read-agent-configs', { projectRoot });

  // ---------------------------------------------------------------------------
  // Notifications (nested API)
  // ---------------------------------------------------------------------------

  notifications: NotificationsAPI = {
    get: (options) =>
      this.get(
        `/api/notifications?${new URLSearchParams(
          options
            ? {
                limit: String(options.limit ?? 20),
                offset: String(options.offset ?? 0),
              }
            : {}
        )}`
      ),
    markRead: (id) => this.post(`/api/notifications/${encodeURIComponent(id)}/read`),
    markAllRead: () => this.post('/api/notifications/read-all'),
    delete: (id) => this.del(`/api/notifications/${encodeURIComponent(id)}`),
    clear: () => this.del('/api/notifications'),
    getUnreadCount: () => this.get('/api/notifications/unread-count'),
    testNotification: async () => ({
      success: false,
      error: 'Test notifications require Electron (not available in browser mode)',
    }),
    // IPC signature: (event: unknown, error: unknown) => void
    onNew: (callback) =>
      this.addEventListener('notification:new', (data: unknown) => callback(null, data)),
    // IPC signature: (event: unknown, payload: { total; unreadCount }) => void
    onUpdated: (callback) =>
      this.addEventListener('notification:updated', (data: unknown) =>
        callback(null, data as { total: number; unreadCount: number })
      ),
    // IPC signature: (event: unknown, data: unknown) => void
    onClicked: (callback) =>
      this.addEventListener('notification:clicked', (data: unknown) => callback(null, data)),
  };

  // ---------------------------------------------------------------------------
  // Config (nested API)
  // ---------------------------------------------------------------------------

  config: ConfigAPI = {
    get: async (): Promise<AppConfig> => {
      const result = await this.get<{ success: boolean; data?: AppConfig; error?: string }>(
        '/api/config'
      );
      if (!result.success) throw new Error(result.error ?? 'Failed to get config');
      return result.data!;
    },
    update: async (section: string, data: object): Promise<AppConfig> => {
      const result = await this.post<{ success: boolean; data?: AppConfig; error?: string }>(
        '/api/config/update',
        { section, data }
      );
      if (!result.success) throw new Error(result.error ?? 'Failed to update config');
      return result.data!;
    },
    addIgnoreRegex: async (pattern: string): Promise<AppConfig> => {
      await this.post('/api/config/ignore-regex', { pattern });
      return this.config.get();
    },
    removeIgnoreRegex: async (pattern: string): Promise<AppConfig> => {
      await this.del('/api/config/ignore-regex', { pattern });
      return this.config.get();
    },
    addIgnoreRepository: async (repositoryId: string): Promise<AppConfig> => {
      await this.post('/api/config/ignore-repository', { repositoryId });
      return this.config.get();
    },
    removeIgnoreRepository: async (repositoryId: string): Promise<AppConfig> => {
      await this.del('/api/config/ignore-repository', { repositoryId });
      return this.config.get();
    },
    snooze: async (minutes: number): Promise<AppConfig> => {
      await this.post('/api/config/snooze', { minutes });
      return this.config.get();
    },
    clearSnooze: async (): Promise<AppConfig> => {
      await this.post('/api/config/clear-snooze');
      return this.config.get();
    },
    addTrigger: async (trigger): Promise<AppConfig> => {
      await this.post('/api/config/triggers', trigger);
      return this.config.get();
    },
    updateTrigger: async (triggerId: string, updates): Promise<AppConfig> => {
      await this.put(`/api/config/triggers/${encodeURIComponent(triggerId)}`, updates);
      return this.config.get();
    },
    removeTrigger: async (triggerId: string): Promise<AppConfig> => {
      await this.del(`/api/config/triggers/${encodeURIComponent(triggerId)}`);
      return this.config.get();
    },
    getTriggers: async (): Promise<NotificationTrigger[]> => {
      const result = await this.get<{ success: boolean; data?: NotificationTrigger[] }>(
        '/api/config/triggers'
      );
      return result.data ?? [];
    },
    testTrigger: async (trigger: NotificationTrigger): Promise<TriggerTestResult> => {
      const result = await this.post<{
        success: boolean;
        data?: TriggerTestResult;
        error?: string;
      }>(`/api/config/triggers/${encodeURIComponent(trigger.id)}/test`, trigger);
      if (!result.success) throw new Error(result.error ?? 'Failed to test trigger');
      return result.data!;
    },
    selectFolders: async (): Promise<string[]> => {
      console.warn('[HttpAPIClient] selectFolders is not available in browser mode');
      return [];
    },
    selectClaudeRootFolder: async (): Promise<ClaudeRootFolderSelection | null> => {
      console.warn('[HttpAPIClient] selectClaudeRootFolder is not available in browser mode');
      return null;
    },
    getClaudeRootInfo: async (): Promise<ClaudeRootInfo> => {
      const config = await this.config.get();
      const fallbackPath = config.general.claudeRootPath ?? '~/.claude';
      return {
        defaultPath: fallbackPath,
        resolvedPath: fallbackPath,
        customPath: config.general.claudeRootPath,
      };
    },
    findWslClaudeRoots: async (): Promise<WslClaudeRootCandidate[]> => {
      console.warn('[HttpAPIClient] findWslClaudeRoots is not available in browser mode');
      return [];
    },
    openInEditor: async (): Promise<void> => {
      console.warn('[HttpAPIClient] openInEditor is not available in browser mode');
    },
    pinSession: (projectId: string, sessionId: string): Promise<void> =>
      this.post('/api/config/pin-session', { projectId, sessionId }),
    unpinSession: (projectId: string, sessionId: string): Promise<void> =>
      this.post('/api/config/unpin-session', { projectId, sessionId }),
    hideSession: (projectId: string, sessionId: string): Promise<void> =>
      this.post('/api/config/hide-session', { projectId, sessionId }),
    unhideSession: (projectId: string, sessionId: string): Promise<void> =>
      this.post('/api/config/unhide-session', { projectId, sessionId }),
    hideSessions: (projectId: string, sessionIds: string[]): Promise<void> =>
      this.post('/api/config/hide-sessions', { projectId, sessionIds }),
    unhideSessions: (projectId: string, sessionIds: string[]): Promise<void> =>
      this.post('/api/config/unhide-sessions', { projectId, sessionIds }),
    addCustomProjectPath: (projectPath: string): Promise<void> =>
      this.post('/api/config/add-custom-project-path', { projectPath }),
    removeCustomProjectPath: (projectPath: string): Promise<void> =>
      this.post('/api/config/remove-custom-project-path', { projectPath }),
  };

  // ---------------------------------------------------------------------------
  // Session navigation
  // ---------------------------------------------------------------------------

  session: SessionAPI = {
    scrollToLine: (sessionId: string, lineNumber: number): Promise<void> =>
      this.post('/api/session/scroll-to-line', { sessionId, lineNumber }),
  };

  // ---------------------------------------------------------------------------
  // Zoom (browser fallbacks)
  // ---------------------------------------------------------------------------

  getZoomFactor = async (): Promise<number> => 1.0;

  onZoomFactorChanged = (_callback: (zoomFactor: number) => void): (() => void) => {
    // No-op in browser mode — zoom is managed by the browser itself
    return () => {};
  };

  // ---------------------------------------------------------------------------
  // File change events (via SSE)
  // ---------------------------------------------------------------------------

  onFileChange = (callback: (event: FileChangeEvent) => void): (() => void) =>
    this.addEventListener('file-change', callback);

  onTodoChange = (callback: (event: FileChangeEvent) => void): (() => void) =>
    this.addEventListener('todo-change', callback);

  // ---------------------------------------------------------------------------
  // Shell operations (browser fallbacks)
  // ---------------------------------------------------------------------------

  openPath = async (
    _targetPath: string,
    _projectRoot?: string
  ): Promise<{ success: boolean; error?: string }> => {
    console.warn('[HttpAPIClient] openPath is not available in browser mode');
    return { success: false, error: 'Not available in browser mode' };
  };

  showInFolder = async (_filePath: string): Promise<void> => {
    console.warn('[HttpAPIClient] showInFolder is not available in browser mode');
  };

  openExternal = async (url: string): Promise<{ success: boolean; error?: string }> => {
    window.open(url, '_blank');
    return { success: true };
  };

  windowControls = {
    minimize: async (): Promise<void> => {},
    maximize: async (): Promise<void> => {},
    close: async (): Promise<void> => {},
    isMaximized: async (): Promise<boolean> => false,
    isFullScreen: async (): Promise<boolean> => false,
    relaunch: async (): Promise<void> => {},
  };

  onFullScreenChange =
    (_callback: (isFullScreen: boolean) => void): (() => void) =>
    () => {};

  // ---------------------------------------------------------------------------
  // Updater (browser no-ops)
  // ---------------------------------------------------------------------------

  updater: UpdaterAPI = {
    check: async (): Promise<void> => {
      console.warn('[HttpAPIClient] updater not available in browser mode');
    },
    download: async (): Promise<void> => {
      console.warn('[HttpAPIClient] updater not available in browser mode');
    },
    install: async (): Promise<void> => {
      console.warn('[HttpAPIClient] updater not available in browser mode');
    },
    onStatus: (_callback): (() => void) => {
      return () => {};
    },
  };

  // ---------------------------------------------------------------------------
  // SSH
  // ---------------------------------------------------------------------------

  ssh: SshAPI = {
    connect: (config: SshConnectionConfig): Promise<SshConnectionStatus> =>
      this.post('/api/ssh/connect', config),
    disconnect: (): Promise<SshConnectionStatus> => this.post('/api/ssh/disconnect'),
    getState: (): Promise<SshConnectionStatus> => this.get('/api/ssh/state'),
    test: (config: SshConnectionConfig): Promise<{ success: boolean; error?: string }> =>
      this.post('/api/ssh/test', config),
    listMachines: async () => {
      const result = await this.get<{ success: boolean; data?: MachineProfile[] }>(
        '/api/ssh/machines'
      );
      return result.data ?? [];
    },
    saveMachine: async (profile: MachineProfile) => {
      const result = await this.post<{ success: boolean; data?: MachineProfile[] }>(
        '/api/ssh/machines',
        profile
      );
      return result.data ?? [];
    },
    removeMachine: async (machineId: string) => {
      const result = await this.del<{ success: boolean; data?: MachineProfile[] }>(
        `/api/ssh/machines/${encodeURIComponent(machineId)}`
      );
      return result.data ?? [];
    },
    checkMachine: async (machineId: string) => {
      const result = await this.post<{ success: boolean; data?: MachineProfile }>(
        `/api/ssh/machines/${encodeURIComponent(machineId)}/check`
      );
      if (!result.data) {
        throw new Error('机器健康检查没有返回数据');
      }
      return result.data;
    },
    listMachineProcesses: async (machineId: string) => {
      const result = await this.get<{ success: boolean; data?: MachineRuntimeProcess[] }>(
        `/api/ssh/machines/${encodeURIComponent(machineId)}/processes`
      );
      return result.data ?? [];
    },
    stopMachineProcess: async (machineId: string, pid: number) => {
      await this.post(`/api/ssh/machines/${encodeURIComponent(machineId)}/processes/stop`, {
        pid,
      });
    },
    getConfigHosts: async (): Promise<SshConfigHostEntry[]> => {
      const result = await this.get<{ success: boolean; data?: SshConfigHostEntry[] }>(
        '/api/ssh/config-hosts'
      );
      return result.data ?? [];
    },
    resolveHost: async (alias: string): Promise<SshConfigHostEntry | null> => {
      const result = await this.post<{
        success: boolean;
        data?: SshConfigHostEntry | null;
      }>('/api/ssh/resolve-host', { alias });
      return result.data ?? null;
    },
    saveLastConnection: (config: SshLastConnection): Promise<void> =>
      this.post('/api/ssh/save-last-connection', config),
    getLastConnection: async (): Promise<SshLastConnection | null> => {
      const result = await this.get<{ success: boolean; data?: SshLastConnection | null }>(
        '/api/ssh/last-connection'
      );
      return result.data ?? null;
    },
    // IPC signature: (event: unknown, status: SshConnectionStatus) => void
    onStatus: (callback): (() => void) =>
      this.addEventListener('ssh:status', (data: unknown) =>
        callback(null, data as SshConnectionStatus)
      ),
  };

  // ---------------------------------------------------------------------------
  // Context API
  // ---------------------------------------------------------------------------

  context = {
    list: (): Promise<ContextInfo[]> => this.get<ContextInfo[]>('/api/contexts'),
    getActive: (): Promise<string> => this.get<string>('/api/contexts/active'),
    switch: (contextId: string): Promise<{ contextId: string }> =>
      this.post<{ contextId: string }>('/api/contexts/switch', { contextId }),
    onChanged: (callback: (event: unknown, data: ContextInfo) => void): (() => void) =>
      this.addEventListener('context:changed', (data: unknown) =>
        callback(null, data as ContextInfo)
      ),
  };

  // HTTP Server API — in browser mode, server is already running (we're using it)
  httpServer: HttpServerAPI = {
    start: (): Promise<HttpServerStatus> =>
      Promise.resolve({ running: true, port: parseInt(new URL(this.baseUrl).port, 10) }),
    stop: (): Promise<HttpServerStatus> => {
      console.warn('[HttpAPIClient] Cannot stop HTTP server from browser mode');
      return Promise.resolve({ running: true, port: parseInt(new URL(this.baseUrl).port, 10) });
    },
    getStatus: (): Promise<HttpServerStatus> =>
      Promise.resolve({ running: true, port: parseInt(new URL(this.baseUrl).port, 10) }),
  };

  teams: TeamsAPI = {
    list: async (): Promise<TeamSummary[]> => this.get<TeamSummary[]>('/api/teams'),
    getData: async (teamName: string): Promise<TeamViewSnapshot> =>
      this.get<TeamViewSnapshot>(`/api/teams/${encodeURIComponent(teamName)}/data`),
    getTaskChangePresence: async (): Promise<
      Record<string, 'has_changes' | 'no_changes' | 'unknown'>
    > => {
      return {};
    },
    setChangePresenceTracking: async (): Promise<void> => {
      // Not available in browser mode — no-op.
    },
    setTaskLogStreamTracking: async (): Promise<void> => {
      // Not available in browser mode — no-op.
    },
    setToolActivityTracking: async (): Promise<void> => {
      // Not available in browser mode — no-op.
    },
    getClaudeLogs: async (
      _teamName: string,
      _query?: TeamClaudeLogsQuery
    ): Promise<TeamClaudeLogsResponse> => {
      console.warn('[HttpAPIClient] getClaudeLogs is not available in browser mode');
      return { lines: [], total: 0, hasMore: false };
    },
    deleteTeam: async (teamName: string): Promise<void> => {
      await this.del(`/api/teams/${encodeURIComponent(teamName)}`);
    },
    restoreTeam: async (teamName: string): Promise<void> => {
      await this.post(`/api/teams/${encodeURIComponent(teamName)}/restore`);
    },
    permanentlyDeleteTeam: async (teamName: string): Promise<void> => {
      await this.del(`/api/teams/${encodeURIComponent(teamName)}/permanent`);
    },
    getSavedRequest: async (_teamName: string): Promise<TeamCreateRequest | null> => {
      console.warn('[HttpAPIClient] getSavedRequest is not available in browser mode');
      return null;
    },
    deleteDraft: async (teamName: string): Promise<void> => {
      await this.del(`/api/teams/${encodeURIComponent(teamName)}/draft`);
    },
    prepareProvisioning: async (
      cwd?: string,
      providerId?: TeamLaunchRequest['providerId'],
      providerIds?: TeamLaunchRequest['providerId'][],
      selectedModels?: string[],
      limitContext?: boolean,
      modelVerificationMode?: TeamProvisioningModelVerificationMode
    ): Promise<TeamProvisioningPrepareResult> => {
      return this.post<TeamProvisioningPrepareResult>('/api/teams/provisioning/prepare', {
        cwd,
        providerId,
        providerIds,
        selectedModels,
        limitContext,
        modelVerificationMode,
      });
    },
    listTemplateSources: async (): Promise<TeamTemplateSourcesSnapshot> => {
      return this.get<TeamTemplateSourcesSnapshot>('/api/teams/templates');
    },
    saveTemplateSources: async (
      sources: TeamTemplateSource[]
    ): Promise<TeamTemplateSourcesSnapshot> => {
      return this.post<TeamTemplateSourcesSnapshot>('/api/teams/templates/save', sources);
    },
    refreshTemplateSources: async (): Promise<TeamTemplateSourcesSnapshot> => {
      return this.post<TeamTemplateSourcesSnapshot>('/api/teams/templates/refresh');
    },
    createTeam: async (request: TeamCreateRequest): Promise<TeamCreateResponse> => {
      return this.post<TeamCreateResponse>('/api/teams/create', request);
    },
    launchTeam: async (request: TeamLaunchRequest): Promise<TeamLaunchResponse> => {
      return this.post<TeamLaunchResponse>(
        `/api/teams/${encodeURIComponent(request.teamName)}/launch`,
        request
      );
    },
    getProvisioningStatus: async (runId: string): Promise<TeamProvisioningProgress> => {
      return this.get<TeamProvisioningProgress>(
        `/api/teams/provisioning/${encodeURIComponent(runId)}`
      );
    },
    cancelProvisioning: async (runId: string): Promise<void> => {
      await this.post(`/api/teams/provisioning/${encodeURIComponent(runId)}/cancel`);
    },
    sendMessage: async (
      teamName: string,
      request: SendMessageRequest
    ): Promise<SendMessageResult> =>
      this.post<SendMessageResult>(
        `/api/teams/${encodeURIComponent(teamName)}/send-message`,
        request
      ),
    getMessagesPage: async (
      teamName: string,
      opts?: { cursor?: string | null; limit?: number }
    ) => {
      const params = new URLSearchParams();
      if (opts?.cursor) params.set('cursor', opts.cursor);
      if (opts?.limit) params.set('limit', String(opts.limit));
      const qs = params.toString();
      const path = `/api/teams/${encodeURIComponent(teamName)}/messages`;
      return this.get(qs ? `${path}?${qs}` : path);
    },
    getMemberActivityMeta: async (teamName: string): Promise<TeamMemberActivityMeta> =>
      this.get<TeamMemberActivityMeta>(
        `/api/teams/${encodeURIComponent(teamName)}/member-activity`
      ),
    createTask: async (teamName: string, request: CreateTaskRequest): Promise<TeamTask> =>
      this.post<TeamTask>(`/api/teams/${encodeURIComponent(teamName)}/tasks`, request),
    requestReview: async (teamName: string, taskId: string): Promise<void> => {
      await this.post(
        `/api/teams/${encodeURIComponent(teamName)}/tasks/${encodeURIComponent(taskId)}/review`
      );
    },
    updateKanban: async (
      teamName: string,
      taskId: string,
      patch: UpdateKanbanPatch
    ): Promise<void> => {
      await this.patch(
        `/api/teams/${encodeURIComponent(teamName)}/kanban/${encodeURIComponent(taskId)}`,
        patch
      );
    },
    updateKanbanColumnOrder: async (
      teamName: string,
      columnId: KanbanColumnId,
      orderedTaskIds: string[]
    ): Promise<void> => {
      await this.put(`/api/teams/${encodeURIComponent(teamName)}/kanban/column-order`, {
        columnId,
        orderedTaskIds,
      });
    },
    updateTaskStatus: async (
      teamName: string,
      taskId: string,
      status: TeamTaskStatus
    ): Promise<void> => {
      await this.patch(
        `/api/teams/${encodeURIComponent(teamName)}/tasks/${encodeURIComponent(taskId)}/status`,
        { status }
      );
    },
    updateTaskOwner: async (
      teamName: string,
      taskId: string,
      owner: string | null
    ): Promise<void> => {
      await this.patch(
        `/api/teams/${encodeURIComponent(teamName)}/tasks/${encodeURIComponent(taskId)}/owner`,
        { owner }
      );
    },
    updateTaskFields: async (
      teamName: string,
      taskId: string,
      fields: { subject?: string; description?: string }
    ): Promise<void> => {
      await this.patch(
        `/api/teams/${encodeURIComponent(teamName)}/tasks/${encodeURIComponent(taskId)}/fields`,
        fields
      );
    },
    startTask: async (teamName: string, taskId: string): Promise<{ notifiedOwner: boolean }> =>
      this.post<{ notifiedOwner: boolean }>(
        `/api/teams/${encodeURIComponent(teamName)}/tasks/${encodeURIComponent(taskId)}/start`
      ),
    startTaskByUser: async (
      teamName: string,
      taskId: string
    ): Promise<{ notifiedOwner: boolean }> =>
      this.post<{ notifiedOwner: boolean }>(
        `/api/teams/${encodeURIComponent(teamName)}/tasks/${encodeURIComponent(taskId)}/start-by-user`
      ),
    processSend: async (teamName: string, message: string): Promise<void> => {
      await this.post(`/api/teams/${encodeURIComponent(teamName)}/process-send`, { message });
    },
    processAlive: async (_teamName: string): Promise<boolean> => {
      try {
        const alive = await this.get<string[]>('/api/teams/runtime/alive');
        return alive.includes(_teamName);
      } catch {
        return false;
      }
    },
    aliveList: async (): Promise<string[]> => this.get<string[]>('/api/teams/runtime/alive'),
    stop: async (teamName: string): Promise<void> => {
      await this.post(`/api/teams/${encodeURIComponent(teamName)}/stop`);
    },
    createConfig: async (request: TeamCreateConfigRequest): Promise<void> => {
      await this.post('/api/teams/config', request);
    },
    getMemberLogs: async (teamName: string, memberName: string): Promise<MemberLogSummary[]> => {
      return this.get<MemberLogSummary[]>(
        `/api/teams/${encodeURIComponent(teamName)}/member-logs/${encodeURIComponent(memberName)}`
      );
    },
    getLogsForTask: async (
      teamName: string,
      taskId: string,
      options?: {
        owner?: string;
        status?: string;
        intervals?: { startedAt: string; completedAt?: string }[];
        since?: string;
      }
    ): Promise<MemberLogSummary[]> => {
      const params = new URLSearchParams();
      if (options?.owner) params.set('owner', options.owner);
      if (options?.status) params.set('status', options.status);
      if (options?.intervals) params.set('intervals', JSON.stringify(options.intervals));
      if (options?.since) params.set('since', options.since);
      const qs = params.toString();
      const path = `/api/teams/${encodeURIComponent(teamName)}/task-logs/${encodeURIComponent(taskId)}`;
      return this.get(qs ? `${path}?${qs}` : path);
    },
    getTaskActivity: async (teamName: string, taskId: string) => {
      const params = new URLSearchParams();
      params.set('taskId', taskId);
      return this.get(`/api/teams/${encodeURIComponent(teamName)}/activity?${params}`);
    },
    getTaskActivityDetail: async (
      teamName: string,
      taskId: string,
      activityId: string
    ): Promise<BoardTaskActivityDetailResult> => {
      const params = new URLSearchParams();
      params.set('taskId', taskId);
      params.set('activityId', activityId);
      return this.get(`/api/teams/${encodeURIComponent(teamName)}/task-activity-detail?${params}`);
    },
    getTaskLogStreamSummary: async (
      teamName: string,
      taskId: string
    ): Promise<BoardTaskLogStreamSummary> => {
      return this.get(
        `/api/teams/${encodeURIComponent(teamName)}/task-log-stream-summary/${encodeURIComponent(taskId)}`
      );
    },
    getTaskLogStream: async (
      teamName: string,
      taskId: string
    ): Promise<BoardTaskLogStreamResponse> => {
      return this.get(
        `/api/teams/${encodeURIComponent(teamName)}/task-log-stream/${encodeURIComponent(taskId)}`
      );
    },
    getTaskExactLogSummaries: async (
      teamName: string,
      taskId: string
    ): Promise<BoardTaskExactLogSummariesResponse> => {
      return this.get(
        `/api/teams/${encodeURIComponent(teamName)}/exact-log-summaries/${encodeURIComponent(taskId)}`
      );
    },
    getTaskExactLogDetail: async (
      teamName: string,
      taskId: string,
      exactLogId: string,
      expectedSourceGeneration: string
    ): Promise<BoardTaskExactLogDetailResult> => {
      const params = new URLSearchParams();
      params.set('exactLogId', exactLogId);
      params.set('expectedSourceGeneration', expectedSourceGeneration);
      return this.get(
        `/api/teams/${encodeURIComponent(teamName)}/exact-log-detail/${encodeURIComponent(taskId)}?${params}`
      );
    },
    getMemberStats: async () => {
      console.warn('[HttpAPIClient] getMemberStats is not available in browser mode');
      return {
        linesAdded: 0,
        linesRemoved: 0,
        filesTouched: [],
        fileStats: {},
        toolUsage: {},
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        costUsd: 0,
        tasksCompleted: 0,
        messageCount: 0,
        totalDurationMs: 0,
        sessionCount: 0,
        computedAt: new Date().toISOString(),
      };
    },
    getAllTasks: async (): Promise<GlobalTask[]> => {
      console.warn('[HttpAPIClient] getAllTasks is not available in browser mode');
      return [];
    },
    updateConfig: async (
      teamName: string,
      config: TeamUpdateConfigRequest
    ): Promise<TeamConfig> => {
      return this.put(`/api/teams/${encodeURIComponent(teamName)}/config`, config);
    },
    addTaskComment: async (
      teamName: string,
      taskId: string,
      request: AddTaskCommentRequest
    ): Promise<TaskComment> => {
      return this.post(
        `/api/teams/${encodeURIComponent(teamName)}/tasks/${encodeURIComponent(taskId)}/comments`,
        request
      );
    },
    addMember: async (teamName: string, request: AddMemberRequest): Promise<void> => {
      await this.post(`/api/teams/${encodeURIComponent(teamName)}/members`, request);
    },
    replaceMembers: async (teamName: string, request: ReplaceMembersRequest): Promise<void> => {
      await this.put(`/api/teams/${encodeURIComponent(teamName)}/members`, request);
    },
    removeMember: async (teamName: string, memberName: string): Promise<void> => {
      await this.del(
        `/api/teams/${encodeURIComponent(teamName)}/members/${encodeURIComponent(memberName)}`
      );
    },
    updateMemberRole: async (
      teamName: string,
      memberName: string,
      role: string | undefined
    ): Promise<void> => {
      await this.patch(
        `/api/teams/${encodeURIComponent(teamName)}/members/${encodeURIComponent(memberName)}/role`,
        { role }
      );
    },
    getProjectBranch: async (_projectPath: string): Promise<string | null> => {
      return null;
    },
    setProjectBranchTracking: async (): Promise<void> => {
      // Not available in browser mode — no-op.
    },
    getAttachments: async (
      _teamName: string,
      _messageId: string
    ): Promise<AttachmentFileData[]> => {
      return [];
    },
    killProcess: async (teamName: string, pid: number): Promise<void> => {
      await this.post(`/api/teams/${encodeURIComponent(teamName)}/kill-process`, { pid });
    },
    getLeadActivity: async (teamName: string) => {
      return this.get(`/api/teams/${encodeURIComponent(teamName)}/lead-activity`);
    },
    getLeadContext: async (teamName: string) => {
      return this.get(`/api/teams/${encodeURIComponent(teamName)}/lead-context`);
    },
    getLeadChannel: async (teamName: string) => {
      return this.get(`/api/teams/${encodeURIComponent(teamName)}/lead-channel`);
    },
    getGlobalLeadChannel: async () => {
      return this.get('/api/teams/lead-channel/global');
    },
    saveGlobalLeadChannel: async (request: SaveLeadChannelConfigRequest) => {
      return this.post('/api/teams/lead-channel/global/save', request);
    },
    saveLeadChannel: async (teamName: string, request: SaveLeadChannelConfigRequest) => {
      return this.post(`/api/teams/${encodeURIComponent(teamName)}/lead-channel/save`, request);
    },
    startFeishuLeadChannel: async (channelId?: string) => {
      return this.post('/api/teams/lead-channel/feishu/start', { channelId });
    },
    stopFeishuLeadChannel: async (channelId?: string) => {
      return this.post('/api/teams/lead-channel/feishu/stop', { channelId });
    },
    getMemberSpawnStatuses: async () => {
      return { statuses: {}, runId: null };
    },
    getTeamAgentRuntime: async (teamName: string) => {
      return {
        teamName,
        updatedAt: new Date().toISOString(),
        runId: null,
        members: {},
      };
    },
    restartMember: async (teamName: string, memberName: string): Promise<void> => {
      await this.post(
        `/api/teams/${encodeURIComponent(teamName)}/members/${encodeURIComponent(memberName)}/restart`
      );
    },
    skipMemberForLaunch: async (teamName: string, memberName: string): Promise<void> => {
      await this.post(
        `/api/teams/${encodeURIComponent(teamName)}/members/${encodeURIComponent(memberName)}/skip`
      );
    },
    softDeleteTask: async (teamName: string, taskId: string): Promise<void> => {
      await this.del(
        `/api/teams/${encodeURIComponent(teamName)}/tasks/${encodeURIComponent(taskId)}`
      );
    },
    restoreTask: async (teamName: string, taskId: string): Promise<void> => {
      await this.post(
        `/api/teams/${encodeURIComponent(teamName)}/tasks/${encodeURIComponent(taskId)}/restore`
      );
    },
    getDeletedTasks: async (teamName: string): Promise<TeamTask[]> => {
      return this.get<TeamTask[]>(`/api/teams/${encodeURIComponent(teamName)}/deleted-tasks`);
    },
    setTaskClarification: async (
      _teamName: string,
      _taskId: string,
      _value: 'lead' | 'user' | null
    ): Promise<void> => {
      // Not available via HTTP client — no-op
    },
    showMessageNotification: async (): Promise<void> => {
      // Not available via HTTP client — native notifications require Electron
    },
    addTaskRelationship: async (
      teamName: string,
      taskId: string,
      targetId: string,
      type: 'blockedBy' | 'blocks' | 'related'
    ): Promise<void> => {
      await this.post(
        `/api/teams/${encodeURIComponent(teamName)}/tasks/${encodeURIComponent(taskId)}/relationships`,
        { targetId, type }
      );
    },
    removeTaskRelationship: async (
      teamName: string,
      taskId: string,
      targetId: string,
      type: 'blockedBy' | 'blocks' | 'related'
    ): Promise<void> => {
      await this.del(
        `/api/teams/${encodeURIComponent(teamName)}/tasks/${encodeURIComponent(taskId)}/relationships`,
        { targetId, type }
      );
    },
    saveTaskAttachment: async (
      _teamName: string,
      _taskId: string,
      _attachmentId: string,
      _filename: string,
      _mimeType: string,
      _base64Data: string
    ): Promise<never> => {
      throw new Error('Task attachments are not available in browser mode');
    },
    getTaskAttachment: async (
      _teamName: string,
      _taskId: string,
      _attachmentId: string,
      _mimeType: string
    ): Promise<string | null> => {
      return null;
    },
    deleteTaskAttachment: async (
      _teamName: string,
      _taskId: string,
      _attachmentId: string,
      _mimeType: string
    ): Promise<void> => {
      throw new Error('Task attachments are not available in browser mode');
    },
    onProjectBranchChange: (): (() => void) => {
      return () => {};
    },
    onTeamChange: (callback: (event: unknown, data: TeamChangeEvent) => void): (() => void) => {
      return this.addEventListener('team-change', (data: unknown) =>
        callback(null, data as TeamChangeEvent)
      );
    },
    onProvisioningProgress: (
      _callback: (event: unknown, data: TeamProvisioningProgress) => void
    ): (() => void) => {
      return () => {};
    },
    respondToToolApproval: async (): Promise<void> => {
      throw new Error('Tool approval not available in browser mode');
    },
    validateCliArgs: async (): Promise<never> => {
      throw new Error('CLI args validation not available in browser mode');
    },
    onToolApprovalEvent: (): (() => void) => {
      return () => {};
    },
    updateToolApprovalSettings: async (): Promise<void> => {
      console.warn('[HttpAPIClient] updateToolApprovalSettings is not available in browser mode');
    },
    readFileForToolApproval: async () => {
      throw new Error('Tool approval file read not available in browser mode');
    },
  };

  // Cross-team communication API stubs
  crossTeam: CrossTeamAPI = {
    send: async () => {
      throw new Error('Cross-team communication is not available in browser mode');
    },
    listTargets: async () => {
      console.warn('[HttpAPIClient] crossTeam.listTargets is not available in browser mode');
      return [];
    },
    getOutbox: async () => {
      console.warn('[HttpAPIClient] crossTeam.getOutbox is not available in browser mode');
      return [];
    },
  };

  // Review API
  review = {
    getAgentChanges: async (teamName: string, memberName: string) => {
      return this.get<AgentChangeSet>(
        `/api/teams/${encodeURIComponent(teamName)}/review/agent-changes/${encodeURIComponent(memberName)}`
      );
    },
    getTaskChanges: async (
      teamName: string,
      taskId: string,
      options?: {
        owner?: string;
        status?: string;
        intervals?: { startedAt: string; completedAt?: string }[];
        since?: string;
        stateBucket?: 'approved' | 'review' | 'completed' | 'active';
        summaryOnly?: boolean;
        forceFresh?: boolean;
      }
    ) => {
      const params = new URLSearchParams();
      if (options?.owner) params.set('owner', options.owner);
      if (options?.status) params.set('status', options.status);
      if (options?.since) params.set('since', options.since);
      if (options?.stateBucket) params.set('stateBucket', options.stateBucket);
      if (options?.summaryOnly) params.set('summaryOnly', 'true');
      if (options?.forceFresh) params.set('forceFresh', 'true');
      const qs = params.toString();
      const path = `/api/teams/${encodeURIComponent(teamName)}/review/task-changes/${encodeURIComponent(taskId)}`;
      return this.get<TaskChangeSetV2>(qs ? `${path}?${qs}` : path);
    },
    invalidateTaskChangeSummaries: async (): Promise<void> => {
      console.warn(
        '[HttpAPIClient] invalidateTaskChangeSummaries is not available in browser mode'
      );
    },
    getChangeStats: async (teamName: string, memberName: string) => {
      return this.get<ChangeStats>(
        `/api/teams/${encodeURIComponent(teamName)}/review/change-stats/${encodeURIComponent(memberName)}`
      );
    },
    getFileContent: async (
      teamName: string,
      memberName: string | undefined,
      filePath: string,
      _snippets: SnippetDiff[] = []
    ) => {
      const params = new URLSearchParams();
      params.set('filePath', filePath);
      if (memberName) params.set('memberName', memberName);
      return this.get<FileChangeWithContent>(
        `/api/teams/${encodeURIComponent(teamName)}/review/file-content?${params}`
      );
    },
    applyDecisions: async (request: ApplyReviewRequest) => {
      return this.post<ApplyReviewResult>(
        `/api/teams/${encodeURIComponent(request.teamName)}/review/apply-decisions`,
        request
      );
    },
    checkConflict: async (): Promise<never> => {
      throw new Error('Review conflict check is not available in browser mode');
    },
    rejectHunks: async (
      filePath: string,
      original: string,
      modified: string,
      hunkIndices: number[],
      snippets: SnippetDiff[]
    ) => {
      // TeamName not in API interface; reject-hunks endpoint requires it in URL.
      // This is a limitation in browser mode — would need teamName tracking.
      throw new Error('Review reject hunks is not available in browser mode');
    },
    rejectFile: async (filePath: string, original: string, modified: string) => {
      throw new Error('Review reject file is not available in browser mode');
    },
    previewReject: async (): Promise<never> => {
      throw new Error('Review preview reject is not available in browser mode');
    },
    saveEditedFile: async (filePath: string, content: string, projectPath?: string) => {
      return this.post<{ success: boolean }>('/api/teams/review/save-edited-file', {
        filePath,
        content,
        projectPath,
      });
    },
    watchFiles: async (): Promise<void> => {
      console.warn('[HttpAPIClient] Review file watching is not available in browser mode');
    },
    unwatchFiles: async (): Promise<void> => {
      console.warn('[HttpAPIClient] Review file watching is not available in browser mode');
    },
    onExternalFileChange: (): (() => void) => {
      return () => {};
    },
    loadDecisions: async (): Promise<never> => {
      throw new Error('Review decisions persistence is not available in browser mode');
    },
    saveDecisions: async (): Promise<never> => {
      throw new Error('Review decisions persistence is not available in browser mode');
    },
    clearDecisions: async (): Promise<never> => {
      throw new Error('Review decisions persistence is not available in browser mode');
    },
    getGitFileLog: async (): Promise<never> => {
      throw new Error('Review git file log is not available in browser mode');
    },
  };

  // ---------------------------------------------------------------------------
  // CLI Installer (not available in browser mode)
  // ---------------------------------------------------------------------------

  cliInstaller: CliInstallerAPI = {
    getStatus: async () => {
      try {
        const result = await this.get<{
          installed: boolean;
          version: string | null;
          path: string | null;
          authenticated: boolean;
        }>('/api/cli/status');
        return {
          flavor: 'claude',
          displayName: 'Agent CLI',
          supportsSelfUpdate: true,
          showVersionDetails: true,
          showBinaryPath: true,
          installed: result.installed,
          installedVersion: result.version,
          binaryPath: result.path,
          launchError: null,
          latestVersion: null,
          updateAvailable: false,
          authLoggedIn: result.authenticated,
          authStatusChecking: false,
          authMethod: null,
          providers: [],
        };
      } catch {
        return {
          flavor: 'claude',
          displayName: 'Agent CLI',
          supportsSelfUpdate: true,
          showVersionDetails: true,
          showBinaryPath: true,
          installed: false,
          installedVersion: null,
          binaryPath: null,
          launchError: null,
          latestVersion: null,
          updateAvailable: false,
          authLoggedIn: false,
          authStatusChecking: false,
          authMethod: null,
          providers: [],
        };
      }
    },
    getProviderStatus: async (): Promise<null> => null,
    verifyProviderModels: async (): Promise<null> => null,
    install: async (): Promise<void> => {
      console.warn('[HttpAPIClient] CLI installer not available in browser mode');
    },
    invalidateStatus: async (): Promise<void> => {},
    onProgress: (): (() => void) => {
      return () => {};
    },
  };

  runtimeProviderManagement: RuntimeProviderManagementApi = {
    loadView: async (input) => ({
      schemaVersion: 1,
      runtimeId: input.runtimeId,
      error: {
        code: 'runtime-unhealthy',
        message: 'Runtime provider management is not available in browser mode.',
        recoverable: true,
      },
    }),
    loadProviderDirectory: async (input) => ({
      schemaVersion: 1,
      runtimeId: input.runtimeId,
      error: {
        code: 'runtime-unhealthy',
        message: 'Runtime provider management is not available in browser mode.',
        recoverable: true,
      },
    }),
    loadSetupForm: async (input) => ({
      schemaVersion: 1,
      runtimeId: input.runtimeId,
      error: {
        code: 'runtime-unhealthy',
        message: 'Runtime provider management is not available in browser mode.',
        recoverable: true,
      },
    }),
    connectProvider: async (input) => ({
      schemaVersion: 1,
      runtimeId: input.runtimeId,
      error: {
        code: 'unsupported-action',
        message: 'Runtime provider management is not available in browser mode.',
        recoverable: true,
      },
    }),
    connectWithApiKey: async (input) => ({
      schemaVersion: 1,
      runtimeId: input.runtimeId,
      error: {
        code: 'unsupported-action',
        message: 'Runtime provider management is not available in browser mode.',
        recoverable: true,
      },
    }),
    forgetCredential: async (input) => ({
      schemaVersion: 1,
      runtimeId: input.runtimeId,
      error: {
        code: 'unsupported-action',
        message: 'Runtime provider management is not available in browser mode.',
        recoverable: true,
      },
    }),
    loadModels: async (input) => ({
      schemaVersion: 1,
      runtimeId: input.runtimeId,
      error: {
        code: 'unsupported-action',
        message: 'Runtime provider management is not available in browser mode.',
        recoverable: true,
      },
    }),
    testModel: async (input) => ({
      schemaVersion: 1,
      runtimeId: input.runtimeId,
      error: {
        code: 'unsupported-action',
        message: 'Runtime provider management is not available in browser mode.',
        recoverable: true,
      },
    }),
    setDefaultModel: async (input) => ({
      schemaVersion: 1,
      runtimeId: input.runtimeId,
      error: {
        code: 'unsupported-action',
        message: 'Runtime provider management is not available in browser mode.',
        recoverable: true,
      },
    }),
  };
  // ---------------------------------------------------------------------------
  // Terminal (not available in browser mode)
  // ---------------------------------------------------------------------------

  terminal: TerminalAPI = {
    spawn: async (): Promise<string> => {
      throw new Error('Terminal not available in browser mode');
    },
    write: () => {},
    resize: () => {},
    kill: () => {},
    onData: (): (() => void) => () => {},
    onExit: (): (() => void) => () => {},
  };

  // ---------------------------------------------------------------------------
  // Project (browser mode — delegates to HTTP)
  // ---------------------------------------------------------------------------

  project: ProjectAPI = {
    listFiles: async (projectPath: string) => {
      const params = new URLSearchParams({ root: projectPath });
      return this.get(`/api/editor/listFiles?${params}`);
    },
  };

  // ---------------------------------------------------------------------------
  // Editor (browser mode — delegates to HTTP)
  // ---------------------------------------------------------------------------

  private _editorRoot: string | null = null;

  editor: EditorAPI = {
    open: async (projectPath: string) => {
      this._editorRoot = projectPath;
    },
    close: async () => {
      this._editorRoot = null;
    },
    readDir: async (dirPath: string, maxEntries?: number) => {
      const params = new URLSearchParams({ root: this._editorRoot!, dirPath });
      if (maxEntries) params.set('maxEntries', String(maxEntries));
      return this.get(`/api/editor/readDir?${params}`);
    },
    readFile: async (filePath: string) => {
      const params = new URLSearchParams({ root: this._editorRoot!, filePath });
      return this.get(`/api/editor/readFile?${params}`);
    },
    writeFile: async (filePath: string, content: string, baselineMtimeMs?: number) => {
      return this.post('/api/editor/writeFile', {
        root: this._editorRoot,
        filePath,
        content,
        baselineMtimeMs,
      });
    },
    createFile: async (parentDir: string, fileName: string) => {
      return this.post('/api/editor/createFile', {
        root: this._editorRoot,
        parentDir,
        fileName,
      });
    },
    createDir: async (parentDir: string, dirName: string) => {
      return this.post('/api/editor/createDir', {
        root: this._editorRoot,
        parentDir,
        dirName,
      });
    },
    deleteFile: async (filePath: string) => {
      return this.post('/api/editor/deleteFile', {
        root: this._editorRoot,
        filePath,
      });
    },
    moveFile: async (sourcePath: string, destDir: string) => {
      return this.post('/api/editor/moveFile', {
        root: this._editorRoot,
        sourcePath,
        destDir,
      });
    },
    renameFile: async (sourcePath: string, newName: string) => {
      return this.post('/api/editor/renameFile', {
        root: this._editorRoot,
        sourcePath,
        newName,
      });
    },
    searchInFiles: async (options) => {
      const params = new URLSearchParams({ root: this._editorRoot!, query: options.query });
      if (options.caseSensitive) params.set('caseSensitive', 'true');
      if (options.maxFiles) params.set('maxFiles', String(options.maxFiles));
      if (options.maxMatches) params.set('maxMatches', String(options.maxMatches));
      return this.get(`/api/editor/search?${params}`);
    },
    listFiles: async () => {
      const params = new URLSearchParams({ root: this._editorRoot! });
      return this.get(`/api/editor/listFiles?${params}`);
    },
    readBinaryPreview: async (filePath: string) => {
      const params = new URLSearchParams({ root: this._editorRoot!, filePath });
      return this.get(`/api/editor/readBinaryPreview?${params}`);
    },
    gitStatus: async () => {
      const params = new URLSearchParams({ root: this._editorRoot! });
      return this.get(`/api/editor/gitStatus?${params}`);
    },
    watchDir: async (): Promise<void> => {
      // File watching not supported in browser mode
    },
    setWatchedFiles: async (): Promise<void> => {
      // File watching not supported in browser mode
    },
    setWatchedDirs: async (): Promise<void> => {
      // File watching not supported in browser mode
    },
    onEditorChange: () => {
      return () => {};
    },
  };

  schedules: ElectronAPI['schedules'] = {
    list: async () => {
      console.warn('Schedules not available in browser mode');
      return [] as Schedule[];
    },
    get: async (_id: string): Promise<Schedule | null> => {
      console.warn('Schedules not available in browser mode');
      return null;
    },
    create: async (_input: CreateScheduleInput): Promise<Schedule> => {
      throw new Error('Schedules not available in browser mode');
    },
    update: async (_id: string, _patch: UpdateSchedulePatch): Promise<Schedule> => {
      throw new Error('Schedules not available in browser mode');
    },
    delete: async (_id: string): Promise<void> => {
      throw new Error('Schedules not available in browser mode');
    },
    pause: async (_id: string): Promise<void> => {
      throw new Error('Schedules not available in browser mode');
    },
    resume: async (_id: string): Promise<void> => {
      throw new Error('Schedules not available in browser mode');
    },
    triggerNow: async (_id: string): Promise<ScheduleRun> => {
      throw new Error('Schedules not available in browser mode');
    },
    getRuns: async (
      _scheduleId: string,
      _opts?: { limit?: number; offset?: number }
    ): Promise<ScheduleRun[]> => {
      console.warn('Schedules not available in browser mode');
      return [] as ScheduleRun[];
    },
    getRunLogs: async (
      _scheduleId: string,
      _runId: string
    ): Promise<{ stdout: string; stderr: string }> => {
      console.warn('Schedules not available in browser mode');
      return { stdout: '', stderr: '' };
    },
    onScheduleChange: (): (() => void) => {
      return () => {};
    },
  };

  getPathForFile = (_file: File): string => '';
}
