#!/usr/bin/env bash
# dbadmin dev/test entrypoint. Run `./dbadmin.sh help` for subcommands.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

usage() {
  cat <<'EOF'
Usage: ./dbadmin.sh <command>

  setup       One-time dev setup: .env, npm install, Playwright browsers
  dev         Start the dev stack (source mounted, live reload) in the foreground
  seed        Apply schema + seed the dev stack's database
  reset       Re-apply schema (drop+recreate) and reseed the dev stack's database
  down        Stop the dev stack (add --volumes to also delete the DB volume)
  test:dev    Run the e2e suite against the built dev container (source mounted)
  test:prod   Run the e2e suite against the built prod container (no mounts)
  test        Run both test:dev and test:prod

  Add --trace to any test command to force tracing on for every test (not
  just failures) and archive the trace output after the run, since the next
  run would otherwise wipe it.
  lint        Run eslint
  typecheck   Run tsc --noEmit
EOF
}

require_docker_compose() {
  if ! docker compose version >/dev/null 2>&1; then
    echo "error: 'docker compose' (v2 plugin) is required but not found" >&2
    exit 1
  fi
}

wait_for_healthz() {
  local url="$1"
  local deadline=$((SECONDS + 60))
  until curl -fsS "$url" >/dev/null 2>&1; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "error: timed out waiting for $url" >&2
      exit 1
    fi
    sleep 1
  done
}

cmd_setup() {
  require_docker_compose
  if [ ! -f .env ]; then
    cp .env.example .env
    echo "Created .env from .env.example"
  fi
  npm install
  echo "Installing Playwright's Chromium OS dependencies via apt (needs root; may prompt for sudo password)..."
  npx playwright install --with-deps chromium
  echo "Setup complete. Next: ./dbadmin.sh dev"
}

cmd_dev() {
  require_docker_compose
  docker compose -f docker-compose.yml up --build
}

cmd_seed() {
  require_docker_compose
  docker compose -f docker-compose.yml up -d db
  export POSTGRES_HOST=localhost
  export POSTGRES_PORT="${DB_HOST_PORT:-55432}"
  export POSTGRES_USER="${POSTGRES_USER:-postgres}"
  export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
  export POSTGRES_DB="${POSTGRES_DB:-dbadmin}"
  node db/seed.js
}

cmd_reset() {
  require_docker_compose
  docker compose -f docker-compose.yml up -d db
  export POSTGRES_HOST=localhost
  export POSTGRES_PORT="${DB_HOST_PORT:-55432}"
  export POSTGRES_USER="${POSTGRES_USER:-postgres}"
  export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
  export POSTGRES_DB="${POSTGRES_DB:-dbadmin}"
  node db/apply-schema.js
  node db/seed.js
}

cmd_down() {
  require_docker_compose
  if [ "${1:-}" = "--volumes" ]; then
    docker compose -f docker-compose.yml down -v
  else
    docker compose -f docker-compose.yml down
  fi
}

run_test_stack() {
  local compose_file="$1" app_port="$2" db_port="$3" label="$4" keep_trace="$5"
  require_docker_compose

  local exit_code=0
  trap 'docker compose -f "'"$compose_file"'" down -v' EXIT

  docker compose -f "$compose_file" up -d --build
  wait_for_healthz "http://localhost:${app_port}/healthz"

  POSTGRES_HOST=localhost POSTGRES_PORT="$db_port" POSTGRES_USER=postgres \
    POSTGRES_PASSWORD=test POSTGRES_DB=dbadmin node db/apply-schema.js
  POSTGRES_HOST=localhost POSTGRES_PORT="$db_port" POSTGRES_USER=postgres \
    POSTGRES_PASSWORD=test POSTGRES_DB=dbadmin node db/seed.js

  local trace_args=()
  if [ "$keep_trace" = "1" ]; then
    trace_args=(--trace=on)
  fi

  PLAYWRIGHT_BASE_URL="http://localhost:${app_port}" \
    npx playwright test -c tests/e2e/playwright.config.js "${trace_args[@]}" || exit_code=$?

  if [ "$keep_trace" = "1" ]; then
    archive_trace "$label"
  fi

  trap - EXIT
  docker compose -f "$compose_file" down -v
  return "$exit_code"
}

archive_trace() {
  local label="$1"
  local src="test-results"
  if [ ! -d "$src" ]; then
    echo "no trace output found in $src" >&2
    return
  fi
  local dest="trace-archive/${label}-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$dest"
  cp -r "$src"/. "$dest"/
  local traces
  traces=$(find "$dest" -name 'trace.zip')
  if [ -z "$traces" ]; then
    echo "trace output archived to $dest (no trace.zip files found)" >&2
    return
  fi
  echo "traces archived to $dest, inspect with:"
  while IFS= read -r trace; do
    echo "  npx playwright show-trace $trace"
  done <<< "$traces"
}

cmd_test_dev() {
  local keep_trace=0
  [ "${1:-}" = "--trace" ] && keep_trace=1
  run_test_stack docker-compose.test-dev.yml 8081 55433 test-dev "$keep_trace"
}

cmd_test_prod() {
  local keep_trace=0
  [ "${1:-}" = "--trace" ] && keep_trace=1
  run_test_stack docker-compose.test-prod.yml 8082 55434 test-prod "$keep_trace"
}

cmd_test() {
  local trace_arg="${1:-}"
  local dev_exit=0 prod_exit=0
  cmd_test_dev "$trace_arg" || dev_exit=$?
  cmd_test_prod "$trace_arg" || prod_exit=$?
  if [ "$dev_exit" -ne 0 ] || [ "$prod_exit" -ne 0 ]; then
    echo "test:dev exit=$dev_exit test:prod exit=$prod_exit" >&2
    exit 1
  fi
}

cmd_lint() { npm run lint; }
cmd_typecheck() { npm run typecheck; }

case "${1:-help}" in
  setup) cmd_setup ;;
  dev) cmd_dev ;;
  seed) cmd_seed ;;
  reset) cmd_reset ;;
  down) shift; cmd_down "${1:-}" ;;
  test:dev) shift; cmd_test_dev "${1:-}" ;;
  test:prod) shift; cmd_test_prod "${1:-}" ;;
  test) shift; cmd_test "${1:-}" ;;
  lint) cmd_lint ;;
  typecheck) cmd_typecheck ;;
  help|-h|--help) usage ;;
  *) echo "unknown command: $1" >&2; usage; exit 1 ;;
esac
