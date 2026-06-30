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
    return [['待上报', `扫描失败：${lastError}`, 'error']];
  }
  if (!hasPending || !Number.isFinite(pending)) return [];
  if (pending <= 0) return [['待上报', '无', 'info']];
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

  // 本地 — what I have on this machine. Deliberately omit sessions: local JSONL
  // files and server conversation ledgers do not share one stable cardinality.
  const localParts = [];
  if (Number.isFinite(locMsg)) localParts.push(`消息 ${formatNumber(locMsg)}`);
  if (Number.isFinite(locTok)) localParts.push(`Token ${formatNumber(locTok)}`);
  if (localParts.length) rows.push(['本地', localParts.join(' · '), 'info']);

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
