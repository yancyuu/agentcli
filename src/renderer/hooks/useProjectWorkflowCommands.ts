/**
 * Load a team project's `.claude/commands/*.md` workflow prompts and expose them
 * as command suggestions for the Loop console.
 *
 * The team Loop console previously only showed global shortcuts + capability
 * packs, so a project's own commands never appeared. This mirrors the admin
 * console's workflow loading, scoped to the team's project path.
 */
import { useEffect, useState } from 'react';

import { api } from '@renderer/api';
import { buildWorkflowCommandSuggestion } from '@renderer/utils/workflowCommandSuggestions';

import type { MentionSuggestion } from '@renderer/types/mention';

const EMPTY: MentionSuggestion[] = [];
const GLOBAL_HERMIT_COMMANDS_FOLDER = '~/.claude/commands/hermit';

function commandsFolder(projectPath: string): string {
  return `${projectPath.replace(/[\\/]+$/, '')}/.claude/commands`;
}

function useWorkflowCommandsFolder(
  folder: string | null | undefined,
  idPrefix: string
): MentionSuggestion[] {
  const [suggestions, setSuggestions] = useState<MentionSuggestion[]>(EMPTY);

  useEffect(() => {
    const trimmed = folder?.trim();
    if (!trimmed) {
      setSuggestions(EMPTY);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result = await api.systemManager.listWorkflowPrompts(trimmed);
        if (cancelled) return;
        const seen = new Set<string>();
        const next = result.prompts
          .map((prompt) => buildWorkflowCommandSuggestion(prompt, idPrefix))
          .filter((suggestion) => {
            const key = suggestion.command ?? suggestion.id;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        setSuggestions(next);
      } catch {
        // Missing command folders are normal — the project/user simply has no custom commands yet.
        if (!cancelled) setSuggestions(EMPTY);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [folder, idPrefix]);

  return suggestions;
}

export function useProjectWorkflowCommands(projectPath?: string | null): MentionSuggestion[] {
  const trimmed = projectPath?.trim();
  return useWorkflowCommandsFolder(trimmed ? commandsFolder(trimmed) : null, 'team-workflow');
}

export function useHermitWorkflowCommands(): MentionSuggestion[] {
  return useWorkflowCommandsFolder(GLOBAL_HERMIT_COMMANDS_FOLDER, 'hermit-workflow');
}
