Status: Complete — implemented, e2e green on dev and prod stacks

## Brief

Queries in URL history

I want to change the workings of dbadmin. Now, when I click a table from the sidebar to open, I get in the main area a query input area with Run button, and below that the table. The query input has a 'SELECT * ...' placeholder.

Now, let's allow for navigation using the browser buttons, bookmarking specific queries, showing current query as a placeholder

- left side menu, if I click a table, I expect to go to `//?q=select * from tablename` or similar style url.
- In stead of refreshing the entire page, just update the main area. And push the new url to the history. And highlight the selected table, if any
- The current query should be shown as placeholder in the query input
- also change limit, offset for tables when navigating tables with many items. If I click next on a first page I expect that button to have a `?q=select * from tablename limit 100, 100` kind of query path

If there are foreign keys, I want to click through on them. For example, in example data, we have a `pets` table with a colum `category_id`. Now, if `category_id` is a foreign key, which it should be, then I want the table renderer to show the column as a link. So, a pet in caegory id 6 should have a link similar to `//?q=select * from linked_tablename where id = 6`. Properly url encoded of course, all urls.

I think you should be able to setup a delegated event handler triggering on any onclick in the document and if a data-query attribute exist, e.g. data-query="the-relevant-query", do our special navigation.

## Project conventions

- **e2e invocation (verbatim):** `./dbadmin.sh test` (runs `test:dev` then `test:prod`). Each spins an ephemeral compose stack, waits on `/healthz`, runs `node db/apply-schema.js`, `node db/seed.js`, then `PLAYWRIGHT_BASE_URL=http://localhost:<port> npx playwright test -c tests/e2e/playwright.config.js`. The bare `npm run test:e2e` script **fails without `PLAYWRIGHT_BASE_URL`** (`tests/e2e/playwright.config.js:3-8` throws) — never the entrypoint.
- **CI job:** `.github/workflows/ci.yml`, job `test`, step `./dbadmin.sh test`. Triggers: push to `main`, tags `v*.*.*`, PRs to `main`.
- **Specs live in** `tests/e2e/specs/*.spec.js`. `playwright.config.js` sets `testDir: './specs'` with no `testMatch` override → default glob `**/*.@(spec|test).?(c|m)[jt]s?(x)` picks up new files in that dir automatically. No workflow edit needed for new specs.
- **Helper layer is mandatory:** `tests/e2e/helpers/api.js` wraps stable element ids. Specs go through it; do not inline new selectors in specs.
- **Fixture constants:** `db/seed-constants.js`, imported by both `db/seed.js` and specs.
- **Lint:** `npm run lint` (`eslint .`). **Typecheck:** `npm run typecheck` (`tsc -p jsconfig.json`, `include: ["src/**/*.js"]` — so the inline script in `src/public/index.html` is neither linted nor typechecked today).
- Frontend is a single static file, vanilla JS, no bundler, no framework (`src/public/index.html`).

## Context

- `src/public/index.html:47-49` — module-level mutable state `currentTable`, `offset`, `const LIMIT = 100`. This is the state that must move into the URL.
- `src/public/index.html:51-61` `loadTables()` — builds `#tableList li` with a direct `li.onclick = () => openTable(name)`.
- `src/public/index.html:63-88` `renderRows(rows)` — builds `#result` from `Object.keys(rows[0])`; every cell is `td.textContent = row[c]`. This is where FK links must be injected.
- `src/public/index.html:90-124` `openTable(name, newOffset)` — fetches `GET /api/tables/:name/rows?limit&offset`, renders, and builds `#pager` with Prev/Next buttons wired to `.onclick` closures over `offset`. Note it uses the **REST rows endpoint**, not `/api/query`, and gets `total` from it.
- `src/public/index.html:126-149` `runQuery()` — reads `#sql`, POSTs `/api/query`, renders `res.rows`, or shows `OK: N row(s) changed`. Clears `#pager`.
- `src/index.js:55-68` — `GET /api/tables/:name/rows`, `assertKnownTable` allow-lists the name against `information_schema.tables`, caps limit at 1000, returns `{rows, total}`.
- `src/index.js:70-82` — `POST /api/query`, arbitrary SQL, returns `{rows}` for `SELECT` else `{changes}`.
- `db/schema.sql:33-40` — `pets.category_id INTEGER REFERENCES categories(id)`; also `pet_tags.pet_id/tag_id`, `orders.pet_id/user_id`. Real FKs exist; nothing exposes them over the API today.
- Existing specs depend on current behaviour: `tests/e2e/specs/rows.spec.js` clicks `Next`/`Prev` **buttons** by role and asserts `#pager` text `1-100 of 400`; `tests/e2e/helpers/api.js:selectTable` waits for a response URL containing `/api/tables/<name>/rows`. Both break if navigation moves to `/api/query`.

