# 代码审查报告 — Code Review UI Flow & 前端高风险状态

审查范围：`changeReviewSlice.ts`、`MessagesPanel.tsx`、`ActivityItem.tsx`、`httpClient.ts`、`MentionableTextarea.tsx`、`ChangeReviewDialog.tsx` 及关联 review 组件。
审查类型：只读审查（未修改任何文件）。

## 总体结论

聚焦区域里**没有会立即导致数据损坏或崩溃的 Blocker**。异步流程的 staleness 防护（request token + epoch + fileVersion）写得很扎实，XSS 面也干净（`MarkdownViewer` 用 `ReactMarkdown`+`allowElement`/`unwrapDisallowed`，无 `rehype-raw`；highlight.js 输出已转义；成员消息正文不会走 `dangerouslySetInnerHTML`）。

但有一个对"代码审查流程"聚焦区影响最大的结构性问题：**`changeReviewSlice` 的整套 Phase-2 apply/undo/可编辑 diff 状态机在仓库里没有任何 UI 消费者**，属于"已接进 store 但未被任何组件渲染/调用"的死状态，无法通过 UI 验证。其余均为低危的健壮性/性能观察项。

---

## Blocker
无。

## High
无。

## Medium

### 【changeReviewSlice.ts:1045 / 1148 / 全文件】【Phase-2 review apply 状态机无 UI 消费者，属于无法验证的死代码】
**问题**：`applyReview`、`applySingleFileDecision`、`applying`、`applyError`、`hunkDecisions`、`fileDecisions`、`reviewUndoStack`、`editedContents`、`REVIEW_INSTANT_APPLY`、undo 快照、`saveEditedFile` 等大量状态/动作在 slice 中维护，但全仓库搜索（`src/renderer/**`）显示：
- `applyError` 在组件中**零读取者**；
- `applying` 在组件中**零读取者**；
- `hunkDecisions` 仅被 `utils/reviewKey.ts`（自身只服务于 slice）和 `api/httpClient.ts`（透传）引用，无组件读取；
- 唯一的 review UI `components/team/review/ChangeReviewDialog.tsx` 只渲染文件列表并调用 `fetchTaskChanges`，从不读取/触发任何 apply/hunk/undo 状态。

**触发条件/为什么是问题**：这意味着 `applyReview` 里精心写的 staleness 指纹比对、`mapCurrentToOriginalIndex` 的 hunk 索引映射、instant-apply、undo 栈、可编辑 diff 持久化等高风险逻辑，当前根本无法通过 UI 触达，也就无法回归验证；任何后续改动（尤其是 hunk 决策语义、`isMeta`/chunk 生成相关）都可能在无人察觉的情况下 silently drift。对一个"代码审查流程"为核心关注点的审查来说，这是最值得优先澄清的一点。
**建议**：确认这套 Phase-2 流程是否计划由新的 review 面板接入；若已废弃应整体移除以免误判可用性，若仍在路线图上应补一个最小的 apply/decision 消费组件与单测兜底（目前 `changeReviewSlice` 无任何测试）。

---

## Low / Note

### 【changeReviewSlice.ts:1045】【applyReview 无并发调用守卫，可被双击触发两次 apply】
**问题**：`applyReview` 入口直接 `set({ applying: true, ... })` 后进入 stale 校验 + `applyDecisions`，没有 `if (get().applying) return;` 之类的 in-flight 守卫。
**触发条件/为什么是问题**：若 UI 在 `applying` 翻转前的同一 tick 内被触发两次（双击或程序化连发），会发出两次 `applyDecisions`；第二次通常撞到 "File has been modified since agent changes" 而报错。危害有限（apply 大体幂等、第二次基本会失败），但会产生误导性的错误提示并浪费一次磁盘写。
**建议**：入口加 `if (get().applying) return;`，或用类似 `taskChangesCheckInFlight` 的 token。`applySingleFileDecision`（1148）同样既不翻 `applying` 也不做并发守卫，建议一并处理（当前因无消费者暂不可触发，见上条 Medium）。

### 【ActivityItem.tsx:913-914】【列表项内订阅全局 approval 状态，单条审批变更会重渲染整列】
**问题**：每个 `ActivityItem` 都 `useStore(useShallow(s => s.pendingApprovals))` 和 `resolvedApprovals`。组件虽用自定义 `memo` 比较器，但 store 订阅会**绕过** memo 比较器直接触发重渲染。`permissionIcon` 实际上只对 `structured.type === 'permission_request'` 的消息非空。
**触发条件/为什么是问题**：任意一次权限审批/resolve 事件，都会让时间线里**所有** `ActivityItem` 重渲染（O(n)），消息量大时明显卡顿。
**建议**：把 approval 状态读取下沉到只对 `permission_request` 类型消息渲染的子组件，或用 selector 只取 `requestId` 命中项。

