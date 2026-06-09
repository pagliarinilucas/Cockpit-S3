import { defineConfig } from 'drizzle-kit';

// Codebase-first: o schema em src/db/schema.ts é a fonte da verdade.
// `bun run db:generate` gera SQL de migration em ./drizzle a partir das mudanças do schema.
// (No boot, o app garante o schema via CREATE TABLE IF NOT EXISTS em src/db.ts — ver nota lá.)
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DB_PATH ?? './data/cockpit.sqlite' },
});
