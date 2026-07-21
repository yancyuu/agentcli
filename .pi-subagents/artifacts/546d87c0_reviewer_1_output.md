# 解析层 Code Review（只读）

聚焦区域：chunk 生成、isMeta 语义、成员消息解析、agent block、任务/subagent 过滤、结构化任务引用。
范围：`src/shared/**`、`src/main/types/**`、`src/main/services/session-intelligence/**`、`src/renderer/utils/**`、`src/renderer/api/**`、`src/renderer/store/slices/**`。
未发现 `plan.md` / `progress.md`（不存在），直接基于源码审查。

相关测试已实跑通过：`agentBlocks`(4)、`inboxNoise`(22)、`sessionExporter`(51)、`displayItemBuilder`(3)、`fileReferences`(29) — 共 109 通过。

---

## 🔴 Blocker
无。

---

## 🟠 严重度：中（Medium）

### M1. 回复块正则 `@([\w.-]+)` 不支持中文成员名，导致回复解析整体失败
- 【文件:行号】`src/renderer/utils/agentMessageFormatting.ts:15-19`（`REPLY_BLOCK_RE`），消费侧 `parseMessageReply` 同文件 `:36`；构造侧 `buildReplyBlock` `:48-57`；触发源 `src/renderer/components/team/TeamDetailView.tsx:1528`（`replyQuote.from = message.from`，即成员显示名）。
- 【问题】回复块格式为 `Reply on @<agentName> original message ...`，解析正则用 `@([\\w.-]+)` 捕获 agentName。`\w` 等价于 `[A-Za-z0-9_]`，**不含中文/任何非 ASCII 字符**，且正则未加 `u` flag。
- 【触发条件 / 为什么是 bug】项目规约（`AGENTS.md`/`CLAUDE.md`）明确要求“团队名、成员名、角色等用户输入必须支持中文”。当用户对中文名成员（如“产品经理”）点回复时，`buildReplyBlock` 会写出 `Reply on @产品经理 ...`，而 `parseMessageReply` 在接收侧（`ActivityItem.tsx:810`、`TaskCommentsSection.tsx:280/300`）匹配失败返回 `null`，回复退化为原始文本展示，丢失结构化回复 UI。已用 node 实跑验证：中文名 `exec` 返回 `null`，ASCII 名匹配成功。
- 【建议修法】把 agentName 捕获组改为 Unicode 友好且不贪婪到定界符，例如 `@(\\S[^\\n]*?)` 后接 ` original message`，或改用 `@([^\\s]+)` 并配合 `u` flag / 显式 Unicode 属性。需同步给 `parseMessageReply` 增加中文用例测试（当前无任何针对 `parseMessageReply`/`buildReplyBlock` 的测试）。

### M2. HTTP JSON reviver 把任意“长得像 ISO 日期”的字符串转成 Date，会污染/崩溃消息与工具文本
- 【文件:行号】`src/renderer/api/httpClient.ts:211-225`（`ISO_DATE_RE` + `reviveDates`），统一作用于 `parseJson` `:251`。
- 【问题】reviver 对解析树里**每一个**字符串值做 `ISO_DATE_RE.test(value)`，命中就 `new Date(value)` 返回。该正则是 `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z?$`，全锚定但**与字段名无关**，因此会误伤非时间戳字段。
- 【触发条件 / 为什么是 bug】当某条 user 消息的 `content`（旧格式为 string）、或某个 content block 的 `text`、或工具结果字符串恰好是裸 ISO 时间戳（如日志类任务里 Bash 输出一行 `2024-01-15T10:30:00Z`），该字符串会被替换成 `Date` 对象。随后：
  - `typeof msg.content === 'string'` 失败 → `isParsedRealUserMessage`/`isParsedUserChunkMessage` 误判，消息被错误分类或丢弃；
  - `block.text.startsWith('Base directory for this skill:')`（`displayItemBuilder.ts:492`、`toolLinkingEngine.ts:52`）等调用在 `Date` 上执行会抛 `startsWith is not a function`，直接崩溃渲染。
  这是“isMeta 语义 / 成员消息解析”链路上的真实运行时缺陷，触发面虽窄但后果是分类错误或异常。