### 【httpClient.ts:194】【SSE 监听器内 JSON.parse 未包 try/catch，畸形帧会抛异常】
**问题**：`this.eventSource?.addEventListener(channel, (event) => { const data = JSON.parse(event.data as string); ... })` 没有 try/catch。
**触发条件/为什么是问题**：服务端推送了非 JSON 帧或 keep-alive 注释帧时，`JSON.parse` 抛错会中断该事件的回调派发；EventSource 本身会存活，但该帧被静默丢弃且可能掩盖真实事件。
**建议**：`try { data = JSON.parse(...) } catch { return }`，并把解析失败 `console.warn` 以便排查。

### 【httpClient.ts:188-200】【SSE channel 监听器注册后永不注销，且 EventSource 永不 close】
**问题**：`addEventListener` 对每个 channel 只注册一次底层 SSE 监听，cleanup 只从 Set 里删回调，既不 `removeEventListener` 也不 `eventSource.close()`。
**触发条件/为什么是问题**：因为是单例 client，单实例内不算泄漏；但反复订阅/退订不同 channel 会留下空转的 no-op 监听器。属于设计取舍而非明确 bug，但与"订阅生命周期"关注点相关。
**建议**：可选——当某 channel 的回调集合为空时 `removeEventListener`；文档化 EventSource 的生命周期归属。

### 【MentionableTextarea.tsx:1090-1094】【轮换提示的嵌套 setTimeout 未纳入 cleanup】
**问题**：
```js
const interval = setInterval(() => {
  setTipVisible(false);
  setTimeout(advanceTip, 300); // 未被 cleanup 捕获
}, 10000);
return () => clearInterval(interval);
```
**触发条件/为什么是问题**：组件在 300ms 窗口内卸载时，`advanceTip` 仍会对已卸载组件 `setState`（React 18 为 no-op，但留下 dangling 定时器）。
**建议**：把内层 `setTimeout` 句柄存入变量并在 cleanup 里一并 `clearTimeout`。

### 【changeReviewSlice.ts:模块级缓存（taskChangesCheckInFlight/taskChangesNegativeCache/taskChangesPresenceRevalidationInFlight）】【跨团队/切换上下文时未按 team 作用域，且 stale in-flight 会写错选中态】
**问题**：三个 Set/Map 是模块级、全局共享；`checkTaskHasChanges` 顶部虽用 `get().selectedTeamName === teamName` 过滤 `selectedTask`，但 `await` 之后的 `set(...)` 与 `get().setSelectedTeamTaskChangePresence(teamName, taskId, ...)` **没有再次校验** `selectedTeamName === teamName`。
**触发条件/为什么是问题**：用户在请求 in-flight 时切换到另一个团队，迟到的响应会把 presence 写进当前（错误）选中态，造成短暂的 UI 误显；负缓存 30s TTL 会自愈。
**建议**：在 `await` 之后补一次 `get().selectedTeamName === teamName` 校验再写 `setSelectedTeamTaskChangePresence`；或为 in-flight 加 team 作用域。

---

## 正确 / 写得好的地方（有据可查）

- **异步 staleness 防护扎实**：`fetchAgentChanges`/`fetchTaskChanges`/`loadDecisionsFromDisk`/`fetchFileContent` 均用 `latestXxxRequestToken` + `changeSetEpoch` + `fileContentVersionByPath` 三重校验丢弃过期结果（见 changeReviewSlice.ts 各 thunk 内 `if (requestToken !== ...) return;` / `if (changeSetEpoch !== latest.changeSetEpoch) return;`）。
- **XSS 面干净**：`MarkdownViewer` 走 `ReactMarkdown`（未启用 `rehype-raw`），配 `allowElement` + `unwrapDisallowed` + `urlTransform`；`DiffViewer`/`renderHelpers` 的 `dangerouslySetInnerHTML` 仅承载 highlight.js 输出（已 HTML 转义）。成员任意文本不会以原始 HTML 注入。
- **httpClient 请求级超时与取消**：每个 `get/post/...` 都 `createTimeoutController` 配 `AbortController` + `setTimeout`，并在 `finally` 里 `clearTimeout`，无超时泄漏。
- **fetchFileContent 跳过/别名处理谨慎**：用 `filePath` 与 `canonicalFilePath` 双键跳过重复加载、清理别名，避免脏键残留。
- **clearChangeReview / resetAllReviewState**：bump epoch、清理 in-flight token、清空所有 persist debounce 定时器，状态重置完整。
- **MessagesPanel 重渲染治理**：对高频翻转的 `loadingHead`/`loadingOlder` 故意用 `useStore.getState()` 实时读而非订阅，避免重型面板在每次轮询时重渲染（有明确注释佐证）。
- **ActivityItem memo 比较器**：对 props 与 message 等价性比较覆盖较全。

---

## 残留风险（Residual Risks）

- `changeReviewSlice` 的 Phase-2 apply/hunk/undo/diff 流程无 UI 消费者且无单测，任何后续改动都无法通过现有 UI/测试回归（见 Medium 条目）。
- `changeReviewSlice`、`MessagesPanel`、`ActivityItem` 均无组件级/slice 级测试覆盖（仅 `teamMessageKey`/`teamMessageFiltering` 等 utils 有测试）。
- 因 `applyReview`/`applySingleFileDecision` 当前无 UI 触发路径，其并发守卫缺失问题暂不可被用户触发，但一旦接入 UI 即暴露。