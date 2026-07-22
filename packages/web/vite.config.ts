import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const allowedHosts = env.SONARLY_DEV_ALLOWED_HOSTS
    ? env.SONARLY_DEV_ALLOWED_HOSTS.split(',').map((h) => h.trim()).filter(Boolean)
    : [];

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      allowedHosts,
      proxy: {
        '/api': 'http://localhost:3000',
        '/rest': 'http://localhost:3000',
      },
    },
    build: {
      outDir: 'dist',
    },
    test: {
      environment: 'jsdom',
    },
  };
});
