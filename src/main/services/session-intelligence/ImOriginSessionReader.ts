import { readdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';

import { parseHermitBridgeSessions, type ImEnvelope } from './hermitBridgeSessionStore';

export type { ImEnvelope };

/**
 * Loads a map of Claude session id → IM envelope.
 *
 * hermit-bridge (the cc-connect fork that routes IM bot conversations to
 * claudecode agents) records, per IM conversation, the Claude sessions it drove.
 * The authoritative index lives at `<hermitHome>/hermit-bridge/data/sessions/*.json`
 * and is parsed by {@link parseHermitBridgeSessions} (shared with live worker
 * detection).
 *
 * Every Claude session id reachable from a composite `provider:chatId:<sender|msg>`
 * is IM-origin by definition and carries its chat/sender/message identity.
 * Because a chat is indexed under BOTH a sender-keyed composite and a
 * message-keyed composite, all composites referencing the same session are
 * merged additively — so the envelope ends up with provider + chatId/chatName +
 * senderId (from ou_) + messageId (from on_/om_) without writing anything into
 * the Claude session jsonl files.
 *
 * Legacy builds lacking composite maps fall back to marking every recorded
 * session (`sessions[*].agent_session_id` + `past_agent_session_ids`) IM-origin
 * with a provider-only envelope; a richer composite envelope always wins.
 */
export async function loadImOriginEnvelopes(hermitHome: string): Promise<Map<string, ImEnvelope>> {
  const envelopes = new Map<string, ImEnvelope>();
  const dir = path.join(hermitHome, 'hermit-bridge', 'data', 'sessions');
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    // No hermit-bridge, or not yet bootstrapped — no IM sessions exist.
    return envelopes;
  }

  const merge = (id: string, env: ImEnvelope): void => {
    const existing = envelopes.get(id);
    if (!existing) {
      envelopes.set(id, { ...env });
      return;
    }
    existing.chatId ??= env.chatId;
    existing.chatName ??= env.chatName;
    existing.chatType ??= env.chatType;
    existing.senderId ??= env.senderId;
    existing.senderName ??= env.senderName;
    existing.messageId ??= env.messageId;
  };

  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path.join(dir, name), 'utf-8'));
    } catch {
      continue;
    }
    const store = parseHermitBridgeSessions(parsed, name);
    if (!store) continue;

    for (const { envelope, agentSessionIds } of store.composites.values()) {
      for (const id of agentSessionIds) merge(id, envelope);
    }

    // Legacy union for older builds lacking composite maps.
    for (const sess of store.sessions.values()) {
      for (const id of [sess.agentSessionId, ...sess.pastAgentSessionIds]) {
        envelopes.set(id, envelopes.get(id) ?? { provider: 'feishu' });
      }
    }
  }

  return envelopes;
}