- 【建议修法】不要用无差别字符串 reviver。改为只对已知时间戳字段（`timestamp`、`startTime`、`endTime`、`createdAt` 等白名单 key）做 revival；或在序列化侧用专用 envelope（如 `{__date__: iso}`）而非依赖字符串形态猜测。

---

## 🟡 严重度：低（Low）/ 注意事项

### L1. `groupTransformer` 直接 `endTime.getTime()`，未走 `toDate()` 防护
- 【文件:行号】`src/renderer/utils/groupTransformer.ts:511`（`durationMs = endTime.getTime() - startTime.getTime()`），来源 `:507-510`。
- 【问题】仓库内专门提供 `toDate()`（`aiGroupHelpers.ts:22`）来兼容“IPC 保留 Date / HTTP 变 string”两种形态，且 `displayItemBuilder`、`toolLinkingEngine`、`slashCommandExtractor` 等同层模块均通过 `toDate()` 取时间。此处却直接调 `.getTime()`。
- 【触发条件 / 为什么是 bug】当前因 HTTP 走 `reviveDates`、Electron IPC 走 structured clone，时间戳恰好都是 `Date`，所以不爆。但这是隐式耦合：一旦上游有任何字段未被 revive（例如新增字段、第三方直传 JSON、或 M2 修复后改为字段级 revival），此处会 `TypeError: getTime is not a function`。
- 【建议修法】`const startTime = toDate(steps[0]?.startTime ?? chunk.startTime)`，`endTime` 同理，与同模块其他位置保持一致。

### L2. `parseMessageReply` 正则用字面 `\n`，且非贪婪捕获对包含分隔符的内容有歧义
- 【文件:行号】`src/renderer/utils/agentMessageFormatting.ts:15-19`。
- 【问题】(a) 模式硬编码 `\n`，若内容被规范化为 `\r\n`（跨系统剪贴板/日志中转），```` ```\r\nReply ```` 不匹配 → 回复块无法解析。(b) `originalText`/`replyText` 用 `[\s\S]*?` 非贪婪，依赖 `, here is answer: "` 作为唯一定界；若用户原文本身包含 `", here is answer: "` 子串，`encodeReplyField` 已转义 `"` 为 `\"`，但非贪婪匹配仍可能提前截断（边界极窄，属健壮性问题而非确定 bug）。
- 【建议修法】分隔符串匹配容忍 `\r?\n`；并考虑用更显式的定界结构（如 JSON 体）承载 original/reply 以消除歧义。

### L3. `groupBySubagent` 用 FIFO 位置匹配 subagent 描述，并行 subagent 可能错配
- 【文件:行号】`src/renderer/utils/streamJsonParser.ts:295-340`（`pendingDescriptions.push` → `pendingDescriptions.shift()`）。
- 【问题】lead 侧遇到 `Agent`/`Task` tool_use 时把描述压入 `pendingDescriptions`，subagent 分组按出现顺序 `shift()` 取描述。stream-json 是时序流，但多个 subagent 可并行执行，输出顺序未必与发起顺序一致；一旦交错，描述会被错配到错误的 subagent section（纯展示问题，不影响数据正确性）。
- 【建议修法】优先用 tool_use 的 `id` ↔ subagent `agentId` 的显式映射（若流中可拿到 parent tool_use id），位置匹配仅作 fallback。

### L4. `wrapAgentBlock()` 在 `src` 内无任何生产调用方（仅类型声明/未使用）
- 【文件:行号】`src/shared/constants/agentBlocks.ts:105-109`（`wrapAgentBlock`）；全仓搜索（排除自身与 `.d.ts`）仅命中 test。
- 【观察】项目规约强调“不要手动拼接 agent block 标记，使用 `wrapAgentBlock(text)`”。已确认 `src` 内**不存在**手动拼接 `<info_for_agent>...</info_for_agent>` 的违规代码（所有消费方均走 `stripAgentBlocks`/`unwrapAgentBlock`/`extractAgentBlockContents`/共享正则），规约在可见代码层未被违反。但 `wrapAgentBlock` 本身未被调用，说明 agent block 的“构造”发生在本仓之外（如 hermit-bridge / agent 运行时），本仓只负责解析与剥离。属观察项，非缺陷。

