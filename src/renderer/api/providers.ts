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
    const json = (await res.json()) as { ok?: boolean; data?: T; error?: string };
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
      body: JSON.stringify(patch),
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
