#!/bin/bash
# ATLAS ERP — one-command environment recovery after a VM replacement.
# Idempotent: safe to run anytime. Logs to ~/workspace/atlas-erp/recovery.log
# Usage: bash ~/workspace/atlas-erp/scripts/recover.sh
set -u
LOG="$HOME/workspace/atlas-erp/recovery.log"
PGBIN=/tmp/pgbin/bin
PGDATA=/tmp/pgdata
REPO_ROOT="$HOME/workspace/atlas-erp"
API_DIR="$HOME/workspace/atlas-erp/apps/api"
WEB_DIR="$HOME/workspace/atlas-erp/apps/web"

log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

needs() { command -v "$1" >/dev/null 2>&1 || return 0; return 1; }

# 1. pnpm ----------------------------------------------------------------
if needs pnpm; then
  log "installing pnpm..."
  npm i -g pnpm >/dev/null 2>&1
fi
export PATH="/usr/lib/node_modules/.bin:$PATH"

# 2. postgres binaries (pgserver bundles pg16) ---------------------------
if [ ! -x "$PGBIN/initdb" ]; then
  log "staging postgres binaries..."
  pip3 install --break-system-packages -q pgserver >/dev/null 2>&1
  id pguser >/dev/null 2>&1 || useradd -m -s /bin/bash pguser
  PYLIB=$(python3 -c "import sysconfig; print(sysconfig.get_path('purelib'))")
  mkdir -p /tmp/pgbin /pgserver.libs
  cp -r "$PYLIB/pgserver/pginstall/"* /tmp/pgbin/
  cp "$PYLIB"/pgserver.libs/* /pgserver.libs/ 2>/dev/null || true
  chown -R pguser:pguser /tmp/pgbin /pgserver.libs
  mkdir -p "$PGDATA" && chown pguser:pguser "$PGDATA"
fi
export PATH="$PGBIN:$PATH"

# 3. start postgres -------------------------------------------------------
if ! sudo -u pguser "$PGBIN/pg_isready" -p 5432 >/dev/null 2>&1; then
  log "starting postgres..."
  if [ ! -f "$PGDATA/PG_VERSION" ]; then
    sudo -u pguser "$PGBIN/initdb" -D "$PGDATA" -E UTF8 >/dev/null 2>&1
  fi
  sudo -u pguser "$PGBIN/pg_ctl" -D "$PGDATA" -l /tmp/pgdata.log -o "-p 5432" start >/dev/null 2>&1
  for i in $(seq 1 20); do
    sudo -u pguser "$PGBIN/pg_isready" -p 5432 >/dev/null 2>&1 && break
    sleep 1
  done
fi
sudo -u pguser "$PGBIN/pg_isready" -p 5432 >/dev/null 2>&1 || { log "FATAL: postgres did not start"; exit 1; }

# 4. role + databases (idempotent) ----------------------------------------
sudo -u pguser "$PGBIN/psql" -p 5432 -d postgres -tc "SELECT 1 FROM pg_roles WHERE rolname='atlas'" | grep -q 1 \
  || sudo -u pguser "$PGBIN/psql" -p 5432 -d postgres -c "CREATE ROLE atlas WITH LOGIN PASSWORD 'atlas_dev_pw' SUPERUSER;" >/dev/null
for db in atlas_erp_dev atlas_erp_test; do
  sudo -u pguser "$PGBIN/psql" -p 5432 -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 \
    || sudo -u pguser "$PGBIN/createdb" -p 5432 -O atlas "$db" >/dev/null
done

# 5. migrations + seed ----------------------------------------------------
cd "$API_DIR"
set -a && source .env && set +a
# restore vendored schema-engine binary FIRST (pnpm store is wiped on VM
# replacement, CDN blocked) — migrate deploy needs it.
ENG_DIR="$REPO_ROOT/node_modules/.pnpm/@prisma+engines@6.19.3/node_modules/@prisma/engines"
if [ ! -x "$ENG_DIR/schema-engine-debian-openssl-3.0.x" ] && [ -f "$REPO_ROOT/vendor/prisma-engines/schema-engine-debian-openssl-3.0.x" ]; then
  cp "$REPO_ROOT/vendor/prisma-engines/schema-engine-debian-openssl-3.0.x" "$ENG_DIR/" 2>/dev/null || true
  chmod +x "$ENG_DIR/schema-engine-debian-openssl-3.0.x" 2>/dev/null || true
fi
apply_migrations() {
  # $1 = database URL. Tries prisma migrate deploy; on failure falls back to
  # applying migration.sql files directly via psql (schema engine may be
  # unavailable). Logs loudly — never silently leaves the DB empty.
  local db_url="$1" db_name="$2" m
  log "applying migrations to $db_name..."
  if DATABASE_URL="$db_url" PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1 pnpm exec prisma migrate deploy >>"$LOG" 2>&1; then
    return 0
  fi
  log "WARN: prisma migrate deploy failed for $db_name — falling back to psql-direct apply"
  for m in "$API_DIR"/prisma/migrations/*/; do
    [ -f "$m/migration.sql" ] || continue
    log "  applying $(basename "$m") to $db_name..."
    PGPASSWORD=atlas_dev_pw "$PGBIN/psql" -h localhost -p 5432 -d "$db_name" -U atlas -v ON_ERROR_STOP=1 -f "$m/migration.sql" >>"$LOG" 2>&1 \
      || { log "FATAL: migration $(basename "$m") failed on $db_name"; return 1; }
  done
}
apply_migrations "postgresql://atlas:atlas_dev_pw@localhost:5432/atlas_erp_dev" "atlas_erp_dev" \
  || { log "FATAL: dev DB migrations failed"; exit 1; }
