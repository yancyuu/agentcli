import { describe, expect, it, vi } from 'vitest';

import { deleteAssistantTeamPermanentlyViaApi, postLocalJson, waitForQrAssistantBinding } from '../assistantBinding.mjs';

describe('assistantBinding — local API helpers', () => {
  it('allows non-POST methods for cleanup requests', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => '{"ok":true}',
    }));
    vi.stubGlobal('fetch', fetchMock);

    await deleteAssistantTeamPermanentlyViaApi(5680, 'assistant/test');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:5680/api/teams/assistant%2Ftest/permanent?strictExternal=true',
      expect.objectContaining({ method: 'DELETE' })
    );
    vi.unstubAllGlobals();
  });

  it('still defaults local JSON requests to POST', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => '{"ok":true,"data":{"done":true}}',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await postLocalJson(5680, '/api/example', { hello: 'world' });

    expect(result).toEqual({ done: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:5680/api/example',
      expect.objectContaining({ method: 'POST' })
    );
    vi.unstubAllGlobals();
  });
});

// Regression (observed live): the 绑定渠道 stage reported "aborted due to timeout"
// even though the web dashboard showed success. One slow poll — the local workbench
// blocked >15s on the upstream Feishu call — was aborted by postLocalJson's
// AbortSignal.timeout and, with no try/catch around the poll, that single fetch
// failure killed the whole binding and triggered a rollback. A single hung poll
// must be retried until the total deadline; only definitive statuses are fatal.
describe('waitForQrAssistantBinding — a single hung poll is retried, not fatal', () => {
  it('completes when the first poll times out but a later one succeeds', async () => {
    const beginResult = { deviceCode: 'dc-1', baseUrl: 'http://gw.example', interval: 5 };
    const fetchMock = vi.fn();
    fetchMock
      .mockRejectedValueOnce(new Error('The operation was aborted due to timeout'))
      .mockResolvedValueOnce({ ok: true, text: async () => '{"ok":true,"data":{"status":"completed","app_id":"app-1"}}' });
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    try {
      const statuses = [];
      const promise = waitForQrAssistantBinding(5680, 'feishu', beginResult, (s) => statuses.push(s), 60_000);
      // First poll rejects -> caught -> retry delay (interval*1000) scheduled. Advance it
      // so the loop re-enters and fires the second (successful) poll.
      await vi.advanceTimersByTimeAsync(5_000);
      const result = await promise;
      expect(result.status).toBe('completed');
      expect(result.app_id).toBe('app-1');
      // Exactly two polls: one failed transiently, one succeeded.
      expect(fetchMock).toHaveBeenCalledTimes(2);
      // The transient failure surfaced to the UI as a benign pending, never as a hard error.
      expect(statuses).toContain('pending');
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
