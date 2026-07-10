import { describe, expect, it, vi } from 'vitest';

import { deleteAssistantTeamPermanentlyViaApi, postLocalJson } from '../assistantBinding.mjs';

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
