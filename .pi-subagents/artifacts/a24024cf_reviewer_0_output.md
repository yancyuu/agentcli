# Code Review — main 进程安全 / HTTP handler 输入校验 / 资源管理

范围:`src/main/server.ts`(7732 行)及其直接调用的 `src/main/ipc/`、`src/main/services/` handler。
方式:只读审计(grep + 逐段阅读关键 handler 与 helper)。**未修改任何文件。**

> 总览结论(详见各条):**最严重的问题是「网络层鉴权基本缺失」**。
> - 服务默认绑定 `0.0.0.0`(server.ts:176),即可被局域网内任意主机访问;
> - 全局没有任何 `addHook`/`preHandler`/`onRequest` 鉴权(grep 确认为 0);
> - 唯一的来源校验 `isTrustedBrowserOrigin` 在「Origin 头缺失时直接返回 true」(server.ts:1298-1299),等于对所有非浏览器客户端(curl / 脚本 / 局域网设备 / DNS rebinding)完全失效;
> - 102 条路由里只有 5 条调用了 `assertTrustedBrowserOrigin`,其余 97 条(含文件读写、配置改写、命令执行、自更新、MCP 工具调用)完全没有任何来源/身份校验。

---

## 🔴 Critical

### C1. `isTrustedBrowserOrigin` 在 Origin 缺失时返回 true → 全部来源校验形同虚设
- 【文件:行号】`src/main/server.ts:1297-1300`
- 【问题】`function isTrustedBrowserOrigin(origin) { if (!origin) return true; ... }` —— 只要请求不带 `Origin` 头即判为可信。
- 【为什么是 bug】`Origin` 头只在「跨源浏览器请求」中由浏览器自动加上。任何非浏览器 HTTP 客户端(本地恶意进程、下载的二进制、同一局域网内的设备、curl/脚本)都可以直接省略 `Origin` 头从而通过校验。又因 `HOST` 默认 `0.0.0.0`(server.ts:176、7702 `app.listen({ host: HOST })`),服务暴露在整个局域网。该函数是所有敏感路由唯一的网络层防线,被绕过后等于无鉴权。
- 【建议修法】改为「缺 Origin 一律拒绝」:`if (!origin) return false;`。同时建议新增全局 `onRequest`/`preHandler` 钩子统一强制校验,而不是依赖每个 handler 手动调用。若确需放行本地非浏览器工具,应改用显式本地 token / unix socket,而非「无 Origin = 可信」。

### C2. `/api/terminal/open-external` 任意命令执行(仅靠可绕过的来源校验)
- 【文件:行号】`src/main/server.ts:1956-1981`(路由)、`1856-1944`(`openCommandInSystemTerminal` / `shellQuote`)
- 【问题】该路由把请求体里的 `command` + `args` 拼成 shell 行,在系统终端执行(macOS 走 `osascript -e` 调 Terminal,Windows 走 `cmd.exe /c start ... cmd.exe /k`,Linux 走 `x-terminal-emulator -e sh -lc`)。
- 【触发条件】`assertTrustedBrowserOrigin(request)` 是它唯一的保护(见 C1,可被无 Origin 请求绕过)。任意能访问 5680 端口的主机发送 `POST /api/terminal/open-external`(`{"command":"...","args":[...]}`,不带 Origin)即可在用户机器上弹出终端执行任意命令。`/api/direct-cli/resume-in-terminal`(server.ts:1995-2053)同理(可指定任意 `cwd` + `resumeSessionId`)。
- 【建议修法】命令执行类路由必须强鉴权(本地 token / 仅监听 loopback);至少把 C1 的 `!origin return true` 改掉,并显式拒绝非 loopback 来源。长期应考虑是否真需要通过 HTTP 暴露「在宿主开终端」能力。

---

## 🟠 High

### H1. `/api/bridge/*`、`/api/cc/*`、`/api/v1/*` 代理把带 token 的 hermit-bridge Management API 完全裸暴露
- 【文件:行号】`src/main/server.ts:1323-1370`(`proxyToHermitBridge`)、`1381-1385`(`app.all` 注册)
- 【问题】代理在转发时自动注入 `Authorization: Bearer ${runtimeConfig.ccToken}`(1340-1341),但前端**没有任何鉴权或来源校验**。
- 【为什么是 bug】这等于把整套 hermit-bridge Management API(建/删项目、读写会话、cron、发消息、改设置……)以「已带合法 token」的身份向局域网完全开放。任何主机 `POST /api/cc/...` 即可冒充管理端。
- 【建议修法】在 `proxyToHermitBridge` 入口加 `assertTrustedBrowserOrigin(request)`(并配合 C1 修复);或对代理路径加独立鉴权。同时考虑默认 `HOST=127.0.0.1`。

