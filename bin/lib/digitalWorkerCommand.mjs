import { waitForOpenHermitServerReady } from './daemon.mjs';
import {
  assistantPlatformMeta,
  isAssistantQrPlatform,
  isSupportedAssistantAgentType,
  isSupportedAssistantPlatform,
  labelForAssistantAgentType,
  labelForAssistantPlatform,
  mergeAssistantPlatformOptions,
  missingRequiredAssistantFields,
  normalizeAssistantBindProject,
} from './assistantCreationOptions.mjs';
import {
  beginQrAssistantPlatform,
  bindManualAssistantPlatform,
  createAssistantTeamViaApi,
  deleteAssistantTeamPermanentlyViaApi,
  saveQrAssistantPlatform,
  waitForQrAssistantBinding,
} from './assistantBinding.mjs';
import { ensureCcConnectRuntime } from './feishuAssistant.mjs';

function parsePlatformOptions(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function ensureDigitalWorkerLocalServer() {
  // Creating a digital worker is available only from an already-running AgentCli
  // workbench. `waitForOpenHermitServerReady` probes /api/version, which is the
  // canonical readiness signal — it rejects a dead daemon, a merely bound port,
  // and a server still booting. Do NOT auto-start here: an explicit workbench
  // launch gives the user a visible, working control plane before we create any
  // team, channel, or personal authorization state.
  const existing = await waitForOpenHermitServerReady(null, 3_000);
  if (existing.ready) return existing;
  throw new Error(
    'AgentCli 工作台未启动或尚未就绪：请先运行 agentcli web 或在菜单中开启 AgentCli 工作台，再创建数字员工。'
  );
}

const defaultDependencies = {
  ensureLocalServer: ensureDigitalWorkerLocalServer,
  createTeam: createAssistantTeamViaApi,
  ensureRuntime: (port) => ensureCcConnectRuntime(port),
  beginQr: beginQrAssistantPlatform,
  waitForQr: waitForQrAssistantBinding,
  saveQr: saveQrAssistantPlatform,
  bindManual: bindManualAssistantPlatform,
  rollback: deleteAssistantTeamPermanentlyViaApi,
};

function normalizedRequest(options) {
  const name = String(options.name || '').trim();
  if (!name) return { ok: false, message: '缺少数字员工名称：--name <名称>' };

  const platform = String(options.platform || 'feishu').trim();
  const agentType = String(options.agentType || 'claudecode').trim();
  const workDir = String(options.workDir || process.cwd()).trim() || process.cwd();
  const bindProject = normalizeAssistantBindProject(options.bindProject || name);

  // Digital-worker claim/create only supports Claude Code / Codex on Feishu.
  // Reject anything else before any platform lookup or provisioning side effect.
  if (!isSupportedAssistantAgentType(agentType)) {
    return { ok: false, message: `不支持的运行时：${agentType}（仅支持 claudecode / codex）` };
  }
  if (!isSupportedAssistantPlatform(platform)) {
    return { ok: false, message: `不支持的渠道：${platform}（仅支持 feishu）` };
  }

  let platformMeta = null;
  let platformOptions = {};

  if (!isAssistantQrPlatform(platform)) {
    platformMeta = assistantPlatformMeta(platform);
    if (!platformMeta) return { ok: false, message: `未找到 ${platform} 的渠道字段定义` };
    platformOptions = mergeAssistantPlatformOptions(platformMeta, options.platformOptions);
    const missing = missingRequiredAssistantFields(platformMeta, platformOptions);
    if (missing.length > 0) {
      return { ok: false, message: `缺少渠道必填字段：${missing.join(', ')}`, requiredFields: missing };
    }
  }

  return {
    ok: true,
    name,
    bindProject,
    description: options.description || '',
    workDir,
    agentType,
    platform,
    platformMeta,
    platformOptions,
  };
}

async function rollbackProvisionedTeam(dependencies, port, teamSlug) {
  try {
    await dependencies.rollback(port, teamSlug);
    return { attempted: true, ok: true, message: '已自动清理未完成的数字员工' };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildDigitalWorkerCommandOptions(args, findArg) {
  const platformOptions = parsePlatformOptions(findArg(args, '--platform-options'));
  if (platformOptions === null) {
    return { ok: false, message: '--platform-options 必须是 JSON 对象' };
  }
  return {
    ok: true,
    name: findArg(args, '--name'),
    description: findArg(args, '--description') || '',
    bindProject: findArg(args, '--bind-project'),
    workDir: findArg(args, '--work-dir') || process.cwd(),
    agentType: findArg(args, '--agent-type') || findArg(args, '--harness') || 'claudecode',
    platform: findArg(args, '--platform') || 'feishu',
    platformOptions,
  };
}

export async function provisionDigitalWorker(port, options, hooks = {}, dependencies = defaultDependencies) {
  const request = normalizedRequest(options);
  if (!request.ok) return { ...request, rollback: { attempted: false } };

  let failedStage = '启动本地工作台 API';
  let team = null;
  try {
    hooks.onStage?.('server', request);
    await dependencies.ensureLocalServer(port);

    failedStage = '创建数字员工团队';
    hooks.onStage?.('team', request);
    team = await dependencies.createTeam(port, request);

    failedStage = '启动渠道连接服务';
    hooks.onStage?.('runtime', request);
    const runtime = await dependencies.ensureRuntime(port);
    if (!runtime?.ok) throw new Error(runtime?.message || '渠道连接服务不可用');

    failedStage = '绑定渠道';
    hooks.onStage?.('binding', request);
    let binding;
    if (isAssistantQrPlatform(request.platform)) {
      const begin = await dependencies.beginQr(port, request.platform);
      await hooks.onQrCode?.({ platform: request.platform, qrUrl: begin.qr_url, beginResult: begin });
      const pollResult = await dependencies.waitForQr(
        port,
        request.platform,
        begin,
        hooks.onQrStatus
      );
      const saved = await dependencies.saveQr(port, request.platform, {
        project: request.bindProject,
        workDir: request.workDir,
        agentType: request.agentType,
        pollResult,
      });
      binding = {
        ...saved,
        appId: pollResult.app_id,
        appSecret: pollResult.app_secret,
        platformType: pollResult.platform || request.platform,
        restartRequired: saved?.restart_required === true,
        restartHandled: saved?.restart_handled === true,
      };
    } else {
      const saved = await dependencies.bindManual(port, {
        project: request.bindProject,
        platform: request.platformMeta.submitType || request.platform,
        options: request.platformOptions,
        workDir: request.workDir,
        agentType: request.agentType,
      });
      binding = {
        ...saved,
        restartRequired: saved?.restart_required === true,
        restartHandled: saved?.restart_handled === true,
      };
    }

    failedStage = '完成渠道授权';
    const postBinding = await hooks.afterPlatformBound?.({ ...request, team, binding });
    if (postBinding?.ok === false) throw new Error(postBinding.message || '渠道授权未完成');

    return {
      ok: true,
      status: 'bound',
      message: binding?.message || '数字员工已创建并绑定渠道',
      ...request,
      agentTypeLabel: labelForAssistantAgentType(request.agentType),
      platformLabel: labelForAssistantPlatform(request.platform),
      teamSlug: team?.teamSlug || request.bindProject,
      team,
      binding: postBinding ? { ...binding, postBinding } : binding,
      rollback: { attempted: false },
    };
  } catch (error) {
    const rollback = team
      ? await rollbackProvisionedTeam(dependencies, port, request.bindProject)
      : { attempted: false };
    return {
      ...request,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      failedStage,
      team,
      rollback,
      cleanup: rollback,
    };
  }
}

export async function createDigitalWorkerCommand(port, options, hooks = {}) {
  return provisionDigitalWorker(port, options, hooks);
}
