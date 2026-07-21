# Task for reviewer

[Read from: /Users/yancyyu/code/agentcli/plan.md, /Users/yancyyu/code/agentcli/progress.md]

只读 code review,不要修改任何文件。

项目背景:agentcli(@yancyyu/agentcli)是 Node.js CLI + Fastify 本地 Web 服务 + 浏览器 Web UI 的「AI 工程协作平台」。入口 bin/hermit.mjs,主进程 src/main/server.ts(约7700行),通过 hermit-bridge 接 cc-connect / 飞书。技术栈:Node + Fastify + @fastify/cors + @fastify/static。

你的聚焦区域:**main 进程安全、HTTP/IPC handler 输入校验、资源管理**。重点文件:src/main/server.ts、src/main/ipc/、src/main/services/ 里被 HTTP 路由直接调用的 handler。

关注真实缺陷:
- 每个 POST/PUT/PATCH/DELETE handler 是否校验 body/params(必填字段、类型、长度、边界)
- 文件系统操作是否有路径穿越(用户可控输入拼进 path)
- spawn/exec/execSync 是否有命令注入(用户可控输入拼进命令串)
- assertTrustedBrowserOrigin / CORS origin 校验能否被绕过(注意 isTrustedBrowserOrigin 里 `if (!origin) return true` 这类逻辑)
- SSE / 长连接 / 定时器(croner / setInterval)的资源泄漏与监听器累积
- 错误处理:被吞掉、或把内部路径/token/堆栈直接返回给客户端
- 共享可变状态的竞态

不要报告:纯风格/格式/命名/注释/性能微优化。

输出:中文,按严重度(critical/high/medium/low)分组,每条给出【文件:行号】【问题一句话】【触发条件/为什么是 bug】【建议修法】。最后给一句总体结论。

---
**Output:**
Write your findings to exactly this path: /tmp/ac_review_1_main.md
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