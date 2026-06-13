import { describe, expect, it } from 'vitest';

import { parseLoopSendIntent, validateLoopSendIntent } from './loopSendIntent';

function messageIntent(text = 'do the thing') {
  return parseLoopSendIntent({ text, recipient: 'lead', leadRecipient: 'lead' });
}

describe('validateLoopSendIntent', () => {
  it('rejects empty text with a generic command prompt (no Loop branding)', () => {
    const intent = messageIntent('   ');
    const result = validateLoopSendIntent(intent);
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
    // The console accepts more than just loop commands — !runtime, !session,
    // /workflows, @team dispatch — so the empty-state prompt must be generic
    // command wording, never branded "Loop 指令".
    expect(result.reason).toMatch(/指令/);
    expect(result.reason).not.toMatch(/Loop/i);
  });

  it('accepts a non-empty message when the team is alive', () => {
    expect(validateLoopSendIntent(messageIntent('hello'), { isTeamAlive: true }).ok).toBe(true);
  });

  it('blocks sends while provisioning', () => {
    const result = validateLoopSendIntent(messageIntent('hello'), { isProvisioning: true });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/启动/);
  });

  it('blocks runtime/session intents when the team is offline', () => {
    const runtime = parseLoopSendIntent({
      text: '!runtime do something',
      recipient: 'lead',
      leadRecipient: 'lead',
    });
    expect(runtime.kind).toBe('runtime');
    expect(validateLoopSendIntent(runtime, { isTeamAlive: false }).ok).toBe(false);

    const session = parseLoopSendIntent({
      text: '/loop-scan',
      recipient: 'lead',
      leadRecipient: 'lead',
      slashCommandMode: 'session',
    });
    expect(session.kind).toBe('session');
    expect(validateLoopSendIntent(session, { isTeamAlive: false }).ok).toBe(false);
  });

  it('allows a runtime intent when the team is alive', () => {
    const runtime = parseLoopSendIntent({
      text: '!runtime do something',
      recipient: 'lead',
      leadRecipient: 'lead',
    });
    expect(runtime.kind).toBe('runtime');
    expect(validateLoopSendIntent(runtime, { isTeamAlive: true }).ok).toBe(true);
  });
});

describe('parseLoopSendIntent /workers', () => {
  it('resolves /workers to workers-list in session (admin) mode', () => {
    const intent = parseLoopSendIntent({
      text: '/workers',
      recipient: 'lead',
      leadRecipient: 'lead',
      slashCommandMode: 'session',
    });
    expect(intent.kind).toBe('workers-list');
  });

  it('resolves /workers to workers-list even in message (team) mode', () => {
    // /workers is offered in the team console too; it must actually run the
    // client-side worker listing there, not silently fall through to a plain
    // lead message that does nothing.
    const intent = parseLoopSendIntent({
      text: '/workers',
      recipient: 'lead',
      leadRecipient: 'lead',
      slashCommandMode: 'message',
    });
    expect(intent.kind).toBe('workers-list');
  });
});
