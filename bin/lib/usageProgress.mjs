// usageProgress.mjs — pure computation for the upload progress bar.
//
// Two pure functions, both unit-tested (no filesystem, no hermit.mjs import):
//   aggregateUploadProgress(events) — turns the raw log-event tail into one
//     aggregated per-channel snapshot (discovered/uploaded/total/...).
//   uploadProgressLabel(snapshot)   — renders that snapshot into a single line.
//
// Why aggregate per channel: upload runs N channels concurrently
// (claudecode/codex × plain/im), each writing its own scan-collected /
// upload-batch-* events to the same log. Taking a single global "latest" of each
// event type made an empty channel's scan overwrite the real total ("发现 0 条")
// and made latestScan/latestBatch come from different channels so the label
// flipped between scan and batch views ("一直跳"). Grouping by platform:mode and
// summing per-channel latests yields one stable global total.
import { formatNumber } from './usageRows.mjs';
import { ui } from './terminal.mjs';

const BATCH_EVENT_MESSAGES = new Set([
  'upload-batch-start',
  'upload-batch-finished',
  'upload-status-polled',
  'upload-status-timeout',
]);
const FAILURE_EVENT_MESSAGES = new Set([
  'upload-batch-failed',
  'upload-failed',
  'upload-status-timeout',
]);

export function progressBar(percent, width = 18) {
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  const filled = Math.round((safePercent / 100) * width);
  const empty = Math.max(0, width - filled);
  return `${ui.accent('█'.repeat(filled))}${ui.dim('░'.repeat(empty))}`;
}

function channelKey(event) {
  const platform = event?.platform;
  const mode = event?.mode;
  if (!platform) return null;
  return mode ? `${platform}:${mode}` : String(platform);
}

/**
 * Aggregate a log-event tail into one global progress snapshot. Pure: callers
 * pass the events (already filtered to this run); this never reads files.
 *
 * Channels are grouped by `${platform}:${mode}`; within each channel the latest
 * scan-collected and latest batch event win, then per-channel numbers are summed.
 */
export function aggregateUploadProgress(events = []) {
  const channels = new Map();
  let latestFailure = null;
  for (const event of events) {
    if (FAILURE_EVENT_MESSAGES.has(event.message)) latestFailure = event;
    const key = channelKey(event);
    if (!key) continue;
    const channel = channels.get(key) ?? { scan: null, batch: null, progress: null };
    if (event.message === 'scan-collected') channel.scan = event;
    if (event.message === 'scan-progress') channel.progress = event;
    if (BATCH_EVENT_MESSAGES.has(event.message)) channel.batch = event;
    channels.set(key, channel);
  }

  let discovered = 0;
  let uploaded = 0;
  let total = 0;
  let activeBatch = null;
  let activeBatchChannels = 0;
  let hasBatch = false;
  let scanFiles = 0;
  for (const { scan, batch: batchEvent, progress } of channels.values()) {
    const channelDiscovered = Number(scan?.totalDiscovered ?? progress?.messagesCollected ?? 0);
    discovered += channelDiscovered;
    scanFiles += Number(progress?.filesScanned ?? 0);
    if (batchEvent) {
      hasBatch = true;
      total += Number(batchEvent.totalMessages ?? channelDiscovered ?? 0);
      activeBatch = batchEvent;
      activeBatchChannels += 1;
      // Count only confirmed uploads: a batch-start's uploadedAfterBatch is the
      // prior total (not yet advanced), so use uploadedBeforeBatch for starts and
      // uploadedAfterBatch for finished/polled events.
      const after = Number(batchEvent.uploadedAfterBatch ?? -1);
      const before = Number(batchEvent.uploadedBeforeBatch ?? 0);
      uploaded += batchEvent.message === 'upload-batch-start' || after < 0 ? before : after;
    } else {
      total += channelDiscovered;
    }
  }

  // A run is "failed" only if it delivered nothing. A transient batch failure,
  // a single failing channel, or a post-upload status-timeout that follows
  // successful 202s must NOT flip the bar to 失败 ("显示失败但其实已上报成功了") —
  // if any messages were accepted, the run partially or fully succeeded.
  // Per-channel misses stay visible in the channel breakdown and the 待上报
  // backlog; the global label reserves 失败 for a true total failure.
  const failed = Boolean(latestFailure) && uploaded === 0;
  return {
    discovered,
    uploaded,
    total,
    batchIndex: activeBatchChannels === 1 ? Number(activeBatch?.batchIndex ?? 0) : 0,
    totalBatches: activeBatchChannels === 1 ? Number(activeBatch?.totalBatches ?? 0) : 0,
    showBatch: activeBatchChannels === 1,
    scanFiles,
    hasBatch,
    failed,
    failureMessage: latestFailure?.lastError ?? null,
  };
}

