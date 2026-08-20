import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Runs fully on the Bun runtime: `bun run dev` / `bun run build`.
// `/api/*` is proxied to the backend you'll build at http://localhost:3000.
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 4200,
    proxy: {
      // O WebSocket do editor precisa de entrada própria com target ws://; no
      // proxy HTTP genérico o upgrade não acontece. Vem ANTES de '/api' porque
      // a primeira chave que casa é a que vale.
      // Só HTTP: o WebSocket do editor não passa por aqui. O proxy de WS do vite
      // não repassa o upgrade neste ambiente, então em dev o cliente liga direto
      // na API (ver wsOrigin() em src/sheet/session.ts).
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
