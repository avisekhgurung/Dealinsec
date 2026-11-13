# DealInSec on a MilesWeb Cloud VPS (SM-L1)

Moving off Render to one Indian VPS running **both** the app and PostgreSQL.

**The box:** MilesWeb Cloud VPS **SM-L1** — 1 vCPU, 4 GB RAM, 50 GB NVMe, 4 TB transfer, Ubuntu 24.04 LTS,
full root. ₹549/mo promo, renews ₹949/mo.

**Why this shape:** the app makes several queries per request. On Render the app sits in Oregon and Neon in
`us-east-2` (Ohio), so every query crosses the United States. App and Postgres on one box makes that hop a
loopback. Users in India then reach the box in ~10–25 ms instead of ~230 ms.

**What you give up, stated plainly:** app and database share one disk, so one disk failure takes both. MilesWeb
publishes no backup policy. **Step 8 is therefore not optional** — it is the only thing protecting your customer
payment records and signed agreements.

---

## Two corrections to earlier notes

Found while preparing this, both worth knowing:

1. **The health path is `/healthz`, not `/api/health`.** There is no `/api/health` route anywhere in the codebase —
   only `/healthz` ([server/index.ts:78](../server/index.ts)), which is deliberately dependency-free (no DB, no
   session). My `render.yaml` and `docs/singapore-migration.md` both name the wrong path; use `/healthz` everywhere.
2. **In production the app binds `0.0.0.0`** ([server/index.ts:396](../server/index.ts)). On Render that was
   harmless. On a VPS it means the app port is reachable from the internet unless the firewall blocks it. Step 2
   closes it, and nothing should ever talk to the app except nginx on localhost.

---

## Step 0 — before you pay

Get these three in writing from MilesWeb support (chat transcript or email). None are on their page:

1. **Which Indian city hosts the VPS?** If they will not name one, buy Hostinger KVM 1 instead — India latency is
   the entire reason for this move.
2. **Is ₹549/mo billed monthly, or prepaid for a term?** Their page says "Cancel anytime" but states no term.
3. **Are backups included, how often, how many kept?** Assume no, build Step 8 regardless.

At checkout: **location India** (chosen explicitly, not auto-detected), **Ubuntu 24.04 LTS plain** — no cPanel,
CyberPanel or Plesk — **SSH key not password**, and skip the paid add-ons.

---

## Step 1 — first login

```bash
ssh root@YOUR_IP
```

Create a non-root user and stop using root over SSH:

```bash
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
```

Confirm `ssh deploy@YOUR_IP` works **in a second terminal** before continuing. Then disable root and password login:

```bash
sudo sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart ssh
```

---

## Step 2 — lock the box down

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install ufw fail2ban unattended-upgrades curl gnupg ca-certificates \
                    build-essential python3 rsync

sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

sudo systemctl enable --now fail2ban
sudo dpkg-reconfigure -plow unattended-upgrades   # choose Yes
```

`build-essential` and `python3` are needed because `bcrypt@6` is a native module that may compile on install.

The app's port is **never** opened. nginx reaches it on localhost only.

---

## Step 3 — Node 22

The repo has **no `engines` pin** in `package.json`, so nothing forces the right version. Install it explicitly —
you are on v22.22.2 locally:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt -y install nodejs
node -v    # expect v22.x
```

---

## Step 4 — PostgreSQL 18

**Ubuntu 24.04 ships PostgreSQL 16, which is too old.** Production is 18.6 and the dump is in custom format, so it
must be restored into 18. Add the PGDG repository:

```bash
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
https://apt.postgresql.org/pub/repos/apt noble-pgdg main" \
  | sudo tee /etc/apt/sources.list.d/pgdg.list
sudo apt update
sudo apt -y install postgresql-18 postgresql-client-18
psql --version    # expect 18.x
```

