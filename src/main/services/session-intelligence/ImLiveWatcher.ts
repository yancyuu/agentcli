/**
 * Live IM worker watcher — turns hermit-bridge's on-disk session store into a
 * push signal the renderer can render.
 *
 * hermit-bridge writes one JSON file per project at
 * `<hermitHome>/hermit-bridge/data/sessions/<project>_<hash>.json` whenever an
 * IM-driven agent turn happens. This watcher observes that directory and, on
 * any change (debounced) plus a 5s watchdog, reparses every file into live
 * workers via {@link parseHermitBridgeSessions} → {@link detectImWorkers} and
 * pushes the result through the injected `emit` callback (wired to
 * `broadcastSse('im-live-workers', …)` in server.ts).
 *
 * The IO/timer surface lives here; all of the meaning (what a "worker" is, what
 * state it is in) is owned by the pure modules this calls, which is where the
 * tests are. `emit` is injected so this module never imports server.ts.
 */

import { watch, type FSWatcher } from 'fs';
import { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';

import type { ImLiveWorker } from '@shared/types/imLiveWorker';

import { detectImWorkers } from './detectImWorkers';
import { parseHermitBridgeSessions } from './hermitBridgeSessionStore';

export const IM_LIVE_WATCH_DEBOUNCE_MS = 200;
export const IM_LIVE_WATCH_INTERVAL_MS = 5_000;

/**
 * hermit-bridge sessions dir. Mirrors the canonical `hermitHome()` used across
 * the codebase (`HERMIT_HOME || ~/.hermit`) — already `os.homedir()` based, so
 * it is Windows-safe.
 */
export function defaultImSessionsDir(
  hermitHome: string = process.env.HERMIT_HOME ?? path.join(os.homedir(), '.hermit')
): string {
  return path.join(hermitHome, 'hermit-bridge', 'data', 'sessions');
}

export interface ImLiveWatcherOptions {
  sessionsDir: string;
  /** Push callback — wired to `broadcastSse('im-live-workers', workers)`. */
  emit: (workers: ImLiveWorker[]) => void;
  now?: () => number;
  debounceMs?: number;
  intervalMs?: number;
}

export class ImLiveWatcher {
  private readonly sessionsDir: string;
  private readonly emit: (workers: ImLiveWorker[]) => void;
  private readonly now: () => number;
  private readonly debounceMs: number;
  private readonly intervalMs: number;

  private fsWatcher: FSWatcher | null = null;
  private interval: NodeJS.Timeout | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(opts: ImLiveWatcherOptions) {
    this.sessionsDir = opts.sessionsDir;
    this.emit = opts.emit;
    this.now = opts.now ?? Date.now;
    this.debounceMs = opts.debounceMs ?? IM_LIVE_WATCH_DEBOUNCE_MS;
    this.intervalMs = opts.intervalMs ?? IM_LIVE_WATCH_INTERVAL_MS;
  }

  /** Begin watching: an immediate scan, a debounced fs.watch, and a watchdog interval. */
  start(): void {
    if (this.running) return;
    this.running = true;
    void this.scan();
    this.attachFsWatch();
    this.interval = setInterval(() => void this.scan(), this.intervalMs);
  }

  private attachFsWatch(): void {
    if (this.fsWatcher) return;
    try {
      this.fsWatcher = watch(this.sessionsDir, () => this.scheduleScan());
    } catch {
      // Dir not present yet — the watchdog interval will re-scan and re-attach
      // once hermit-bridge creates it (see the self-heal branch in scan()).
      this.fsWatcher = null;
    }
  }

  private scheduleScan(): void {
    if (this.debounceTimer) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.scan();
    }, this.debounceMs);
  }

  /** Read every `*.json` in the dir, detect live workers, emit them. */
  async scan(): Promise<void> {
    let files: string[];
    try {
      files = await fsp.readdir(this.sessionsDir);
    } catch {
      // Dir missing/unreadable → no IM workers exist right now.
      this.emit([]);
      return;
    }

    // Self-heal: if the dir (re)appeared after we failed to attach fs.watch,
    // attach now so changes are picked up instantly instead of on the watchdog.
    if (this.running && !this.fsWatcher) this.attachFsWatch();

    const stores = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await fsp.readFile(path.join(this.sessionsDir, file), 'utf-8');
        const parsed = parseHermitBridgeSessions(JSON.parse(raw), file);
        if (parsed) stores.push(parsed);
      } catch {
        // Skip unreadable / corrupt / partially-written files — next scan retries.
      }
    }

    this.emit(detectImWorkers(stores, this.now()));
  }

  stop(): void {
    this.running = false;
    this.fsWatcher?.close();
    this.fsWatcher = null;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}
