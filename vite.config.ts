import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The Fastify API/SSE server runs on this port in dev; Vite proxies /api to it.
const API_TARGET = `http://127.0.0.1:${process.env.MC_PORT ?? 4317}`;

export default defineConfig({
  root: 'src/web',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // Covers both /api/* JSON routes and the /api/events SSE stream.
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
});