apply_migrations "postgresql://atlas:atlas_dev_pw@localhost:5432/atlas_erp_test" "atlas_erp_test" \
  || log "WARN: test DB migrations failed (e2e rebuilds it from schema-dump.sql anyway)"
NPERM=$(PGPASSWORD=atlas_dev_pw "$PGBIN/psql" -h localhost -p 5432 -d atlas_erp_dev -U atlas -tc "SELECT count(*) FROM permissions;" 2>/dev/null | tr -d ' ')
if [ "${NPERM:-0}" = "0" ]; then
  log "seeding..."
  pnpm exec tsx prisma/seed.ts >>"$LOG" 2>&1
fi
# Prisma client (custom output: apps/api/src/generated/prisma, symlinked as @prisma/client)
log "generating prisma client..."
pnpm exec prisma generate >>"$LOG" 2>&1
if [ ! -L "$API_DIR/node_modules/@prisma/client" ]; then
  rm -rf "$API_DIR/node_modules/@prisma/client"
  ln -s ../../src/generated/prisma "$API_DIR/node_modules/@prisma/client"
fi
# recreate /tmp/start-api-dist.sh (wiped on VM replacement)
cat > /tmp/start-api-dist.sh <<'EOS'
#!/bin/bash
export PATH=/tmp/pgbin/bin:/usr/lib/node_modules/.bin:$PATH
cd /home/hatch/workspace/atlas-erp/apps/api
set -a && source .env && set +a
exec node --enable-source-maps dist/src/main
EOS
chmod +x /tmp/start-api-dist.sh

# 6. API (dist build) ------------------------------------------------------
if ! curl -s -m 4 http://localhost:3000/health >/dev/null 2>&1; then
  log "starting API..."
  setsid nohup bash -c "export PATH=/usr/lib/node_modules/.bin:\$PATH; cd '$API_DIR' && set -a && source .env && set +a && exec node --enable-source-maps dist/src/main" >>"$LOG" 2>&1 < /dev/null &
  for i in $(seq 1 30); do
    curl -s -m 2 http://localhost:3000/health >/dev/null 2>&1 && break
    sleep 2
  done
fi

# 7. web -------------------------------------------------------------------
if ! curl -s -m 4 -o /dev/null http://localhost:5173/ >/dev/null 2>&1; then
  log "starting web..."
  setsid nohup bash -c "export PATH=/usr/lib/node_modules/.bin:\$PATH; cd '$WEB_DIR' && exec pnpm exec vite --port 5173 --host 127.0.0.1" >>"$LOG" 2>&1 < /dev/null &
  sleep 8
fi

# 8. report -----------------------------------------------------------------
API_OK="down"; curl -s -m 4 http://localhost:3000/health >/dev/null 2>&1 && API_OK="up"
WEB_OK="down"; curl -s -m 4 -o /dev/null http://localhost:5173/ >/dev/null 2>&1 && WEB_OK="up"
PG_OK="down"; sudo -u pguser "$PGBIN/pg_isready" -p 5432 >/dev/null 2>&1 && PG_OK="up"
log "recovery done: postgres=$PG_OK api=$API_OK web=$WEB_OK"
[ "$PG_OK" = "up" ] && [ "$API_OK" = "up" ] && [ "$WEB_OK" = "up" ]
