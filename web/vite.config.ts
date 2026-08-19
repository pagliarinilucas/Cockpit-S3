import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Runs fully on the Bun runtime: `bun run dev` / `bun run build`.
// `/api/*` is proxied to the backend you'll build at http://localhost:3000.
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 4200,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
        ws: true,   // o editor de planilha usa WebSocket em /api/sheets
      },
    },
  },
});
