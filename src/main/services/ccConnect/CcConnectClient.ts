/**
 * CcConnectClient — HTTP client for cc-connect Management API.
 *
 * Wraps all /api/v1/* endpoints needed by Hermit's team management layer.
 * Default target: http://127.0.0.1:9820
 */

import { createLogger } from '@shared/utils/logger';

import type {
  CcAddPlatformRequest,
  CcApiResponse,
  CcConnectConfig,
  CcCreateCronJobRequest,
  CcCronJob,
  CcGlobalProvider,
  CcHeartbeatStatus,
  CcModelEntry,
  CcProjectDetail,
  CcProjectListItem,
  CcProjectSettingsUpdate,
  CcProviderPresetsResponse,
  CcSessionDetail,
  CcSessionListItem,
  CcStatus,
} from '@shared/types/ccConnect';
import { CC_CONNECT_DEFAULTS } from '@shared/types/ccConnect';

const logger = createLogger('CcConnectClient');

export class CcConnectClient {
  private baseUrl: string;
  private token: string;
  private readonly timeoutMs: number;

  constructor(config?: Partial<CcConnectConfig>) {
    this.baseUrl = (
      config?.baseUrl ??
      process.env.CC_CONNECT_BASE_URL ??
      CC_CONNECT_DEFAULTS.baseUrl
    ).replace(/\/+$/, '');
    this.token = (
      config?.token ??
      process.env.CC_CONNECT_TOKEN ??
      process.env.CC_CONNECT_MANAGEMENT_TOKEN ??
      ''
    ).trim();
    this.timeoutMs = 15_000;
  }

  // ===========================================================================
  // Internal helpers
  // ===========================================================================

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: this.buildHeaders(),
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const text = await response.text();
      if (!text.trim()) {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return undefined as T;
      }

      let json: CcApiResponse<T>;
      try {
        json = JSON.parse(text) as CcApiResponse<T>;
      } catch {
        throw new Error(`cc-connect returned non-JSON: ${text.slice(0, 200)}`);
      }

      if (!response.ok || json.ok === false) {
        throw new Error(json.error ?? `HTTP ${response.status}: ${text.slice(0, 200)}`);
      }

      return (json.data ?? json) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  // ===========================================================================
  // Status
  // ===========================================================================

