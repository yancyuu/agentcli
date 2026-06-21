import {
  type ExternalImUsageReportInput,
  extractExternalImUsageMetrics,
} from '@main/services/session-intelligence/ExternalImUsageReporter';

import type { HermitBridgeUsageMessage } from '@shared/types/hermitBridge';

/**
 * Map a hermit-bridge usage-observer event to the ExternalImUsageReporter input.
 *
 * The event carries token counts and current-turn sender identity only (no
 * message content). Chat/platform still come from `session_key`, so this needs no
 * project/session lookup. Returns null when the event carries no usable token
 * metrics, so callers can no-op cheaply.
 */
export function mapUsageEventToReportInput(
  msg: HermitBridgeUsageMessage
): ExternalImUsageReportInput | null {
  const metrics = extractExternalImUsageMetrics(msg);
  if (!metrics) return null;

  return {
    sessionKey: msg.session_key,
    teamName: '',
    runtime: msg.agent_type,
    turnId: msg.turn_id,
    userId: msg.user_id,
    userName: msg.user_name,
    chatName: msg.chat_name,
    occurredAt: typeof msg.ts === 'number' ? new Date(msg.ts * 1000).toISOString() : undefined,
    metrics,
  };
}
