import './index.css';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App';
import { initSentryRenderer } from './sentry';
import { initializeNotificationListeners } from './store';

declare global {
  interface Window {
    __claudeTeamsUiDidInit?: boolean;
  }
}

// Sentry must be initialised before React renders.
initSentryRenderer();

if (!window.__claudeTeamsUiDidInit) {
  window.__claudeTeamsUiDidInit = true;
  initializeNotificationListeners();
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
