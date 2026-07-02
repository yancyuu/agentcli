#!/usr/bin/env node
/**
 * openHermit CLI - production entry point.
 *
 * Usage:
 *   npm install -g @yancyyu/openhermit
 *   openhermit                # open terminal navigation
 *   openhermit --daemon       # start Web UI on default port 5680
 *   openhermit --version      # show version
 *   openhermit update         # check and install updates
 *
 * Or without global install:
 *   npx @yancyyu/openhermit
 *   npx @yancyyu/openhermit --port 8080
 */

import { spawn, execSync } from 'node:child_process';
import crypto from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { BRAND, brandCommand, brandLogPrefix } from './branding.mjs';
import {
  args,
  commandArgs,
  jsonRequested,
  currentVersion,
  pkg,
  repoRoot,
  binDir,
  require,
  port,
  skipHermitBridge,
  hermitHome,
  daemonRequested,
  daemonChild,
  daemonPidPath,
  daemonLogPath,
  runtimeLogPath,
  serverLogPath,
  hermitSettingsPath,
  telemetryDir,
  telemetryWorkerPidPath,
  telemetryWorkerStatusPath,
  telemetryWorkerLogPath,
  telemetryWorkerErrorLogPath,
  conversationUploadLogPath,
  legacyRuntimeBridgeDir,
  hermitBridgeDir,
  legacyRuntimeBridgeConfigPath,
  defaultHermitBridgeConfigPath,
  legacyRuntimeBridgeDataDir,
  defaultHermitBridgeDataDir,
  hermitBridgeConfigPath,
  starterProjectName,
  findOptionValue,
  findOptionValues,
  findAnyOptionValues,
  findAnyOptionValue,
} from './lib/env.mjs';
import {
  cancelCli,
  printJson,
  ansi,
  ui,
  glyphs,
  useUnicodeUi,
  isInteractiveCli,
  createPromptInterface,
  askText,
  askRequired,
  askChoice,
  charDisplayWidth,
  stripAnsi,
  displayWidth,
  fitDisplay,
  truncateDisplay,
  statusDot,
  rowStatusDot,
  formatStatusPill,
  colorByState,
  rowStateFromValue,
  printStatusBar,
  boxLine,
  boxContentLine,
  boxColumnsLine,
  menuColumnsLine,
  panelWidth,
  printCliRows,
  menuBrandTitle,
  navHeaderLine,
  printWelcomeLogo,
  clearTerminal,
} from './lib/terminal.mjs';
import {
  checkDependency,
  escapeTomlPath,
  parseTomlToken,
  randomToken,
  escapeRegExp,
  findProjectBlock,
  isManagedBootstrapBlock,
  isStarterProjectConfig,
  configRequiresClaudeCode,
  hasProjectEntries,
  commandExists,
  ensureClaudeCodeCliIfNeeded,
  hasTomlSection,
  buildOpenHermitStarterConfig,
  normalizeMigratedHermitBridgeConfig,
  migrateLegacyHermitBridgeDataIfNeeded,
  normalizeHermitBridgeConfigFileIfNeeded,
  migrateLegacyHermitBridgeConfigIfNeeded,
  ensureOpenHermitRuntimeConfig,
  readHermitBridgeConfigState,
  waitForHermitBridge,
  appendLog,
  printLogTail,
  readLogTail,
  printDeveloperUploadLogs,
  waitForRuntimeReady,
  resolveHermitBridgeRunner,
  resolveTsxLoader,
  resolveAliasLoaderRegister,
  checkExistingOpenHermitServer,
  isTcpPortAvailable,
  assertWebPortAvailable,
} from './lib/runtime.mjs';
import { runUpdate, runAddPlugin } from './lib/update.mjs';
import { runAikey, runAikeyStatus, parseActiveEnv } from './lib/aikey.mjs';
import { describeUploadToggle, resolveConversationUploadEnabled } from './lib/uploadState.mjs';
import {
  USAGE_UPLOAD_PROVIDER_OPTIONS,
  fetchAuthoritativeUsage,
  fetchRemoteUsageStatus,
  formatUploadProviders,
  normalizeUploadProviders,
  uploadProviderLabel,
} from './lib/usageRemote.mjs';
import { cursorPendingRows, formatNumber, localServerRows } from './lib/usageRows.mjs';
import { aggregateUploadProgress, uploadProgressLabel } from './lib/usageProgress.mjs';
import {
  NAV_ACTIONS,
  WEB_ENTRY_ACTIONS,
  SERVICE_ACTIONS,
  LOCAL_USE_ACTIONS,
  TEAM_COLLAB_ACTIONS,
  EMPLOYEE_ACTIONS,
  RUNTIME_ACTIONS,
  LOCAL_COLLECTION_ACTIONS,
  TASK_BUS_ACTIONS,
  ACCOUNT_ACTIONS,
  findMenuAction,
  menuFooterForEscape,
} from './lib/menus.mjs';
import { installLarkCli } from './lib/larkCli.mjs';
import {
  ensureFeishuCodexBridge,
  configureFeishuBridge,
  feishuBridgeConfigured,
  startFeishuBridge,
  stopFeishuBridge,
  feishuBridgeStatus,
  feishuBridgeState,
  feishuBridgeWebUrl,
} from './lib/feishuBridgeCli.mjs';
import {
  readDaemonPid,
  refreshDaemonPidFromReadyServer,
  isPidRunning,
  removeDaemonPidFile,
  signalDaemon,
  listProcessesWin,
  collectFallbackPids,
  stopFallbackProcesses,
  collectDaemonStatus,
  printDaemonStatus,
  stopDaemon,
  waitForOpenHermitServerReady,
  startDaemon,
} from './lib/daemon.mjs';
import { chmodBestEffort, safeReadJson, readHermitSettings, writeHermitSettings, buildTeamCollaborationTaskBusConfig, enableTeamCollaborationDefaults } from './lib/settings.mjs';
import {
  getAuthStorePath,
  ensureAuthStoreDir,
  normalizeExpiry,
  readOpenHermitAuthStore,
  isAuthTokenExpired,
  authStatusFromStore,
  normalizeScopes,
  normalizeAccessTokenPayload,
  mergeAuthToken,
  readOpenHermitAuthStatus,
  writeOpenHermitAuthStore,
  deleteOpenHermitAuthStore,
  getOAuthConfig,
  hasRawOAuthConfig,
  normalizeControlUrl,
  resolveConversationUploadBaseUrl,
  isSourceCheckout,
  getDefaultDeviceAuthBaseUrl,
  getDeviceAuthConfig,
  assertOAuthConfigured,
  base64Url,
  randomOAuthValue,
  buildCodeChallenge,
  buildAuthorizationUrl,
  openExternalUrl,
  escapeHtml,
  buildAuthCallbackHtml,
  startOAuthCallbackServer,
  exchangeAuthorizationCode,
  fetchOAuthUserInfo,
  buildAuthStoreFromToken,
  performRawOAuthLogin,
  startDeviceAuthSession,
  normalizeHermitAuthIdentity,
  waitForAuthPollInterval,
  pollDeviceAuthToken,
  performDeviceAuthLogin,
  performOpenHermitLogin,
  refreshExpiredOpenHermitToken,
  refreshOpenHermitAuthStatus,
  authStatusPayload,
  failAuthRequired,
  requireOpenHermitAuthForCommand,
  isAuthCommandAllowedWithoutLogin,
  isLocalCommandAllowedWithoutLogin,
  requireOpenHermitAuthForEntry,
  parseAuthLoginOptions,
  buildDevAuthStore,
  promptDevUnlockCode,
  runAuthDevLogin,
  printAuthStatus,
  runAuthLogout,
  runAuthLogin,
  AUTH_CALLBACK_PATH,
  AUTH_STORE_SCHEMA_VERSION,
  DEFAULT_OPENHERMIT_CLOUD_HOST,
  OPENHERMIT_AUTH_BROKER_URL,
  OPENHERMIT_CONVERSATION_UPLOAD_BASE_URL,
  DEV_AUTH_UNLOCK_CODE,
} from './lib/auth.mjs';
import {
  listDirectoryNames,
  isSafeTeamArg,
  isValidBindProject,
  normalizeWorkDir,
  generateBindProject,
  isHiddenTeam,
  collectTeams,
  resolveTeamSlug,
  mapTaskStatus,
  collectTasks,
  printDoctor,
  printTeamsList,
  buildTeamCreateSeed,
  promptForMissingTeamCreateFields,
  failTeamCreate,
  createLocalTeam,
  printTeamsCreate,
  printTasksList,
} from './lib/teams.mjs';

process.once('SIGINT', cancelCli);

const versionIndex = args.indexOf('--version');
if (versionIndex !== -1) {
  console.log(currentVersion);
  process.exit(0);
}

const helpIndex = args.indexOf('--help');
if (helpIndex !== -1) {
  console.log(`
${BRAND.stylizedName} - 本地 AI runtime 工作区控制面

用法:
  ${BRAND.cliCommand} [options]

常用选项:
  --port <number>    HTTP 服务端口（默认：5680）
  --no-hermit-bridge 不自动启动内置 runtime bridge
  --daemon           在后台启动 Web 控制台
  --version          显示当前版本
  --help             显示帮助

命令:
  ${BRAND.cliCommand}         打开终端导航，选择本地使用、团队协作或用户授权
  web [--json]       直接启动并打开本地数字员工工作台（Web），跳过终端导航
  status [--json]    查看后台服务状态
  doctor [--json]    运行只读本地诊断
  teams list [--json]
                     查看本地团队，不启动 Web
  teams create [--name <name>] [--bind-project <id>] [--work-dir <path>] [--harness <runtime>] [--json]
                     创建本地团队元数据，不启动 Web、bridge 或 agent
  tasks list --team <team> [--json]
                     查看某个本地团队的活跃任务
  usage status [--json]
                     查看本地 Claude JSONL telemetry 状态，不上传
  usage today [--json]
                     查看今日本地 usage 摘要，不上传
  usage report [--full] [--json]
                     扫描并按服务端游标增量上报新增消息
                     --full 忽略游标、全量重扫重传（服务端按 eventId 去重，用于补报历史漏掉的消息）
  usage start [--no-autostart] [--json]
                     开启轻量后台 usage 采集并默认配置开机自启，仅扫描本机 JSONL
  usage stop [--keep-autostart] [--json]
                     停止轻量后台 usage 采集并默认关闭开机自启
  usage autostart status|enable|disable [--json]
                     管理 usage 采集开机自启（macOS launchd）
  services [--json]
                     打开终端服务菜单，选择要启动/停止的本地服务
  services start web|usage|collaboration|local [--json]
                     按项启动本地服务
  services stop web|usage [--json]
                     按项停止本地服务
  collaboration start [--json]
                     启用本地/自托管团队协作配置
  auth status [--json]
                     查看 ${BRAND.authAccountLabel}状态，不启动 Web
  auth login [--control-url <url>] [--json]
                     通过 ${BRAND.authProviderName} 打开飞书授权；CLI 只保存 ${BRAND.authProviderName} 授权状态
  auth logout [--json]
                     退出 ${BRAND.authAccountLabel}，不影响本地 runtime 登录
  stop               停止后台服务
  update             检查并安装更新
  add <plugin>       安装能力插件到 MCP library
                     例如：${BRAND.cliCommand} add worker-society

示例:
  npx ${BRAND.npmPackage}             # 不安装直接运行
  npx ${BRAND.npmPackage} --daemon --port 8080
  ${BRAND.cliCommand}                          # 全局安装后打开终端导航
  ${BRAND.cliCommand} --daemon                 # 后台启动 Web 控制台
  ${BRAND.cliCommand} teams create
  ${BRAND.cliCommand} teams list
  ${BRAND.cliCommand} status
  ${BRAND.cliCommand} stop
`);
  process.exit(0);
}

await stopRelatedProcessesBeforeCommand();

if (commandArgs[0] === 'update') {
  await runUpdate({ onUpdated: () => restartUsageWorkerIfRunning({ quiet: false, reason: 'update 后重载 worker' }) });
  process.exit(0);
}

if (commandArgs[0] === 'add') {
  await runAddPlugin(commandArgs[1], port);
  process.exit(0);
}

// openhermit aikey — 认领 aikey: read the key from the service (mocked locally
// until the server endpoint ships) and write it into each harness's env via
// ~/.hermit/aikey.env + an idempotent shell precmd hook. Mechanism ported from
// aikey-cli. --no-hook skips the shell-rc write.
if (commandArgs[0] === 'aikey') {
  await runAikey({ noHook: args.includes('--no-hook') });
}



// Static menu/action data (NAV_ACTIONS … ACCOUNT_ACTIONS) + findMenuAction +
// menuFooterForEscape live in ./lib/menus.mjs now (imported at the top).

let optimisticWebRunningUntil = 0;

function markWebRunningOptimistic() {
  optimisticWebRunningUntil = Date.now() + 10 * 60_000;
}

function clearWebRunningOptimistic() {
  optimisticWebRunningUntil = 0;
}

function hasDeveloperModeEnabled() {
  return Boolean(readOpenHermitAuthStatus().developerMode);
}

function requireDeveloperMode() {
  if (hasDeveloperModeEnabled()) return true;
  printCliRows('开发者模式未开启', [
    ['状态', '未解锁', 'warn'],
    ['开启', 'openhermit auth dev-login <口令>', 'info'],
  ], '只有输入正确开发口令后才会显示详细日志。');
  return false;
}

function currentFeatureStates() {
  const auth = readOpenHermitAuthStatus();
  const webPid = readDaemonPid();
  const usagePid = readPidFile(telemetryWorkerPidPath);
  const settings = readHermitSettings();
  const telemetry = settings.taskBus?.telemetry && typeof settings.taskBus.telemetry === 'object'
    ? settings.taskBus.telemetry
    : {};
  const uploadProviders = normalizeUploadProviders(telemetry.uploadProviders || telemetry.platform || ['claudecode', 'codex']);
  const aikeyClaimed = readAikeyClaimed();
  return {
    auth,
    webPid,
    usagePid,
    webRunning: Boolean(webPid && isPidRunning(webPid)),
    usageRunning: Boolean(usagePid && isPidRunning(usagePid)),
    conversationUploadEnabled: resolveConversationUploadEnabled(telemetry),
    uploadProviders,
    aikeyClaimed,
    // feishu-codex-bridge is an optional connector (not bundled); state comes
    // from its own ~/.feishu-codex-bridge/service.pid, same pid+liveness pattern
    // as web/usage. Read on every repaint — cheap (one stat + kill -0).
    feishuBridge: feishuBridgeState(),
  };
}

// Pure-ish leaf: aikey is "claimed" when ~/.hermit/aikey.env parses to a label.
// Read on every menu repaint (cheap; same pattern as the pid files above) so the
// AI 密钥 row reflects the real 认领 state instead of a hardcoded label.
function readAikeyClaimed() {
  try {
    const content = readFileSync(path.join(hermitHome, 'aikey.env'), 'utf-8');
    const { label, vars } = parseActiveEnv(content);
    return Boolean(label) || Object.keys(vars).some((name) => name.endsWith('_API_KEY'));
  } catch {
    return false;
  }
}

async function refreshWebRunningState(expectedPid = null) {
  const pid = expectedPid || readDaemonPid();
  const server = await checkExistingOpenHermitServer();
  if (server.running) {
    refreshDaemonPidFromReadyServer(pid || expectedPid);
    clearWebRunningOptimistic();
    return true;
  }
  if (pid && isPidRunning(pid)) {
    clearWebRunningOptimistic();
    return true;
  }
  clearWebRunningOptimistic();
  return false;
}

function currentMenuStatusItems(states = currentFeatureStates()) {
  const upload = describeUploadToggle({ enabled: states.conversationUploadEnabled, running: states.usageRunning });
  return [
    { label: states.auth.authorized ? `已登录 ${states.auth.account?.name || BRAND.authProviderName}` : '未登录', state: states.auth.authorized ? 'ok' : 'off' },
    { label: states.webRunning ? 'Web 运行中' : 'Web 未启动', state: states.webRunning ? 'ok' : 'off' },
    { label: upload.rowLabel, state: upload.rowState },
  ];
}

function parseMenuKey(input) {
  const key = Buffer.isBuffer(input) ? input.toString('utf8') : String(input || '');
  if (key === '') return { type: 'exit' };
  if (key === '') return { type: 'exit' };
  if (key === '\r' || key === '\n' || key === '[C') return { type: 'choose' };
  if (key === ' ') return { type: 'toggle-expand' };
  if (key === '[D') return { type: 'back' };
  if (key === '[A' || key === '') return { type: 'move', delta: -1 };
  if (key === '[B' || key === '') return { type: 'move', delta: 1 };
  if (/^[1-9]$/u.test(key)) return { type: 'quick-select', index: Number.parseInt(key, 10) - 1 };
  return { type: 'unknown' };
}

