// navigationCommand.mjs — Interactive action handlers + the main navigation loop.
// All domain-specific subroutines live here (not in hermit.mjs).  Navigation primitives
// (askMenuAction, renderNavMenu, waitForContinue) are imported from navigation.mjs.
import path from 'node:path';

import {
  args,
  commandArgs,
  jsonRequested,
  port,
  hermitHome,
  telemetryDir,
  telemetryWorkerPidPath,
  telemetryWorkerStatusPath,
  telemetryWorkerLogPath,
  telemetryWorkerErrorLogPath,
} from './env.mjs';
import {
  cancelCli,
  printJson,
  ui,
  colorByState,
  printCliRows,
  printWelcomeLogo,
  clearTerminal,
  isInteractiveCli,
  createPromptInterface,
} from './terminal.mjs';
import {
  describeUploadToggle,
} from './uploadState.mjs';
import {
  formatUploadProviders,
  normalizeUploadProviders,
} from './usageRemote.mjs';
import { BRAND, brandLogPrefix } from '../branding.mjs';
import {
  askMenuAction,
  renderBusyScreen,
  waitForContinue,
  parseMenuKeys,
} from './navigation.mjs';
import {
  printDaemonStatus,
  stopDaemon,
  startDaemon,
  collectDaemonStatus,
} from './daemon.mjs';
import {
  currentFeatureStates,
  refreshWebRunningState,
  markWebRunningOptimistic,
  clearWebRunningOptimistic,
  refreshAuthCacheFromServer,
} from './featureState.mjs';
import {
  readHermitSettings,
  writeHermitSettings,
  enableTeamCollaborationDefaults,
} from './settings.mjs';
import {
  readOpenHermitAuthStatus,
  runAuthDevLogin,
  printAuthStatus,
  runAuthLogout,
  runAuthLogin,
  resolveConversationUploadBaseUrl,
  openExternalUrl,
} from './auth.mjs';
import { runAikeyStatus, applyToConfigs, maskKey } from './aikey.mjs';
import { provisionRun, pollRun, claimSecret, discoverCatalog } from './tokenDistribution.mjs';
import {
  printDoctor,
  printTeamsList,
  printTeamsCreate,
  printTasksList,
} from './teams.mjs';
import {
  NAV_ACTIONS,
  LOCAL_USE_ACTIONS,
  TEAM_COLLAB_ACTIONS,
  EMPLOYEE_ACTIONS,
  RUNTIME_ACTIONS,
  LOCAL_COLLECTION_ACTIONS,
  TASK_BUS_ACTIONS,
  ACCOUNT_ACTIONS,
  findMenuAction,
} from './menus.mjs';
import {
  printDeveloperUploadLogs,
  readLogTail,
} from './runtime.mjs';
import {
  waitForOpenHermitServerReady,
} from './daemon.mjs';
import {
  safeReadJson,
} from './settings.mjs';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, openSync, closeSync, statSync, readSync } from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// --- Busy screen message for inline actions ------------------------------------

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
  if (action.id === 'aikey-claim') return '正在认领 token...';
  if (action.id === 'aikey-status') return '正在读取 aikey 状态...';
  if (action.id === 'dev-login') return '请输入开发口令以开启开发者模式...';
  if (action.id === 'upload-logs') return '正在读取消息上报调试日志...';
  return `正在处理：${action.label}，请稍候...`;
}

// --- Developer-mode guard -----------------------------------------------------

function hasDeveloperModeEnabled() {
  return Boolean(readOpenHermitAuthStatus().developerMode);
}

// --- Status bar items --------------------------------------------------------

function currentMenuStatusItems(states = currentFeatureStates()) {
  const upload = describeUploadToggle({ enabled: states.conversationUploadEnabled, running: states.usageRunning });
  return [
    { label: states.auth.authorized ? `已登录 ${states.auth.account?.name || BRAND.authProviderName}` : '未登录', state: states.auth.authorized ? 'ok' : 'off' },
    { label: states.webRunning ? 'Web 运行中' : 'Web 未启动', state: states.webRunning ? 'ok' : 'off' },
    { label: upload.rowLabel, state: upload.rowState },
  ];
}

// --- Action state chips ------------------------------------------------------

