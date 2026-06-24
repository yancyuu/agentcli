/**
 * AiMonitorUsageClient — read-only clients for the AI Monitor server endpoints
 * beyond the upload pipeline: authoritative usage ledger, batch-status queries,
 * current-session upload summary, and event pre-check.
 *
 * All calls go through OpenHermitAuthClient.authedFetch so they survive token
 * expiry (proactive refresh via getValidBearerToken + reactive 401 retry). Every
 * method is best-effort: on any failure it returns null/[] so callers (CLI status
 * views) degrade gracefully instead of crashing the worker.
 *
 * NOTE on /events/check: implemented for protocol completeness and tests, but
 * intentionally NOT wired into the upload flow — the server-authoritative cursor
 * (read from /usage/status) already scopes each scan to new messages, and the
 * server dedups by eventId, so a pre-check round-trip adds cost without benefit.
 */
import { authedFetch, getValidBearerToken } from '@main/services/auth/OpenHermitAuthClient';

const TIMEOUT_MS = 8_000;

export interface AuthoritativeUsage {
  totals?: {
    tokens?: number;
    messages?: number;
    batches?: number;
    duplicated?: number;
    rejected?: number;
  };
  [key: string]: unknown;
}

export interface UploadStatusItem {
  ok?: boolean;
  uploadId?: string;
  status?: string | null;
  duplicated?: boolean;
  errorCode?: string | null;
  [key: string]: unknown;
}

export interface UploadsSummary {
  batches?: number;
  received?: number;
  accepted?: number;
  inserted?: number;
  duplicated?: number;
  rejected?: number;
  failedEvents?: number;
  [key: string]: unknown;
}

export interface EventsCheckResult {
  eventId?: string;
  known?: boolean;
  status?: string | null;
  uploadId?: string | null;
  duplicated?: boolean;
  errorCode?: string | null;
  [key: string]: unknown;
}

function apiUrl(baseUrl: string, apiPath: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${apiPath}`;
}

async function authedInit(home: string, baseUrl: string, init: RequestInit): Promise<RequestInit> {
  const token = await getValidBearerToken(home, baseUrl);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return { ...init, headers, signal: init.signal ?? AbortSignal.timeout(TIMEOUT_MS) };
}

async function parseJsonObject(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await res.text()) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** GET /api/v1/hermit/usage — server-side authoritative token/message/batch ledger. */
export async function fetchAuthoritativeUsage(
  home: string,
  baseUrl: string
): Promise<AuthoritativeUsage | null> {
  const res = await authedFetch(
    home,
    baseUrl,
    apiUrl(baseUrl, '/api/v1/hermit/usage'),
    await authedInit(home, baseUrl, {})
  );
  if (!res.ok) return null;
  return (await parseJsonObject(res)) as AuthoritativeUsage | null;
}

/** POST /api/v1/hermit/uploads/status — batch query by uploadIds (no item detail). */
export async function fetchUploadsStatus(
  home: string,
  baseUrl: string,
  uploadIds: string[]
): Promise<UploadStatusItem[]> {
  if (uploadIds.length === 0) return [];
  const res = await authedFetch(
    home,
    baseUrl,
    apiUrl(baseUrl, '/api/v1/hermit/uploads/status'),
    await authedInit(home, baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadIds }),
    })
  );
  if (!res.ok) return [];
  const body = await parseJsonObject(res);
  return Array.isArray(body?.items) ? (body.items as UploadStatusItem[]) : [];
}

/** GET /api/v1/hermit/uploads/summary — current Bearer session upload aggregate. */
export async function fetchUploadsSummary(
  home: string,
  baseUrl: string
): Promise<UploadsSummary | null> {
  const res = await authedFetch(
    home,
    baseUrl,
    apiUrl(baseUrl, '/api/v1/hermit/uploads/summary'),
    await authedInit(home, baseUrl, {})
  );
  if (!res.ok) return null;
  return (await parseJsonObject(res)) as UploadsSummary | null;
}

/**
 * POST /api/v1/hermit/events/check — report which eventIds the server already
 * knows. Implemented + tested for protocol completeness; NOT used by the upload
 * flow (cursor-based scoping + server dedup make it redundant).
 */
export async function checkEvents(
  home: string,
  baseUrl: string,
  eventIds: string[]
): Promise<EventsCheckResult[]> {
  if (eventIds.length === 0) return [];
  const res = await authedFetch(
    home,
    baseUrl,
    apiUrl(baseUrl, '/api/v1/hermit/events/check'),
    await authedInit(home, baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventIds }),
    })
  );
  if (!res.ok) return [];
  const body = await parseJsonObject(res);
  return Array.isArray(body?.items) ? (body.items as EventsCheckResult[]) : [];
}
