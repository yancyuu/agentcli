import { describe, expect, it } from 'vitest';

import type { TaskBusConfig } from '@shared/types/team';

import { isImUsageUploadEnabled } from './imUsageGate';

const base: TaskBusConfig = {
  enabled: true,
  redis: { host: '127.0.0.1', port: 6379 },
  telemetry: { enabled: true, uploadEnabled: true, platform: 'claudecode' },
};

describe('isImUsageUploadEnabled', () => {
  it('is enabled when all three switches are on', () => {
    expect(isImUsageUploadEnabled(base)).toBe(true);
  });

  it('defaults to enabled when uploadEnabled is unspecified (toggle defaults on)', () => {
    expect(
      isImUsageUploadEnabled({
        ...base,
        telemetry: { enabled: true, platform: 'claudecode' },
      })
    ).toBe(true);
  });

  it('is disabled when the IM-usage upload toggle is explicitly turned off', () => {
    expect(
      isImUsageUploadEnabled({
        ...base,
        telemetry: { enabled: true, uploadEnabled: false, platform: 'claudecode' },
      })
    ).toBe(false);
  });

  it('is disabled when the task bus master switch is off', () => {
    expect(isImUsageUploadEnabled({ ...base, enabled: false })).toBe(false);
  });

  it('is disabled when telemetry collection is off (even if upload is on)', () => {
    expect(
      isImUsageUploadEnabled({
        ...base,
        telemetry: { enabled: false, uploadEnabled: true, platform: 'claudecode' },
      })
    ).toBe(false);
  });

  it('is disabled for null/undefined config', () => {
    expect(isImUsageUploadEnabled(null)).toBe(false);
    expect(isImUsageUploadEnabled(undefined)).toBe(false);
  });
});
