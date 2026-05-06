import { CursorCliRuntimeAdapter } from '@features/cursor-runtime/main';
import { getClaudeBasePath } from '@main/utils/pathDecoder';
import { CANONICAL_LEAD_MEMBER_NAME } from '@shared/utils/leadDetection';

import type {
  TeamLaunchRuntimeAdapter,
  TeamRuntimeLaunchInput,
  TeamRuntimeLaunchResult,
  TeamRuntimeMemberLaunchEvidence,
  TeamRuntimePrepareResult,
  TeamRuntimeReconcileInput,
  TeamRuntimeReconcileResult,
  TeamRuntimeStopInput,
  TeamRuntimeStopResult,
} from './TeamRuntimeAdapter';

function buildCursorTeamPrompt(input: TeamRuntimeLaunchInput): string {
  const claudeDir = getClaudeBasePath();
  const members = input.expectedMembers
    .map((member) =>
      [
        `- member:${member.name}`,
        member.role ? `  role: ${member.role}` : null,
        member.workflow ? `  workflow: ${member.workflow}` : null,
      ]
        .filter(Boolean)
        .join('\n')
    )
    .join('\n');

  return [
    'You are running a Hermit Cursor Agent team session.',
    `Team: ${input.teamName}`,
    `Project: ${input.cwd}`,
    `Claude data dir: ${claudeDir}`,
    '',
    'Members:',
    members || `- member:${CANONICAL_LEAD_MEMBER_NAME}\n  role: Team Lead`,
    '',
    'Startup protocol:',
    '- Create one Cursor subagent/task for each listed member.',
    '- Include the exact prefix "member:<name>" in each subagent/task description.',
    `- In each subagent prompt, first call MCP tool member_briefing with teamName="${input.teamName}", claudeDir="${claudeDir}", memberName="<name>". Do not pass runtimeProvider.`,
    `- Then call MCP tool task_briefing with teamName="${input.teamName}", claudeDir="${claudeDir}", memberName="<name>".`,
    '- If task_briefing returns actionable work, the subagent may start it. Otherwise it should report readiness only.',
    '- Do not invent completed work.',
    '',
    'User request:',
    input.prompt?.trim() || 'Start the team and report readiness.',
  ].join('\n');
}

function parseCursorConfirmedMembers(stdout: string): Set<string> {
  const members = new Set<string>();
  for (const rawLine of stdout.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const event = JSON.parse(line) as {
        type?: unknown;
        tool_call?: {
          taskToolCall?: {
            args?: {
              description?: unknown;
              prompt?: unknown;
            };
          };
          mcpToolCall?: {
            args?: {
              toolName?: unknown;
              args?: {
                memberName?: unknown;
              };
            };
          };
        };
      };
      if (event.type !== 'tool_call') continue;
      const taskArgs = event.tool_call?.taskToolCall?.args;
      const text = [taskArgs?.description, taskArgs?.prompt]
        .filter((value): value is string => typeof value === 'string')
        .join('\n');
      for (const match of text.matchAll(/\bmember:([^\s,;]+)/giu)) {
        const memberName = match[1]?.trim();
        if (memberName) members.add(memberName.toLowerCase());
      }

      const mcpArgs = event.tool_call?.mcpToolCall?.args;
      const toolName = typeof mcpArgs?.toolName === 'string' ? mcpArgs.toolName : '';
      const memberName =
        typeof mcpArgs?.args?.memberName === 'string' ? mcpArgs.args.memberName.trim() : '';
      if ((toolName === 'member_briefing' || toolName === 'task_briefing') && memberName) {
        members.add(memberName.toLowerCase());
      }
    } catch {
      // Ignore non-JSON stream lines.
    }
  }
  return members;
}

function summarizeCursorFailure(result: {
  stderr?: string;
  resultText?: string;
  diagnostics?: readonly string[];
  exitCode?: number | null;
}): string {
  const candidates = [
    result.stderr?.trim(),
    result.resultText?.trim(),
    ...(result.diagnostics ?? []).map((diagnostic) => diagnostic.trim()),
    typeof result.exitCode === 'number' ? `Cursor Agent exited with code ${result.exitCode}` : '',
  ].filter((entry): entry is string => Boolean(entry));
  return candidates[0]?.slice(0, 500) ?? 'Cursor Agent run failed';
}

function buildMemberEvidence(
  input: TeamRuntimeLaunchInput,
  delegatedMembers: Set<string>,
  ok: boolean,
  sessionId?: string,
  failureReason?: string
): Record<string, TeamRuntimeMemberLaunchEvidence> {
  return Object.fromEntries(
    input.expectedMembers.map((member) => {
      const delegated = delegatedMembers.has(member.name.toLowerCase());
      const confirmed = ok;
      return [
        member.name,
        {
          memberName: member.name,
          providerId: 'cursor' as const,
          launchState: confirmed
            ? ('confirmed_alive' as const)
            : ('runtime_pending_bootstrap' as const),
          agentToolAccepted: delegated,
          runtimeAlive: false,
          bootstrapConfirmed: confirmed,
          hardFailure: !ok,
          ...(ok ? {} : { hardFailureReason: failureReason ?? 'Cursor Agent run failed' }),
          ...(sessionId ? { sessionId } : {}),
          backendType: 'process' as const,
          livenessKind: confirmed ? ('confirmed_bootstrap' as const) : ('registered_only' as const),
          runtimeDiagnostic: confirmed
            ? delegated
              ? 'Cursor Agent taskToolCall confirmed'
              : 'Cursor Agent run completed; member is covered by the team run'
            : (failureReason ?? 'Cursor Agent run failed'),
          diagnostics: delegated
            ? ['Cursor taskToolCall delegated work for this member']
            : ok
              ? [
                  'Cursor completed without member-specific taskToolCall evidence; treating member as joined',
                ]
              : [failureReason ?? 'Cursor Agent run failed'],
        },
      ];
    })
  );
}

