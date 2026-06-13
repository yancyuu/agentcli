/**
 * Tests: TeamProvisioningService — dispatchTask 协同开关
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { HERMIT_OPS_GUIDE_URL } from '@main/services/teams-mvp/OpsRunbookContext';
import { TeamProvisioningService } from '@main/services/teams-mvp/TeamProvisioningService';
import { TeamWorkspaceService } from '@main/services/teams-mvp/TeamWorkspaceService';

// ---------------------------------------------------------------------------
// Minimal mocks for CcConnectClient and CcConnectBridge
// ---------------------------------------------------------------------------

function makeCcClient() {
  return {
    createProject: vi.fn().mockResolvedValue({ message: 'ok', restart_required: false }),
    restart: vi.fn().mockResolvedValue(undefined),
    getProject: vi.fn().mockResolvedValue({ name: 'mock', agent_type: 'claudecode', platforms: [], work_dir: '/tmp', heartbeat: {}, settings: {}, sessions_count: 0, active_session_keys: [], agent_mode: 'auto' }),
    getStatus: vi.fn().mockResolvedValue({ version: '1.0', uptime_seconds: 0, projects_count: 0, platforms_connected: 0 }),
    listProjects: vi.fn().mockResolvedValue([]),
  };
}

function makeBridge() {
  return {
    sendUserMessage: vi.fn(),
    connected: true,
  };
}

// ---------------------------------------------------------------------------

let tmpDir: string;
let workspace: TeamWorkspaceService;
let svc: TeamProvisioningService;
let mockCc: ReturnType<typeof makeCcClient>;
let mockBridge: ReturnType<typeof makeBridge>;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermit-svc-test-'));
  process.env.HERMIT_HOME = tmpDir;
  workspace = new TeamWorkspaceService();
  mockCc = makeCcClient();
  mockBridge = makeBridge();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc = new TeamProvisioningService(mockCc as any, mockBridge as any, workspace);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.HERMIT_HOME;
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
describe('createTeam', () => {
  it('creates local manifest without cc project when createCcProject=false', async () => {
    const { slug } = await svc.createTeam({
      displayName: 'no-cc',
      bindProject: 'no-cc-project',
      harness: 'claudecode',
      workDir: path.join(tmpDir, 'work'),
      createCcProject: false,
    });
    expect(slug).toBeTruthy();
    expect(mockCc.createProject).not.toHaveBeenCalled();
  });

  it('calls cc.createProject when createCcProject=true (default)', async () => {
    await svc.createTeam({
      displayName: 'with-cc',
      bindProject: 'with-cc-project',
      harness: 'codex',
      workDir: path.join(tmpDir, 'work2'),
      createCcProject: true,
    });
    expect(mockCc.createProject).toHaveBeenCalledWith(
      'with-cc-project', 'codex', path.join(tmpDir, 'work2'), 'bridge', {}
    );
  });

  it('uses restart hook when project creation requires cc-connect restart', async () => {
    mockCc.createProject.mockResolvedValueOnce({ message: 'ok', restart_required: true });
    const restartCcConnect = vi.fn().mockResolvedValue(undefined);
    const hookedSvc = new TeamProvisioningService(
      mockCc as any,
      mockBridge as any,
      workspace,
      { restartCcConnect }
    );

    await hookedSvc.createTeam({
      displayName: 'restart-team',
      bindProject: 'restart-project',
      harness: 'codex',
      workDir: path.join(tmpDir, 'restart-work'),
      createCcProject: true,
    });

    expect(restartCcConnect).toHaveBeenCalledTimes(1);
    expect(mockCc.restart).not.toHaveBeenCalled();
  });

  it('injects MCP config and ops runbook context for claudecode harness', async () => {
    const workDir = path.join(tmpDir, 'mcp-work');
    fs.mkdirSync(workDir, { recursive: true });
    await svc.createTeam({
      displayName: 'mcp-team',
      bindProject: 'mcp-project',
      harness: 'claudecode',
      workDir,
      createCcProject: false,
    });
    const settingsPath = path.join(workDir, '.claude', 'settings.json');
    expect(fs.existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(settings.mcpServers['hermit-tasks']).toBeDefined();
    expect(settings.mcpServers['hermit-tasks'].url).toContain('/mcp');

    const claudeMd = fs.readFileSync(path.join(workDir, 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toContain('## Hermit Team Context');
    expect(claudeMd).toContain('## Hermit Ops Runbook Context');
    expect(claudeMd).toContain(HERMIT_OPS_GUIDE_URL);
    expect(claudeMd).toContain('/hermit:doctor');
    expect(claudeMd).toContain('/hermit:loop-scan');
  });

  it('does NOT inject MCP config or CLAUDE.md instructions for codex harness', async () => {
    const workDir = path.join(tmpDir, 'codex-work');
    fs.mkdirSync(workDir, { recursive: true });
    await svc.createTeam({
      displayName: 'codex-team',
      bindProject: 'codex-project',
      harness: 'codex',
      workDir,
      createCcProject: false,
    });
    const settingsPath = path.join(workDir, '.claude', 'settings.json');
    expect(fs.existsSync(settingsPath)).toBe(false);
    expect(fs.existsSync(path.join(workDir, 'CLAUDE.md'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('dispatchTask — 协同开关', () => {
  async function setupTwoTeams(sourceCollab: boolean, targetCollab: boolean) {
    const { slug: sourceSlug } = await svc.createTeam({
      displayName: 'source-team',
      bindProject: 'source-cc',
      harness: 'claudecode',
      workDir: path.join(tmpDir, 'source'),
      collaboration: sourceCollab,
      createCcProject: false,
    });
    const { slug: targetSlug } = await svc.createTeam({
      displayName: 'target-team',
      bindProject: 'target-cc',
      harness: 'codex',
      workDir: path.join(tmpDir, 'target'),
      collaboration: targetCollab,
      createCcProject: false,
    });
    return { sourceSlug, targetSlug };
  }

  it('sends Bridge message when both teams have collaboration=true', async () => {
    const { sourceSlug, targetSlug } = await setupTwoTeams(true, true);
    const task = await svc.createTask(sourceSlug, { title: 'cross task', assignee: targetSlug });
    await svc.dispatchTask(sourceSlug, task);
    expect(mockBridge.sendUserMessage).toHaveBeenCalledOnce();
    const call = mockBridge.sendUserMessage.mock.calls[0][0];
    expect(call.project).toBe('target-cc');
    expect(call.content).toContain(task.id);
    expect(call.content).toContain('cross task');
  });

  it('skips dispatch when source team collaboration=false', async () => {
    const { sourceSlug, targetSlug } = await setupTwoTeams(false, true);
    const task = await svc.createTask(sourceSlug, { title: 'solo task', assignee: targetSlug });
    await svc.dispatchTask(sourceSlug, task);
    expect(mockBridge.sendUserMessage).not.toHaveBeenCalled();
  });

  it('skips dispatch when target team collaboration=false', async () => {
    const { sourceSlug, targetSlug } = await setupTwoTeams(true, false);
    const task = await svc.createTask(sourceSlug, { title: 'blocked task', assignee: targetSlug });
    await svc.dispatchTask(sourceSlug, task);
    expect(mockBridge.sendUserMessage).not.toHaveBeenCalled();
  });

  it('skips dispatch when task has no assignee', async () => {
    const { sourceSlug } = await setupTwoTeams(true, true);
    const task = await svc.createTask(sourceSlug, { title: 'unassigned' });
    await svc.dispatchTask(sourceSlug, task);
    expect(mockBridge.sendUserMessage).not.toHaveBeenCalled();
  });

  it('does not throw when target team does not exist', async () => {
    const { slug: sourceSlug } = await svc.createTeam({
      displayName: 'source',
      bindProject: 'src-cc',
      harness: 'claudecode',
      workDir: path.join(tmpDir, 'src'),
      createCcProject: false,
    });
    const task = await svc.createTask(sourceSlug, { title: 'ghost task', assignee: 'non-existent-team' });
    await expect(svc.dispatchTask(sourceSlug, task)).resolves.toBeUndefined();
    expect(mockBridge.sendUserMessage).not.toHaveBeenCalled();
  });
});