function parseMenuKeys(input) {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input || '');
  const keys = [];
  for (let index = 0; index < text.length;) {
    const three = text.slice(index, index + 3);
    if (['[A', '[B', '[C', '[D'].includes(three)) {
      keys.push(parseMenuKey(three));
      index += 3;
      continue;
    }
    keys.push(parseMenuKey(text[index]));
    index += 1;
  }
  return keys;
}

function actionStateLabel(action, states) {
  if (action.id === 'web') {
    // 父组「本地工作台」下有两个工作台——状态反映「任一在跑」；LOCAL_USE 的叶子「打开本机 Web 控制台」只看 webRunning。
    if (action.children?.length) {
      const anyRunning = states.feishuBridge.running || states.webRunning;
      return { text: anyRunning ? '运行中' : '未启动', state: anyRunning ? 'ok' : 'error' };
    }
    return { text: states.webRunning ? '运行中' : '未启动', state: states.webRunning ? 'ok' : 'error' };
  }
  if (action.id === 'start-web' || action.id === 'toggle-web') return { text: states.webRunning ? '运行中' : '未启动', state: states.webRunning ? 'ok' : 'error' };
  if (['toggle-feishu-bridge', 'start-feishu-bridge', 'stop-feishu-bridge'].includes(action.id)) {
    const fb = states.feishuBridge;
    // 未安装时显示「推荐」引导用户开启（开启即按需安装）；装好后回到真实运行状态。
    if (!fb.installed) return { text: '推荐', state: 'ok' };
    // 已装但未配置（无 bots.json）→「未配置」；优先于运行态，引导用户先填飞书应用凭证。
    if (!fb.configured) return { text: '未配置', state: 'warn' };
    return { text: fb.running ? '运行中' : '未启动', state: fb.running ? 'ok' : 'error' };
  }
  if (action.toggle === 'conversation-upload' || action.id === 'toggle-message-upload') {
    const upload = describeUploadToggle({ enabled: states.conversationUploadEnabled, running: states.usageRunning });
    return { text: states.usageRunning ? formatUploadProviders(states.uploadProviders) : upload.badge, state: upload.badgeState };
  }
  if (action.id === 'choose-upload-provider') return { text: formatUploadProviders(states.uploadProviders), state: states.uploadProviders.length ? 'info' : 'warn' };
  if (['toggle-background', 'start-usage', 'start-background'].includes(action.id)) return { text: states.usageRunning ? '运行中' : '未启动', state: states.usageRunning ? 'ok' : 'error' };
  if (['data-sync', 'local-collection'].includes(action.id)) {
    const upload = describeUploadToggle({ enabled: states.conversationUploadEnabled, running: states.usageRunning });
    return { text: upload.badge, state: upload.badgeState };
  }
  if (action.id === 'aikey' || action.id === 'aikey-status') return { text: states.aikeyClaimed ? '已认领' : '未认领', state: states.aikeyClaimed ? 'ok' : 'off' };
  if (action.id === 'stop-web' || action.id === 'stop-usage' || action.id === 'stop-background') return { text: '停止', state: 'warn' };
  if (['account', 'login', 'status'].includes(action.id)) return { text: states.auth.authorized ? '已登录' : '未登录', state: states.auth.authorized ? 'ok' : 'off' };
  if (action.id === 'back') return { text: '返回', state: 'off' };
  if (action.id === 'exit') return { text: '', state: 'off' };
  if (action.recommended) return { text: '推荐', state: 'ok' };
  return { text: '', state: 'info' };
}

function visibleMenuRows(actions, expandedActionIds) {
  const rows = [];
  for (const action of actions) {
    if (action.developerOnly && !hasDeveloperModeEnabled()) continue;
    rows.push({ action, depth: 0 });
    if (expandedActionIds.has(action.id)) {
      for (const child of action.children || []) {
        if (child.developerOnly && !hasDeveloperModeEnabled()) continue;
        rows.push({ action: child, parent: action, depth: 1 });
      }
    }
  }
  return rows;
}

let navigationIntroShown = false;

async function renderNavigationIntro() {
  if (navigationIntroShown || jsonRequested || !isInteractiveCli()) return;
  navigationIntroShown = true;
  clearTerminal();
  printWelcomeLogo();
  await new Promise((resolve) => setTimeout(resolve, 420));
}

function inlineBusyMessage(action) {
  if (action.id === 'toggle-feishu-bridge') {
    const fb = currentFeatureStates().feishuBridge;
    if (!fb.installed) return '正在按需安装 feishu-codex-bridge（首次开启，需要一点时间）...';
    if (!fb.configured) return '即将弹出飞书应用配置向导（App ID / App Secret）...';
    return fb.running ? '正在停止飞书 Codex 桥...' : '正在启动飞书 Codex 桥...';
  }
  if (action.id === 'toggle-web') {
    return currentFeatureStates().webRunning ? '正在关闭 AgentCli 工作台...' : '正在启动 AgentCli 工作台...';
  }
  if (action.id === 'toggle-message-upload') {
    const s = currentFeatureStates();
    return (s.conversationUploadEnabled && s.usageRunning)
      ? '正在关闭消息上报...'
      : '正在开启消息上报...';
  }
  if (action.id === 'login') return `正在连接 ${BRAND.authProviderName} 授权服务...`;
  if (action.id === 'aikey-claim') return '正在认领 aikey...';
  if (action.id === 'aikey-apply') return '正在申请 aikey...';
  if (action.id === 'aikey-status') return '正在读取 aikey 状态...';
  if (action.id === 'dev-login') return '请输入开发口令以开启开发者模式...';
  if (action.id === 'upload-logs') return '正在读取消息上报调试日志...';
  return `正在处理：${action.label}，请稍候...`;
}

function renderBusyScreen(title, message) {
  clearTerminal();
  console.log(menuBrandTitle());
  if (title) console.log(ui.bold(title));
  console.log(colorByState(message, 'warn'));
}

function renderNavMenu(title, subtitle, actions, selectedIndex, escapeAction = 'exit', expandedActionIds = new Set(), notice = '') {
  clearTerminal();
  printWelcomeLogo();
  const states = currentFeatureStates();
  // Cap the nav card at ~60 cols so the label↔chip spacing stays proportional on
  // wide terminals (panelWidth alone would stretch to ~78 and push chips to the
  // far edge). Narrow terminals still adapt down via panelWidth's floor.
  const width = Math.min(panelWidth(), 60);
  console.log(navHeaderLine(width));
  console.log();
  printStatusBar(currentMenuStatusItems(states), width);
  console.log(ui.dim(glyphs.h.repeat(width)));
  if (title) console.log(ui.bold(title));
  if (subtitle) console.log(ui.dim(subtitle));
  if (notice) console.log(colorByState(notice, 'warn'));

  const rows = visibleMenuRows(actions, expandedActionIds);

  // Build each row's left half once so the state chip can be aligned just past
  // the widest label instead of floating at the far screen edge — the old fixed
  // 72-col anchor left a wide gap and made the menu read as sparse / debug text.
  const parts = rows.map((row, index) => {
    const { action, depth } = row;
    const focused = index === selectedIndex;
    const expanded = expandedActionIds.has(action.id);
    const pointer = focused ? ui.accent(glyphs.pointer) : ' ';
    const hasChildren = Boolean(action.children?.length) && !action.comingSoon;
    const caret = hasChildren ? (expanded ? glyphs.caretOpen : glyphs.caretClosed) : ' ';
    const state = actionStateLabel(action, states);
    const selected = action.toggle && state.state === 'ok';
    const marker = selected ? ui.success(glyphs.checked) : ' ';
    const label = selected ? ui.success(action.label) : focused ? ui.accent(action.label) : action.label;
    const left = depth === 0
      ? `${pointer} ${caret} ${label}`
      : `${pointer}   ${marker} ${label}`;
    // Chip = binary on/off dot + state-colored text. Empty text ⇒ no chip, which
    // is how the exit row stays bare instead of echoing a redundant 「退出」 tag.
    // comingSoon rows (token 池) hide the chip — a 开发中 feature shouldn't show
    // a state it can't actually be acted on.
    const right = depth === 0 && state.text && !action.comingSoon
      ? `${rowStatusDot(state.state)} ${colorByState(state.text, state.state)}`
      : '';
    return { left, right };
  });

  // Chips sit at the right edge of the panel (right-aligned to `width`) with a
  // minimum 6-col breath after the longest label, so the label and the status
  // chip never read as one cramped run.
  const maxLeft = parts.reduce((max, { left }) => Math.max(max, displayWidth(left)), 0);
  const maxRight = parts.reduce((max, { right }) => Math.max(max, displayWidth(right)), 0);
  const chipCol = Math.max(maxLeft + 6, width - maxRight);

  rows.forEach((row, index) => {
    const { left, right } = parts[index];
    // Separator before the escape action (退出 / 返回) detaches it from the
    // feature rows above, matching the target nav layout.
    if (row.action.id === escapeAction && index > 0) {
      console.log(ui.dim(glyphs.h.repeat(width)));
    }
    console.log(menuColumnsLine(left, right, chipCol));
    if (index === selectedIndex && row.action.description) {
      console.log(`    ${ui.dim(row.action.description)}`);
    }
  });

  console.log(ui.dim(`${menuFooterForEscape(escapeAction)}  [1-${rows.length} 快捷]`));
}

