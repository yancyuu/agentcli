# Task for reviewer

[Read from: /Users/yancyyu/code/agentcli/plan.md, /Users/yancyyu/code/agentcli/progress.md]

只读 code review,不要修改任何文件。

项目背景:agentcli 前端是 React + Redux(Vite 构建),有代码审查(code review)流程、团队消息面板、活动流、提及输入框。重点 store:src/renderer/store/slices/changeReviewSlice.ts。

你的聚焦区域:**code review UI flow & 前端高风险状态**。重点:src/renderer/store/slices/changeReviewSlice.ts、src/renderer/components/team/messages/MessagesPanel.tsx、src/renderer/components/team/activity/ActivityItem.tsx、src/renderer/api/httpClient.ts、src/renderer/components/ui/MentionableTextarea.tsx,以及 review 相关组件(可 grep changeReview / codeReview 定位)。

关注真实缺陷:
- changeReview flow 的 Redux 状态一致性(state 更新顺序、重复 dispatch、stale state)
- 异步 thunk 的错误处理、loading/error 状态遗漏、未处理的 rejection
- SSE/EventSource/轮询的生命周期:订阅是否在 unmount 时清理(内存泄漏、重复订阅)
- httpClient:请求取消(AbortController)、超时、重试导致重复写入、响应未 await
- XSS:dangerouslySetInnerHTML / innerHTML / 未转义渲染消息内容(成员消息里可能含任意文本)
- useEffect 依赖数组缺失/多余导致的 stale closure 或无限重渲染
- key 使用 index 导致的状态错位

不要报告纯风格问题。
输出:中文,按严重度分组,每条【文件:行号】【问题】【触发条件/为什么是 bug】【建议修法】,最后一句总体结论。

---
**Output:**
Write your findings to exactly this path: /tmp/ac_review_5_ui.md
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