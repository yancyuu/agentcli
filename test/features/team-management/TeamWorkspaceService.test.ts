/**
 * Tests: TeamWorkspaceService — 团队本地存储 CRUD
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { TeamWorkspaceService } from '@main/services/team-management/TeamWorkspaceService';

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
    expect(manifest.workDir).toBe('/tmp/frontend');
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

  it('preserves Chinese displayName while using ASCII bindProject as slug', async () => {
    const { slug, manifest } = await svc.createTeam({
      displayName: '产品经理团队',
      bindProject: 'team-abcd',
      harness: 'claudecode',
      workDir: '/tmp/pm',
    });

    expect(slug).toBe('team-abcd');
    expect(manifest.displayName).toBe('产品经理团队');
    expect(manifest.bindProject).toBe('team-abcd');
    expect(fs.existsSync(path.join(tmpDir, 'teams', 'team'))).toBe(false);
  });

  it('rejects invalid bindProject before creating a fallback team directory', async () => {
    await expect(
      svc.createTeam({
        displayName: '产品经理团队',
        bindProject: '产品经理团队',
        harness: 'claudecode',
        workDir: '/tmp/pm',
      })
    ).rejects.toThrow(/bindProject/);

    await expect(
      svc.createTeam({
        displayName: 'Bad Project',
        bindProject: 'Bad Project',
        harness: 'claudecode',
        workDir: '/tmp/bad',
      })
    ).rejects.toThrow(/bindProject/);

    expect(fs.existsSync(path.join(tmpDir, 'teams', 'team'))).toBe(false);
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


  it('resolves legacy slug by bindProject', async () => {
    const root = path.join(tmpDir, 'teams', 'team');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
      path.join(root, 'team.json'),
      JSON.stringify(
        {
          schemaVersion: 2,
          slug: 'team',
          displayName: '产品经理团队',
          bindProject: 'pm-team-1234',
          harness: 'claudecode',
          workDir: '/tmp/pm',
          collaboration: true,
          rootPath: root,
          createdAt: new Date().toISOString(),
        },
        null,
        2
      )
    );

    expect((await svc.readTeamManifest('team')).bindProject).toBe('pm-team-1234');
    expect((await svc.readTeamManifest('pm-team-1234')).slug).toBe('team');
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
  it('soft-deletes team metadata by default without moving local files', async () => {
    const { slug, manifest } = await svc.createTeam({ displayName: 'del-team', bindProject: 'p', harness: 'claudecode', workDir: '/tmp/d' });
    expect(fs.existsSync(manifest.rootPath)).toBe(true);
    await svc.deleteTeam(slug);
    expect(fs.existsSync(manifest.rootPath)).toBe(true);
    const deleted = await svc.readTeamManifest(slug);
    expect(deleted.deletedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const archived = fs.readdirSync(path.join(tmpDir, 'teams')).find((e) => e.startsWith('.archived-'));
    expect(archived).toBeUndefined();
  });

  it('deletes files when deleteFiles=true', async () => {
    const { slug, manifest } = await svc.createTeam({ displayName: 'del2', bindProject: 'p', harness: 'claudecode', workDir: '/tmp/d2' });
    await svc.deleteTeam(slug, { deleteFiles: true });
    expect(fs.existsSync(manifest.rootPath)).toBe(false);
  });

  it('deletes legacy local directory when called with bindProject', async () => {
    const root = path.join(tmpDir, 'teams', 'team');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
      path.join(root, 'team.json'),
      JSON.stringify(
        {
          schemaVersion: 2,
          slug: 'team',
          displayName: '产品经理团队',
          bindProject: 'pm-team-1234',
          harness: 'claudecode',
          workDir: '/tmp/pm',
          collaboration: true,
          rootPath: root,
          createdAt: new Date().toISOString(),
        },
        null,
        2
      )
    );

    await svc.deleteTeam('pm-team-1234', { deleteFiles: true });
    expect(fs.existsSync(root)).toBe(false);
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

// ---------------------------------------------------------------------------
describe('messages', () => {
  it('resolves bindProject to the storage slug when appending and reading messages', async () => {
    const root = path.join(tmpDir, 'teams', 'team');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
      path.join(root, 'team.json'),
      JSON.stringify(
        {
          schemaVersion: 2,
          slug: 'team',
          displayName: '产品经理团队',
          bindProject: 'pm-team-1234',
          harness: 'claudecode',
          workDir: '/tmp/pm',
          collaboration: true,
          rootPath: root,
          createdAt: new Date().toISOString(),
        },
        null,
        2
      )
    );

    await svc.appendMessage('pm-team-1234', {
      from: 'user',
      content: 'hello from bound project',
    });

    expect(fs.existsSync(path.join(tmpDir, 'teams', 'pm-team-1234'))).toBe(false);
    const messages = await svc.readMessages('pm-team-1234');
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('hello from bound project');
  });

  it('routes raw external platform session keys via allow lists instead of creating feishu team dirs', async () => {
    const { slug } = await svc.createTeam({
      displayName: 'hermit开发',
      bindProject: 'hermit-dev',
      harness: 'claudecode',
      workDir: '/tmp/hermit',
    });
    await svc.updateTeam(slug, {
      platformAllowFrom: { feishu: 'ou_user' },
      platformAllowChat: { feishu: 'chat_A' },
    });

    await svc.appendMessage('feishu:chat_A:ou_user', {
      from: 'agent',
      content: 'routed from feishu',
      meta: { sessionKey: 'feishu:chat_A:ou_user' },
    });

    expect(fs.existsSync(path.join(tmpDir, 'teams', 'feishu:chat_A:ou_user'))).toBe(false);
    const messages = await svc.readMessages(slug);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('routed from feishu');
  });

  it('refuses to create message storage for unmapped raw external platform session keys', async () => {
    await expect(
      svc.appendMessage('feishu:chat_A:ou_user', {
        from: 'agent',
        content: 'should not create a feishu team directory',
      })
    ).rejects.toThrow(/外部平台 session_key/);

    expect(fs.existsSync(path.join(tmpDir, 'teams', 'feishu:chat_A:ou_user'))).toBe(false);
    await expect(svc.readMessages('feishu:chat_A:ou_user')).resolves.toEqual([]);
  });

  it('includes legacy feishu:* message directories that now map to a Hermit team', async () => {
    const { slug } = await svc.createTeam({
      displayName: 'hermit开发',
      bindProject: 'hermit-dev',
      harness: 'claudecode',
      workDir: '/tmp/hermit',
    });
    await svc.updateTeam(slug, {
      platformAllowFrom: { feishu: '*' },
      platformAllowChat: { feishu: '*' },
    });
    await svc.appendMessage(slug, { from: 'user', content: 'current message' });

    const legacyRoot = path.join(tmpDir, 'teams', 'feishu:chat_A:ou_user', 'messages');
    fs.mkdirSync(legacyRoot, { recursive: true });
    fs.writeFileSync(
      path.join(legacyRoot, 'group.jsonl'),
      JSON.stringify({
        id: 'legacy-1',
        ts: '2026-01-01T00:00:00.000Z',
        from: 'feishu:chat_A:ou_user',
        to: 'user',
        role: 'agent',
        content: 'legacy message',
        meta: { sessionKey: 'feishu:chat_A:ou_user' },
      }) + '\n'
    );

    const messages = await svc.readMessages(slug);
    expect(messages.map((message) => message.content)).toEqual(['legacy message', 'current message']);
  });
});

