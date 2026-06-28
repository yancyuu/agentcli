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
  return platform && mode ? `${platform}:${mode}` : null;
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
  let latestEventTs = -Infinity;
  for (const event of events) {
    if (!event?.timestamp) continue;
    const ts = Date.parse(event.timestamp);
    if (Number.isFinite(ts) && ts > latestEventTs) latestEventTs = ts;
    if (FAILURE_EVENT_MESSAGES.has(event.message)) latestFailure = event;
    const key = channelKey(event);
    if (!key) continue;
    const channel = channels.get(key) ?? { scan: null, batch: null };
    if (event.message === 'scan-collected') channel.scan = event;
    if (BATCH_EVENT_MESSAGES.has(event.message)) channel.batch = event;
    channels.set(key, channel);
  }

  let discovered = 0;
  let uploaded = 0;
  let total = 0;
  let batchIndex = 0;
  let totalBatches = 0;
  let hasBatch = false;
  for (const { scan, batch: batchEvent } of channels.values()) {
    const channelDiscovered = Number(scan?.totalDiscovered ?? 0);
    discovered += channelDiscovered;
    if (batchEvent) {
      hasBatch = true;
      total += Number(batchEvent.totalMessages ?? channelDiscovered ?? 0);
      batchIndex += Number(batchEvent.batchIndex ?? 0);
      totalBatches += Number(batchEvent.totalBatches ?? 0);
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

  const failureTs = Number.isFinite(Date.parse(latestFailure?.timestamp || ''))
    ? Date.parse(latestFailure.timestamp)
    : -Infinity;
  const failed = Boolean(latestFailure) && failureTs >= latestEventTs;
  return {
    discovered,
    uploaded,
    total,
    batchIndex,
    totalBatches,
    hasBatch,
    failed,
    failureMessage: latestFailure?.lastError ?? null,
  };
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
  const batchPart = hasBatch
    ? ` · 批次 ${formatNumber(Number(snapshot.batchIndex ?? 0))}/${formatNumber(Number(snapshot.totalBatches ?? 0))}`
    : '';
  return `${progressBar(percent, barWidth)} ${percent}% · 消息 ${formatNumber(uploaded)}/${formatNumber(denom)}${batchPart} · ${state}`;
}
