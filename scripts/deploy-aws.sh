#!/usr/bin/env bash
# Deploy this procura-dev working copy — code AND database — to the AWS box.
#
#   bash scripts/deploy-aws.sh
#
# What you do:  turn on the VPN, run this, paste fresh AWS credentials into the
#               TextEdit window it opens, save, press Enter.
# What it does: 1. checks the VPN reaches the box
#               2. checks your AWS session (opens ~/.aws/credentials if expired)
#               3. bundles this folder (no node_modules/.next/.git/.env) and
#                  dumps your local MySQL (docker container procura-mysql)
#               4. on the box, through SSM (no SSH needed):
#                    backs up the current code and database to /var/backups/procura
#                    replaces the code (the box keeps its own .env)
#                    REPLACES the database with your local one
#                    npm ci, prisma generate + migrate deploy, next build, restart
#                    checks /api/health
#
# Rollback: the script prints the backup paths and the exact restore commands.
#
# Box: procura-dev  i-084e7f909db5aef50  ap-south-1  10.1.13.115
set -euo pipefail
export AWS_PAGER=""   # never stop in `less` mid-deploy

IID="i-084e7f909db5aef50"
REGION="ap-south-1"
HOST_IP="10.1.13.115"
DB_CONTAINER="procura-mysql"
DB_NAME="procura"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d /tmp/procura-deploy.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

# A copy of everything printed, so a failed run can be diagnosed afterwards.
LOG="$HERE/.deploy-aws-last.log"
exec > >(tee "$LOG") 2>&1

