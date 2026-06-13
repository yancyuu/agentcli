/**
 * Build command-list suggestions from workflow prompts (`.claude/commands/*.md`).
 *
 * Extracted from SystemManagerView so both the admin Loop console and each
 * team's Loop console can surface workflow commands — the team console loads
 * its own project's commands, so a digital worker's project-specific commands
 * appear alongside the global ones.
 */

import type { MentionSuggestion } from '@renderer/types/mention';
import type { WorkflowPromptSummary } from '@shared/types/systemManager';

function formatWorkflowCommand(prompt: WorkflowPromptSummary): string {
  return prompt.commandName ?? `/${prompt.filename.replace(/\.[^.]+$/, '')}`;
}

/**
 * Convert a workflow prompt into a command suggestion carrying the
 * `workflowPromptId` / `workflowPromptFolder` metadata that the submit path
 * uses to inject the prompt's full body (instead of sending the raw `/name`).
 */
export function buildWorkflowCommandSuggestion(
  prompt: WorkflowPromptSummary,
  idPrefix = 'workflow'
): MentionSuggestion {
  const command = formatWorkflowCommand(prompt) as `/${string}`;
  const commandName = command.slice(1);
  return {
    id: `${idPrefix}:${prompt.id}`,
    name: commandName,
    type: 'command',
    command,
    insertText: commandName,
    workflowPromptId: prompt.id,
    workflowPromptFolder: prompt.folder,
    description: prompt.description ?? `运行 ${prompt.label}`,
    subtitle: prompt.safety ? `${prompt.label} · ${prompt.safety}` : prompt.label,
    searchText: [
      prompt.label,
      prompt.description,
      prompt.category,
      prompt.safety,
      prompt.filename,
      command,
    ]
      .filter(Boolean)
      .join(' '),
  };
}
