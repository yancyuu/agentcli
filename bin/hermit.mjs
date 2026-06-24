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
  CLI_MENU_WIDTH,
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
  formatStatusPill,
  colorByState,
  rowStateFromValue,
  printStatusBar,
  boxLine,
  boxContentLine,
  boxColumnsLine,
  menuColumnsLine,
  printCliRows,
  menuBrandTitle,
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
import {
  readDaemonPid,
  refreshDaemonPidFromReadyServer,
  isPidRunning,
  removeDaemonPidFile,
  signalDaemon,
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
  ${BRAND.cliCommand}         打开终端导航，选择本地使用、团队协作或账号授权
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
  usage report [--json]
                     触发/准备本地 usage 报告，不上传
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

if (commandArgs[0] === 'update') {
  runUpdate();
  process.exit(0);
}

if (commandArgs[0] === 'add') {
  await runAddPlugin(commandArgs[1], port);
  process.exit(0);
}



const NAV_ACTIONS = [
  {
    id: 'web',
    label: '本地数字员工工作台',
    description: '回车展开；在二级项里用 ✓ 表示已开启，回车可开启或关闭',
    recommended: true,
    children: [
      { id: 'toggle-web', label: '本地数字员工工作台', toggle: 'web' },
    ],
  },
  {
    id: 'data-sync',
    label: '用量上报',
    description: '回车展开；消息上报会启动后台增量扫描，首次补齐历史，后续只上传新增消息',
    children: [
      { id: 'toggle-message-upload', label: '消息上报', toggle: 'conversation-upload' },
      { id: 'overview', label: '查看同步状态' },
      { id: 'scan', label: '立即扫描并上报一次' },
      { id: 'upload-logs', label: '查看上报日志', developerOnly: true },
    ],
  },
  {
    id: 'account',
    label: '账号与云端',
    description: '回车展开；登录后可启用云端授权和托管能力',
    children: [
      { id: 'login', label: '登录 / OAuth 授权' },
      { id: 'status', label: '查看登录状态' },
      { id: 'logout', label: '退出登录' },
    ],
  },
  {
    id: 'exit',
    label: '退出',
    description: `离开 ${BRAND.stylizedName} 终端入口`,
  },
];

const WEB_ENTRY_ACTIONS = [
  {
    id: 'start-web',
    label: '开启本地数字员工工作台',
    description: '启动本机工作台；不影响用量上报后台进程',
    recommended: true,
  },
  {
    id: 'stop-web',
    label: '关闭本地数字员工工作台',
    description: '停止本机工作台；不影响用量上报后台进程',
  },
  {
    id: 'back',
    label: '取消 / 返回首页',
    description: `不修改工作台状态，回到 ${BRAND.stylizedName} 入口`,
  },
];

const SERVICE_ACTIONS = [
  {
    id: 'start-local',
    label: '启动本地基础服务',
    description: '启动 Web + Usage 后台采集 + 本地/自托管团队协作；无需登录，不上传',
    recommended: true,
  },
  {
    id: 'start-web',
    label: '只启动 Web 控制台',
    description: '启动本机 Web UI，不启动 usage worker',
  },
  {
    id: 'start-usage',
    label: '启动 Usage 后台采集',
    description: '轻量后台进程 + 默认开机自启；不上传',
  },
  {
    id: 'start-collaboration',
    label: '启用本地团队协作',
    description: '写入本地/自托管团队总线配置；不要求登录',
  },
  {
    id: 'status',
    label: '查看服务状态',
    description: '查看 Web daemon、usage worker 和本地协作状态',
  },
  {
    id: 'stop-usage',
    label: '停止 Usage 采集',
    description: '停止 usage worker 并关闭开机自启',
  },
  {
    id: 'stop-web',
    label: '停止 Web 控制台',
    description: '停止后台 daemon/runtime',
  },
  {
    id: 'back',
    label: '返回首页',
    description: `回到 ${BRAND.stylizedName} 导航`,
  },
];

const LOCAL_USE_ACTIONS = [
  {
    id: 'web',
    label: '打开本机 Web 控制台',
    description: `进入本机 ${BRAND.stylizedName} Web，适合本地设置和可视化管理`,
  },
  {
    id: 'employees',
    label: '数字员工',
    description: '本机团队创建、列表和管理',
  },
  {
    id: 'local-collection',
    label: '本地数据采集',
    description: '查看本机 Loop 使用概览；无需登录，不依赖 Redis',
  },
  {
    id: 'runtime',
    label: '本地运行时',
    description: '后台服务状态、诊断和生命周期管理',
  },
  {
    id: 'back',
    label: '返回首页',
    description: `回到 ${BRAND.stylizedName} 导航`,
  },
];

const TEAM_COLLAB_ACTIONS = [
  {
    id: 'open-web-settings',
    label: '打开协作设置',
    description: '进入 Web 设置 > 团队总线，管理 Redis 和协作配置',
  },
  {
    id: 'task-bus',
    label: '团队总线状态',
    description: '查看本地/自托管 Redis 和分布式协作状态',
  },
  {
    id: 'account',
    label: '账号状态',
    description: `查看或退出当前 ${BRAND.authAccountLabel}`,
  },
  {
    id: 'back',
    label: '返回首页',
    description: `回到 ${BRAND.stylizedName} 导航`,
  },
];

const EMPLOYEE_ACTIONS = [
  {
    id: 'create-team',
    label: '创建数字员工团队',
    description: '写入本地团队元数据',
  },
  {
    id: 'list-teams',
    label: '查看数字员工列表',
    description: '列出可见团队，隐藏已删除项',
  },
  {
    id: 'back',
    label: '返回首页',
    description: `回到 ${BRAND.stylizedName} 导航`,
  },
];

const RUNTIME_ACTIONS = [
  {
    id: 'status',
    label: '服务状态',
    description: '查看 daemon / Web URL',
  },
  {
    id: 'doctor',
    label: '本地诊断',
    description: '只读检查配置与服务',
  },
  {
    id: 'stop',
    label: '停止后台服务',
    description: '结束后台 daemon/runtime',
  },
  {
    id: 'back',
    label: '返回首页',
    description: `回到 ${BRAND.stylizedName} 导航`,
  },
];

const USAGE_UPLOAD_PROVIDER_OPTIONS = [
  { id: 'claudecode', label: 'Claude Code', description: '扫描本机 Claude Code 会话 usage，并按 ${BRAND.authProviderName} 消息上报协议分批增量上传' },
  { id: 'codex', label: 'Codex', description: '扫描本机 Codex 会话 usage，并按 ${BRAND.authProviderName} 消息上报协议分批增量上传' },
];

function normalizeUploadProviders(value) {
  const rawItems = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const items = rawItems.flatMap((item) => String(item).split(/[,+，、\s]+/u));
  const normalized = items
    .map((item) => String(item).trim())
    .filter((item) => USAGE_UPLOAD_PROVIDER_OPTIONS.some((option) => option.id === item));
  return Array.from(new Set(normalized));
}

function uploadProviderLabel(provider) {
  return USAGE_UPLOAD_PROVIDER_OPTIONS.find((option) => option.id === provider)?.label || provider;
}

function formatUploadProviders(providers) {
  const normalized = normalizeUploadProviders(providers);
  return normalized.length ? normalized.map(uploadProviderLabel).join(' + ') : '未选择';
}

const LOCAL_COLLECTION_ACTIONS = [
  {
    id: 'overview',
    label: '查看同步状态',
    description: '显示消息上报后台和本机扫描状态',
  },
  {
    id: 'scan',
    label: '立即扫描并上报一次',
    description: '立刻执行一次增量扫描；消息上报开启时会按游标只上传新增消息',
  },
  {
    id: 'choose-upload-provider',
    label: '开启消息上报',
    description: '默认同时扫描 Claude Code + Codex；按批次增量上传',
  },
  {
    id: 'stop-background',
    label: '停止消息上报',
    description: '停止消息上报 worker，并关闭开机自启',
  },
  {
    id: 'back',
    label: '返回首页',
    description: `回到 ${BRAND.stylizedName} 导航`,
  },
];

const TASK_BUS_ACTIONS = [
  {
    id: 'status',
    label: '查看团队总线状态',
    description: '显示本地/自托管 Redis 和分布式协作状态',
  },
  {
    id: 'open-web-settings',
    label: '打开 Web 设置',
    description: '配置入口：设置 > 团队总线',
  },
  {
    id: 'doctor',
    label: '本地诊断',
    description: '只读检查服务和本地路径',
  },
  {
    id: 'back',
    label: '返回首页',
    description: `回到 ${BRAND.stylizedName} 导航`,
  },
];

const ACCOUNT_ACTIONS = [
  {
    id: 'login',
    label: '登录 / OAuth 授权',
    description: '用于云端授权和托管服务；本地使用无需登录',
  },
  {
    id: 'status',
    label: '查看登录状态',
    description: `查看 ${BRAND.authAccountLabel} 授权状态`,
  },
  {
    id: 'logout',
    label: '退出登录',
    description: `退出 ${BRAND.authAccountLabel}，不影响本地 runtime 登录`,
  },
  {
    id: 'back',
    label: '返回首页',
    description: `回到 ${BRAND.stylizedName} 导航`,
  },
];

function findMenuAction(actions, actionId) {
  for (const action of actions) {
    if (action.id === actionId) return action;
    const child = action.children?.find((item) => item.id === actionId);
    if (child) return child;
  }
  return null;
}

function menuFooterForEscape() {
  return '[↑↓ move • Enter expand/confirm • ← back • Esc cancel]';
}

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
  const uploadProviders = normalizeUploadProviders(telemetry.uploadProviders || telemetry.platform || 'claudecode');
  return {
    auth,
    webPid,
    usagePid,
    webRunning: Boolean((webPid && isPidRunning(webPid)) || Date.now() < optimisticWebRunningUntil),
    usageRunning: Boolean(usagePid && isPidRunning(usagePid)),
    remoteUploadEnabled: Boolean(telemetry.uploadEnabled || telemetry.conversationUploadEnabled),
    conversationUploadEnabled: Boolean(telemetry.conversationUploadEnabled),
    uploadProviders,
  };
}

