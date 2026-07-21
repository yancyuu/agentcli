# Task for reviewer

[Read from: /Users/yancyyu/code/agentcli/plan.md, /Users/yancyyu/code/agentcli/progress.md]

只读 code review,不要修改任何文件。

项目背景:agentcli 有团队/任务协作能力,通过 hermit-bridge 接飞书(Feishu/Lark),task 可以跨团队 dispatch。session key 形如 `feishu:{chat}:{user}`。

你的聚焦区域:**任务生命周期 & 团队消息路由**。重点:src/main/services/team-management/TaskDispatchService.ts、src/main/services/team-management/、src/main/utils/externalPlatformSessionRouting.ts、externalPlatformSessionKey.ts、teamProjectResolution.ts,以及 src/main/server.ts 里的 dispatch / platformAllowFrom / platformAllowChat / feishu: session 相关段落(约 788-880 行、2040-2220 行附近)。

关注真实缺陷:
- 任务状态机是否有非法迁移、状态丢失、孤儿任务
- dispatch 的竞态(重复分发、并发触发 onRuntimeStart/onCollabChange)、事件监听器泄漏(onCollabChange / onRuntimeStart 重复赋值未清理)
- normalizePlatformAllowFrom 的归一化逻辑(注意 `if (normalized.lark !== undefined) delete normalized.feishu` 这类分支会不会误删数据)
- `feishu:{chat}:{user}` session key 的解析/路由错误(含特殊字符、空值、大小写)
- teamName 被当成 `feishu:...` 这种平台 key 使用导致目录错乱

不要报告纯风格问题。
输出:中文,按严重度分组,每条【文件:行号】【问题】【触发条件/为什么是 bug】【建议修法】,最后一句总体结论。

---
**Output:**
Write your findings to exactly this path: /tmp/ac_review_3_task.md
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