#!/usr/bin/env bash
#
# DealInSec: run a migration script against the PRODUCTION database, from this computer, in ONE command.
#
#     bash script/prod-migrate.sh script/migrate-finding-permissions.ts --dry-run
#     bash script/prod-migrate.sh script/migrate-finding-permissions.ts
#
# Why: the production env file (/etc/dealinsec/dealinsec.env) lives on the server, and Postgres there listens only on
# 127.0.0.1:5432. So this script (1) reads DATABASE_URL from that file over SSH, (2) opens an SSH tunnel from a local
# port to the server's Postgres, (3) runs the migration with the URL pointed at the tunnel, (4) closes the tunnel.
# The password never touches a file here and is never printed.
#
# Settings come from .deploy.env beside package.json, like script/deploy.sh:
#   DEPLOY_HOST   the server's address                      (required)
#   DEPLOY_KEY    the SSH key          default ~/.ssh/dealinsec_vps
#   DEPLOY_ENV    the env file         default /etc/dealinsec/dealinsec.env
#   DEPLOY_DB_PORT  local tunnel port  default 5433
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
[ -f .deploy.env ] && . ./.deploy.env

SCRIPT="${1:-}"; shift || true
HOST="${DEPLOY_HOST:-}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/dealinsec_vps}"
ENV_FILE="${DEPLOY_ENV:-/etc/dealinsec/dealinsec.env}"
LPORT="${DEPLOY_DB_PORT:-5433}"

die() { printf '\n!!  STOPPED: %s\n' "$*" >&2; exit 1; }
[ -n "$SCRIPT" ] && [ -f "$SCRIPT" ] || die "Give the migration to run, e.g. script/migrate-finding-permissions.ts"
[ -n "$HOST" ] || die "No server address. Put DEPLOY_HOST=<address> in .deploy.env beside package.json."

SSH="ssh -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=15 -i $KEY"

printf '==> Reading DATABASE_URL from %s on the server (never printed)\n' "$ENV_FILE"
REMOTE_URL="$($SSH "root@$HOST" "grep '^DATABASE_URL=' '$ENV_FILE' | head -1 | cut -d= -f2-" | tr -d '"' | tr -d "'")"
[ -n "$REMOTE_URL" ] || die "DATABASE_URL was not found in $ENV_FILE on the server."

# The URL names the server's own Postgres (host[:port] between '@' and the next '/'). Point it at the tunnel instead.
AUTH="${REMOTE_URL%%@*}"            # scheme://user:password
REST="${REMOTE_URL#*@}"             # host:port/db?...
HOSTPORT="${REST%%/*}"              # host:port
DBPATH="${REST#*/}"                 # db?...
RHOST="${HOSTPORT%%:*}"; RPORT="${HOSTPORT#*:}"; [ "$RPORT" = "$HOSTPORT" ] && RPORT=5432
case "$RHOST" in localhost|127.0.0.1|::1) ;; *) die "DATABASE_URL on the server points at $RHOST, not the box itself; run the migration there instead." ;; esac
LOCAL_URL="${AUTH}@127.0.0.1:${LPORT}/${DBPATH}"

printf '==> Opening a tunnel: localhost:%s -> server 127.0.0.1:%s\n' "$LPORT" "$RPORT"
$SSH -N -L "${LPORT}:127.0.0.1:${RPORT}" "root@$HOST" &
TUNNEL=$!
trap 'kill $TUNNEL 2>/dev/null || true' EXIT
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$LPORT") 2>/dev/null; then exec 3>&-; break; fi
  sleep 1
done
(exec 3<>"/dev/tcp/127.0.0.1/$LPORT") 2>/dev/null || die "The tunnel did not come up."
exec 3>&- 2>/dev/null || true

printf '==> Running %s against PRODUCTION %s\n\n' "$SCRIPT" "$*"
DATABASE_URL="$LOCAL_URL" npx tsx "$SCRIPT" "$@"
printf '\n==> Done. Tunnel closed.\n'
