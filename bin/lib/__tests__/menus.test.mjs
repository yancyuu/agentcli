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
