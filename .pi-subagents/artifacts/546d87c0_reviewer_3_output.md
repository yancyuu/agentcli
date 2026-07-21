# Code Review — 持久化 & Provider Auth & 运行时检测（只读）

范围：`src/main/utils/atomicWrite.ts`、`cliEnv.ts`、`redisConfig.ts`、`pathValidation.ts`、`pathDecoder.ts`、`cliPathMerge.ts`、`shellEnv.ts`，以及 `src/main/server.ts` 内 `/api/bridge`、`/api/cc`、`/api/v1` 代理、cc-connect project 绑定、hermit-bridge token 代理。

仓库状态：分支 `release/1.9.27`，工作区干净（仅 `.pi-subagents/` 未跟踪）。`plan.md` / `progress.md` 不存在，按指令直接对源码做只读审查。

---

## 🔴 High（安全）

### 1. 管理/桥接 token 通过未鉴权端点明文返回，且服务默认监听 `0.0.0.0`
- 【文件:行号】`src/main/server.ts:176`（`HOST = process.env.HOST ?? '0.0.0.0'`）；`src/main/server.ts:1391-1451`（`/api/hermit-config/raw` GET/POST）；`src/main/server.ts:1486-1511`（`readHermitBridgeConfig` 解析并返回 `management_token` / `bridge_token`）；`src/main/server.ts:1695-1709`（`/api/hermit-bridge-config`、`/api/cc-config` 及其 `/raw` 路由）。
- 【问题】
  - `/api/hermit-config/raw` 直接把 `~/.hermit/config.json` 原文吐出，其中 `ccToken`、`ccBridgeToken` 全明文（对比 `/api/hermit-config` GET 已做 `slice(0,4)+'****'` 掩码，说明设计上知道这是敏感值）。
  - `/api/hermit-bridge-config` 与 `/api/cc-config` 的 GET 返回解析后的 `management_token`、`bridge_token` 明文；其 `/raw` 变体更返回完整 TOML 原文。
  - 这 6 个路由 **都没有调用 `assertTrustedBrowserOrigin`**（全局 grep 仅 1821/1844/1958/1995/7293 行 5 处用，均为其他路由），也没有任何鉴权 hook。
  - `HOST` 默认 `0.0.0.0`：CORS 只能挡浏览器跨域读取，**非浏览器客户端（curl、同机/局域网任意进程、DNS rebinding 页面）完全无视 CORS**，可直接 GET 拿到 token。
- 【触发条件 / 为什么是 bug】任意能访问本机该端口的局域网主机（默认监听全网卡），执行一次 `curl http://<host>:<port>/api/hermit-bridge-config/raw` 即可拿到 hermit-bridge management/bridge token。任务清单明确要求检查“token/credential 是否会被写进错误响应/被外部请求读取”“hermit-bridge 代理的 token 是否会被外部请求读取”——这正是该问题。
- 【建议修法】
  1. 对所有读取/写入配置的路由统一加 `assertTrustedBrowserOrigin(request)`（或全局 `onRequest` hook）。
  2. 对 `*-config` 的解析返回与 `/raw` 都做 token 掩码（与 `/api/hermit-config` 现有掩码逻辑一致）；`/raw` 如确需原文，应要求显式鉴权或仅限本地回环来源。
  3. 将默认 `HOST` 改为 `127.0.0.1`，或在监听 `0.0.0.0` 时强制要求鉴权 token。

### 2. `/api/bridge/*`、`/api/cc/*`、`/api/v1/*` 是无鉴权开放代理，附带管理 token
- 【文件:行号】`src/main/server.ts:1326-1385`（`proxyToHermitBridge` 与三处 `app.all` 注册）。
- 【问题】`proxyToHermitBridge` 每次都把 `runtimeConfig.ccToken`（management token）以 `Authorization: Bearer ${token}` 注入转发请求；函数体内无 `assertTrustedBrowserOrigin`、无鉴权。结合 `0.0.0.0`，局域网任意主机可借这个代理驱动 hermit-bridge 的**全部 management API**（创建/删除 project、改配置、心跳控制等），token 由代理自动补齐。
- 【触发条件 / 为什么是 bug】代理目标是 `127.0.0.1:9820`（loopback），但攻击者不需要直连 9820，只要打这个开放代理即可；等于把 hermit-bridge 管理面整体暴露到 LAN。
- 【建议修法】给这三个 `app.all` 加 `assertTrustedBrowserOrigin`（或更严格的本地来源校验）；若需要远程管理，改为显式鉴权 + 回环绑定二选一。

