#!/usr/bin/env bash
#
# The only supported way to deploy Makutano Connect.
#
# It exists because a hand-typed rsync put two deploys into
# /home/makutano/connect/ — a stale copy of this repo that nothing runs from —
# and overwrote that directory's .env with a development one. Both deploys
# reported success and changed nothing in production, which reads as "the fix
# did not work" and sends you back into code that was already correct.
#
# So this script refuses to guess. It will not run unless the destination is
# the canonical path AND the running container agrees that is where it lives.
#
# Usage:
#   tool/deploy.sh                    # rebuild connect and tracking-worker
#   tool/deploy.sh connect            # rebuild one service
#   tool/deploy.sh tracking-worker
set -euo pipefail
cd "$(dirname "$0")/.."

CANONICAL=/home/makutano/app/services/connect
WEB=makutano-connect
WORKER=makutano-tracking-worker
SSH_HOST=${DEPLOY_SSH_HOST:?set DEPLOY_SSH_HOST, e.g. makutano@host}
SSH_PORT=${DEPLOY_SSH_PORT:-2807}
SSH_KEY=${DEPLOY_SSH_KEY:?set DEPLOY_SSH_KEY, e.g. ~/.ssh/makutano_connect_deploy}
SSH="ssh -p $SSH_PORT -i $SSH_KEY $SSH_HOST"

SERVICES=("${@:-connect tracking-worker}")
read -r -a SERVICES <<< "${SERVICES[*]}"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
die() { printf '\n\033[31mREFUSING TO DEPLOY: %b\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- guard 1/5
# The destination is not a parameter. It is checked against what is actually
# running, so a stale sibling directory can never be deployed into by mistake.
say "Guard 1 — the live container's own compose directory"
LIVE_DIR=$($SSH "docker inspect $WEB --format '{{index .Config.Labels \"com.docker.compose.project.working_dir\"}}'" 2>/dev/null || true)
echo "  $WEB reports: ${LIVE_DIR:-<none>}"
[ -n "$LIVE_DIR" ] || die "could not read $WEB's compose directory — is the container running?"
[ "$LIVE_DIR" = "$CANONICAL" ] || die "live container runs from '$LIVE_DIR', not the canonical '$CANONICAL'."
LIVE_WORKER_DIR=$($SSH "docker inspect $WORKER --format '{{index .Config.Labels \"com.docker.compose.project.working_dir\"}}'" 2>/dev/null || true)
[ "$LIVE_WORKER_DIR" = "$CANONICAL" ] || die "worker runs from '$LIVE_WORKER_DIR', not '$CANONICAL'."
echo "  both services confirmed at $CANONICAL"

# ---------------------------------------------------------------- guard 2/5
say "Guard 2 — the target defines the services we are about to build"
REMOTE_SERVICES=$($SSH "cd $CANONICAL && grep -oE '^  [a-z_-]+:' docker-compose.yml | tr -d ' :'")
echo "  compose defines: $(echo "$REMOTE_SERVICES" | tr '\n' ' ')"
for s in "${SERVICES[@]}"; do
  grep -qx "$s" <<< "$REMOTE_SERVICES" || die "'$s' is not a service in $CANONICAL/docker-compose.yml."
done

# ---------------------------------------------------------------- guard 3/5
# A dry run is the proof. If .env, .env.*, or docker-compose.yml appear in the
# transfer list, the excludes are wrong and we stop before touching anything.
say "Guard 3 — nothing sensitive is in the transfer list"
EXCLUDES=(--exclude '.git' --exclude 'node_modules' --exclude '.svelte-kit' --exclude 'build'
          --exclude '.env' --exclude '.env.*' --exclude 'docker-compose.yml' --exclude '.idea')
# rsync --itemize-changes prints "<f.st.... path", so the path is the SECOND
# field. Matching against the whole line silently never fires — which is how a
# guard becomes decoration. Pull the path out and test that.
LEAKS=$(rsync -azn --itemize-changes -e "ssh -p $SSH_PORT -i $SSH_KEY" "${EXCLUDES[@]}" \
          ./ "$SSH_HOST:$CANONICAL/" \
        | awk '{ $1=""; sub(/^ /,""); print }' \
        | grep -E '(^|/)\.env($|\.)|(^|/)docker-compose\.yml$' || true)
[ -z "$LEAKS" ] || die "the transfer list contains files that must never ship:\n$LEAKS"
echo "  clean — no .env and no docker-compose.yml in the transfer"

# ---------------------------------------------------------------- guard 4/5
say "Guard 4 — fingerprint production's .env so we can prove we did not touch it"
ENV_BEFORE=$($SSH "sha256sum $CANONICAL/.env | cut -d' ' -f1")
echo "  .env sha256 before: ${ENV_BEFORE:0:16}…"

# ---------------------------------------------------------------- what we ship
say "What is being deployed"
LOCAL_COMMIT=$(git rev-parse --short HEAD)
LOCAL_BRANCH=$(git rev-parse --abbrev-ref HEAD)
DIRTY=$(git status --porcelain | wc -l | tr -d ' ')
DEPLOYED_BEFORE=$($SSH "cat $CANONICAL/.deployed-commit 2>/dev/null" || echo "unknown")
echo "  local branch : $LOCAL_BRANCH"
echo "  local HEAD   : $LOCAL_COMMIT  ($(git log -1 --format=%s))"
echo "  uncommitted  : $DIRTY file(s)"
echo "  currently on server: $DEPLOYED_BEFORE"
echo "  services     : ${SERVICES[*]}"

say "Deploying"
rsync -az -e "ssh -p $SSH_PORT -i $SSH_KEY" "${EXCLUDES[@]}" ./ "$SSH_HOST:$CANONICAL/"
# The server's git checkout is stale — source arrives by rsync — so the stamp
# is the only honest record of what is actually on disk there.
$SSH "printf '%s\n' '$LOCAL_COMMIT ($LOCAL_BRANCH) deployed $(date -u +%FT%TZ)' > $CANONICAL/.deployed-commit"
$SSH "cd $CANONICAL && docker compose up -d --build ${SERVICES[*]}" 2>&1 | tail -5

# ---------------------------------------------------------------- guard 5/5
say "Guard 5 — production's .env is byte-identical"
ENV_AFTER=$($SSH "sha256sum $CANONICAL/.env | cut -d' ' -f1")
[ "$ENV_BEFORE" = "$ENV_AFTER" ] || die "PRODUCTION .env CHANGED during deploy. Investigate immediately."
echo "  unchanged (${ENV_AFTER:0:16}…)"

say "Deployed"
$SSH "cat $CANONICAL/.deployed-commit" | sed 's/^/  /'

say "Health"
for i in $(seq 1 30); do
  STATUS=$($SSH "docker ps --format '{{.Names}}\t{{.Status}}' | grep -E '$WEB|$WORKER'")
  grep -q unhealthy <<< "$STATUS" || { echo "$STATUS" | sed 's/^/  /'; break; }
  sleep 4
done
PUBLIC=$(curl -s -o /dev/null -w '%{http_code}' https://connect.makutano.co.tz/)
GUARDED=$(curl -s -o /dev/null -w '%{http_code}' https://connect.makutano.co.tz/app/tracking)
echo "  public route      -> $PUBLIC   (expect 200)"
echo "  guarded route     -> $GUARDED   (expect 303 to /login; 404 would mean the route did not ship)"
[ "$PUBLIC" = "200" ] || die "public route returned $PUBLIC"
[ "$GUARDED" = "303" ] || die "guarded route returned $GUARDED"
echo
echo "OK."
