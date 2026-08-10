#!/bin/sh
set -e

# The db service is healthy before we start, but the socket can still lag a
# moment. Retry the schema push a few times rather than crash-looping.
attempt=1
until pnpm exec prisma db push --skip-generate --accept-data-loss; do
  if [ "$attempt" -ge 10 ]; then
    echo "prisma db push failed after $attempt attempts" >&2
    exit 1
  fi
  echo "waiting for database (attempt $attempt)..."
  attempt=$((attempt + 1))
  sleep 2
done

# The Prisma schema is bind-mounted in development and can be newer than the
# client generated when the Docker image was built. Regenerate it on every
# container start so schema changes (for example Post.imageUrl) are available
# before the seed and API server run.
pnpm exec prisma generate

pnpm exec tsx prisma/seed.ts

exec "$@"
