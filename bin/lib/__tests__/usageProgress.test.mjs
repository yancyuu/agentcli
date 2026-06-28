import { describe, expect, it } from 'vitest';

import { aggregateUploadProgress, uploadProgressLabel } from '../usageProgress.mjs';

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

  it('marks failed only when the most recent event is a failure', () => {
    const events = [
      scan(0, 'claudecode', 'plain', 10),
      failure(1, 'claudecode', 'plain', 'boom'),
    ];
    expect(aggregateUploadProgress(events).failed).toBe(true);
    expect(aggregateUploadProgress(events).failureMessage).toBe('boom');

    // A later batch event clears the failed state.
    const recovered = [
      failure(0, 'claudecode', 'plain', 'boom'),
      batch(1, 'claudecode', 'plain', { totalMessages: 10, uploadedAfterBatch: 10 }),
    ];
    expect(aggregateUploadProgress(recovered).failed).toBe(false);
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

  it('shows uploading state with percent, counts, and the batch segment', () => {
    const label = uploadProgressLabel({
      discovered: 500,
      uploaded: 210,
      total: 500,
      hasBatch: true,
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
