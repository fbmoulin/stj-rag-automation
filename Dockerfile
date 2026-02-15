## Multi-stage Dockerfile
FROM node:20-alpine AS builder
WORKDIR /usr/src/app

# Install pnpm
RUN npm install -g pnpm@8

# Copy package files first for better caching
COPY package.json pnpm-lock.yaml ./
COPY .npmrc ./

RUN pnpm install

# Copy source and build
COPY . .
RUN pnpm build

## Production image
FROM node:20-alpine AS runtime
WORKDIR /usr/src/app

# Install minimal runtime deps
RUN npm install -g pnpm@8
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod

# Copy built assets
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/node_modules ./node_modules

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]

