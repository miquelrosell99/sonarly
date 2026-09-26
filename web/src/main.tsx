import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.js';
import { useTheme } from './stores/themeStore.js';
import { NotificationProvider } from './contexts/NotificationContext.js';
import './index.css';

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <NotificationProvider>
        <App />
      </NotificationProvider>
    </QueryClientProvider>
  </React.StrictMode>
);

// Seed the store from the persisted snapshot BEFORE the first apply() so
// hydration re-applies the exact classes the inline bootstrap already put on
// <html> — a cold boot must not re-theme the first paint.
useTheme.getState().loadPersisted();
useTheme.getState().apply();

window
  .matchMedia('(prefers-color-scheme: dark)')
  .addEventListener('change', () => useTheme.getState().apply());
