import { HttpAPIClient } from './httpClient';

import type { ElectronAPI } from '@shared/types/api';

function getHttpBaseUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const explicitPort = params.get('port');
  if (explicitPort) {
    return `http://127.0.0.1:${parseInt(explicitPort, 10)}`;
  }
  // Dev mode: frontend (5174) and backend (3456) run on different ports
  // Production: served by the backend on the same port
  const backendPort = 3456;
  if (window.location.port && window.location.port !== String(backendPort)) {
    return `http://${window.location.hostname}:${backendPort}`;
  }
  return window.location.origin;
}

export const api: ElectronAPI = new HttpAPIClient(getHttpBaseUrl());