async function refreshWebRunningState(expectedPid = null) {
  const pid = expectedPid || readDaemonPid();
  const server = await checkExistingOpenHermitServer();
  if (server.running) {
    refreshDaemonPidFromReadyServer(pid || expectedPid);
    markWebRunningOptimistic();
    return true;
  }
  if (pid && isPidRunning(pid)) {
    markWebRunningOptimistic();
    return true;
  }
  clearWebRunningOptimistic();
  return false;
}

function currentMenuStatusItems(states = currentFeatureStates()) {
  return [
    { label: states.auth.authorized ? `登录 ${states.auth.account?.name || BRAND.authProviderName}` : '未登录', state: states.auth.authorized ? 'ok' : 'off' },
    { label: states.webRunning ? `Web ${port}` : 'Web 关闭', state: states.webRunning ? 'ok' : 'off' },
    { label: states.conversationUploadEnabled ? '消息上报' : '消息上报关闭', state: states.conversationUploadEnabled ? states.usageRunning ? 'ok' : 'warn' : 'off' },
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
  if (['web', 'toggle-web', 'start-web'].includes(action.id)) return { text: states.webRunning ? 'running' : 'stopped', state: states.webRunning ? 'ok' : 'error' };
  if (action.toggle === 'conversation-upload' || action.id === 'toggle-message-upload') return { text: states.conversationUploadEnabled ? states.usageRunning ? formatUploadProviders(states.uploadProviders) : 'enabled' : 'stopped', state: states.conversationUploadEnabled ? states.usageRunning ? 'ok' : 'warn' : 'error' };
  if (action.id === 'choose-upload-provider') return { text: formatUploadProviders(states.uploadProviders), state: states.uploadProviders.length ? 'info' : 'warn' };
  if (['toggle-background', 'start-usage', 'start-background'].includes(action.id)) return { text: states.usageRunning ? 'running' : 'stopped', state: states.usageRunning ? 'ok' : 'error' };
  if (['data-sync', 'local-collection'].includes(action.id)) return { text: states.conversationUploadEnabled ? states.usageRunning ? 'running' : 'enabled' : 'stopped', state: states.conversationUploadEnabled ? states.usageRunning ? 'ok' : 'warn' : 'error' };
  if (action.id === 'stop-web' || action.id === 'stop-usage' || action.id === 'stop-background') return { text: 'stop', state: 'warn' };
  if (['account', 'login', 'status'].includes(action.id)) return { text: states.auth.authorized ? 'signed in' : 'signed out', state: states.auth.authorized ? 'ok' : 'off' };
  if (action.id === 'back') return { text: 'back', state: 'off' };
  if (action.id === 'exit') return { text: 'exit', state: 'off' };
  if (action.recommended) return { text: 'recommended', state: 'ok' };
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
  if (action.id === 'toggle-web') {
    return currentFeatureStates().webRunning
      ? '本地数字员工工作台已运行，正在打开/确认状态...'
      : '正在启动本地数字员工工作台...';
  }
  if (action.id === 'toggle-message-upload') {
    return currentFeatureStates().conversationUploadEnabled
      ? '正在关闭消息上报...'
      : '正在开启消息上报...';
  }
  if (action.id === 'login') return `正在连接 ${BRAND.authProviderName} 授权服务...`;
  if (action.id === 'dev-login') return '请输入开发口令以开启开发者模式...';
  if (action.id === 'upload-logs') return '正在读取消息上报调试日志...';
  return `正在处理：${action.label}，请稍候...`;
}

function renderBusyScreen(title, message) {
  clearTerminal();
  console.log(menuBrandTitle());
  console.log(ui.bold(title));
  console.log(colorByState(message, 'warn'));
}

function renderNavMenu(title, subtitle, actions, selectedIndex, escapeAction = 'exit', expandedActionIds = new Set(), notice = '') {
  clearTerminal();
  printWelcomeLogo();
  const states = currentFeatureStates();
  console.log(menuBrandTitle());
  printStatusBar(currentMenuStatusItems(states));
  console.log(ui.bold(title));
  if (subtitle) console.log(ui.dim(subtitle));
  if (notice) console.log(colorByState(notice, 'warn'));

  const rows = visibleMenuRows(actions, expandedActionIds);
  for (const [index, row] of rows.entries()) {
    const { action, depth } = row;
    const focused = index === selectedIndex;
    const expanded = expandedActionIds.has(action.id);
    const pointer = focused ? ui.accent(glyphs.pointer) : ' ';
    const hasChildren = Boolean(action.children?.length);
    const caret = hasChildren ? (expanded ? glyphs.caretOpen : glyphs.caretClosed) : ' ';
    const state = actionStateLabel(action, states);
    const selected = action.toggle && state.state === 'ok';
    const marker = selected ? ui.success(glyphs.checked) : ' ';
    const label = selected ? ui.success(action.label) : focused ? ui.accent(action.label) : action.label;
    const right = depth === 0 && state.text ? colorByState(state.text, state.state) : '';
    const left = depth === 0
      ? `${pointer} ${caret} ${label}`
      : `${pointer}   ${marker} ${label}`;
    console.log(menuColumnsLine(left, right));
    if (focused && action.description) console.log(`    ${ui.dim(action.description)}`);
  }

  console.log(ui.dim(`${menuFooterForEscape(escapeAction)}  [1-${rows.length} quick]`));
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

function formatNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
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

async function readUsageStatus({ scan = false, localOnly = false } = {}) {
  if (scan) return scanUsageTelemetryOnce({ localOnly });
  const backend = await fetchBackendUsageStatus();
  if (backend) return backend;
  const { status, error } = readTelemetryWorkerStatusFile();
  const autostart = await getUsageAutostartStatus();
  return {
    daemon: usageDaemonPayload({ running: false, url: `http://127.0.0.1:${port}`, version: '' }),
    worker: telemetryWorkerPayload({ status, statusError: error, autostart }),
    telemetry: telemetryFromWorkerStatus(status),
    source: 'claude-jsonl',
  };
}

function conversationUploadRows(upload = {}, auth = readOpenHermitAuthStatus()) {
  const waitingLogin = upload.lastError === '等待登录';
  const statusText = waitingLogin && auth.authorized ? '已登录，等待下一次增量扫描上报' : upload.lastError;
  const failed = Boolean(statusText) && !waitingLogin;
  const confirmed = Number(upload.accepted || 0) + Number(upload.duplicated || 0);
  const failedCount = Number(upload.failed || 0);
  const queued = Number(upload.queued || 0);
  const statusState = waitingLogin ? 'warn' : failed ? 'error' : 'info';
  return [
    ['历史消息', upload.totalDiscovered === undefined ? '等待扫描' : `${formatNumber(upload.totalDiscovered)} 条已发现`, 'info'],
    ['本次增量', upload.pending === undefined ? '等待扫描' : `${formatNumber(upload.pending)} 条待上报`, upload.pending ? 'warn' : 'ok'],
    ['已跳过', upload.skippedAlreadyUploaded === undefined ? '等待扫描' : `${formatNumber(upload.skippedAlreadyUploaded)} 条已上报`, 'info'],
    ['已尝试发送', `${formatNumber(upload.attempted || 0)} 条`, upload.attempted ? failed ? 'warn' : 'ok' : 'info'],
    ['服务端确认', `${formatNumber(confirmed)} 条（${formatNumber(upload.accepted || 0)} 接收 / ${formatNumber(upload.duplicated || 0)} 重复 / ${formatNumber(upload.rejected || 0)} 拒绝${failedCount ? ` / ${formatNumber(failedCount)} 失败` : ''}${queued ? ` / ${formatNumber(queued)} 排队` : ''}）`, upload.rejected || failedCount || failed ? 'warn' : 'info'],
    ...(upload.lastUploadStatus ? [['批次状态', upload.lastUploadStatus, failed ? 'error' : 'info']] : []),
    ...(statusText ? [['错误日志', statusText, statusState], ['本地游标', '未推进，后续会按 eventId 幂等重试', failed ? 'warn' : 'info']] : []),
  ];
}

function printUsageRows(title, data, hint) {
  const states = currentFeatureStates();
  const auth = readOpenHermitAuthStatus();
  const upload = data.telemetry.conversationUpload;
  const uploadEnabled = Boolean(states.conversationUploadEnabled || upload?.enabled);
  const workerText = states.usageRunning ? `后台运行中 (pid ${states.usagePid})，每 5 分钟增量扫描` : '后台未运行';
  const uploadText = uploadEnabled
    ? auth.authorized ? workerText : `${workerText}，等待登录授权`
    : '关闭';
  printCliRows(title, [
    ['消息上报', uploadText, uploadEnabled ? auth.authorized ? states.usageRunning ? 'ok' : 'warn' : 'warn' : 'off'],
    ['最近扫描', data.telemetry.lastScan ? new Date(data.telemetry.lastScan).toLocaleString('zh-CN') : '等待首次扫描', data.telemetry.lastScan ? 'ok' : 'warn'],
    ['会话数', formatNumber(data.telemetry.sessions), 'info'],
    ['消息数', formatNumber(data.telemetry.messages), 'info'],
    ['Token 总量', formatNumber(data.telemetry.totalTokens), 'info'],
    ['来源', `${formatUploadProviders(states.uploadProviders)} 本地消息记录`, 'info'],
    ...(uploadEnabled && upload ? conversationUploadRows(upload, auth) : []),
  ], hint || '消息上报会后台增量扫描：首次补齐历史消息，后续只上报新增消息。');
}

async function printUsageStatus({ exitOnDone = true } = {}) {
  try {
    const data = await readUsageStatus({ scan: false });
    const result = { ok: true, command: 'usage status', hermitHome, ...data };
    if (jsonRequested) printJson(result);
    printUsageRows('用量上报状态', data, data.daemon.running ? '触发扫描：openhermit usage report' : '启动本地采集：openhermit usage start');
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
  const uploadProviders = selectedProviders ?? normalizeUploadProviders(telemetry.uploadProviders || ['claudecode']);
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
  const uploadProviders = normalizeUploadProviders(existingTelemetry.uploadProviders || ['claudecode']);
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
      ...existingTelemetry,
      enabled: true,
      uploadEnabled: Boolean(existingTelemetry.uploadEnabled),
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

function startTelemetryWorker({ quiet = false } = {}) {
  const existingPid = readPidFile(telemetryWorkerPidPath);
  if (existingPid && isPidRunning(existingPid)) {
    return { started: false, running: true, pid: existingPid, pidPath: telemetryWorkerPidPath, statusPath: telemetryWorkerStatusPath, logPath: telemetryWorkerLogPath };
  }

  if (process.env.OPENHERMIT_USAGE_WORKER_MODE === 'test') {
    mkdirSync(telemetryDir, { recursive: true, mode: 0o700 });
    writeFileSync(telemetryWorkerPidPath, String(process.pid), { encoding: 'utf-8', mode: 0o600 });
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
    env: { ...process.env, HERMIT_HOME: hermitHome },
    stdio: ['ignore', out, err],
  });
  child.unref();
  closeSync(out);
  closeSync(err);
  writeFileSync(telemetryWorkerPidPath, String(child.pid), { encoding: 'utf-8', mode: 0o600 });
  if (!quiet) console.error(`${brandLogPrefix()} usage telemetry worker started: pid ${child.pid}`);
  return { started: true, running: true, pid: child.pid, pidPath: telemetryWorkerPidPath, statusPath: telemetryWorkerStatusPath, logPath: telemetryWorkerLogPath };
}

async function stopTelemetryWorker() {
  const pid = readPidFile(telemetryWorkerPidPath);
  if (!pid) return { stopped: false, pid: null, running: false };
  if (pid === process.pid && process.env.OPENHERMIT_USAGE_WORKER_MODE === 'test') {
    removeTelemetryWorkerPidFile();
    return { stopped: true, pid, running: false, mode: 'test' };
  }
  if (isPidRunning(pid)) {
    signalDaemon(pid, 'SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    if (isPidRunning(pid)) signalDaemon(pid, 'SIGKILL');
  }
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
      ...(localOnly ? { HERMIT_USAGE_FORCE_LOCAL_ONLY: '1' } : {}),
      ...(scanDisabled ? { HERMIT_USAGE_SCAN_DISABLED: '1' } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
  const code = await new Promise((resolve) => child.on('exit', resolve));
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

async function getUsageAutostartStatus() {
  const plistPath = usageLaunchdPlistPath();
  if (process.platform !== 'darwin') return { supported: false, enabled: false, loaded: false, label: usageLaunchdLabel(), plistPath };
  const print = launchctlBestEffort(['print', `gui/${process.getuid?.() ?? ''}/${usageLaunchdLabel()}`]);
  return { supported: true, enabled: existsSync(plistPath), loaded: print.ok, label: usageLaunchdLabel(), plistPath };
}

async function enableUsageAutostart() {
  const plistPath = usageLaunchdPlistPath();
  if (process.platform !== 'darwin') return getUsageAutostartStatus();
  mkdirSync(path.dirname(plistPath), { recursive: true });
  mkdirSync(path.dirname(telemetryWorkerLogPath), { recursive: true, mode: 0o700 });
  writeFileSync(plistPath, buildUsageLaunchdPlist(), 'utf-8');
  const uid = process.getuid?.();
  if (uid !== undefined) {
    launchctlBestEffort(['bootout', `gui/${uid}`, plistPath]);
    launchctlBestEffort(['bootstrap', `gui/${uid}`, plistPath]);
    launchctlBestEffort(['enable', `gui/${uid}/${usageLaunchdLabel()}`]);
    launchctlBestEffort(['kickstart', '-k', `gui/${uid}/${usageLaunchdLabel()}`]);
  }
  return getUsageAutostartStatus();
}

async function disableUsageAutostart() {
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

function latestConversationUploadProgress() {
  const events = readConversationUploadLogEvents();
  let latestScan = null;
  let latestBatch = null;
  let latestFailure = null;
  for (const event of events) {
    if (event.message === 'scan-collected') latestScan = event;
    if (event.message === 'upload-batch-start' || event.message === 'upload-batch-finished') latestBatch = event;
    if (event.message === 'upload-batch-failed' || event.message === 'upload-failed') latestFailure = event;
  }
  return { latestScan, latestBatch, latestFailure };
}

function uploadProgressLabel() {
  const { latestScan, latestBatch, latestFailure } = latestConversationUploadProgress();
  if (!latestScan) return '扫描本地消息中';
  const total = Number(latestBatch?.totalMessages ?? latestScan.pendingPlain ?? latestScan.pending ?? 0);
  if (!latestBatch) return `发现 ${formatNumber(Number(latestScan.totalDiscovered || 0))} 条，准备上报`;
  const done = Number(
    latestBatch.attemptedAfterFailure
      ?? latestBatch.attemptedAfterBatch
      ?? latestBatch.uploadedAfterBatch
      ?? latestBatch.uploadedBeforeBatch
      ?? latestBatch.uploadedBeforeFailure
      ?? 0
  );
  const batchIndex = Number(latestBatch.batchIndex || 0);
  const totalBatches = Number(latestBatch.totalBatches || 0);
  const percent = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const failed = latestFailure && latestFailure.timestamp >= latestBatch.timestamp;
  const state = failed ? '失败' : percent >= 100 ? '完成' : '上报中';
  return `${percent}% 批次 ${batchIndex}/${totalBatches} 消息 ${formatNumber(done)}/${formatNumber(total)} ${state}`;
}

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

async function withUploadProgress(label, task) {
  if (jsonRequested || !process.stdout.isTTY) return task();
  let lastWidth = 0;
  const render = () => {
    const text = fitProgressLine(`${label} ${uploadProgressLabel()}`);
    process.stdout.write(`\r\x1b[2K${ui.dim(text)}`);
    lastWidth = displayWidth(text);
  };
  render();
  const timer = setInterval(render, 500);
  try {
    return await task();
  } finally {
    clearInterval(timer);
    process.stdout.write(`\r\x1b[2K${' '.repeat(Math.max(0, lastWidth))}\r\x1b[2K`);
  }
}

async function printUsageReport({ exitOnDone = true } = {}) {
  try {
    const auth = readOpenHermitAuthStatus();
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
        ['下一步', '先执行 openhermit auth login', 'info'],
      ], '立即扫描并上报需要 Bearer 登录授权；登录后再执行会按本地游标只上传新增消息。');
      if (exitOnDone) process.exit(1);
      return result;
    }

    const data = await withUploadProgress('正在执行一次增量扫描并按需上报...', () => readUsageStatus({ scan: true, localOnly: false }));
    const upload = data.telemetry.conversationUpload;
    const result = {
      ok: true,
      command: 'usage report',
      hermitHome,
      localOnly: false,
      upload: {
        enabled: Boolean(upload?.enabled),
        authorized: readOpenHermitAuthStatus().authorized,
        attempted: upload?.attempted || 0,
        accepted: upload?.accepted || 0,
        duplicated: upload?.duplicated || 0,
        rejected: upload?.rejected || 0,
      },
      ...data,
    };
    if (jsonRequested) printJson(result);
    printUsageRows('用量上报报告', data, '已执行一次增量扫描；消息上报开启时会按本地游标只上传新增消息。');
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

function getUploadProvidersFromFlags() {
  const values = findAnyOptionValues(['--upload-provider', '--provider', '--providers']);
  return normalizeUploadProviders(values).length ? normalizeUploadProviders(values) : ['claudecode'];
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
  printCliRows('消息上报后台已启动', [
    ['消息上报', conversationUploadEnabled ? auth.authorized ? `开启（pid ${worker.pid}）` : `等待登录（pid ${worker.pid}）` : '关闭', conversationUploadEnabled ? auth.authorized ? 'ok' : 'warn' : 'off'],
    ['日志', worker.logPath, 'info'],
    ['开机自启', autostart.enabled ? '开启' : '关闭', autostart.enabled ? 'ok' : 'off'],
    ['模式', '首次补齐全部历史，后续只上报增量', 'info'],
    ['归因', 'Claude Code + IM 会话归因', 'info'],
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
  const autostart = disableAutostart ? await disableUsageAutostart() : await getUsageAutostartStatus();
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
    ['账号', status.auth.authorized ? '已登录' : '未登录'],
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
      printCliRows('服务操作失败', [['原因', err instanceof Error ? err.message : String(err)]], '上传/托管能力需要先运行 openhermit auth login。');
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

  if (!process.stdin.isTTY) return defaults.length ? defaults : ['claudecode'];
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
    if (actionId === 'scan') await printUsageReport({ exitOnDone: false });
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
    ['账号', auth.authorized ? `已登录 ${BRAND.authProviderName}` : '未登录（本地/自托管协作可用）'],
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
    const updatedStates = currentFeatureStates();
    printCliRows('消息上报', [
      ['状态', '已关闭', 'off'],
      ['菜单显示', updatedStates.conversationUploadEnabled ? '仍显示开启，请刷新状态' : '已更新为关闭', updatedStates.conversationUploadEnabled ? 'warn' : 'ok'],
      ['来源', formatUploadProviders(states.uploadProviders), 'info'],
      ['说明', '后台扫描仍可保留；消息正文不会继续上报', 'info'],
    ], '再次开启后会读取本地游标，只上传未上报过的新增消息。');
    return;
  }
  if (action.id === 'start-web') {
    const daemon = startDaemon({ exitOnDone: false, quiet: true });
    const ready = await waitForOpenHermitServerReady(daemon.pid);
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
    printCliRows('本地数字员工工作台', [
      ['状态', '已关闭', 'off'],
      ['用量上报', '不受影响', 'info'],
    ]);
    return;
  }
  if (action.id === 'overview') {
    await printUsageStatus({ exitOnDone: false });
    return;
  }
  if (action.id === 'scan') {
    await printUsageReport({ exitOnDone: false });
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
      title: '选择入口',
      subtitle: '↑/↓ 或 Ctrl-N/Ctrl-P 移动，Enter 执行；✓ 表示已开启，执行后停留在当前页面',
      actions: NAV_ACTIONS,
      onAction: async (action) => {
        if (!['toggle-web', 'toggle-message-upload', 'overview', 'scan', 'upload-logs', 'login', 'logout', 'dev-login', 'status'].includes(action.id)) return false;
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
  const extraArgs = args.includes('--scan-once') ? ['--scan-once'] : [];
  const child = spawn(process.execPath, telemetryWorkerChildArgs(extraArgs), {
    cwd: repoRoot,
    env: { ...process.env, HERMIT_HOME: hermitHome },
    stdio: 'inherit',
  });
  const code = await new Promise((resolve) => child.on('exit', resolve));
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

if (commandArgs[0] === 'stop') {
  await stopDaemon();
}

if (commandArgs.length > 0 && !daemonRequested && !daemonChild) {
  const command = commandArgs.join(' ');
  const result = { ok: false, command, error: `Unknown command: ${command}` };
  if (jsonRequested) printJson(result, 1);
  console.error(`${brandLogPrefix()} 未知命令：${command}`);
  console.error(`${brandLogPrefix()} 可用命令：status | doctor | services | services start/stop | teams list/create | tasks list | usage status/today/report/start/stop/autostart | auth status/login/logout | stop`);
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
    } catch {
      printLogTail('Runtime', runtimeLogPath);
      process.exit(1);
    }
    shouldStartRuntime = true;
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

const serverProcess = spawn(process.execPath, ['--import', resolveAliasLoaderRegister(), '--import', resolveTsxLoader(), 'src/main/server.ts'], {
  cwd: repoRoot,
  detached: true,
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