### H2. `/api/editor/*` 系列可读写/删除/移动宿主任意文件,且无任何来源校验
- 【文件:行号】`src/main/server.ts:4507-4764`(`/api/editor/open|readFile|writeFile|createFile|createDir|deleteFile|moveFile|renameFile|listFiles|readBinaryPreview`)
- 【问题】这些路由用 `resolveEditorRoot(request.body.root)` 取项目根,但 `root` 是用户可控的任意**已存在目录**(server.ts:4459-4471),`resolveEditorPath` 只校验「相对 root 的包含关系」(4473-4484),不限制 root 本身。
- 【触发条件】攻击者 `POST /api/editor/open {"root":"/"} ` → 随后 `GET /api/editor/readFile?root=/&filePath=/etc/passwd`(或 `~/.ssh/id_rsa`、`~/.hermit/.../config.toml` 里的 token);亦可 `POST /api/editor/writeFile` / `deleteFile` / `moveFile` 改写/删除宿主任意文件。所有 editor 路由均**未调用** `assertTrustedBrowserOrigin`(grep 4490-4770 区间命中 0)。
- 【建议修法】(a) 所有 `/api/editor/*` 统一加来源校验;(b) `resolveEditorRoot` 增加白名单/最近打开项目登记校验,拒绝把 `/`、`~`、`~/.ssh` 等敏感目录作为 root;(c) 配合 C1。

### H3. `/api/hermit-bridge-config`、`/api/cc-config`(及 `/raw`)可无鉴权改写后端配置与 token
- 【文件:行号】`src/main/server.ts:1701-1712`(注册)、`1677-1687`(`handleWriteHermitBridgeConfig`)、`1631-1637`(`writeHermitBridgeConfig` / `writeHermitBridgeConfigRaw`)
- 【问题】POST 可覆写 hermit-bridge 的 `config.toml`,包括 `[management] token`、`[bridge] token`、`port` 等(1597-1630 的 replace 逻辑),且 `writeHermitBridgeConfigRaw` 直接整体覆写。无来源/身份校验。
- 【触发条件】局域网内 `POST /api/cc-config/raw {"content":"..."}` 即可改写后端配置,例如替换 bridge/management token 后接管 sidecar,或改端口造成 DoS。
- 【建议修法】配置改写类路由强制来源校验 + 二次确认;`/raw` 整体覆写建议移除或仅限 loopback。

### H4. `/api/update/apply` 可被远程触发执行 git checkout + npm install + build
- 【文件:行号】`src/main/server.ts:3609-3635`(路由)、`src/main/services/UpdateService.ts:142-148`(实际执行 `git fetch --tags` / `git checkout v<tag>` / `npm install` / `npm run build:web`)
- 【问题】该 SSE 路由无来源校验,触发破坏性自更新(切 git tag、重装依赖、重建产物)。
- 【为什么是 bug】无鉴权即可让任意主机把宿主仓库切到任意已存在 tag、跑 `npm install`(供应链/本地脚本执行面)。即便版本号受 `checkForUpdates` 约束,仍属高风险状态变更。
- 【建议修法】加来源校验 + 显式用户确认 token;自更新这类高危操作不应允许纯 HTTP 远程触发。

### H5. `/mcp`(JSON-RPC)无鉴权即可跨团队改任务状态
- 【文件:行号】`src/main/server.ts:3544-3600`(路由)、`3436-3525`(`executeMcpTool`)
- 【问题】`POST /mcp` `{"method":"tools/call","params":{"name":"claim_task","arguments":{...}}}` 等无任何来源/身份校验即可对任意 `team_slug` 执行 `claim_task`/`complete_task`/`deliver_task`/`accept_task`/`reject_task`/`reject_result`(以及 society_* 工具)。
- 【为什么是 bug】MCP over HTTP 通常面向受信客户端;此处直接暴露在 0.0.0.0 上且无鉴权,任意主机可冒领/完成/驳回他人任务、污染看板与跨团队派单。
- 【建议修法】对 `/mcp` 增加鉴权(本地 token 或仅 loopback);至少加来源校验。

---

## 🟡 Medium

