# dbadmin

A small web-based PostgreSQL admin client: browse tables, inspect columns, page through rows, and run raw SQL — all from one page, no ORM.

## Prerequisites

- Docker Engine with the Compose v2 plugin (`docker compose ...`, not the legacy `docker-compose` binary)
- Node.js 22+ and `npm`
- `curl` on the host (used by `dbadmin.sh` to poll readiness)

Node is required even though the app runs in containers: the database schema/seed scripts and the Playwright test runner are invoked from the host.

## Quickstart

```sh
./dbadmin.sh setup   # copies .env, npm install, installs Playwright's browser
./dbadmin.sh dev      # builds + starts postgres and dbadmin (source mounted, live reload)
./dbadmin.sh seed     # in another terminal: applies the schema and seeds pet-store data
```

Open http://localhost:8080.

## Environment variables

| Variable | Default | Set in |
|---|---|---|
| `POSTGRES_USER` | `postgres` | `.env` (main stack) |
| `POSTGRES_PASSWORD` | `postgres` | `.env` (main stack) |
| `POSTGRES_DB` | `dbadmin` | `.env` (main stack) |
| `DB_HOST_PORT` | `55432` | `.env` — host port for postgres |
| `APP_HOST_PORT` | `8080` | `.env` — host port for dbadmin |
| `DB_ADMIN_PORT` | `80` | server's in-container listen port |

The test stacks (`docker-compose.test-dev.yml` / `docker-compose.test-prod.yml`) use hardcoded throwaway credentials and don't read `.env`, so `./dbadmin.sh test:dev` / `test:prod` need zero setup beyond `./dbadmin.sh setup`.

## Architecture

Express 5 server (`src/index.js`) exposes:

- `GET /api/tables` — table list via `information_schema.tables`
- `GET /api/tables/:name/columns` — column introspection via `information_schema.columns`
- `GET /api/tables/:name/rows` — paginated row browsing (`limit`/`offset`, capped at 1000)
- `POST /api/query` — runs arbitrary SQL from the request body directly against the database. This is an intentionally unsanitized SQL console, not a safe multi-tenant API — don't expose it to untrusted users.
- `GET /healthz` — runs `SELECT 1`; used by Docker `HEALTHCHECK`, Compose readiness (`service_healthy`), and `dbadmin.sh`'s test-stack polling.

The frontend (`src/public/index.html`) is a single static file: vanilla JS/CSS, no framework, no bundler.

## Database schema

`db/schema.sql` defines an OpenAPI-Petstore-like schema: `categories`, `tags`, `users`, `pets` (FK to `categories`), `pet_tags` (pets↔tags join), and `orders` (FK to `pets` and `users`).

`db/seed.js` seeds it deterministically (`@faker-js/faker` with a fixed seed) via chunked bulk inserts: 8 categories, 30 tags, 150 users, 400 pets, ~1000 pet_tags, 600 orders. Counts and a fixed fixture username live in `db/seed-constants.js`, shared by the seeder and the e2e specs so they can never drift apart.

## Testing

Two containerized e2e targets, both driven by Playwright against `tests/e2e/`:

| Command | What it tests | Compose file |
|---|---|---|
| `./dbadmin.sh test:dev` | The dev container, with the current source tree bind-mounted — fast iteration loop | `docker-compose.test-dev.yml` |
| `./dbadmin.sh test:prod` | The **built production image**, no volume mounts at all — verifies what actually ships | `docker-compose.test-prod.yml` |
| `./dbadmin.sh test` | Both of the above; exits non-zero if either fails | both |

Each run: builds and starts an ephemeral postgres + dbadmin stack (own Compose project name, own ports — won't collide with `./dbadmin.sh dev` or with each other), waits for `/healthz`, applies the schema, seeds it, runs the full Playwright suite (`tests/e2e/specs/*.spec.js`), then tears the stack down — even on failure. The script's own exit code reflects Playwright's, so it's CI-ready as-is.

Specs cover the app's main surface: the table sidebar and column introspection, paginated row browsing against the seeded counts, and the SQL console (a `SELECT`, a mutating `UPDATE` asserting `OK: N row(s) changed`, and an invalid query's error path).

`tests/e2e/` is deliberately nested under `tests/` so `tests/unit/`, `tests/integration/`, and `tests/feature/` can be added later as clean siblings.

## Development scripts

```sh
./dbadmin.sh lint        # eslint .
./dbadmin.sh typecheck   # tsc -p jsconfig.json (checkJs against JSDoc types)
```

## Troubleshooting

- **Port already in use**: the dev stack uses 55432/8080, `test:dev` uses 55433/8081, `test:prod` uses 55434/8082. Adjust `.env` (dev stack) or the relevant `docker-compose.test-*.yml` (test stacks) if any collide with something else on your machine.
- **Stale/broken dev database**: `./dbadmin.sh reset` re-applies the schema and reseeds. `./dbadmin.sh down --volumes` additionally deletes the dev stack's postgres data volume entirely.
