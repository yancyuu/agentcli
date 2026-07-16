const DEFAULT_POLL_TIMEOUT_MS = 5 * 60 * 1000;

function unwrapApiResponse(payload) {
  if (payload && typeof payload === 'object' && 'data' in payload) return payload.data;
  return payload;
}

export async function postLocalJson(port, pathname, body, { method = 'POST', timeoutMs = 15_000 } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  const payload = text.trim() ? JSON.parse(text) : {};
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return unwrapApiResponse(payload);
}

export async function createAssistantTeamViaApi(port, { name, bindProject, description, workDir, agentType }) {
  await postLocalJson(port, '/api/teams/create', {
    teamName: bindProject,
    bindProject,
    displayName: name,
    description: description || undefined,
    cwd: workDir,
    workDir,
    harness: agentType,
    members: [],
    platform: 'bridge',
    platformOptions: {},
  }, { timeoutMs: 120_000 });
  return { ok: true, teamSlug: bindProject, message: '团队已创建' };
}

export async function deleteAssistantTeamViaApi(port, teamSlug) {
  return postLocalJson(
    port,
    `/api/teams/${encodeURIComponent(teamSlug)}?deleteFiles=true`,
    undefined,
    { method: 'DELETE', timeoutMs: 120_000 }
  );
}

export async function deleteAssistantTeamPermanentlyViaApi(port, teamSlug) {
  return postLocalJson(
    port,
    `/api/teams/${encodeURIComponent(teamSlug)}/permanent?strictExternal=true`,
    undefined,
    { method: 'DELETE', timeoutMs: 120_000 }
  );
}

export async function bindManualAssistantPlatform(port, { project, platform, options, workDir, agentType }) {
  return postLocalJson(
    port,
    `/api/projects/${encodeURIComponent(project)}/add-platform`,
    { type: platform, options, work_dir: workDir, agent_type: agentType },
    { timeoutMs: 120_000 }
  );
}

export async function beginQrAssistantPlatform(port, platform) {
  if (platform === 'weixin') {
    return postLocalJson(port, '/api/setup/weixin/begin', {});
  }
  return postLocalJson(port, '/api/setup/feishu/begin', {});
}

export async function pollQrAssistantPlatform(port, platform, state) {
  if (platform === 'weixin') {
    return postLocalJson(port, '/api/setup/weixin/poll', { qr_key: state.qrKey, api_url: state.apiUrl });
  }
  return postLocalJson(port, '/api/setup/feishu/poll', {
    device_code: state.deviceCode,
    base_url: state.baseUrl,
  });
}

export async function saveQrAssistantPlatform(port, platform, { project, workDir, agentType, pollResult }) {
  if (platform === 'weixin') {
    return postLocalJson(port, '/api/setup/weixin/save', {
      project,
      token: pollResult.bot_token,
      base_url: pollResult.base_url,
      ilink_bot_id: pollResult.ilink_bot_id,
      ilink_user_id: pollResult.ilink_user_id,
      work_dir: workDir,
      agent_type: agentType,
    });
  }
  return postLocalJson(port, '/api/setup/feishu/save', {
    project,
    app_id: pollResult.app_id,
    app_secret: pollResult.app_secret,
    platform_type: pollResult.platform || platform,
    owner_open_id: pollResult.owner_open_id,
    work_dir: workDir,
    agent_type: agentType,
  });
}

export async function waitForQrAssistantBinding(port, platform, beginResult, onStatus, timeoutMs = DEFAULT_POLL_TIMEOUT_MS) {
  const startedAt = Date.now();
  const state = platform === 'weixin'
    ? { qrKey: beginResult.qr_key, apiUrl: beginResult.api_url }
    : { deviceCode: beginResult.device_code, baseUrl: beginResult.base_url, interval: beginResult.interval || 5 };

  while (Date.now() - startedAt < timeoutMs) {
    let result;
    try {
      result = await pollQrAssistantPlatform(port, platform, state);
    } catch (err) {
      // A single slow/hung poll must NOT abort the whole binding. The local
      // workbench keeps processing (the web dashboard still shows success) even
      // when one fetch is aborted by its 15s timeout or a transient network blip.
      // Retry until the total deadline; only the definitive statuses handled
      // below (expired/denied/error) are fatal.
      onStatus?.("pending");
      await new Promise((resolve) => setTimeout(resolve, (state.interval || 5) * 1000));
      continue;
    }
    if (result.base_url) state.baseUrl = result.base_url;
    if (result.slow_down) state.interval = (state.interval || 5) + 5;
    onStatus?.(result.status || 'pending');

    if (platform === 'weixin') {
      if (result.status === 'confirmed') return result;
      if (result.status === 'expired') throw new Error('二维码已过期');
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }

    if (result.status === 'completed') return result;
    if (result.status === 'denied') throw new Error('扫码授权被拒绝');
    if (result.status === 'expired') throw new Error('二维码已过期');
    if (result.status === 'error') throw new Error(result.error || '扫码绑定失败');
    await new Promise((resolve) => setTimeout(resolve, (state.interval || 5) * 1000));
  }
  throw new Error('等待扫码绑定超时');
}
