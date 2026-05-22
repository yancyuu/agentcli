import './index.css';

import React from 'react';
import ReactDOM from 'react-dom/client';

import { NewApp } from './newapp/NewApp';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <NewApp />
  </React.StrictMode>
);