Create the role and database (pick a strong password; it goes in the env file in Step 6, never in this repo):

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE dealinsec LOGIN PASSWORD 'CHANGE_ME_STRONG';
CREATE DATABASE dealinsec OWNER dealinsec;
SQL
```

Postgres stays on localhost only — the default. Do not touch `listen_addresses`.

---

## Step 5 — tune Postgres for 4 GB

Defaults assume a much bigger machine. Write a drop-in:

```bash
sudo tee /etc/postgresql/18/main/conf.d/dealinsec.conf >/dev/null <<'CONF'
# Tuned for 1 vCPU / 4 GB, sharing the box with the Node app.
shared_buffers = 768MB            # ~25% of RAM
effective_cache_size = 2GB        # what the planner assumes the OS caches
work_mem = 16MB
maintenance_work_mem = 192MB
max_connections = 40              # the app pools; 40 is ample and bounds memory
random_page_cost = 1.1            # NVMe, not spinning disk
effective_io_concurrency = 200
wal_compression = on
max_wal_size = 1GB
min_wal_size = 128MB
checkpoint_completion_target = 0.9
log_min_duration_statement = 1000 # log anything slower than 1s
CONF
sudo systemctl restart postgresql@18-main
```

Sanity check the memory budget: Postgres ~1 GB, Node ~250 MB, Ubuntu ~400 MB. About 1.7 GB of 4 GB used.

---

## Step 6 — restore the verified dump

The dump was taken from production and verified: 61 tables, 3,461 rows, **exact row counts identical**, and the
production bundle booted against the restored copy with every schema gate passing.

It lives at:

```
/private/tmp/claude-501/-Users-avisekhgurung-Downloads-Dealinsec/8294b8a9-245c-40f5-bbc3-2f783df754df/scratchpad/dealinsec-prod.dump
```

That is a **session scratchpad and it is temporary** — copy it somewhere safe. It holds real customer data.
**Never commit it: this repository is public.**

From your Mac:

```bash
scp "/private/tmp/claude-501/-Users-avisekhgurung-Downloads-Dealinsec/8294b8a9-245c-40f5-bbc3-2f783df754df/scratchpad/dealinsec-prod.dump" \
  deploy@YOUR_IP:/tmp/dealinsec-prod.dump
```

On the box:

```bash
sudo -u postgres pg_restore --no-owner --role=dealinsec \
  -d dealinsec --clean --if-exists /tmp/dealinsec-prod.dump