  async getStatus(): Promise<CcStatus> {
    return this.request<CcStatus>('GET', '/api/v1/status');
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.getStatus();
      return true;
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // Projects
  // ===========================================================================

  async listProjects(): Promise<CcProjectListItem[]> {
    const data = await this.request<{ projects: CcProjectListItem[] }>('GET', '/api/v1/projects');
    return data.projects ?? [];
  }

  async getProject(name: string): Promise<CcProjectDetail> {
    return this.request<CcProjectDetail>('GET', `/api/v1/projects/${encodeURIComponent(name)}`);
  }

  async updateProject(
    name: string,
    settings: CcProjectSettingsUpdate
  ): Promise<{ message: string; restart_required: boolean }> {
    return this.request('PATCH', `/api/v1/projects/${encodeURIComponent(name)}`, settings);
  }

  async deleteProject(name: string): Promise<{ message: string; restart_required: boolean }> {
    return this.request('DELETE', `/api/v1/projects/${encodeURIComponent(name)}`);
  }

  /**
   * Stop a project: delete it from cc-connect and restart to activate changes.
   * This effectively stops all sessions and agents for the project.
   */
  async stopProject(name: string): Promise<void> {
    try {
      const result = await this.deleteProject(name);
      if (result.restart_required) {
        await this.restart();
      }
      logger.info(`cc-connect project "${name}" stopped`);
    } catch (err) {
      // Project might already not exist — log but don't throw
      logger.warn(
        `Failed to stop project "${name}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Create a new project by adding a platform.
   * If the project doesn't exist, cc-connect creates it automatically.
   * Requires a restart afterwards for the new engine to start.
   */
  async createProject(
    name: string,
    agentType: string,
    workDir: string,
    platformType: string = 'bridge',
    platformOptions: Record<string, string> = {}
  ): Promise<{ message: string; restart_required: boolean }> {
    const body: CcAddPlatformRequest = {
      type: platformType,
      options: platformOptions,
      work_dir: workDir,
      agent_type: agentType,
    };
    return this.request('POST', `/api/v1/projects/${encodeURIComponent(name)}/add-platform`, body);
  }

  // ===========================================================================
  // Restart / Reload
  // ===========================================================================

  async restart(): Promise<void> {
    await this.request('POST', '/api/v1/restart', {});
    logger.info('cc-connect restart triggered');
  }

  async reload(): Promise<void> {
    await this.request('POST', '/api/v1/reload', {});
  }

  /**
   * Create project and restart cc-connect to activate it.
   * Convenience wrapper around createProject + restart.
   */
  async createProjectAndStart(
    name: string,
    agentType: string,
    workDir: string,
    platformType: string = 'bridge',
    platformOptions: Record<string, string> = {}
  ): Promise<void> {
    const result = await this.createProject(
      name,
      agentType,
      workDir,
      platformType,
      platformOptions
    );
    if (result.restart_required) {
      await this.restart();
    }
  }

  // ===========================================================================
  // Messages
  // ===========================================================================

  async sendMessage(projectName: string, sessionKey: string, message: string): Promise<void> {
    await this.request('POST', `/api/v1/projects/${encodeURIComponent(projectName)}/send`, {
      session_key: sessionKey,
      message,
    });
  }

  // ===========================================================================
  // Sessions
  // ===========================================================================

  async listSessions(projectName: string): Promise<CcSessionListItem[]> {
    const data = await this.request<{ sessions: CcSessionListItem[] }>(
      'GET',
      `/api/v1/projects/${encodeURIComponent(projectName)}/sessions`
    );
    return data.sessions ?? [];
  }

  async getSession(
    projectName: string,
    sessionId: string,
    historyLimit: number = 500
  ): Promise<CcSessionDetail> {
    return this.request<CcSessionDetail>(
      'GET',
      `/api/v1/projects/${encodeURIComponent(projectName)}/sessions/${encodeURIComponent(sessionId)}?history_limit=${historyLimit}`
    );
  }

  async createSession(
    projectName: string,
    name?: string,
    sessionKey?: string
  ): Promise<CcSessionDetail> {
    const body: Record<string, string> = {};
    if (name) body.name = name;
    if (sessionKey) body.session_key = sessionKey;
    return this.request<CcSessionDetail>(
      'POST',
      `/api/v1/projects/${encodeURIComponent(projectName)}/sessions`,
      body
    );
  }

  async deleteSession(projectName: string, sessionId: string): Promise<void> {
    await this.request(
      'DELETE',
      `/api/v1/projects/${encodeURIComponent(projectName)}/sessions/${encodeURIComponent(sessionId)}`
    );
  }

  // ===========================================================================
  // Heartbeat
  // ===========================================================================

  async getHeartbeat(projectName: string): Promise<CcHeartbeatStatus> {
    return this.request<CcHeartbeatStatus>(
      'GET',
      `/api/v1/projects/${encodeURIComponent(projectName)}/heartbeat`
    );
  }

  async pauseHeartbeat(projectName: string): Promise<void> {
    await this.request(
      'POST',
      `/api/v1/projects/${encodeURIComponent(projectName)}/heartbeat/pause`,
      {}
    );
  }

  async resumeHeartbeat(projectName: string): Promise<void> {
    await this.request(
      'POST',
      `/api/v1/projects/${encodeURIComponent(projectName)}/heartbeat/resume`,
      {}
    );
  }

  // ===========================================================================
  // Providers
  // ===========================================================================

  async listProviders(): Promise<CcGlobalProvider[]> {
    const data = await this.request<{ providers: CcGlobalProvider[] }>('GET', '/api/v1/providers');
    return data.providers ?? [];
  }

  async getProviderPresets(): Promise<CcProviderPresetsResponse> {
    return this.request<CcProviderPresetsResponse>('GET', '/api/v1/providers/presets');
  }

  async addProvider(provider: CcGlobalProvider): Promise<{ name: string; message: string }> {
    return this.request('POST', '/api/v1/providers', provider);
  }

  async updateProvider(
    name: string,
    patch: Partial<CcGlobalProvider>
  ): Promise<{ message: string }> {
    return this.request('PUT', `/api/v1/providers/${encodeURIComponent(name)}`, patch);
  }

  async deleteProvider(name: string): Promise<{ message: string }> {
    return this.request('DELETE', `/api/v1/providers/${encodeURIComponent(name)}`);
  }

  // ===========================================================================
  // Models
  // ===========================================================================

  async listModels(projectName: string): Promise<CcModelEntry[]> {
    const data = await this.request<{ models: CcModelEntry[] }>(
      'GET',
      `/api/v1/projects/${encodeURIComponent(projectName)}/models`
    );
    return data.models ?? [];
  }

  // ===========================================================================
  // Provider References (per-project)
  // ===========================================================================

  async getProviderRefs(projectName: string): Promise<string[]> {
    const data = await this.request<{ provider_refs: string[] }>(
      'GET',
      `/api/v1/projects/${encodeURIComponent(projectName)}/provider-refs`
    );
    return data.provider_refs ?? [];
  }

  async setProviderRefs(projectName: string, providerRefs: string[]): Promise<void> {
    await this.request('PUT', `/api/v1/projects/${encodeURIComponent(projectName)}/provider-refs`, {
      provider_refs: providerRefs,
    });
  }

  // ===========================================================================
  // Global settings
  // ===========================================================================

  async getGlobalSettings(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('GET', '/api/v1/settings');
  }

  async patchGlobalSettings(patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('PATCH', '/api/v1/settings', patch);
  }

  // ===========================================================================
  // Cron jobs
  // ===========================================================================

  async listCronJobs(): Promise<CcCronJob[]> {
    const data = await this.request<{ jobs: CcCronJob[] }>('GET', '/api/v1/cron');
    return data.jobs ?? [];
  }

  async createCronJob(input: CcCreateCronJobRequest): Promise<CcCronJob> {
    return this.request<CcCronJob>('POST', '/api/v1/cron', input);
  }

  async updateCronJob(
    id: string,
    patch: Partial<CcCreateCronJobRequest> & { enabled?: boolean }
  ): Promise<CcCronJob> {
    return this.request<CcCronJob>('PATCH', `/api/v1/cron/${encodeURIComponent(id)}`, patch);
  }

  async deleteCronJob(id: string): Promise<void> {
    await this.request('DELETE', `/api/v1/cron/${encodeURIComponent(id)}`);
  }

  // ===========================================================================
  // Configuration update
  // ===========================================================================

  updateConfig(config: Partial<CcConnectConfig>): void {
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    }
    if (config.token !== undefined) {
      this.token = config.token.trim();
    }
  }
}
