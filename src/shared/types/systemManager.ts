export interface SystemManagerStatus {
  displayName: '控制台';
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

export interface WorkflowPromptSummary {
  id: string;
  label: string;
  filename: string;
  path: string;
  sizeBytes: number;
  updatedAt: string;
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
