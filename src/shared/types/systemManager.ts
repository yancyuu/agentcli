export interface SystemManagerStatus {
  displayName: 'Admin Loop';
  defaultWorkDir: string;
  selectedWorkDir: string;
  workflowFolder?: string;
  claudeCommand: 'claude';
  localStatus: 'ready' | 'missing-claude' | 'error';
  error?: string;
}

export interface SystemManagerConfig {
  schemaVersion: 1;
  selectedWorkDir: string;
  workflowFolder?: string;
  updatedAt: string;
}

export interface SystemManagerConfigPatch {
  selectedWorkDir?: string;
  workflowFolder?: string | null;
}

export type WorkflowPromptSource = 'claude-command' | 'workflow-folder';

export type WorkflowPromptSafety =
  | 'read-only'
  | 'reporting'
  | 'audit'
  | 'proposal-only'
  | 'apply'
  | 'destructive'
  | 'unknown';

export interface WorkflowPromptSummary {
  id: string;
  label: string;
  filename: string;
  path: string;
  sizeBytes: number;
  updatedAt: string;
  folder?: string;
  source?: WorkflowPromptSource;
  commandName?: string;
  description?: string;
  category?: string;
  safety?: WorkflowPromptSafety;
  builtin?: boolean;
  order?: number;
}

export interface WorkflowPromptListResponse {
  folder: string;
  prompts: WorkflowPromptSummary[];
  warnings: string[];
}

export interface WorkflowPromptContentResponse {
  prompt: WorkflowPromptSummary;
  content: string;
}

export interface SystemManagerAPI {
  getStatus: () => Promise<SystemManagerStatus>;
  getConfig: () => Promise<SystemManagerConfig>;
  updateConfig: (patch: SystemManagerConfigPatch) => Promise<SystemManagerConfig>;
  listWorkflowPrompts: (folder: string) => Promise<WorkflowPromptListResponse>;
  readWorkflowPrompt: (folder: string, id: string) => Promise<WorkflowPromptContentResponse>;
}