function actionStateLabel(action, states) {
  if (action.id === 'web') {
    if (action.children?.length) {
      return { text: states.webRunning ? '运行中' : '未启动', state: states.webRunning ? 'ok' : 'error' };
    }
    return { text: states.webRunning ? '运行中' : '未启动', state: states.webRunning ? 'ok' : 'error' };
  }
  if (action.id === 'start-web' || action.id === 'toggle-web') return { text: states.webRunning ? '运行中' : '未启动', state: states.webRunning ? 'ok' : 'error' };
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

// --- Utility helpers ---------------------------------------------------------

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

// --- Usage telemetry helpers (shared with usageCommand) ---------------------

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
    recentMessages: 0,
    recentTokensTotal: 0,
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

// Re-export these so usageCommand.mjs can share them
export { emptyUsageTelemetryStatus, usageDaemonPayload };

// --- Menu-driven action subroutines ------------------------------------------

async function runLocalCollectionAction() {
  const { printScanOnceResult, printUsageStart, printUsageStop, printUsageStatus, isUsageAuthUnavailable, loginAfterUsageAuthExpired, enableConversationUploadWithProvider } = await import('./usageCommand.mjs');

  while (true) {
    const actionId = await askMenuAction({
      title: '用量上报',
      subtitle: '本地扫描可免登录；消息上报支持多选 Claude Code / Codex，按批次增量上传',
      actions: LOCAL_COLLECTION_ACTIONS,
      escapeAction: 'back',
      statusItems: currentMenuStatusItems(),
      hasDeveloperModeEnabled,
      actionStateLabel: (action) => actionStateLabel(action, currentFeatureStates()),
    });
    if (actionId === 'back') return;
    if (actionId === 'overview') {
      const result = await printUsageStatus({ exitOnDone: false });
      if (isUsageAuthUnavailable(result)) await loginAfterUsageAuthExpired();
    }
    if (actionId === 'scan') {
      const result = await printScanOnceResult({ exitOnDone: false, fullRescan: true });
      if (isUsageAuthUnavailable(result)) await loginAfterUsageAuthExpired();
    }
    if (actionId === 'choose-upload-provider') await enableConversationUploadWithProvider();
    if (actionId === 'start-background') await printUsageStart({ exitOnDone: false });
    if (actionId === 'stop-background') await printUsageStop({ exitOnDone: false });
    await waitForContinue('按 Enter 返回用量上报菜单 | Esc/Ctrl+C 退出（后台继续运行）');
  }
}

async function printTaskBusStatus() {
  try {
    const server = await fetchLocalJson('/api/status').catch(() => ({ running: false }));
  } catch { /* server unreachable */ }

  try {
    const [config, telemetry] = await Promise.all([
      fetchLocalJson('/api/settings/task-bus'),
      fetchLocalJson('/api/telemetry/status').catch(() => null),
    ]);
    printCliRows('团队总线状态', [
      ['团队总线', formatStatusToggle(config.enabled)],
      ['IM', telemetry?.connected ? '已连接' : config.enabled ? '未连接/未知' : '未启用'],
      ['Usage 统计', config.telemetry?.enabled ? '本地扫描开启' : '关闭'],
      ['分布式协作', formatStatusToggle(config.collaboration)],
      ['边界', '团队总线为企业版开放（agentbus），Usage 统计不上传'],
    ], 'IM 协作入口：Web 会话 → IM。');
  } catch (err) {
    printCliRows('团队总线状态', [
      ['状态', '读取失败'],
      ['原因', err instanceof Error ? err.message : String(err)],
    ], '团队总线为企业版开放（agentbus）；开源版无需配置。');
  }
}

async function openWebSettingsTaskBus() {
  printCliRows('团队总线配置', [
    ['地址', `http://127.0.0.1:${port}`],
    ['进入', '会话 → IM'],
  ], 'IM/协作配置在 Web 会话页面管理。');
}

async function runTaskBusAction() {
  while (true) {
    const actionId = await askMenuAction({
      title: '团队总线',
      subtitle: '企业版开放：agentbus、IM 路由与企业看板配置',
      actions: TASK_BUS_ACTIONS,
      escapeAction: 'back',
      statusItems: currentMenuStatusItems(),
      hasDeveloperModeEnabled,
      actionStateLabel: (action) => actionStateLabel(action, currentFeatureStates()),
    });
    if (actionId === 'back') return;
    if (actionId === 'status') await printTaskBusStatus();
    if (actionId === 'open-web-settings') await openWebSettingsTaskBus();
    if (actionId === 'doctor') await printDoctor({ exitOnDone: false });
    await waitForContinue('按 Enter 返回团队总线菜单 | Ctrl+C 退出');
  }
}

// --- token 池「认领」flow: provision → poll → claim → discover → pick → apply ---
// Reached from the home menu's token 池 accordion (aikey-claim child). The claimed
// key is one-time/即焚, so it lives only in memory between claimSecret() and the
// applyToConfigs() write — it is never printed in full and never persisted to the
// hermit data dir.
async function promptText(label, defaultValue = '') {
  const rl = createPromptInterface();
  try {
    const suffix = defaultValue ? ` [${defaultValue}]` : '';
    const answer = await rl.question(`${label}${suffix}: `);
    return String(answer || '').trim();
  } finally {
    rl.close();
  }
}

function collectModels(catalog) {
  const seen = new Set();
  const models = [];
  for (const api of catalog?.modelApis || []) {
    for (const model of api.models || []) {
      if (model && !seen.has(model)) {
        seen.add(model);
        models.push(model);
      }
    }
  }
  return models;
}

function labelForRuntime(runtime) {
  if (runtime === 'claude') return 'Claude';
  if (runtime === 'codex-auth') return 'Codex auth.json';
  if (runtime === 'codex-config') return 'Codex config.toml';
  return runtime;
}

// Two sequential pickers (model, then wire_api) with manual-entry fallbacks.
// Returns { model, wireApi } or null if the user cancelled.
async function pickProtocolAndModel({ secret, catalog }) {
  const models = collectModels(catalog);
  const modelActions = models.map((m) => ({ id: `model::${m}`, label: m }));
  modelActions.push({
    id: 'model::manual',
    label: models.length ? '✍  手动输入模型名' : '✍  手动输入模型名（未取到模型列表）',
  });
  const modelPick = await askMenuAction({
    title: '认领 token · 选择模型',
    subtitle: secret.endpoint ? `网关：${secret.endpoint}` : '把网关 key 配到本机 Codex / Claude',
    actions: modelActions,
    escapeAction: 'back',
    statusItems: currentMenuStatusItems(),
    hasDeveloperModeEnabled,
  });
  if (modelPick === 'back') return null;
  let model;
  if (modelPick === 'model::manual') {
    model = await promptText('模型名');
    if (!model) return null;
  } else {
    model = modelPick.startsWith('model::') ? modelPick.slice('model::'.length) : modelPick;
  }

  // wire_api only governs Codex (config.toml); Claude always uses the anthropic
  // env vars. Prefer the protocols the gateway actually advertised.
  const proxy = secret.proxyPaths || {};
  const wireOptions = [];
  if (proxy.openai_chat) wireOptions.push({ id: 'wire::chat', label: 'OpenAI Chat (openai-chat)' });
  if (proxy.openai_responses) wireOptions.push({ id: 'wire::responses', label: 'OpenAI Responses (openai-responses)' });
  if (wireOptions.length === 0) {
    wireOptions.push({ id: 'wire::chat', label: 'OpenAI Chat（默认）' });
    wireOptions.push({ id: 'wire::responses', label: 'OpenAI Responses' });
  }
  wireOptions.push({ id: 'wire::manual', label: '✍  手动输入 wire_api' });
  const wirePick = await askMenuAction({
    title: '认领 token · 选择协议',
    subtitle: 'Codex 与网关通信的 wire_api（Claude 固定走 anthropic）',
    actions: wireOptions,
    escapeAction: 'back',
    statusItems: currentMenuStatusItems(),
    hasDeveloperModeEnabled,
  });
  if (wirePick === 'back') return null;
  let wireApi;
  if (wirePick === 'wire::manual') {
    wireApi = (await promptText('wire_api', 'chat')) || 'chat';
  } else {
    wireApi = wirePick === 'wire::responses' ? 'responses' : 'chat';
  }
  return { model, wireApi };
}

function renderClaimResult({ result, secret, choices }) {
  const rows = result.runtimes.map((r) => [labelForRuntime(r.runtime), r.path, 'ok']);
  rows.push(['endpoint', secret.endpoint || '(未返回)', 'info']);
  rows.push(['model', choices.model, 'info']);
  rows.push(['key', `${maskKey(secret.key)}  (即焚，已写入配置，不会再显示)`, 'warn']);
  printCliRows('认领 token 完成', rows, [
    '已写入本机 Codex + Claude 配置；新开终端或重启 Codex / Claude 后生效。',
    '⚠ Claude 是否生效取决于网关 endpoint 是否开放 anthropic 协议；若调不通请确认 endpoint 或只使用 Codex。',
  ].join('\n'));
}

function printClaimError(err) {
  printCliRows('认领 token 失败', [
    ['错误', err instanceof Error ? err.message : String(err), 'error'],
  ], '请检查登录状态与网络后重试；若持续失败，服务端 token 分发接口可能尚未就绪。');
}

async function runTokenClaimFlow() {
  // 1. provision (async run)
  let runId;
  try {
    renderBusyScreen('认领 token', '正在签发消费者（auto-provision）…');
    const provision = await provisionRun();
    runId = provision.runId;
  } catch (err) {
    printClaimError(err);
    return;
  }

  // 2. poll until succeeded
  try {
    await pollRun(runId, {
      intervalMs: 2_000,
      onTick: (status) => renderBusyScreen('认领 token', `正在签发消费者…（${status}）\nrun_id: ${runId}`),
    });
  } catch (err) {
    printClaimError(err);
    return;
  }

  // 3. claim the one-time secret
  let secret;
  try {
    renderBusyScreen('认领 token', '正在领取明文 key（一次性）…');
    secret = await claimSecret(runId);
  } catch (err) {
    printClaimError(err);
    return;
  }

  // 4. discover models (non-fatal — picker falls back to manual entry)
  let catalog = { modelApis: [], defaultApiName: null };
  try {
    renderBusyScreen('认领 token', '正在拉取可用模型列表…');
    catalog = await discoverCatalog();
  } catch {
    // discover is best-effort; keep the empty catalog and let the user type a model.
  }

  // 5. pick model + wire_api
  const choices = await pickProtocolAndModel({ secret, catalog });
  if (!choices) {
    printCliRows('认领 token', [['状态', '已取消', 'warn']], '未写入任何配置。');
    return;
  }

  // 6. apply to local configs + render
  const result = applyToConfigs({
    key: secret.key,
    endpoint: secret.endpoint,
    model: choices.model,
    wireApi: choices.wireApi,
    runtimes: ['codex', 'claude'],
  });
  renderClaimResult({ result, secret, choices });
}

async function runAccountAction() {
  while (true) {
    const actionId = await askMenuAction({
      title: '登录状态',
      subtitle: `本地使用无需登录；云端授权、托管服务或显式上传需要 ${BRAND.authAccountLabel}`,
      actions: ACCOUNT_ACTIONS,
      escapeAction: 'back',
      statusItems: currentMenuStatusItems(),
      hasDeveloperModeEnabled,
      actionStateLabel: (action) => actionStateLabel(action, currentFeatureStates()),
    });
    if (actionId === 'back') return;
    if (actionId === 'status') await printAuthStatus({ exitOnDone: false });
    if (actionId === 'login') await runAuthLogin({ exitOnDone: false, interactiveMenu: true });
    if (actionId === 'logout') await runAuthLogout({ exitOnDone: false });
    if (actionId === 'dev-login') await runAuthDevLogin({ exitOnDone: false });
    await refreshAuthCacheFromServer();
    const continueAction = await waitForContinue('按 Enter/← 返回登录状态菜单 | Esc/Ctrl+C 退出');
    if (continueAction === 'back' || continueAction === 'cancel') return;
  }
}

async function runLocalUseAction() {
  while (true) {
    const actionId = await askMenuAction({
      title: '本地使用',
      subtitle: '无需登录 | 本机 Web、数字员工、本地采集和运行时',
      actions: LOCAL_USE_ACTIONS,
      escapeAction: 'back',
      statusItems: currentMenuStatusItems(),
      hasDeveloperModeEnabled,
      actionStateLabel: (action) => actionStateLabel(action, currentFeatureStates()),
    });
    if (actionId === 'back') return;
    const action = findMenuAction(LOCAL_USE_ACTIONS, actionId);
    if (action) await runNavigationAction(action);
  }
}

export async function printCollaborationStart({ exitOnDone = true } = {}) {
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
    auth: { authorized: auth.authorized },
  };
  if (jsonRequested) printJson(result);
  printCliRows('团队协作已准备好', [
    ['用户', auth.authorized ? `已登录 ${BRAND.authProviderName}` : '未登录（企业版协作需登录）'],
    ['IM', `${taskBus.redis.host}:${taskBus.redis.port}`],
    ['配置入口', 'Web 会话 → IM'],
  ], '团队总线为企业版开放（agentbus）；Usage 统计不会上传。');
  if (exitOnDone) process.exit(0);
  return result;
}

