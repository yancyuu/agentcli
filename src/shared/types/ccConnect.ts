/**
 * cc-connect Management API types.
 *
 * These types mirror the JSON shapes returned by cc-connect's
 * Management API (default: http://127.0.0.1:9820/api/v1/*).
 */

// =============================================================================
// Common
// =============================================================================

export interface CcApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

// =============================================================================
// Status
// =============================================================================

export interface CcStatus {
  version: string;
  uptime_seconds: number;
  projects_count: number;
  platforms_connected: number;
}

// =============================================================================
// Projects
// =============================================================================

export type CcAgentType =
  | 'claudecode'
  | 'codex'
  | 'cursor'
  | 'gemini'
  | 'iflow'
  | 'kimi'
  | 'devin'
  | 'opencode'
  | 'qoder'
  | 'pi'
  | 'acp'
  | 'tmux';

export interface CcProjectListItem {
  name: string;
  agent_type: CcAgentType;
  platforms: string[];
  sessions_count: number;
  heartbeat_enabled: boolean;
}

export interface CcProjectPlatform {
  type: string;
  connected: boolean;
}

export interface CcProjectHeartbeat {
  enabled: boolean;
  paused: boolean;
  interval_mins: number;
  session_key?: string;
}

export interface CcProjectSettings {
  language?: string;
  admin_from?: string;
  disabled_commands?: string[];
}

export interface CcProjectDetail {
  name: string;
  agent_type: CcAgentType;
  platforms: CcProjectPlatform[];
  sessions_count: number;
  active_session_keys: string[];
  heartbeat: CcProjectHeartbeat;
  settings: CcProjectSettings;
  work_dir: string;
  agent_mode: string;
}

export interface CcProjectSettingsUpdate {
  language?: string;
  admin_from?: string;
  disabled_commands?: string[];
  work_dir?: string;
  mode?: string;
  agent_type?: string;
  show_context_indicator?: boolean;
  reply_footer?: boolean;
  inject_sender?: boolean;
  platform_allow_from?: Record<string, string>;
}

export interface CcAddPlatformRequest {
  type: string;
  options: Record<string, string>;
  work_dir?: string;
  agent_type?: string;
}

// =============================================================================
// Sessions
// =============================================================================

export interface CcSessionMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface CcSessionListItem {
  id: string;
  name: string;
  session_key: string;
  agent_type: CcAgentType;
  active: boolean;
  live: boolean;
  history_count: number;
  created_at: string;
  updated_at: string;
  last_message: CcSessionMessage | null;
  platform: string;
  user_name?: string;
  chat_name?: string;
}

export interface CcSessionDetail {
  id: string;
  name: string;
  session_key: string;
  agent_session_id?: string;
  agent_type: CcAgentType;
  active: boolean;
  live: boolean;
  history_count: number;
  created_at: string;
  updated_at: string;
  platform: string;
  history: CcSessionMessage[];
}

// =============================================================================
// Heartbeat
// =============================================================================

export interface CcHeartbeatStatus {
  enabled: boolean;
  paused?: boolean;
  interval_mins?: number;
  only_when_idle?: boolean;
  session_key?: string;
  silent?: boolean;
  run_count?: number;
  error_count?: number;
  skipped_busy?: number;
  last_run?: string;
  last_error?: string;
}

// =============================================================================
// Providers
// =============================================================================

export interface CcProviderModelEntry {
  model: string;
  alias?: string;
}

export interface CcGlobalProvider {
  name: string;
  api_key?: string;
  base_url?: string;
  model?: string;
  thinking?: string;
  env?: Record<string, string>;
  agent_types?: string[];
  models?: CcProviderModelEntry[];
  endpoints?: Record<string, string>;
  agent_models?: Record<string, string>;
  agent_model_lists?: Record<string, CcProviderModelEntry[]>;
  codex?: {
    wire_api?: string;
    http_headers?: Record<string, string>;
  };
}

export interface CcProviderPresetAgentConfig {
  base_url: string;
  model: string;
  models?: string[];
  codex_config?: {
    wire_api?: string;
    http_headers?: Record<string, string>;
  };
}

