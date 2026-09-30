#!/usr/bin/env bash
# Publish Procura on a temporary public URL for a demo.
#
#   ./scripts/share.sh          start (prints the URL + password)
#   ./scripts/share.sh stop     take it offline
#
# The URL changes every time you start — Cloudflare quick tunnels are
# ephemeral. Your Mac must stay awake and this terminal open.
set -euo pipefail
cd "$(dirname "$0")/.."

stop() {
  pkill -f "ngrok http" 2>/dev/null || true
  pkill -f "next start" 2>/dev/null || true
  pkill -f "next-server" 2>/dev/null || true
  echo "Procura is offline."
}

[ "${1:-start}" = "stop" ] && { stop; exit 0; }

command -v ngrok >/dev/null || { echo "ngrok not installed: brew install ngrok"; exit 1; }
docker ps --filter name=procura-mysql --filter status=running -q | grep -q . \
  || { echo "MySQL is not running. Start it with: npm run db:up"; exit 1; }

# Fail loudly rather than publishing an ungated portal.
grep -q "^DEMO_PASSWORD=" .env || { echo "No DEMO_PASSWORD in .env — refusing to publish without the gate."; exit 1; }
set -a; . ./.env; set +a

stop >/dev/null 2>&1 || true
sleep 1

echo "Building…"
npx next build >/tmp/procura-build.log 2>&1 || { tail -20 /tmp/procura-build.log; exit 1; }

nohup npx next start -p 3000 >/tmp/procura-prod.log 2>&1 &
for i in $(seq 1 30); do
  curl -sf -o /dev/null http://localhost:3000/api/health && break
  sleep 1
done

# ngrok assigns ONE static domain per free account and keeps it forever, so
# this URL is the same every run — which is the whole point: it gets shared
# with the business once and never again. Fresh log so we never read a
# previous run's URL and hand out a stale link.
: > /tmp/ngrok.log
nohup ngrok http 3000 --log=stdout > /tmp/ngrok.log 2>&1 &

echo "Opening the tunnel…"
URL=""
for _ in $(seq 1 40); do
  URL=$(grep -oE "url=https://[a-z0-9-]+\.ngrok-free\.(dev|app)" /tmp/ngrok.log 2>/dev/null | tail -1 | sed 's/^url=//' || true)
  [ -n "$URL" ] && break
  sleep 1
done
[ -n "$URL" ] || { echo "Tunnel did not come up. See /tmp/ngrok.log"; exit 1; }

# Poll until it routes. The skip-browser-warning header is for THIS check only
# — a real browser still gets ngrok's one-time interstitial, which is expected.
echo "Waiting for $URL to route…"
CODE=000
for _ in $(seq 1 12); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 \
    -H "ngrok-skip-browser-warning: 1" "$URL/api/award-summary" || echo 000)
  [ "$CODE" != "000" ] && break
  sleep 5
done

# Never hand out a link without proving the gate is shut.
[ "$CODE" = "401" ] || { echo "REFUSING TO SHARE: data endpoint returned $CODE, expected 401."; stop; exit 1; }

printf '\n  Procura is live\n\n    %s\n    password: %s\n\n  This URL is PERMANENT - same every restart, so share it once.\n  Gate verified (data returns 401 without it).\n  First-time visitors click "Visit Site" once on an ngrok notice.\n  Keep this Mac awake. Stop with: ./scripts/share.sh stop\n\n' "$URL" "$DEMO_PASSWORD"
