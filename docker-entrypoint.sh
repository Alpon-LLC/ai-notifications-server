#!/bin/sh
set -e

# Ensure the SQLite data directory exists and is writable
mkdir -p /app/data

npx prisma migrate deploy
exec node dist/server.js
