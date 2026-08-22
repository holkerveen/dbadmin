# dbadmin

A small web-based PostgreSQL admin client: browse tables, inspect columns, page through rows, and run raw SQL — all from one page, no ORM.

> [!WARNING]
> **dbadmin has no authentication.** `POST /api/query` executes arbitrary SQL, and the server binds `0.0.0.0`. Anything that can reach the container has full control of the database — read, write, drop.
>
> Publish it only to loopback or an internal-only Docker network, never to a public interface or an ingress. Treat the port as equivalent to handing out your Postgres superuser password.

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

## Using the published image

Released images live at `ghcr.io/holkerveen/dbadmin`, built for `linux/amd64` and `linux/arm64`. The image is the viewer only — no schema, seeder, tests, or `dbadmin.sh` — so point it at a database you already have.

```yaml
# in another project's docker-compose.yml
services:
  dbadmin:
    image: ghcr.io/holkerveen/dbadmin:0.1
    environment:
      POSTGRES_HOST: db
      POSTGRES_PORT: 5432
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: myapp
      DB_ADMIN_PORT: 80
    ports:
      - '127.0.0.1:8080:80'   # loopback only -- see the warning above
```

### Tags

| Tag | Meaning | Pin for |
|---|---|---|
| `0.1.0` | An exact release | Reproducible deploys |
| `0.1` | Newest patch of 0.1 | **Recommended while pre-1.0** |
| `0` | Newest 0.x release | Nothing — see below |
| `latest` | Newest release of any major | Casual/local use |
| `edge` | Newest `main` commit | Nothing — no stability promise |
| `sha-abc1234` | One specific commit | Debugging a regression |

`latest` tracks releases, not `main`, so it will never hand you untested code — but it *will* cross major versions.

> [!CAUTION]
> **While this project is pre-1.0, do not pin the major tag `:0`.** Semver treats `0.x` as initial development, where any minor bump may break compatibility — so `:0` can move from `0.1.x` to `0.2.0` and change behaviour under you. Pin `:0.1` or a `@sha256:` digest instead. Once `1.0.0` ships, `:1` becomes the sensible default and this caveat goes away.

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
- `POST /api/query` — runs SQL from the request body directly against the database. This is an intentionally unsanitized SQL console, not a safe multi-tenant API — don't expose it to untrusted users. Takes `{ sql, readOnly }`; with `readOnly: true` the statement runs inside a `BEGIN READ ONLY` transaction, so PostgreSQL itself rejects writes. Returns at most 1000 rows (`truncated: true` when it clipped), plus an `fks` map describing which result columns are foreign keys.
- `GET /healthz` — runs `SELECT 1`; used by Docker `HEALTHCHECK`, Compose readiness (`service_healthy`), and `dbadmin.sh`'s test-stack polling.

The pool sets `statement_timeout` (30s, override with `STATEMENT_TIMEOUT_MS`) so a runaway query fails instead of pinning a connection.

The frontend (`src/public/index.html`) is a single static file: vanilla JS/CSS, no framework, no bundler.

### Navigation and URLs

The URL is the state. Everything in the main area is described by `?q=<url-encoded SQL>`, so any view can be bookmarked, shared, or reached with the browser's Back and Forward buttons — no page reloads. Clicking a table in the sidebar goes to `/?q=select%20*%20from%20pets%20limit%20100%20offset%200`; the pager's Prev/Next are ordinary links that differ only in their `offset`.

Foreign keys are click-through. The server resolves each result column's origin from the field metadata PostgreSQL returns with every result set, so `pets.category_id` renders as a link to `?q=select * from categories where id = 6 limit 100 offset 0` — and it keeps working through joins and column aliases. Every navigable element is a real `<a href>`, so middle-click, ctrl-click, and Copy Link Address behave as expected; one delegated click handler intercepts plain left-clicks.

Two rules are worth knowing:

- **SQL that arrives via the URL always executes read-only.** Opening a URL is therefore never destructive, and Back can never re-run a mutation. Writes are still available from the Run button — they execute and report the row count, but they are deliberately not written into the URL or history.
- **Only queries the app generated are ever rewritten.** The pager appears for the `select * from <table> [where …] limit <n> offset <m>` shape and nothing else. SQL you typed runs byte-for-byte, so a trailing semicolon or your own `LIMIT 10` is never silently altered.

> [!NOTE]
> Because queries travel in the URL, they also land in browser history and in the access logs of any reverse proxy in front of the container — a different exposure from the network reachability discussed above. Bear it in mind if you query anything sensitive.

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

Specs cover the app's main surface: the table sidebar and column introspection, paginated row browsing against the seeded counts, the SQL console (a `SELECT`, a mutating `UPDATE` asserting `OK: N row(s) changed`, and an invalid query's error path), and URL-driven navigation (bookmarking, Back/Forward, foreign-key click-through, and the refusal of a write that arrives via the URL).

`tests/e2e/` is deliberately nested under `tests/` so `tests/unit/`, `tests/integration/`, and `tests/feature/` can be added later as clean siblings.

## Development scripts

```sh
./dbadmin.sh lint        # eslint .
./dbadmin.sh typecheck   # tsc -p jsconfig.json (checkJs against JSDoc types)
```

## Releasing

CI (`.github/workflows/ci.yml`) runs lint, typecheck, and the full e2e suite on every push and PR. Nothing reaches the registry unless that passes.

- Push to `main` → publishes `edge` and `sha-<short>`.
- Push a `vX.Y.Z` tag → publishes the semver tags and moves `latest`.

To cut a release, bump `package.json` first — a dedicated CI job fails the run if the tag and `package.json` version disagree. Bump and tag are deliberately two separate steps, so the tag only ever lands on a commit CI has already proven green:

```sh
npm version 1.2.3 --no-git-tag-version   # the flag is required -- see below
git commit -am 'Release 1.2.3'
git push                                 # wait for CI to go green on main
git tag v1.2.3
git push origin v1.2.3
```

> [!IMPORTANT]
> **Always pass `--no-git-tag-version`.** Despite the name, it suppresses the *commit* as well as the tag — which is why the `git commit` above is a separate step. Without the flag, `npm version` creates the bump commit **and** the `v1.2.3` tag in one go, so pushing sends both at once and the tag races ahead of the main build. If that run then fails, you own a published tag pointing at code that never passed, and deleting a published tag is messy: anyone who already fetched it keeps it, and GHCR may hold partial artifacts for it.
>
> Trade-off worth knowing: plain `npm version` cannot produce a tag/`package.json` mismatch, since it writes both atomically. The two-step flow can — that is precisely what the `assert-version` CI job is there to catch.

Each platform builds natively (`ubuntu-latest` and `ubuntu-24.04-arm`) rather than under QEMU, and the two are merged into one manifest list. The arm64 runners are free only while this repository is public.

## License

[Apache-2.0](LICENSE). Use it, modify it, ship it commercially — just keep the copyright notice, and if you redistribute modified files, say that you changed them.

## Troubleshooting

- **Port already in use**: the dev stack uses 55432/8080, `test:dev` uses 55433/8081, `test:prod` uses 55434/8082. Adjust `.env` (dev stack) or the relevant `docker-compose.test-*.yml` (test stacks) if any collide with something else on your machine.
- **Stale/broken dev database**: `./dbadmin.sh reset` re-applies the schema and reseeds. `./dbadmin.sh down --volumes` additionally deletes the dev stack's postgres data volume entirely.
