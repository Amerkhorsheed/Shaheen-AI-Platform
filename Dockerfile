# syntax=docker/dockerfile:1

# ---------- Stage 1: dependencies ----------
# The compiler toolchain is needed to build native modules but must not ship
# in the runtime image.
FROM node:20-bookworm-slim AS deps

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---------- Stage 2: runtime ----------
FROM node:20-bookworm-slim AS runtime

# dumb-init reaps zombies and forwards SIGTERM, so the graceful shutdown
# handler in server/index.js actually runs on `docker compose down`.
RUN apt-get update && apt-get install -y --no-install-recommends \
      dumb-init ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0

WORKDIR /app

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node server/ ./server/
COPY --chown=node:node client/dist/ ./client/dist/
COPY --chown=node:node client/src/assets/ ./client/src/assets/
COPY --chown=node:node client/public/ ./client/public/

# Never run the application as root.
USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server/index.js"]
