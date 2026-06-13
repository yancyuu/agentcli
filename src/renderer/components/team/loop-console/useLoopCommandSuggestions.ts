import { useEffect, useMemo } from 'react';

import { useTaskSuggestions } from '@renderer/hooks/useTaskSuggestions';
import { useTeamSuggestions } from '@renderer/hooks/useTeamSuggestions';
import { useProjectWorkflowCommands } from '@renderer/hooks/useProjectWorkflowCommands';
import { useStore } from '@renderer/store';
import { buildMemberColorMap } from '@renderer/utils/memberHelpers';
import { getLoopShortcutMentionSuggestions } from '@renderer/utils/loopShortcutSuggestions';
import { getSuggestedSlashCommandsForProvider } from '@renderer/utils/providerSlashCommands';
import {
  buildCapabilityPackCommandSuggestions,
  collectSlashSuggestionAliases,
} from '@renderer/utils/slashCommandRegistry';
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

function isLoopFocusedSuggestion(suggestion: MentionSuggestion): boolean {
  const haystack = [
    suggestion.name,
    suggestion.command,
    suggestion.description,
    suggestion.searchText,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return /loop|doctor|summary|hygiene|workflow|worktree|memory|scan|daily|workers|诊断|摘要|循环|运维|清理|记忆|数字员工/.test(
    haystack
  );
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
  const capabilityPacks = useStore((state) => state.capabilityPacks);
  const fetchCapabilityPacks = useStore((state) => state.fetchCapabilityPacks);

  useEffect(() => {
    void fetchCapabilityPacks();
  }, [fetchCapabilityPacks]);

  const commandSuggestions = useMemo<MentionSuggestion[]>(() => {
    // 指令台命令排序（用户要求）：本项目指令 → hermit 指令 → claude 指令。
    //   - 本项目：团队项目 .claude/commands（projectWorkflowSuggestions）
    //   - hermit：loop 快捷指令 + hermit:* 命令 + 能力包（packs）
    //   - claude：claude 内建 slash 命令（baseSuggestions）
    // 调用方传入完整集合（admin 控制台）时 projectWorkflowSuggestions 与 packs 均为空，
    // 退化为 [scoped, claude]，与改动前行为一致。
    const baseSuggestions = buildSlashCommandSuggestions(
      getSuggestedSlashCommandsForProvider(leadProviderId),
      [],
      [],
      leadProviderId
    ).filter(isLoopFocusedSuggestion);

    const hermitBase = scopedCommandSuggestions ?? getLoopShortcutMentionSuggestions();
    // 能力包归入 hermit 组；别名冲突检测仍覆盖全部已有命令（本项目+hermit+claude），
    // 与改动前集合等价，仅调整展示顺序。
    const packSuggestions = scopedCommandSuggestions
      ? []
      : buildCapabilityPackCommandSuggestions(capabilityPacks, 'team-loop', {
          forceNamespacedAliases: collectSlashSuggestionAliases([
            ...projectWorkflowSuggestions,
            ...hermitBase,
            ...baseSuggestions,
          ]),
        });
    // 排序：本项目 → hermit(快捷指令+能力包) → claude。
    const localSuggestions = [
      ...projectWorkflowSuggestions,
      ...hermitBase,
      ...packSuggestions,
      ...baseSuggestions,
    ];
    const seen = new Set<string>();
    return localSuggestions.filter((suggestion) => {
      const key = suggestion.command ?? suggestion.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [capabilityPacks, leadProviderId, scopedCommandSuggestions]);

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