async function runTeamCollaborationAction() {
  const result = await printCollaborationStart({ exitOnDone: false });
  const auth = result.auth;
  const nextAction = await waitForContinue('按 Enter/→ 进入团队协作菜单 | ← 返回首页 | Esc/Ctrl+C 退出');
  if (nextAction === 'back') return;

  while (true) {
    const actionId = await askMenuAction({
      title: '团队协作',
      subtitle: auth.authorized ? '已登录 | 企业版协作配置已写入本机设置' : '未登录 | 企业版协作需登录授权',
      actions: TEAM_COLLAB_ACTIONS,
      escapeAction: 'back',
      statusItems: currentMenuStatusItems(),
      hasDeveloperModeEnabled,
      actionStateLabel: (action) => actionStateLabel(action, currentFeatureStates()),
    });
    if (actionId === 'back') return;
    if (actionId === 'open-web-settings') await openWebSettingsTaskBus();
    if (actionId === 'task-bus') await printTaskBusStatus();
    if (actionId === 'account') await runAccountAction();
    await waitForContinue('按 Enter/← 返回团队协作菜单 | Esc/Ctrl+C 退出');
  }
}

async function runEmployeeAction() {
  while (true) {
    const actionId = await askMenuAction({
      title: '数字员工',
      subtitle: '团队、任务与协作入口',
      actions: EMPLOYEE_ACTIONS,
      escapeAction: 'back',
      statusItems: currentMenuStatusItems(),
      hasDeveloperModeEnabled,
      actionStateLabel: (action) => actionStateLabel(action, currentFeatureStates()),
    });
    if (actionId === 'back') return;
    if (actionId === 'create-team') {
      await printTeamsCreate({ exitOnDone: false });
      await waitForContinue('按 Enter 返回数字员工菜单 | Ctrl+C 退出');
      continue;
    }
    if (actionId === 'list-teams') {
      printTeamsList({ exitOnDone: false });
      await waitForContinue('按 Enter 返回数字员工菜单 | Ctrl+C 退出');
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
      statusItems: currentMenuStatusItems(),
      hasDeveloperModeEnabled,
      actionStateLabel: (action) => actionStateLabel(action, currentFeatureStates()),
    });
    if (actionId === 'back') return;
    if (actionId === 'status') {
      await printDaemonStatus({ exitOnDone: false });
      await waitForContinue('按 Enter 返回本地运行时菜单 | Ctrl+C 退出');
      continue;
    }
    if (actionId === 'doctor') {
      await printDoctor({ exitOnDone: false });
      await waitForContinue('按 Enter 返回本地运行时菜单 | Ctrl+C 退出');
      continue;
    }
    if (actionId === 'stop') {
      await stopDaemon({ exitOnDone: false });
      await waitForContinue('按 Enter 返回本地运行时菜单 | Ctrl+C 退出');
    }
  }
}

