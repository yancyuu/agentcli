import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('idb-keyval', () => ({
  get: vi.fn(async () => undefined),
  set: vi.fn(async () => undefined),
}));

async function loadStorage() {
  vi.resetModules();
  return import('../../../src/renderer/services/commentReadStorage');
}

describe('commentReadStorage targeted task subscriptions', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('notifies only subscribers for the changed task plus global subscribers', async () => {
    const storage = await loadStorage();
    const taskA = vi.fn();
    const taskB = vi.fn();
    const global = vi.fn();

    const unsubscribeA = storage.subscribeTask('team-1', 'task-a', taskA);
    const unsubscribeB = storage.subscribeTask('team-1', 'task-b', taskB);
    const unsubscribeGlobal = storage.subscribe(global);

    storage.markCommentsRead('team-1', 'task-a', ['comment-1']);

    expect(taskA).toHaveBeenCalledTimes(1);
    expect(taskB).not.toHaveBeenCalled();
    expect(global).toHaveBeenCalledTimes(1);

    storage.markCommentsRead('team-1', 'task-a', ['comment-1']);

    expect(taskA).toHaveBeenCalledTimes(1);
    expect(taskB).not.toHaveBeenCalled();
    expect(global).toHaveBeenCalledTimes(1);

    unsubscribeA();
    unsubscribeB();
    unsubscribeGlobal();
  });

  it('returns stable per-task snapshots for unrelated task updates', async () => {
    const storage = await loadStorage();

    storage.markCommentsRead('team-1', 'task-a', ['comment-1']);
    const before = storage.getTaskSnapshot('team-1', 'task-a');

    storage.markCommentsRead('team-1', 'task-b', ['comment-2']);

    expect(storage.getTaskSnapshot('team-1', 'task-a')).toBe(before);
    expect(storage.getTaskSnapshot('team-1', 'task-b')?.readIds).toEqual(['comment-2']);
  });
});
