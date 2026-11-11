#!/usr/bin/env bash
#
# Tests for script/deploy.sh, against a PRETEND server on this computer. Nothing here touches the network or the real
# server: "ssh", "rsync", "curl" and "systemctl" are replaced by small stand-ins that act on a temp folder.
#
#     bash script/deploy.test.sh
#
# The pretend server behaves like the real one where it matters: the page it serves is the one it read at its last
# restart, and a script file that is not on disk comes back as HTML, not as a script.
set -u   # no pipefail here: "out | grep -q" ends the pipe early on a match, which is not a failure
HERE="$(cd "$(dirname "$0")" && pwd)"
REAL_RSYNC="$(command -v rsync)"
pass=0; failed=0
ok()  { pass=$((pass + 1)); printf '  ok    %s\n' "$1"; }
bad() { failed=$((failed + 1)); printf '  FAIL  %s\n' "$1"; [ -n "${2:-}" ] && printf '        %s\n' "$2"; }
check() { if eval "$2"; then ok "$1"; else bad "$1" "not true: $2"; fi; }

# One fresh world per case: a project with a new build, and a server running an old one.
setup() {
  T="$(mktemp -d)"; P="$T/project"; S="$T/srv/dealinsec"; BIN="$T/bin"
  mkdir -p "$P/script" "$P/dist/public/assets" "$S/current/dist/public/assets" "$BIN"
  cp "$HERE/deploy.sh" "$P/script/deploy.sh"
  echo '{"name":"x"}' > "$P/package.json"; echo 'lock-1' > "$P/package-lock.json"
  echo 'new server' > "$P/dist/index.cjs"
  echo 'console.log("new")' > "$P/dist/public/assets/index-NEW.js"
  echo '<script src="/assets/index-NEW.js"></script>' > "$P/dist/public/index.html"
  cp "$P/package.json" "$P/package-lock.json" "$S/current/"
  echo 'old server' > "$S/current/dist/index.cjs"
  echo 'console.log("old")' > "$S/current/dist/public/assets/index-OLD.js"
  echo '<script src="/assets/index-OLD.js"></script>' > "$S/current/dist/public/index.html"
  # The server's files are from yesterday's build. (Made in the same second and the same length as the new ones, rsync
  # would take them for unchanged and skip them, which no real build ever is.)
  yesterday="$(date -v-1d +%Y%m%d%H%M 2>/dev/null || date -d yesterday +%Y%m%d%H%M)"
  find "$S" -type f -exec touch -t "$yesterday" {} +
  cp "$S/current/dist/public/index.html" "$T/served.html"   # what the running server holds in memory
  echo 200 > "$T/health"; echo 0 > "$T/ssh_drops"; : > "$T/log"

  # ssh: drop the options and the host, run the command here. Fails the first N times when told to (dropped connections).
  cat > "$BIN/ssh" <<SH
#!/usr/bin/env bash
n=\$(cat "$T/ssh_drops"); if [ "\$n" -gt 0 ]; then echo \$((n - 1)) > "$T/ssh_drops"; echo "Connection reset by peer" >&2; exit 255; fi
while [ \$# -gt 0 ]; do case "\$1" in -o|-i) shift 2 ;; *@*) shift; break ;; *) shift ;; esac; done
echo "ssh: \$1" >> "$T/log"
PATH="$BIN:\$PATH" bash -c "\$1"
SH
  # rsync: the real one, with the remote address turned into the local folder.
  cat > "$BIN/rsync" <<SH
#!/usr/bin/env bash
# The real rsync starts a second copy of itself to receive the files; that one is passed straight through.
[ "\${1:-}" = "--server" ] && exec "$REAL_RSYNC" "\$@"
args=(); while [ \$# -gt 0 ]; do case "\$1" in -e) shift 2 ;; *@*:*) args+=("\${1#*:}"); shift ;; *) args+=("\$1"); shift ;; esac; done
echo "rsync: \${args[*]}" >> "$T/log"
"$REAL_RSYNC" "\${args[@]}"
SH
  # systemctl: a restart makes the server read the page on disk; is-active follows the health file.
  cat > "$BIN/systemctl" <<SH
#!/usr/bin/env bash
case "\$1" in
  restart) echo restart >> "$T/log"; cp "$S/current/dist/public/index.html" "$T/served.html" ;;
  is-active) [ "\$(cat "$T/health")" = "200" ] || [ "\$(cat "$T/health")" = "500" ] ;;
esac
SH
  # curl: the health address, the live page, or a build file.
  cat > "$BIN/curl" <<SH
#!/usr/bin/env bash
url="\${@: -1}"
case "\$url" in
  *healthz) cat "$T/health" ;;
  */auth) cat "$T/served.html" ;;
  */assets/*) if [ -f "$S/current/dist/public/assets/\${url##*/}" ]; then printf 'application/javascript; charset=UTF-8'; else printf 'text/html; charset=utf-8'; fi ;;
