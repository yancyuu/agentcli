export type CapabilityScope = 'admin-loop' | 'team-loop' | 'kanban-card' | 'task-detail';

export type CapabilitySafety = 'read-only' | 'reporting' | 'proposal-only' | 'write' | 'audit';

export type CapabilityCommandSurface = 'slash' | 'quick-run';

export type CapabilityCommandExecutionType = 'send-message' | 'loop-session';

export interface CapabilityCommandExecution {
  type: CapabilityCommandExecutionType;
  reuse?: boolean;
}

export interface CapabilityCommand {
  id: string;
  alias: string;
  title: string;
  description?: string;
  scope: CapabilityScope[];
  surfaces: CapabilityCommandSurface[];
  safety: CapabilitySafety;
  prompt: string;
  usesSkills?: string[];
  workflow?: string | null;
  order?: number;
  execution?: CapabilityCommandExecution;
}

export interface CapabilitySkill {
  id: string;
  name: string;
  description?: string;
  path: string;
}

export interface CapabilityWorkflow {
  id: string;
  name: string;
  description?: string;
  path: string;
}

export interface CapabilityCronJob {
  id: string;
  name: string;
  description?: string;
  cronExpression: string;
  prompt: string;
  enabled: boolean;
  teamName?: string;
}

export interface CapabilityMcpServer {
  id: string;
  name: string;
  scope: 'local' | 'user' | 'project';
  transport?: string;
  config?: Record<string, unknown>;
}

export type CapabilityPackExportRuntime = 'claudecode' | 'codex' | 'cursor' | 'gemini' | 'opencode';

export interface CapabilityPackManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  namespace: string;
  version: string;
  author?: string;
  description?: string;
  tags?: string[];
  teamName?: string;
  capabilities: {
    commands?: CapabilityCommand[];
    skills?: CapabilitySkill[];
    workflows?: CapabilityWorkflow[];
    cron?: CapabilityCronJob[];
    mcpServers?: CapabilityMcpServer[];
  };
}

export type CapabilityPackSource = 'builtin' | 'local' | 'user' | 'project';

export interface LoadedCapabilityPack {
  manifest: CapabilityPackManifest;
  packDir: string;
  source: CapabilityPackSource;
  enabled: boolean;
  warnings: string[];
}

export interface CapabilityPackListResult {
  packs: LoadedCapabilityPack[];
  warnings: string[];
  rootDir: string;
}

export interface CapabilityPackImportRequest {
  sourceDir: string;
  overwrite?: boolean;
}

export interface CapabilityPackExportRequest {
  packId: string;
  destinationDir?: string;
  overwrite?: boolean;
  runtime?: CapabilityPackExportRuntime;
}

export interface CapabilityPackMutationResult {
  pack: LoadedCapabilityPack | null;
  warnings: string[];
}

export interface CapabilityCommandPromptRequest {
  canonicalId: string;
  scope?: CapabilityScope;
}

export interface CapabilityCommandPromptResult {
  command: RegisteredSlashCommand;
  prompt: string;
}

export type SlashCommandSource = 'builtin' | 'project' | 'pack' | 'official';

export interface RegisteredSlashCommand {
  canonicalId: string;
  alias: string;
  namespace: string;
  slash: `/${string}`;
  namespacedSlash: `/${string}:${string}`;
  source: SlashCommandSource;
  packId?: string;
  command: CapabilityCommand;
  conflictsWith?: string[];
}

export interface SlashCommandResolveResult {
  status: 'not-found' | 'resolved' | 'conflict';
  command?: RegisteredSlashCommand;
  candidates?: RegisteredSlashCommand[];
}
