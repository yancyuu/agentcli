import type { TeamManifest } from '@main/services/teams-mvp/TeamWorkspaceService';

const EXTERNAL_PLATFORM_SESSION_RE = /^(feishu|lark|weixin|telegram|discord|slack):/;
const FEISHU_LARK_KEYS = new Set(['feishu', 'lark']);

export interface ExternalPlatformSessionKey {
  platform: string;
  chatId?: string;
  userId?: string;
}

export function isExternalPlatformSessionKey(sessionKey: string): boolean {
  return EXTERNAL_PLATFORM_SESSION_RE.test(sessionKey);
}

export function parseExternalPlatformSessionKey(
  sessionKey: string
): ExternalPlatformSessionKey | null {
  if (!isExternalPlatformSessionKey(sessionKey)) return null;
  const [platform, chatId, userId] = sessionKey.split(':');
  return {
    platform,
    chatId: chatId?.trim() || undefined,
    userId: userId?.trim() || undefined,
  };
}

function getPlatformAllowValue(
  record: Record<string, string> | undefined,
  platform: string
): string {
  if (!record) return '';
  if (FEISHU_LARK_KEYS.has(platform)) {
    return record[platform] ?? record[platform === 'feishu' ? 'lark' : 'feishu'] ?? '';
  }
  return record[platform] ?? '';
}

function matchesAllowList(allowList: string, value: string | undefined): boolean {
  const trimmed = allowList.trim();
  if (!trimmed) return false;
  if (trimmed === '*') return true;
  if (!value) return false;
  return trimmed
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .includes(value);
}

function scoreManifestForSession(
  manifest: TeamManifest,
  parsed: ExternalPlatformSessionKey
): number {
  const allowChat = getPlatformAllowValue(manifest.platformAllowChat, parsed.platform);
  const allowFrom = getPlatformAllowValue(manifest.platformAllowFrom, parsed.platform);
  let score = 0;

  if (allowChat) {
    if (!matchesAllowList(allowChat, parsed.chatId)) return 0;
    score += allowChat.trim() === '*' ? 1 : 4;
  }

  if (allowFrom) {
    if (!matchesAllowList(allowFrom, parsed.userId)) return 0;
    score += allowFrom.trim() === '*' ? 1 : 3;
  }

  return score;
}

/**
 * Resolves an external platform session key (for example `feishu:{chat}:{user}`)
 * to a Hermit-managed team slug using local allow-list metadata. Returns null
 * when no team matches or when multiple teams are equally plausible.
 */
export function resolveExternalPlatformSessionTeamSlug(
  sessionKey: string,
  manifests: readonly TeamManifest[]
): string | null {
  const parsed = parseExternalPlatformSessionKey(sessionKey);
  if (!parsed) return null;

  const ranked = manifests
    .map((manifest) => ({ manifest, score: scoreManifestForSession(manifest, parsed) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) return null;
  if (ranked.length > 1 && ranked[0].score === ranked[1].score) return null;
  return ranked[0].manifest.slug || ranked[0].manifest.bindProject;
}
