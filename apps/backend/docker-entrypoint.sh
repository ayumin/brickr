#!/bin/sh
set -e

# Both API and worker mount the development schema. Keep their generated
# clients in sync even when the worker skips the one-time DB bootstrap.
pnpm exec prisma generate

if [ "${SKIP_DB_BOOTSTRAP:-false}" != "true" ]; then
  # The db service is healthy before we start, but the socket can still lag a
  # moment. Retry committed migrations rather than mutating schema ad hoc.
  attempt=1
  until pnpm exec prisma migrate deploy; do
    if [ "$attempt" -ge 10 ]; then
      echo "prisma migrate deploy failed after $attempt attempts" >&2
      exit 1
    fi
    echo "waiting for database (attempt $attempt)..."
    attempt=$((attempt + 1))
    sleep 2
  done
  pnpm exec tsx prisma/seed.ts
fi

exec "$@"
