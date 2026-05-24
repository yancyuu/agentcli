/**
 * Shared harness type definitions used across the app.
 * Mirrors cc-connect's CcAgentType.
 */

import type { CcAgentType } from '@shared/types/ccConnect';

export type { CcAgentType } from '@shared/types/ccConnect';

export const ALL_AGENT_TYPES: CcAgentType[] = [
  'claudecode',
  'codex',
  'cursor',
  'gemini',
  'iflow',
  'kimi',
  'devin',
  'opencode',
  'qoder',
  'pi',
  'acp',
  'tmux',
];

export const AGENT_TYPE_LABELS: Record<CcAgentType, string> = {
  claudecode: 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  gemini: 'Gemini',
  iflow: 'iFlow',
  kimi: 'Kimi',
  devin: 'Devin',
  opencode: 'OpenCode',
  qoder: 'Qoder',
  pi: 'Pi',
  acp: 'ACP',
  tmux: 'Tmux',
};
