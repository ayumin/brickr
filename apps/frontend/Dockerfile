# Development image: runs the Vite dev server bound to 0.0.0.0 so the host
# browser can reach it at http://localhost:5173.
FROM node:22-bookworm-slim

RUN corepack enable && corepack prepare pnpm@11.21.0 --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/frontend/package.json ./apps/frontend/

RUN pnpm install --filter @brickr/frontend... --no-frozen-lockfile

COPY packages/shared ./packages/shared
COPY apps/frontend ./apps/frontend

# Fail the image build if a future context change overwrites pnpm's links.
RUN test -x /app/apps/frontend/node_modules/.bin/vite

WORKDIR /app/apps/frontend

EXPOSE 5173

CMD ["pnpm", "dev", "--host", "0.0.0.0"]
