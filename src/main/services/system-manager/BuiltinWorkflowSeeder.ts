/**
 * BuiltinWorkflowSeeder — 将内置 workflow 作为 Claude Code 自定义命令。
 *
 * 官方测试过的 Hermit workflow 会预安装到用户级 `~/.claude/commands/hermit/`，
 * 成为所有团队 / cwd 可复用的 `/hermit:*` 斜杠命令。工作区级
 * `<workspace>/.claude/commands/` 仍作为兼容路径保留。
 */
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createLogger } from '@shared/utils/logger';

import type { WorkflowPromptSafety } from '@shared/types/systemManager';

const logger = createLogger('BuiltinWorkflowSeeder');

// ---------------------------------------------------------------------------
// Builtin workflow definitions
// ---------------------------------------------------------------------------

export interface BuiltinWorkflowDefinition {
  id: string;
  filename: string;
  commandName: `/${string}`;
  label: string;
  description: string;
  category:
    | 'overview'
    | 'health'
    | 'improvement'
    | 'usage'
    | 'compliance'
    | 'config'
    | 'loop'
    | 'connector'
    | 'worktree'
    | 'state'
    | 'team';
  safety: WorkflowPromptSafety;
  order: number;
  content: string;
}

const BUILTIN_WORKFLOW_MARKER = '<!-- hermit-builtin-workflow:v2-loop -->';

const READ_ONLY_SAFETY_RULES = `
## 安全边界

- 默认只读分析：不要修改、删除、移动、格式化、提交、推送、发布或部署任何文件。
- 不要运行 destructive 命令；需要命令时先说明目的，优先使用只读命令。
- 不要泄露 secrets、token、cookie、私钥或完整敏感路径。
- 如果发现需要修复的问题，只输出建议、验证步骤和可选 patch 计划，不要直接 apply。
- 输出报告时请标注证据来源、风险等级和下一步建议。
`;

const LOOP_ASSET_SCAN_SCOPE = `
## Loop Engineering 资产扫描范围

请优先检查这些资产是否存在、是否过期、是否冲突、是否值得沉淀成循环：

- 自动化：\`.github/workflows/\`、package scripts、cron/schedules、hooks、\`/loop\` 或 goal 类配置
- 工作树：\`.claude/worktrees/agent-*\`、git worktree 列表、分支/dirty 状态、陈旧 agent 工作区
- 技能：\`.claude/skills/\`、\`.hermit/skills/\`、\`~/.claude/skills/\` 的项目相关 skill
- 插件/连接器：\`.cursor/mcp.json\`、\`.claude/settings*.json\`、MCP/plugin 配置、\`src/main/services/extensions/**\`
- 子 Agent：\`.claude/agents/\`、team manifests、agent teams、subagent tracking
- 状态：\`.omc/state/\`、\`.omc/sessions/\`、reports、tasks、last-tool-error、mission/setup state
- 指令层：\`CLAUDE.md\`、\`AGENTS.md\`、\`.claude/commands/\`、\`workflows/\`
`;

