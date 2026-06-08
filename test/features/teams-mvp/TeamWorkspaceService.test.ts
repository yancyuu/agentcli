/**
 * Tests: TeamWorkspaceService — 团队本地存储 CRUD
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { TeamWorkspaceService } from '@main/services/teams-mvp/TeamWorkspaceService';

let tmpDir: string;
let svc: TeamWorkspaceService;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-ws-test-'));
  process.env.HERMIT_HOME = tmpDir;
  svc = new TeamWorkspaceService();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.HERMIT_HOME;
});

// ---------------------------------------------------------------------------
describe('createTeam', () => {
  it('creates team.json with correct fields', async () => {
    const { slug, manifest } = await svc.createTeam({
      displayName: '前端团队',
      bindProject: 'frontend-team',
      harness: 'claudecode',
      workDir: '/tmp/frontend',
      color: 'blue',
      collaboration: true,
    });

    expect(slug).toBe('frontend-team');
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.bindProject).toBe('frontend-team');
    expect(manifest.harness).toBe('claudecode');
    expect(manifest.collaboration).toBe(true);

    const teamJsonPath = path.join(tmpDir, 'teams', slug, 'team.json');
    const stored = JSON.parse(fs.readFileSync(teamJsonPath, 'utf8'));
    expect(stored.displayName).toBe('前端团队');
  });

  it('defaults collaboration to true', async () => {
    const { manifest } = await svc.createTeam({
      displayName: 'test-team',
      bindProject: 'test-cc',
      harness: 'codex',
      workDir: '/tmp/test',
    });
    expect(manifest.collaboration).toBe(true);
  });

  it('respects collaboration=false', async () => {
    const { manifest } = await svc.createTeam({
      displayName: 'solo-team',
      bindProject: 'solo-cc',
      harness: 'gemini',
      workDir: '/tmp/solo',
      collaboration: false,
    });
    expect(manifest.collaboration).toBe(false);
  });

  it('generates unique slug on collision', async () => {
    const { slug: s1 } = await svc.createTeam({ displayName: '团队A', bindProject: 'alpha', harness: 'claudecode', workDir: '/tmp/a' });
    const { slug: s2 } = await svc.createTeam({ displayName: '团队A', bindProject: 'alpha-2', harness: 'claudecode', workDir: '/tmp/b' });
    expect(s1).toBe('alpha');
    expect(s2).toBe('alpha-2');
  });

  it('throws if displayName missing', async () => {
    await expect(svc.createTeam({ displayName: '', bindProject: 'p', harness: 'codex', workDir: '/tmp' }))
      .rejects.toThrow('displayName is required');
  });
});

// ---------------------------------------------------------------------------
describe('listTeams / readTeamManifest', () => {
  it('returns empty array when no teams', async () => {
    expect(await svc.listTeams()).toEqual([]);
  });

  it('lists created teams sorted by createdAt desc', async () => {
    await svc.createTeam({ displayName: '团队A', bindProject: 'team-a', harness: 'claudecode', workDir: '/tmp/a' });
    await new Promise((r) => setTimeout(r, 10));
    await svc.createTeam({ displayName: '团队B', bindProject: 'team-b', harness: 'codex', workDir: '/tmp/b' });
    const teams = await svc.listTeams();
    expect(teams[0].slug).toBe('team-b');
    expect(teams[1].slug).toBe('team-a');
  });

  it('throws for non-existent team', async () => {
    await expect(svc.readTeamManifest('no-such-team')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
describe('updateTeam', () => {
  it('updates color and collaboration', async () => {
    const { slug } = await svc.createTeam({ displayName: 'upd-team', bindProject: 'p', harness: 'qoder', workDir: '/tmp/u' });
    const updated = await svc.updateTeam(slug, { color: 'rose', collaboration: false });
    expect(updated.color).toBe('rose');
    expect(updated.collaboration).toBe(false);

    // persisted
    const reread = await svc.readTeamManifest(slug);
    expect(reread.collaboration).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('deleteTeam', () => {
  it('archives team directory by default', async () => {
    const { slug, manifest } = await svc.createTeam({ displayName: 'del-team', bindProject: 'p', harness: 'claudecode', workDir: '/tmp/d' });
    expect(fs.existsSync(manifest.rootPath)).toBe(true);
    await svc.deleteTeam(slug);
    expect(fs.existsSync(manifest.rootPath)).toBe(false);
    // archived dir starts with .archived-
    const archived = fs.readdirSync(path.join(tmpDir, 'teams')).find((e) => e.startsWith('.archived-'));
    expect(archived).toBeTruthy();
  });

  it('deletes files when deleteFiles=true', async () => {
    const { slug, manifest } = await svc.createTeam({ displayName: 'del2', bindProject: 'p', harness: 'claudecode', workDir: '/tmp/d2' });
    await svc.deleteTeam(slug, { deleteFiles: true });
    expect(fs.existsSync(manifest.rootPath)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('tasks CRUD', () => {
  let teamSlug: string;

  beforeEach(async () => {
    const { slug } = await svc.createTeam({ displayName: 'task-team', bindProject: 'p', harness: 'claudecode', workDir: '/tmp/t' });
    teamSlug = slug;
  });

  it('createTask returns task with generated id', async () => {
    const task = await svc.createTask(teamSlug, { title: 'fix bug', description: 'desc' });
    expect(task.id).toMatch(/^t_/);
    expect(task.title).toBe('fix bug');
    expect(task.status).toBe('todo');
    expect(task.assignee).toBeNull();
    expect(task.result).toBeNull();
  });

  it('readTasks returns all tasks', async () => {
    await svc.createTask(teamSlug, { title: 'task-1' });
    await svc.createTask(teamSlug, { title: 'task-2' });
    const tasks = await svc.readTasks(teamSlug);
    expect(tasks).toHaveLength(2);
  });

  it('patchTask updates fields', async () => {
    const t = await svc.createTask(teamSlug, { title: 'original' });
    const patched = await svc.patchTask(teamSlug, t.id, { status: 'doing', assignee: 'other-team' });
    expect(patched.status).toBe('doing');
    expect(patched.assignee).toBe('other-team');
    expect(patched.id).toBe(t.id);
  });

  it('patchTask supports result field', async () => {
    const t = await svc.createTask(teamSlug, { title: 'to complete' });
    const done = await svc.patchTask(teamSlug, t.id, { status: 'done', result: 'done PR #42' });
    expect(done.result).toBe('done PR #42');
    expect(done.status).toBe('done');
  });

  it('deleteTask removes task', async () => {
    const t = await svc.createTask(teamSlug, { title: 'to delete' });
    expect(await svc.deleteTask(teamSlug, t.id)).toBe(true);
    expect(await svc.readTasks(teamSlug)).toHaveLength(0);
  });

  it('deleteTask returns false for unknown id', async () => {
    expect(await svc.deleteTask(teamSlug, 'non-existent')).toBe(false);
  });

  it('createTask throws if title missing', async () => {
    await expect(svc.createTask(teamSlug, { title: '' })).rejects.toThrow('title is required');
  });
});

