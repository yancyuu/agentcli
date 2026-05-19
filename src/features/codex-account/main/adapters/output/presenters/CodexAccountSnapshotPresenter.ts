import {
  CODEX_ACCOUNT_SNAPSHOT_CHANGED,
  type CodexAccountSnapshotDto,
} from '@features/codex-account/contracts';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type BrowserWindow = unknown;

export class CodexAccountSnapshotPresenter {
  private mainWindow: BrowserWindow | null = null;

  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
  }

  publish(snapshot: CodexAccountSnapshotDto): void {
    // Web mode: broadcast via SSE instead of Electron IPC
    if (typeof window === 'undefined') {
      try {
        const { broadcastEvent } = require('@main/http/events');
        broadcastEvent(CODEX_ACCOUNT_SNAPSHOT_CHANGED, snapshot);
      } catch {
        // SSE not available (e.g. during tests)
      }
    }
  }
}