shred -u /tmp/dealinsec-prod.dump     # don't leave customer data in /tmp
```

Then verify the row counts match production before trusting it. Ask me to run the comparison — it is the same
table-by-table check that passed on the rehearsal, and it is worth repeating against the real box.

**Do not run migrations.** The server has three fail-closed schema **gates** — money minor-units, audience and
engagement ([server/index.ts:232](../server/index.ts) onward). They check and refuse to serve; they never migrate.
A restore of already-migrated production data satisfies all three. If a gate refuses, stop and tell me; do not run
the migration scripts speculatively.

There is exactly **one** boot migration, at [server/index.ts:226](../server/index.ts):
`ALTER TABLE brand_invoices ADD COLUMN IF NOT EXISTS paid_at`. It is idempotent and additive, failure is logged
but never blocks boot, and it is deliberate. Expect to see `boot migration: brand_invoices.paid_at ready` in the
logs on every start — that line is healthy, not a warning.

---

## Step 7 — deploy the app

### Layout

```
/srv/dealinsec/current/        dist/ + node_modules/ + package.json
/etc/dealinsec/dealinsec.env   secrets, root-owned, 0600
```

### Environment file

```bash
sudo install -d -m 755 /etc/dealinsec
sudo touch /etc/dealinsec/dealinsec.env
sudo chmod 600 /etc/dealinsec/dealinsec.env
sudo nano /etc/dealinsec/dealinsec.env
```

Copy every variable from the Render dashboard. Specifics that matter:

```ini
NODE_ENV=production
PORT=5000
TZ=UTC
DATABASE_URL=postgresql://dealinsec:CHANGE_ME_STRONG@127.0.0.1:5432/dealinsec
APP_URL=https://www.dealinsec.com
CANONICAL_HOST=www.dealinsec.com
SESSION_SECRET=<copy the EXISTING value from Render>
```

- **`SESSION_SECRET` must be copied, not regenerated.** A new value logs every user out.
- **Keep `TZ=UTC`.** Render ran UTC. Setting `Asia/Kolkata` would shift follow-up business-day scheduling and the
  30-day allowance windows. Change it later as a deliberate decision, not during a migration.
- **Do not set `PRO_MONTHLY_PRICE`** — the Pro price (₹299 since 12 Nov 2026) comes from `shared/globalPlans.ts` through
  `shared/product-facts.ts`; an env override reintroduces an old price.
- **Do not set `PRO_TRIAL_ENABLED`** — the model is free → paid, never a trial.
- **`BACKGROUND_WORKER`: leave unset.** The web process then runs the durable jobs itself
  (`backgroundWorkIsElsewhere` in [server/workflow/runner.ts:51](../server/workflow/runner.ts) is false when the
  variable is absent). Setting it to `external` without also running `dist/worker.cjs` leaves jobs recorded and
  never run.
- Optional: `OPPORTUNITY_SOURCES=hn` turns on the Hacker News demand scan (Phase 3B). Unset = exactly pre-3B
  behaviour.

Also carry across: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `IMAGEKIT_*`, `DEEPSEEK_API_KEY`, `TAVILY_API_KEY`,
`GOOGLE_PLACES_API_KEY`, and the spend-ceiling variables.

### Dependencies on the box

The build bundles only an allowlist; everything else stays external
([script/build.ts](../script/build.ts)). The bundle actually requires **five** packages at runtime — `bcrypt`,
`imagekit`, `passport-google-oauth20`, `razorpay`, `resend` — all of them production dependencies. (`pg-native`
is also referenced but is not in `package.json`; `pg` falls back to its JavaScript driver, which is correct.)

So the box needs a production install, not a full one:

```bash
cd /srv/dealinsec/current
npm ci --omit=dev
```

`bcrypt` is native, which is why Step 2 installed `build-essential`. **Never run `npm run build` on this box** —
see Step 10.

### systemd unit

```bash
sudo tee /etc/systemd/system/dealinsec.service >/dev/null <<'UNIT'
[Unit]
Description=DealInSec web + in-process job runner
After=network-online.target postgresql@18-main.service
Wants=network-online.target postgresql@18-main.service

[Service]
Type=simple
User=deploy
WorkingDirectory=/srv/dealinsec/current
EnvironmentFile=/etc/dealinsec/dealinsec.env
ExecStart=/usr/bin/node dist/index.cjs
Restart=always
RestartSec=3
# The jobs checkpoint and hold a lease, so a restart resumes rather than repeats.
TimeoutStopSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/dealinsec
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now dealinsec
curl -s localhost:5000/healthz    # expect: ok
journalctl -u dealinsec -n 50 --no-pager
```

`dist/public` must sit next to `dist/index.cjs` — static files are resolved from `__dirname`
([server/static.ts:8](../server/static.ts)).

---

## Step 8 — backups. Do not skip this.

App and database share one disk, and MilesWeb promises you nothing. A backup that lives only on that disk is not a
backup.

The whole database compresses to **484 KB**, verified when the dump was taken. Hourly backups kept for a year cost
almost nothing.

### Off-box destination

Cloudflare R2: 10 GB free, no egress fees, and you already use Cloudflare. **You** create the bucket
(`dealinsec-backups`) and an API token with object read/write, then:

```bash
sudo apt -y install rclone age
sudo install -d -m 700 /etc/dealinsec
sudo rclone config --config /etc/dealinsec/rclone.conf
# new remote: name "r2", type "s3", provider "Cloudflare",
# endpoint https://<ACCOUNT_ID>.r2.cloudflarestorage.com
sudo chmod 600 /etc/dealinsec/rclone.conf
```

Generate an encryption key and **store the private key off the server** — a backup encrypted with a key that only
lives on the dead disk is useless:

```bash
age-keygen -o /tmp/backup-key.txt      # copy BOTH keys into your password manager
sudo tee /etc/dealinsec/backup.pub >/dev/null   # paste ONLY the public key here
sudo shred -u /tmp/backup-key.txt
```

### The job

```bash
sudo tee /usr/local/bin/dealinsec-backup >/dev/null <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
STAMP="$(date -u +%Y/%m/%d/%H%M)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
sudo -u postgres pg_dump -Fc dealinsec > "$TMP/db.dump"
age -r "$(cat /etc/dealinsec/backup.pub)" -o "$TMP/db.dump.age" "$TMP/db.dump"
rclone --config /etc/dealinsec/rclone.conf copyto \
  "$TMP/db.dump.age" "r2:dealinsec-backups/$STAMP.dump.age"