export const BUILTIN_WORKFLOWS: BuiltinWorkflowDefinition[] = [
  {
    id: 'loop-scan',
    filename: 'loop-scan.md',
    commandName: '/loop-scan',
    label: 'Loop Scan',
    description: '扫描自动化、工作树、技能、连接器、子 Agent 和状态资产。',
    category: 'loop',
    safety: 'read-only',
    order: 5,
    content: `${BUILTIN_WORKFLOW_MARKER}\n# Loop Scan — 循环资产扫描

你是 Hermit Helm Loop 的 Loop Engineering 资产扫描员。目标不是写一次提示词，而是找出哪些资产会影响 Agent 自己循环运行。

${READ_ONLY_SAFETY_RULES}

${LOOP_ASSET_SCAN_SCOPE}

## 输出

请输出一份 Loop Scan 报告：

1. Automation surface：已有心跳、定时、hooks、CI、loop/goal 入口
2. Commands/workflows：当前 quick commands 和 workflow 文件是否完整、重复、过期
3. Worktrees/subagents：并行工作区、agent worktree、脏状态、陈旧风险
4. Skills/plugins/connectors：技能、MCP、插件、外部工具连通性
5. State layer：哪些状态落盘，哪些状态缺失，哪些状态已过期
6. Loop opportunities：最值得产品化的 3 个循环
7. Human review points：哪些地方必须由工程师审查，不能自动放行

不要修改文件。只输出证据和建议。
`,
  },
  {
    id: 'daily-folder-hygiene',
    filename: 'daily-folder-hygiene.md',
    commandName: '/daily-folder-hygiene',
    label: 'Daily Folder Hygiene',
    description: '每日只读扫描工作区是否有混乱目录、临时产物、陈旧报告或脏 worktree。',
    category: 'loop',
    safety: 'read-only',
    order: 8,
    content: `${BUILTIN_WORKFLOW_MARKER}\n# Daily Folder Hygiene — 每日目录整洁巡检

你是 Hermit Helm Loop 的工作区整洁巡检助手。目标是每天只读扫一遍文件夹是否变乱：临时文件、重复报告、陈旧 worktree、未知状态目录、未归档产物。

${READ_ONLY_SAFETY_RULES}

## 检查范围

- 根目录、reports/、plans/、.omc/、.claude/、workflows/、临时输出目录
- git status、git worktree、最近修改的大文件/二进制/截图/日志
- 重复命名、过期 report、没有 owner 的计划文件、未清理的 agent workspace

## 输出

1. Folder hygiene：Healthy / Warning / Messy
2. 证据路径和原因
3. 可安全清理候选（只提建议，不删除）
4. 需要人工确认的高风险项
5. 明天应该继续追踪的状态

不要修改文件。只输出整理建议。
`,
  },
  {
    id: 'daily-memory-conflict-check',
    filename: 'daily-memory-conflict-check.md',
    commandName: '/daily-memory-conflict-check',
    label: 'Daily Memory Conflict Check',
    description: '每日只读检查 CLAUDE/AGENTS/记忆/设置里的重复、过期和冲突指令。',
    category: 'loop',
    safety: 'read-only',
    order: 9,
    content: `${BUILTIN_WORKFLOW_MARKER}\n# Daily Memory Conflict Check — 每日记忆冲突巡检

你是 Hermit Helm Loop 的记忆一致性巡检助手。目标是每天只读检查长期指令、项目记忆、设置和状态是否互相冲突或过期。

${READ_ONLY_SAFETY_RULES}

## 检查范围

- CLAUDE.md、AGENTS.md、.claude/settings*.json、.claude/commands/
- 用户/项目 memory、.omc/state、reports 中反复出现的规则
- 相同偏好在不同层级重复、过期路径、互相矛盾的流程、安全边界冲突

## 输出

1. Conflict summary：None / Minor / Blocking
2. 冲突或重复的证据路径
3. 建议保留的唯一事实来源
4. 建议删除/合并/迁移的记忆项
5. 需要人工确认的问题

不要修改或写入 memory。只输出合并计划。
`,
  },
  {
    id: 'daily-workflow-extraction',
    filename: 'daily-workflow-extraction.md',
    commandName: '/daily-workflow-extraction',
    label: 'Daily Workflow Extraction',
    description: '每日从聊天和会话记录中提取重复 workflow，沉淀成下次可执行的 loop/skill/command。',
    category: 'loop',
    safety: 'read-only',
    order: 10,
    content: `${BUILTIN_WORKFLOW_MARKER}\n# Daily Workflow Extraction — 每日重复流程提取

你是 Hermit Helm Loop 的 workflow 提取助手。目标是每天只读看最近聊天、会话、任务和报告，把重复的人肉流程提取成下次可执行的 loop、skill、slash command 或 schedule。

${READ_ONLY_SAFETY_RULES}

## 检查范围

- 最近团队消息、任务看板、Claude 会话、reports、.omc/logs
- 重复出现的搜索步骤、验证步骤、发布步骤、排障步骤、成员分工
- 可以沉淀为 /command、skill、MCP recipe、schedule、team template 的流程

## 输出

1. Repeated workflows：按出现频率和价值排序
2. 每个 workflow 的触发条件、输入、步骤、验证门禁、停止条件
3. 建议沉淀位置：skill / command / schedule / team template / report
4. 下次可直接执行的 prompt 草案
5. 不应自动化、必须人工判断的边界

不要创建文件。只输出候选清单和草案。
`,
  },
  {
    id: 'summary',
    filename: 'summary.md',
    commandName: '/summary',
    label: 'Summary',
    description: '生成当前工作区的 Loop Ops 摘要和下一步建议。',
    category: 'overview',
    safety: 'reporting',
    order: 10,
    content: `${BUILTIN_WORKFLOW_MARKER}\n# Loop Ops Summary — 循环运维摘要

你是 Hermit Helm Loop 的 Loop Ops 摘要助手。请从 Loop Engineering 角度总结当前工作区状态：循环是否能自己找活、派活、验证、记录状态、推进下一步。

${READ_ONLY_SAFETY_RULES}

${LOOP_ASSET_SCAN_SCOPE}

## 输出

请输出：

1. Overall loop readiness：Healthy / Warning / Critical
2. Top risks：最多 5 条，尤其关注无人值守循环风险
3. Active loop assets：自动化、工作树、技能、插件/连接器、子 Agent、状态
4. Missing loop assets：缺什么会导致循环无法持续运行
5. Next best action：建议下一步运行哪个命令：/loop-scan、/loop-design、/doctor、/self-improve 等
6. Human judgment needed：哪些结果必须人工读，不要认知投降

如适合写报告，请建议路径：\`reports/loop/loop-summary-<date>.md\`，但不要自行写入，除非用户明确要求。
`,
  },
  {
    id: 'doctor',
    filename: 'doctor.md',
    commandName: '/doctor',
    label: 'Doctor',
    description: '诊断 Hermit、Claude Code、cc-connect 和 Loop runtime 健康。',
    category: 'health',
    safety: 'read-only',
    order: 20,
    content: `${BUILTIN_WORKFLOW_MARKER}\n# Loop Runtime Doctor — 环境与循环运行时诊断

你是 Hermit 运维诊断助手。请检查当前环境是否适合运行长期 Agent loop。

${READ_ONLY_SAFETY_RULES}

## 基础环境

- 操作系统、内存、磁盘、文件描述符限制
- \`claude\` 是否可用、版本、登录状态
- cc-connect / Hermit 服务是否运行
- 当前工作区路径是否正确

${LOOP_ASSET_SCAN_SCOPE}

## Loop runtime 重点诊断

- \`.claude/commands\` 是否包含 loop 相关命令，是否和 \`workflows/\` 重复
- \`.claude/worktrees/agent-*\` 是否过多、过旧、dirty
- \`.omc/state/subagent-tracking.json\` 和 \`.omc/state/last-tool-error.json\` 是否显示异常
- MCP/plugin/connector 配置是否存在明显缺失或 secret 风险
- 是否存在没有停止条件的循环、无人值守 apply、自动 commit/push/deploy 风险

## 输出

请输出诊断报告：正常项、警告项、异常项、证据路径、建议动作。不要修复问题。
`,
  },
  {
    id: 'self-improve',
    filename: 'self-improve.md',
    commandName: '/self-improve',
    label: 'Self Improve',
    description: '从对话、任务和配置中发现可循环化的系统性改进机会。',
    category: 'improvement',
    safety: 'proposal-only',
    order: 30,
    content: `${BUILTIN_WORKFLOW_MARKER}\n# Self Improve — Loop Improvement Planner

你是 Hermit 的自我改进 planner。目标不是直接修文件，而是发现哪些重复操作应该变成 loop、skill、command、connector、subagent 或状态文件。

## 强制安全规则

- 默认只读：不要修改任何文件。
- 不要直接改 \`~/.claude/CLAUDE.md\`、\`~/.claude/settings.json\`、项目 \`CLAUDE.md\`、team 文件、commands、agents 或 workflows。
- 不要写 memory；只提出哪些信息值得保存，以及为什么。
- 不要删除文件；只提出候选清理项和风险。
- 不要 apply patch、commit、push、release、deploy。
- 如果发现需要变更，输出明确 plan：目标文件、原因、建议 diff 摘要、风险等级、验证方式。

${LOOP_ASSET_SCAN_SCOPE}

## 必须寻找的改进机会

- 重复手动搜索：应变成 quick command 或 skill
- 重复 agent 分工：应变成 agent role 或 team template
- 重复连接器/MCP 配置：应变成 plugin/connector recipe
- 重复状态检查：应变成 state-scan 或 report loop
- 重复 CI/issue/commit triage：应变成自动化 loop
- 指令冲突：应移动到正确层级，而不是每次靠 prompt 纠正

## 输出

请输出 Loop Improvement Plan：

1. Candidate loop name
2. Trigger / heartbeat
3. Assets to scan
4. Agent/subagent split
5. Required skills/plugins/connectors
6. State file or board
7. Verification gate
8. Human review boundary
9. Implementation target and risk

本命令本身不要直接修改文件。
`,
  },
  {
    id: 'usage-report',
    filename: 'usage-report.md',
    commandName: '/usage-report',
    label: 'Usage Report',
    description: '汇总会话、子 Agent、工作树和循环吞吐线索。',
    category: 'usage',
    safety: 'reporting',
    order: 40,
    content: `${BUILTIN_WORKFLOW_MARKER}\n# Loop Usage Report — 循环吞吐报告

你是 Hermit 的循环吞吐分析助手。请分析当前工作区的 agent/session/worktree/state 使用情况，判断哪些循环花费大、停滞、重复，哪些值得自动化。

${READ_ONLY_SAFETY_RULES}

${LOOP_ASSET_SCAN_SCOPE}

## 分析目标

- 活跃 session、团队、子 Agent、worktree 数量和陈旧程度
- 高频/重型会话、重复任务、重复失败
- 哪些工作已经具备 loop 化条件：输入、工具、验证、状态
- token/上下文使用线索（如可用）

## 输出

1. Throughput overview
2. Expensive/repeated sessions
3. Subagent fan-out and review bottlenecks
4. Stalled worktrees or stale states
5. Automation candidates
6. Suggested consolidation into commands/skills/state

如适合写入报告，请建议 \`reports/loop/loop-usage-<date>.md\`，但不要自行写入，除非用户明确要求。
`,
  },
  {
    id: 'compliance-audit',
    filename: 'compliance-audit.md',
    commandName: '/compliance-audit',
    label: 'Compliance Audit',
    description: '审计循环、连接器、hooks、worktrees 中的安全风险。',
    category: 'compliance',
    safety: 'audit',
    order: 50,
    content: `${BUILTIN_WORKFLOW_MARKER}\n# Loop Safety Audit — 循环安全审计

你是 Hermit 的循环安全审计助手。请只读审计当前工作区中会影响无人值守 loop 的风险。

${READ_ONLY_SAFETY_RULES}

${LOOP_ASSET_SCAN_SCOPE}

## 重点风险

- destructive shell、git reset/rm、publish/deploy、自动 commit/push
- 没有停止条件的 loop、没有验证者的 apply loop
- hooks/settings 中的危险自动化
- MCP/plugin/connector 中的 secrets、token、私钥、宽权限
- commands/skills/plugins 中的 prompt injection surface
- 陈旧 worktree 中的敏感产物或未审查变更

## 输出

1. Overall risk level
2. Findings by severity
3. Evidence and affected paths
4. What not to automate
5. Required human review gates
6. Recommended containment / follow-up actions

不要修复问题；只输出审计报告和建议。
`,
  },
  {
    id: 'memory-config-health',
    filename: 'memory-config-health.md',
    commandName: '/memory-config-health',
    label: 'Memory/Config Health',
    description: '检查 loop 相关 memory、配置、commands、skills、状态分层。',
    category: 'config',
    safety: 'read-only',
    order: 60,
    content: `${BUILTIN_WORKFLOW_MARKER}\n# Loop Asset Health — 配置与状态健康检查

你是 Hermit 的 Loop Asset Health 检查助手。请只读检查当前工作区中所有影响 loop 的资产分层是否合理。

${READ_ONLY_SAFETY_RULES}

${LOOP_ASSET_SCAN_SCOPE}

## 输出

请输出：

1. Command/workflow inventory
2. Skill inventory
3. MCP/plugin/connector inventory
4. Subagent/worktree inventory
5. State inventory
6. Missing quick commands or skills
7. Stale/duplicated/conflicting assets
8. Suggested merge/move/add plan
9. Verification checklist

不要直接修改配置；只提出建议。
`,
  },
  {
    id: 'loop-design',
    filename: 'loop-design.md',
    commandName: '/loop-design',
    label: 'Loop Design',
    description: '根据现有资产设计一个可运行、可验证、可恢复的 Agent 循环。',
    category: 'loop',
    safety: 'proposal-only',
    order: 70,
    content: `${BUILTIN_WORKFLOW_MARKER}\n# Loop Design — 循环设计

你是 Loop Engineering 设计师。请基于当前工作区资产设计一个最小可用循环，而不是直接执行改动。

${READ_ONLY_SAFETY_RULES}

${LOOP_ASSET_SCAN_SCOPE}

## 输出模板

1. Loop name
2. Goal and stop condition
3. Heartbeat：manual / /loop / cron / CI / hook
4. Input sources：issues、CI、logs、state、reports、files
5. Work allocation：worktree strategy and subagent roles
6. Skills/plugins/connectors required
7. State file / board：循环如何跨 run 记忆
8. Verification gate：独立 verifier 怎么判断完成
9. Human review boundary：哪些必须人工读
10. Token budget and throttling
11. Failure modes and rollback

只输出设计，不创建文件。
`,
  },
  {
    id: 'connector-scan',
    filename: 'connector-scan.md',
    commandName: '/connector-scan',
    label: 'Connector Scan',
    description: '扫描 MCP、插件、连接器和外部工具配置。',
    category: 'connector',
    safety: 'audit',
    order: 80,
    content: `${BUILTIN_WORKFLOW_MARKER}\n# Connector Scan — 插件与连接器扫描

你是连接器审计助手。请只读扫描当前工作区和用户环境中与 MCP、插件、外部工具连接相关的配置。

${READ_ONLY_SAFETY_RULES}

## 扫描范围

- \`.cursor/mcp.json\`
- \`.claude/settings*.json\`
- \`~/.claude/plugins/installed_plugins.json\` 如存在
- \`src/main/services/extensions/**\`
- 任何提到 MCP、plugin、connector、server、token、headers、env 的配置

## 输出

1. MCP servers discovered
2. Plugin/connector assets
3. Missing credentials or unsafe credentials handling
4. Tools available to loops
5. Prompt injection / over-permission risks
6. Recommended connector recipes to productize

不要打印 secrets 的值。
`,
  },
  {
    id: 'worktree-scan',
    filename: 'worktree-scan.md',
    commandName: '/worktree-scan',
    label: 'Worktree Scan',
    description: '扫描 agent worktrees、并行工作区、脏状态和清理候选。',
    category: 'worktree',
    safety: 'read-only',
    order: 90,
    content: `${BUILTIN_WORKFLOW_MARKER}\n# Worktree Scan — 并行工作区扫描

你是 worktree 运维助手。请只读扫描当前 repo 的 git worktree 和 \`.claude/worktrees/agent-*\`。

${READ_ONLY_SAFETY_RULES}

## 检查

- git worktree list
- 每个 worktree 的 branch、HEAD、dirty 状态
- 是否存在陈旧 agent worktree
- 是否存在和主工作区冲突的改动
- 是否有未审查的大范围变更
- 是否有可清理候选，但不要删除

## 输出

1. Worktree inventory
2. Active vs stale
3. Dirty or risky worktrees
4. Review bottleneck
5. Cleanup candidates with evidence
6. Recommended next action
`,
  },
  {
    id: 'state-scan',
    filename: 'state-scan.md',
    commandName: '/state-scan',
    label: 'State Scan',
    description: '扫描 .omc/state、sessions、reports 和 loop 可恢复状态。',
    category: 'state',
    safety: 'read-only',
    order: 100,
    content: `${BUILTIN_WORKFLOW_MARKER}\n# State Scan — 循环状态扫描

你是状态层审计助手。长期 loop 不能依赖单次上下文，必须把状态写在磁盘、看板或报告里。请只读扫描当前工作区状态资产。

${READ_ONLY_SAFETY_RULES}

## 扫描范围

- \`.omc/state/mission-state.json\`
- \`.omc/state/subagent-tracking.json\`
- \`.omc/state/setup-state.json\`
- \`.omc/state/last-tool-error.json\`
- \`.omc/sessions/\`
- reports、tasks、TODO、workflow 输出
- 任何记录下一步、失败、阻塞、验证状态的文件

## 输出

1. State inventory
2. Fresh vs stale state
3. Last error / blockers
4. Missing persistent state for known loops
5. Suggested state file shape
6. What should go to Linear/board/report instead of prompt context

不要修改状态文件。
`,
  },
  {
    id: 'create-team',
    filename: 'create-team.md',
    commandName: '/create-team',
    label: 'Create Team',
    description: '通过 Hermit HTTP API 快速创建（provision）一个团队，不自动启动 agent。',
    category: 'team',
    safety: 'apply',
    order: 110,
    content: `${BUILTIN_WORKFLOW_MARKER}\n# Create Team — 创建团队

你是 Hermit 团队创建助手。目标是通过本地 Hermit HTTP API 快速创建（provision）一个团队目录与清单，让用户马上能在看板里看到并管理它。

## 安全边界

- 这是 \`apply\` 级别命令：可以调用 Hermit API 创建团队，但只做"创建/登记"，不做破坏性操作。
- 不要自动启动团队 agent：启动 agent 会拉起真实 CLI 进程并在目标 workDir 写代码，必须由用户显式触发（UI 点"启动"或单独命令），本命令不要替用户启动。
- 不要覆盖或删除已有团队；遇到重复 bindProject（HTTP 409）如实回报，不要强制重写。
- 创建前先只读确认 workDir 真实存在且是预期目录（\`test -d\`）；不要把敏感或无关目录设为 workDir，也不要在本命令里创建或改动 workDir 里的文件。
- 不要泄露 secrets/token。

## 参数

从用户的 \`$ARGUMENTS\` 解析，缺失则向用户询问，不要瞎猜：

- **bindProject**（必填）：团队唯一标识，slug 规则 \`^[a-z0-9][a-z0-9_-]*$\`（小写字母/数字/连字符/下划线，字母或数字开头）。例如 \`payment-svc\`。
- **displayName**（必填）：人类可读团队名。例如 "支付服务团队"。
- **workDir**（必填）：团队工作目录绝对路径，支持 \`~\`。例如 \`~/code/payment-svc\`。
- **harness**（可选，默认 \`claudecode\`）：运行时。可选如 \`claudecode\` \`codex\` \`cursor\` \`gemini\` \`opencode\` \`kimi\` \`iflow\` 等。
- **color**、**description**（可选）：团队颜色与描述。

## 步骤

1. 确认四个必填参数；bindProject 必须匹配 slug 正则，否则提示用户改名。
2. 只读确认 workDir 存在：\`test -d "$workDir" && echo ok\`。不存在则告知用户并停下，不要自动建目录。
3. 调用 Hermit API 创建团队（默认本地端口 5680，可用 \`HERMIT_API_URL\` 覆盖）：\`curl -s -X POST "\${HERMIT_API_URL:-http://127.0.0.1:5680}/api/teams/create" -H 'Content-Type: application/json' -d '{"bindProject":"<bindProject>","displayName":"<displayName>","workDir":"<workDir>","harness":"<harness>","color":"<color>","description":"<description>"}'\`
4. 解析响应：
   - 成功返回 \`{ "runId": "local:<bindProject>:<ts>" }\` → 团队已创建，可在 Hermit "团队" 看板看到。
   - HTTP 400 → 参数缺失或 bindProject 不合法，按提示修正后重试。
   - HTTP 409 → bindProject 已被其他团队占用，提示用户改名。
   - 连接被拒（端口没起）→ 提示用户先启动 Hermit 服务（web 模式或 Electron 应用）。

## 输出

1. 创建结果（runId / 成功）或具体错误与修复建议。
2. 下一步提示：团队已在看板可见；如需启动 agent，请在 UI 点"启动"或单独发起，本命令不自动启动。

不要在本命令里启动 agent，也不要改动 workDir 里的文件。
`,
  },
];

