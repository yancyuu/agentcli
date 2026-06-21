import { useSyncExternalStore } from 'react';

import {
  getTaskSnapshot,
  getUnreadCount,
  subscribeTask,
} from '@renderer/services/commentReadStorage';

import type { TaskComment } from '@shared/types';

export function useUnreadCommentCount(
  teamName: string,
  taskId: string,
  comments: TaskComment[] | undefined
): number {
  const taskReadEntry = useSyncExternalStore(
    (listener) => subscribeTask(teamName, taskId, listener),
    () => getTaskSnapshot(teamName, taskId),
    () => getTaskSnapshot(teamName, taskId)
  );
  return getUnreadCount(
    taskReadEntry ? { [`${teamName}/${taskId}`]: taskReadEntry } : {},
    teamName,
    taskId,
    comments ?? []
  );
}
