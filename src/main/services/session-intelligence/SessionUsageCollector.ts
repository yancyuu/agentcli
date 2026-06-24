import { scanSessions } from './SessionUsageParser';

import type { UsageCollectionResult } from './usageTypes';

export class SessionUsageCollector {
  async collect(): Promise<UsageCollectionResult> {
    return {
      computedAt: new Date().toISOString(),
      legacyParseResult: await scanSessions(),
    };
  }
}