## Design

**The URL is the source of truth for the main area, and it holds only read-only SQL.** `?q=<url-encoded SQL>` fully determines what is shown. No `q` → empty state.

### Execution model

`POST /api/query` takes `{ sql, readOnly }`. When `readOnly` is true the server runs the statement inside a `BEGIN READ ONLY` transaction on a checked-out client, so **PostgreSQL** rejects writes — no client-side regex guesses at what "read-only" means, and multi-statement payloads like `drop table pets; drop table users` are rejected wholesale. Anything arriving from the URL is executed with `readOnly: true`. Only the Run button sends `readOnly: false`.

Consequently a write is never bookmarkable and never lands in history, which is exactly what makes Back safe. Run-button flow:

1. POST `{sql, readOnly: false}`.
2. If the response has `rows` (it was a SELECT), push the URL and paint.
3. If it has `changes`, paint `OK: N row(s) changed` and **leave the URL untouched** — the address bar keeps showing the last read-only query.

The server also sends `X-Frame-Options: DENY` so the drive-by-iframe path is closed even for read-only SQL.

### Navigation

- **`navigate(query)`** — the one mutator. `pushState({q}, '', '/?q=' + encodeURIComponent(query))`, then `render(query)`. Skips the push when `query === currentQuery()`, so double-clicking a sidebar item doesn't make Back a no-op.
- **`render(query)`** — executes read-only, paints `#result`/`#status`/`#pager`, sets the `#sql` placeholder, clears the `#sql` value, re-derives the sidebar highlight. Never writes history, so `popstate` and `pushState` share one path.
- **Ordering guard** — `render` increments a module-level `renderSeq` and captures it; after `await`, it returns without painting if `renderSeq` has moved on. Fixes the verified race where clicking `orders` then `categories` paints orders' rows under categories' URL.
- **`popstate`** → `render(currentQuery())`, no push.
- **Initial load** → `await` the table list, then `render(currentQuery())`.
- **Empty/whitespace `q`** → empty state: no fetch, empty `#result`, empty `#pager`, no highlight. Never POSTs `'   '` (which would return EmptyQueryResponse and print `OK: null row(s) changed`).

### Links

Every navigable affordance is a real `<a href="/?q=<encoded>">`. One delegated handler:

```js
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="/?q="]')
  if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  navigate(new URL(a.href).searchParams.get('q') ?? '')
})
```

Modifier and non-primary clicks fall through to the browser, so ctrl/cmd-click and middle-click open a new tab, hover shows the target, and right-click → Copy Link Address works. Sidebar items stay `#tableList li` (the `active` class stays on the `li`) with an `<a>` inside; pager Prev/Next become `<a>` styled as buttons.

### Sidebar highlight

Derived from the current query by `tableOfQuery(sql)` — a regex on the FROM clause. **Purely cosmetic now**: FK rendering no longer depends on it (see below), so a miss only means no row is highlighted.

### Pagination

