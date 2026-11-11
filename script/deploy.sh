#!/usr/bin/env bash
#
# DealInSec: put the build on this computer live, in ONE command.
#
#     bash script/deploy.sh            upload, restart, check
#     bash script/deploy.sh --check    look only: changes nothing
#
# Why one command. The old way was two: upload, then restart. The upload deleted the script files the running site
# still pointed at, so between the two every fresh visit got a blank page (10 Nov 2026: five minutes, when the second
# command was not run). This script never deletes what the live page may still need:
#
#   1. checks the build on this computer is whole and newer than the latest commit
#   2. checks the server has the same package-lock.json (a changed one needs an install first; it stops and says so)
#   3. keeps a copy of the build that is live now, to go back to
#   4. uploads the new files WITHOUT deleting any old ones
#   5. restarts the app and waits until it answers healthy
#   6. opens the live site and checks that the page's script really loads as a script
#   7. only then removes build files more than a week old
#
# Settings come from the environment, or from a file ".deploy.env" beside package.json (never committed):
#   DEPLOY_HOST   the server's address                      (required)
#   DEPLOY_KEY    the SSH key          default ~/.ssh/dealinsec_vps
#   DEPLOY_ROOT   where the app lives  default /srv/dealinsec
#   DEPLOY_SITE   the public address   default https://www.dealinsec.com
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
[ -f .deploy.env ] && . ./.deploy.env

MODE="${1:-deploy}"
HOST="${DEPLOY_HOST:-}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/dealinsec_vps}"
ROOT="${DEPLOY_ROOT:-/srv/dealinsec}"
SITE="${DEPLOY_SITE:-https://www.dealinsec.com}"
SERVICE="${DEPLOY_SERVICE:-dealinsec}"
KEEP_DAYS="${DEPLOY_KEEP_DAYS:-7}"
TRIES="${DEPLOY_TRIES:-8}"
PAUSE="${DEPLOY_PAUSE:-4}"
DIR="$ROOT/current"

