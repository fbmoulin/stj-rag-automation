## Multi-stage Dockerfile
FROM node:20-alpine AS builder
WORKDIR /usr/src/app

# Enable corepack for pnpm (avoids global npm install)
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

# Copy package files first for better caching
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches

RUN pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm build

## Production image
FROM node:20-alpine AS runtime
WORKDIR /usr/src/app

RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

COPY package.json pnpm-lock.yaml ./
COPY patches ./patches

RUN pnpm install --prod --frozen-lockfile

# Copy built assets from builder
COPY --from=builder /usr/src/app/dist ./dist

ENV NODE_ENV=production
EXPOSE 3000

# Run as non-root user (node user is built into node:alpine)
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

STOPSIGNAL SIGTERM

CMD ["node", "dist/index.js"]
