# syntax=docker/dockerfile:1

# Makutano Connect — SvelteKit (adapter-node) production image.
#
# Every secret is read at RUNTIME via $env/dynamic/private, so nothing sensitive is
# baked into the image and the same image promotes across environments unchanged.

# ---------- build stage ----------
FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

# ---------- runtime stage ----------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
WORKDIR /app

# Migrations and the Goldfinch import run with `docker compose exec`, so the scripts,
# the drizzle SQL and the schema they import must be in the image.
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
# The whole of src/lib, not a hand-picked file list.
#
# The tracking worker is a long-running process that imports the SAME server
# modules the web app does — the tracking service, the database layer, encryption,
# the environment. Naming them individually here was already fragile for the
# scripts, and it broke outright when the worker arrived: the image had no
# src/lib/server/tracking at all, so the container restart-looped on a module it
# could not find. This is source text and costs almost nothing in the image.
COPY --from=build /app/src/lib ./src/lib

# Run unprivileged.
USER node

EXPOSE 3000

# The app is healthy only when it can answer a request; adapter-node has no
# built-in healthcheck, so probe the login page (cheap, no database write).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "build/index.js"]