echo "ok $STAMP $(stat -c%s "$TMP/db.dump.age") bytes"
SCRIPT
sudo chmod 755 /usr/local/bin/dealinsec-backup
sudo /usr/local/bin/dealinsec-backup     # run once now
```

Schedule hourly, with retention:

```bash
sudo tee /etc/systemd/system/dealinsec-backup.service >/dev/null <<'UNIT'
[Unit]
Description=Encrypted Postgres dump to R2
[Service]
Type=oneshot
ExecStart=/usr/local/bin/dealinsec-backup
UNIT

sudo tee /etc/systemd/system/dealinsec-backup.timer >/dev/null <<'UNIT'
[Unit]
Description=Hourly DealInSec backup
[Timer]
OnCalendar=hourly
Persistent=true
RandomizedDelaySec=300
[Install]
WantedBy=timers.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now dealinsec-backup.timer
systemctl list-timers dealinsec-backup.timer --no-pager
```

Set an R2 lifecycle rule to expire objects after 365 days.

### Test the restore. A backup you have not restored is a guess.

```bash
sudo -u postgres createdb restore_test
rclone --config /etc/dealinsec/rclone.conf cat "r2:dealinsec-backups/<newest>.dump.age" \
  | age -d -i <your-private-key-file> \
  | sudo -u postgres pg_restore --no-owner -d restore_test
sudo -u postgres psql -d restore_test -c "select count(*) from users;"
sudo -u postgres dropdb restore_test
```

Do this now, and again whenever the schema changes materially.

---

## Step 9 — nginx and TLS behind Cloudflare

Cloudflare already fronts the domain and terminates at its Mumbai edge (confirmed: `cf-ray … -BOM`). Use a
Cloudflare **Origin CA certificate** and set SSL mode to **Full (strict)**.

```bash
sudo apt -y install nginx
sudo install -d -m 700 /etc/nginx/ssl
# paste the Origin CA cert and key from the Cloudflare dashboard:
sudo nano /etc/nginx/ssl/dealinsec.pem
sudo nano /etc/nginx/ssl/dealinsec.key
sudo chmod 600 /etc/nginx/ssl/dealinsec.key
```

```bash
sudo tee /etc/nginx/sites-available/dealinsec >/dev/null <<'CONF'
server {
    listen 80;
    server_name www.dealinsec.com dealinsec.com;
    return 301 https://www.dealinsec.com$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name www.dealinsec.com dealinsec.com;

    ssl_certificate     /etc/nginx/ssl/dealinsec.pem;
    ssl_certificate_key /etc/nginx/ssl/dealinsec.key;

    client_max_body_size 25m;   # document and logo uploads

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Voice-call audio and chat token streaming need these:
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_buffering off;
        proxy_read_timeout 300s;
    }
}
CONF

sudo ln -sf /etc/nginx/sites-available/dealinsec /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

The app reads `X-Forwarded-For`, so confirm `trust proxy` behaviour is still correct after cutover — rate limits
key off the client IP, and a misconfigured chain would rate-limit everyone as one address.

### While you are in Cloudflare, fix what broke Render

Your 5 GB went somewhere. A cold visit is only ~300 KB gzipped, so 5 GB is roughly 17,000 cold loads in nine
days — far more than your real traffic. Your `robots.txt` is `User-agent: * / Allow: /`
([server/index.ts:84](../server/index.ts)), which invites every AI crawler across the whole server-rendered SEO
surface, none of it edge-cached.

On a VPS that traffic burns **CPU** instead of bandwidth, and you have one core. So:

- Turn on **Block AI Scrapers and Crawlers**.
- Add a Cache Rule for `/assets/*` — those filenames are content-hashed and already served
  `max-age=31536000, immutable` ([server/static.ts:22](../server/static.ts)), so edge caching is safe and takes
  them off your box entirely.
