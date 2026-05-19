/** Sentry stub — web mode uses @sentry/react on the renderer side only. */

export function startMainSpan<T>(_name: string, fn: () => T, _attrs?: Record<string, unknown>): T {
  return fn();
}
