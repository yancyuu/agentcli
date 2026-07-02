// menus.test.mjs — asserts the interactive menu exposes the actions users
// actually need. Guards the change from "立即扫描并上报一次" (incremental
// scan-once, which is rarely useful) to "立即全量上报（慎选）" (full re-upload,
// the common backfill path). Pure data assertions against menus.mjs.
import { describe, expect, it } from 'vitest';

import { LOCAL_COLLECTION_ACTIONS, NAV_ACTIONS, findMenuAction } from '../menus.mjs';

describe('menus — full-upload replaces incremental scan-once', () => {
  it('data-sync nav group offers a 全量上报 action marked 慎选', () => {
    const dataSync = NAV_ACTIONS.find((a) => a.id === 'data-sync');
    expect(dataSync, 'data-sync nav group must exist').toBeTruthy();
    const scan = dataSync.children.find((c) => c.id === 'scan');
    expect(scan, 'data-sync must have a scan child').toBeTruthy();
    // The incremental "扫描并上报一次" label is gone; the action is now full-upload.
    expect(scan.label).toMatch(/全量/);
    expect(scan.label).toMatch(/慎选/);
    expect(scan.label).not.toMatch(/扫描并上报一次/);
  });

  it('local-collection menu offers the same 全量上报 action', () => {
    const scan = findMenuAction(LOCAL_COLLECTION_ACTIONS, 'scan');
    expect(scan, 'local-collection must have a scan action').toBeTruthy();
    expect(scan.label).toMatch(/全量/);
    expect(scan.label).not.toMatch(/扫描并上报一次/);
  });
});

describe('menus — 本地工作台 lists the workbenches (fcb first, merged status)', () => {
  const web = NAV_ACTIONS.find((a) => a.id === 'web');

  it('merges the two status rows into a single workbench-status entry', () => {
    const ids = web.children.map((c) => c.id);
    expect(ids).toContain('workbench-status');
    // The old per-workbench status rows are gone — one merged entry replaces them.
    expect(ids).not.toContain('web-status');
    expect(ids).not.toContain('feishu-bridge-status');
  });

  it('keeps install-lark-cli under 本地工作台', () => {
    expect(web.children.map((c) => c.id)).toContain('install-lark-cli');
  });

  it('exposes both workbenches: 飞书 Codex 桥 first, then AgentCli 工作台', () => {
    const ids = web.children.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['toggle-feishu-bridge', 'toggle-web']));
    // 飞书桥是推荐主入口，排在 AgentCli 工作台之前。
    expect(ids.indexOf('toggle-feishu-bridge')).toBeLessThan(ids.indexOf('toggle-web'));
  });
});
