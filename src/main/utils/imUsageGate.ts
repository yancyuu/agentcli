import type { TaskBusConfig } from '@shared/types/team';

/**
 * All three switches must be on for IM-usage (飞书/Lark 等 IM 桥每轮 token 用量)
 * to be uploaded to the team-bus Redis:
 *   1. taskBus.enabled                  — the distributed bus master switch
 *   2. taskBus.telemetry.enabled        — usage collection
 *   3. taskBus.telemetry.uploadEnabled  — the IM-usage upload opt-in
 *
 * uploadEnabled defaults to true (the UI toggle is on unless explicitly turned
 * off), so only an explicit `false` suppresses reporting — "不开就不报,开了再报".
 *
 * Extracted as a pure predicate so the gate is unit-testable.
 * `getImUplinkRedisConfig` (server.ts) is the single runtime choke point that
 * uses it: it feeds both the report pre-check and the reporter's own
 * getRedisConfig, so all three gates take effect everywhere reporting happens.
 */
export function isImUsageUploadEnabled(config: TaskBusConfig | null | undefined): boolean {
  if (!config?.enabled) return false;
  if (!config.telemetry?.enabled) return false;
  if (config.telemetry?.uploadEnabled === false) return false;
  return true;
}
