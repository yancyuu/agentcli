import { readdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';

import type { LocalTeamEntry } from '@main/services/extensions/capability-packs/CapabilityPackLoaderService';

/**
 * Resolves which Hermit team owns an IM-origin Claude session, by matching the
 * session's working directory against each team's `workDir` in
 * `~/.hermit/teams/<slug>/team.json`.
 *
 * This is the routing attribution source for the IM upload contract's
 * `routing.target` (teamSlug / teamName): the team whose workspace the agent ran
 * in is the team that handled the IM conversation. `platformAllowChat` is NOT
 * used — it is usually a wildcard (`"*"`) and so cannot uniquely identify a team.
 *
 * Matching is longest-`workDir`-prefix-wins on a path boundary: a session under
 * `/Users/x/code/hermit` matches both a team at `/Users/x/code` and one at
 * `/Users/x/code/hermit`, and the more specific (longer) one wins. This prevents
 * a parent-workspace team from swallowing every child-workspace session.
 */

export interface TeamIdentity {
  teamSlug: string;
  teamName: string;
}

interface TeamRecord {
  teamSlug: string;
  teamName: string;
  workDir: string;
}

function normalizeDir(dir: string): string {
  // Trim a single trailing separator so prefix checks compare on a clean prefix,
  // without altering the stored path semantics.
  return path.resolve(dir).replace(/\/+$/, '') || '/';
}

function isPathBoundary(child: string, ancestor: string): boolean {
  if (child === ancestor) return true;
  return child.startsWith(ancestor + '/');
}

export class ImTeamAttributor {
  // Longest workDir first, so the first boundary match is the most specific team.
  private readonly ranked: TeamRecord[];

  private constructor(teams: TeamRecord[]) {
    this.ranked = [...teams].sort((a, b) => b.workDir.length - a.workDir.length);
  }

  static async load(hermitHome: string): Promise<ImTeamAttributor> {
    const teamsDir = path.join(hermitHome, 'teams');
    let names: string[];
    try {
      names = await readdir(teamsDir);
    } catch {
      return new ImTeamAttributor([]);
    }

    const records: TeamRecord[] = [];
    for (const name of names) {
      // Archived teams live under `.archived-*`; skip them — they no longer route.
      if (name.startsWith('.')) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(path.join(teamsDir, name, 'team.json'), 'utf-8'));
      } catch {
        // Not a team directory (no readable team.json) — skip.
        continue;
      }
      const team = parsed as { slug?: unknown; displayName?: unknown; workDir?: unknown } | null;
      const slug = typeof team?.slug === 'string' ? team.slug : name;
      const workDir = typeof team?.workDir === 'string' ? team.workDir : '';
      if (!workDir) continue;
      const teamName = typeof team?.displayName === 'string' ? team.displayName : slug;
      records.push({ teamSlug: slug, teamName, workDir: normalizeDir(workDir) });
    }
    return new ImTeamAttributor(records);
  }

  resolveByCwd(cwd: string | undefined | null): TeamIdentity | null {
    if (!cwd) return null;
    const resolved = normalizeDir(cwd);
    for (const team of this.ranked) {
      if (isPathBoundary(resolved, team.workDir)) {
        return { teamSlug: team.teamSlug, teamName: team.teamName };
      }
    }
    return null;
  }

  // The same team records (read once from team.json) exposed in the shape
  // CapabilityPackLoaderService consumes, so the IM upload path can build
  // capability snapshots without re-reading team.json a second time.
  toLocalTeams(): LocalTeamEntry[] {
    return this.ranked.map((team) => ({
      slug: team.teamSlug,
      displayName: team.teamName,
      workDir: team.workDir,
    }));
  }
}