// Pause message shown after an inline leaf action. Enter or ← returns to the
// home menu (the action ran inline; the menu repaints when this resolves).
const ACTION_DONE_MSG = '按 Enter / ← 返回菜单  |  Esc/Ctrl+C 退出';

// Stream NEW bytes appended to `logPath` to stdout while `wait` is pending, then
// stop + flush one last time. Lets the user watch a long action's live log (e.g.
// the daemon startup) under the busy screen instead of staring at a static
// "正在处理" line for up to 30s. No-op if the file can't be read.
function streamLogWhile(logPath, wait) {
  let cursor = 0;
  try { cursor = statSync(logPath).size; } catch { /* file may not exist yet */ }
  let stopped = false;
  const flush = () => {
    if (stopped) return;
    try {
      const size = statSync(logPath).size;
      if (size <= cursor) return;
      const len = size - cursor;
      const buf = Buffer.allocUnsafe(len);
      const fd = openSync(logPath, 'r');
      try { readSync(fd, buf, 0, len, cursor); } finally { closeSync(fd); }
      process.stdout.write(buf);
      cursor = size;
    } catch { /* log rotated/deleted — skip this tick */ }
  };
  const timer = setInterval(flush, 300);
  const stop = () => { stopped = true; clearInterval(timer); flush(); };
  return wait.then((v) => { stop(); return v; }, (e) => { stop(); throw e; });
}

