import { describe, expect, it } from 'vitest';

import { __internals, buildLarkBatchPayload, meetsBatchFieldConstraints } from '../larkSecrets.mjs';

function credential(index) {
  return {
    appId: `cli_batch_${index}`,
    appSecret: `secret-${'a'.repeat(40)}-${index}`,
    accessToken: `access-${'a'.repeat(40)}-${index}`,
    refreshToken: `refresh-${'a'.repeat(40)}-${index}`,
    userOpenId: `ou_batch_${index}`,
  };
}

describe('larkSecrets batch payload mirror', () => {
  it('builds one deduplicated, API-valid item per personal authorization', () => {
    const first = credential(1);
    const payload = buildLarkBatchPayload([first, credential(2), first]);

    expect(payload).toEqual({
      items: [
        {
          client_item_id: 'cli_batch_1:ou_batch_1',
          app_id: first.appId,
          app_secret: first.appSecret,
          access_token: first.accessToken,
          refresh_token: first.refreshToken,
        },
        expect.objectContaining({ client_item_id: 'cli_batch_2:ou_batch_2' }),
      ],
    });
  });

  it('rejects incomplete profiles before they can poison an atomic batch', () => {
    expect(meetsBatchFieldConstraints(credential(1))).toBe(true);
    expect(meetsBatchFieldConstraints({ ...credential(1), appId: 'wrong' })).toBe(false);
    expect(meetsBatchFieldConstraints({ ...credential(1), appSecret: 'short' })).toBe(false);
    expect(meetsBatchFieldConstraints({ ...credential(1), accessToken: 'short' })).toBe(false);
    expect(meetsBatchFieldConstraints({ ...credential(1), refreshToken: 'short' })).toBe(false);
  });

  it('maps an overlong profile identity to a stable API-valid client item id', () => {
    const long = {
      ...credential(1),
      appId: `cli_${'a'.repeat(150)}`,
      userOpenId: `ou_${'b'.repeat(80)}`,
    };
    const first = buildLarkBatchPayload([long]).items[0].client_item_id;
    const second = buildLarkBatchPayload([long]).items[0].client_item_id;

    expect(first).toBe(second);
    expect(first).toHaveLength(64);
    expect(first).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/);
  });

  it('splits profiles into API-valid batches of at most 20 items', () => {
    const payload = buildLarkBatchPayload(Array.from({ length: 21 }, (_, index) => credential(index + 1)));
    expect(__internals.splitBatchItems(payload.items).map((items) => items.length)).toEqual([20, 1]);
  });
});