function resolveCursorLaunchModel(
  requestedModel: string | undefined,
  availableModels: readonly string[]
): string | undefined {
  const normalizeModelId = (value: string): string => value.trim().replace(/\s+-\s+.*$/u, '');
  const models = availableModels
    .map(normalizeModelId)
    .filter((model) => model && model !== 'Available models' && model !== 'Available models:');
  const requested = requestedModel ? normalizeModelId(requestedModel) : undefined;
  if (
    requested === 'auto' ||
    requested === 'composer-2-fast' ||
    requested === 'composer-2' ||
    (requested && models.includes(requested))
  ) {
    return requested;
  }
  return models.find((model) => model === 'auto') ?? 'auto';
}

export class CursorAgentTeamRuntimeAdapter implements TeamLaunchRuntimeAdapter {
  readonly providerId = 'cursor' as const;

  constructor(private readonly cursor = new CursorCliRuntimeAdapter()) {}

  async prepare(_input: TeamRuntimeLaunchInput): Promise<TeamRuntimePrepareResult> {
    const status = await this.cursor.probeStatus();
    if (status.state !== 'ready') {
      return {
        ok: false,
        providerId: this.providerId,
        reason: status.state,
        diagnostics: [...status.diagnostics],
        warnings: status.authMessage ? [status.authMessage] : [],
        retryable: status.state !== 'missing',
      };
    }

    return {
      ok: true,
      providerId: this.providerId,
      modelId: status.models[0] ?? null,
      diagnostics: [...status.diagnostics],
      warnings: ['Cursor Agent team runtime is experimental.'],
    };
  }

  async launch(input: TeamRuntimeLaunchInput): Promise<TeamRuntimeLaunchResult> {
    const status = await this.cursor.probeStatus();
    if (status.state !== 'ready') {
      return {
        runId: input.runId,
        teamName: input.teamName,
        launchPhase: 'finished',
        teamLaunchState: 'partial_failure',
        members: buildMemberEvidence(input, new Set(), false),
        warnings: status.authMessage ? [status.authMessage] : [],
        diagnostics: [...status.diagnostics],
      };
    }

    const launchModel = resolveCursorLaunchModel(input.model, status.models);
    const result = await this.cursor.runOneShot({
      runId: input.runId,
      cwd: input.cwd,
      prompt: buildCursorTeamPrompt(input),
      model: launchModel,
      force: input.skipPermissions,
      approveMcps: true,
      timeoutMs: 10 * 60_000,
      idleAfterResultMs: 2_000,
    });
    const delegatedMembers = parseCursorConfirmedMembers(result.stdout);
    const failureReason = result.ok ? undefined : summarizeCursorFailure(result);
    const members = buildMemberEvidence(
      input,
      delegatedMembers,
      result.ok,
      result.sessionId ?? undefined,
      failureReason
    );

    return {
      runId: input.runId,
      teamName: input.teamName,
      ...(result.sessionId ? { leadSessionId: result.sessionId } : {}),
      launchPhase: 'finished',
      teamLaunchState: result.ok ? 'clean_success' : 'partial_failure',
      members,
      warnings: ['Cursor Agent team runtime is experimental.'],
      diagnostics: [
        ...status.diagnostics,
        input.model?.trim() && input.model.trim() !== launchModel
          ? `Cursor model "${input.model.trim()}" is not in the runtime model list; using "${launchModel ?? 'runtime default'}".`
          : '',
        ...result.diagnostics,
        result.stderr ? `stderr: ${result.stderr}` : '',
        result.resultText ? `result: ${result.resultText}` : '',
      ].filter(Boolean),
    };
  }

  async reconcile(input: TeamRuntimeReconcileInput): Promise<TeamRuntimeReconcileResult> {
    return {
      runId: input.runId,
      teamName: input.teamName,
      launchPhase: input.previousLaunchState?.launchPhase ?? 'finished',
      teamLaunchState: input.previousLaunchState?.teamLaunchState ?? 'partial_pending',
      members: {},
      snapshot: input.previousLaunchState,
      warnings: ['Cursor Agent team reconcile is best-effort.'],
      diagnostics: [],
    };
  }

  async stop(input: TeamRuntimeStopInput): Promise<TeamRuntimeStopResult> {
    return {
      runId: input.runId,
      teamName: input.teamName,
      stopped: true,
      members: {},
      warnings: [],
      diagnostics: ['Cursor Agent runs are one-shot and do not keep persistent processes.'],
    };
  }
}