const BUILTIN_BY_FILENAME = new Map(BUILTIN_WORKFLOWS.map((item) => [item.filename, item]));
const BUILTIN_BY_COMMAND = new Map<string, BuiltinWorkflowDefinition>(
  BUILTIN_WORKFLOWS.map((item) => [item.commandName, item])
);
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function hermitHome(): string {
  return process.env.HERMIT_HOME || path.join(os.homedir(), '.hermit');
}

function globalClaudeCommandsRoot(): string {
  return path.join(os.homedir(), '.claude', 'commands');
}

export function getGlobalHermitWorkflowDir(commandsRoot = globalClaudeCommandsRoot()): string {
  return path.join(commandsRoot, 'hermit');
}

export function listBuiltinWorkflowMetadata(): BuiltinWorkflowDefinition[] {
  return [...BUILTIN_WORKFLOWS];
}

export function getBuiltinWorkflowByFilename(
  filename: string
): BuiltinWorkflowDefinition | undefined {
  return BUILTIN_BY_FILENAME.get(path.basename(filename));
}

export function getBuiltinWorkflowByCommand(
  commandName: string
): BuiltinWorkflowDefinition | undefined {
  return BUILTIN_BY_COMMAND.get(commandName.trim());
}

function shouldRefreshBuiltinWorkflow(
  existingContent: string,
  workflow: BuiltinWorkflowDefinition
): boolean {
  if (existingContent.includes(BUILTIN_WORKFLOW_MARKER))
    return existingContent !== workflow.content;
  const oldBuiltinHeadings: Record<string, string[]> = {
    'summary.md': ['# Ops Summary — 运维摘要'],
    'doctor.md': ['# Hermit Doctor — 环境诊断'],
    'self-improve.md': ['# Self Improve — 自我改进分析'],
    'usage-report.md': ['# Usage Report — 用量报告'],
    'compliance-audit.md': ['# Compliance Audit — 合规风险审计'],
    'memory-config-health.md': ['# Memory / Config Health — 配置健康检查'],
  };
  return (
    oldBuiltinHeadings[workflow.filename]?.some((heading) => existingContent.includes(heading)) ??
    false
  );
}

