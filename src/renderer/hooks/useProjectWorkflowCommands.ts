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

function commandsFolder(projectPath: string): string {
  return `${projectPath.replace(/[\\/]+$/, '')}/.claude/commands`;
}

export function useProjectWorkflowCommands(projectPath?: string | null): MentionSuggestion[] {
  const [suggestions, setSuggestions] = useState<MentionSuggestion[]>(EMPTY);

  useEffect(() => {
    const trimmed = projectPath?.trim();
    if (!trimmed) {
      setSuggestions(EMPTY);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result = await api.systemManager.listWorkflowPrompts(commandsFolder(trimmed));
        if (cancelled) return;
        const seen = new Set<string>();
        const next = result.prompts
          .map((prompt) => buildWorkflowCommandSuggestion(prompt, 'team-workflow'))
          .filter((suggestion) => {
            const key = suggestion.command ?? suggestion.id;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        setSuggestions(next);
      } catch {
        // Missing .claude/commands is normal — the project simply has no custom commands.
        if (!cancelled) setSuggestions(EMPTY);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  return suggestions;
}
