import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadImOriginEnvelopes } from '../ImOriginSessionReader';

function bridgeFile(
  sessions: Record<string, unknown>,
  userSessions: Record<string, unknown>,
  activeSession: Record<string, unknown>,
  userMeta: Record<string, unknown>
): string {
  return JSON.stringify({
    sessions,
    user_sessions: userSessions,
    active_session: activeSession,
    user_meta: userMeta,
    version: 1,
  });
}

async function withHermitHome(fn: (hermitHome: string) => Promise<void>): Promise<void> {
  const hermitHome = await mkdtemp(path.join(tmpdir(), 'hermit-im-reader-'));
  try {
    await fn(hermitHome);
  } finally {
    await rm(hermitHome, { recursive: true, force: true });
  }
}

describe('loadImOriginEnvelopes', () => {
  it('resolves bridge internal ids to Claude agent_session_ids and merges sender + message composites', async () => {
    await withHermitHome(async (hermitHome) => {
      const dir = path.join(hermitHome, 'hermit-bridge', 'data', 'sessions');
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, 'proj_abc.json'),
        bridgeFile(
          { s1: { id: 's1', agent_session_id: 'claude-cur', past_agent_session_ids: [] } },
          {
            'feishu:oc_CHAT:ou_SENDER': ['s1'],
            'feishu:oc_CHAT:on_MSG': ['s1'],
          },
          { 'feishu:oc_CHAT:ou_SENDER': 's1' },
          { 'feishu:oc_CHAT:ou_SENDER': { chat_name: '群', user_name: '发' } }
        )
      );

      const envs = await loadImOriginEnvelopes(hermitHome);
      // Keyed by the resolved UUID (not the internal id "s1").
      const env = envs.get('claude-cur');
      expect(env).toBeTruthy();
      expect(env!.chatId).toBe('oc_CHAT');
      expect(env!.senderId).toBe('ou_SENDER');
      expect(env!.messageId).toBe('on_MSG');
      expect(envs.has('s1')).toBe(false);
    });
  });

  it('enriches a message-composite-only session with the chat sender when the chat has exactly one sender', async () => {
    // The "helli" scenario from production: the current session (s12) is indexed
    // only under the message composite; the sender composite points at an older
    // rolled-over session (s1). Resolution keys s12 by its UUID; chat-scoped
    // enrichment then attributes the chat's single known sender to it.
    await withHermitHome(async (hermitHome) => {
      const dir = path.join(hermitHome, 'hermit-bridge', 'data', 'sessions');
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, 'proj_abc.json'),
        bridgeFile(
          {
            s1: { id: 's1', agent_session_id: 'claude-old', past_agent_session_ids: [] },
            s12: { id: 's12', agent_session_id: 'claude-cur', past_agent_session_ids: [] },
          },
          {
            'feishu:oc_CHAT:ou_SENDER': ['s1'],
            'feishu:oc_CHAT:on_MSG': ['s12'],
          },
          { 'feishu:oc_CHAT:on_MSG': 's12' },
          {}
        )
      );

      const envs = await loadImOriginEnvelopes(hermitHome);
      const cur = envs.get('claude-cur')!;
      expect(cur.chatId).toBe('oc_CHAT');
      expect(cur.messageId).toBe('on_MSG');
      // s12 was only in the message composite; chat-scoped enrichment fills sender.
      expect(cur.senderId).toBe('ou_SENDER');
    });
  });

  it('does not enrich senderId for chats with multiple distinct senders (ambiguous)', async () => {
    await withHermitHome(async (hermitHome) => {
      const dir = path.join(hermitHome, 'hermit-bridge', 'data', 'sessions');
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, 'proj_abc.json'),
        bridgeFile(
          {
            s1: { id: 's1', agent_session_id: 'claude-a', past_agent_session_ids: [] },
            s2: { id: 's2', agent_session_id: 'claude-b', past_agent_session_ids: [] },
            s3: { id: 's3', agent_session_id: 'claude-msg', past_agent_session_ids: [] },
          },
          {
            'feishu:oc_CHAT:ou_SENDER_A': ['s1'],
            'feishu:oc_CHAT:ou_SENDER_B': ['s2'],
            'feishu:oc_CHAT:on_MSG': ['s3'],
          },
          {},
          {}
        )
      );

      const envs = await loadImOriginEnvelopes(hermitHome);
      const msg = envs.get('claude-msg')!;
      expect(msg.chatId).toBe('oc_CHAT');
      expect(msg.messageId).toBe('on_MSG');
      // Two senders → ambiguous → enrichment must NOT fire.
      expect(msg.senderId).toBeUndefined();
    });
  });

  it('returns an empty map when hermit-bridge is not present', async () => {
    await withHermitHome(async (hermitHome) => {
      const envs = await loadImOriginEnvelopes(hermitHome);
      expect(envs.size).toBe(0);
    });
  });
});