async function askMenuAction({ title, subtitle, actions, escapeAction = 'exit', onAction = null }) {
  return new Promise((resolve) => {
    let selectedIndex = 0;
    let busy = false;
    let notice = '';
    const expandedActionIds = new Set();
    const stdin = process.stdin;

    function cleanup() {
      stdin.off('data', onData);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\x1b[?25h');
    }

    function choose(actionId) {
      cleanup();
      process.stdout.write('\n');
      resolve(actionId);
    }

    function repaint(nextNotice = notice) {
      notice = nextNotice;
      renderNavMenu(title, subtitle, actions, selectedIndex, escapeAction, expandedActionIds, notice);
    }

    function visibleRows() {
      return visibleMenuRows(actions, expandedActionIds);
    }

    async function chooseInline(row) {
      if (!onAction) return false;
      busy = true;
      stdin.off('data', onData);
      renderBusyScreen(title, inlineBusyMessage(row.action));
      try {
        const handled = await onAction(row.action, { row, repaint });
        if (!handled) return false;
        repaint('');
        return true;
      } finally {
        busy = false;
        stdin.on('data', onData);
      }
    }

    async function chooseCurrent() {
      const rows = visibleRows();
      const row = rows[selectedIndex];
      if (!row) return;
      if (row.action.comingSoon) {
        const msg = typeof row.action.comingSoon === 'string' ? row.action.comingSoon : '该功能开发中，敬请期待';
        repaint(msg);
        return;
      }
      if (row.depth === 0 && row.action.children?.length) {
        const wasExpanded = expandedActionIds.has(row.action.id);
        expandedActionIds.clear();
        if (!wasExpanded) {
          expandedActionIds.add(row.action.id);
          const firstChildIndex = visibleRows().findIndex((item) => item.parent?.id === row.action.id);
          selectedIndex = firstChildIndex === -1 ? selectedIndex : firstChildIndex;
        } else {
          selectedIndex = Math.min(selectedIndex, visibleRows().length - 1);
        }
        repaint();
        return;
      }
      if (await chooseInline(row)) return;
      choose(row.action.id);
    }

    function move(delta) {
      const rows = visibleRows();
      selectedIndex = (selectedIndex + delta + rows.length) % rows.length;
      repaint();
    }

    function toggleExpand() {
      const row = visibleRows()[selectedIndex];
      if (!row || row.depth !== 0) return;
      const actionId = row.action.id;
      const wasExpanded = expandedActionIds.has(actionId);
      expandedActionIds.clear();
      if (!wasExpanded) {
        expandedActionIds.add(actionId);
        const firstChildIndex = visibleRows().findIndex((item) => item.parent?.id === actionId);
        selectedIndex = firstChildIndex === -1 ? selectedIndex : firstChildIndex;
      } else {
        selectedIndex = Math.min(selectedIndex, visibleRows().length - 1);
      }
      repaint();
    }

    async function handleKey(key) {
      if (key.type === 'exit') {
        cleanup();
        cancelCli();
        return;
      }
      if (key.type === 'back') {
        if (escapeAction === 'stay') {
          repaint();
          return;
        }
        cleanup();
        resolve(escapeAction);
        return;
      }
      if (key.type === 'choose') {
        await chooseCurrent();
        return;
      }
      if (key.type === 'toggle-expand') {
        toggleExpand();
        return;
      }
      if (key.type === 'move') {
        move(key.delta);
        return;
      }
      if (key.type === 'quick-select') {
        const rows = visibleRows();
        if (rows[key.index]) {
          selectedIndex = key.index;
          await chooseCurrent();
        }
      }
    }

    async function onData(chunk) {
      if (busy) {
        repaint('正在处理上一个操作，请稍候...');
        return;
      }
      for (const key of parseMenuKeys(chunk)) {
        if (busy) break;
        await handleKey(key);
      }
    }

    process.stdout.write('\x1b[?25l');
    repaint();
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

function printNavigationActions() {
  const result = {
    ok: true,
    command: 'navigate',
    message: `${BRAND.stylizedName} 入口按意图分为本地使用和团队协作；本地使用和本地/自托管团队协作无需登录，云端上传/托管能力需要登录。`,
    defaultAction: 'services',
    actions: NAV_ACTIONS,
  };
  if (jsonRequested) printJson(result);

  printCliRows(BRAND.stylizedName, [
    ['本地使用', '无需登录，本机 Web / 数字员工 / 本地采集'],
    ['团队协作', '无需登录，本地/自托管协作先启用；上传/托管稍后登录开启'],
    ['CLI 职责', '本地控制面状态和生命周期'],
  ]);
  for (const action of NAV_ACTIONS) {
    console.log(`- ${action.id}: ${action.label}`);
    console.log(`  ${action.description}`);
  }
  console.log('\n也可以直接运行：openhermit teams create | teams list | tasks list | usage status | usage today | usage report | doctor | status | auth status | stop');
  process.exit(0);
}

async function waitForNavigationContinue(message = '按 Enter 返回 | ← 返回上一级 | Esc/Ctrl+C 退出', options = {}) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const keepMenuInput = Boolean(options.keepMenuInput);

    function cleanup() {
      stdin.off('data', onData);
      if (!keepMenuInput) {
        if (stdin.isTTY) stdin.setRawMode(false);
        stdin.pause();
      }
    }

    function finish(result) {
      cleanup();
      resolve(result);
    }

    function onData(chunk) {
      for (const key of parseMenuKeys(chunk)) {
        if (key.type === 'choose') {
          finish('continue');
          return;
        }
        if (key.type === 'back') {
          finish('back');
          return;
        }
        if (key.type === 'exit') {
          cleanup();
          cancelCli();
          return;
        }
      }
    }

    console.log('');
    console.log(ui.dim(message));
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function fetchLocalJson(pathname, options = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    ...options,
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function formatStatusToggle(value) {
  if (value === true) return '开启';
  if (value === false) return '关闭';
  return '未知';
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function emptyUsageTelemetryStatus() {
  return {
    connected: false,
    lastScan: null,
    sessions: 0,
    messages: 0,
    tokensIn: 0,
    tokensOut: 0,
    cacheRead: 0,
    cacheCreation: 0,
    totalTokens: 0,
    activeDays: 0,
    hourly: Array.from({ length: 24 }, () => 0),
    projects: [],
    workSecondsByDay: {},
    daily: {},
    localUsers: [],
    unresolvedUsage: { sessions: 0, messages: 0, tokensTotal: 0 },
  };
}

function usageDaemonPayload(server) {
  return {
    running: Boolean(server?.running),
    url: server?.url || `http://127.0.0.1:${port}`,
    version: server?.version || '',
  };
}

function telemetryWorkerPayload({ status = null, statusError = '', autostart = null } = {}) {
  const pid = readPidFile(telemetryWorkerPidPath);
  const running = Boolean(pid && isPidRunning(pid));
  return {
    running,
    pid: running ? pid : null,
    pidfilePresent: Boolean(pid),
    pidPath: telemetryWorkerPidPath,
    statusPath: telemetryWorkerStatusPath,
    logPath: telemetryWorkerLogPath,
    errorLogPath: telemetryWorkerErrorLogPath,
    lastStatus: status,
    statusError,
    autostart,
  };
}

function readPidFile(pidPath) {
  try {
    const raw = readFileSync(pidPath, 'utf-8').trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function stopRelatedProcessesBeforeCommand() {
  if (process.env.OPENHERMIT_SKIP_STARTUP_CLEANUP === '1') return;
  if (daemonChild || commandArgs[0] === '__telemetry-worker') return;

  const autostart = await getUsageAutostartStatus();
  await stopTelemetryWorker();
  if (autostart.enabled) await keepUsageAutostartWithoutRunning();
  await stopFeishuBridge().catch(() => null);
  await stopDaemon({ exitOnDone: false, quiet: true });
  await stopFallbackProcesses(collectFallbackPids());
}

function readTelemetryWorkerStatusFile() {
  if (!existsSync(telemetryWorkerStatusPath)) return { status: null, error: '' };
  const { value, error } = safeReadJson(telemetryWorkerStatusPath);
  if (error) return { status: null, error };
  return value && typeof value === 'object' ? { status: value, error: '' } : { status: null, error: 'invalid status file' };
}

function telemetryFromWorkerStatus(status) {
  return status?.telemetry && typeof status.telemetry === 'object' ? status.telemetry : emptyUsageTelemetryStatus();
}

async function fetchBackendUsageStatus() {
  const daemon = await collectDaemonStatus();
  if (!daemon.server?.running) return null;
  try {
    const telemetry = await fetchLocalJson('/api/telemetry/status');
    const autostart = await getUsageAutostartStatus();
    return {
      daemon: usageDaemonPayload(daemon.server),
      worker: telemetry.worker || telemetryWorkerPayload({ status: null, autostart }),
      telemetry,
      source: 'backend-api',
    };
  } catch {
    return null;
  }
}

// fetchRemoteUsageStatus + fetchAuthoritativeUsage live in ./lib/usageRemote.mjs
// (imported above). They are read-only GETs against the ai-monitor base.

async function readUsageStatus({ scan = false, localOnly = false } = {}) {
  let base;
  if (scan) {
    base = await scanUsageTelemetryOnce({ localOnly });
  } else {
    const backend = await fetchBackendUsageStatus();
    if (backend) {
      base = backend;
    } else {
      const { status, error } = readTelemetryWorkerStatusFile();
      const autostart = await getUsageAutostartStatus();
      base = {
        daemon: usageDaemonPayload({ running: false, url: `http://127.0.0.1:${port}`, version: '' }),
        worker: telemetryWorkerPayload({ status, statusError: error, autostart }),
        telemetry: telemetryFromWorkerStatus(status),
        source: 'claude-jsonl',
      };
    }
  }
  // Server reads are DISPLAY-only — the scan/upload engine never needs /usage.
  // Both status and report show 本地 vs 服务端 vs 待上报, so always fetch the
  // ledger; skip only for localOnly (no auth, stays fully offline).
  if (!localOnly) {
    const [remote, authoritative] = await Promise.all([
      fetchRemoteUsageStatus(currentFeatureStates().uploadProviders),
      fetchAuthoritativeUsage(),
    ]);
    base.remoteUsage = remote;
    base.authoritativeUsage = authoritative;
  }
  return base;
}

function uploadStatusUnavailableReason(errorText = '') {
  if (!errorText) return '';
  if (/insufficient_scope|upload:read/u.test(errorText)) return '缺少 upload:read 授权，请重新登录';
  if (/usage status HTTP 401/u.test(errorText)) return '登录已失效，请重新登录';
  if (/usage status HTTP 403/u.test(errorText)) return '服务端拒绝读取 /report/usage/status';
  if (/usage status .*HTTP \d+/u.test(errorText)) return errorText;
  return '';
}

function authScopes(auth = readOpenHermitAuthStatus()) {
  const scopes = Array.isArray(auth.scopes) ? auth.scopes : normalizeScopes({ scope: auth.scope }) || [];
  return new Set(scopes);
}

function hasUploadScopes(auth = readOpenHermitAuthStatus()) {
  const scopes = authScopes(auth);
  return scopes.has('upload:read') && scopes.has('upload:write');
}

function cursorStatusText(channel) {
  if (channel.hasCursor) {
    const parts = [`cursor ${String(channel.cursorHash || '').slice(0, 12)}`];
    if (Number.isFinite(channel.cursorMessageCount)) parts.push(`${formatNumber(channel.cursorMessageCount)} msg`);
    if (channel.cursorGeneratedAt) parts.push(new Date(channel.cursorGeneratedAt).toLocaleString('zh-CN'));
    return parts.join(' · ');
  }
  if (channel.status && channel.status !== 'never_reported') return '无服务端游标 · 全量上报（服务端按 eventId 去重）';
  if (channel.attemptedCursorHash) {
    return `attempted ${String(channel.attemptedCursorHash).slice(0, 12)}${Number.isFinite(channel.attemptedCursorMessageCount) ? ` · ${formatNumber(channel.attemptedCursorMessageCount)} msg` : ''}`;
  }
  return '尚未提交 cursor';
}

function conversationUploadRows(_upload = {}, auth = readOpenHermitAuthStatus(), remote = null) {
  const missingUploadScope = auth.authorized && !hasUploadScopes(auth);
  const rows = [];

  // Server channel state is server-authoritative — but only meaningful when we
  // actually queried /report/usage/status this run. In scan/report mode `remote` is
  // null (the endpoint is never called), so we must NOT render a fake
  // "等待读取 /report/usage/status" row about a request that never happened.
  if (remote) {
    const remoteChannels = Array.isArray(remote.channels) ? remote.channels : [];
    const remoteErrors = Array.isArray(remote.errors) ? remote.errors : [];
    if (remoteChannels.length) {
      for (const c of remoteChannels) {
        rows.push([
          `${uploadProviderLabel(c.platform)}/${c.scene || 'coding'}`,
          `${c.status || '未知'} · ${cursorStatusText(c)}${c.inFlight ? ` · 处理中 ${c.inFlight}` : ''}${c.lastUploadId ? ` · ${String(c.lastUploadId).slice(0, 12)}` : ''}`,
          c.inFlight ? 'warn' : 'info',
        ]);
      }
    } else {
      rows.push([
        '服务端状态',
        remoteErrors.length ? '读取 /report/usage/status 失败' : auth.authorized ? '等待读取 /report/usage/status' : '等待登录后读取 /report/usage/status',
        remoteErrors.length ? 'error' : 'info',
      ]);
    }
    for (const error of remoteErrors) {
      // Auth-level errors (e.g. 等待登录) carry no platform — they are represented
      // by the 授权 row below, not a bogus "undefined" row.
      if (!error.platform) continue;
      const detail = error.httpStatus
        ? `HTTP ${error.httpStatus}${error.body ? ` · ${error.body}` : ''}`
        : error.error || '请求失败';
      rows.push([
        `${uploadProviderLabel(error.platform)}/${error.scene || 'coding'}`,
        `读取 /report/usage/status 失败：${detail}`,
        'error',
      ]);
    }
  }

  if (missingUploadScope) rows.push(['授权', '缺少 upload:read/upload:write，请重新登录', 'warn']);
  else if (!auth.authorized) rows.push(['授权', '未登录，请在「用户」中登录', 'warn']);

  return rows;
}

async function printUsageRows(title, data, hint) {
  const states = currentFeatureStates();
  const auth = await refreshOpenHermitAuthStatus();
  const upload = data.telemetry.conversationUpload;
  const uploadEnabled = Boolean(states.conversationUploadEnabled || upload?.enabled);
  const workerText = states.usageRunning ? `后台运行中 (pid ${states.usagePid})，每 5 分钟增量扫描` : '后台未运行';
  const uploadText = uploadEnabled
    ? auth.authorized ? workerText : `${workerText}，等待登录授权`
    : '关闭';
  printCliRows(title, [
    ['消息上报', uploadText, uploadEnabled ? auth.authorized ? states.usageRunning ? 'ok' : 'warn' : 'warn' : 'off'],
    ...localServerRows(data.telemetry, data.authoritativeUsage),
    ...cursorPendingRows(upload),
    ...(uploadEnabled ? conversationUploadRows(upload, auth, data.remoteUsage) : []),
  ], hint || '待上报来自服务端 cursor 扫描结果；本地/服务端总账只作诊断对比。');
}

async function printUsageStatus({ exitOnDone = true } = {}) {
  try {
    const data = await withCliProgress('正在读取用量状态...', () => readUsageStatus({ scan: false }));
    const result = { ok: true, command: 'usage status', hermitHome, ...data };
    if (jsonRequested) printJson(result);
    await printUsageRows('用量上报状态', data, data.daemon.running ? '触发扫描：openhermit usage report' : '启动本地采集：openhermit usage start');
    if (exitOnDone) process.exit(0);
    return result;
  } catch (err) {
    const result = { ok: false, command: 'usage status', hermitHome, error: err instanceof Error ? err.message : String(err) };
    if (jsonRequested) printJson(result, 1);
    console.error(`${brandLogPrefix()} usage status 失败：${result.error}`);
    if (exitOnDone) process.exit(1);
    return result;
  }
}

function todayUsageFromStatus(status) {
  const date = todayKey();
  const daily = status.daily?.[date];
  return {
    date,
    sessions: daily?.sessions ?? 0,
    messages: daily?.messages ?? 0,
    tokensIn: daily?.tokensIn ?? 0,
    tokensOut: daily?.tokensOut ?? 0,
    cacheRead: daily?.cacheRead ?? 0,
    cacheCreation: daily?.cacheCreation ?? 0,
    totalTokens: daily?.tokensTotal ?? 0,
    workSeconds: daily?.workSeconds ?? status.workSecondsByDay?.[date] ?? 0,
  };
}

async function printUsageToday({ exitOnDone = true } = {}) {
  try {
    const data = await readUsageStatus({ scan: false });
    const today = todayUsageFromStatus(data.telemetry);
    const result = { ok: true, command: 'usage today', hermitHome, daemon: data.daemon, worker: data.worker, source: data.source, today };
    if (jsonRequested) printJson(result);
    printCliRows('今日用量', [
      ['日期', today.date],
      ['后台扫描', data.worker?.running ? `运行中 (pid ${data.worker.pid})` : '未运行'],
      ['会话数', formatNumber(today.sessions)],
      ['消息数', formatNumber(today.messages)],
      ['Token 总量', formatNumber(today.totalTokens)],
      ['工作时长（秒）', formatNumber(today.workSeconds)],
      ['来源', 'Claude Code 本地消息记录'],
    ], data.daemon.running ? '刷新统计：openhermit usage report' : '启动本地采集：openhermit usage start');
    if (exitOnDone) process.exit(0);
    return result;
  } catch (err) {
    const result = { ok: false, command: 'usage today', hermitHome, error: err instanceof Error ? err.message : String(err) };
    if (jsonRequested) printJson(result, 1);
    console.error(`${brandLogPrefix()} usage today 失败：${result.error}`);
    if (exitOnDone) process.exit(1);
    return result;
  }
}

function getFlagValue(flag) {
  const index = commandArgs.indexOf(flag);
  if (index < 0) return '';
  const value = commandArgs[index + 1];
  return value && !value.startsWith('--') ? value : '';
}

function setConversationUploadEnabled(enabled, providers = null) {
  const selectedProviders = providers == null ? null : normalizeUploadProviders(providers);
  const settings = readHermitSettings();
  const existing = settings.taskBus && typeof settings.taskBus === 'object' ? settings.taskBus : {};
  const telemetry = existing.telemetry && typeof existing.telemetry === 'object' ? existing.telemetry : {};
  const uploadProviders = selectedProviders ?? normalizeUploadProviders(telemetry.uploadProviders || ['claudecode', 'codex']);
  const taskBus = {
    ...existing,
    telemetry: {
      ...telemetry,
      enabled: true,
      platform: uploadProviders[0] || telemetry.platform || 'claudecode',
      uploadProviders,
      conversationUploadEnabled: Boolean(enabled),
      conversations: {
        ...(telemetry.conversations && typeof telemetry.conversations === 'object' ? telemetry.conversations : {}),
        uploadEnabled: Boolean(enabled),
        baseUrl: resolveConversationUploadBaseUrl(telemetry.conversations?.baseUrl),
      },
    },
  };
  writeHermitSettings({ ...settings, taskBus });
  return taskBus;
}

function buildLocalUsageTaskBusConfig(current = {}) {
  const existing = current && typeof current === 'object' ? current : {};
  const redis = existing.redis && typeof existing.redis === 'object'
    ? existing.redis
    : { host: '127.0.0.1', port: 6379 };
  const existingTelemetry = existing.telemetry && typeof existing.telemetry === 'object' ? existing.telemetry : {};
  // `uploadEnabled` is a legacy dead key (written by old paths, never read for
  // upload behavior — the worker gates on conversationUploadEnabled || conversations.uploadEnabled).
  // Strip it when re-writing so it is purged from settings.json instead of carried forever.
  const { uploadEnabled: _legacyUploadEnabled, ...telemetryWithoutLegacy } = existingTelemetry;
  void _legacyUploadEnabled;
  const uploadProviders = normalizeUploadProviders(existingTelemetry.uploadProviders || ['claudecode', 'codex']);
  return {
    ...existing,
    enabled: Boolean(existing.enabled),
    redis: {
      host: typeof redis.host === 'string' && redis.host.trim() ? redis.host : '127.0.0.1',
      port: Number.isFinite(Number(redis.port)) ? Number(redis.port) : 6379,
      ...(redis.password ? { password: redis.password } : {}),
      ...(redis.db !== undefined ? { db: redis.db } : {}),
    },
    telemetry: {
      ...telemetryWithoutLegacy,
      enabled: true,
      conversationUploadEnabled: Boolean(existingTelemetry.conversationUploadEnabled),
      uploadProviders,
      platform: uploadProviders[0] || existingTelemetry.platform || 'claudecode',
    },
  };
}

function enableLocalUsageTelemetry() {
  const settings = readHermitSettings();
  const taskBus = buildLocalUsageTaskBusConfig(settings.taskBus);
  writeHermitSettings({ ...settings, taskBus });
  return taskBus;
}

function disableLocalUsageTelemetry() {
  const settings = readHermitSettings();
  const existing = settings.taskBus && typeof settings.taskBus === 'object' ? settings.taskBus : {};
  const telemetry = existing.telemetry && typeof existing.telemetry === 'object' ? existing.telemetry : {};
  const taskBus = {
    ...existing,
    telemetry: {
      ...telemetry,
      enabled: false,
      platform: telemetry.platform || 'claudecode',
    },
  };
  writeHermitSettings({ ...settings, taskBus });
  return taskBus;
}

function telemetryWorkerChildArgs(extraArgs = []) {
  return ['--import', resolveAliasLoaderRegister(), '--import', resolveTsxLoader(), 'src/main/telemetry/worker.ts', ...extraArgs];
}

function latestUsageWorkerSourceMtime() {
  // Only files the worker PROCESS actually imports (src/main TS). bin/hermit.mjs
  // and bin/lib/*.mjs are CLI-only — editing them must NOT force a worker
  // restart, which previously blanked status.json mid-view and made
  // "查看同步状态" briefly show all-zero telemetry.
  return Math.max(
    ...[
      'src/main/telemetry/worker.ts',
      'src/main/services/session-intelligence/UsageTelemetryService.ts',
      'src/main/services/session-intelligence/ConversationMessageUploadService.ts',
      'src/main/services/session-intelligence/AiMonitorUsageClient.ts',
      'src/main/services/auth/OpenHermitAuthClient.ts',
    ].map((rel) => {
      try { return statSync(path.join(repoRoot, rel)).mtimeMs; } catch { return 0; }
    })
  );
}

function markTelemetryWorkerRestarting(reason = '正在重启 worker') {
  try {
    mkdirSync(telemetryDir, { recursive: true, mode: 0o700 });
    // Preserve the last scan's telemetry so "查看同步状态" does not briefly show
    // all-zero while the restarted worker completes its first scan — only the
    // state flips to 'restarting', the last-known counts stay visible.
    const previous = readTelemetryWorkerStatusFile().status;
    writeFileSync(telemetryWorkerStatusPath, `${JSON.stringify({
      schemaVersion: 1,
      state: 'restarting',
      running: false,
      pid: null,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastScan: previous?.lastScan ?? null,
      source: 'claude-jsonl',
      telemetryEnabled: previous?.telemetryEnabled ?? true,
      restartReason: reason,
      telemetry: previous?.telemetry ?? emptyUsageTelemetryStatus(),
    }, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
  } catch {}
}

async function restartTelemetryWorker({ quiet = true, reason = '手动重启 worker' } = {}) {
  await stopTelemetryWorker();
  await clearStaleConversationUploadLock();
  markTelemetryWorkerRestarting(reason);
  return startTelemetryWorker({ quiet, forceRestart: true });
}

async function clearStaleConversationUploadLock() {
  const lockPath = path.join(telemetryDir, 'conversation-message-upload.lock');
  try {
    const raw = readFileSync(lockPath, 'utf-8');
    const lock = JSON.parse(raw);
    const pid = Number(lock.pid);
    const ageMs = Date.now() - Date.parse(lock.createdAt || '');
    let staleByPid = false;
    if (Number.isInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); } catch { staleByPid = true; }
    }
    if (staleByPid || (Number.isFinite(ageMs) && ageMs > 30 * 60 * 1000)) unlinkSync(lockPath);
  } catch {}
}

function workerNeedsRestart(status) {
  if (!status?.startedAt) return true;
  const pid = readPidFile(telemetryWorkerPidPath);
  if (status.pid && pid && Number(status.pid) !== Number(pid)) return true;
  const startedAt = Date.parse(status.startedAt);
  return !Number.isFinite(startedAt) || latestUsageWorkerSourceMtime() > startedAt;
}

async function restartTelemetryWorkerIfStale({ quiet = true } = {}) {
  const { status } = readTelemetryWorkerStatusFile();
  const pid = readPidFile(telemetryWorkerPidPath);
  if (!pid || !isPidRunning(pid) || !workerNeedsRestart(status)) return null;
  return restartTelemetryWorker({ quiet, reason: '源码已更新，正在重启 worker' });
}

async function restartUsageWorkerIfRunning({ quiet = false, reason = '重载 worker' } = {}) {
  // Reload the usage worker ONLY when one is actually running — never
  // surprise-spawn one. Used after `openhermit update` so the live worker picks
  // up the new code. Unconditional (not mtime-gated like restartTelemetryWorkerIfStale):
  // the npm-global update swaps bundled JS that the src/main source-mtime watch
  // can't see, so mtime gating would miss it.
  const pid = readPidFile(telemetryWorkerPidPath);
  if (!pid || !isPidRunning(pid)) return { restarted: false, reason: 'no running worker' };
  return { restarted: true, ...(await restartTelemetryWorker({ quiet, reason })) };
}

function startTelemetryWorker({ quiet = false, forceRestart = false } = {}) {
  const existingPid = readPidFile(telemetryWorkerPidPath);
  // Reap orphan workers before deciding: only the pidfile'd worker is canonical,
  // so any other live telemetry/worker.ts process is a leftover from a prior
  // race. Restores the at-most-one invariant even on a plain `usage start`.
  for (const stray of collectRunningUsageWorkerPids()) {
    if (Number(stray) === Number(existingPid)) continue;
    if (isPidRunning(stray)) signalDaemon(stray, 'SIGKILL');
  }
  if (!forceRestart && existingPid && isPidRunning(existingPid)) {
    return { started: false, running: true, pid: existingPid, pidPath: telemetryWorkerPidPath, statusPath: telemetryWorkerStatusPath, logPath: telemetryWorkerLogPath };
  }

  if (process.env.OPENHERMIT_USAGE_WORKER_MODE === 'test') {
    mkdirSync(telemetryDir, { recursive: true, mode: 0o700 });
    try {
      try { unlinkSync(telemetryWorkerPidPath); } catch {}
      writeFileSync(telemetryWorkerPidPath, String(process.pid), { encoding: 'utf-8', mode: 0o600 });
    } catch {}
    writeFileSync(telemetryWorkerStatusPath, `${JSON.stringify({
      schemaVersion: 1,
      state: 'idle',
      running: true,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastScan: null,
      source: 'claude-jsonl',
      telemetryEnabled: true,
      telemetry: emptyUsageTelemetryStatus(),
    }, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
    return { started: true, running: true, pid: process.pid, pidPath: telemetryWorkerPidPath, statusPath: telemetryWorkerStatusPath, logPath: telemetryWorkerLogPath, mode: 'test' };
  }

  mkdirSync(telemetryDir, { recursive: true, mode: 0o700 });
  mkdirSync(path.dirname(telemetryWorkerLogPath), { recursive: true, mode: 0o700 });
  const out = openSync(telemetryWorkerLogPath, 'a');
  const err = openSync(telemetryWorkerErrorLogPath, 'a');
  const child = spawn(process.execPath, telemetryWorkerChildArgs(), {
    cwd: repoRoot,
    detached: true,
    windowsHide: true,
    env: { ...process.env, HERMIT_HOME: hermitHome },
    stdio: ['ignore', out, err],
  });
  child.unref();
  closeSync(out);
  closeSync(err);
  try {
    try { unlinkSync(telemetryWorkerPidPath); } catch {}
    writeFileSync(telemetryWorkerPidPath, String(child.pid), { encoding: 'utf-8', mode: 0o600 });
  } catch (e) {
    if (!quiet) console.error(`${brandLogPrefix()} 警告: 无法写入 ${telemetryWorkerPidPath}: ${e.message}`);
  }
  if (!quiet) console.error(`${brandLogPrefix()} usage telemetry worker started: pid ${child.pid}`);
  return { started: true, running: true, pid: child.pid, pidPath: telemetryWorkerPidPath, statusPath: telemetryWorkerStatusPath, logPath: telemetryWorkerLogPath };
}

async function waitForPidExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidRunning(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !isPidRunning(pid);
}

function isUsageWorkerCommand(command) {
  return command.includes('src/main/telemetry/worker.ts') || command.includes('telemetry/worker.ts');
}

function collectRunningUsageWorkerPids() {
  // Find EVERY persistent telemetry worker, not just the pidfile'd one. Each
  // worker writes its own pid on start, so the pidfile always holds only the
  // youngest; orphans from prior races own no pidfile entry and are invisible to
  // stopTelemetryWorker, so they pile up and all overwrite status.json together.
  // Matching by command lets start/stop reap the whole herd. `--scan-once`
  // children are transient (self-exit after one scan) and excluded so
  // `usage report` is not killed mid-scan.
  if (process.platform === 'win32') {
    try {
      return listProcessesWin()
        .filter((p) => p.pid !== process.pid && isUsageWorkerCommand(p.command) && !p.command.includes('--scan-once'))
        .map((p) => p.pid);
    } catch {
      return [];
    }
  }
  let output = '';
  try {
    output = execSync('ps -axo pid=,command=', { encoding: 'utf-8' });
  } catch {
    return [];
  }
  const pids = [];
  for (const line of output.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+([\s\S]+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    if (pid === process.pid) continue;
    const command = match[2];
    if (!isUsageWorkerCommand(command)) continue;
    if (command.includes('--scan-once')) continue;
    pids.push(pid);
  }
  return pids;
}

function collectOrphanedDaemonChildPids() {
  // Detached daemon children (server.ts / hermit-bridge) are spawned with
  // detached:true and only reaped by shutdown() on SIGINT/SIGTERM. If the daemon
  // dies via SIGKILL / crash / OOM, shutdown() never runs and those children are
  // reparented to PID 1 — permanent orphans (the 1d19h server.ts we cleaned up).
  // Reap ONLY PPID=1 ones at startup so a LIVE daemon's own children are never
  // touched. Mirrors collectRunningUsageWorkerPids's ps+command-match approach.
  if (process.platform === 'win32') {
    // Windows has no PID-1 reparenting: an orphaned child keeps its (now-dead)
    // parent's ppid, so "orphan" = ppid not in the live-pid set. The snapshot
    // is one CimInstance call, so parent+child pids are mutually consistent.
    // Same per-line pid↔command safety + try/catch as the worker reaper.
    try {
      const procs = listProcessesWin();
      const live = new Set(procs.map((p) => p.pid));
      return procs
        .filter((p) => p.pid !== process.pid && !live.has(p.ppid) && !p.command.includes('--scan-once') && (p.command.includes('src/main/server.ts') || p.command.includes('hermit-bridge')))
        .map((p) => p.pid);
    } catch {
      return [];
    }
  }
  let output = '';
  try {
    output = execSync('ps -axo pid=,ppid=,command=', { encoding: 'utf-8' });
  } catch {
    return [];
  }
  const pids = [];
  for (const line of output.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+([\s\S]+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const command = match[3];
    if (pid === process.pid) continue;
    if (ppid !== 1) continue; // only true orphans — never a live daemon's child
    if (command.includes('--scan-once')) continue; // transient foreground scan
    if (command.includes('src/main/server.ts') || command.includes('hermit-bridge') || command.includes('cc-connect')) {
      pids.push(pid);
    }
  }
  return pids;
}

async function stopTelemetryWorker() {
  const pid = readPidFile(telemetryWorkerPidPath);
  if (pid === process.pid && process.env.OPENHERMIT_USAGE_WORKER_MODE === 'test') {
    removeTelemetryWorkerPidFile();
    return { stopped: true, pid, running: false, mode: 'test' };
  }
  // Reap the ENTIRE herd (pidfile pid ∪ all live workers), reusing the shared
  // TERM→wait→KILL loop. Killing only the pidfile'd worker leaves orphans alive.
  const targets = Array.from(
    new Set([
      ...(Number.isInteger(pid) && pid > 0 ? [pid] : []),
      ...collectRunningUsageWorkerPids(),
    ])
  );
  if (targets.length === 0) {
    removeTelemetryWorkerPidFile();
    return { stopped: false, pid: null, running: false };
  }
  await stopFallbackProcesses(targets);
  removeTelemetryWorkerPidFile();
  return { stopped: true, pid, running: false };
}

function removeTelemetryWorkerPidFile() {
  try {
    unlinkSync(telemetryWorkerPidPath);
  } catch {
    // Already gone.
  }
}

async function runTelemetryWorkerScanOnce({ localOnly = false, scanDisabled = false } = {}) {
  const child = spawn(process.execPath, telemetryWorkerChildArgs(['--scan-once']), {
    cwd: repoRoot,
    env: {
      ...process.env,
      HERMIT_HOME: hermitHome,
      // Marks this as a user-initiated foreground scan so the upload engine
      // pushes through server in-flight backpressure instead of skipping (the
      // periodic daemon loop does NOT set this). See uploadPlatformModeMessages.
      HERMIT_USAGE_FOREGROUND_SCAN: '1',
      ...(localOnly ? { HERMIT_USAGE_FORCE_LOCAL_ONLY: '1' } : {}),
      ...(scanDisabled ? { HERMIT_USAGE_SCAN_DISABLED: '1' } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let interrupted = false;
  const stopChild = () => {
    interrupted = true;
    if (child.pid && !child.killed) child.kill('SIGTERM');
    setTimeout(() => {
      if (child.pid && !child.killed) child.kill('SIGKILL');
    }, 2_000).unref();
  };
  // Run before the global cancel handler so Ctrl+C/Esc cannot leave the
  // foreground --scan-once child orphaned.
  process.prependOnceListener('SIGINT', stopChild);
  process.prependOnceListener('SIGTERM', stopChild);
  child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
  // Wait on 'close' (not 'exit') so stdio is fully drained + torn down before
  // proceeding — 'exit' raced the pipe close and tripped libuv's
  // UV_HANDLE_CLOSING assertion on Windows (win/async.c).
  const code = await new Promise((resolve) => child.on('close', resolve));
  process.off('SIGINT', stopChild);
  process.off('SIGTERM', stopChild);
  if (interrupted) throw new Error('已取消本次扫描，子进程已停止');
  if (code !== 0) throw new Error(stderr.trim() || `telemetry worker scan exited with ${code}`);
  const parsed = JSON.parse(stdout.trim() || '{}');
  return parsed.status?.telemetry ? parsed.status.telemetry : emptyUsageTelemetryStatus();
}

async function scanUsageTelemetryOnce({ localOnly = false } = {}) {
  if (process.env.OPENHERMIT_USAGE_WORKER_MODE === 'test') {
    const { status } = readTelemetryWorkerStatusFile();
    const autostart = await getUsageAutostartStatus();
    return {
      daemon: usageDaemonPayload({ running: false, url: `http://127.0.0.1:${port}`, version: '' }),
      worker: telemetryWorkerPayload({ status, autostart }),
      telemetry: telemetryFromWorkerStatus(status),
      source: 'claude-jsonl',
    };
  }
  const telemetry = await runTelemetryWorkerScanOnce({ localOnly, scanDisabled: localOnly });
  const { status } = readTelemetryWorkerStatusFile();
  const autostart = await getUsageAutostartStatus();
  return {
    daemon: usageDaemonPayload({ running: false, url: `http://127.0.0.1:${port}`, version: '' }),
    worker: telemetryWorkerPayload({ status, autostart }),
    telemetry,
    source: 'claude-jsonl',
  };
}

function usageLaunchdLabel() {
  return 'com.openhermit.telemetry';
}

function usageLaunchdPlistPath() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${usageLaunchdLabel()}.plist`);
}

function xmlEscape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function buildUsageLaunchdPlist() {
  const pathValue = process.env.PATH || '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n\t<key>Label</key>\n\t<string>${usageLaunchdLabel()}</string>\n\t<key>ProgramArguments</key>\n\t<array>\n\t\t<string>${xmlEscape(process.execPath)}</string>\n\t\t<string>${xmlEscape(fileURLToPath(import.meta.url))}</string>\n\t\t<string>__telemetry-worker</string>\n\t</array>\n\t<key>EnvironmentVariables</key>\n\t<dict>\n\t\t<key>HERMIT_HOME</key>\n\t\t<string>${xmlEscape(hermitHome)}</string>\n\t\t<key>PATH</key>\n\t\t<string>${xmlEscape(pathValue)}</string>\n\t</dict>\n\t<key>RunAtLoad</key>\n\t<true/>\n\t<key>KeepAlive</key>\n\t<dict>\n\t\t<key>SuccessfulExit</key>\n\t\t<false/>\n\t</dict>\n\t<key>ThrottleInterval</key>\n\t<integer>30</integer>\n\t<key>StandardOutPath</key>\n\t<string>${xmlEscape(telemetryWorkerLogPath)}</string>\n\t<key>StandardErrorPath</key>\n\t<string>${xmlEscape(telemetryWorkerErrorLogPath)}</string>\n</dict>\n</plist>\n`;
}

function launchctlBestEffort(args) {
  if (process.env.OPENHERMIT_SKIP_LAUNCHCTL === '1') return { ok: true, output: 'skipped' };
  try {
    const output = execSync(`launchctl ${args.map((arg) => JSON.stringify(arg)).join(' ')}`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, output };
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : String(err) };
  }
}

// --- Windows boot autostart via Task Scheduler (schtasks) ------------------
// Mirrors the macOS launchd behavior: run at logon + restart on crash, so the
// telemetry worker survives reboots and recovers from process crashes with no
// manual intervention. HERMIT_HOME defaults to ~/.hermit for the current user.
function usageAutostartXmlPath() {
  return path.join(telemetryDir, 'windows-autostart.xml');
}

function buildUsageAutostartXml() {
  const nodeExe = process.execPath;
  const hermitEntry = fileURLToPath(import.meta.url);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Task xmlns="http://schemas.microsoft.com/windows/2004/02/mit_task">\n  <Triggers>\n    <LogonTrigger>\n      <Enabled>true</Enabled>\n    </LogonTrigger>\n  </Triggers>\n  <Settings>\n    <AllowHardTerminate>true</AllowHardTerminate>\n    <StartWhenAvailable>true</StartWhenAvailable>\n    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>\n    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>\n    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>\n    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>\n    <RestartOnFailure>\n      <Interval>PT1M</Interval>\n      <Count>999</Count>\n    </RestartOnFailure>\n    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>\n  </Settings>\n  <Actions Context="Author">\n    <Exec>\n      <Command>${xmlEscape(nodeExe)}</Command>\n      <Arguments>"${xmlEscape(hermitEntry)}" __telemetry-worker</Arguments>\n    </Exec>\n  </Actions>\n  <Principals>\n    <Principal id="Author">\n      <LogonType>InteractiveToken</LogonType>\n      <RunLevel>LeastPrivilege</RunLevel>\n    </Principal>\n  </Principals>\n</Task>\n`;
}

function cmdQuote(value) {
  const str = String(value);
  // cmd.exe: quote only when the value has spaces/special chars. Do NOT use
  // JSON.stringify — it doubles backslashes and breaks Windows paths (C:\\Users).
  return /[\s"&|<>^]/.test(str) ? `"${str}"` : str;
}

function schtasksBestEffort(args) {
  if (process.env.OPENHERMIT_SKIP_SCHTASKS === '1') return { ok: true, output: 'skipped' };
  try {
    const output = execSync(`schtasks ${args.join(' ')}`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, output };
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : String(err) };
  }
}

async function getUsageAutostartStatus() {
  const label = usageLaunchdLabel();
  const plistPath = usageLaunchdPlistPath();
  if (process.platform !== 'darwin') return { supported: false, enabled: false, loaded: false, label, plistPath };
  const print = launchctlBestEffort(['print', `gui/${process.getuid?.() ?? ''}/${label}`]);
  return { supported: true, enabled: existsSync(plistPath), loaded: print.ok, label, plistPath };
}

async function enableUsageAutostart() {
  const label = usageLaunchdLabel();
  const plistPath = usageLaunchdPlistPath();
  if (process.platform !== 'darwin') return getUsageAutostartStatus();
  mkdirSync(path.dirname(plistPath), { recursive: true });
  mkdirSync(path.dirname(telemetryWorkerLogPath), { recursive: true, mode: 0o700 });
  writeFileSync(plistPath, buildUsageLaunchdPlist(), 'utf-8');
  const uid = process.getuid?.();
  if (uid !== undefined) {
    launchctlBestEffort(['bootout', `gui/${uid}`, plistPath]);
    launchctlBestEffort(['bootstrap', `gui/${uid}`, plistPath]);
    launchctlBestEffort(['enable', `gui/${uid}/${label}`]);
    launchctlBestEffort(['kickstart', '-k', `gui/${uid}/${label}`]);
  }
  return getUsageAutostartStatus();
}

async function keepUsageAutostartWithoutRunning() {
  const label = usageLaunchdLabel();
  const plistPath = usageLaunchdPlistPath();
  if (process.platform !== 'darwin') return getUsageAutostartStatus();
  mkdirSync(path.dirname(plistPath), { recursive: true });
  mkdirSync(path.dirname(telemetryWorkerLogPath), { recursive: true, mode: 0o700 });
  writeFileSync(plistPath, buildUsageLaunchdPlist(), 'utf-8');
  const uid = process.getuid?.();
  if (uid !== undefined) {
    launchctlBestEffort(['bootout', `gui/${uid}`, plistPath]);
    launchctlBestEffort(['enable', `gui/${uid}/${label}`]);
  }
  return getUsageAutostartStatus();
}

async function disableUsageAutostart() {
  const label = usageLaunchdLabel();
  const plistPath = usageLaunchdPlistPath();
  const uid = process.getuid?.();
  if (process.platform === 'darwin' && uid !== undefined) launchctlBestEffort(['bootout', `gui/${uid}`, plistPath]);
  try { unlinkSync(plistPath); } catch {}
  return getUsageAutostartStatus();
}

async function withCliProgress(label, task) {
  if (jsonRequested || !process.stdout.isTTY) return task();
  const frames = useUnicodeUi ? ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] : ['-', '\\', '|', '/'];
  let index = 0;
  process.stdout.write(`${ui.dim(frames[index])} ${label}`);
  const timer = setInterval(() => {
    index = (index + 1) % frames.length;
    process.stdout.write(`\r${ui.dim(frames[index])} ${label}`);
  }, 120);
  try {
    return await task();
  } finally {
    clearInterval(timer);
    process.stdout.write(`\r${' '.repeat(displayWidth(`${frames[0]} ${label}`) + 4)}\r`);
  }
}


function readConversationUploadLogEvents(limit = 200) {
  if (!existsSync(conversationUploadLogPath)) return [];
  const lines = readFileSync(conversationUploadLogPath, 'utf-8').trim().split('\n').filter(Boolean).slice(-limit);
  return lines.flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function latestConversationUploadProgress(sinceMs = 0) {
  const events = readConversationUploadLogEvents().filter(
    (event) => Date.parse(event?.timestamp || '') >= sinceMs
  );
  // Aggregation (per-channel grouping + summing) lives in the pure, tested
  // usageProgress.mjs — this reader just feeds it this run's event tail.
  return aggregateUploadProgress(events);
}

// progressBar + uploadProgressLabel live in ./lib/usageProgress.mjs (pure, tested).

function fitProgressLine(text) {
  const columns = Math.max(40, Number(process.stdout.columns || 80));
  const maxWidth = Math.max(20, columns - 2);
  if (displayWidth(text) <= maxWidth) return text;
  let result = '';
  for (const char of text) {
    if (displayWidth(`${result}${char}…`) > maxWidth) break;
    result += char;
  }
  return `${result}…`;
}

function readLogChunkSince(filePath, offset) {
  try {
    const stat = statSync(filePath);
    const safeOffset = stat.size < offset ? 0 : offset;
    if (stat.size <= safeOffset) return { chunk: '', offset: stat.size };
    const raw = readFileSync(filePath, 'utf-8');
    return { chunk: raw.slice(safeOffset), offset: stat.size };
  } catch {
    return { chunk: '', offset };
  }
}

function printStartupLogChunk(chunk) {
  const lines = String(chunk || '').split(/\r?\n/).filter(Boolean).slice(-12);
  for (const line of lines) {
    process.stdout.write(`${ui.dim('│')} ${fitProgressLine(line)}\n`);
  }
}

async function waitForOpenHermitServerReadyWithLogs(pid, timeoutMs = 30_000) {
  if (jsonRequested || !process.stdout.isTTY) return waitForOpenHermitServerReady(pid, timeoutMs);
  const startedAt = Date.now();
  let logOffset = 0;
  process.stdout.write(`${ui.dim('正在启动 Web 工作台，日志：')} ${daemonLogPath}\n`);
  while (Date.now() - startedAt < timeoutMs) {
    const log = readLogChunkSince(daemonLogPath, logOffset);
    logOffset = log.offset;
    if (log.chunk) printStartupLogChunk(log.chunk);

    if (pid && !isPidRunning(pid)) {
      return { ready: false, reason: '服务进程已退出，请查看日志', url: `http://127.0.0.1:${port}` };
    }
    const server = await checkExistingOpenHermitServer();
    if (server.running) return { ready: true, ...server };
    process.stdout.write(`${ui.dim('… 等待 Web 服务就绪')}\n`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return { ready: false, reason: '服务还没准备好，请稍后刷新或查看日志', url: `http://127.0.0.1:${port}` };
}

async function withUploadProgress(label, task) {
  if (jsonRequested || !process.stdout.isTTY) return task();
  // Only consider log events from THIS run — otherwise the bar inherits the
  // previous run's last batch and shows 100% on entry before dropping to 0.
  const sinceMs = Date.now() - 1000;
  const frames = useUnicodeUi ? ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] : ['-', '\\', '|', '/'];
  let frame = 0;
  // Two-line layout: the label sits on its own line (static); the live bar +
  // spinner render on the line BELOW it and redraw in place ("进度条放到下面").
  // Both lines are cleared together on finish so the result box prints clean.
  // 扫描阶段（还没有上报批次事件）日志为空，bar 会死停在「等待扫描」——fullRescan 重扫
  // 几 GB 历史时长达数分钟，看起来像卡死。扫描/批次间隔期改显「已用时 Ns · 处理中」，
  // 秒数跳动即可证明进程活着；进入批量上报后交回 uploadProgressLabel 显示批次/百分比。
  const startedAt = Date.now();
  process.stdout.write(`${ui.dim(label)}\n`);
  const render = () => {
    const snapshot = latestConversationUploadProgress(sinceMs);
    const idle = !snapshot.hasBatch && (Number(snapshot.discovered ?? 0) <= 0);
    const bar = idle
      ? `已用时 ${Math.floor((Date.now() - startedAt) / 1000)}s · 处理中`
      : uploadProgressLabel(snapshot, { barWidth: 26 });
    const text = fitProgressLine(`${frames[frame]} ${bar}`);
    process.stdout.write(`\r\x1b[2K${text}`);
    frame = (frame + 1) % frames.length;
  };
  render();
  const timer = setInterval(render, 500);
  try {
    return await task();
  } finally {
    clearInterval(timer);
    // Clear the bar line, move up one line, clear the label line.
    process.stdout.write('\r\x1b[2K\x1b[1A\x1b[2K');
  }
}

// The shared "foreground scan" sequence used by both `usage report` and the
// menu scan action. Does exactly one thing in one place (no duplicated copies):
//   1. Pause the daemon worker if it is running, so this foreground scan owns
//      the upload lock and drains past in-flight backpressure.
//   2. When fullRescan, set HERMIT_USAGE_FULL_RESCAN=1 so the worker ignores
//      cursors and re-uploads ALL history (the server dedups by eventId, so a
//      full re-upload is the safe backfill path when the cursor missed things).
//   3. Run one scan+upload under the progress bar.
//   4. Always clear the env flag and restart the worker — even on throw — so a
//      full rescan can never leak the flag into a later incremental scan, and
//      the background worker always comes back if it was running.
async function runForegroundScan({ fullRescan = false, progressText }) {
  const workerPid = readPidFile(telemetryWorkerPidPath);
  // A live worker is the pidfile'd one OR a stray orphan a stale pidfile lost
  // (dead pidfile pid while a real worker is still alive). Use the same herd view
  // stopTelemetryWorker reaps, so usage report pauses/reaps the orphan too — a
  // stale pidfile otherwise makes the scan coexist with a second worker.
  const workerWasRunning =
    (Number.isInteger(workerPid) && workerPid > 0 && isPidRunning(workerPid)) ||
    collectRunningUsageWorkerPids().some((pid) => isPidRunning(pid));
  if (workerWasRunning) await stopTelemetryWorker();
  if (fullRescan) process.env.HERMIT_USAGE_FULL_RESCAN = '1';
  try {
    return await withUploadProgress(progressText, () => readUsageStatus({ scan: true, localOnly: false }));
  } finally {
    if (fullRescan) delete process.env.HERMIT_USAGE_FULL_RESCAN;
    if (workerWasRunning) startTelemetryWorker({ quiet: true });
  }
}

async function printUsageReport({ exitOnDone = true } = {}) {
  try {
    // Refresh the bearer (hits /me, auto-refreshes expired tokens) BEFORE the
    // scan, so the worker reads a fresh token from openhermit.json instead of
    // seeing an expired one and bailing to "等待登录". readOpenHermitAuthStatus()
    // alone never refreshes, which is why manual uploads failed after expiry.
    const auth = await refreshOpenHermitAuthStatus();
    const states = currentFeatureStates();
    if (states.conversationUploadEnabled && !auth.authorized) {
      const result = {
        ok: false,
        command: 'usage report',
        hermitHome,
        error: `${BRAND.stylizedName} login required for message upload`,
        auth: { authorized: false },
        upload: { enabled: true, authorized: false },
      };
      if (jsonRequested) printJson(result, 1);
      printCliRows('用量上报报告', [
        ['消息上报', '已开启，但未登录', 'warn'],
        ['本次扫描', '已取消，避免扫描后无法上报', 'warn'],
        ['下一步', '进入「用户」登录（命令行：openhermit auth login）', 'info'],
      ], '在「用户」中登录后再扫描上报，会按服务端 cursor 只扫描新增消息。');
      if (exitOnDone) process.exit(1);
      return result;
    }

    const fullRescan = commandArgs.includes('--full');
    const data = await runForegroundScan({
      fullRescan,
      progressText: fullRescan
        ? '正在全量重扫并重传（--full，服务端按 eventId 去重，可能耗时，请勿退出）...'
        : '正在执行一次增量扫描并按需上报，请勿退出...',
    });
    const upload = data.telemetry.conversationUpload;
    const result = {
      ok: true,
      command: 'usage report',
      hermitHome,
      localOnly: false,
      upload: {
        enabled: Boolean(upload?.enabled),
        authorized: auth.authorized,
        attempted: upload?.attempted || 0,
        accepted: upload?.accepted || 0,
        duplicated: upload?.duplicated || 0,
        rejected: upload?.rejected || 0,
      },
      ...data,
    };
    if (jsonRequested) printJson(result);
    await printUsageRows('用量上报报告', data, '已执行一次增量扫描；消息上报开启时会按服务端 cursor 只扫描新增消息。');
    if (exitOnDone) process.exit(0);
    return result;
  } catch (err) {
    const result = { ok: false, command: 'usage report', hermitHome, error: err instanceof Error ? err.message : String(err) };
    if (jsonRequested) printJson(result, 1);
    console.error(`${brandLogPrefix()} usage report 失败：${result.error}`);
    if (exitOnDone) process.exit(1);
    return result;
  }
}

// Compact result box for the menu scan action. Distinct from `usage report`
// (the full dashboard): it answers "this scan uploaded N, server has M, X still
// pending" in a few rows and never dumps the full report. Reuses localServerRows
// (tested) so 本地/服务端/待上报 stay consistent everywhere.
//
// The menu wires this as a FULL re-upload (fullRescan=true): the background
// worker is paused, history is re-scanned ignoring cursors and re-uploaded
// (server dedups by eventId — safe backfill), then the worker is restored.
// Incremental mode (fullRescan=false) is retained for `usage scan-once` callers.
async function printScanOnceResult({ exitOnDone = true, fullRescan = false } = {}) {
  const title = fullRescan ? '立即全量上报' : '立即扫描并上报一次';
  try {
    const auth = await refreshOpenHermitAuthStatus();
    const states = currentFeatureStates();
    if (states.conversationUploadEnabled && !auth.authorized) {
      const result = {
        ok: false,
        command: 'scan-once',
        hermitHome,
        auth: { authorized: false },
        upload: { enabled: true, authorized: false },
      };
      if (jsonRequested) printJson(result, 1);
      printCliRows(title, [
        ['消息上报', '已开启，但未登录', 'warn'],
        ['本次扫描', '已取消，避免扫描后无法上报', 'warn'],
        ['下一步', '进入「用户」登录（命令行：openhermit auth login）', 'info'],
      ], '在「用户」中登录后再执行，会按服务端 cursor 只扫描新增消息。');
      if (exitOnDone) process.exit(1);
      return result;
    }

    const data = await runForegroundScan({
      fullRescan,
      progressText: fullRescan
        ? '正在全量重扫并重传（服务端按 eventId 去重，可能耗时，请勿退出）...'
        : '正在执行一次增量扫描并按需上报，请勿退出...',
    });

    const upload = data.telemetry?.conversationUpload || {};
    const attempted = Number(upload.attempted || 0);
    const accepted = Number(upload.accepted || 0);
    const after = currentFeatureStates();
    const workerText = after.usageRunning
      ? `后台运行中 (pid ${after.usagePid})，每 5 分钟继续增量扫描`
      : '后台未运行';

    const rows = [];
    const uploadError = typeof upload.lastError === 'string' && upload.lastError ? upload.lastError : '';
    rows.push([
      '本次上报',
      accepted > 0
        ? `${formatNumber(accepted)} 条消息已上传${attempted !== accepted ? ` · 尝试 ${formatNumber(attempted)}` : ''}`
        : uploadError
          ? `上报失败：${uploadError}`
          : fullRescan
            ? '无消息可上报（服务端已全部入库）'
            : '无新增消息',
      accepted > 0 ? 'ok' : uploadError ? 'error' : 'info',
    ]);
    rows.push(...localServerRows(data.telemetry, data.authoritativeUsage));
    rows.push(...cursorPendingRows(upload));
    // Per-channel breakdown so it's visible which provider/mode reported vs not
    // (e.g. claudecode/im never_reported = the 422-stuck channel). remoteUsage is
    // always fetched by readUsageStatus(!localOnly); reuse the same renderer the
    // regular `usage status` uses so the two views stay consistent.
    rows.push(...conversationUploadRows({}, auth, data.remoteUsage));
    rows.push(['消息上报', workerText, after.usageRunning ? 'ok' : 'warn']);

    const result = { ok: true, command: 'scan-once', hermitHome, ...data };
    if (jsonRequested) printJson(result);
    printCliRows(
      title,
      rows,
      fullRescan
        ? '全量上报忽略游标、重传全部历史；服务端按 eventId 去重，已入库的消息不会重复计数。下方按渠道：success=该渠道已提交 cursor，never_reported=该渠道尚未提交 cursor。'
        : '待上报来自本次按服务端 cursor 扫描后尚未成功提交的消息数；本地/服务端总账只作诊断对比，不用于相减。下方按渠道：success=该渠道已提交 cursor，never_reported=该渠道尚未提交 cursor。',
    );
    if (exitOnDone) process.exit(0);
    return result;
  } catch (err) {
    const result = {
      ok: false,
      command: 'scan-once',
      hermitHome,
      error: err instanceof Error ? err.message : String(err),
    };
    if (jsonRequested) printJson(result, 1);
    console.error(`${brandLogPrefix()} 扫描失败：${result.error}`);
    if (exitOnDone) process.exit(1);
    return result;
  }
}

function getUploadProvidersFromFlags() {
  const values = findAnyOptionValues(['--upload-provider', '--provider', '--providers']);
  return normalizeUploadProviders(values).length ? normalizeUploadProviders(values) : ['claudecode', 'codex'];
}

function getUploadProviderFromFlags() {
  return getUploadProvidersFromFlags()[0] || 'claudecode';
}

async function printUsageStart({ exitOnDone = true } = {}) {
  const autostartRequested = !commandArgs.includes('--no-autostart');
  const shouldEnableConversationUpload = args.includes('--upload') || args.includes('--upload-conversations');
  if (shouldEnableConversationUpload) {
    const providers = getUploadProvidersFromFlags();
    setConversationUploadEnabled(providers.length > 0, providers);
  }
  // Self-heal: if a worker is already running but its source is stale (e.g.
  // openhermit was updated while reporting), reload it so re-running
  // `usage start` is enough to load the latest code. No-op when nothing is
  // running (startTelemetryWorker below spawns a fresh one) or when current.
  await restartTelemetryWorkerIfStale({ quiet: jsonRequested });
  const taskBus = enableLocalUsageTelemetry();
  const worker = startTelemetryWorker({ quiet: jsonRequested });
  const autostart = autostartRequested ? await enableUsageAutostart() : await getUsageAutostartStatus();
  const result = {
    ok: true,
    command: 'usage start',
    hermitHome,
    worker,
    daemon: usageDaemonPayload({ running: false, url: `http://127.0.0.1:${port}`, version: '' }),
    autostart,
    telemetry: {
      localScanEnabled: true,
      source: 'claude-jsonl',
    },
    auth: {
      authorized: readOpenHermitAuthStatus().authorized,
    },
  };
  if (jsonRequested) printJson(result);
  const auth = readOpenHermitAuthStatus();
  const conversationUploadEnabled = Boolean(taskBus.telemetry?.conversationUploadEnabled);
  const featureProviders = currentFeatureStates().uploadProviders;
  const attributionProviders = featureProviders?.length ? featureProviders : ['claudecode', 'codex'];
  printCliRows('消息上报后台已启动', [
    ['消息上报', conversationUploadEnabled ? auth.authorized ? `开启（pid ${worker.pid}）` : `等待登录（pid ${worker.pid}）` : '关闭', conversationUploadEnabled ? auth.authorized ? 'ok' : 'warn' : 'off'],
    ['日志', worker.logPath, 'info'],
    ['开机自启', autostart.enabled ? '开启' : '关闭', autostart.enabled ? 'ok' : 'off'],
    ['模式', '首次补齐全部历史，后续只上报增量', 'info'],
    ['归因', `${formatUploadProviders(attributionProviders)} + IM 会话归因`, 'info'],
  ], conversationUploadEnabled
    ? '消息上报会启动后台增量扫描；需要登录后用 Bearer 授权发送。'
    : '消息上报已关闭；开启后首次补齐历史消息，之后只上传新增消息。');
  if (exitOnDone) process.exit(0);
  return result;
}

async function printUsageStop({ exitOnDone = true } = {}) {
  const disableAutostart = !commandArgs.includes('--keep-autostart');
  const taskBus = disableLocalUsageTelemetry();
  const worker = await stopTelemetryWorker();
  const autostart = disableAutostart ? await disableUsageAutostart() : await keepUsageAutostartWithoutRunning();
  const result = {
    ok: true,
    command: 'usage stop',
    hermitHome,
    worker,
    autostart,
    telemetry: {
      localScanEnabled: Boolean(taskBus.telemetry?.enabled),
      source: 'claude-jsonl',
    },
  };
  if (jsonRequested) printJson(result);
  printCliRows('用量上报已停止', [
    ['后台扫描', worker.stopped ? `已停止 (pid ${worker.pid})` : '未运行'],
    ['开机自启', autostart.enabled ? '开启' : '关闭'],
    ['本地扫描', '关闭'],
  ], autostart.enabled ? '如需保留开机自启：openhermit usage stop --keep-autostart' : '重新启动：openhermit usage start');
  if (exitOnDone) process.exit(0);
  return result;
}

async function printUsageAutostart({ exitOnDone = true } = {}) {
  const action = commandArgs[2] || 'status';
  let autostart;
  if (action === 'enable') autostart = await enableUsageAutostart();
  else if (action === 'disable') autostart = await disableUsageAutostart();
  else if (action === 'status') autostart = await getUsageAutostartStatus();
  else {
    const result = { ok: false, command: `usage autostart ${action}`, error: `Unknown usage autostart action: ${action}` };
    if (jsonRequested) printJson(result, 1);
    console.error(`${brandLogPrefix()} 未知 usage autostart 动作：${action}`);
    if (exitOnDone) process.exit(1);
    return result;
  }
  const result = { ok: true, command: `usage autostart ${action}`, hermitHome, autostart };
  if (jsonRequested) printJson(result);
  printCliRows('用量上报开机自启', [
    ['支持', autostart.supported ? '是' : '否'],
    ['状态', autostart.enabled ? '开启' : '关闭'],
    ['已加载', autostart.loaded ? '是' : '否'],
    ['Label', autostart.label],
    ['Plist', autostart.plistPath],
  ]);
  if (exitOnDone) process.exit(0);
  return result;
}

function summarizeTaskBus(taskBus = {}) {
  const redis = taskBus.redis && typeof taskBus.redis === 'object' ? taskBus.redis : { host: '127.0.0.1', port: 6379 };
  return {
    enabled: Boolean(taskBus.enabled),
    collaboration: Boolean(taskBus.collaboration),
    redis: {
      host: typeof redis.host === 'string' && redis.host.trim() ? redis.host : '127.0.0.1',
      port: Number.isFinite(Number(redis.port)) ? Number(redis.port) : 6379,
      ...(redis.password ? { password: true } : {}),
      ...(redis.db !== undefined ? { db: redis.db } : {}),
    },
    telemetry: {
      enabled: Boolean(taskBus.telemetry?.enabled),
      platform: taskBus.telemetry?.platform || 'claudecode',
    },
  };
}

async function collectServicesStatus() {
  const [daemon, usage] = await Promise.all([
    collectDaemonStatus(),
    readUsageStatus({ scan: false }),
  ]);
  const taskBus = summarizeTaskBus(readHermitSettings().taskBus || {});
  return {
    hermitHome,
    web: {
      running: Boolean(daemon.running),
      pid: daemon.pid || null,
      url: daemon.server?.url || daemon.url,
      logPath: daemonLogPath,
    },
    usage: {
      enabled: taskBus.telemetry.enabled,
      worker: usage.worker,
      autostart: usage.worker?.autostart || null,
      source: 'claude-jsonl',
    },
    collaboration: {
      enabled: Boolean(taskBus.enabled && taskBus.collaboration),
      redis: taskBus.redis,
    },
    auth: {
      authorized: readOpenHermitAuthStatus().authorized,
    },
  };
}

function printServicesRows(title, status, hint = '') {
  printCliRows(title, [
    ['Web 控制台', status.web.running ? `运行中 ${status.web.url}` : '未运行'],
    ['用量后台', status.usage.worker?.running ? `运行中 (pid ${status.usage.worker.pid})` : '未运行'],
    ['用量统计', status.usage.enabled ? '本地扫描开启' : '关闭'],
    ['团队协作', status.collaboration.enabled ? '开启' : '关闭'],
    ['Redis', `${status.collaboration.redis.host}:${status.collaboration.redis.port}`],
    ['用户', status.auth.authorized ? '已登录' : '未登录'],
  ], hint);
}

async function printServicesStatus({ exitOnDone = true } = {}) {
  const status = await collectServicesStatus();
  const result = { ok: true, command: 'services status', ...status, actions: SERVICE_ACTIONS };
  if (jsonRequested) printJson(result);
  printServicesRows('服务状态', status, '启动本地基础服务：openhermit services start local');
  if (exitOnDone) process.exit(0);
  return result;
}

async function startUsageService({ autostartRequested = !args.includes('--no-autostart') } = {}) {
  enableLocalUsageTelemetry();
  const worker = startTelemetryWorker({ quiet: true });
  const autostart = autostartRequested ? await enableUsageAutostart() : await getUsageAutostartStatus();
  return {
    enabled: true,
    worker,
    autostart,
    source: 'claude-jsonl',
  };
}

async function stopUsageService() {
  const taskBus = disableLocalUsageTelemetry();
  const worker = await stopTelemetryWorker();
  const autostart = await disableUsageAutostart();
  return {
    enabled: Boolean(taskBus.telemetry?.enabled),
    worker,
    autostart,
    source: 'claude-jsonl',
  };
}

function startCollaborationService() {
  return summarizeTaskBus(enableTeamCollaborationDefaults());
}

function startWebService() {
  if (process.env.OPENHERMIT_SERVICE_WEB_MODE === 'test') {
    return { running: true, started: true, pid: process.pid, url: `http://127.0.0.1:${port}`, logPath: daemonLogPath, mode: 'test' };
  }
  const daemon = startDaemon({ exitOnDone: false, quiet: true });
  return { running: true, ...daemon };
}

async function runServiceAction(actionId) {
  if (actionId === 'start-local') {
    const web = startWebService();
    const usage = await startUsageService();
    const collaboration = startCollaborationService();
    return { ok: true, command: 'services start local', hermitHome, web, usage, collaboration, auth: { authorized: readOpenHermitAuthStatus().authorized } };
  }
  if (actionId === 'start-web') return { ok: true, command: 'services start web', hermitHome, web: startWebService() };
  if (actionId === 'start-usage') return { ok: true, command: 'services start usage', hermitHome, usage: await startUsageService() };
  if (actionId === 'start-collaboration') return { ok: true, command: 'services start collaboration', hermitHome, collaboration: startCollaborationService(), auth: { authorized: readOpenHermitAuthStatus().authorized } };
  if (actionId === 'stop-usage') return { ok: true, command: 'services stop usage', hermitHome, usage: await stopUsageService() };
  if (actionId === 'stop-web') return { ok: true, command: 'services stop web', hermitHome, web: await stopDaemon({ exitOnDone: false, quiet: true }) };
  if (actionId === 'status') return printServicesStatus({ exitOnDone: false });
  throw new Error(`Unknown services action: ${actionId}`);
}

function serviceActionIdForCommand(verb, target) {
  if (!verb) return 'status';
  if (verb === 'status') return 'status';
  if (verb === 'start') {
    if (target === 'local') return 'start-local';
    if (target === 'web') return 'start-web';
    if (target === 'usage') return 'start-usage';
    if (target === 'collaboration') return 'start-collaboration';
  }
  if (verb === 'stop') {
    if (target === 'usage') return 'stop-usage';
    if (target === 'web') return 'stop-web';
  }
  return null;
}

async function printServicesCommand({ exitOnDone = true } = {}) {
  if (commandArgs.length === 1 && !jsonRequested && isInteractiveCli()) {
    await runServicesMenu();
    if (exitOnDone) process.exit(0);
    return { ok: true, command: 'services' };
  }
  const actionId = serviceActionIdForCommand(commandArgs[1], commandArgs[2]);
  if (!actionId) {
    const command = commandArgs.join(' ');
    const result = { ok: false, command, error: `Unknown services action: ${command}` };
    if (jsonRequested) printJson(result, 1);
    console.error(`${brandLogPrefix()} 未知 services 动作：${command}`);
    if (exitOnDone) process.exit(1);
    return result;
  }
  const result = await runServiceAction(actionId);
  if (jsonRequested) printJson(result);
  if (actionId === 'status') return result;
  const status = await collectServicesStatus();
  printServicesRows('服务已更新', status, '继续定制可运行：openhermit services');
  if (exitOnDone) process.exit(0);
  return result;
}

async function runServicesMenu() {
  while (true) {
    const actionId = await askMenuAction({
      title: '服务菜单',
      subtitle: '选择要启动/停止的本地服务；本地基础服务无需登录',
      actions: SERVICE_ACTIONS,
      escapeAction: 'back',
    });
    if (actionId === 'back') return;
    try {
      await runServiceAction(actionId);
      const status = await collectServicesStatus();
      printServicesRows('服务已更新', status);
    } catch (err) {
      printCliRows('服务操作失败', [['原因', err instanceof Error ? err.message : String(err)]], '上传/托管能力需要先在「用户」中登录。');
    }
    await waitForNavigationContinue('按 Enter/← 返回服务菜单 | Esc/Ctrl+C 退出');
  }
}

async function openWebSettingsTaskBus() {
  console.log('');
  console.log('正在后台启动 Web 控制台...');
  startDaemon({ exitOnDone: false, quiet: true });
  printCliRows('Web 设置入口', [
    ['状态', '已启动本机 Web 控制台'],
    ['地址', `http://127.0.0.1:${port}`],
    ['进入', '设置 > 团队总线'],
  ], 'Redis/IM/协作配置都在 Web 中管理。');
}

async function printLocalCollectionOverview() {
  const server = await checkExistingOpenHermitServer();
  if (!server.running) {
    printCliRows('本地数据采集', [
      ['状态', 'Web 未运行，暂无法读取 Loop 使用概览'],
      ['模式', '本地扫描，无需登录，不依赖 Redis'],
      ['隐私', '不上传对话内容'],
    ], '打开 Web 控制台，进入 设置 > 团队总线 > 本地数据采集。');
    return;
  }

  try {
    const status = await fetchLocalJson('/api/telemetry/status');
    printCliRows('Loop 使用概览', [
      ['采集会话', formatNumber(status.sessions)],
      ['消息数', formatNumber(status.messages)],
      ['Token 总量', formatNumber(status.totalTokens)],
      ['最近采集', status.lastScan ? new Date(status.lastScan).toLocaleString('zh-CN') : '-'],
      ['隐私', '本地扫描，不上传提示词、回复、路径或原始记录'],
    ]);
  } catch (err) {
    printCliRows('本地数据采集', [
      ['状态', '读取失败'],
      ['原因', err instanceof Error ? err.message : String(err)],
      ['模式', '本地扫描，无需登录，不依赖 Redis'],
    ], '打开 Web 控制台，进入 设置 > 团队总线 > 本地数据采集。');
  }
}

async function triggerLocalCollectionScan() {
  const server = await checkExistingOpenHermitServer();
  if (!server.running) {
    printCliRows('本地数据采集', [
      ['状态', 'Web 未运行，CLI 不重复实现扫描配置'],
      ['进入', '设置 > 团队总线 > 本地数据采集'],
    ], '请先打开 Web 控制台。');
    return;
  }

  try {
    await fetchLocalJson('/api/telemetry/scan', { method: 'POST' });
    await printLocalCollectionOverview();
  } catch (err) {
    printCliRows('立即采集失败', [
      ['原因', err instanceof Error ? err.message : String(err)],
      ['进入', 'Web 设置 > 团队总线 > 本地数据采集'],
    ], '请在 Web 中重试。');
  }
}

async function printTaskBusStatus() {
  const server = await checkExistingOpenHermitServer();
  if (!server.running) {
    printCliRows('团队总线状态', [
      ['状态', 'Web 未运行，无法确认实时 Redis 连接'],
      ['Redis', '仅用于本地/自托管团队总线'],
      ['Usage 统计', '仅扫描本机 Claude Code JSONL'],
    ], '配置入口：Web 设置 > 团队总线。');
    return;
  }

  try {
    const [config, telemetry] = await Promise.all([
      fetchLocalJson('/api/settings/task-bus'),
      fetchLocalJson('/api/telemetry/status').catch(() => null),
    ]);
    printCliRows('团队总线状态', [
      ['团队总线', formatStatusToggle(config.enabled)],
      ['Redis', telemetry?.connected ? '已连接' : config.enabled ? '未连接/未知' : '未启用'],
      ['Usage 统计', config.telemetry?.enabled ? '本地扫描开启' : '关闭'],
      ['分布式协作', formatStatusToggle(config.collaboration)],
      ['边界', 'Redis 仅用于本地/自托管协作，Usage 统计不上传'],
    ], '配置入口：Web 设置 > 团队总线。');
  } catch (err) {
    printCliRows('团队总线状态', [
      ['状态', '读取失败'],
      ['原因', err instanceof Error ? err.message : String(err)],
    ], '配置入口：Web 设置 > 团队总线。');
  }
}

async function chooseUploadProviderPrompt(defaultProviders = ['claudecode', 'codex']) {
  const defaults = normalizeUploadProviders(defaultProviders);
  printCliRows('选择消息上报来源', USAGE_UPLOAD_PROVIDER_OPTIONS.map((option, index) => [
    `${index + 1}. ${option.label}`,
    option.description,
    defaults.includes(option.id) ? 'ok' : 'info',
  ]), '可多选：输入 1,2 同时上报 Claude Code + Codex；直接回车默认全选。');

  if (!process.stdin.isTTY) return defaults.length ? defaults : ['claudecode', 'codex'];
  const rl = createPromptInterface();
  try {
    const answer = (await rl.question('\n请选择 [1/2/1,2]，默认 1,2: ')).trim();
    if (!answer) return defaults.length ? defaults : ['claudecode', 'codex'];
    const tokens = answer.split(/[,+，、\s]+/u).filter(Boolean);
    const selected = tokens.flatMap((token) => {
      if (token === '1') return ['claudecode'];
      if (token === '2') return ['codex'];
      if (/^(all|both|全部|全选)$/iu.test(token)) return ['claudecode', 'codex'];
      return [token.toLowerCase()];
    });
    const normalized = normalizeUploadProviders(selected);
    return normalized.length ? normalized : defaults;
  } finally {
    rl.close();
  }
}

async function enableConversationUploadWithProvider(providers = ['claudecode', 'codex']) {
  const selectedProviders = normalizeUploadProviders(providers);
  const enabledProviders = selectedProviders.length ? selectedProviders : ['claudecode', 'codex'];
  const taskBus = setConversationUploadEnabled(true, enabledProviders);
  await runNavigationAction({ id: 'start-background' });
  return { taskBus, providers: enabledProviders, started: true };
}

async function runLocalCollectionAction() {
  while (true) {
    const actionId = await askMenuAction({
      title: '用量上报',
      subtitle: '本地扫描可免登录；消息上报支持多选 Claude Code / Codex，按批次增量上传',
      actions: LOCAL_COLLECTION_ACTIONS,
      escapeAction: 'back',
    });
    if (actionId === 'back') return;
    if (actionId === 'overview') await printUsageStatus({ exitOnDone: false });
    if (actionId === 'scan') await printScanOnceResult({ exitOnDone: false, fullRescan: true });
    if (actionId === 'choose-upload-provider') await enableConversationUploadWithProvider();
    if (actionId === 'start-background') await printUsageStart({ exitOnDone: false });
    if (actionId === 'stop-background') await printUsageStop({ exitOnDone: false });
    await waitForNavigationContinue('按 Enter 返回用量上报菜单 | Esc/Ctrl+C 退出（后台继续运行）');
  }
}

async function runTaskBusAction() {
  while (true) {
    const actionId = await askMenuAction({
      title: '团队总线',
      subtitle: '本地 / 自托管 Redis 与协作状态 | 配置入口：Web 设置 > 团队总线',
      actions: TASK_BUS_ACTIONS,
      escapeAction: 'back',
    });
    if (actionId === 'back') return;
    if (actionId === 'status') await printTaskBusStatus();
    if (actionId === 'open-web-settings') await openWebSettingsTaskBus();
    if (actionId === 'doctor') await printDoctor({ exitOnDone: false });
    await waitForNavigationContinue('按 Enter 返回团队总线菜单 | Ctrl+C 退出');
  }
}

async function runAccountAction() {
  while (true) {
    const actionId = await askMenuAction({
      title: '登录状态',
      subtitle: `本地使用无需登录；云端授权、托管服务或显式上传需要 ${BRAND.authAccountLabel}`,
      actions: ACCOUNT_ACTIONS,
      escapeAction: 'back',
    });
    if (actionId === 'back') return;
    if (actionId === 'status') await printAuthStatus({ exitOnDone: false });
    if (actionId === 'login') await runAuthLogin({ exitOnDone: false, interactiveMenu: true });
    if (actionId === 'logout') await runAuthLogout({ exitOnDone: false });
    if (actionId === 'dev-login') await runAuthDevLogin({ exitOnDone: false });
    await waitForNavigationContinue('按 Enter/← 返回登录状态菜单 | Esc/Ctrl+C 退出');
  }
}

async function runLocalUseAction() {
  while (true) {
    const actionId = await askMenuAction({
      title: '本地使用',
      subtitle: '无需登录 | 本机 Web、数字员工、本地采集和运行时',
      actions: LOCAL_USE_ACTIONS,
      escapeAction: 'back',
    });
    if (actionId === 'back') return;
    const action = findMenuAction(LOCAL_USE_ACTIONS, actionId);
    if (action) await runNavigationAction(action);
  }
}

async function printCollaborationStart({ exitOnDone = true } = {}) {
  const auth = readOpenHermitAuthStatus();
  const taskBus = enableTeamCollaborationDefaults();
  const result = {
    ok: true,
    command: 'collaboration start',
    hermitHome,
    taskBus: {
      enabled: Boolean(taskBus.enabled),
      collaboration: Boolean(taskBus.collaboration),
      redis: taskBus.redis,
      telemetry: {
        enabled: Boolean(taskBus.telemetry?.enabled),
        platform: taskBus.telemetry?.platform || 'claudecode',
      },
    },
    auth: {
      authorized: auth.authorized,
    },
  };
  if (jsonRequested) printJson(result);
  printCliRows('团队协作已准备好', [
    ['用户', auth.authorized ? `已登录 ${BRAND.authProviderName}` : '未登录（本地/自托管协作可用）'],
    ['Redis', `${taskBus.redis.host}:${taskBus.redis.port}`],
    ['配置入口', 'Web 设置 > 团队总线'],
  ], 'Redis 仅用于本地/自托管团队协作；Usage 统计不会上传。');
  if (exitOnDone) process.exit(0);
  return result;
}

async function runTeamCollaborationAction() {
  const result = await printCollaborationStart({ exitOnDone: false });
  const auth = result.auth;
  const taskBus = result.taskBus;
  const nextAction = await waitForNavigationContinue('按 Enter/→ 进入团队协作菜单 | ← 返回首页 | Esc/Ctrl+C 退出');
  if (nextAction === 'back') return;

  while (true) {
    const actionId = await askMenuAction({
      title: '团队协作',
      subtitle: auth.authorized ? '已登录 | Redis 配置已写入本机设置' : '未登录 | 本地/自托管协作可用',
      actions: TEAM_COLLAB_ACTIONS,
      escapeAction: 'back',
    });
    if (actionId === 'back') return;
    if (actionId === 'open-web-settings') await openWebSettingsTaskBus();
    if (actionId === 'task-bus') await printTaskBusStatus();
    if (actionId === 'account') await runAccountAction();
    await waitForNavigationContinue('按 Enter/← 返回团队协作菜单 | Esc/Ctrl+C 退出');
  }
}

async function runEmployeeAction() {
  while (true) {
    const actionId = await askMenuAction({
      title: '数字员工',
      subtitle: '团队、任务与协作入口',
      actions: EMPLOYEE_ACTIONS,
      escapeAction: 'back',
    });
    if (actionId === 'back') return;
    if (actionId === 'create-team') {
      await printTeamsCreate({ exitOnDone: false });
      await waitForNavigationContinue('按 Enter 返回数字员工菜单 | Ctrl+C 退出');
      continue;
    }
    if (actionId === 'list-teams') {
      printTeamsList({ exitOnDone: false });
      await waitForNavigationContinue('按 Enter 返回数字员工菜单 | Ctrl+C 退出');
    }
  }
}

async function runRuntimeAction() {
  while (true) {
    const actionId = await askMenuAction({
      title: '本地运行时',
      subtitle: 'Web / daemon / runtime 生命周期管理',
      actions: RUNTIME_ACTIONS,
      escapeAction: 'back',
    });
    if (actionId === 'back') return;
    if (actionId === 'status') {
      await printDaemonStatus({ exitOnDone: false });
      await waitForNavigationContinue('按 Enter 返回本地运行时菜单 | Ctrl+C 退出');
      continue;
    }
    if (actionId === 'doctor') {
      await printDoctor({ exitOnDone: false });
      await waitForNavigationContinue('按 Enter 返回本地运行时菜单 | Ctrl+C 退出');
      continue;
    }
    if (actionId === 'stop') {
      await stopDaemon({ exitOnDone: false });
      await waitForNavigationContinue('按 Enter 返回本地运行时菜单 | Ctrl+C 退出');
    }
  }
}

async function runNavigationAction(action) {
  if (action.id === 'web' || action.id === 'toggle-web') {
    await runNavigationAction({ id: currentFeatureStates().webRunning ? 'stop-web' : 'start-web' });
    return;
  }
  if (action.id === 'toggle-feishu-bridge') {
    await runNavigationAction({ id: currentFeatureStates().feishuBridge.running ? 'stop-feishu-bridge' : 'start-feishu-bridge' });
    return;
  }
  if (action.id === 'toggle-background') {
    await runNavigationAction({ id: currentFeatureStates().usageRunning ? 'stop-background' : 'start-background' });
    return;
  }
  if (action.id === 'toggle-message-upload') {
    const states = currentFeatureStates();
    if (!states.conversationUploadEnabled || !states.usageRunning) {
      await enableConversationUploadWithProvider();
      return;
    }
    setConversationUploadEnabled(false, states.uploadProviders);
    const worker = await stopTelemetryWorker();
    await clearStaleConversationUploadLock();
    markTelemetryWorkerRestarting('消息上报已关闭，worker 已停止');
    const updatedStates = currentFeatureStates();
    printCliRows('消息上报', [
      ['状态', '已关闭，worker 已重启/停止', 'off'],
      ['菜单显示', updatedStates.conversationUploadEnabled ? '仍显示开启，请刷新状态' : '已更新为关闭', updatedStates.conversationUploadEnabled ? 'warn' : 'ok'],
      ['worker', worker.stopped ? `已停止 pid ${worker.pid}` : '未运行', 'info'],
      ['来源', formatUploadProviders(states.uploadProviders), 'info'],
      ['说明', '关闭消息上报会停止 worker 并清理上报锁', 'info'],
    ], '再次开启会重新启动 worker，并从服务端 /report/usage/status 读取 cursor。');
    return;
  }
  if (action.id === 'start-web') {
    const daemon = startDaemon({ exitOnDone: false, quiet: true });
    const ready = await waitForOpenHermitServerReadyWithLogs(daemon.pid);
    if (ready.ready) {
      refreshDaemonPidFromReadyServer(daemon.pid);
      markWebRunningOptimistic();
      printCliRows('本地数字员工工作台', [
        ['状态', daemon.started ? '已启动并可打开' : '已运行并可打开', 'ok'],
        ['地址', ready.url || daemon.url, 'info'],
        ['设置', '复杂配置请在工作台中完成', 'info'],
      ]);
      return;
    }
    printCliRows('本地数字员工工作台', [
      ['状态', '启动失败或仍在启动中', 'error'],
      ['地址', daemon.url, 'info'],
      ['日志', daemon.logPath, 'info'],
      ['原因', ready.reason, 'warn'],
    ], '已打印最近日志，按提示处理后再重试。');
    printLogTail(BRAND.stylizedName, daemon.logPath);
    return;
  }
  if (action.id === 'stop-web') {
    await stopDaemon({ exitOnDone: false, quiet: true });
    clearWebRunningOptimistic();
    printCliRows('本地数字员工工作台', [
      ['状态', '已关闭', 'off'],
      ['用量上报', '不受影响', 'info'],
    ]);
    return;
  }
  if (action.id === 'web-status') {
    await printDaemonStatus({ exitOnDone: false });
    return;
  }
  if (action.id === 'install-lark-cli') {
    const r = await installLarkCli();
    printCliRows('快速安装 lark-cli', [
      ['结果', r.ok ? (r.alreadyInstalled ? '已安装' : '安装成功') : '未完成', r.ok ? 'ok' : 'error'],
      ['路径', r.binPath || '—', 'info'],
      ['说明', r.message, 'info'],
    ], r.ok
      ? '团队隔离请在每队 .env 配置 LARK_CLI_PROFILE（见 scripts/build-pages.mjs）'
      : '请确认 Node.js / npm 可用后重试');
    return;
  }
  if (action.id === 'start-feishu-bridge') {
    // 一站式编排：确保就绪（已随 AgentCli 打包；缺失时按需补装）→ 未配置就把终端交给 fcb 的 `bot init` 填凭证 → 启动守护进程。
    // 不复制 fcb 的凭证/校验逻辑——App ID / App Secret 由 fcb 自己弹框采集，hermit 只编排。
    const ensured = await ensureFeishuCodexBridge();
    if (!ensured.ok) {
      printCliRows('飞书 Codex 桥', [
        ['状态', '安装未完成', 'error'],
        ['说明', ensured.message, 'info'],
      ]);
      return;
    }

    if (!feishuBridgeConfigured()) {
      printCliRows('飞书 Codex 桥 · 配置向导', [
        ['下一步', '在终端按提示填入飞书应用凭证', 'info'],
        ['App ID', '形如 cli_xxxxxxxx（飞书开放平台 → 应用 → 凭证与基础信息）', 'info'],
        ['App Secret', '同一页的「App Secret」', 'info'],
      ], '按 Ctrl+C 可随时退出；配置成功后自动继续启动守护进程');
      const cfg = await configureFeishuBridge();
      if (!cfg.ok) {
        printCliRows('飞书 Codex 桥', [
          ['状态', '未配置', 'warn'],
          ['说明', cfg.message || '尚未完成飞书应用配置，启动已跳过', 'info'],
        ], '稍后再次开启飞书 Codex 桥即可重试配置向导');
        return;
      }
      // 配置写入了新的 bot；若守护进程已在跑，先停一次让它重新加载机器人，再启动。
      if (feishuBridgeState().running) {
        await stopFeishuBridge();
      }
    }

    const r = await startFeishuBridge();
    printCliRows('飞书 Codex 桥', [
      ['状态', r.ok ? (r.alreadyRunning ? '已在运行' : '已启动') : '启动未完成', r.ok ? 'ok' : 'error'],
      ['pid', r.pid ? String(r.pid) : '—', 'info'],
      ['说明', r.message, 'info'],
    ], r.ok
      ? '群消息 → 本地 Codex；交互入口在飞书（feishu-codex-bridge 的私聊控制台）'
      : '可运行 /hermit:doctor 或查看上报日志排查');
    return;
  }
  if (action.id === 'stop-feishu-bridge') {
    const r = await stopFeishuBridge();
    printCliRows('飞书 Codex 桥', [
      ['状态', r.ok ? '已停止' : '停止未完成', r.ok ? 'off' : 'warn'],
      ['说明', r.message, 'info'],
    ]);
    return;
  }
  if (action.id === 'workbench-status') {
    // 两个工作台并列展示：AgentCli 工作台（OpenHermit web daemon）+ 飞书 Codex 桥（连接器）。
    const ds = await collectDaemonStatus();
    printCliRows('AgentCli 工作台', [
      ['状态', ds.running ? `运行中（pid ${ds.pid || '?'})` : '未运行', ds.running ? 'ok' : 'warn'],
      ['地址', ds.running ? `${ds.url}（token 自动携带，仅本机）` : '未运行', ds.running ? 'info' : 'off'],
    ], '本机 AgentCli Web daemon + 可视化工作台：团队 / 看板 / 运行时 / 用量管理');
    const fb = await feishuBridgeStatus();
    const web = feishuBridgeWebUrl();
    printCliRows('飞书 Codex 桥', [
      ['已安装', fb.installed ? (fb.binPath || '是') : '否（可选依赖未就绪）', fb.installed ? 'ok' : 'off'],
      ['运行', fb.running ? `运行中（pid ${fb.pid || '?'}）` : '未运行', fb.running ? 'ok' : 'warn'],
      ['地址', fb.running && web ? `http://127.0.0.1:${web.port}/（token 自动携带，仅本机）` : '未运行', fb.running && web ? 'info' : 'off'],
      ['数据目录', fb.dataDir, 'info'],
    ]);
    return;
  }
  if (action.id === 'overview') {
    await printUsageStatus({ exitOnDone: false });
    return;
  }
  if (action.id === 'scan') {
    await printScanOnceResult({ exitOnDone: false, fullRescan: true });
    return;
  }
  if (action.id === 'start-background') {
    await printUsageStart({ exitOnDone: false });
    return;
  }
  if (action.id === 'stop-background') {
    await printUsageStop({ exitOnDone: false });
    return;
  }
  if (action.id === 'upload-logs') {
    printDeveloperUploadLogs();
    return;
  }
  if (action.id === 'login') {
    await runAuthLogin({ exitOnDone: false, interactiveMenu: true });
    return;
  }
  if (action.id === 'logout') {
    await runAuthLogout({ exitOnDone: false });
    return;
  }
  if (action.id === 'dev-login') {
    await runAuthDevLogin({ exitOnDone: false });
    return;
  }
  if (action.id === 'status') {
    await printAuthStatus({ exitOnDone: false });
    return;
  }
  if (action.id === 'aikey-claim') {
    await runAikey({ exitOnDone: false });
    return;
  }
  if (action.id === 'aikey-apply') {
    printCliRows('申请 aikey', [
      ['状态', '开发中（敬请期待）', 'warn'],
      ['说明', '在线申请流程未上线；暂时请用「认领」或联系管理员获取 key', 'info'],
    ], '服务端支持后会在此入口直接申请。');
    return;
  }
  if (action.id === 'aikey-status') {
    await runAikeyStatus({ exitOnDone: false });
    return;
  }
  if (action.id === 'local-use') {
    await runLocalUseAction();
    return;
  }
  if (action.id === 'data-sync') {
    await runLocalCollectionAction();
    return;
  }
  if (action.id === 'services') {
    await runServicesMenu();
    return;
  }
  if (action.id === 'team-collaboration') {
    await runTeamCollaborationAction();
    return;
  }
  if (action.id === 'local-collection') {
    await runLocalCollectionAction();
    return;
  }
  if (action.id === 'task-bus') {
    await runTaskBusAction();
    return;
  }
  if (action.id === 'account') {
    await runAccountAction();
    return;
  }
  if (action.id === 'employees') {
    await runEmployeeAction();
    return;
  }
  if (action.id === 'runtime') {
    await runRuntimeAction();
    return;
  }
  if (action.id === 'exit') cancelCli();
}

async function printNavigation() {
  if (!isInteractiveCli() || jsonRequested) printNavigationActions();
  await renderNavigationIntro();
  await refreshOpenHermitAuthStatus();
  await refreshWebRunningState();

  while (true) {
    const actionId = await askMenuAction({
      title: '',
      actions: NAV_ACTIONS,
      onAction: async (action) => {
        if (!['workbench-status', 'install-lark-cli', 'toggle-feishu-bridge', 'toggle-web', 'toggle-message-upload', 'overview', 'scan', 'upload-logs', 'login', 'logout', 'dev-login', 'status'].includes(action.id)) return false;
        await runNavigationAction(action);
        await waitForNavigationContinue('按 Enter 回到菜单 | Esc/Ctrl+C 退出', { keepMenuInput: true });
        return true;
      },
    });
    const action = findMenuAction(NAV_ACTIONS, actionId);
    if (!action) {
      console.error(`${brandLogPrefix()} 未知操作：${actionId}`);
      await waitForNavigationContinue();
      continue;
    }

    try {
      await runNavigationAction(action);
    } catch (err) {
      console.error(`${ui.danger('ERR')} ${err instanceof Error ? err.message : String(err)}`);
      await waitForNavigationContinue();
    }
  }
}


await requireOpenHermitAuthForEntry();

if (commandArgs[0] === 'status') {
  await printDaemonStatus();
}

if (commandArgs[0] === 'doctor') {
  await printDoctor();
}

if (commandArgs[0] === 'usage' && commandArgs[1] === 'status') {
  await printUsageStatus();
}

if (commandArgs[0] === 'usage' && commandArgs[1] === 'today') {
  await printUsageToday();
}

if (commandArgs[0] === 'usage' && commandArgs[1] === 'report') {
  await printUsageReport();
}

if (commandArgs[0] === 'usage' && commandArgs[1] === 'start') {
  await printUsageStart();
}

if (commandArgs[0] === 'usage' && commandArgs[1] === 'stop') {
  await printUsageStop();
}

if (commandArgs[0] === 'usage' && commandArgs[1] === 'autostart') {
  await printUsageAutostart();
}

if (commandArgs[0] === 'services') {
  await printServicesCommand();
}

if (commandArgs[0] === 'collaboration' && commandArgs[1] === 'start') {
  await printCollaborationStart();
}

if (commandArgs[0] === '__telemetry-worker') {
  // Single-instance guard: launchd RunAtLoad / Task Scheduler logon trigger call
  // this wrapper. If a worker is already running (e.g. `usage start` started one,
  // or the supervisor already fired), do NOT spawn a duplicate — the supervisor
  // (KeepAlive / RestartOnFailure) restarts on a real crash, but stacking
  // parallel workers causes the orphan/pid-mismatch problem. --scan-once is a
  // one-shot and bypasses the guard.
  const extraArgs = args.includes('--scan-once') ? ['--scan-once'] : [];
  const existingPid = readPidFile(telemetryWorkerPidPath);
  if (!extraArgs.includes('--scan-once') && existingPid && isPidRunning(existingPid)) {
    process.exit(0);
  }
  const child = spawn(process.execPath, telemetryWorkerChildArgs(extraArgs), {
    cwd: repoRoot,
    env: { ...process.env, HERMIT_HOME: hermitHome },
    stdio: 'inherit',
  });
  // Wait on 'close' (not 'exit') so stdio is fully drained + torn down before
  // proceeding — 'exit' raced the pipe close and tripped libuv's
  // UV_HANDLE_CLOSING assertion on Windows (win/async.c).
  const code = await new Promise((resolve) => child.on('close', resolve));
  process.exit(Number(code) || 0);
}

if (commandArgs[0] === 'auth' && commandArgs[1] === 'status') {
  await printAuthStatus();
}

if (commandArgs[0] === 'auth' && commandArgs[1] === 'login') {
  await runAuthLogin();
}

if (commandArgs[0] === 'auth' && commandArgs[1] === 'dev-login') {
  await runAuthDevLogin();
}

if (commandArgs[0] === 'auth' && commandArgs[1] === 'logout') {
  await runAuthLogout();
}

if (commandArgs.length === 0 && !daemonChild && !daemonRequested) {
  if (isInteractiveCli() && !jsonRequested) {
    const navigationKeepAlive = setInterval(() => undefined, 2_147_483_647);
    try {
      await printNavigation();
    } finally {
      clearInterval(navigationKeepAlive);
    }
  } else {
    await printNavigation();
  }
}

if (commandArgs[0] === 'teams' && commandArgs[1] === 'list') {
  printTeamsList();
}

if (commandArgs[0] === 'teams' && commandArgs[1] === 'create') {
  await printTeamsCreate();
}

if (commandArgs[0] === 'tasks' && commandArgs[1] === 'list') {
  printTasksList();
}

// `openhermit web` — start the local workbench (if not already running) and
// open it in the browser, bypassing the terminal nav menu. Thin orchestrator:
// heavy lifting (spawn/ready-wait) lives in daemon.mjs; browser open reuses the
// auth module's cross-platform opener.
async function runWebCommand() {
  const url = `http://127.0.0.1:${port}`;
  const server = await checkExistingOpenHermitServer();
  if (!server.running) {
    const daemon = startDaemon({ exitOnDone: false, quiet: true });
    const ready = await waitForOpenHermitServerReadyWithLogs(daemon.pid, 30_000);
    if (!ready.ready) {
      if (jsonRequested)
        printJson({ ok: false, command: 'web', url, reason: ready.reason, logPath: daemonLogPath }, 1);
      printCliRows(`${BRAND.stylizedName} 工作台`, [
        ['状态', '启动失败或仍在启动中', 'error'],
        ['地址', url],
        ['日志', daemonLogPath],
        ['原因', ready.reason || '请查看日志'],
      ], `排查后重试：${brandCommand('web')} 或 ${brandCommand('status')}`);
      process.exit(1);
    }
  }
  await openExternalUrl(url);
  if (jsonRequested) printJson({ ok: true, command: 'web', url });
  printCliRows(`${BRAND.stylizedName} 工作台`, [
    ['状态', '已就绪', 'ok'],
    ['地址', url],
  ], `已在浏览器打开；停止服务：${brandCommand('stop')}`);
  process.exit(0);
}

if (commandArgs[0] === 'stop') {
  await stopDaemon();
}

if (commandArgs[0] === 'web' && !daemonChild) {
  await runWebCommand();
}

if (commandArgs.length > 0 && !daemonRequested && !daemonChild) {
  const command = commandArgs.join(' ');
  const result = { ok: false, command, error: `Unknown command: ${command}` };
  if (jsonRequested) printJson(result, 1);
  console.error(`${brandLogPrefix()} 未知命令：${command}`);
  console.error(`${brandLogPrefix()} 可用命令：web | status | doctor | services | services start/stop | teams list/create | tasks list | usage status/today/report/start/stop/autostart | auth status/login/logout | stop`);
  process.exit(1);
}

if (daemonRequested && !daemonChild) {
  startDaemon();
}

// ---------------------------------------------------------------------------
// Check dependencies
// ---------------------------------------------------------------------------


let hermitBridgeProcess = null;
let bridgeTokens = {
  managementToken:
    process.env.HERMIT_BRIDGE_TOKEN ||
    process.env.HERMIT_BRIDGE_MANAGEMENT_TOKEN ||
    '',
  bridgeToken:
    process.env.HERMIT_BRIDGE_WS_TOKEN ||
    process.env.HERMIT_BRIDGE_TOKEN ||
    '',
};
let runtimeSetupMode = false;

await assertWebPortAvailable();

if (!skipHermitBridge) {
  let shouldStartRuntime = false;
  bridgeTokens = readHermitBridgeConfigState();
  const bridgeBaseUrl = process.env.HERMIT_BRIDGE_BASE_URL || 'http://127.0.0.1:9820';
  const alreadyRunning = await waitForHermitBridge(bridgeBaseUrl, bridgeTokens.managementToken, 1_000);
  if (alreadyRunning) {
    console.log(`${brandLogPrefix()} Runtime service already running: ${bridgeBaseUrl}`);
  } else if (bridgeTokens.hasProjects) {
    try {
      ensureClaudeCodeCliIfNeeded(bridgeTokens.raw);
      shouldStartRuntime = true;
    } catch {
      // Claude Code CLI missing / auto-install failed. Don't kill the daemon:
      // the web workbench (UI, teams, sessions, usage) doesn't need it — only
      // the bridge's agent spawning does. Degrade like the no-runner case
      // (runtimeSetupMode) so the web server still starts; install claude and
      // restart to get the runtime back.
      runtimeSetupMode = true;
      console.warn(`${brandLogPrefix()} Claude Code CLI 未就绪，跳过 runtime，工作台仍会启动。`);
      console.warn(`${brandLogPrefix()} 请手动安装：npm install -g @anthropic-ai/claude-code@latest`);
      printLogTail('Runtime', runtimeLogPath);
    }
  } else {
    console.error(`${brandLogPrefix()} Runtime config has no projects. Please edit the config and try again.`);
    console.error(`${brandLogPrefix()} Runtime config: ${hermitBridgeConfigPath}`);
    process.exit(1);
  }

  if (shouldStartRuntime) {
    const hermitBridgeRunner = resolveHermitBridgeRunner();
    if (!hermitBridgeRunner) {
      runtimeSetupMode = true;
      console.warn(`${brandLogPrefix()} Bundled ${BRAND.runtimeBridgeName} runtime is not installed for this platform.`);
      console.warn(`${brandLogPrefix()} Starting ${BRAND.stylizedName} without auto-starting the runtime service.`);
      console.warn(`${brandLogPrefix()} Configure an external ${BRAND.runtimeBridgeName} service or use --no-hermit-bridge to skip this check.`);
    } else {
      console.log(`${brandLogPrefix()} Starting bundled runtime service...`);
      console.log(`${brandLogPrefix()} Runtime config: ${hermitBridgeConfigPath}`);
      hermitBridgeProcess = spawn(process.execPath, [hermitBridgeRunner, '-config', hermitBridgeConfigPath], {
        cwd: repoRoot,
        detached: true,
        windowsHide: true,
        env: {
          ...process.env,
          HERMIT_BRIDGE_TOKEN: bridgeTokens.managementToken,
          HERMIT_BRIDGE_MANAGEMENT_TOKEN: bridgeTokens.managementToken,
          HERMIT_BRIDGE_WS_TOKEN: bridgeTokens.bridgeToken,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      hermitBridgeProcess.stdout?.on('data', (chunk) => {
        process.stdout.write(chunk);
        appendLog(runtimeLogPath, chunk);
      });
      hermitBridgeProcess.stderr?.on('data', (chunk) => {
        process.stderr.write(chunk);
        appendLog(runtimeLogPath, chunk);
      });

      try {
        await waitForRuntimeReady(bridgeBaseUrl, bridgeTokens.managementToken, hermitBridgeProcess, 180_000);
      } catch (err) {
        console.error(
          `${brandLogPrefix()} Runtime service failed to start: ${err instanceof Error ? err.message : String(err)}`
        );
        printLogTail('Runtime', runtimeLogPath);
        signalDaemon(hermitBridgeProcess.pid, 'SIGTERM');
        setTimeout(() => signalDaemon(hermitBridgeProcess?.pid, 'SIGKILL'), 2_000).unref();
        process.exit(1);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

console.log(`${brandLogPrefix()} Starting ${BRAND.stylizedName} server...`);
console.log(`${brandLogPrefix()} Version: ${currentVersion}`);
console.log(`${brandLogPrefix()} Port: ${port}`);
console.log(`${brandLogPrefix()} Root: ${repoRoot}`);
console.log('');

// Build dist-renderer in development checkouts only. Published installs ship the
// prebuilt renderer and usually do not include frontend build dependencies.
const distRenderererDir = path.resolve(repoRoot, 'dist-renderer');
const distRendererEntry = path.join(distRenderererDir, 'index.html');
const canBuildRendererFromSource =
  existsSync(path.join(repoRoot, 'vite.web.config.ts')) &&
  existsSync(path.join(repoRoot, 'pnpm-lock.yaml')) &&
  existsSync(path.join(repoRoot, 'node_modules'));

if (!existsSync(distRendererEntry)) {
  if (!canBuildRendererFromSource) {
    console.error(`${brandLogPrefix()} Missing prebuilt frontend: dist-renderer/index.html`);
    console.error(`${brandLogPrefix()} This install appears incomplete. Please reinstall ${BRAND.npmPackage} or report a packaging issue.`);
    process.exit(1);
  }

  console.log(`${brandLogPrefix()} Building frontend...`);
  const buildProcess = spawn('pnpm', ['build:web'], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true,
  });

  await new Promise((resolve, reject) => {
    buildProcess.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Frontend build failed with exit code ${code}`));
      }
    });
    buildProcess.on('error', reject);
  });
  console.log(`${brandLogPrefix()} Frontend built successfully\n`);
}

// Start the server
console.log(`${brandLogPrefix()} Launching server...\n`);

function printServerLogTail() {
  printLogTail('Server', serverLogPath);
}

// Reap detached server.ts / hermit-bridge ORPHANS (PPID=1) left by a prior
// daemon that died before shutdown() could — before we spawn the fresh server.
// PPID=1-only guarantees we never touch a live daemon's own children.
const orphanedDaemonChildPids = collectOrphanedDaemonChildPids();
if (orphanedDaemonChildPids.length) {
  console.log(`${brandLogPrefix()} 清理 ${orphanedDaemonChildPids.length} 个遗留 daemon 子进程...`);
  await stopFallbackProcesses(orphanedDaemonChildPids);
}

const serverProcess = spawn(process.execPath, ['--import', resolveAliasLoaderRegister(), '--import', resolveTsxLoader(), 'src/main/server.ts'], {
  cwd: repoRoot,
  detached: true,
  windowsHide: true,
  env: {
    ...process.env,
    PORT: port,
    HOST: process.env.HOST || '127.0.0.1',
    NODE_ENV: 'production',
    HERMIT_HOME: hermitHome,
    HERMIT_RUNTIME_SETUP_MODE: runtimeSetupMode ? '1' : '0',
    HERMIT_BRIDGE_TOKEN: bridgeTokens.managementToken,
    HERMIT_BRIDGE_MANAGEMENT_TOKEN: bridgeTokens.managementToken,
    HERMIT_BRIDGE_WS_TOKEN: bridgeTokens.bridgeToken,
    HERMIT_BRIDGE_CONFIG: hermitBridgeConfigPath,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

serverProcess.stdout?.on('data', (chunk) => {
  process.stdout.write(chunk);
  appendLog(serverLogPath, chunk);
});

serverProcess.stderr?.on('data', (chunk) => {
  process.stderr.write(chunk);
  appendLog(serverLogPath, chunk);
});

serverProcess.on('exit', (code) => {
  if (shuttingDown) return;
  signalDaemon(hermitBridgeProcess?.pid, 'SIGTERM');
  if (code !== 0) {
    console.error(`${brandLogPrefix()} Server exited with code ${code}`);
    printServerLogTail();
    process.exit(code ?? 1);
  }
});

let shuttingDown = false;
function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${brandLogPrefix()} Shutting down...`);
  signalDaemon(serverProcess?.pid, 'SIGTERM');
  signalDaemon(hermitBridgeProcess?.pid, 'SIGTERM');
  setTimeout(() => {
    signalDaemon(serverProcess?.pid, 'SIGKILL');
    signalDaemon(hermitBridgeProcess?.pid, 'SIGKILL');
    process.exit(exitCode);
  }, 2_000).unref();
}

process.on('SIGINT', () => {
  shutdown(0);
});

process.on('SIGTERM', () => {
  shutdown(0);
});

console.log(`${brandLogPrefix()} Server starting on http://${process.env.HOST || '127.0.0.1'}:${port}`);
console.log(`${brandLogPrefix()} Press Ctrl+C to stop\n`);