The pager renders **only for queries matching the shape this app generates**: `select * from <table> [where <col> = <literal>] limit <n> offset <m>`, matched by `parseGenerated(sql)`. Hand-typed SQL is executed byte-for-byte and gets no pager — so none of the verified rewrite corruptions (trailing semicolon, a user's own `limit 10`, a trailing `--` comment, `UPDATE ... LIMIT`, an inner subquery LIMIT) can occur, because the only SQL ever rewritten is SQL we built.

Next-page detection uses **limit+1**: the client requests `limit <n+1>` while the URL says `limit <n>`, displays at most `n` rows, and renders Next only if `n+1` came back. No `COUNT(*)`, and no phantom page on tables whose row count is a multiple of the limit. The pager prints `1-100` with no `of N` — the total is deliberately gone.

Prev/Next are ordinary `<a href>` links carrying the same query with a rewritten offset.

### Foreign keys

FK metadata is resolved **server-side, per result set**, from the field provenance node-postgres already returns: `result.fields[i].tableID` (pg_class OID) and `.columnID` (attnum) — verified at `node_modules/pg-protocol/dist/parser.js:211-217`. The server maps those pairs through `pg_constraint` (`contype = 'f'`, single-column `conkey`) to the referenced table/column and returns an `fks` map alongside `rows`. This works through aliases, joins and CTEs, which the FROM-regex could not: `select o.user_id as pet_id from orders o` correctly yields **no** FK link, instead of a wrong one.

`pg_constraint` is used rather than the `table_constraints ⋈ key_column_usage ⋈ constraint_column_usage` join, which produces a cartesian product for composite FKs. Composite FKs are skipped (`array_length(conkey,1) = 1`).

Link SQL is built with type-aware literal quoting, using `dataTypeID` from the same field metadata: numeric types inline bare, everything else is single-quoted with `''` doubling. NULL cells render as plain text, never links. That closes the verified second-order injection where a stored value `x'; drop table users; --` would otherwise become two executable statements.

### Resource bounds

`src/db.js` sets `statement_timeout` (30s) on the pool — a supported pg config key, verified at `node_modules/pg/lib/connection-parameters.js:121`. `/api/query` caps returned rows at `MAX_ROWS = 1000` and sets `truncated: true`; the UI shows a notice. This restores the protection `GET /api/tables/:name/rows` gives today and which the unified path would otherwise drop.

`GET /api/tables/:name/rows` is **deleted** — it has no caller once navigation unifies on `/api/query`. `GET /api/tables/:name/columns` stays.

## Interfaces

Backend — `src/index.js`:

```
POST /api/query   { sql: string, readOnly?: boolean }
  SELECT  -> { rows: object[], fks: Record<colName, {table: string, column: string, quote: boolean}>, truncated: boolean }
  other   -> { changes: number|null }
  error   -> 400 { error: string }
```
`readOnly: true` wraps execution in `BEGIN READ ONLY` / `COMMIT` on a checked-out client. `fks` is keyed by the **output column name** as it appears in `rows`, so the client needs no table context. `quote` says whether a value must be single-quoted into the generated SQL.

Deleted: `GET /api/tables/:name/rows`.

Frontend — inline module in `src/public/index.html`:

```js
function currentQuery()                      // -> string, the q param or ''
function navigate(query)                     // push (unless unchanged) + render
async function render(query)                 // execute + paint; no history writes
function tableOfQuery(sql)                   // -> string|null; cosmetic highlight only
function parseGenerated(sql)                 // -> {table, where, limit, offset}|null
function buildGenerated({table, where, limit, offset})  // -> string
function queryHref(sql)                      // -> '/?q=' + encodeURIComponent(sql)
function sqlLiteral(value, quote)            // -> SQL literal, '' doubled
function renderRows(rows, fks)               // fks keyed by output column name
```

DOM contract (what specs and helpers may rely on):
- ids unchanged: `#sql`, `#run`, `#status`, `#result`, `#pager`, `#tableList`.
- every navigable element is `a[href^="/?q="]`.
- sidebar: `#tableList li` (active one has class `active`) containing an `<a>`.
- pager: `#pager a` with text `Prev` / `Next`.
- FK cell: `#result td a`.

## Work breakdown

Merged down from seven parts — parts 2-4 all owned `src/public/index.html`, so splitting them bought handoffs and no parallelism.

1. **Backend** — `src/index.js`, `src/db.js`. Read-only transaction path, FK provenance via `pg_constraint`, row cap + `truncated`, `statement_timeout`, `X-Frame-Options`, delete `GET /api/tables/:name/rows`. Depends on: nothing.
2. **Frontend** — `src/public/index.html`, whole inline script. URL/history/delegated handler/pager/FK links/placeholder/render guard. Depends on: 1's response shape (fixed by the skeleton).
3. **Tests + docs** — `tests/e2e/helpers/api.js`, `tests/e2e/specs/*.spec.js`, new `tests/e2e/specs/query-url.spec.js`, `README.md`. Depends on: 1, 2.

## E2E acceptance

1. **Bookmark + back/forward.** Clicking `pets` in the sidebar puts `?q=select%20*%20from%20pets...` in the address bar with no page load, shows pet rows, highlights `pets`. Next changes the offset in the URL. Back restores page 1 — URL, rows and highlight. Loading the page-2 URL cold shows the same state.
2. **Foreign-key click-through.** With `pets` open, a `category_id` cell is a link; clicking it navigates to `?q=select * from categories where id = <value> limit 100 offset 0`, the result shows that one category, and `categories` is highlighted.

## Open questions

None — all resolved below.

## Decisions

1. **URL-sourced SQL executes read-only; writes never enter the URL.** → Server wraps URL-sourced execution in `BEGIN READ ONLY`, so Postgres enforces it. Run-button writes execute and report, leaving the address bar on the last read-only query. Closes the drive-by `<iframe src="...?q=drop table pets">` path and the Back-re-runs-my-INSERT path. Consequence: writes are not bookmarkable — accepted deliberately. `X-Frame-Options: DENY` added alongside, since a framed page could otherwise still be clickjacked.
2. **No `COUNT(*)`; next-page detection by fetching limit+1.** → Pager loses `of N` and prints `1-100`. No phantom page. `tests/e2e/specs/rows.spec.js` count assertions must be rewritten to offset ranges.
3. **FK metadata comes from server-side field provenance, not a FROM regex.** → `GET /api/foreign-keys`, the client-side FK map and `renderRows`'s `table` argument are all deleted before being written; `fks` rides on the `/api/query` response keyed by output column name. `tableOfQuery` survives only as the cosmetic sidebar highlight. FK links now work on joins and aliases.
4. **Real `<a href="/?q=...">`, not `data-query`.** → Same delegated handler with modifier-key guards; middle-click, ctrl-click, hover preview and Copy Link Address all work. Departs from the brief's suggested `data-query` mechanism; the delegated-handler idea itself is kept exactly as briefed. DOM contract changes: pager Prev/Next are `#pager a`, not `button`.
5. **The pager renders only for app-generated query shapes.** → Hand-typed SQL is never rewritten and never paged, which is what makes the verified corruptions (trailing `;`, a user's own `limit 10`, trailing `--`, `UPDATE ... LIMIT`, inner-subquery LIMIT) unreachable rather than defended against.
6. **FK values are literal-quoted by type; NULL cells are not links.** → `sqlLiteral(value, quote)` doubles embedded `'`. Closes the stored-value injection (`x'; drop table users; --`) and stops `where id = null` masquerading as a deleted row.
7. **Navigation clears the `#sql` textarea** so the current-query placeholder stays visible on every navigation, not just the first. Consequence: an unrun draft in the textarea is lost when you click an FK link. Accepted.
8. **`statement_timeout` = 30s on the pool, and `/api/query` caps at 1000 rows with `truncated: true`.** → Restores the bound that deleting `GET /api/tables/:name/rows` would otherwise remove. A runaway `select * from events` fails with a Postgres timeout instead of OOM-killing the container.
9. **`GET /api/tables/:name/rows` is deleted**, README Architecture updated. `GET /api/tables/:name/columns` stays even though the frontend doesn't call it.
10. **Housekeeping settled without a round trip:** `navigate` skips the push when the query is unchanged; empty/whitespace `q` renders empty state without POSTing; `render` uses a sequence token so a slow response can't paint over a newer one.

## Risks

- **Generated queries carry no `ORDER BY`** (the offered variant was declined). Postgres guarantees no row order across statements, so paging can skip or duplicate a row after a concurrent write. This is already true of today's `/api/tables/:name/rows` browsing; the change makes those pages bookmarkable, which makes the inconsistency more visible.
- **SQL now travels in the request line**, so it lands in reverse-proxy access logs, browser history, and browser account sync — a different exposure from the network-reachability one the README covers. Worth a README note. Node caps the request line + headers at 16 KB, so a ~24 KB query works in-page via `pushState` but returns 431 on reload.
- **Bookmarks don't survive a rollback**: reverting to `:0.1.0` makes every saved `?q=` URL open a blank main area, since that version ignores `location.search`. This is a `0.2.0`, and the release note should lead with the URL-execution change.
- **`pg_constraint` is read per SELECT.** Cheap (an OID-pair lookup, not the `information_schema` join), but it is an extra round trip on every navigation. Unlike `information_schema`, `pg_constraint` is not privilege-filtered, so FK links won't silently vanish under a non-owner read-only login.
- **`MAX_ROWS` clips the response, not the fetch.** `pool.query` has already buffered the full result into the Node heap by the time we slice, so the cap bounds response size and DOM size but not peak memory. `statement_timeout` is what actually stands between a runaway query and an OOM; a cursor-based fetch would be the real fix.
- **The inline frontend script is neither linted nor typechecked** (`jsconfig.json` covers only `src/**/*.js`), so frontend regressions are caught only by e2e.
- **Existing specs and `tests/e2e/helpers/api.js` break by design.** `selectTable` waits on `/api/tables/:name/rows`, which will no longer exist — the failure mode is a 30s hang, not a fast failure. Part 3 is a gate, not cleanup.
