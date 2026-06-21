import {
  type ExternalImUsageReportInput,
  extractExternalImUsageMetrics,
} from '@main/services/session-intelligence/ExternalImUsageReporter';

import type { CcBridgeUsageMessage } from '@shared/types/ccConnect';

/**
 * Map a cc-connect usage-observer event to the ExternalImUsageReporter input.
 *
 * The event carries token counts only (no message content); identity
 * (platform/userId/chatId) is parsed by `reportTurn` from `session_key`, so this
 * needs no project/session lookup. Returns null when the event carries no usable
 * token metrics, so callers can no-op cheaply.
 */
export function mapUsageEventToReportInput(
  msg: CcBridgeUsageMessage
): ExternalImUsageReportInput | null {
  const metrics = extractExternalImUsageMetrics(msg);
  if (!metrics) return null;

  return {
    sessionKey: msg.session_key,
    teamName: '',
    runtime: msg.agent_type,
    occurredAt: typeof msg.ts === 'number' ? new Date(msg.ts * 1000).toISOString() : undefined,
    metrics,
  };
}
