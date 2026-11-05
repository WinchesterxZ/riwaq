#!/bin/bash
# Reset the demo DB: drop, recreate, migrate, base-seed. NEVER touches dev/test.
set -u
export PATH=/tmp/pgbin/bin:/usr/lib/node_modules/.bin:$PATH
PGPASSWORD=atlas_dev_pw psql -h localhost -p 5432 -U atlas -d postgres \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='atlas_erp_demo' AND pid <> pg_backend_pid();" > /dev/null 2>&1
sleep 1
PGPASSWORD=atlas_dev_pw psql -h localhost -p 5432 -U atlas -d postgres \
  -c "DROP DATABASE IF EXISTS atlas_erp_demo;" -c "CREATE DATABASE atlas_erp_demo;" 2>&1 | grep -v "^$"
cd ~/workspace/atlas-erp/apps/api
set -a && source .env && set +a
export DATABASE_URL="postgresql://atlas:atlas_dev_pw@localhost:5432/atlas_erp_demo"
pnpm exec prisma migrate deploy 2>&1 | tail -1
pnpm exec tsx prisma/seed.ts 2>&1 | tail -1
echo "demo DB reset complete"
