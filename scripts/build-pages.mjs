import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, '_site');

function writeText(relativePath, content) {
  const target = join(OUT_DIR, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content.trimStart(), 'utf8');
}

function copyIfExists(fromRelative, toRelative = fromRelative) {
  const source = join(ROOT, fromRelative);
  if (!existsSync(source)) return;
  const target = join(OUT_DIR, toRelative);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const manual = `# openHermit Agent Runbook

This page is for AI agents and operators. It is an operational manual, not a marketing page.

If you are an agent reading this page, your job is to understand what openHermit is, where team state lives, how a digital employee workspace should be structured, what workflow to follow, and how to diagnose Lark/Feishu CLI isolation problems without leaking secrets.

## 1. Project identity

- Product: openHermit.
- Package: \`@yancyyu/openhermit\`.
- Shape: Fastify API + Vite Web UI.
- Default route: \`/teams\`.
- Default local state: \`~/.hermit/\`.
- Runtime bridge: cc-connect Bridge / Management API.
- Purpose: operate many local digital employees / department agents from one control plane.
- Not current capabilities: Electron desktop packaging, embedded PTY terminal.

openHermit treats each department agent as a manageable digital employee / Loop workspace. The UI is used to create teams, observe liveness, inspect sessions/messages/tasks, configure channels, launch loops, schedule recurring work, and diagnose failures.

## 2. Mental model

\`\`\`text
Browser / Vite UI
  -> Fastify API
  -> ~/.hermit team/task/message workspace
  -> cc-connect Bridge / Management API
  -> local agent runtimes and external channels
\`\`\`

Core objects:

- Team: a named digital employee workspace with runtime config, members, project path, optional worktree isolation, and channel allow-lists.
- Task: a board item or dispatch projection with status, comments, delivery, and review state.
- Message: team chat, cross-team message, external channel message, or bridge event.
- Channel: Feishu/Lark, Weixin, Slack, Telegram, Discord, and other platform adapters are carried by cc-connect; Hermit controls routing, allow-lists, and audit.
- Task Bus: current implementation is Redis-backed dispatch; offer/bid/lease/event Task Bus is the target model.

## 3. openHermit local data structure

Default Hermit state:

\`\`\`text
~/.hermit/
  teams/
    <team-slug>/
      team.json
      messages/
        group.jsonl
      tasks/
        board.json
  cc-connect/
    config.toml
  logs/
\`\`\`

Important rules:

- Do not invent team directories from unmapped external session keys.
- If an external session cannot route to a known team, reject or surface the routing problem.
- Do not store secrets in docs, messages, reports, or memory files.
- Treat \`~/.hermit/cc-connect/config.toml\`, app secrets, access tokens, cookies, and profile auth state as sensitive.

## 4. Recommended digital employee workspace structure

For department teams, use a predictable directory structure. The examples below use \`/Users/distill/teams\` because the reference deployment uses that root. On another machine, replace it with the actual team root.

\`\`\`text
/Users/distill/teams/
  .memory/
    rules/
    data-sources/
    decisions/
    needs-review/
      proposals/
  .claude/
    skills/
    workflows/
  .templates/
    team-workspace-template/
  <team-folder>/
    .env
    CLAUDE.md
    00_index/
      conflict-review.md
      cleanup-candidates.md
    01_business-docs/
    03_data/
    07_memory/
    99_temp/
    .claude/
      skills/
\`\`\`

What goes where:

| Location | Use | Do not put |
| --- | --- | --- |
| \`<team>/07_memory/\` | Team business facts, stable rules, source pointers, owner, last-confirmed date | secrets, raw exports, transient tool output |
| \`.memory/\` | Cross-team rules approved by workspace/admin owner | unapproved team-specific facts |
| \`.memory/needs-review/\` | Proposals, conflicts, uncertain observations | canonical facts |
| \`.claude/skills/\` at workspace root | shared governance or reusable operational skills | per-team business secrets |
| \`<team>/.claude/skills/\` | team-specific repeatable operations | global governance duplicated into every team |
| \`.claude/workflows/\` | stable multi-step scripts/workflows | long-term business facts |
| \`99_temp/\` | temporary notes and raw material awaiting review | durable policy |

Memory rule: memory stores stable facts and pointers. Repeatable actions become skills, workflows, or cron jobs. Do not hide automation rules only in memory because memory may not always load.

## 5. Recommended agent workflow

When asked to operate or debug a digital employee:

1. Identify the team slug, display name, project path, runtime provider, and channel source.
2. Open or query openHermit team data from \`/teams\` or the API.
3. Read the team \`CLAUDE.md\` and relevant \`07_memory/\` entries before acting on business rules.
4. Check whether the task is a normal message, local team task, Redis dispatch, scheduled Loop, or external channel event.
5. If making code changes, prefer worktree isolation for parallel agents.
6. If using Feishu/Lark, verify the active \`lark-cli\` profile before reading or writing any resource.
7. Execute the smallest safe action, capture evidence, and update task/message status.
8. For repeated manual actions, propose or create a skill/workflow/cron rather than adding more prose to memory.
9. For stable facts, write a short memory entry with source, owner, last-confirmed date, scope, and sensitivity status.
10. If facts conflict, stop and route to \`00_index/conflict-review.md\` or \`.memory/needs-review/\`.

## 6. Recommended operational loops

Use these loops as defaults:

### Team health loop

- List teams.
- Check liveness and recent activity.
- Check failed sessions and stuck tasks.
- Check channel binding and allow-list drift.
- Produce a short report with team, symptom, evidence, recommended next action.

### Task dispatch loop

- Confirm source team and target team.
- Determine if this is a lightweight cross-team message or formal Redis-backed dispatch.
- For formal dispatch, ensure Redis task bus is configured.
- Create or inspect target TODO projection.
- Do not send runtime execution message until the target team/task is explicitly started.
- Track received -> in_progress -> completed/approved.

### Memory governance loop

- Classify content: team fact, workspace rule, personal preference, workflow/SOP, cron, or temporary note.
- Team fact -> \`<team>/07_memory/\`.
- Cross-team rule -> \`.memory/proposals\` or \`.memory/needs-review\` until approved.
- Repeatable operation -> skill/workflow/cron.
- Raw export -> data/report path with pointer only in memory.
- Secrets -> never write to memory or docs.

### Scheduled Loop loop

- Define owner, frequency, input scope, output location, failure notification, and stop condition.
- Store cron/task config in an enumerable place.
- Keep raw outputs out of canonical memory.
- Promote only reviewed summaries into memory.

## 7. Feishu/Lark CLI team isolation

The reference deployment uses a PATH-level \`lark-cli\` wrapper:

\`\`\`text
user/script/agent calls lark-cli
  -> PATH finds ~/.local/bin/lark-cli
  -> wrapper walks upward from pwd -P to nearest .env
  -> wrapper reads LARK_CLI_PROFILE and app variables
  -> wrapper creates/reuses profile if needed
  -> wrapper calls real ~/.npm-global/bin/lark-cli with --profile <resolved_profile>
\`\`\`

Team \`.env\` template:

\`\`\`bash
LARK_CLI_PROFILE=<team-folder-name>
LARK_CLI_BRAND=feishu

LARK_APP_ID=<app_id>
LARK_APP_SECRET=<app_secret>

# Alternative variable names if the team standard uses Feishu naming:
# FEISHU_APP_ID=<app_id>
# FEISHU_APP_SECRET=<app_secret>

# Optional override for real CLI path:
# LARK_CLI_REAL=/Users/distill/.npm-global/bin/lark-cli
\`\`\`

Security:

- \`LARK_CLI_PROFILE\` can be printed.
- App id follows internal policy.
- App secret must never be printed, committed, logged, pasted into docs, or stored in memory.

Before any Feishu/Lark operation inside a team directory, run:

\`\`\`bash
pwd
command -v lark-cli
lark-cli config show
lark-cli profile list
\`\`\`

Expected:

- \`command -v lark-cli\` should point to \`~/.local/bin/lark-cli\`.
- \`lark-cli config show\` should show the current team profile.
- User auth pages should show the current team app name.

If a script intentionally bypasses the wrapper by calling the real binary, it must pass \`--profile <team-profile>\` explicitly.

## 8. Feishu/Lark CLI troubleshooting

| Symptom | Check | Fix |
| --- | --- | --- |
| Wrong team profile | \`pwd\`, nearest \`.env\`, \`lark-cli config show\` | cd into the correct team directory or pass \`--profile\` explicitly |
| Agent subprocess uses wrong app | \`command -v lark-cli\` | ensure PATH hits \`~/.local/bin/lark-cli\`, not \`~/.npm-global/bin/lark-cli\` |
| User auth page shows wrong application | current cwd, \`.env\`, \`LARK_APP_ID\`, profile injection | fix cwd/PATH/profile, regenerate auth URL |
| Permission denied | missing scope and current identity | bot scopes in developer console; user scopes with minimal \`lark-cli auth login --scope ...\` |
| Shared OS account leaks auth state | profiles and user tokens are under same OS user | use separate OS users or isolated runtime for strong person-level isolation |
| Secret appears in docs/logs | search for token/secret/password patterns | rotate secret and remove leaked material from docs/logs/history |

Default identity guidance:

- Prefer bot identity for team docs/files where bot has access.
- Use \`--as user\` only when bot cannot access the resource, resource is user-only, or the operation genuinely needs current-user semantics.
- Explain why user auth is needed before asking for it.

## 9. GitHub Pages CI and deployment troubleshooting

This repository publishes an agent-readable page through GitHub Pages.

Expected workflow behavior:

- Trigger on pushes to \`main\`, pushes to the active release/fix branch, pull requests to \`main\`, and manual dispatch.
- Build static files into \`_site/\` using \`node scripts/build-pages.mjs\`.
- Verify \`_site/index.html\`, \`_site/agent-manual.md\`, \`_site/llms.txt\`, and required screenshots.
- Upload and deploy \`_site\` with \`actions/upload-pages-artifact\` and \`actions/deploy-pages\` for non-PR runs.
- For pull requests, run build/verification only and skip deployment.
- Pages repository setting should use GitHub Actions as the source.

If the page does not update:

1. Check Actions -> Deploy Agent Runbook to GitHub Pages.
2. Confirm the push landed on a branch that the workflow watches, or manually dispatch the workflow.
3. Confirm the run reached the Deploy to GitHub Pages step, not only the build/verify steps.
4. Confirm no restrictive \`paths\` filter skipped the workflow.
5. Confirm \`_site/agent-manual.md\`, \`_site/llms.txt\`, and \`_site/index.html\` exist in the build log.
6. Confirm Pages source is GitHub Actions, not branch/docs.

If deployment fails:

- Check workflow permissions: \`contents: read\`, \`pages: write\`, \`id-token: write\`.
- Ensure \`actions/configure-pages\` runs before artifact upload/deploy.
- Ensure artifact path is exactly \`_site\`.
- Ensure generated files are not empty.
- Ensure copied image paths exist.

## 10. Safety rules for agents

- Never print secrets, tokens, app secrets, cookies, private keys, or passwords.
- Never copy raw tool output into memory unless reviewed and safe.
- Never treat a target Task Bus design as a shipped feature.
- Never treat a channel message as proof that a formal task was accepted.
- Never bypass the Lark profile wrapper silently.
- Never write business-specific facts into workspace-global memory without owner approval.
- When uncertain, write to needs-review and ask for owner/admin confirmation.
`;

const llmsTxt = `# openHermit

openHermit is a local-first Loop Engineering workbench for operating digital employees / department agents.

Primary agent-readable manual: /agent-manual.md
Human HTML mirror: /index.html
Repository: https://github.com/yancyuu/Hermit

Key facts:
- Package: @yancyyu/openhermit
- Default route: /teams
- Default state: ~/.hermit/
- Runtime bridge: cc-connect
- Team state: ~/.hermit/teams/<team-slug>/team.json, messages/group.jsonl, tasks/board.json
- Current cross-team implementation: Redis-backed dispatch
- Target Task Bus model: offer / bid / lease / event
- Feishu/Lark isolation: PATH-level lark-cli wrapper reads nearest team .env and injects LARK_CLI_PROFILE
`;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>openHermit Agent Runbook</title>
  <meta name="description" content="Agent-readable openHermit operations and troubleshooting manual." />
  <meta property="og:title" content="openHermit Agent Runbook" />
  <meta property="og:description" content="A runbook for agents operating openHermit digital employee teams." />
  <meta property="og:image" content="docs/screenshots/openhermit/team-list.png" />
  <meta property="og:type" content="website" />
  <link rel="icon" href="resources/icons/png/1024x1024.png" />
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
      background: #09090b;
      color: #e4e4e7;
      line-height: 1.65;
    }
    header, main, footer { max-width: 1120px; margin: 0 auto; padding: 24px; }
    header { border-bottom: 1px solid #27272a; }
    .eyebrow { color: #22c55e; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    h1 { margin: 8px 0 12px; font-size: clamp(28px, 5vw, 54px); line-height: 1.05; }
    .lead { max-width: 860px; color: #a1a1aa; font-size: 16px; }
    .links { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
    a { color: #7dd3fc; }
    .links a { border: 1px solid #3f3f46; border-radius: 999px; padding: 8px 12px; text-decoration: none; color: #e4e4e7; }
    .shot { width: 100%; border: 1px solid #27272a; border-radius: 14px; margin: 22px 0; }
    pre.manual {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      background: #111113;
      border: 1px solid #27272a;
      border-radius: 14px;
      padding: 22px;
      font-size: 14px;
    }
    footer { color: #71717a; border-top: 1px solid #27272a; }
  </style>
</head>
<body>
  <header>
    <div class="eyebrow">Agent-readable operations manual</div>
    <h1>openHermit Agent Runbook</h1>
    <p class="lead">This page is written for AI agents and operators. It explains what openHermit is, how digital employee workspaces are structured, which workflow to follow, and how to isolate Feishu/Lark CLI profiles per team.</p>
    <nav class="links" aria-label="Artifacts">
      <a href="agent-manual.md">Raw Markdown</a>
      <a href="llms.txt">llms.txt</a>
      <a href="https://github.com/yancyuu/Hermit">GitHub</a>
      <a href="https://github.com/yancyuu/Hermit/actions/workflows/pages.yml">Pages CI</a>
    </nav>
    <img class="shot" src="docs/screenshots/openhermit/team-list.png" alt="openHermit teams workspace" />
  </header>
  <main>
    <pre class="manual">${escapeHtml(manual)}</pre>
  </main>
  <footer>
    Generated by scripts/build-pages.mjs. The Markdown file is the canonical agent-readable artifact.
  </footer>
</body>
</html>
`;

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });
writeText('agent-manual.md', manual);
writeText('llms.txt', llmsTxt);
writeText('index.html', html);
copyIfExists('docs/screenshots/openhermit');
copyIfExists('resources/icons');

console.log(`Built GitHub Pages site at ${OUT_DIR}`);
console.log('- index.html');
console.log('- agent-manual.md');
console.log('- llms.txt');
