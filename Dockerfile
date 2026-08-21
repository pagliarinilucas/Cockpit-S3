# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Cockpit S3 — single image: builds the Vue SPA, then runs the Elysia/Bun API
# which also serves the built SPA (same origin → no CORS, one port, one volume).
# ─────────────────────────────────────────────────────────────────────────────

# 1) Build the frontend
FROM oven/bun:1 AS web
WORKDIR /web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ ./
# O SPA importa os módulos que interpretam o formato xlsx direto da API, via
# alias @sheet (ver vite.config.ts). São puros e são os MESMOS nos dois lados —
# duplicá-los faria servidor e navegador divergirem no significado do arquivo.
# Por isso a pasta precisa existir aqui no caminho relativo que o alias aponta.
COPY api/src/sheet/ /api/src/sheet/
RUN bun run build            # → /web/dist

# 2) Runtime: API + static SPA
FROM oven/bun:1 AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    DB_PATH=/data/cockpit.sqlite \
    WEB_DIR=/app/public \
    PORT=3000

# poppler-utils: gera miniaturas de PDF (pdftoppm) usadas pelo endpoint /thumb
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# API deps (production only — Bun runs the TS sources directly)
COPY api/package.json api/bun.lock ./
RUN bun install --frozen-lockfile --production

# API source + built SPA
COPY api/ ./
COPY --from=web /web/dist ./public

RUN mkdir -p /data
EXPOSE 3000

# Lightweight healthcheck against the API
HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "src/index.ts"]