/**
 * 将内置命令文件复制到工作空间的 .claude/commands/ 目录。
 * 如果已存在同名文件则跳过（尊重用户自定义）。
 *
 * @param workspaceDir 工作空间根目录
 * @returns 实际复制的文件数量
 */
async function seedBuiltinWorkflowsIntoDir(targetDir: string): Promise<number> {
  let copied = 0;
  await mkdir(targetDir, { recursive: true });

  for (const workflow of BUILTIN_WORKFLOWS) {
    const targetPath = path.join(targetDir, workflow.filename);
    const exists = await stat(targetPath)
      .then(() => true)
      .catch(() => false);
    if (exists) {
      const existingContent = await readFile(targetPath, 'utf-8').catch(() => '');
      if (!shouldRefreshBuiltinWorkflow(existingContent, workflow)) continue;
    }

    await writeFile(targetPath, workflow.content, 'utf-8');
    copied++;
    logger.info(
      `${exists ? 'refreshed' : 'seeded'} builtin workflow: ${workflow.filename} → ${targetPath}`
    );
  }
  return copied;
}

export async function seedBuiltinWorkflows(workspaceDir: string): Promise<number> {
  try {
    return await seedBuiltinWorkflowsIntoDir(path.join(workspaceDir, '.claude', 'commands'));
  } catch (err) {
    logger.warn('failed to seed builtin workflows:', err instanceof Error ? err.message : err);
    return 0;
  }
}

export async function seedGlobalHermitWorkflows(
  commandsRoot = globalClaudeCommandsRoot()
): Promise<number> {
  try {
    return await seedBuiltinWorkflowsIntoDir(getGlobalHermitWorkflowDir(commandsRoot));
  } catch (err) {
    logger.warn(
      'failed to seed global Hermit workflows:',
      err instanceof Error ? err.message : err
    );
    return 0;
  }
}

/**
 * Ensure ~/.hermit/.claude/commands/ has the builtin commands.
 * Called once at app startup as fallback.
 */
export async function ensureGlobalWorkflows(): Promise<void> {
  const [globalCopied, legacyCopied] = await Promise.all([
    seedGlobalHermitWorkflows(),
    seedBuiltinWorkflows(hermitHome()),
  ]);
  if (globalCopied > 0) {
    logger.info(`seeded ${globalCopied} Hermit command(s) to ${getGlobalHermitWorkflowDir()}`);
  }
  if (legacyCopied > 0) {
    logger.info(
      `seeded ${legacyCopied} legacy builtin command(s) to ${path.join(hermitHome(), '.claude', 'commands')}`
    );
  }
}