### M1. `/api/config/browse-folders`、`/api/workspace/list` 可枚举宿主任意目录
- 【文件:行号】`src/main/server.ts:4407-4434`、`4436-4456`
- 【问题】`readdirSync(target)` 的 `target` 直接来自请求体 `path`/`dirPath`(缺省才用 `os.homedir()`),无 root 包含校验、无来源校验。
- 【触发条件】`POST /api/workspace/list {"dirPath":"/etc"}`、`{"dirPath":"/Users"}` 即可遍历任意目录(含文件名、大小、是否目录)。
- 【建议修法】加来源校验;限制可浏览根(项目目录 / 已登记工作区)。

### M2. `/api/teams/create` 无来源校验,且 `workDir` 完全由用户输入决定
- 【文件:行号】`src/main/server.ts:2110-2173`
- 【问题】无 `assertTrustedBrowserOrigin`;`workDir` 经 `~` 展开后直接存入团队 manifest(server.ts:2143),后续被 `resolveDirectCliWorkDir` 等用作 Claude 会话 cwd / 派单目标。`bindProject` 虽有 ASCII 校验(2126),但 `workDir`、`displayName` 未限制路径穿越/敏感目录。
- 【建议修法】加来源校验;对 `workDir` 做存在性 + 合法工作区校验,避免写入 `/`、`~/.ssh` 等。

### M3. 错误处理把内部信息直接回显客户端
- 【文件:行号】`src/main/server.ts:7667-7669`(`reply500` 返回 `err.message`),以及大量 `reply.send({ error: err.message })` / `String(err)`(如 2110、3089-3125、3609-3635、7112-7240、`proxyToHermitBridge` 1361 等)
- 【问题】把原始 `Error.message`(可能含绝对路径、文件名、上游 token 片段、堆栈摘要)直接返回客户端,构成信息泄露,且便于攻击者探测内部结构。
- 【建议修法】对外错误统一返回稳定文案 + 关联 id,详情仅写日志。

---

## 🟢 Low

### L1. CORS 配置无法替代服务端来源校验
- 【文件:行号】`src/main/server.ts:1311-1315`(`cors` 注册 `origin: allowedCorsOrigins`)
- 【问题】CORS 的 `origin` 数组只决定是否回 `Access-Control-Allow-Origin`,**不会阻止**请求到达后端(simple request / 表单 POST / 非浏览器请求一律可达)。当前安全完全依赖「每个 handler 手动调 assertTrustedBrowserOrigin」,而 102 条路由里只有 5 条这么做(1821、1844、1958、1995、7293),其余全部裸奔。
- 【建议修法】见 C1 —— 引入全局 `onRequest` 钩子统一强制来源/身份校验,而非逐路由手动。

---

## 已核查、未发现问题(供参考)

- **路径包含校验本身是正确的**:`resolveEditorPath`/`isPathInsideRoot`(4473-4484)、Skills 服务的 `isPathWithinRoot`(`SkillsMutationService.ts:122-133`、`SkillImportService` 的 `walkDirectory` 拒符号链接/隐藏文件)逻辑正确。Editor/Skills 的风险来自**网络层无鉴权**而非路径穿越。
- **SSE / 长连接清理正常**:`/api/events`(7291-7333)、`/mcp` GET(3516-3534)、`/api/update/apply`、`/api/extensions/.../download`(7627-7640)均在 `request.raw.on('close')` 中 `clearInterval` 并从 `sseClients` 删除,未发现监听器/定时器累积。
- **`waitForHarnessBridgeConnected`**(3846-3867)正确清理 timer 与 `bridge.off('connected', …)`,无监听器泄漏。
- **代理 SSRF**:`proxyToHermitBridge` 的 `target` 基于 `runtimeConfig.ccBaseUrl`(常量级配置),`stripPrefix` 为常量,`new RegExp(^${stripPrefix})` 不含用户输入,无 SSRF/ReDoS。
- **`spawnDetached`/`execFileAsync`**(1863-1916)本身用 `execFile`/`spawn`(数组参数,不经 shell);命令注入面仅在「拼 shellLine 传给系统终端」(C2),而非 child_process API 本身。

---

## 总体结论

main 进程在**功能正确性**上整体可用(SSE/路径包含/资源清理都做得不错),但**网络层安全是系统性的缺失**:
默认监听 `0.0.0.0` + 无任何全局鉴权 + `isTrustedBrowserOrigin` 对缺 Origin 放行 + 绝大多数敏感路由(文件读写、配置/token 改写、命令执行、自更新、MCP 工具)不校验来源。
**最优先**:修复 C1(缺 Origin 拒绝 + 全局 onRequest 钩子)并把默认 `HOST` 收敛到 `127.0.0.1`;随后对 C2/H1-H5 逐条加来源/身份校验。这些是真实可远程触发的缺陷,不是风格问题。