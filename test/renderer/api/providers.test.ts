import { afterEach, describe, expect, it, vi } from 'vitest';

import { providersApi } from '../../../src/renderer/api/providers';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('providersApi', () => {
  it('serializes undefined update fields as null so cc-connect can clear stale values', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: { message: 'ok' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await providersApi.update('custom', { base_url: undefined, model: undefined });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/providers/custom'),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ base_url: null, model: null }),
      })
    );
  });
});
