import { describe, expect, it } from 'vitest';

import {
  getLoopSendIntentLabel,
  parseLoopSendIntent,
  validateLoopSendIntent,
} from '@renderer/components/team/loop-console/loopSendIntent';

describe('loopSendIntent', () => {
  it('parses regular messages to the lead recipient', () => {
    const intent = parseLoopSendIntent({
      text: '/loop 1d 总结状态',
      recipient: 'Lead',
      leadRecipient: 'Lead',
      teamSlugs: ['ops'],
    });

    expect(intent).toMatchObject({ kind: 'message', recipient: 'Lead', text: '/loop 1d 总结状态' });
    expect(getLoopSendIntentLabel(intent)).toContain('Lead');
  });

  it('routes standalone slash commands to reusable sessions when configured', () => {
    const intent = parseLoopSendIntent({
      text: '/loop-scan',
      recipient: 'Helm Loop',
      leadRecipient: 'Helm Loop',
      slashCommandMode: 'session',
    });

    expect(intent).toMatchObject({
      kind: 'session',
      text: '/loop-scan',
      sessionName: 'loop-scan',
      reuse: true,
    });
  });

  it('routes /workers to the Helm Loop workers list intent', () => {
    const intent = parseLoopSendIntent({
      text: '/workers',
      recipient: 'Helm Loop',
      leadRecipient: 'Helm Loop',
      slashCommandMode: 'session',
    });

    expect(intent).toMatchObject({
      kind: 'workers-list',
      text: '/workers',
      summary: '获取当前数字员工列表',
    });
    expect(getLoopSendIntentLabel(intent)).toBe('查看数字员工');
  });

  it('parses runtime directive without writing to the message board', () => {
    const intent = parseLoopSendIntent({
      text: '!runtime /doctor',
      recipient: 'Lead',
      leadRecipient: 'Lead',
    });

    expect(intent).toMatchObject({ kind: 'runtime', text: '/doctor' });
    expect(validateLoopSendIntent(intent, { isTeamAlive: false })).toMatchObject({ ok: false });
  });

  it('parses session directive with name and reuse flag', () => {
    const intent = parseLoopSendIntent({
      text: '!session --reuse --name "每日巡检" /summary',
      recipient: 'Lead',
      leadRecipient: 'Lead',
    });

    expect(intent).toMatchObject({
      kind: 'session',
      text: '/summary',
      sessionName: '每日巡检',
      reuse: true,
    });
  });

  it('parses known @team prefix as cross-team task', () => {
    const intent = parseLoopSendIntent({
      text: '@ops 检查 Redis task bus',
      recipient: 'Lead',
      leadRecipient: 'Lead',
      teamSlugs: ['ops'],
    });

    expect(intent).toMatchObject({
      kind: 'cross-team-task',
      toTeam: 'ops',
      subject: '检查 Redis task bus',
    });
  });

  it('falls back to a plain message when @team is not a known team slug (TEAM-010-003)', () => {
    // An unknown team slug must NOT silently become a cross-team dispatch —
    // it would create a task for a non-existent team. It falls through to a
    // normal lead message so the literal text stays visible.
    const intent = parseLoopSendIntent({
      text: '@ghost-team 这个团队不在列表里',
      recipient: 'Lead',
      leadRecipient: 'Lead',
      teamSlugs: ['ops'],
    });

    expect(intent.kind).toBe('message');
    expect(intent).not.toMatchObject({ kind: 'cross-team-task' });
  });

  it('validates a cross-team task even when the source team is offline (TEAM-010-004)', () => {
    // Cross-team dispatch hands an async task to the TARGET team; it must NOT
    // be blocked by the SOURCE team's runtime being offline (unlike
    // runtime/session/attachment intents, which are gated on isTeamAlive).
    const intent = parseLoopSendIntent({
      text: '@ops 检查 Redis task bus',
      recipient: 'Lead',
      leadRecipient: 'Lead',
      teamSlugs: ['ops'],
    });
    expect(intent.kind).toBe('cross-team-task');

    expect(validateLoopSendIntent(intent, { isTeamAlive: false }).ok).toBe(true);
    expect(validateLoopSendIntent(intent, { isTeamAlive: true }).ok).toBe(true);
  });

  it('rejects a cross-team task intent missing its target team (defensive guard)', () => {
    // parseLoopSendIntent never emits this in practice (toTeam comes from a
    // non-empty regex capture), but the validator must still defend the shape.
    const intent = {
      kind: 'cross-team-task' as const,
      toTeam: '',
      subject: '检查 Redis task bus',
      text: '@ 检查 Redis task bus',
    };
    expect(validateLoopSendIntent(intent).ok).toBe(false);
  });
});