say()  { printf '\n==> %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
die()  { printf '\n!!  STOPPED: %s\n' "$*" >&2; exit 1; }

[ -n "$HOST" ] || die "No server address. Put DEPLOY_HOST=<address> in a file named .deploy.env beside package.json."
case "$ROOT" in /*/*) ;; *) die "DEPLOY_ROOT must be a full path like /srv/dealinsec, not '$ROOT'." ;; esac
case "$MODE" in deploy|--check) ;; *) die "Unknown option '$MODE'. Use no option, or --check." ;; esac

SSH="ssh -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=15 -i $KEY"
# The server drops some connections (strangers knock on its SSH port all day), so every step that talks to it is
# tried several times. Each step is safe to repeat.
retry() { local n=1; until "$@"; do [ "$n" -ge "$TRIES" ] && return 1; n=$((n + 1)); sleep "$PAUSE"; done; }
as_root()   { $SSH "root@$HOST" "$1"; }
as_deploy() { $SSH "deploy@$HOST" "$1"; }

# The script file a page asks for ("assets/index-XXXX.js"), read from the page's own text.
script_in() { grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1; }
# What the live site's page asks for, and whether that file comes back as a script.
live_script() { curl -s -L --max-time 20 "$SITE/auth" | script_in || true; }
loads_as_script() { curl -s -o /dev/null --max-time 20 -w '%{content_type}' "$SITE/$1" | grep -qi 'javascript'; }

# ── 1. this computer's build ────────────────────────────────────────────────────────────────────────────────────
say "1/7  Checking the build on this computer"
[ -f dist/index.cjs ] && [ -f dist/public/index.html ] || die "There is no build here (dist/ is missing). Run: npm run build"
NEW_SCRIPT="$(script_in < dist/public/index.html || true)"
[ -n "$NEW_SCRIPT" ] && [ -f "dist/public/$NEW_SCRIPT" ] || die "The build is incomplete: its page names a script that is not in dist/. Run: npm run build"
ls dist/ai-knowledge/*.md >/dev/null 2>&1 || die "The build is incomplete: the assistant's product knowledge (dist/ai-knowledge) is missing. Run: npm run build"
if git rev-parse HEAD >/dev/null 2>&1; then
  commit_at="$(git log -1 --format=%ct)"
  build_at="$(stat -f %m dist/index.cjs 2>/dev/null || stat -c %Y dist/index.cjs)"
  [ "$build_at" -ge "$commit_at" ] || die "The build is older than the latest commit, so it would put old code live. Run: npm run build"
fi
# A build is two things: the screens (the page and its script) and the server file. A change may touch only one.
fingerprint() { { shasum -a 256 "$1" 2>/dev/null || sha256sum "$1"; } | cut -c1-16; }
NEW_SERVER="$(fingerprint dist/index.cjs)"
server_on_disk() { retry as_deploy "sha256sum $DIR/dist/index.cjs | cut -c1-16"; }
note "build is whole; its page asks for $NEW_SCRIPT; server file $NEW_SERVER"

# ── 2. the server ───────────────────────────────────────────────────────────────────────────────────────────────
say "2/7  Checking the server"
local_lock="$(shasum -a 256 package-lock.json 2>/dev/null | cut -c1-64 || sha256sum package-lock.json | cut -c1-64)"
remote_lock="$(retry as_deploy "sha256sum $DIR/package-lock.json | cut -c1-64")" || die "Could not reach the server after $TRIES tries. Nothing was changed. Try again in a minute."
[ "$local_lock" = "$remote_lock" ] || die "package-lock.json differs from the server's: new packages need installing there first. Nothing was changed. Tell Claude."
was="$(live_script)"
was_server="$(server_on_disk || true)"
note "server reached; packages match; the live page asks for ${was:-nothing we could read}; server file ${was_server:-unknown}"

if [ "$MODE" = "--check" ]; then
  say "Check only: nothing was changed."
  if [ "$was" = "$NEW_SCRIPT" ] && [ "$was_server" = "$NEW_SERVER" ]; then note "The live site is already on this build."; else note "The live site is on a different build from the one on this computer."; fi
  if [ -n "$was" ] && loads_as_script "$was"; then note "The live page's script loads. The site is up."; else note "!! The live page's script does NOT load. The site is showing a blank page."; fi
  exit 0
fi

# ── 3. a copy to go back to ─────────────────────────────────────────────────────────────────────────────────────
say "3/7  Keeping a copy of the build that is live now"
stamp="$(date -u +%Y%m%d-%H%M%S)"
retry as_root "[ -d $ROOT/dist.prev-$stamp ] || cp -a $DIR/dist $ROOT/dist.prev-$stamp" || die "Could not keep a copy of the live build. Nothing was changed."
note "kept as $ROOT/dist.prev-$stamp"

# ── 4. upload, deleting nothing ─────────────────────────────────────────────────────────────────────────────────
say "4/7  Uploading the new build (old files stay, so the live page keeps working)"
retry rsync -az -e "$SSH" dist package.json package-lock.json "deploy@$HOST:$DIR/" || die "The upload did not finish after $TRIES tries. The live site is untouched and still working. Run this again."
[ "$(server_on_disk || true)" = "$NEW_SERVER" ] || die "The upload finished but the server file there is not the one from this build. The site is still up on the old code. Run this again."
note "uploaded; the server file there matches this build"

# ── 5. restart ──────────────────────────────────────────────────────────────────────────────────────────────────
say "5/7  Restarting the app"
retry as_root "systemctl restart $SERVICE" || die "The restart command could not be sent. The new files are uploaded and the site is still up on the old code. Run this again."
healthy=""
for _ in $(seq 1 15); do
  code="$(as_root "systemctl is-active $SERVICE >/dev/null 2>&1 && curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5000/healthz" 2>/dev/null || true)"
  [ "$code" = "200" ] && { healthy=yes; break; }
  sleep "$PAUSE"
done
[ -n "$healthy" ] || die "The app did not come back healthy after the restart. TELL CLAUDE NOW. The previous build is kept at $ROOT/dist.prev-$stamp"
note "the app is running and answers healthy"

# ── 6. the real check: does the live page's script load? ────────────────────────────────────────────────────────
say "6/7  Checking the live site"
good=""
for _ in $(seq 1 10); do
  now="$(live_script)"
  if [ "$now" = "$NEW_SCRIPT" ] && loads_as_script "$now"; then good=yes; break; fi
  sleep "$PAUSE"
done
[ -n "$good" ] || die "The live page is not serving the new build's script (it asks for '${now:-nothing}'). TELL CLAUDE NOW. The previous build is kept at $ROOT/dist.prev-$stamp"
have="$(retry as_deploy "ls $DIR/dist/ai-knowledge/*.md 2>/dev/null | wc -l" | tr -d ' ' || true)"
[ "${have:-0}" -gt 0 ] || die "The assistant's product knowledge did not arrive on the server (dist/ai-knowledge is empty there). TELL CLAUDE NOW."
note "the live page asks for $NEW_SCRIPT and it loads as a script; $have knowledge files are on the server"

# ── 7. tidy, only now ───────────────────────────────────────────────────────────────────────────────────────────
say "7/7  Removing build files more than $KEEP_DAYS days old"
removed="$(retry as_deploy "find $DIR/dist/public/assets -type f -mtime +$KEEP_DAYS -print -delete | wc -l" 2>/dev/null | tr -d ' ' || true)"
note "${removed:-0} old file(s) removed"

printf '\n==> DONE. The new build is live.\n'
