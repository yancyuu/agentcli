/**
 * Vitest setup file.
 * Runs before each test file.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, expect, vi } from 'vitest';

// Polyfill localStorage for happy-dom 20.x which exposes an empty object
// instead of a Storage instance in the vitest environment.
if (!globalThis.localStorage?.getItem) {
  const store: Record<string, string> = {};
  const storage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, writable: true });
}

// Mock Sentry Electron SDK — it requires the real `electron` package at import
// time which is unavailable in the vitest/happy-dom environment.
const sentryNoOp = {
  init: vi.fn(),
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
  withScope: vi.fn((fn: (scope: unknown) => void) => fn({ setContext: vi.fn() })),
  browserTracingIntegration: vi.fn(() => ({ name: 'BrowserTracing', setup: vi.fn(), afterAllSetup: vi.fn() })),
};
vi.mock('@sentry/electron/main', () => sentryNoOp);
vi.mock('@sentry/electron/renderer', () => sentryNoOp);
vi.mock('@sentry/react', () => sentryNoOp);

// Mock HOME for tests that need a predictable home path. It must be writable:
// some services persist state in best-effort background writes after a test has
// already reset path overrides.
const testHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-teams-vitest-home-'));
vi.stubEnv('HOME', testHomeDir);
process.once('exit', () => {
  fs.rmSync(testHomeDir, { recursive: true, force: true });
});

let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

function formatConsoleCall(args: unknown[]): string {
  return args
    .map((arg) => {
      if (arg instanceof Error) {
        return arg.message;
      }
      return String(arg);
    })
    .join(' ');
}

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  const unexpectedErrors = errorSpy.mock.calls.map(formatConsoleCall);
  const unexpectedWarnings = warnSpy.mock.calls.map(formatConsoleCall);

  errorSpy.mockRestore();
  warnSpy.mockRestore();

  expect(
    unexpectedErrors,
    `Unexpected console.error calls:\n${unexpectedErrors.join('\n')}`
  ).toEqual([]);
  expect(
    unexpectedWarnings,
    `Unexpected console.warn calls:\n${unexpectedWarnings.join('\n')}`
  ).toEqual([]);
});
