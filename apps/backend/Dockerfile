# Development-oriented image: the whole workspace is mounted and run with tsx
# watch, so `docker compose up --build` is the only command a developer needs.
FROM node:22-bookworm-slim

# Prisma's query engine needs openssl.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@11.21.0 --activate

WORKDIR /app

# Copy manifests first so the dependency layer caches.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/backend/package.json ./apps/backend/

RUN pnpm install --filter @enjo/backend... --no-frozen-lockfile

COPY packages/shared ./packages/shared
COPY apps/backend ./apps/backend

WORKDIR /app/apps/backend
RUN pnpm exec prisma generate

EXPOSE 3000

COPY apps/backend/docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["pnpm", "dev"]
