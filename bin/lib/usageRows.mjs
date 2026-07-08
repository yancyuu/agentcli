// usageRows.mjs — pure render helpers for usage report rows. Extracted from
// hermit.mjs so they are importable / unit-testable (hermit.mjs has import-time
// side effects and cannot be imported in tests).
//
// The display answers one question: 我本机有多少 / 服务端收到多少。
//   本地    — local jsonl message/token volume from the daemon.
//   服务端  — server `/report/usage` message/token ledger.
//   待上报  — cursor-derived upload backlog from telemetry.conversationUpload.pending.
//
// Do NOT derive 待上报 by subtracting server totals from local totals. That is a
// coarse ledger gap, not an upload backlog.
//
// Contract for `authoritative`:
//   undefined       =>  /report/usage not read this run (localOnly) → no 服务端 row.
//   { ok: false }   =>  fetch ran and really failed → 服务端 error row.
//   { ok: true }    =>  render 服务端 row.

export function formatNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function hasField(object, field) {
  return object && typeof object === 'object' && Object.prototype.hasOwnProperty.call(object, field);
}

function finiteNumber(value) {
  if (value === undefined || value === null || value === '') return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

export function cursorPendingRows(upload) {
  if (!upload || typeof upload !== 'object') return [];
  const lastError = typeof upload.lastError === 'string' ? upload.lastError.trim() : '';
  const hasPending = hasField(upload, 'pending') && upload.pending !== undefined && upload.pending !== null;
  const pending = hasPending ? Number(upload.pending) : NaN;
  if (lastError && (!hasPending || !Number.isFinite(pending) || pending <= 0)) {
    const message = /HTTP\s*(401|403)|授权不可用/u.test(lastError)
      ? '登录已过期，请重新登录'
      : `扫描失败：${lastError}`;
    return [['待上报', message, 'error']];
  }
  if (!hasPending || !Number.isFinite(pending)) return [];
  if (pending <= 0) return [['待上报', '无', 'info']];
  // Express the backlog in tokens — its real cost — when the scan reported
  // per-message usage. Falls back to a message count for channels / legacy
  // data that carry no usage, so the row never goes empty.
  const hasTok = hasField(upload, 'pendingTokens') && upload.pendingTokens !== undefined && upload.pendingTokens !== null;
  const pendingTokens = hasTok ? Number(upload.pendingTokens) : NaN;
  if (Number.isFinite(pendingTokens) && pendingTokens > 0) {
    return [['待上报', `Token ${formatNumber(pendingTokens)}`, 'warn']];
  }
  return [['待上报', `消息 ${formatNumber(pending)}`, 'warn']];
}

/**
 * 本地 / 服务端 comparison rows. Drops the noise (dedup / batches / inserted /
 * source-of-truth) — those aren't what "how much do I have vs how much did the
 * server receive" needs. Cursor backlog is rendered separately.
 */
export function localServerRows(telemetry, authoritative) {
  const rows = [];
  const local = telemetry && typeof telemetry === 'object' ? telemetry : {};
  const locMsg = hasField(local, 'messages') ? finiteNumber(local.messages) : NaN;
  const locTok = hasField(local, 'totalTokens') ? finiteNumber(local.totalTokens) : NaN;
  // 本地 — bounded to the last 24h when the worker ships recentMessages/
  // recentTokensTotal (the "只检索 24 小时内的" contract). Falls back to the
  // all-time tally under a plain 本地 label only for a stale pre-update status.
  const recentMsg = hasField(local, 'recentMessages') ? finiteNumber(local.recentMessages) : NaN;
  const recentTok = hasField(local, 'recentTokensTotal') ? finiteNumber(local.recentTokensTotal) : NaN;
  const useRecent = Number.isFinite(recentMsg) || Number.isFinite(recentTok);
  const localLabel = useRecent ? '本地（最近 7 天）' : '本地';
  const localMsg = useRecent ? recentMsg : locMsg;
  const localTok = useRecent ? recentTok : locTok;

  // Deliberately omit sessions: local JSONL files and server conversation
  // ledgers do not share one stable cardinality.
  const localParts = [];
  if (Number.isFinite(localMsg)) localParts.push(`消息 ${formatNumber(localMsg)}`);
  if (Number.isFinite(localTok)) localParts.push(`Token ${formatNumber(localTok)}`);
  if (localParts.length) rows.push([localLabel, localParts.join(' · '), 'info']);

  // 服务端 — what the server received. Omit entirely when /report/usage wasn't read.
  let srvMsg = NaN;
  let srvTok = NaN;
  if (authoritative && typeof authoritative === 'object') {
    if (authoritative.ok) {
      const totals = authoritative.totals && typeof authoritative.totals === 'object' ? authoritative.totals : {};
      const hasSrvMsg = hasField(totals, 'messages') || hasField(authoritative, 'messages');
      const hasSrvTok =
        hasField(totals, 'totalTokens') ||
        hasField(totals, 'tokens') ||
        hasField(authoritative, 'totalTokens') ||
        hasField(authoritative, 'tokensTotal');
      srvMsg = hasSrvMsg ? finiteNumber(totals.messages ?? authoritative.messages) : NaN;
      srvTok = hasSrvTok
        ? finiteNumber(totals.totalTokens ?? totals.tokens ?? authoritative.totalTokens ?? authoritative.tokensTotal)
        : NaN;
      const srvParts = [];
      if (Number.isFinite(srvMsg)) srvParts.push(`消息 ${formatNumber(srvMsg)}`);
      if (Number.isFinite(srvTok)) srvParts.push(`Token ${formatNumber(srvTok)}`);
      if (srvParts.length) rows.push(['服务端', srvParts.join(' · '), 'info']);
      const rejected = hasField(totals, 'rejected') || hasField(authoritative, 'rejected')
        ? finiteNumber(totals.rejected ?? authoritative.rejected)
        : NaN;
      if (Number.isFinite(rejected) && rejected > 0) rows.push(['服务端拒绝', formatNumber(rejected), 'error']);
    } else {
      const suffix = authoritative.httpStatus
        ? `HTTP ${authoritative.httpStatus}${authoritative.body ? ` · ${authoritative.body}` : ''}`
        : authoritative.error || '无响应';
      rows.push(['服务端', `读取 /report/usage 失败：${suffix}`, 'error']);
    }
  }

  return rows;
}

/**
 * True when the server response itself reports an auth failure (401/403) — from
 * either the /report/usage ledger or any /report/usage/status channel. When this
 * holds, the 服务端 / 服务端状态 / per-channel rows are noise; callers collapse
 * them into a single login-guidance row instead of dumping a wall of HTTP 401.
 *
 * Pure: operates only on the fetch-result shapes from usageRemote.mjs
 * (authoritativeUsage: {ok,httpStatus,error,body}; remoteUsage: {errors[]}).
 */
export function serverUsageUnauthorized(authoritativeUsage, remoteUsage) {
  if (authoritativeUsage?.httpStatus === 401 || authoritativeUsage?.httpStatus === 403) return true;
  const remoteErrors = Array.isArray(remoteUsage?.errors) ? remoteUsage.errors : [];
  if (remoteErrors.some((error) => error?.httpStatus === 401 || error?.httpStatus === 403)) return true;
  // Fallback: some transports surface the status only inside the error/body text.
  const texts = [
    authoritativeUsage?.error,
    authoritativeUsage?.body,
    ...remoteErrors.map((error) => `${error?.error || ''} ${error?.body || ''}`),
  ];
  return texts.some((text) => /HTTP\s*(401|403)/u.test(String(text || '')));
}
