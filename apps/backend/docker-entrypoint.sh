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

pnpm exec tsx prisma/seed.ts

exec "$@"