- Consider a Cache Rule for the marketing and blog pages. They are built once at boot, so they are static in
  practice even though the header says `no-cache`.

---

## Step 10 — build off the box

SM-L1 has one vCPU. `npm run build` peaks at **680 MB and 28 s of CPU** (measured), which on one shared core is a
2–3 minute brownout of the live site per deploy. This is the condition the 1-vCPU choice rests on.

Build in GitHub Actions, ship only the artifacts. Note that `node_modules` must be installed **on the box** (or in
a Linux CI job) — never copied from your Mac, because `bcrypt` is a native module and Mac binaries will not run on
Ubuntu.

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  workflow_dispatch:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npm run build
      - name: Ship dist
        run: |
          echo "${{ secrets.DEPLOY_KEY }}" > /tmp/k && chmod 600 /tmp/k
          # No --delete: the running site's page still names the old script files until the restart, and deleting
          # them blanks every fresh visit in between. script/deploy.sh removes week-old files AFTER it has checked the site.
          rsync -az -e "ssh -i /tmp/k -o StrictHostKeyChecking=accept-new" \
            dist/ package.json package-lock.json \
            deploy@${{ secrets.DEPLOY_HOST }}:/srv/dealinsec/current/
          ssh -i /tmp/k -o StrictHostKeyChecking=accept-new \
            deploy@${{ secrets.DEPLOY_HOST }} \
            'cd /srv/dealinsec/current && npm ci --omit=dev && sudo systemctl restart dealinsec'
```

**Until this workflow exists, deploys are by hand with one command: `bash script/deploy.sh`** (upload without
deleting, restart, check that the live page's script loads, then tidy; `--check` looks and changes nothing). It reads
the server's address from `.deploy.env`, which is not committed. Its tests run against a pretend server:
`bash script/deploy.test.sh`. Do not go back to a separate upload and restart: on 10 Nov 2026 the restart was missed
and fresh visits got a blank page for five minutes.

Needs: a deploy SSH key (`DEPLOY_KEY`, `DEPLOY_HOST` as repo secrets) and a sudoers rule letting `deploy` restart
just that one unit:

```bash
echo 'deploy ALL=(root) NOPASSWD: /bin/systemctl restart dealinsec' \
  | sudo tee /etc/sudoers.d/dealinsec-restart
sudo chmod 440 /etc/sudoers.d/dealinsec-restart
```

---

## Step 11 — cutover

Test before pointing the domain. Add to your Mac's `/etc/hosts`:

```
YOUR_IP  www.dealinsec.com
```

Then walk the real paths: sign in, open the dashboard, run a Client Radar search, open a document link. When it
holds up, remove the hosts line and switch Cloudflare's `www` record to `YOUR_IP`, **proxied (orange cloud)**.

Keep Render and Neon alive for a few days as rollback. Nothing is being written to them while the site is
suspended, so there is no data to lose — this is a clean cutover window.

### After cutover

```bash
curl -sI https://www.dealinsec.com/healthz
curl -s https://www.dealinsec.com/robots.txt
systemctl status dealinsec postgresql@18-main nginx --no-pager
systemctl list-timers dealinsec-backup.timer --no-pager
journalctl -u dealinsec --since "10 min ago" --no-pager | grep -i error
```

Then ask me to run the checks still outstanding: the unauthenticated Phase 3A and 3B production smoke tests, and
latency measured before and after so the move is proven rather than assumed.

### Rollback

Point Cloudflare's `www` back at the Render service and `DATABASE_URL` back at Neon. Both stay untouched until you
delete them. Delete only once the VPS has run clean for a week — including a **tested** restore from R2.

---

## Still open

- Razorpay webhook URL: confirm it points at `www.dealinsec.com` and survives the move. Payments fail silently
  otherwise.
- Google OAuth redirect URIs: unchanged if the domain is unchanged, but verify.
- Uptime monitoring: nothing watches this box. Point an external pinger at `/healthz` — it is dependency-free and
  cheap.
- `UNLIMITED_ORG_IDS` was never set on Render; decide whether it should exist here.
