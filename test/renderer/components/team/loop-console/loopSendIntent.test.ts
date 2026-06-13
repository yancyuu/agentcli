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
      recipient: 'Admin Loop',
      leadRecipient: 'Admin Loop',
      slashCommandMode: 'session',
    });

    expect(intent).toMatchObject({
      kind: 'session',
      text: '/loop-scan',
      sessionName: 'loop-scan',
      reuse: true,
    });
  });

  it('routes /workers to the Admin Loop workers list intent', () => {
    const intent = parseLoopSendIntent({
      text: '/workers',
      recipient: 'Admin Loop',
      leadRecipient: 'Admin Loop',
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
});
