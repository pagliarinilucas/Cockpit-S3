import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Runs fully on the Bun runtime: `bun run dev` / `bun run build`.
// `/api/*` is proxied to the backend you'll build at http://localhost:3000.
const webPort = Number(process.env.WEB_PORT ?? 4200);
const apiPort = Number(process.env.API_PORT ?? 3000);

export default defineConfig({
  plugins: [vue()],
  optimizeDeps: {
    // @cockpit/sheet é código-fonte TypeScript ligado por symlink, não uma
    // dependência publicada: pré-empacotar transformaria o mesmo arquivo em duas
    // cópias e faria o HMR parar de ver as mudanças.
    exclude: ['@cockpit/sheet'],
  },
  server: {
    // O pacote compartilhado mora fora da raiz do web/, onde o vite bloqueia a
    // leitura por padrão.
    fs: { allow: ['..'] },
    port: webPort,
    proxy: {
      // Só HTTP: o WebSocket do editor não passa por aqui. O proxy de WS do vite
      // não repassa o upgrade neste ambiente, então em dev o cliente liga direto
      // na API (ver wsOrigin() em src/sheet/session.ts).
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