---

## 🟡 Medium

### 3. `normalizeRedisHost` 不处理 userinfo / 端口 / path / TLS 标记
- 【文件:行号】`src/main/utils/redisConfig.ts:11-19`。
- 【问题】实现仅 `replace(/^(rediss?|https?):\/\//i, '')` + 去尾斜杠。注释声称“operator-entered URLs work without manual cleanup”，但：
  - `redis://user:pass@host:6379/0` → 归一化后 `host` = `user:pass@host:6379/0`，ioredis 把它当裸 hostname 做 DNS 解析，**连接永远起不来**（团队 bus + usage 静默失效，正是该函数要修的那类问题）。
  - `redis://host:6379` → `host` 携带 `:6379`，与配置里的 `port` 字段重复/冲突。
  - `rediss://host`（TLS）scheme 被剥掉后 TLS 信息丢失，ioredis 会用明文连一个期待 TLS 的服务，可能失败或语义错乱。
  - `redisConfig.test.ts` 仅覆盖“scheme + 尾斜杠”这类最简输入，没有任何带 userinfo/port/path/TLS 的用例，故缺陷未被现有测试拦截。
- 【触发条件 / 为什么是 bug】运维从云厂商控制台复制带账号密码的 Redis URL 直接粘贴。
- 【建议修法】用 `new URL()` 解析：从 URL 取 `hostname` 作 `host`，`port` 回填到 `cfg.port`（若用户没显式给），`username/password` 回填到 cfg，`rediss://` → 设 `tls`；解析失败再回退到当前的字符串裁剪。至少应在检测到 `@` / 路径段时拒绝并给出明确错误，而不是静默产生非法 host。

### 4. `~/.hermit/config.json` 等含 token 的文件写入非原子
- 【文件:行号】`src/main/server.ts:302/314/394/406/440/1631/1636`（全部用 `writeFileSync`）；对比 `src/main/services/identity/AgentTeamsIdentityStore.ts:182` 已用 `atomicWriteAsync`。
- 【问题】仓库已有成熟的 `atomicWriteAsync`（temp+fsync+rename+EXDEV/Windows 重试），但 server 里所有配置写入仍走裸 `writeFileSync`。进程在写 `config.json`/`config.toml` 中途崩溃 → 文件被截断/部分写入 → 下次启动 `loadConfig` 触发 `SyntaxError` 自动修复分支，修复时**用 defaults 覆盖**，可能丢掉用户自定义的 baseUrl/token。
- 【触发条件 / 为什么是 bug】崩溃/断电/磁盘满发生在 `writeFileSync` 写到一半。`atomicWrite` 模块本就是为消除这类风险而存在，这里没用。
- 【建议修法】把这些 `writeFileSync(...)` 统一替换为 `atomicWriteAsync`（注意函数要变 async，调用点已多为 async handler，迁移成本低）；至少 `saveConfig`、`writeHermitConfigRaw`、`writeHermitBridgeConfig`、`writeHermitBridgeConfigRaw` 与自动修复分支必须改。

---

## 🟢 Low / Note

### 5. `atomicWriteAsync` 未 fsync 父目录（耐久性，非正确性）
- 【文件:行号】`src/main/utils/atomicWrite.ts:45-78`。
- 【观察】temp 文件 `fsync` 后 `rename`，流程正确；同一目录 temp+rename 保证同卷原子性；并发写同一 target 各自独立 temp、最后 rename 胜出，无交叉损坏；partial-write + 崩溃时 target 不受影响（temp 永不 rename 上去）。整体实现健康。唯一缺口：未对父目录 `fsync`，断电后 rename 可能不落盘（POSIX 耐久性细节）。属于 best-effort 取舍，非 bug；如需更强耐久性可在 rename 成功后对 `path.dirname(targetPath)` 做 `fsync`。

