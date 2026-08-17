#!/bin/sh
set -e

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

  # Bind-mounted development schemas can be newer than the generated client.
  pnpm exec prisma generate
  pnpm exec tsx prisma/seed.ts
fi

exec "$@"