---

## ✅ 正确项（带证据）
- **无手动 agent block 拼接**：`grep` 全 `src` 仅 `shared/constants/agentBlocks.ts` 使用 `AGENT_BLOCK_OPEN/CLOSE` 与 `<info_for_agent>` 字面量；其余 13 处消费方均 `import { stripAgentBlocks }` 等。规约合规。
- **isMeta 语义一致**：`isParsedUserChunkMessage`（`messages.ts:184` `isMeta===true` 排除）、`isParsedInternalUserMessage`（`:288` 要求 `isMeta===true`）、`isParsedTeammateMessage`（`:386` 非 meta 才判 teammate）、`displayItemBuilder.ts:402` 仅从 `!msg.isMeta` 的 user 响应里抽 teammate 消息 —— 分类边界自洽，未发现把 meta 误当成员消息或反之的逻辑。
- **Task/subagent 过滤一致**：`buildDisplayItems`（`displayItemBuilder.ts:128-138`）与 `buildDisplayItemsFromMessages`（`:298-302`、`:446-455`）都用 `taskIdsWithSubagents = subagents.map(s=>s.parentTaskId)` 跳过已有 subagent 的 Task 调用，避免重复展示。
- **agent block 多格式兼容**：`unwrapAgentBlock`/正则同时覆盖 current(`<info_for_agent>`)、legacy fenced、legacy xml(`<agent-block>`)、opencode 两类块；`createAgentBlockRegex()` 每次返回新实例避免 `g` flag 的 `lastIndex` 状态泄漏。
- ** teammate-message 解析与噪声过滤**：`parseAllTeammateMessages` 每次调用新建正则（无状态泄漏）；`inboxNoise` 的 `stripTeammateMessageBlocks`/`isThoughtProtocolNoise` 对未闭合 `<teammate-message` 也有兜底。
- **结构化任务引用**：`taskReferenceUtils.ts` 用零宽字符承载 `{taskId,teamName,displayId}` 编码 + `#displayId` 明文，`stripEncodedTaskReferenceMetadata`/`extractTaskRefsFromText` 往返自洽；`TASK_REF_REGEX` 仅与 `String.matchAll` 配合（matchAll 内部克隆正则，不依赖模块级 `lastIndex`），无状态污染。
- **类型守卫**：`isEnhancedUserChunk/SystemChunk/CompactChunk` 均同时校验 `chunkType` 与 `rawMessages`，`asEnhancedChunkArray` 对空数组返回 `[]`、非增强返回 `null`，调用方（`sessionDetailSlice.ts:207-212`）以 `detail && enhancedChunks` 正确区分。

---

## 残留风险（Residual Risks）
- M1、M2 均为“中文/特定内容输入”下才会显化的真实缺陷，当前测试集未覆盖（回复块解析零测试；reviver 无内容污染用例），回归不易被 CI 捕获。
- chunk→EnhancedChunk 的实际构建器不在 `src` 内（疑在 cc-connect sidecar / hermit-bridge），本次仅能审查 `src` 侧的类型守卫与消费逻辑，构建器本身的 isMeta 赋值/chunk 边界未在本仓可见，存在审查盲区。
- `wrapAgentBlock` 未被本仓调用，若外部构造方手动拼接将绕过本仓约束，需在构造侧单独保证。

---

## 总体结论
解析层整体设计自洽、isMeta 语义与 Task/subagent 过滤在可见代码中一致、agent block 规约未被违反；但存在两处需修的真实缺陷——**回复块正则不支持中文成员名（M1，直接违背项目中文支持规约）**与 **HTTP reviver 误伤裸 ISO 时间戳字符串（M2，可能污染消息分类乃至崩溃渲染）**，建议优先修复并补测试。