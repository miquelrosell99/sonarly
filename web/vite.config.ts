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
      rollupOptions: {
        output: {
          // Cache-friendly vendor chunks, split by independent release
          // cadence so a deploy only invalidates the chunks it touches:
          //   react   — react + react-dom + scheduler (~140 KB, ships rarely)
          //   tanstack— react-query + react-virtual (+ cores): the server-state
          //             and virtualization layers, versioned together
          //   dnd-kit — drag and drop (core + sortable + utilities)
          //   wouter  — router (tiny, stable API)
          //   zustand — client-state stores (tiny)
          // Everything else (app code) keeps Rollup's default per-route
          // chunks. Micro-dependencies without an independent release
          // cadence (e.g. clsx-style helpers) stay in their importer's chunk.
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return;
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
            if (id.includes('@tanstack')) return 'tanstack';
            if (id.includes('@dnd-kit')) return 'dnd-kit';
            if (id.includes('wouter')) return 'wouter';
            if (id.includes('zustand')) return 'zustand';
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
    },
  };
});
