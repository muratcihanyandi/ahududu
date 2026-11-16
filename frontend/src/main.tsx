import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { updates } from './services/updates';
import { applySafeAreaInsets, watchSafeAreaInsets } from './services/safeArea';
import { applySystemBarStyle } from './services/systemBars';
import './index.css';

// Dark status-bar icons on the light app background (native shell only).
applySystemBarStyle();

// Measure safe-area insets before the first paint so the header never sits
// under the status bar, even on WebView builds where env() reports 0.
applySafeAreaInsets();
watchSafeAreaInsets();

// Start watching for a newly deployed build before the app renders,
// so a reload can happen without the user ever seeing a stale screen.
updates.init();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
