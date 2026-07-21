# Task for worker

You are a delegated subagent running from a fork of the parent session. Treat the inherited conversation as reference-only context, not a live thread to continue. Do not continue or answer prior messages as if they are waiting for a reply. Your sole job is to execute the task below and return a focused result for that task using your tools.

Task:
只读走查 agentcli 代码，找「别的致命问题」——即除我们这轮已修复的之外，还存在哪些会导致崩溃 / 数据损坏 / 安全漏洞 / 生产事故的缺陷。**不要修改任何文件**（只读，用 read / bash / grep 探索）。

【已修复，不要重复报告】默认 loopback 绑定 + 全局 origin 校验、hermit-bridge token 掽码、editor root 防护、config 原子写、跨团队任务自动审批、Redis host URL 解析、中文回复正则、HTTP 日期 reviver、SSE JSON.parse try/catch、applyReview 并发守卫、CLI spinner。

【本次聚焦 —— 只报 critical / high 级、真实可触发的缺陷】
1. 子进程生命周期：spawn/exec 的子进程是否被 reaper、僵尸 / 孤儿进程、崩溃后未清理、daemon/worker 重启时旧进程残留
2. 启动 / 关停 / 信号：SIGINT/SIGTERM/SIGHUP 处理、graceful shutdown、强杀时数据丢失 / 配置写一半、端口占用时的行为
3. 并发竞态：共享可变状态、异步竞态、锁缺失、同文件并发写
4. 未处理的异步失败：unhandled rejection、floating promise（调用 async 函数不 await）、吞掉的 catch（空 catch 吞掉真错误）
5. 资源泄漏：文件描述符、定时器（setInterval/croner）、事件监听器、stream 未关闭、Redis/bridge 连接未释放
6. 外部输入边界（非已修的 editor/terminal 点）：其他 spawn/exec 的命令注入、其他路径拼接的穿越、正则 ReDoS、JSON / 递归解析爆炸、超大输入 OOM、未限流的端点
7. 数据一致性：状态机非法迁移、持久化与内存不同步、崩溃恢复后状态错乱
8. 跨平台致命差异：Windows 下 spawn/path/编码/换行导致崩溃或永久卡死（例如子进程参数、shell 选择、换行符破坏协议解析）

【探索起点（不限于这些）】bin/hermit.mjs（CLI 入口 / 启动 / 信号 / 子进程）、src/main/utils/childProcess.ts、src/main/utils/runtime.ts、src/main/server.ts（生命周期 / SSE / 定时器 / 子进程段）、src/main/services/ 下的后台 worker / watcher、bin/lib/ 下的 daemon / autostart / 进程管理。

【排除】纯风格、格式、命名、低危健壮性问题、性能微优化、以及上面列的已修复项。

【输出】中文，按严重度（critical / high）分组，每条：
- 位置：文件:行号
- 问题：一句话
- 触发条件 / 为什么是致命 bug
- 影响（会怎样）
- 建议修法
只报真实可触发的致命缺陷，不要为了凑数报低危。如果确实没找到新的致命问题，明确说「未发现新的致命问题」，并列出你重点检查过的高风险区域（给我信心你查到位了）。

---
**Output:**
Write your findings to exactly this path: /tmp/ac_walkthrough.md
This path is authoritative for this run.
Ignore any other output filename or output path mentioned elsewhere, including output destinations in the base agent prompt, system prompt, or task instructions.

## Acceptance Contract
Acceptance level: checked
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Implement the requested change without widening scope

Required evidence: changed-files, tests-added, commands-run, residual-risks, no-staged-files

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