say()  { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
die()  { printf '\n\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

# ── 1. VPN ────────────────────────────────────────────────────────────────────
say "Checking the VPN reaches $HOST_IP"
until nc -z -G 5 "$HOST_IP" 80 >/dev/null 2>&1; do
  echo "  Cannot reach $HOST_IP — the VPN is off or has dropped."
  read -r -p "  Connect the VPN, then press Enter to retry (Ctrl-C to stop)… " _
done
echo "  reachable."

# ── 2. AWS credentials ───────────────────────────────────────────────────────
say "Checking your AWS session"
if ! aws sts get-caller-identity --query Arn --output text >/dev/null 2>&1; then
  mkdir -p ~/.aws; touch ~/.aws/credentials
  echo "  Your AWS session has expired. TextEdit is opening ~/.aws/credentials."
  echo "  Replace the [default] block with your fresh keys, save (⌘S), close it."
  open -e ~/.aws/credentials
  read -r -p "  Press Enter when saved… " _
  aws sts get-caller-identity --query Arn --output text >/dev/null 2>&1 \
    || die "Still no valid AWS session. Check the keys you pasted and run again."
fi
echo "  signed in as $(aws sts get-caller-identity --query Arn --output text)"
PING=$(aws ssm describe-instance-information --region "$REGION" \
  --filters "Key=InstanceIds,Values=$IID" --query 'InstanceInformationList[0].PingStatus' \
  --output text 2>/dev/null || true)
[ "$PING" = "Online" ] || die "SSM agent on $IID is not online (got: ${PING:-nothing})."

# Run a script on the box; print its output; fail if it fails.
remote() {
  local file="$1" timeout="${2:-900}" params cid st
  # SSM runs commands with /bin/sh (dash), which has no pipefail, arrays or
  # process substitution — so write the script to a file and run it with bash.
  params=$(python3 -c '
import json, sys
body = open(sys.argv[1]).read()
wrapped = "cat > /tmp/procura-remote.sh <<'"'"'PROCURA_EOF'"'"'\n" + body + "\nPROCURA_EOF\nbash /tmp/procura-remote.sh; rc=$?; rm -f /tmp/procura-remote.sh; exit $rc\n"
print(json.dumps({"commands": [wrapped], "executionTimeout": [sys.argv[2]]}))' "$file" "$timeout")
  cid=$(aws ssm send-command --region "$REGION" --instance-ids "$IID" \
    --document-name AWS-RunShellScript --parameters "$params" \
    --query Command.CommandId --output text)
  while :; do
    st=$(aws ssm get-command-invocation --region "$REGION" --command-id "$cid" \
      --instance-id "$IID" --query Status --output text 2>/dev/null || echo Pending)
    case "$st" in Pending|InProgress|Delayed) sleep 3 ;; *) break ;; esac
  done
  aws ssm get-command-invocation --region "$REGION" --command-id "$cid" --instance-id "$IID" \
    --query StandardOutputContent --output text
  if [ "$st" != "Success" ]; then
    aws ssm get-command-invocation --region "$REGION" --command-id "$cid" --instance-id "$IID" \
      --query StandardErrorContent --output text >&2
    return 1
  fi
}

# ── 3. Bundle code + dump database ────────────────────────────────────────────
say "Bundling $(basename "$HERE") ($(git -C "$HERE" branch --show-current) @ $(git -C "$HERE" log --oneline -1 | cut -c1-60))"
tar -C "$HERE" --exclude=./node_modules --exclude=./.next --exclude=./.git \
  --exclude=./.env --exclude='./.env.*' -czf "$WORK/src.tgz" .
echo "  code: $(du -h "$WORK/src.tgz" | cut -f1)"

say "Dumping local database ($DB_CONTAINER/$DB_NAME)"
docker exec "$DB_CONTAINER" sh -c \
  "mysqldump -uroot -p\"\$MYSQL_ROOT_PASSWORD\" --single-transaction --routines --no-tablespaces --databases $DB_NAME 2>/dev/null" \
  | gzip > "$WORK/db.sql.gz"
# zgrep, not `gunzip | grep -q`: grep -q exits on the first match, gunzip then
# dies of SIGPIPE, and pipefail turns a good dump into a "failure".
zgrep -q "CREATE TABLE" "$WORK/db.sql.gz" || die "The database dump is empty."
echo "  database: $(du -h "$WORK/db.sql.gz" | cut -f1)"

# ── 4a. Get the two files onto the box ────────────────────────────────────────
# Preferred: a private S3 bucket + short-lived presigned URLs (the box needs no
# S3 permission). Fallback: stream them in chunks through SSM itself.
say "Uploading to the box"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
BUCKET="procura-deploy-$ACCOUNT-$REGION"
SRC_URL=""; DB_URL=""
if aws s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1 \
   || aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
        --create-bucket-configuration LocationConstraint="$REGION" >/dev/null 2>&1; then
  aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true >/dev/null 2>&1 || true
  if aws s3 cp "$WORK/src.tgz" "s3://$BUCKET/$STAMP/src.tgz" --only-show-errors \
     && aws s3 cp "$WORK/db.sql.gz" "s3://$BUCKET/$STAMP/db.sql.gz" --only-show-errors; then
    SRC_URL=$(aws s3 presign "s3://$BUCKET/$STAMP/src.tgz" --expires-in 3600 --region "$REGION")
    DB_URL=$(aws s3 presign "s3://$BUCKET/$STAMP/db.sql.gz" --expires-in 3600 --region "$REGION")
    echo "  via S3 ($BUCKET)."
  fi
fi

if [ -z "$SRC_URL" ]; then
  echo "  S3 not available to your role — streaming through SSM in chunks (a few minutes)."
  push_chunks() {  # <local file> <remote path>
    local f="$1" dest="$2" i=0
    base64 < "$f" | tr -d '\n' | fold -w 24000 > "$WORK/chunks"
    printf 'mkdir -p /tmp/procura-incoming && : > %s.b64\n' "$dest" > "$WORK/c.sh"
    remote "$WORK/c.sh" 60 >/dev/null
    local n; n=$(wc -l < "$WORK/chunks" | tr -d ' ')
    while IFS= read -r line; do
      i=$((i+1)); printf '  %s chunk %s/%s\r' "$(basename "$dest")" "$i" "$n"
      printf 'printf %%s %q >> %s.b64\n' "$line" "$dest" > "$WORK/c.sh"
      remote "$WORK/c.sh" 60 >/dev/null
    done < "$WORK/chunks"
    printf 'base64 -d %s.b64 > %s && rm %s.b64\n' "$dest" "$dest" "$dest" > "$WORK/c.sh"
    remote "$WORK/c.sh" 60 >/dev/null; echo
  }
  push_chunks "$WORK/src.tgz" /tmp/procura-incoming/src.tgz
  push_chunks "$WORK/db.sql.gz" /tmp/procura-incoming/db.sql.gz
fi

# ── 4b. Back up, replace, build, restart, check — on the box ─────────────────
say "Deploying on the box (backup → code → database → build → restart)"
cat > "$WORK/deploy-remote.sh" <<REMOTE
set -euo pipefail
STAMP="$STAMP"
SRC_URL='$SRC_URL'
DB_URL='$DB_URL'
DB_NAME="$DB_NAME"
REMOTE
cat >> "$WORK/deploy-remote.sh" <<'REMOTE'
IN=/tmp/procura-incoming; mkdir -p "$IN"
if [ -n "$SRC_URL" ]; then
  curl -fsSL "$SRC_URL" -o "$IN/src.tgz"
  curl -fsSL "$DB_URL" -o "$IN/db.sql.gz"
fi
test -s "$IN/src.tgz" && test -s "$IN/db.sql.gz"

# Where the app lives: the folder holding prisma.config.ts and a .env.
APP=""
for c in $(find /home /opt /srv /var/www /root -maxdepth 4 -name prisma.config.ts -not -path '*/node_modules/*' 2>/dev/null); do
  d=$(dirname "$c"); [ -f "$d/.env" ] && { APP="$d"; break; }
done
[ -n "$APP" ] || { echo "Could not find the Procura app folder (prisma.config.ts + .env)."; exit 1; }
OWNER=$(stat -c %U "$APP")
echo "app: $APP (owner $OWNER)"
as_owner() { sudo -u "$OWNER" -H bash -lc "cd '$APP' && $*"; }

# DB connection from the box's own .env.
DBURL=$(grep -m1 -E '^DATABASE_URL=' "$APP/.env" | cut -d= -f2- | tr -d '"'"'" || true)
[ -n "$DBURL" ] || { echo "No DATABASE_URL in $APP/.env"; exit 1; }
read -r DBUSER DBPASS DBHOST DBPORT DBN < <(python3 - "$DBURL" <<'PY'
import sys, urllib.parse as u
p=u.urlparse(sys.argv[1]); print(u.unquote(p.username or ""), u.unquote(p.password or "") or "-", p.hostname or "localhost", p.port or 3306, (p.path or "/").lstrip("/").split("?")[0])
PY
)
[ "$DBPASS" = "-" ] && DBPASS=""
export MYSQL_PWD="$DBPASS"
MYSQL="mysql -h $DBHOST -P $DBPORT -u $DBUSER"; DUMP="mysqldump -h $DBHOST -P $DBPORT -u $DBUSER"
if ! command -v mysql >/dev/null; then
  # MySQL in Docker on the box.
  C=$(docker ps --format '{{.Names}} {{.Image}}' | awk '/mysql/{print $1}' | sed -n 1p || true)
  [ -n "$C" ] || { echo "No mysql client and no mysql container on the box."; exit 1; }
  MYSQL="docker exec -i -e MYSQL_PWD $C mysql -u $DBUSER"; DUMP="docker exec -e MYSQL_PWD $C mysqldump -u $DBUSER"
fi

# 1) Backups.
B=/var/backups/procura; mkdir -p "$B"
$DUMP --single-transaction --routines --no-tablespaces "$DBN" | gzip > "$B/db-$STAMP.sql.gz"
tar -C "$APP" --exclude=./node_modules --exclude=./.next -czf "$B/code-$STAMP.tgz" .
echo "backup: $B/db-$STAMP.sql.gz  $B/code-$STAMP.tgz"

# 2) Code: replace everything except the box's .env files.
find "$APP" -mindepth 1 -maxdepth 1 ! -name node_modules ! -name '.env' ! -name '.env.*' ! -name .next -exec rm -rf {} +
tar -C "$APP" -xzf "$IN/src.tgz"
chown -R "$OWNER": "$APP"

# 3) Database: drop and reload from the local dump (it carries its own schema
#    and migration history). The dump names the local db "procura"; load it
#    into whatever the box's .env points at.
$MYSQL -e "DROP DATABASE IF EXISTS \`$DBN\`; CREATE DATABASE \`$DBN\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
gunzip -c "$IN/db.sql.gz" \
  | sed -e "s/^CREATE DATABASE .*\`$DB_NAME\`.*;$//" -e "s/^USE \`$DB_NAME\`;$/USE \`$DBN\`;/" \
  | $MYSQL "$DBN"
echo "database reloaded: $($MYSQL -N -e "select count(*) from information_schema.tables where table_schema='$DBN'") tables"

# 4) Build.
as_owner "npm ci --no-audit --no-fund >/tmp/procura-npm.log 2>&1 || (tail -40 /tmp/procura-npm.log; exit 1)"
as_owner "set -a; . ./.env; set +a; npx prisma generate >/dev/null && npx prisma migrate deploy"
as_owner "set -a; . ./.env; set +a; npx next build >/tmp/procura-build.log 2>&1 || (tail -60 /tmp/procura-build.log; exit 1)"
echo "built."

# 5) Restart, whichever way it runs.
RESTARTED=""
if sudo -u "$OWNER" -H bash -lc 'command -v pm2' >/dev/null 2>&1; then
  NAME=$(sudo -u "$OWNER" -H bash -lc 'pm2 jlist' | python3 -c "
import json,sys
for p in json.load(sys.stdin):
  if p.get('pm2_env',{}).get('pm_cwd','').rstrip('/')=='$APP'.rstrip('/'): print(p['name']); break" 2>/dev/null || true)
  if [ -n "$NAME" ]; then sudo -u "$OWNER" -H bash -lc "pm2 restart '$NAME' --update-env && pm2 save" >/dev/null; RESTARTED="pm2:$NAME"; fi
fi
if [ -z "$RESTARTED" ]; then
  UNIT=$(systemctl list-units --type=service --no-legend | awk '{print $1}' | grep -i -E 'procura|next' | sed -n 1p || true)
  if [ -n "$UNIT" ]; then systemctl restart "$UNIT"; RESTARTED="systemd:$UNIT"; fi
fi
[ -n "$RESTARTED" ] || { echo "Built, but found no pm2 process or systemd unit to restart."; exit 1; }
echo "restarted: $RESTARTED"

# 6) Health.
PORT=$(grep -rhoE 'proxy_pass http://(127\.0\.0\.1|localhost):[0-9]+' /etc/nginx/sites-enabled/ 2>/dev/null | sed -n 1p | grep -oE '[0-9]+$' || true)
PORT=${PORT:-3000}
for i in $(seq 1 40); do curl -sf -o /dev/null "http://127.0.0.1:$PORT/api/health" && { echo "healthy on :$PORT"; break; }; sleep 3; done
curl -sf -o /dev/null "http://127.0.0.1:$PORT/api/health" || { echo "Not healthy after restart."; exit 1; }
rm -rf "$IN"
echo "ROLLBACK if needed:"
echo "  code: rm -rf $APP/* && tar -C $APP -xzf $B/code-$STAMP.tgz && (build + restart)"
echo "  db:   gunzip -c $B/db-$STAMP.sql.gz | mysql $DBN"
REMOTE

remote "$WORK/deploy-remote.sh" 1800 || die "Deploy failed on the box — see above. Backups are in /var/backups/procura on the box."

say "Checking from here"
code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "http://$HOST_IP/products" || true)
echo "  http://$HOST_IP/products → $code (307 to /login is the password gate — that means it is up)"
[ -n "${BUCKET:-}" ] && aws s3 rm "s3://$BUCKET/$STAMP" --recursive --only-show-errors >/dev/null 2>&1 || true
say "Done. Open http://$HOST_IP/products"