esac
SH
  printf '#!/usr/bin/env bash\nshasum -a 256 "$@"\n' > "$BIN/sha256sum"
  chmod +x "$BIN"/*
}
run() { (cd "$P" && PATH="$BIN:$PATH" DEPLOY_HOST=server.test DEPLOY_ROOT="$S" DEPLOY_SITE=https://site.test DEPLOY_PAUSE=0 DEPLOY_KEY=/dev/null bash script/deploy.sh "$@") > "$T/out" 2>&1; echo $? > "$T/code"; }
code() { cat "$T/code"; }
out()  { cat "$T/out"; }
teardown() { [ -n "${DEBUG:-}" ] && { echo "--- out"; cat "$T/out"; echo "--- log"; cat "$T/log"; }; rm -rf "$T"; }

echo "a normal deploy"
setup; run
check "finishes and says the new build is live" '[ "$(code)" = 0 ] && out | grep -q "DONE. The new build is live."'
check "the old script is STILL on the server (the page that was live never lost its file)" '[ -f "$S/current/dist/public/assets/index-OLD.js" ]'
check "the new script and the new server file are there" '[ -f "$S/current/dist/public/assets/index-NEW.js" ] && grep -q "new server" "$S/current/dist/index.cjs"'
check "restarted exactly once, after the upload" '[ "$(grep -c "^restart" "$T/log")" = 1 ] && [ "$(grep -n "^rsync" "$T/log" | head -1 | cut -d: -f1)" -lt "$(grep -n "^restart" "$T/log" | cut -d: -f1)" ]'
check "the live page now asks for the new script" 'grep -q "index-NEW.js" "$T/served.html"'
check "a copy of the old build was kept to go back to" 'ls -d "$S"/dist.prev-* >/dev/null 2>&1 && grep -q "old server" "$S"/dist.prev-*/index.cjs'
check "the upload never asked rsync to delete anything" '! grep "^rsync" "$T/log" | grep -q -- "--delete"'
check "it checked that the server file that landed is from this build" 'out | grep -q "the server file there matches this build"'
teardown

echo "old build files"
setup
touch -t 202601010000 "$S/current/dist/public/assets/index-ANCIENT.js"
run
check "a build file more than a week old is removed, after the site was checked" '[ ! -f "$S/current/dist/public/assets/index-ANCIENT.js" ] && out | grep -q "1 old file(s) removed"'
check "the file the old page used (one day old) is kept" '[ -f "$S/current/dist/public/assets/index-OLD.js" ]'
teardown

echo "dropped connections"
setup; echo 5 > "$T/ssh_drops"; run
check "five dropped connections in a row and it still finishes" '[ "$(code)" = 0 ] && grep -q "index-NEW.js" "$T/served.html"'
setup; echo 99 > "$T/ssh_drops"; run
check "a server that cannot be reached stops it before anything changes" '[ "$(code)" != 0 ] && out | grep -q "Nothing was changed" && [ ! -f "$S/current/dist/public/assets/index-NEW.js" ] && ! grep -q "^restart" "$T/log"'
teardown

