/**
 * Compact Hermit operations context injected into managed agent instructions.
 *
 * Keep this short: agents need the stable runbook boundary and pointers, not the
 * full public guide copied into every session.
 */

export const HERMIT_OPS_GUIDE_URL = 'https://yancyuu.github.io/Hermit/';

const OPS_CONTEXT_BEGIN = '<!-- hermit:ops-runbook-context:start -->';
const OPS_CONTEXT_END = '<!-- hermit:ops-runbook-context:end -->';

const OPS_RUNBOOK_CONTEXT = `## Hermit Ops Runbook Context

Public operations guide: ${HERMIT_OPS_GUIDE_URL}
Local canonical docs: README.md, docs/README.md, docs/team-management/README.md

Hermit/openHermit is a local-first Loop Engineering control plane. Use /teams as the
main operations surface and treat ~/.hermit/ as the default local data directory.
Hermit coordinates teams, tasks, message routing, channel allowlists, audit trails,
and Loop workflows; actual runtime execution is delegated to the local Agent CLI /
cc-connect Bridge / Management API.

Common ops workflows to suggest or use when appropriate. Hermit preinstalls them as
user-level Claude commands under ~/.claude/commands/hermit/ so every team can run
the same namespaced commands from its own cwd:
- /hermit:doctor — diagnose install/runtime/config health.
- /hermit:loop-scan — inspect Loop assets and recommended recurring loops.
- /hermit:summary — summarize team/session status and next actions.
- /hermit:daily-folder-hygiene — check temporary files, stale reports, and workspace clutter.
- /hermit:daily-memory-conflict-check — check CLAUDE/AGENTS/memory/settings conflicts.
- /hermit:daily-workflow-extraction — extract reusable prompts/workflows from recent work.
- /hermit:worktree-scan — inspect dirty or stale worktrees before cleanup decisions.

Safety boundary for operations workflows:
- Default to read-only diagnosis. Do not modify, delete, move, format, commit, push,
  publish, deploy, or run destructive commands unless the user explicitly approves.
- Explain the purpose before commands; prefer read-only commands for diagnostics.
- Do not expose secrets, tokens, cookies, private keys, or full sensitive paths.
- If a fix is needed, report recommendations, verification steps, and an optional
  patch plan before applying changes.
- Treat the public guide and local docs as operational references; verify against
  the current repository/config before making exact claims.`;

export function buildHermitOpsRunbookContext(): string {
  return `${OPS_CONTEXT_BEGIN}\n\n${OPS_RUNBOOK_CONTEXT}\n\n${OPS_CONTEXT_END}`;
}

export function removeHermitOpsRunbookContext(content: string): string {
  return content
    .replace(new RegExp(`\\n{0,2}${OPS_CONTEXT_BEGIN}[\\s\\S]*?${OPS_CONTEXT_END}\\n?`, 'g'), '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

export function buildMemberWorkflowWithOpsContext(memberWorkflow?: string): string {
  const workflow = removeHermitOpsRunbookContext(memberWorkflow ?? '').trim();
  const context = buildHermitOpsRunbookContext();
  return workflow ? `${workflow}\n\n${context}` : context;
}
