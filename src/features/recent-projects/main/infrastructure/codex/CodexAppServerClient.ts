// ---------------------------------------------------------------------------
// Inline type stubs for deleted codexAppServer module
// ---------------------------------------------------------------------------

/** Minimal stub for the deleted JsonRpcSession interface */
interface JsonRpcSession {
  request<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>;
  notify(method: string, params?: unknown): Promise<void>;
}

/** Minimal stub for the deleted JsonRpcStdioClient interface */
interface JsonRpcStdioClient {
  withSession<T>(
    options: {
      binaryPath: string;
      args: string[];
      requestTimeoutMs: number;
      totalTimeoutMs: number;
      label: string;
    },
    handler: (session: JsonRpcSession) => Promise<T>
  ): Promise<T>;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 3_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 8_000;
const DEFAULT_INITIALIZE_TIMEOUT_MS = 6_000;
const MIN_SESSION_OVERHEAD_TIMEOUT_MS = 1_500;
const SUPPRESSED_NOTIFICATION_METHODS = [
  'thread/started',
  'thread/status/changed',
  'thread/archived',
  'thread/unarchived',
  'thread/closed',
  'thread/name/updated',
  'turn/started',
  'turn/completed',
  'item/agentMessage/delta',
  'item/agentReasoning/delta',
  'item/execCommandOutputDelta',
];

interface ThreadListResponse {
  data?: CodexThreadSummary[];
}

interface CodexGitInfo {
  branch?: string | null;
  originUrl?: string | null;
  sha?: string | null;
}

export interface CodexThreadSummary {
  id: string;
  createdAt?: number;
  updatedAt?: number;
  cwd?: string | null;
  source?: unknown;
  modelProvider?: string | null;
  gitInfo?: CodexGitInfo | null;
  name?: string | null;
  path?: string | null;
}

export interface CodexThreadSegmentResult {
  threads: CodexThreadSummary[];
  error?: string;
  skipped?: boolean;
}

export interface CodexRecentThreadsResult {
  live: CodexThreadSegmentResult;
  archived: CodexThreadSegmentResult;
}

interface ThreadListSessionOptions {
  binaryPath: string;
  requestTimeoutMs: number;
  initializeTimeoutMs: number;
  totalTimeoutMs: number;
  label: string;
}

export class CodexAppServerClient {
  constructor(private readonly rpcClient: JsonRpcStdioClient) {}

  async listRecentLiveThreads(
    _binaryPath: string,
    _options: {
      limit: number;
      requestTimeoutMs?: number;
      initializeTimeoutMs?: number;
      totalTimeoutMs?: number;
    }
  ): Promise<CodexThreadSegmentResult> {
    // Codex app server module has been removed — return empty results
    return { threads: [] };
  }

  async listRecentThreads(
    _binaryPath: string,
    _options: {
      limit: number;
      liveRequestTimeoutMs?: number;
      archivedRequestTimeoutMs?: number;
      initializeTimeoutMs?: number;
      totalTimeoutMs?: number;
    }
  ): Promise<CodexRecentThreadsResult> {
    // Codex app server module has been removed — return empty results
    return {
      live: { threads: [] },
      archived: { threads: [] },
    };
  }
}
