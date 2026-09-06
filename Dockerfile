FROM node:20-bookworm-slim

# Install system dependencies needed for native modules (SQLite / canvas)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency specifications
COPY package*.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy server code, client built assets, and brand assets
COPY server/ ./server/
COPY client/dist/ ./client/dist/
COPY client/src/assets/ ./client/src/assets/
COPY client/public/ ./client/public/
COPY qomariah-arabic-font/ ./qomariah-arabic-font/

# Default Environment Variables
ENV PORT=3001
ENV NODE_ENV=production
ENV LM_STUDIO_URL=http://host.docker.internal:1234/v1

EXPOSE 3001

CMD ["node", "server/index.js"]
