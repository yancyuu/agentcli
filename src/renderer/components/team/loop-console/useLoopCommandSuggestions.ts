import { useMemo } from 'react';

import { useTaskSuggestions } from '@renderer/hooks/useTaskSuggestions';
import { useTeamSuggestions } from '@renderer/hooks/useTeamSuggestions';
import { useProjectWorkflowCommands } from '@renderer/hooks/useProjectWorkflowCommands';
import { buildMemberColorMap } from '@renderer/utils/memberHelpers';
import { getSuggestedSlashCommandsForProvider } from '@renderer/utils/providerSlashCommands';
import { buildSlashCommandSuggestions } from '@renderer/utils/skillCommandSuggestions';
import { CANONICAL_LEAD_MEMBER_NAME, isLeadMember } from '@shared/utils/leadDetection';
import {
  inferTeamProviderIdFromModel,
  normalizeOptionalTeamProviderId,
} from '@shared/utils/teamProvider';

import type { MentionSuggestion } from '@renderer/types/mention';
import type { ResolvedTeamMember } from '@shared/types';

interface UseLoopCommandSuggestionsOptions {
  teamName: string;
  members: ResolvedTeamMember[];
  commandSuggestions?: MentionSuggestion[];
  /** Team project path — used to load that project's .claude/commands workflow commands. */
  projectPath?: string | null;
}

interface UseLoopCommandSuggestionsResult {
  mentionSuggestions: MentionSuggestion[];
  teamSuggestions: MentionSuggestion[];
  taskSuggestions: MentionSuggestion[];
  commandSuggestions: MentionSuggestion[];
  teamSlugs: string[];
  leadRecipient: string;
}

function formatRole(role?: string): string | undefined {
  const value = role?.trim();
  if (!value) return undefined;
  return value;
}

function isBlockedCommandSuggestion(suggestion: MentionSuggestion): boolean {
  const raw = (suggestion.command ?? suggestion.name).trim().toLowerCase().replace(/^\//, '');
  return raw === 'loop' || raw === 'system' || raw.endsWith(':loop') || raw.endsWith(':system');
}

export function useLoopCommandSuggestions({
  teamName,
  members,
  commandSuggestions: scopedCommandSuggestions,
  projectPath,
}: UseLoopCommandSuggestionsOptions): UseLoopCommandSuggestionsResult {
  const colorMap = useMemo(() => buildMemberColorMap(members), [members]);
  const mentionSuggestions = useMemo<MentionSuggestion[]>(
    () =>
      members.map((member) => ({
        id: member.name,
        name: member.name,
        subtitle: formatRole(member.role) ?? formatRole(member.agentType),
        color: colorMap.get(member.name),
      })),
    [colorMap, members]
  );

  const leadMember = useMemo(
    () => members.find((member) => isLeadMember(member)) ?? members[0],
    [members]
  );
  const leadRecipient = leadMember?.name ?? CANONICAL_LEAD_MEMBER_NAME;
  const leadProviderId = useMemo(
    () =>
      normalizeOptionalTeamProviderId(leadMember?.providerId) ??
      inferTeamProviderIdFromModel(leadMember?.model),
    [leadMember?.model, leadMember?.providerId]
  );

  const { suggestions: teamSuggestions } = useTeamSuggestions(teamName);
  const { suggestions: taskSuggestions } = useTaskSuggestions(teamName);
  // Load the team project's own .claude/commands so project-specific commands
  // appear in the team console. Skipped when the caller supplies its own full
  // suggestion set (e.g. the admin console builds its own).
  const projectWorkflowSuggestions = useProjectWorkflowCommands(
    scopedCommandSuggestions ? null : projectPath
  );
  const commandSuggestions = useMemo<MentionSuggestion[]>(() => {
    const baseSuggestions = buildSlashCommandSuggestions(
      getSuggestedSlashCommandsForProvider(leadProviderId),
      [],
      [],
      leadProviderId
    );

    // 团队指令台只显示本地项目命令 + Claude/Codex 常用命令。
    // Hermit 运维 workflow 由 SystemManagerView 显式传入，只属于 Helm Loop。
    const localSuggestions = scopedCommandSuggestions
      ? [...scopedCommandSuggestions, ...baseSuggestions]
      : [...projectWorkflowSuggestions, ...baseSuggestions];
    const seen = new Set<string>();
    return localSuggestions.filter((suggestion) => {
      if (isBlockedCommandSuggestion(suggestion)) return false;
      const key = suggestion.command ?? suggestion.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [leadProviderId, projectWorkflowSuggestions, scopedCommandSuggestions]);

  const teamSlugs = useMemo(
    () =>
      teamSuggestions.map((suggestion) =>
        suggestion.id.startsWith('team:') ? suggestion.id.slice('team:'.length) : suggestion.name
      ),
    [teamSuggestions]
  );

  return {
    mentionSuggestions,
    teamSuggestions,
    taskSuggestions,
    commandSuggestions,
    teamSlugs,
    leadRecipient,
  };
}
