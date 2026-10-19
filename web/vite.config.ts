import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const allowedHosts = env.SONARLY_DEV_ALLOWED_HOSTS
    ? env.SONARLY_DEV_ALLOWED_HOSTS.split(',').map((h) => h.trim()).filter(Boolean)
    : [];

  return {
    plugins: [react()],
    resolve: {
      // The `@/` alias backs components.json (shadcn catalog) and its
      // tsconfig paths twin below.
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      allowedHosts,
      proxy: {
        // SONARLY_DEV_API overrides the API target for hosts where :3000 is
        // already taken by another service (e.g. open-archiver on atlas).
        '/api': env.SONARLY_DEV_API ?? 'http://localhost:3000',
        '/rest': env.SONARLY_DEV_API ?? 'http://localhost:3000',
      },
    },
    build: {
      outDir: 'dist',
      rollupOptions: {
        treeshake: {
          // Audit F19 (plan P8): the @dnd-kit packages declare no
          // `sideEffects` flag, so Rollup treats them as potentially
          // side-effectful and emits evaluation-order guards
          // (`import"./dnd-kit-*.js"`) into the entry chunk for the
          // entry ↔ LibraryView chunk cycle — dragging drag-and-drop back
          // onto first paint. They only export components/helpers consumed
          // via named imports, so marking them side-effect-free preserves
          // behavior and lets the lazy QueueModal/QueuePanel boundary hold.
          moduleSideEffects(id: string) {
            return !id.includes('@dnd-kit');
          },
        },
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
      // Playwright owns e2e/ (bridge-fixture.spec.ts is a browser spec, not
      // a vitest one).
      exclude: ['e2e/**', '**/node_modules/**', '**/dist/**'],
    },
  };
});