export interface CcProviderPreset {
  name: string;
  display_name: string;
  agents: Record<string, CcProviderPresetAgentConfig>;
  invite_url?: string;
  description?: string;
  description_zh?: string;
  features?: string[];
  thinking?: string;
  tier: number;
  featured?: boolean;
  website?: string;
}

export interface CcProviderPresetsResponse {
  version: number;
  updated_at?: string;
  providers: CcProviderPreset[];
}

// =============================================================================
// Models
// =============================================================================

export interface CcModelEntry {
  model: string;
  alias?: string;
}

// =============================================================================
// Bridge WebSocket Protocol
// =============================================================================

/** First message from adapter to cc-connect. */
export interface CcBridgeRegisterMessage {
  type: 'register';
  platform: string;
  capabilities: string[];
  metadata?: Record<string, string>;
}

/** User message from adapter to cc-connect. */
export interface CcBridgeUserMessage {
  type: 'message';
  msg_id: string;
  session_key: string;
  user_id: string;
  user_name: string;
  content: string;
  /**
   * 路由到的 cc-connect project 名称。
   * 当 session_key 不足以唯一标识 project(如 hermit 群聊多成员共享同一 sessionKey)时,
   * 必须显式提供 project 让 cc-connect 知道发送给哪个 engine。
   */
  project?: string;
  /** 可选 chat 标识,默认 cc-connect 由 session_key 解析。 */
  chat_id?: string;
  reply_ctx?: string;
  images?: Array<{ mime_type: string; data: string; file_name: string }>;
  files?: Array<{ mime_type: string; data: string; file_name: string }>;
}

/** Complete reply from agent. */
export interface CcBridgeReplyMessage {
  type: 'reply';
  session_key: string;
  reply_ctx?: string;
  content: string;
  format?: string;
}

/** Streaming delta from agent. */
export interface CcBridgeReplyStreamMessage {
  type: 'reply_stream';
  session_key: string;
  reply_ctx?: string;
  delta: string;
  full_text: string;
  preview_handle?: string;
  done: boolean;
}

/** Card from agent. */
export interface CcBridgeCardMessage {
  type: 'card';
  session_key: string;
  reply_ctx?: string;
  card: {
    header?: { title: string; color?: string };
    elements: Array<Record<string, unknown>>;
  };
}

/** Buttons from agent. */
export interface CcBridgeButtonsMessage {
  type: 'buttons';
  session_key: string;
  reply_ctx?: string;
  content: string;
  buttons: Array<Array<{ text: string; data: string }>>;
}

/** Typing indicators. */
export interface CcBridgeTypingMessage {
  type: 'typing_start' | 'typing_stop';
  session_key: string;
}

/** Ping/pong keepalive. */
export interface CcBridgePingMessage {
  type: 'ping';
  ts: number;
}

export interface CcBridgePongMessage {
  type: 'pong';
  ts: number;
}

/** Card action from adapter. */
export interface CcBridgeCardActionMessage {
  type: 'card_action';
  session_key: string;
  action: string;
  reply_ctx?: string;
}

export type CcBridgeIncomingMessage =
  | CcBridgeReplyMessage
  | CcBridgeReplyStreamMessage
  | CcBridgeCardMessage
  | CcBridgeButtonsMessage
  | CcBridgeTypingMessage
  | CcBridgePongMessage;

export type CcBridgeOutgoingMessage =
  | CcBridgeRegisterMessage
  | CcBridgeUserMessage
  | CcBridgePingMessage
  | CcBridgeCardActionMessage;

// =============================================================================
// Hermit-specific: Project Mapping
// =============================================================================

export interface CcProjectMapping {
  teamName: string;
  memberName: string;
  ccProjectName: string;
  agentType: CcAgentType;
  workDir: string;
  sessionKey?: string;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// Hermit-specific: Connection Config
// =============================================================================

export interface CcConnectConfig {
  baseUrl: string;
  bridgeUrl: string;
  token: string;
  bridgeToken?: string;
}

export const CC_CONNECT_DEFAULTS: CcConnectConfig = {
  baseUrl: 'http://127.0.0.1:9820',
  bridgeUrl: 'ws://127.0.0.1:9810/bridge/ws',
  token: '',
};