/**
 * Monotonic accumulator for finished batches across render frames. The upload
 * log is read as a TAIL (.slice(-limit)); scan + batch events flood it, so a
 * finished batch scrolls out of the window fast. Summing finished events over
 * the window is non-monotonic — "已上传 300 条 · 3 批" dropped to "200 · 2 批"
 * as the oldest batch scrolled out, and a window momentarily holding no
 * finished event reset the bar to "上传启动中". Keying by platform:mode:batchIndex
 * means a finished batch counts forever once seen, so both counts only grow.
 * Call every render frame with the latest tail events and the prior `seen` map.
 */
export function foldFinishedBatches(events = [], prior = new Map()) {
  for (const event of events) {
    if (event?.message !== 'upload-batch-finished') continue;
    const key = `${event.platform ?? ''}:${event.mode ?? ''}:${event.batchIndex ?? ''}`;
    if (key && !prior.has(key)) prior.set(key, Number(event.attempted ?? 0));
  }
  let runUploaded = 0;
  for (const value of prior.values()) runUploaded += value;
  return { completedBatches: prior.size, runUploaded, seen: prior };
}

/**
 * Render the aggregated snapshot as one stable progress line. Always uses the
 * same `消息 done/total` shape (never flips between a scan view and a batch
 * view), so concurrent out-of-phase channels no longer make the text jump.
 */
export function uploadProgressLabel(snapshot = {}, { barWidth = 18 } = {}) {
  const discovered = Number(snapshot.discovered ?? 0);
  const uploaded = Number(snapshot.uploaded ?? 0);
  const total = Number(snapshot.total ?? 0);
  const hasBatch = Boolean(snapshot.hasBatch);
  const failed = Boolean(snapshot.failed);

  const showBatch = Boolean(snapshot.showBatch);

  const scanFiles = Number(snapshot.scanFiles ?? 0);

  const denom = total || discovered;
  const percent = denom > 0 ? Math.min(100, Math.round((uploaded / denom) * 100)) : 0;
  const state = failed
    ? '失败'
    : hasBatch
      ? percent >= 100
        ? '完成'
        : '上报中'
      : discovered > 0
        ? '扫描中'
        : '等待扫描';
  if (!hasBatch && discovered <= 0) {
    const scanned = scanFiles > 0 ? ` · 文件 ${formatNumber(scanFiles)}` : '';
    return `${progressBar(0, barWidth)} · ${state}${scanned}`;
  }
  const batchPart = hasBatch && showBatch
    ? ` · 批次 ${formatNumber(Number(snapshot.batchIndex ?? 0))}/${formatNumber(Number(snapshot.totalBatches ?? 0))}`
    : !hasBatch && scanFiles > 0
      ? ` · 文件 ${formatNumber(scanFiles)}`
      : '';
  return `${progressBar(percent, barWidth)} ${percent}% · 消息 ${formatNumber(uploaded)}/${formatNumber(denom)}${batchPart} · ${state}`;
}

/**
 * Full-rescan progress label: absolute counts + throughput + elapsed.
 *
 * A full rescan is a rolling window — the target total is only discovered as
 * the scan proceeds, so a percent is mathematically undefined: numerator and
 * denominator both move, with the denominator always one pending ahead, so a
 * percent either jumps 0%→99% on the first batch or stalls at 98-99% forever.
 * Monotonic absolute progress is honest, so the full-rescan bar uses it.
 * `elapsedSec` and the spinner are the caller's responsibility (it owns the
 * timer); this stays a pure function.
 */
export function absoluteProgressLabel(snapshot = {}, { elapsedSec = 0 } = {}) {
  // Prefer runUploaded (this run's monotonic delta from 0) over the cumulative
  // snapshot.uploaded — the latter is anchored to history and never reaches the
  // (equally cumulative) total, so the percent stalled at 98-99% forever.
  const uploaded = Number(snapshot.runUploaded ?? snapshot.uploaded ?? 0);
  const completedBatches = Number(snapshot.completedBatches ?? 0);
  const seconds = Math.max(0, Math.floor(Number(elapsedSec || 0)));
  // Before the first batch finishes there's nothing to average a rate over:
  // scanning (no batch yet) or the first batch in flight. Show a phase label so
  // the bar never reads the meaningless "已上传 0 条 · 0 批" (looks stuck) during
  // these few seconds.
  if (completedBatches <= 0) {
    const files = Number(snapshot.scanFiles ?? 0);
    const filesPart = !snapshot.hasBatch && files > 0 ? ` · 已扫 ${formatNumber(files)} 文件` : '';
    const phase = snapshot.hasBatch ? '上传启动中' : '扫描中';
    return `${phase}${filesPart} · 已用时 ${seconds}s`;
  }
  const rate = seconds > 0 ? Math.round(uploaded / seconds) : 0;
  return `已上传 ${formatNumber(uploaded)} 条 · ${formatNumber(completedBatches)} 批 · ${formatNumber(rate)}条/秒 · 已用时 ${seconds}s`;
}
