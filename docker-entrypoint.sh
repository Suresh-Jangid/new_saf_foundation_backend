#!/bin/sh
set -e

echo "Running Prisma db push..."
npx prisma db push --skip-generate

echo "Starting API server..."
exec node dist/server.js
