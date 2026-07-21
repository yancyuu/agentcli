# Task for reviewer

[Read from: /Users/yancyyu/code/agentcli/plan.md, /Users/yancyyu/code/agentcli/progress.md]

只读 code review,不要修改任何文件。

项目背景:agentcli 是本地优先的工具,涉及文件持久化、CLI 凭据查找、cc-connect/hermit-bridge 代理、Redis 配置。

你的聚焦区域:**持久化 & provider auth & 运行时检测**。重点:src/main/utils/atomicWrite.ts、cliEnv.ts、redisConfig.ts、pathValidation.ts、pathDecoder.ts、cliPathMerge.ts、shellEnv.ts,以及 src/main/server.ts 里 /api/bridge、/api/cc、cc-connect project 绑定、hermit-bridge token 代理(约 350-530 行、1140 行附近、1400-1410 行)的相关逻辑。

关注真实缺陷:
- atomicWrite 是否真原子(temp+rename、并发写同一文件、fsync 缺失、partial write 后崩溃恢复)
- cliEnv 凭据查找路径(代码注释提到某 env var 会让 OAuth 凭据查不到导致 not logged in)是否有回归
- pathValidation / pathDecoder 是否能被构造输入绕过(编码、`..`、符号链接、空字节)
- token/credential/cookie 是否会被写进日志、错误响应、或 stderr 泄露
- hermit-bridge 代理的 token 处理(是否恒定、是否会被外部请求读取)
- normalizeRedisHost 的 URL 解析边界(redis://user:pass@host、带端口、带 path)

不要报告纯风格问题。
输出:中文,按严重度分组,每条【文件:行号】【问题】【触发条件/为什么是 bug】【建议修法】,最后一句总体结论。

---
**Output:**
Write your findings to exactly this path: /tmp/ac_review_4_persist.md
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