import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

// Runs fully on the Bun runtime: `bun run dev` / `bun run build`.
// `/api/*` is proxied to the backend you'll build at http://localhost:3000.
const sheetShared = fileURLToPath(new URL('../api/src/sheet', import.meta.url));

export default defineConfig({
  plugins: [vue()],
  resolve: {
    // O formato do xlsx (modelo, estilos, tema, formatação condicional e
    // geometria) é interpretado por módulos PUROS, sem nada de Node, e é o
    // mesmo código no servidor e no cliente. Duplicar isso faria os dois lados
    // divergirem justamente no que precisa casar: o que o arquivo significa.
    alias: { '@sheet': sheetShared },
  },
  server: {
    // Fora da raiz do web/ o vite bloqueia a leitura por padrão.
    fs: { allow: ['..'] },
    port: 4200,
    proxy: {
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
