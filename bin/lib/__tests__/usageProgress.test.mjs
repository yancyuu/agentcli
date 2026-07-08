import { describe, expect, it } from 'vitest';

import { absoluteProgressLabel, aggregateUploadProgress, foldFinishedBatches, uploadProgressLabel } from '../usageProgress.mjs';

// Helpers: minimal log-event shapes (only the fields the aggregator reads).
const ts = (seconds) => `2026-06-27T00:00:${String(seconds).padStart(2, '0')}.000Z`;
const scan = (seconds, platform, mode, totalDiscovered, pending = totalDiscovered) => ({
  timestamp: ts(seconds),
  message: 'scan-collected',
  platform,
  mode,
  totalDiscovered,
  pending,
});
const batch = (seconds, platform, mode, extra = {}) => ({
  timestamp: ts(seconds),
  message: 'upload-batch-finished',
  platform,
  mode,
  batchIndex: 1,
  totalBatches: 1,
  totalMessages: 0,
  uploadedBeforeBatch: 0,
  uploadedAfterBatch: 0,
  ...extra,
});
const progress = (seconds, platform, filesScanned, messagesCollected, mode) => ({
  timestamp: ts(seconds),
  message: 'scan-progress',
  platform,
  mode,
  filesScanned,
  messagesCollected,
});
const failure = (seconds, platform, mode, lastError) => ({
  timestamp: ts(seconds),
  message: 'upload-batch-failed',
  platform,
  mode,
  lastError,
});

