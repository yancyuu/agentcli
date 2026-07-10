// navigationCommand.mjs — Interactive action handlers + the main navigation loop.
// All domain-specific subroutines live here (not in hermit.mjs).  Navigation primitives
// (askMenuAction, renderNavMenu, waitForContinue) are imported from navigation.mjs.
import path from 'node:path';
import { createRequire } from 'node:module';

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
  currentVersion,
} from './env.mjs';
import {
  cancelCli,
  printJson,
  ui,
  colorByState,
  printCliRows,
  printWelcomeLogo,
  clearTerminal,
  clearTerminalScrollback,
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
import {
  runAikeyStatus,
  activateAikeyBundle,
  maskKey,
  applyClaimedSecret,
  resolveClaudeBaseUrl,
  resolveCodexBaseUrl,
} from './aikey.mjs';
import {
  snapshotOriginals,
  restoreOriginals,
  hasSnapshot,
  originalEnvBackupRoot,
} from './configEnvBackup.mjs';
import {
  assistantPlatformMeta,
  assistantAgentTypeActions,
  assistantPlatformActions,
  assistantWecomModeActions,
  isAssistantQrPlatform,
  labelForAssistantAgentType,
  labelForAssistantPlatform,
  normalizeAssistantBindProject,
} from './assistantCreationOptions.mjs';
import { ensureLarkCliDigitalWorkerAuth } from './larkCli.mjs';
import { provisionDigitalWorker } from './digitalWorkerCommand.mjs';
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

const require = createRequire(import.meta.url);

function renderTerminalQr(value) {
  try {
    const qrcode = require('qrcode-terminal');
    qrcode.generate(value, { small: true });
    return true;
  } catch {
    return false;
  }
}

const ONLINE_GUIDE_URL = 'https://yancyuu.github.io/agentcli/';
const ONLINE_GUIDE_HANDOFF = [
  `请先阅读 AgentCli 在线说明书：${ONLINE_GUIDE_URL}`,
  '这是本机 AgentCli/Hermit 的使用手册。',
  '后续回答和操作请以这份说明书为准。',
];

export function onlineGuideRows() {
  return [
    ['说明书', ONLINE_GUIDE_URL, 'info'],
    ['交给 Claude Code', ONLINE_GUIDE_HANDOFF, 'ok'],
    ['用途', '把这段提示复制给 Claude Code / Codex，让它先读说明书再操作', 'info'],
  ];
}

function printOnlineGuide() {
  printCliRows('在线说明书', onlineGuideRows(), '复制「交给 Claude Code」这一行给其他 AI 助手即可。');
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
    { label: `${BRAND.stylizedName} v${currentVersion}`, state: 'info' },
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

function menuRenderState() {
  const states = currentFeatureStates();
  return {
    states,
    statusItems: currentMenuStatusItems(states),
    actionStateLabel: (action) => actionStateLabel(action, states),
  };
}

// --- Menu-driven action subroutines ------------------------------------------

async function runLocalCollectionAction() {
  const { printScanOnceResult, printUsageStart, printUsageStop, printUsageStatus, isUsageAuthUnavailable, loginAfterUsageAuthExpired, enableConversationUploadWithProvider } = await import('./usageCommand.mjs');

  while (true) {
    const renderState = menuRenderState();
    const actionId = await askMenuAction({
      title: '用量上报',
      subtitle: '本地扫描可免登录；消息上报支持多选 Claude Code / Codex，按批次增量上传',
      actions: LOCAL_COLLECTION_ACTIONS,
      escapeAction: 'back',
      statusItems: renderState.statusItems,
      hasDeveloperModeEnabled,
      actionStateLabel: renderState.actionStateLabel,
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
    const renderState = menuRenderState();
    const actionId = await askMenuAction({
      title: '团队总线',
      subtitle: '企业版开放：agentbus、IM 路由与企业看板配置',
      actions: TASK_BUS_ACTIONS,
      escapeAction: 'back',
      statusItems: renderState.statusItems,
      hasDeveloperModeEnabled,
      actionStateLabel: renderState.actionStateLabel,
    });
    if (actionId === 'back') return;
    if (actionId === 'status') await printTaskBusStatus();
    if (actionId === 'open-web-settings') await openWebSettingsTaskBus();
    if (actionId === 'doctor') await printDoctor({ exitOnDone: false });
    await waitForContinue('按 Enter 返回团队总线菜单 | Ctrl+C 退出');
  }
}

// --- token 池「认领」flow: provision → poll → claim → discover → pick → activate ---
// Reached from the home menu's token 池 accordion (aikey-claim child). The claimed
// key is one-time/即焚, so it lives only in memory between claimSecret() and the
// aikey env activation write. It is never printed in full and no Claude/Codex
// config files are modified by default.
async function promptText(label, defaultValue = '') {
  const rl = createPromptInterface();
  try {
    const suffix = defaultValue ? ` [${defaultValue}]` : '';
    const answer = await rl.question(`${label}${suffix}: `);
    const trimmed = String(answer || '').trim();
    return trimmed || defaultValue;
  } finally {
    rl.close();
  }
}

async function promptBoolean(label) {
  const actionId = await askMenuAction({
    title: label,
    subtitle: '选择是否启用该选项',
    actions: [
      { id: 'false', label: '否' },
      { id: 'true', label: '是' },
    ],
    escapeAction: 'back',
    statusItems: currentMenuStatusItems(),
    hasDeveloperModeEnabled,
  });
  if (actionId === 'back') return null;
  return actionId === 'true';
}

function collectModelChoices(catalog) {
  const choices = [];
  for (const api of catalog?.modelApis || []) {
    if (!api?.httpApiId) continue;
    for (const model of api.models || []) {
      if (model) choices.push({ model, apiName: api.name, httpApiId: api.httpApiId });
    }
  }
  return choices;
}

function bundleFromClaimedSecret({ secret, choices }) {
  // Per-runtime endpoints: Claude = gateway endpoint, Codex = resolved proxy
  // route for the chosen wire_api. Fixes the old "same endpoint for both" bug.
  const claudeBaseUrl = resolveClaudeBaseUrl(secret);
  const codexBaseUrl = resolveCodexBaseUrl(secret, choices.wireApi);
  const anthropic = { apiKey: secret.key, ...(claudeBaseUrl ? { baseUrl: claudeBaseUrl } : {}) };
  const openai = { apiKey: secret.key, ...(codexBaseUrl ? { baseUrl: codexBaseUrl } : {}) };
  return {
    displayName: choices.model ? `agentcli-token-pool:${choices.model}` : 'agentcli-token-pool',
    providers: { anthropic, openai },
  };
}

// Select a model while retaining the owning Aliyun Model API ID required by
// /aliyun/auto-provision. Returns null if the user cancels.
async function pickModelApi(catalog) {
  const choices = collectModelChoices(catalog);
  if (choices.length === 0) {
    printCliRows('认领 token 失败', [
      ['错误', '未获取到可用的阿里云 Model API', 'error'],
    ], '服务端签发消费者前要求选择 Model API，请稍后重试。');
    return null;
  }
  const actionId = await askMenuAction({
    title: '认领 token · 选择模型',
    subtitle: '选择要授权给消费者的阿里云 Model API',
    actions: choices.map((choice, index) => ({
      id: `model::${index}`,
      label: choice.model,
      detail: choice.apiName,
    })),
    escapeAction: 'back',
    statusItems: currentMenuStatusItems(),
    hasDeveloperModeEnabled,
  });
  if (actionId === 'back') return null;
  const index = Number(actionId.slice('model::'.length));
  return Number.isInteger(index) ? choices[index] || null : null;
}

// wire_api governs only Codex; Claude always uses the anthropic protocol.
async function pickWireApi(secret) {
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
  if (wirePick === 'wire::manual') return (await promptText('wire_api', 'chat')) || 'chat';
  return wirePick === 'wire::responses' ? 'responses' : 'chat';
}

function renderClaimResult({ activation, apply, secret, choices, runtimes, snapshot }) {
  const runtimeLabel = runtimes
    .map((r) => (r === 'claude' ? 'Claude Code' : 'Codex'))
    .join(' + ');
  const rows = [...activation.providerRows, ['写入运行时', runtimeLabel, 'ok']];
  if (apply.endpoints.claude) rows.push(['Claude endpoint', apply.endpoints.claude, 'info']);
  if (apply.endpoints.codex) rows.push(['Codex endpoint', apply.endpoints.codex, 'info']);
  rows.push(
    ['aikey env', activation.envPath, 'ok'],
    ['shell hook', activation.hookStatus, 'ok'],
    ['model', choices.model, 'info'],
    [
      '原始配置快照',
      snapshot?.created ? `${originalEnvBackupRoot()}（本次新建）` : `${originalEnvBackupRoot()}（已存在，未覆盖）`,
      'info',
    ],
    ['key', `${maskKey(secret.key)}  (即焚，已写入配置/env，不会再显示)`, 'warn'],
  );
  printCliRows('认领 token 完成', rows, [
    '已按所选运行时写入 Claude/Codex 配置；aikey env + shell hook 同步更新。',
    '原始配置已快照到 ~/.hermit-env.bak，可在「token 池 → 恢复原始配置」一键还原。',
    `新开终端即可生效，或立即执行：source ${activation.envPath}`,
  ].join('\n'));
}

function printClaimError(err) {
  printCliRows('认领 token 失败', [
    ['错误', err instanceof Error ? err.message : String(err), 'error'],
  ], '请检查登录状态与网络后重试；若持续失败，服务端 token 分发接口可能尚未就绪。');
}

async function runTokenClaimFlow() {
  // 1. Discover and select the Aliyun Model API required by auto-provision.
  let catalog;
  try {
    renderBusyScreen('认领 token', '正在拉取可用模型列表…');
    catalog = await discoverCatalog();
  } catch (err) {
    printClaimError(err);
    return;
  }
  const modelChoice = await pickModelApi(catalog);
  if (!modelChoice) return;

  // 2. Provision the selected Model API consumer.
  let runId;
  try {
    renderBusyScreen('认领 token', '正在签发消费者（auto-provision）…');
    const provision = await provisionRun({
      apiName: modelChoice.apiName || catalog.defaultApiName,
      aliyunModelApiIds: [modelChoice.httpApiId],
    });
    runId = provision.runId;
  } catch (err) {
    printClaimError(err);
    return;
  }

  // 3. Poll until succeeded.
  try {
    await pollRun(runId, {
      intervalMs: 2_000,
      onTick: (status) => renderBusyScreen('认领 token', `正在签发消费者…（${status}）\nrun_id: ${runId}`),
    });
  } catch (err) {
    printClaimError(err);
    return;
  }

  // 4. Claim the one-time secret.
  let secret;
  try {
    renderBusyScreen('认领 token', '正在领取明文 key（一次性）…');
    secret = await claimSecret(runId);
  } catch (err) {
    printClaimError(err);
    return;
  }

  // 5. Choose which runtimes to write (default both). Single-select primitive —
  //    the three options cover every intent without inventing a multi-select UI.
  const runtimes = await pickRuntimes();
  if (!runtimes) {
    printCliRows('认领 token', [['状态', '已取消', 'warn']], '未写入任何配置。');
    return;
  }

  // 6. Codex wire protocol — only relevant when Codex is selected.
  let wireApi = 'chat';
  if (runtimes.includes('codex')) {
    wireApi = await pickWireApi(secret);
    if (!wireApi) {
      printCliRows('认领 token', [['状态', '已取消', 'warn']], '未写入任何配置。');
      return;
    }
  }
  const choices = { model: modelChoice.model, wireApi };

  // 7. Snapshot originals (create-once) BEFORE any write, so one-click restore
  //    always returns to the pre-token-pool state regardless of future claims.
  let snapshot;
  try {
    renderBusyScreen('认领 token', '正在快照原始配置…');
    snapshot = snapshotOriginals();
  } catch (err) {
    printClaimError(err);
    return;
  }

  // 8. Write the chosen runtimes' config files directly (backup:false — the
  //    snapshot above owns the restore story, so no stray .hermit-bak files).
  let apply;
  try {
    renderBusyScreen('认领 token', '正在写入 Claude / Codex 配置…');
    apply = applyClaimedSecret({ secret, choices, runtimes });
  } catch (err) {
    printClaimError(err);
    return;
  }

  // 9. Also refresh aikey env + shell hook (keeps Status accurate + propagates
  //    the key to new shells / env-reading tools). Same key, no divergence.
  let activation;
  try {
    activation = await activateAikeyBundle({ bundle: bundleFromClaimedSecret({ secret, choices }) });
  } catch (err) {
    printClaimError(err);
    return;
  }

  renderClaimResult({ activation, apply, secret, choices, runtimes, snapshot });
}

// pickRuntimes — askMenuAction single-select mirroring pickModelApi/pickWireApi.
// Returns ['claude','codex'] | ['claude'] | ['codex'], or null on cancel.
async function pickRuntimes() {
  const actionId = await askMenuAction({
    title: '认领 token · 选择运行时',
    subtitle: '选择要写入的本地运行时（默认两者都写）',
    actions: [
      { id: 'runtime::both', label: 'Claude Code + Codex（默认）', recommended: true },
      { id: 'runtime::claude', label: '仅 Claude Code' },
      { id: 'runtime::codex', label: '仅 Codex' },
    ],
    escapeAction: 'back',
    statusItems: currentMenuStatusItems(),
    hasDeveloperModeEnabled,
  });
  if (actionId === 'back') return null;
  if (actionId === 'runtime::claude') return ['claude'];
  if (actionId === 'runtime::codex') return ['codex'];
  return ['claude', 'codex'];
}

// One-click restore of the original Claude/Codex configs from the create-once
// snapshot. Existed files are copied back; files the pool created are deleted.
async function runRestoreOriginalsFlow() {
  if (!hasSnapshot()) {
    printCliRows('恢复原始配置', [['状态', '无可恢复的原始配置', 'warn']], 'token 池尚未改过 Claude / Codex 配置，无需恢复。');
    console.log('');
    return waitForContinue(ACTION_DONE_MSG);
  }
  const confirmed = await promptBoolean('确认恢复 Claude/Codex 原始配置？当前 token 池写入将被覆盖/删除');
  if (confirmed !== true) {
    printCliRows('恢复原始配置', [['状态', '已取消', 'warn']], '未做任何改动。');
    console.log('');
    return waitForContinue(ACTION_DONE_MSG);
  }
  const { results } = restoreOriginals();
  const rows = results.map((r) => {
    if (r.action === 'restored') return [r.runtime, `还原 ${r.path}`, 'ok'];
    if (r.action === 'deleted') return [r.runtime, `删除 ${r.path}（token 池新建）`, 'ok'];
    return [r.runtime, `跳过（${r.reason}）`, 'off'];
  });
  printCliRows('恢复原始配置完成', rows, [
    '已回到 token 池介入前的本地配置。',
    '快照保留在 ~/.hermit-env.bak，可再次恢复或在下次认领时复用。',
  ].join('\n'));
  console.log('');
  return waitForContinue(ACTION_DONE_MSG);
}

function assistantStageRow(label, result, successText) {
  if (!result) return [label, '待执行', 'off'];
  if (result.ok) return [label, successText || result.message || '完成', 'ok'];
  return [label, result.message || '失败', 'error'];
}

async function confirmAssistantWizardStart() {
  printCliRows('开通数字员工向导', [
    ['1', '填写数字员工名称和描述', 'info'],
    ['2', '绑定渠道', 'info'],
    ['3', '配置 lark-cli 个人授权（飞书/Lark）', 'info'],
    ['4', '返回团队 ID、绑定状态和下一步', 'info'],
  ], '按 Enter 开始；按 ← / Esc 取消。');
  return (await waitForContinue('按 Enter 开始创建数字员工 | ←/Esc 取消')) === 'continue';
}

async function pickAssistantAgentType() {
  const actionId = await askMenuAction({
    title: '开通数字员工 · 选择运行时',
    subtitle: '与外部端 Agent 类型选项保持一致',
    actions: assistantAgentTypeActions(),
    escapeAction: 'back',
    statusItems: currentMenuStatusItems(),
    hasDeveloperModeEnabled,
  });
  return actionId === 'back' ? null : actionId;
}

async function pickAssistantPlatform() {
  const actionId = await askMenuAction({
    title: '开通数字员工 · 选择绑定渠道',
    subtitle: '与外部端渠道绑定选项保持一致；飞书/Lark、微信走扫码绑定',
    actions: assistantPlatformActions(),
    escapeAction: 'back',
    statusItems: currentMenuStatusItems(),
    hasDeveloperModeEnabled,
  });
  if (actionId === 'back') return null;
  if (actionId !== 'wecom_im') return actionId;
  const wecomMode = await askMenuAction({
    title: '开通数字员工 · 企业微信接入方式',
    subtitle: '与外部端企业微信二级选项保持一致',
    actions: assistantWecomModeActions(),
    escapeAction: 'back',
    statusItems: currentMenuStatusItems(),
    hasDeveloperModeEnabled,
  });
  return wecomMode === 'back' ? null : wecomMode;
}

async function ensureFeishuDigitalWorkerPrerequisites(options = {}) {
  renderBusyScreen('开通数字员工', '正在用已绑定飞书应用准备 lark-cli 个人身份授权...');
  const renderAuthQr = async (url, authState, authInit) => {
    clearTerminalScrollback();
    const hasUser = Boolean(authState?.user);
    const title = hasUser ? '补充 lark-cli 个人权限' : '授权 lark-cli 使用本次飞书应用';
    console.log(ui.accent(ui.bold(title)));
    console.log('');
    const browser = await openExternalUrl(url).catch(() => ({ opened: false }));
    printCliRows(title, [
      ['应用来源', '本次渠道绑定的飞书应用', 'ok'],
      ['授权对象', '创建者个人飞书身份', 'info'],
      ...(authInit?.user_code ? [['验证码', authInit.user_code, 'ok']] : []),
      ['浏览器', browser.opened ? '已自动打开授权页面' : '未自动打开，请复制下方完整链接', browser.opened ? 'ok' : 'warn'],
    ], '请在浏览器完成授权；CLI 会在下方等待确认。');
    console.log('');
    console.log(ui.dim('完整授权链接：'));
    console.log(url);
    console.log('');
    let lastStatus = null;
    return (status) => {
      if (status === lastStatus) return;
      lastStatus = status;
      console.log(ui.dim(`等待 lark-cli 授权确认中... 当前状态：${status}`));
    };
  };
  const result = await ensureLarkCliDigitalWorkerAuth(renderAuthQr, options);
  if (!result.ok) {
    printCliRows('飞书个人身份未绑定', [
      ['lark-cli', result.installed?.message || result.message || '未就绪', result.installed?.ok ? 'ok' : 'error'],
      ['绑定对象', '创建数字员工的飞书个人身份', 'info'],
      ['授权范围', '飞书文档读写、消息读取/发送、通讯录和用户信息', 'info'],
      ['原因', result.message || '授权失败', 'error'],
      ...(result.detail ? [['详情', result.detail, 'warn']] : []),
    ], '请按 lark-cli 打开的页面或二维码完成个人身份授权后，再重新进入”开通数字员工”。');
    return null;
  }
  printCliRows('飞书个人身份已绑定', [
    ['lark-cli', result.installed?.message || '已安装', 'ok'],
    ['个人身份', result.message || '已完成', 'ok'],
    ['能力', '飞书文档读写、消息读取/发送、通讯录和用户信息', 'ok'],
  ], '接下来绑定飞书应用渠道。');
  return result;
}

async function collectAssistantManualOptions(meta) {
  const options = { ...(meta.defaultOptions || {}) };
  for (const field of meta.fields || []) {
    const advancedOptional = field.group === 'advanced' && !field.required;
    const label = [
      `${field.label}${field.required ? ' *' : advancedOptional ? '（可选，留空跳过）' : ''}`,
      field.placeholder ? `示例：${field.placeholder}` : '',
      field.hint ? `说明：${field.hint}` : '',
    ].filter(Boolean).join(' · ');
    let value;
    if (field.type === 'boolean') {
      value = await promptBoolean(label);
      if (value === null) continue;
    } else {
      value = await promptText(label);
      if (!value && field.required) throw new Error(`${field.label} 为必填项`);
      if (field.type === 'number' && value) value = Number(value);
    }
    if (value !== undefined && value !== '') options[field.key] = value;
  }
  return options;
}

async function runQuickCreateAssistantFlow() {
  if (!(await confirmAssistantWizardStart())) {
    printCliRows('开通数字员工', [['状态', '已取消', 'warn']], '未创建任何团队。');
    return;
  }

  const name = await promptText('数字员工名称');
  if (!name) {
    printCliRows('开通数字员工', [['状态', '已取消', 'warn']], '未创建任何团队。');
    return;
  }
  const description = await promptText('描述（可选）');
  const workDir = await promptText('工作目录', process.cwd());
  const agentType = await pickAssistantAgentType();
  if (!agentType) {
    printCliRows('开通数字员工', [['状态', '已取消', 'warn']], '未创建任何团队。');
    return;
  }
  const platform = await pickAssistantPlatform();
  if (!platform) {
    printCliRows('开通数字员工', [['状态', '已取消', 'warn']], '未创建任何团队。');
    return;
  }

  const bindProject = normalizeAssistantBindProject(name);
  let platformOptions = {};
  if (!isAssistantQrPlatform(platform)) {
    const meta = assistantPlatformMeta(platform);
    if (!meta) {
      printCliRows('开通数字员工失败', [['原因', `未找到 ${platform} 的渠道字段定义`, 'error']]);
      return;
    }
    printCliRows('手动绑定渠道', [
      ['渠道', meta.label || labelForAssistantPlatform(platform), 'info'],
      ['字段来源', '与外部端共享 assistantCreationOptions.json', 'ok'],
    ], '按提示填写该渠道凭据；高级可选字段可直接回车跳过。');
    platformOptions = await collectAssistantManualOptions(meta);
  }

  let lastQrStatus = null;
  const result = await provisionDigitalWorker(
    port,
    { name, bindProject, description, workDir, agentType, platform, platformOptions },
    {
      onStage(stage) {
        const messages = {
          server: '阶段 1/5：正在启动本地工作台 API...',
          team: '阶段 2/5：正在创建数字员工团队元数据...',
          runtime: '阶段 3/5：正在准备渠道连接...',
          binding: '阶段 4/5：正在绑定渠道...',
        };
        renderBusyScreen('开通数字员工', messages[stage] || '正在处理...');
      },
      onQrCode({ qrUrl }) {
        if (!qrUrl) return;
        clearTerminalScrollback();
        console.log(ui.accent(ui.bold('扫码绑定渠道')));
        console.log('');
        const rendered = renderTerminalQr(qrUrl);
        console.log('');
        printCliRows('扫码绑定渠道', [
          ['渠道', labelForAssistantPlatform(platform), 'info'],
          ['二维码', rendered ? '已显示在终端' : '当前终端无法渲染二维码，请复制链接扫码', rendered ? 'ok' : 'warn'],
          ['备用链接', qrUrl, 'info'],
        ], '请用手机扫码；CLI 会在下方等待确认。');
      },
      onQrStatus(status) {
        if (status === lastQrStatus) return;
        lastQrStatus = status;
        console.log(ui.dim(`等待手机确认中... 当前状态：${status}`));
      },
      async afterPlatformBound({ binding }) {
        if (platform !== 'feishu' && platform !== 'lark') return null;
        const auth = await ensureFeishuDigitalWorkerPrerequisites({
          profile: bindProject,
          appId: binding.appId,
          appSecret: binding.appSecret,
          brand: binding.platformType === 'lark' ? 'lark' : 'feishu',
        });
        return auth
          ? { ok: true, profile: auth.profile || bindProject, auth }
          : { ok: false, message: '飞书个人身份授权未完成' };
      },
    }
  );

  if (!result.ok) {
    printCliRows('开通数字员工失败', [
      ['数字员工名称', name, 'info'],
      ['项目标识', bindProject, 'info'],
      ['运行时', labelForAssistantAgentType(agentType), 'info'],
      ['渠道', labelForAssistantPlatform(platform), 'info'],
      ['阶段', result.failedStage || '准备参数', 'error'],
      ['原因', result.message, 'error'],
      ...(result.rollback?.attempted
        ? [[
            '未完成资源清理',
            result.rollback.ok ? result.rollback.message : `清理失败：${result.rollback.message}`,
            result.rollback.ok ? 'ok' : 'warn',
          ]]
        : []),
    ], '创建未完成；如已产生团队或渠道项目，系统已按上方结果执行完整回滚。');
    return;
  }

  const postBinding = result.binding?.postBinding;
  renderBusyScreen('开通数字员工', '阶段 5/5：正在汇总创建结果...');
  printCliRows('数字员工已创建', [
    ['数字员工名称', name, 'ok'],
    ['项目标识', bindProject, 'ok'],
    ['运行时', labelForAssistantAgentType(agentType), 'ok'],
    ['渠道', labelForAssistantPlatform(platform), 'ok'],
    assistantStageRow('创建团队', result.team, result.team?.message),
    ['绑定渠道', result.binding?.message || '已绑定', 'ok'],
    ...(postBinding?.profile ? [['lark-cli profile', postBinding.profile, 'ok']] : []),
    ['连接服务',
      result.binding?.restartHandled
        ? '已自动重启并接入新渠道'
        : result.binding?.restartRequired === false
          ? '配置已生效，无需额外重启'
          : '连接状态未确认',
      result.binding?.restartHandled || result.binding?.restartRequired === false ? 'ok' : 'warn'],
  ], '下一步：在已绑定的外部渠道里给这个数字员工发消息。');
}

async function runAccountAction() {
  while (true) {
    const renderState = menuRenderState();
    const actionId = await askMenuAction({
      title: '登录状态',
      subtitle: `本地使用无需登录；云端授权、托管服务或显式上传需要 ${BRAND.authAccountLabel}`,
      actions: ACCOUNT_ACTIONS,
      escapeAction: 'back',
      statusItems: renderState.statusItems,
      hasDeveloperModeEnabled,
      actionStateLabel: renderState.actionStateLabel,
    });
    if (actionId === 'back') return;
    if (actionId === 'guide') {
      printOnlineGuide();
      const continueAction = await waitForContinue('按 Enter/← 返回登录状态菜单 | Esc/Ctrl+C 退出');
      if (continueAction === 'back' || continueAction === 'cancel') return;
      continue;
    }
    if (actionId === 'quick-create-assistant') await runQuickCreateAssistantFlow();
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
    const renderState = menuRenderState();
    const actionId = await askMenuAction({
      title: '本地使用',
      subtitle: '无需登录 | 本机 Web、数字员工、本地采集和运行时',
      actions: LOCAL_USE_ACTIONS,
      escapeAction: 'back',
      statusItems: renderState.statusItems,
      hasDeveloperModeEnabled,
      actionStateLabel: renderState.actionStateLabel,
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
    const renderState = menuRenderState();
    const actionId = await askMenuAction({
      title: '团队协作',
      subtitle: auth.authorized ? '已登录 | 企业版协作配置已写入本机设置' : '未登录 | 企业版协作需登录授权',
      actions: TEAM_COLLAB_ACTIONS,
      escapeAction: 'back',
      statusItems: renderState.statusItems,
      hasDeveloperModeEnabled,
      actionStateLabel: renderState.actionStateLabel,
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
    const renderState = menuRenderState();
    const actionId = await askMenuAction({
      title: '数字员工',
      subtitle: '团队、任务与协作入口',
      actions: EMPLOYEE_ACTIONS,
      escapeAction: 'back',
      statusItems: renderState.statusItems,
      hasDeveloperModeEnabled,
      actionStateLabel: renderState.actionStateLabel,
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
    const renderState = menuRenderState();
    const actionId = await askMenuAction({
      title: '本地运行时',
      subtitle: 'Web / daemon / runtime 生命周期管理',
      actions: RUNTIME_ACTIONS,
      escapeAction: 'back',
      statusItems: renderState.statusItems,
      hasDeveloperModeEnabled,
      actionStateLabel: renderState.actionStateLabel,
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
  if (action.id === 'guide') {
    printOnlineGuide();
    console.log('');
    return waitForContinue(ACTION_DONE_MSG);
  }
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
  if (action.id === 'quick-create-assistant') { await runQuickCreateAssistantFlow(); console.log(''); return waitForContinue(ACTION_DONE_MSG); }
  if (action.id === 'aikey-claim') { await runTokenClaimFlow(); console.log(''); return waitForContinue(ACTION_DONE_MSG); }
  if (action.id === 'aikey-status') { await runAikeyStatus({ exitOnDone: false }); console.log(''); return waitForContinue(ACTION_DONE_MSG); }
  if (action.id === 'aikey-restore') { return runRestoreOriginalsFlow(); }
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

  // Keep the home status fresh after inline actions, but compute expensive feature
  // probes once per repaint. Windows process discovery is slow; expanding a
  // second-level menu must not call currentFeatureStates() once per rendered row.
  let repaintState = null;
  await askMenuAction({
    title: '',
    subtitle: '',
    actions: NAV_ACTIONS,
    escapeAction: 'exit',
    statusItems: () => {
      repaintState = menuRenderState();
      return repaintState.statusItems;
    },
    hasDeveloperModeEnabled,
    actionStateLabel: (action) => {
      repaintState ??= menuRenderState();
      return repaintState.actionStateLabel(action);
    },
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