### 6. `cliEnv` 的 `CLAUDE_CONFIG_DIR` 逻辑无回归（正向确认）
- 【文件:行号】`src/main/utils/cliEnv.ts:38-46`。
- 【观察】`isCustomConfigDir = getClaudeBasePath() !== getAutoDetectedClaudeBasePath()`，二者在没有 `setClaudeBasePathOverride` 时都走 `getDefaultClaudeBasePath()`（= `~/.claude`），相等 → 不下发 `CLAUDE_CONFIG_DIR`，保留 macOS Keychain 默认命名空间，避免注释所述“not logged in”回归。逻辑与注释一致，无问题。

### 7. `pathValidation` 整体稳健，少量边角
- 【文件:行号】`src/main/utils/pathValidation.ts`。
- 【观察】
  - `validateFilePath`：词法敏感匹配 → allowed-dir → `realpathSync.native` 二次校验敏感匹配 + allowed-dir，能有效挡符号链接逃逸（含指向 `/etc/passwd` 的 symlink）。正向。
  - 写目标场景：文件不存在时 `resolveRealPathIfExists` 返回 null，realpath 二次校验被跳过；若同目录后续被植入恶意 symlink 仍可逃逸，但该函数语义为读校验，可接受。
  - 全路径未显式拒绝空字节（`INVALID_FILENAME_CHARS` 只用于 `validateFileName`）；Node fs 对含 NUL 的路径会抛 `ERR_INVALID_ARG_VALUE`，实际不会读盘，影响低。
  - `SENSITIVE_PATTERNS` 未覆盖 `.envrc`（direnv，进入目录即执行 shell）、`.netrc`。建议补 `[/\\]\.envrc$/i`、`[/\\]\.netrc$/i`。

### 8. `pathDecoder` / `cliPathMerge` / `shellEnv` 未发现实质缺陷
- `pathDecoder.decodePath` 自承认对含连字符路径有损（已加 `extractProjectName(encodedName, cwdHint)` 优先用真实 cwd 缓解）；`isValidEncodedPath`/`isValidProjectId` 对控制字符、Windows 保留名、多余冒号有校验。
- `cliPathMerge` 去重 PATH、解析 symlink bin 目录、平台分支合理。
- `shellEnv`：login→interactive→空对象 回退链清晰；失败冷却 60s；`normalizeShellEnvSource` 把外部 `source` 标签做白名单清洗后再进日志（防注入）。token 不入日志。正向。

### 9. 测试覆盖缺口
- 【文件:行号】`src/main/utils/`。`atomicWrite.ts`、`pathValidation.ts`、`pathDecoder.ts` 均无单测（同目录仅 `redisConfig.test.ts`、`externalPlatformSessionKey.test.ts`）。鉴于这些模块承载“凭据查找、路径沙箱、原子写”等安全敏感职责，建议补：atomicWrite 并发/EXDEV/崩溃恢复、pathValidation 符号链接逃逸与 null 字节、pathDecoder 往返与复合 projectId。

---

## 总体结论

持久化与运行时检测核心实现（`atomicWriteAsync`、`cliEnv` 的 `CLAUDE_CONFIG_DIR` 守卫、`pathValidation` 的 realpath 二次校验、`shellEnv` 的日志清洗）质量良好且无明显回归；**真正的风险集中在 server 层的凭据暴露**——默认 `0.0.0.0` 监听 + 未鉴权的 raw config / 开放代理路由会把 hermit-bridge management/bridge token 明文交给局域网任意主机，建议在合入前优先修复 High-1/High-2，并补上 `normalizeRedisHost` 的 URL 完整解析与配置文件原子写。

---