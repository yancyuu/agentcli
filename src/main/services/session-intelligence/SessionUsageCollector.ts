import type { ConversationTelemetryRow } from '@shared/types/api';

import { scanSessions } from './SessionUsageParser';

import type { UsageCollectionResult } from './usageTypes';

export type ConversationUsageRowsProvider = () => Promise<ConversationTelemetryRow[]>;

export class SessionUsageCollector {
  constructor(private readonly loadConversations?: ConversationUsageRowsProvider) {}

  async collect(): Promise<UsageCollectionResult> {
    const [legacyParseResult, conversations] = await Promise.all([
      scanSessions(),
      this.loadConversations?.().catch(() => []) ?? Promise.resolve([]),
    ]);

    return {
      computedAt: new Date().toISOString(),
      legacyParseResult,
      conversations,
    };
  }
}