// --- Main action dispatcher -------------------------------------------------

export async function runNavigationAction(action) {
  const states = currentFeatureStates();

  // Toggles resolve to start/stop and RETURN the pause result so a submenu page
  // can treat ← as "go back to home".
  if (action.id === 'web' || action.id === 'toggle-web') {
    return runNavigationAction({ id: states.webRunning ? 'stop-web' : 'start-web' });
  }
  if (action.id === 'toggle-background') {
    return runNavigationAction({ id: states.usageRunning ? 'stop-background' : 'start-background' });
  }
  if (action.id === 'toggle-message-upload') {
    const { stopTelemetryWorker, clearStaleConversationUploadLock, markTelemetryWorkerRestarting, setConversationUploadEnabled } = await import('./usageCommand.mjs');
    const newStates = currentFeatureStates();
    if (!newStates.conversationUploadEnabled || !newStates.usageRunning) {
      const { enableConversationUploadWithProvider } = await import('./usageCommand.mjs');
      const result = await enableConversationUploadWithProvider();
      const updatedStates = currentFeatureStates();
      // Explicit success panel — without it the busy screen's "正在处理…" was
      // the only visible text and the toggle looked hung even though it finished.
      printCliRows('消息上报', [
        ['状态', '已开启', 'ok'],
        ['来源', formatUploadProviders(result.providers), 'info'],
        ['后台', updatedStates.usageRunning ? 'worker 运行中' : '稍后由后台增量扫描启动', updatedStates.usageRunning ? 'ok' : 'info'],
      ], '默认扫描 Claude Code + Codex，按批次增量上传最近 7 天；服务端按 eventId 自动去重。');
      console.log('');
      return waitForContinue(ACTION_DONE_MSG);
    }
    setConversationUploadEnabled(false, newStates.uploadProviders);
    const worker = await stopTelemetryWorker();
    await clearStaleConversationUploadLock();
    markTelemetryWorkerRestarting('消息上报已关闭，worker 已停止');
    const updatedStates = currentFeatureStates();
    printCliRows('消息上报', [
      ['状态', '已关闭，worker 已重启/停止', 'off'],
      ['菜单显示', updatedStates.conversationUploadEnabled ? '仍显示开启，请刷新状态' : '已更新为关闭', updatedStates.conversationUploadEnabled ? 'warn' : 'ok'],
      ['worker', worker.stopped ? `已停止 pid ${worker.pid}` : '未运行', 'info'],
      ['来源', formatUploadProviders(newStates.uploadProviders), 'info'],
      ['说明', '关闭消息上报会停止 worker 并清理上报锁', 'info'],
    ], '再次开启会重新启动 worker，并从服务端 /report/usage/status 读取 cursor。');
    console.log('');
    return waitForContinue(ACTION_DONE_MSG);
  }
  if (action.id === 'start-web') {
    markWebRunningOptimistic();
    const daemon = startDaemon({ exitOnDone: false, quiet: true });
    // Stream the daemon's startup log while we wait for readiness, so the user
    // sees live progress (Starting… Launching… bound to port…) instead of a
    // blank busy screen.
    const ready = await streamLogWhile(daemon.logPath, waitForOpenHermitServerReady(daemon.pid, 120_000));
    if (ready.ready || ready.stillBooting) {
      const url = ready.url || daemon.url;
      await openExternalUrl(url).catch(() => {});
      if (ready.ready) {
        printCliRows('本地数字员工工作台', [
          ['状态', daemon.started ? '已启动并已在浏览器打开' : '已运行并已在浏览器打开', 'ok'],
          ['地址', url, 'info'],
          ['设置', '复杂配置请在工作台中完成', 'info'],
        ]);
      } else {
        // stillBooting: the process is up and binding the port but the HTTP
        // probe hasn't answered within the deadline (cold tsx boot). The
        // workbench WILL come up — open the browser and tell the user to
        // refresh, instead of the old false "启动失败" for a workbench that
        // actually opened.
        printCliRows('本地数字员工工作台', [
          ['状态', '仍在启动中（冷启动较慢），已打开浏览器', 'warn'],
          ['地址', url, 'info'],
          ['提示', '服务进程正在启动，等待几秒后刷新页面即可', 'info'],
        ], '冷启动首次编译较慢；浏览器已打开，稍后刷新即可进入工作台。');
      }
      console.log('');
      return waitForContinue(ACTION_DONE_MSG);
    }
    printCliRows('本地数字员工工作台', [
      ['状态', '启动失败', 'error'],
      ['地址', daemon.url, 'info'],
      ['日志', daemon.logPath, 'info'],
      ['原因', ready.reason, 'warn'],
    ], '已打印最近日志，按提示处理后再重试。');
    readLogTail(BRAND.stylizedName, daemon.logPath);
    console.log('');
    return waitForContinue(ACTION_DONE_MSG);
  }
  if (action.id === 'stop-web') {
    await stopDaemon({ exitOnDone: false, quiet: true });
    clearWebRunningOptimistic();
    printCliRows('本地数字员工工作台', [
      ['状态', '已关闭', 'off'],
      ['用量上报', '不受影响', 'info'],
    ]);
    console.log('');
    return waitForContinue(ACTION_DONE_MSG);
  }
  if (action.id === 'web-status') {
    await printDaemonStatus({ exitOnDone: false });
    console.log('');
    return waitForContinue(ACTION_DONE_MSG);
  }
  if (action.id === 'workbench-status') {
    const ds = await collectDaemonStatus();
    let statusText;
    if (ds.pid) {
      statusText = `运行中（pid ${ds.pid}）`;
    } else if (ds.fallbackPids?.length) {
      statusText = `运行中，无 daemon pidfile（pids ${ds.fallbackPids.join(', ')}）`;
    } else if (ds.server?.running) {
      statusText = `运行中（端口 ${ds.port}，未找到 pidfile）`;
    } else {
      statusText = '未运行';
    }
    printCliRows('AgentCli 工作台', [
      ['状态', statusText, ds.running ? 'ok' : 'warn'],
      ['地址', ds.running ? `${ds.url}（token 自动携带，仅本机）` : '未运行', ds.running ? 'info' : 'off'],
    ], '本机 AgentCli Web daemon：用于本地 CC/Codex session → IM 的配置与管理');
    console.log('');
    return waitForContinue(ACTION_DONE_MSG);
  }
  if (action.id === 'overview' || action.id === 'scan' || action.id === 'start-background' || action.id === 'stop-background') {
    const { printUsageStatus, printScanOnceResult, printUsageStart, printUsageStop } = await import('./usageCommand.mjs');
    if (action.id === 'overview') await printUsageStatus({ exitOnDone: false });
    else if (action.id === 'scan') await printScanOnceResult({ exitOnDone: false, fullRescan: true });
    else if (action.id === 'start-background') await printUsageStart({ exitOnDone: false });
    else await printUsageStop({ exitOnDone: false });
    console.log('');
    return waitForContinue(ACTION_DONE_MSG);
  }
  if (action.id === 'upload-logs') {
    printDeveloperUploadLogs();
    console.log('');
    return waitForContinue(ACTION_DONE_MSG);
  }
  if (action.id === 'exit') { cancelCli(); return; }
  // Auth transitions re-probe /api/v1/auth/me and cache the server-confirmed
  // state BEFORE the pause screen repaints. /me is authoritative for "logged in
  // right now" — the local store can lag a login write — so awaiting it means
  // the status bar already reads 已登录 when the user lands back on the menu.
  if (action.id === 'login') {
    await runAuthLogin({ exitOnDone: false, interactiveMenu: true });
    await refreshAuthCacheFromServer();
    console.log('');
    return waitForContinue(ACTION_DONE_MSG);
  }
  if (action.id === 'logout') {
    await runAuthLogout({ exitOnDone: false });
    await refreshAuthCacheFromServer();
    console.log('');
    return waitForContinue(ACTION_DONE_MSG);
  }
  if (action.id === 'dev-login') {
    await runAuthDevLogin({ exitOnDone: false });
    await refreshAuthCacheFromServer();
    console.log('');
    return waitForContinue(ACTION_DONE_MSG);
  }
  if (action.id === 'status') { await printAuthStatus({ exitOnDone: false }); console.log(''); return waitForContinue(ACTION_DONE_MSG); }
  if (action.id === 'aikey-claim') { await runTokenClaimFlow(); console.log(''); return waitForContinue(ACTION_DONE_MSG); }
  if (action.id === 'aikey-status') { await runAikeyStatus({ exitOnDone: false }); console.log(''); return waitForContinue(ACTION_DONE_MSG); }
  // Dedicated submenu pages (reached from nested menus, not home navigation).
  if (action.id === 'local-use') { return runLocalUseAction(); }
  if (action.id === 'data-sync') { return runLocalCollectionAction(); }
  if (action.id === 'services') { const { runServicesMenu } = await import('./servicesCommand.mjs'); return runServicesMenu(); }
  if (action.id === 'team-collaboration') { return runTeamCollaborationAction(); }
  if (action.id === 'local-collection') { return runLocalCollectionAction(); }
  if (action.id === 'task-bus') { return runTaskBusAction(); }
  if (action.id === 'account') { return runAccountAction(); }
  if (action.id === 'employees') { return runEmployeeAction(); }
  if (action.id === 'runtime') { return runRuntimeAction(); }
}