describe('aggregateUploadProgress', () => {
  it('returns zeros for an empty event stream', () => {
    expect(aggregateUploadProgress([])).toMatchObject({
      discovered: 0,
      uploaded: 0,
      total: 0,
      hasBatch: false,
      failed: false,
    });
  });

  it('sums discovered across channels so an empty channel does NOT zero the total', () => {
    // Regression: the old single-"latest" reader let codex/plain's empty scan
    // (totalDiscovered 0, emitted last) overwrite claudecode's real 500, so the
    // bar read "发现 0 条". Per-channel aggregation must sum to 500.
    const events = [
      scan(0, 'claudecode', 'plain', 500),
      scan(1, 'codex', 'plain', 0),
    ];
    expect(aggregateUploadProgress(events).discovered).toBe(500);
  });

  it('shows scan-progress before scan-collected so long full scans do not look stuck', () => {
    const snap = aggregateUploadProgress([
      progress(0, 'claudecode', 3, 120),
      progress(1, 'codex', 2, 30),
    ]);

    expect(snap.discovered).toBe(150);
    expect(snap.scanFiles).toBe(5);
    expect(snap.hasBatch).toBe(false);
  });

  it('keeps a stable global total when channels are out of phase (no scan/batch flip)', () => {
    // claudecode/plain is already uploading while claudecode/im's empty scan
    // lands last. The aggregated total stays the uploader's, not the empty scan's.
    const events = [
      scan(0, 'claudecode', 'plain', 500),
      scan(1, 'claudecode', 'im', 0),
      batch(2, 'claudecode', 'plain', {
        totalMessages: 500,
        uploadedBeforeBatch: 0,
        uploadedAfterBatch: 50,
      }),
    ];
    const snap = aggregateUploadProgress(events);
    expect(snap.discovered).toBe(500);
    expect(snap.total).toBe(500);
    expect(snap.uploaded).toBe(50);
    expect(snap.hasBatch).toBe(true);
    expect(snap.showBatch).toBe(true);
  });

  it('counts uploaded from upload-batch-finished (not from upload-batch-start)', () => {
    const events = [
      scan(0, 'claudecode', 'plain', 100),
      batch(1, 'claudecode', 'plain', {
        message: 'upload-batch-start',
        totalMessages: 100,
        uploadedBeforeBatch: 40,
        uploadedAfterBatch: 40,
      }),
    ];
    // start must not count as confirmed — only the prior total (40) is done.
    expect(aggregateUploadProgress(events).uploaded).toBe(40);
  });

  it('does not show a fake summed batch when multiple channels upload concurrently', () => {
    const snap = aggregateUploadProgress([
      batch(0, 'claudecode', 'plain', { totalMessages: 100, batchIndex: 2, totalBatches: 10, uploadedAfterBatch: 20 }),
      batch(1, 'codex', 'plain', { totalMessages: 50, batchIndex: 1, totalBatches: 5, uploadedAfterBatch: 10 }),
    ]);
    const label = uploadProgressLabel(snap);

    expect(snap.hasBatch).toBe(true);
    expect(snap.showBatch).toBe(false);
    expect(label).toContain('上报中');
    expect(label).not.toContain('批次 3/15');
    expect(label).not.toContain('批次');
  });

  it('falls back to batch.totalMessages when a channel scan scrolled out of the log tail', () => {
    const events = [
      batch(0, 'claudecode', 'plain', {
        totalMessages: 300,
        uploadedBeforeBatch: 0,
        uploadedAfterBatch: 300,
      }),
    ];
    const snap = aggregateUploadProgress(events);
    expect(snap.total).toBe(300);
    expect(snap.uploaded).toBe(300);
  });

  it('marks failed only when nothing was uploaded — a late failure must not cry wolf', () => {
    // Total failure: a failure with zero uploaded ⇒ failed.
    const totalFail = [
      scan(0, 'claudecode', 'plain', 10),
      failure(1, 'claudecode', 'plain', 'boom'),
    ];
    expect(aggregateUploadProgress(totalFail).failed).toBe(true);
    expect(aggregateUploadProgress(totalFail).failureMessage).toBe('boom');

    // Recovery: a later successful batch clears failed (uploaded > 0).
    const recovered = [
      failure(0, 'claudecode', 'plain', 'boom'),
      batch(1, 'claudecode', 'plain', { totalMessages: 10, uploadedAfterBatch: 10 }),
    ];
    expect(aggregateUploadProgress(recovered).failed).toBe(false);

    // False-failure regression: plain channel delivered 28, then the im channel
    // failed (or a status-timeout fired) as the LATEST event. The global bar must
    // NOT read 失败 — messages were accepted. The old "failureTs >= latestEventTs"
    // logic flipped this to 失败 even though the upload succeeded.
    const falseFail = [
      batch(0, 'claudecode', 'plain', { totalMessages: 28, uploadedAfterBatch: 28 }),
      failure(1, 'claudecode', 'im', 'timeout'),
    ];
    expect(aggregateUploadProgress(falseFail).uploaded).toBe(28);
    expect(aggregateUploadProgress(falseFail).failed).toBe(false);
  });
});

describe('uploadProgressLabel', () => {
  it('shows the scan phase with a growing discovered total and no batch segment', () => {
    const label = uploadProgressLabel({ discovered: 500, uploaded: 0, total: 500, hasBatch: false });
    expect(label).toContain('0%');
    expect(label).toContain('消息 0/500');
    expect(label).toContain('扫描中');
    expect(label).not.toContain('批次');
  });

  it('shows scanned file count while scanning before upload batches start', () => {
    const label = uploadProgressLabel({ discovered: 120, uploaded: 0, total: 120, hasBatch: false, scanFiles: 3 });
    expect(label).toContain('扫描中');
    expect(label).toContain('文件 3');
    expect(label).not.toContain('批次');
  });

  it('shows uploading state with percent, counts, and the batch segment', () => {
    const label = uploadProgressLabel({
      discovered: 500,
      uploaded: 210,
      total: 500,
      hasBatch: true,
      showBatch: true,
      batchIndex: 3,
      totalBatches: 10,
    });
    expect(label).toContain('42%');
    expect(label).toContain('消息 210/500');
    expect(label).toContain('批次 3/10');
    expect(label).toContain('上报中');
  });

  it('reports 完成 at 100%', () => {
    const label = uploadProgressLabel({
      uploaded: 500,
      total: 500,
      hasBatch: true,
      batchIndex: 10,
      totalBatches: 10,
    });
    expect(label).toContain('100%');
    expect(label).toContain('完成');
  });

  it('formats large counts with the K suffix', () => {
    const label = uploadProgressLabel({ discovered: 1500, uploaded: 0, total: 1500, hasBatch: false });
    expect(label).toContain('消息 0/1.5K');
  });

  it('shows 等待扫描 before any scan lands', () => {
    expect(uploadProgressLabel({})).toContain('等待扫描');
  });

  it('shows 失败 when the snapshot is failed', () => {
    const label = uploadProgressLabel({ discovered: 10, uploaded: 0, total: 10, hasBatch: true, failed: true });
    expect(label).toContain('失败');
  });
});

