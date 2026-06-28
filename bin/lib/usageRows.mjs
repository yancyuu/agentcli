// usageRows.mjs — pure render helpers for the usage report's 本地 vs 服务端 vs 待上报
// comparison. Extracted from hermit.mjs so they are importable / unit-testable
// (hermit.mjs has import-time side effects and cannot be imported in tests).
//
// The display answers one question: 我发了多少 / 别人收了多少 / 还差多少。
//   本地    — local jsonl volume (sessions / messages / tokens) from the daemon.
//   服务端  — server `/report/usage` ledger (messages / tokens the server received).
//   待上报  — 本地 − 服务端, clamped ≥ 0 (the gap still to upload).
//
// Contract for `authoritative`:
//   undefined       =>  /report/usage not read this run (localOnly) → no 服务端 row, no 待上报.
//   { ok: false }   =>  fetch ran and really failed → 服务端 error row.
//   { ok: true }    =>  render 服务端 + compute 待上报.

export function formatNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function finitePositive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

/**
 * 本地 / 服务端 / 待上报 comparison rows. Drops the noise (dedup / batches /
 * inserted / source-of-truth) — those aren't what "how much did I send vs how
 * much did they receive" needs.
 */
export function localServerRows(telemetry, authoritative) {
  const rows = [];
  const local = telemetry && typeof telemetry === 'object' ? telemetry : {};
  const locSess = finitePositive(local.sessions);
  const locMsg = finitePositive(local.messages);
  const locTok = finitePositive(local.totalTokens);

  // 本地 — what I have on this machine.
  const localParts = [];
  if (Number.isFinite(locSess)) localParts.push(`会话 ${formatNumber(locSess)}`);
  if (Number.isFinite(locMsg)) localParts.push(`消息 ${formatNumber(locMsg)}`);
  if (Number.isFinite(locTok)) localParts.push(`Token ${formatNumber(locTok)}`);
  if (localParts.length) rows.push(['本地', localParts.join(' · '), 'info']);

  // 服务端 — what the server received. Omit entirely when /report/usage wasn't read.
  let srvMsg = NaN;
  let srvTok = NaN;
  if (authoritative && typeof authoritative === 'object') {
    if (authoritative.ok) {
      const totals = authoritative.totals && typeof authoritative.totals === 'object' ? authoritative.totals : {};
      srvMsg = Number(totals.messages ?? authoritative.messages);
      srvTok = Number(totals.totalTokens ?? totals.tokens ?? authoritative.totalTokens ?? authoritative.tokensTotal);
      const srvParts = [];
      if (Number.isFinite(srvMsg) && srvMsg > 0) srvParts.push(`消息 ${formatNumber(srvMsg)}`);
      if (Number.isFinite(srvTok) && srvTok > 0) srvParts.push(`Token ${formatNumber(srvTok)}`);
      if (srvParts.length) rows.push(['服务端', srvParts.join(' · '), 'info']);
      const rejected = Number(totals.rejected ?? authoritative.rejected);
      if (Number.isFinite(rejected) && rejected > 0) rows.push(['服务端拒绝', formatNumber(rejected), 'error']);
    } else {
      const suffix = authoritative.httpStatus
        ? `HTTP ${authoritative.httpStatus}${authoritative.body ? ` · ${authoritative.body}` : ''}`
        : authoritative.error || '无响应';
      rows.push(['服务端', `读取 /report/usage 失败：${suffix}`, 'error']);
    }
  }

  // 待上报 — the gap. Only rendered when something is actually outstanding.
  const pendingMsg = Number.isFinite(locMsg) && Number.isFinite(srvMsg) ? Math.max(0, locMsg - srvMsg) : NaN;
  const pendingTok = Number.isFinite(locTok) && Number.isFinite(srvTok) ? Math.max(0, locTok - srvTok) : NaN;
  const pendingParts = [];
  if (Number.isFinite(pendingMsg) && pendingMsg > 0) pendingParts.push(`消息 ${formatNumber(pendingMsg)}`);
  if (Number.isFinite(pendingTok) && pendingTok > 0) pendingParts.push(`Token ${formatNumber(pendingTok)}`);
  if (pendingParts.length) rows.push(['待上报', pendingParts.join(' · '), 'warn']);

  return rows;
}
