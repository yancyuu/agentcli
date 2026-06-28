import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ImTeamAttributor } from '../ImTeamAttributor';

describe('ImTeamAttributor', () => {
  let hermitHome: string;

  beforeEach(async () => {
    hermitHome = await mkdtemp(path.join(os.tmpdir(), 'hermit-attributor-'));
    process.env.HERMIT_HOME = hermitHome;
  });

  afterEach(async () => {
    delete process.env.HERMIT_HOME;
    await rm(hermitHome, { recursive: true, force: true });
  });

  async function writeTeam(slug: string, workDir: string, displayName = slug): Promise<void> {
    const dir = path.join(hermitHome, 'teams', slug);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'team.json'), JSON.stringify({ slug, displayName, workDir }));
  }

  it('resolves a session cwd to the owning team by longest workDir prefix', async () => {
    // parent and child workspaces: a child session must match the MORE specific
    // team, not be swallowed by the parent team.
    await writeTeam('parent', '/work/code', '父团队');
    await writeTeam('child', '/work/code/hermit', '子团队');

    const attributor = await ImTeamAttributor.load(hermitHome);

    expect(attributor.resolveByCwd('/work/code/hermit')).toEqual({
      teamSlug: 'child',
      teamName: '子团队',
    });
    expect(attributor.resolveByCwd('/work/code/hermit/deep/nested')).toEqual({
      teamSlug: 'child',
      teamName: '子团队',
    });
    // Exact parent workspace → parent team.
    expect(attributor.resolveByCwd('/work/code')).toEqual({
      teamSlug: 'parent',
      teamName: '父团队',
    });
  });

  it('returns null when no team workspace contains the cwd', async () => {
    await writeTeam('only', '/work/code');
    const attributor = await ImTeamAttributor.load(hermitHome);
    expect(attributor.resolveByCwd('/somewhere/else')).toBeNull();
    expect(attributor.resolveByCwd(undefined)).toBeNull();
  });

  it('does not match across a path boundary (no false prefix hit)', async () => {
    // /work/codetest must NOT match a team at /work/code — boundary check.
    await writeTeam('code', '/work/code');
    const attributor = await ImTeamAttributor.load(hermitHome);
    expect(attributor.resolveByCwd('/work/codetest')).toBeNull();
  });

  it('ignores archived teams and entries without a readable team.json', async () => {
    await writeTeam('live', '/work/code', '在线');
    // Archived team that would otherwise win on a longer workDir.
    await writeTeam('dead', '/work/code/hermit', '已归档');
    await mkdir(path.join(hermitHome, 'teams', '.archived-x'), { recursive: true });
    // Rename the live "dead" team dir into the archived namespace so it's skipped.
    await rm(path.join(hermitHome, 'teams', 'dead'), { recursive: true, force: true });
    await mkdir(path.join(hermitHome, 'teams', '.archived-dead'), { recursive: true });
    await writeFile(
      path.join(hermitHome, 'teams', '.archived-dead', 'team.json'),
      JSON.stringify({ slug: 'dead', workDir: '/work/code/hermit' })
    );
    // A bare directory with no team.json is skipped, not crashed on.
    await mkdir(path.join(hermitHome, 'teams', 'no-manifest'), { recursive: true });

    const attributor = await ImTeamAttributor.load(hermitHome);
    expect(attributor.resolveByCwd('/work/code/hermit')).toEqual({
      teamSlug: 'live',
      teamName: '在线',
    });
  });

  it('returns no matches when the teams directory does not exist', async () => {
    const attributor = await ImTeamAttributor.load(hermitHome);
    expect(attributor.resolveByCwd('/anything')).toBeNull();
  });
});
