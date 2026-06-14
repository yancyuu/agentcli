import type { SystemManagerConfig, SystemManagerConfigPatch } from '@shared/types/systemManager';

/**
 * Helm Loop bootstrap.
 *
 * On first open of the admin console, the GitHub Pages ops guide is fetched and
 * fed to the admin lead session as its first turn, so the agent can seed its own
 * CLAUDE.md from the manual. After a successful feed the `adminInitialized`
 * marker is set so it never repeats.
 *
 * Extracted from server.ts as a pure, dependency-injected unit so the
 * idempotency and failure semantics are unit-testable without spawning the
 * direct-CLI runtime or hitting the network.
 */

/** Deterministic id for the bootstrap message (one-shot, never reused). */
export const ADMIN_INIT_MESSAGE_ID = 'helm-loop-init';

/** Lightweight HTML → plain text: strip script/style, drop tags, decode entities, collapse whitespace. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Build the bootstrap prompt wrapping the guide text. Pure — tested directly. */
export function buildAdminInitMessage(guideText: string): string {
  return [
    '【Helm Loop 初始化】以下是 Hermit 运维手册全文。请通读并据此在你的工作目录初始化 CLAUDE.md，',
    '建立对团队治理、消息路由、Loop 工作流的整体认知。',
    '随后可用 `/workers` 查看所有数字员工及其工作路径，用 `@workerId` 直接调度对应员工。',
    '',
    '--- 运维手册 ---',
    guideText,
  ].join('\n');
}

export interface AdminLoopInitDeps {
  getConfig: () => Promise<SystemManagerConfig>;
  updateConfig: (patch: SystemManagerConfigPatch) => Promise<SystemManagerConfig>;
  /** Fetch the ops guide. Resolves with statusCode + raw body; rejects on network error. */
  fetchGuide: () => Promise<{ statusCode: number; body: string }>;
  /** Deliver the bootstrap message to the admin lead session. */
  dispatch: (message: { text: string; messageId: string }) => Promise<void>;
  /** Optional diagnostic sink (warnings only). */
  log?: (message: string) => void;
}

/**
 * Run the one-shot bootstrap if it hasn't run yet.
 *
 * - Idempotent: returns immediately when `adminInitialized` is already set —
 *   does NOT fetch or dispatch.
 * - Failure-tolerant: a network error, non-2xx status, or empty body returns
 *   WITHOUT setting the marker, so the next console open retries. Only a
 *   successful fetch + dispatch sets the flag.
 */
export async function ensureAdminLoopInitialized(deps: AdminLoopInitDeps): Promise<void> {
  const config = await deps.getConfig();
  if (config.adminInitialized) return;

  let body = '';
  try {
    const res = await deps.fetchGuide();
    if (res.statusCode >= 200 && res.statusCode < 300) {
      body = htmlToPlainText(res.body);
    }
  } catch (err) {
    deps.log?.(
      `helm loop init: fetch failed (${err instanceof Error ? err.message : String(err)})`
    );
    return;
  }

  if (!body.trim()) {
    deps.log?.('helm loop init: empty guide body, will retry next open');
    return;
  }

  await deps.dispatch({ text: buildAdminInitMessage(body), messageId: ADMIN_INIT_MESSAGE_ID });
  await deps.updateConfig({ adminInitialized: true });
}
