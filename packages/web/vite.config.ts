import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The dev server proxies API and engine WebSocket calls to the backend (npm run dev starts both).
export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ['development'] },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', ws: true },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
