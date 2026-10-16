#!/usr/bin/env bash
# Deploy FunnelHive on the server, with automatic rollback. Run it ON the server, in the app folder, after the new
# files are in place (see DEPLOY.md):
#   bash server/scripts/deploy.sh <version>   build funnelhive:<version> while the running app keeps serving, make it
#                                             funnelhive:current (the old one becomes funnelhive:previous), recreate
#                                             only the app container, and switch back automatically if it isn't
#                                             healthy within 90 s (DEPLOY_HEALTH_WAIT)
#   bash server/scripts/deploy.sh rollback    switch to funnelhive:previous by hand (run again to undo)
#   bash server/scripts/deploy.sh status      which images are current / previous, and the app's health
# Caddy keeps running throughout and retries for up to 30 s while the container is swapped (deploy/Caddyfile).
set -euo pipefail
cd "$(dirname "$0")/../.."

IMG=funnelhive
WAIT=${DEPLOY_HEALTH_WAIT:-90}

say() { printf '%s\n' "$*"; }
die() { say "✗ $*" >&2; exit 1; }
id_of() { docker image inspect -f '{{.Id}}' "$1" 2>/dev/null || true; }
short() { printf '%s' "${1#sha256:}" | cut -c1-12; }

# recreate only the app container on funnelhive:current (the database volume stays; Caddy isn't touched)
swap_in() { FH_TAG=current docker compose up -d --no-deps --no-build --force-recreate funnelhive; }

# 0 once /api/health answers 200 from inside the new container, 1 if it doesn't within $WAIT seconds
healthy() {
  local end=$(( $(date +%s) + WAIT )) body
  while [ "$(date +%s)" -lt "$end" ]; do
    if body=$(docker compose exec -T funnelhive wget -qO- http://127.0.0.1:4000/api/health 2>/dev/null); then say "  health: $body"; return 0; fi
    sleep 2
  done
  say "  last health answer: $(docker compose exec -T funnelhive node -e "fetch('http://127.0.0.1:4000/api/health').then(async (r) => console.log(r.status, await r.text())).catch((e) => console.log(e.message))" 2>&1 | tail -n 2 || true)"
  return 1
}

reload_caddy() { docker compose --profile https exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 && say "  Caddy config reloaded" || true; }

deploy() {
  local ver=$1 cur
  [[ "$ver" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || die "version must be letters, digits, . _ - (e.g. the git short sha)"
  say "→ building $IMG:$ver (the running app keeps serving)…"
  docker build --build-arg APP_VERSION="$ver" -t "$IMG:$ver" .
  cur=$(id_of "$IMG:current")
  [ -n "$cur" ] || cur=$(id_of "$IMG:latest") # servers set up before deploy.sh ran funnelhive:latest
  [ -n "$cur" ] && docker tag "$cur" "$IMG:previous"
  docker tag "$IMG:$ver" "$IMG:current"
  say "→ switching the app container to $ver…"
  swap_in
  if healthy; then
    reload_caddy
    # old version tags go (the images behind current / previous stay); dangling layers are cleared
    docker images "$IMG" --format '{{.Tag}}' | grep -vxE "current|previous|latest|$ver|<none>" | xargs -r -I{} docker rmi "$IMG:{}" >/dev/null 2>&1 || true
    docker image prune -f >/dev/null 2>&1 || true
    say "✓ deployed $ver (rollback: bash server/scripts/deploy.sh rollback)"
    return 0
  fi
  say "✗ $ver didn't become healthy within ${WAIT}s — its last log lines:"
  docker compose logs --tail 40 funnelhive || true
  [ -n "$cur" ] || die "no previous image to roll back to"
  say "→ rolling back to the previous image ($(short "$cur"))…"
  docker tag "$IMG:previous" "$IMG:current"
  swap_in
  if healthy; then say "✓ rolled back; $ver is kept as $IMG:$ver for a look (docker run --rm -it $IMG:$ver sh)"; else say "✗ the previous image isn't healthy either — check: docker compose logs funnelhive"; fi
  exit 1
}

rollback() {
  local prev cur
  prev=$(id_of "$IMG:previous"); cur=$(id_of "$IMG:current")
  [ -n "$prev" ] || die "no $IMG:previous image to go back to"
  say "→ switching to the previous image ($(short "$prev"))…"
  docker tag "$prev" "$IMG:current"
  [ -n "$cur" ] && docker tag "$cur" "$IMG:previous"
  swap_in
  healthy || die "the app isn't healthy after the rollback — check: docker compose logs funnelhive"
  say "✓ rolled back (run rollback again to undo)"
}

status() {
  say "current:  $(short "$(id_of "$IMG:current")")  previous: $(short "$(id_of "$IMG:previous")")"
  docker images "$IMG" --format '  {{.Tag}}\t{{.ID}}\t{{.CreatedSince}}'
  docker compose exec -T funnelhive wget -qO- http://127.0.0.1:4000/api/health 2>/dev/null && echo || say "  app not healthy / not running"
}

case "${1:-}" in
  rollback) rollback ;;
  status) status ;;
  ''|-h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
  *) deploy "$1" ;;
esac
