#!/usr/bin/env bash
#
# DealInSec — first-run provisioning for a MilesWeb Cloud VPS (SM-L1, Ubuntu 24.04).
# Run ONCE, as root, on the NEW BOX ONLY:
#
#     scp deploy/bootstrap.sh root@YOUR_IP:/tmp/
#     ssh root@YOUR_IP 'bash /tmp/bootstrap.sh'
#
# Safe to re-run: every step is idempotent.
#
# It deliberately does NOT disable root SSH login. That is the one step that can
# lock you out, so you do it by hand in Step 9 below, only AFTER proving the
# deploy user works from a second terminal.
set -euo pipefail

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33m!!  %s\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Run as root."; exit 1; }
. /etc/os-release
[ "${VERSION_ID:-}" = "24.04" ] || warn "Expected Ubuntu 24.04, found ${PRETTY_NAME:-unknown}. Continuing anyway."

say "1/8  System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get -y -qq upgrade
# build-essential + python3: bcrypt@6 is a native module and may compile on install.
apt-get -y -qq install ufw fail2ban unattended-upgrades curl gnupg ca-certificates \
                       build-essential python3 rsync git age rclone

say "2/8  Deploy user"
if id deploy >/dev/null 2>&1; then
  echo "    user 'deploy' already exists"
else
  adduser --disabled-password --gecos "" deploy
  usermod -aG sudo deploy
fi
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
if [ -f /root/.ssh/authorized_keys ]; then
  cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
  chown deploy:deploy /home/deploy/.ssh/authorized_keys
  chmod 600 /home/deploy/.ssh/authorized_keys
  echo "    copied root's authorized_keys to deploy"
else
  warn "No /root/.ssh/authorized_keys found. Add your public key to /home/deploy/.ssh/authorized_keys before Step 9."
fi

say "3/8  Firewall — the app port is never opened; nginx reaches it on localhost"
ufw --force reset >/dev/null
ufw default deny incoming  >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp  >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable
ufw status verbose

say "4/8  fail2ban + unattended security upgrades"
systemctl enable --now fail2ban
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF

say "5/8  Node 22"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v22.* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get -y -qq install nodejs
fi
echo "    node $(node -v), npm $(npm -v)"

say "6/8  PostgreSQL 18 (Ubuntu ships 16 — too old for the production dump)"
if ! command -v psql >/dev/null 2>&1 || ! psql --version | grep -q ' 18'; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    https://www.postgresql.org/media/keys/ACCC4CF8.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt-get update -qq
  apt-get -y -qq install postgresql-18 postgresql-client-18
fi
echo "    $(psql --version)"

say "7/8  Postgres tuning for 1 vCPU / 4 GB"
cat >/etc/postgresql/18/main/conf.d/dealinsec.conf <<'CONF'
# Tuned for 1 vCPU / 4 GB, sharing the box with the Node app.
shared_buffers = 768MB
effective_cache_size = 2GB
work_mem = 16MB
maintenance_work_mem = 192MB
max_connections = 40
random_page_cost = 1.1
effective_io_concurrency = 200
wal_compression = on
max_wal_size = 1GB
min_wal_size = 128MB
checkpoint_completion_target = 0.9
log_min_duration_statement = 1000
CONF
systemctl restart postgresql@18-main
systemctl enable postgresql@18-main

say "8/8  Database role + empty database"
DB_PASS_FILE=/root/.dealinsec-db-password
if [ -f "$DB_PASS_FILE" ]; then
  DB_PASS="$(cat "$DB_PASS_FILE")"
  echo "    reusing the password already generated at $DB_PASS_FILE"
else
  DB_PASS="$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 32)"
  printf '%s' "$DB_PASS" > "$DB_PASS_FILE"
  chmod 600 "$DB_PASS_FILE"
fi
sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dealinsec') THEN
    CREATE ROLE dealinsec LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE dealinsec PASSWORD '${DB_PASS}';
  END IF;
END \$\$;
SELECT 'database exists' WHERE EXISTS (SELECT 1 FROM pg_database WHERE datname='dealinsec');
SQL
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='dealinsec'" | grep -q 1 \
  || sudo -u postgres createdb -O dealinsec dealinsec
install -d -m 755 /srv/dealinsec
chown deploy:deploy /srv/dealinsec

cat <<NEXT

====================================================================
 Provisioning done.
====================================================================

 Your DATABASE_URL (the password is also saved at ${DB_PASS_FILE}):

   postgresql://dealinsec:${DB_PASS}@127.0.0.1:5432/dealinsec

 Do NOT paste that into a chat window. Put it straight into
 /etc/dealinsec/dealinsec.env on this box.

 NEXT, IN ORDER:

 9. From a SECOND terminal, prove the deploy user works:
       ssh deploy@<this box>
    Only when that succeeds, disable root and password login:
       sudo sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/'        /etc/ssh/sshd_config
       sudo sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
       sudo systemctl restart ssh

10. Restore the production dump      — runbook Step 6
11. Env file + app + systemd         — runbook Step 7
12. Backups to R2. Do not skip       — runbook Step 8
13. nginx + Cloudflare Origin cert   — runbook Step 9
14. GitHub Actions build             — runbook Step 10
15. Cutover                          — runbook Step 11

 docs/milesweb-vps-runbook.md has each of these in full.
====================================================================
NEXT