// --- Top-level navigation loop ----------------------------------------------

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

export async function printNavigation() {
  if (!isInteractiveCli() || jsonRequested) {
    printNavigationActions();
    return;
  }
  // Populate the auth cache from /me BEFORE the first render so the status bar
  // shows the server-confirmed login state immediately (not the local-store
  // snapshot, which can lag a recent login).
  await refreshAuthCacheFromServer();
  await refreshWebRunningState();

  // statusItems is a FUNCTION so askMenuAction re-reads currentFeatureStates()
  // on every repaint — otherwise the top status bar stays stale after an inline
  // login / toggle-web / toggle-message-upload (the original "登陆了也没用").
  await askMenuAction({
    title: '',
    subtitle: '',
    actions: NAV_ACTIONS,
    escapeAction: 'exit',
    statusItems: () => currentMenuStatusItems(currentFeatureStates()),
    hasDeveloperModeEnabled,
    actionStateLabel: (action) => actionStateLabel(action, currentFeatureStates()),
    inlineBusyMessage,
    // Child / leaf actions run INLINE: the home menu stays open and repaints
    // with fresh state when the action finishes. Parents toggle expansion
    // (accordion) inside askMenuAction; comingSoon shows a notice there too.
    onAction: async (action) => {
      try {
        await runNavigationAction(action);
      } catch (err) {
        console.error(`${ui.danger('ERR')} ${err instanceof Error ? err.message : String(err)}`);
        await waitForContinue();
      }
      await refreshWebRunningState();
      // Fire-and-forget /me re-probe so the NEXT repaint converges to the
      // server truth. Non-blocking + non-clobbering (see featureState.mjs) —
      // a transient /me failure can't flip a fresh 已登录→未登录.
      refreshAuthCacheFromServer().catch(() => {});
      return true; // handled → askMenuAction repaints and keeps the menu open
    },
  });
  // askMenuAction resolved → user pressed ← / Esc / selected 退出 at home.
  cancelCli();
}
