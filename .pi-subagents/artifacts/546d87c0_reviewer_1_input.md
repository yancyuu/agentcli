# Task for reviewer

[Read from: /Users/yancyyu/code/agentcli/plan.md, /Users/yancyyu/code/agentcli/progress.md]

只读 code review,不要修改任何文件。

项目背景:agentcli 是 Node.js CLI + Fastify 服务 + React Web UI 的 AI 协作平台,解析 agent(Claude/Codex 等)的输出流并渲染成员消息/任务。

你的聚焦区域:**解析层 —— chunk 生成、isMeta 语义、成员消息解析、agent block、任务/subagent 过滤、结构化任务引用**。
先用 rg/grep 定位这些概念的实现(关键词:wrapAgentBlock、isMeta、chunk、parseMessage、agentBlock、subagent、taskRef、结构化任务),很可能分布在 src/main/services/session-intelligence/、src/shared/、src/renderer/。

特别关注(项目规约明确要求):
- 是否有地方**手动拼接 agent block 标记**,而不是用 wrapAgentBlock(text) —— 这是明确违规
- isMeta 语义是否被错误赋值/覆盖,导致成员消息被当成 meta 或反之
- chunk 生成的边界(流式分片、不完整 JSON、多行块)
- 成员消息解析、任务/subagent 过滤、结构化任务引用是否有遗漏或误判

关注真实缺陷:逻辑错误、边界/空值、流未关闭、正则贪婪/回溯、状态机非法迁移、类型与运行时不符。
不要报告纯风格问题。

输出:中文,按严重度分组,每条【文件:行号】【问题】【触发条件/为什么是 bug】【建议修法】,最后一句总体结论。

---
**Output:**
Write your findings to exactly this path: /tmp/ac_review_2_parse.md
This path is authoritative for this run.
Ignore any other output filename or output path mentioned elsewhere, including output destinations in the base agent prompt, system prompt, or task instructions.

## Acceptance Contract
Acceptance level: attested
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Return concrete findings with file paths and severity when applicable

Required evidence: review-findings, residual-risks

Finish with a fenced JSON block tagged `acceptance-report` in this shape:
Use empty arrays when no items apply; array fields contain strings unless object entries are shown.
`criteriaSatisfied[].status` must be exactly one of: satisfied, not-satisfied, not-applicable.
`commandsRun[].result` must be exactly one of: passed, failed, not-run.
`manualNotes` and `notes` are optional strings; an empty string means no note and does not satisfy `manual-notes` evidence.
```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "specific proof"
    }
  ],
  "changedFiles": [
    "src/file.ts"
  ],
  "testsAddedOrUpdated": [
    "test/file.test.ts"
  ],
  "commandsRun": [
    {
      "command": "command",
      "result": "passed",
      "summary": "short result"
    }
  ],
  "validationOutput": [
    "validation output or concise summary"
  ],
  "residualRisks": [
    "none"
  ],
  "noStagedFiles": true,
  "diffSummary": "short description of the diff",
  "reviewFindings": [
    "blocker: file.ts:12 - issue found, or no blockers"
  ],
  "manualNotes": "anything else the parent should know"
}
```