describe('full-rescan absolute progress (no percent)', () => {
  it('foldFinishedBatches is monotonic across log-tail scroll-out (never goes backwards)', () => {
    // Regression for 300→200 + "又上传启动中": the log is read as a tail window,
    // so summing finished events over the window dropped as old batches scrolled
    // out. The accumulator keys by platform:mode:batchIndex and remembers a batch
    // forever once seen — counts only grow.
    const finished = (i, attempted) => ({
      message: 'upload-batch-finished',
      platform: 'claudecode',
      mode: 'plain',
      batchIndex: i,
      attempted,
    });
    // A batch-start must NOT count as completed.
    const startOnly = { message: 'upload-batch-start', platform: 'claudecode', mode: 'plain', batchIndex: 5, attempted: 99 };

    let seen = new Map();
    let acc = foldFinishedBatches([finished(1, 100), finished(2, 100), finished(3, 100), startOnly], seen);
    expect(acc.completedBatches).toBe(3);
    expect(acc.runUploaded).toBe(300); // monotonic from 0 — 100+100+100

    // Tail scrolls: batch 1 is gone from the window. Counts must NOT drop.
    seen = acc.seen;
    acc = foldFinishedBatches([finished(2, 100), finished(3, 100)], seen);
    expect(acc.completedBatches).toBe(3);
    expect(acc.runUploaded).toBe(300);

    // A new batch arrives → counts grow, never reset to "上传启动中".
    seen = acc.seen;
    acc = foldFinishedBatches([finished(3, 100), finished(4, 100)], seen);
    expect(acc.completedBatches).toBe(4);
    expect(acc.runUploaded).toBe(400);
  });

  it('absoluteProgressLabel renders counts + rate + elapsed and never a percent', () => {
    // runUploaded 1500 / 30s = 50 msg/s; 1500 formats as 1.5K, 50/10/30 stay bare.
    const label = absoluteProgressLabel({ runUploaded: 1500, completedBatches: 10 }, { elapsedSec: 30 });
    expect(label).toContain('已上传');
    expect(label).toContain('1.5K');
    expect(label).toContain('10 批');
    expect(label).toContain('50条/秒');
    expect(label).toContain('已用时 30s');
    expect(label).not.toMatch(/%/);
  });

  it('shows 扫描中 with file count before any batch starts', () => {
    const label = absoluteProgressLabel({ hasBatch: false, scanFiles: 5, completedBatches: 0 }, { elapsedSec: 12 });
    expect(label).toContain('扫描中');
    expect(label).toContain('已扫 5 文件');
    expect(label).toContain('已用时 12s');
    expect(label).not.toMatch(/%/);
  });

  it('shows 上传启动中 while the first batch is in flight, not yet finished', () => {
    const label = absoluteProgressLabel({ hasBatch: true, completedBatches: 0 }, { elapsedSec: 3 });
    expect(label).toContain('上传启动中');
    expect(label).toContain('已用时 3s');
    expect(label).not.toMatch(/%/);
  });
});
