/**
 * Renderer API client for cc-connect /api/v1/providers endpoints.
 *
 * Hermit intentionally does not keep a local providers fallback. The
 * cc-connect sidecar is the source of truth for provider/channel management.
 */

import type {
  CCSwitchListResponse,
  GlobalProvider,
  ProviderPresetsResponse,
} from '@shared/types/providers';

function stringifyProviderPatch(patch: Partial<GlobalProvider>): string {
  return JSON.stringify(patch, (_key, value: unknown) => (value === undefined ? null : value));
}

function getBaseUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const explicitPort = params.get('port');
  if (explicitPort) return `http://127.0.0.1:${parseInt(explicitPort, 10)}`;
  const backendPort = 5680;
  if (window.location.port && window.location.port !== String(backendPort)) {
    return `http://127.0.0.1:${backendPort}`;
  }
  return window.location.origin;
}

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init?.timeoutMs ?? 15_000);
  try {
    const res = await fetch(`${getBaseUrl()}/api/v1${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    });

    // Guard against non-JSON responses (e.g. HTML 404 pages from cc-connect)
    const contentType = res.headers.get('content-type') ?? '';
    const text = await res.text();
    if (!contentType.includes('json') || !text.trim().startsWith('{')) {
      throw new Error(
        `Provider API ${path} 返回了非 JSON 响应 (HTTP ${res.status})。` +
        '请检查 cc-connect 是否正在运行且支持该端点。'
      );
    }

    let json: { ok?: boolean; data?: T; error?: string };
    try {
      json = JSON.parse(text) as typeof json;
    } catch (e) {
      throw new Error(`Provider API ${path} 返回了无效 JSON: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (!res.ok || json.ok === false) {
      throw new Error(json.error ?? `HTTP ${res.status}`);
    }
    return (json.data ?? json) as T;
  } finally {
    clearTimeout(timer);
  }
}

export const providersApi = {
  list(): Promise<{ providers: GlobalProvider[] }> {
    return request('/providers');
  },
  add(provider: GlobalProvider): Promise<{ name: string; message: string }> {
    return request('/providers', { method: 'POST', body: JSON.stringify(provider) });
  },
  update(name: string, patch: Partial<GlobalProvider>): Promise<{ message: string }> {
    return request(`/providers/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: stringifyProviderPatch(patch),
    });
  },
  remove(name: string): Promise<{ message: string }> {
    return request(`/providers/${encodeURIComponent(name)}`, { method: 'DELETE' });
  },
  fetchPresets(options: { forceRefresh?: boolean } = {}): Promise<ProviderPresetsResponse> {
    return request(`/providers/presets${options.forceRefresh ? '?refresh=1' : ''}`, {
      timeoutMs: 20_000,
    });
  },
  listCCSwitch(): Promise<CCSwitchListResponse> {
    return request('/providers/cc-switch');
  },
  importCCSwitch(names: string[]): Promise<{ imported: string[]; skipped: string[] }> {
    return request('/providers/cc-switch', {
      method: 'POST',
      body: JSON.stringify({ names }),
    });
  },
};