echo "things that must stop it before anything changes"
setup; echo 'lock-2' > "$P/package-lock.json"; run
check "a different package-lock.json: stops, uploads nothing, restarts nothing" '[ "$(code)" != 0 ] && out | grep -q "package-lock.json differs" && [ ! -f "$S/current/dist/public/assets/index-NEW.js" ] && ! grep -q "^restart" "$T/log"'
teardown
setup; rm -rf "$P/dist"; run
check "no build: stops and says to build" '[ "$(code)" != 0 ] && out | grep -q "There is no build here" && ! grep -q "^rsync" "$T/log"'
teardown
setup; rm "$P/dist/public/assets/index-NEW.js"; run
check "a build whose page names a missing script: stops" '[ "$(code)" != 0 ] && out | grep -q "The build is incomplete" && ! grep -q "^rsync" "$T/log"'
teardown
setup
(cd "$P" && git init -q && git -c user.email=t@t.test -c user.name=t add package.json && GIT_COMMITTER_DATE="2030-01-01T00:00:00Z" git -c user.email=t@t.test -c user.name=t commit -q -m x)
run
check "a build older than the latest commit: stops, so old code cannot go live" '[ "$(code)" != 0 ] && out | grep -q "older than the latest commit" && ! grep -q "^rsync" "$T/log"'
teardown
setup; (cd "$P" && PATH="$BIN:$PATH" DEPLOY_ROOT="$S" DEPLOY_HOST= bash script/deploy.sh) > "$T/out" 2>&1; echo $? > "$T/code"
check "no server address: stops and says where to put it" '[ "$(code)" != 0 ] && out | grep -q "No server address"'
teardown

echo "a deploy that goes wrong after the upload"
setup; echo 500 > "$T/health"; run
check "the app is unhealthy after the restart: stops loudly, names the copy to go back to, and tidies nothing" '[ "$(code)" != 0 ] && out | grep -q "TELL CLAUDE NOW" && out | grep -q "dist.prev-" && ! out | grep -q "7/7"'
check "even then the old script is still on the server" '[ -f "$S/current/dist/public/assets/index-OLD.js" ]'
teardown
setup
# The server restarts but goes on serving the old page (the restart did not take).
cat > "$BIN/systemctl" <<SH
#!/usr/bin/env bash
case "\$1" in restart) echo restart >> "$T/log" ;; is-active) true ;; esac
SH
run
check "healthy but still serving the old page: not called done" '[ "$(code)" != 0 ] && out | grep -q "not serving the new build" && ! out | grep -q "DONE"'
teardown

echo "--check"
setup; run --check
check "looks only: no upload, no restart, no copy; says the site is up and on a different build" '[ "$(code)" = 0 ] && ! grep -q "^rsync\|^restart" "$T/log" && ! ls -d "$S"/dist.prev-* >/dev/null 2>&1 && out | grep -q "nothing was changed" && out | grep -q "different build" && out | grep -q "The site is up"'
setup; rm "$S/current/dist/public/assets/index-OLD.js"; run --check
check "sees a blank site: the script the live page asks for does not load" '[ "$(code)" = 0 ] && out | grep -q "does NOT load"'
teardown
setup
# A change to the server only: the page and its script are the same as what is live; only the server file differs.
cp "$S/current/dist/public/index.html" "$P/dist/public/index.html"; cp "$S/current/dist/public/assets/index-OLD.js" "$P/dist/public/assets/"; rm "$P/dist/public/assets/index-NEW.js"
run --check
check "a server-only change is still seen as a different build" '[ "$(code)" = 0 ] && out | grep -q "different build" && ! out | grep -q "already on this build"'
run
check "and it deploys: the new server file is there, and the same page still loads" '[ "$(code)" = 0 ] && grep -q "new server" "$S/current/dist/index.cjs" && out | grep -q "DONE"'
run --check
check "afterwards the check says the site is on this build" 'out | grep -q "already on this build"'
teardown
setup; run bogus
check "an unknown option is refused" '[ "$(code)" != 0 ] && out | grep -q "Unknown option"'
teardown

printf '\n%d passed, %d failed\n' "$pass" "$failed"
[ "$failed" = 0 ]
