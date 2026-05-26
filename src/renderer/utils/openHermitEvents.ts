export const OPEN_HERMIT_EVENTS = {
  providersChanged: 'openhermit:providers-changed',
  teamsChanged: 'openhermit:teams-changed',
  runtimeRestarted: 'openhermit:runtime-restarted',
} as const;

export function emitOpenHermitEvent(eventName: string): void {
  window.dispatchEvent(new Event(eventName));
}
