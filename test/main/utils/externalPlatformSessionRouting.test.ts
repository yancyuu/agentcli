import { describe, expect, it } from 'vitest';

import {
  isExternalPlatformSessionKey,
  parseExternalPlatformSessionKey,
  resolveExternalPlatformSessionTeamSlug,
} from '@main/utils/externalPlatformSessionRouting';

import type { TeamManifest } from '@main/services/teams-mvp/TeamWorkspaceService';

function manifest(
  slug: string,
  allow: Pick<TeamManifest, 'platformAllowFrom' | 'platformAllowChat'>
): TeamManifest {
  return {
    schemaVersion: 2,
    slug,
    displayName: slug,
    bindProject: `${slug}-project`,
    harness: 'claudecode',
    workDir: '/tmp/project',
    rootPath: `/tmp/hermit/${slug}`,
    createdAt: new Date(0).toISOString(),
    ...allow,
  };
}

describe('external platform session routing', () => {
  it('detects and parses Feishu/Lark style session keys', () => {
    expect(isExternalPlatformSessionKey('feishu:chat_A:ou_user')).toBe(true);
    expect(isExternalPlatformSessionKey('hermit:team:session')).toBe(false);
    expect(parseExternalPlatformSessionKey('feishu:chat_A:ou_user')).toEqual({
      platform: 'feishu',
      chatId: 'chat_A',
      userId: 'ou_user',
    });
  });

  it('maps a Feishu session key to the Hermit team slug using allow_chat/allow_from', () => {
    const teamSlug = resolveExternalPlatformSessionTeamSlug('feishu:chat_A:ou_user', [
      manifest('other-team', {
        platformAllowChat: { feishu: 'chat_B' },
        platformAllowFrom: { feishu: '*' },
      }),
      manifest('hermit-team', {
        platformAllowChat: { feishu: 'chat_A' },
        platformAllowFrom: { feishu: 'ou_user' },
      }),
    ]);

    expect(teamSlug).toBe('hermit-team');
  });

  it('treats feishu and lark allow-list keys as aliases', () => {
    const teamSlug = resolveExternalPlatformSessionTeamSlug('feishu:chat_A:ou_user', [
      manifest('hermit-team', {
        platformAllowChat: { lark: 'chat_A' },
        platformAllowFrom: { lark: 'ou_user' },
      }),
    ]);

    expect(teamSlug).toBe('hermit-team');
  });

  it('routes an Admin Loop Feishu session through QR-persisted owner metadata', () => {
    const teamSlug = resolveExternalPlatformSessionTeamSlug('feishu:chat_admin:ou_admin', [
      manifest('system-manager', {
        platformAllowFrom: { lark: 'ou_admin' },
      }),
    ]);

    expect(teamSlug).toBe('system-manager');
  });

  it('does not guess when multiple teams match equally', () => {
    const teamSlug = resolveExternalPlatformSessionTeamSlug('feishu:chat_A:ou_user', [
      manifest('team-a', { platformAllowChat: { feishu: '*' } }),
      manifest('team-b', { platformAllowChat: { feishu: '*' } }),
    ]);

    expect(teamSlug).toBeNull();
  });
});
