Status: Phase 1 — design doc

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

**The URL is the single source of truth for main-area state.** `?q=<url-encoded SQL>` fully determines what the main area shows. No query param → empty state (no table selected, empty result).

Flow:

1. **`navigate(query, {replace})`** — the one mutator. Writes `history.pushState({q}, '', '/?q=' + encodeURIComponent(query))` (or `replaceState`), then calls `render(query)`.
2. **`render(query)`** — executes the query against the backend, paints `#result`, `#status`, `#pager`, sets the `#sql` placeholder to the current query, and re-derives the sidebar highlight. Never touches history. This makes `popstate` and `pushState` paths share one code path.
3. **Delegated click handler** on `document`: `document.addEventListener('click', e => { const el = e.target.closest('[data-query]'); if (!el) return; e.preventDefault(); navigate(el.dataset.query) })`. Every navigable affordance — sidebar `li`, pager buttons, FK cells — is rendered carrying `data-query`, and none of them keeps its own `onclick` closure.
4. **`popstate`** → `render(location.search q)` without pushing.
5. **Initial load** → `render()` from `location.search`, so a bookmarked/deep-linked URL restores exactly.
6. **Run button / Ctrl+Enter** → `navigate(textarea value)` rather than fetching directly, so manually run queries also land in history and become bookmarkable.

**Sidebar highlight** is derived from the current query by a `tableOfQuery(sql)` parse: match `/\bfrom\s+"?([a-z_][a-z0-9_$]*)"?/i` on the query, highlight the matching `li` if one exists, else clear all highlights. Deliberately a heuristic — it only drives a CSS class, so a miss is cosmetic.

**Pagination.** The pager is rebuilt from the current query by rewriting its `LIMIT`/`OFFSET` clause: `withPage(sql, limit, offset)` strips any trailing `LIMIT n [OFFSET n]` and appends the new one. Prev/Next are rendered as `data-query` carriers, so paging is ordinary navigation. Note: the brief's `limit 100, 100` is MySQL syntax; PostgreSQL requires `LIMIT 100 OFFSET 100` — see Open questions.

**Foreign keys.** A new endpoint exposes FK metadata; the frontend loads it once at startup alongside `/api/tables` and keeps a map `{ table: { column: { refTable, refColumn } } }`. `renderRows` needs to know which table the rows came from — it takes the `tableOfQuery` result. For each cell whose `(table, column)` is in the FK map and whose value is non-null, render an `<a>` (or `<span class="fk">`) carrying `data-query="select * from <refTable> where <refColumn> = <value>"` instead of plain text. The delegated handler does the rest.

**Execution path.** Everything goes through `POST /api/query` so one code path serves both typed and generated queries — which means the `total` count that the pager prints today is no longer free. See Open questions.

## Interfaces

Frontend (inline module in `src/public/index.html`):

```js
/** @returns {string} the q param, or '' */
function currentQuery()
/** Push (or replace) history and re-render. */
function navigate(query, opts?: { replace?: boolean }): void
/** Execute + paint from a query string. No history writes. */
async function render(query: string): Promise<void>
/** @returns {string|null} table name heuristically parsed from a FROM clause */
function tableOfQuery(sql)
/** @returns {{limit: number|null, offset: number}} parsed trailing pagination */
function pageOfQuery(sql)
/** @returns {string} sql with its LIMIT/OFFSET replaced */
function withPage(sql, limit, offset)
/** @param rows, @param table used for FK lookup (may be null) */
function renderRows(rows, table)
```

Backend, new endpoint (exact shape TBD in Phase 3):

```
GET /api/foreign-keys
-> [{ table_name, column_name, foreign_table_name, foreign_column_name }, ...]
```
sourced from `information_schema.table_constraints` ⋈ `key_column_usage` ⋈ `constraint_column_usage`, filtered to `constraint_type = 'FOREIGN KEY'` and `table_schema = 'public'`.

DOM contract (what e2e specs and helpers may rely on):
- `#sql`, `#run`, `#status`, `#result`, `#pager`, `#tableList` — unchanged ids.
- Any navigable element carries `data-query="<sql>"`.
- Sidebar item: `#tableList li[data-query]`, active one has class `active`.
- Pager buttons: `#pager button[data-query]` labelled `Prev` / `Next`.
- FK cell link: `#result td a[data-query]`.

## Work breakdown

1. **Backend FK endpoint** — `src/index.js`. Depends on: nothing.
2. **URL/history core** — `navigate`, `render`, `popstate`, delegated click handler, placeholder, initial load. `src/public/index.html`. Depends on: nothing (skeleton fixes the seams).
3. **Sidebar + pagination as data-query** — `tableOfQuery`, `pageOfQuery`, `withPage`, pager rebuild. `src/public/index.html`. Depends on: 2.
4. **FK link rendering** — `renderRows` FK map lookup + link emission. `src/public/index.html`. Depends on: 1, 2.
5. **Update existing specs + helpers** to the new navigation model — `tests/e2e/helpers/api.js`, `tests/e2e/specs/*.spec.js`. Depends on: 2, 3, 4.
6. **New e2e spec** for URL/history/FK acceptance — `tests/e2e/specs/query-url.spec.js`. Depends on: 5.
7. **README** update of the Architecture section. Depends on: 1.

Parts 2, 3, 4 all own `src/public/index.html` → they cannot be parallel. Serialize or merge into one agent.

## E2E acceptance

1. **Bookmark + back/forward.** Clicking `pets` in the sidebar puts `?q=select%20*%20from%20pets...` in the address bar without a full page load, shows pet rows, and highlights `pets`. Clicking `Next` changes the URL's offset. Pressing Back returns to page 1 — URL, rows, and highlight all restored. Loading the deep URL cold in a fresh tab shows the same page-2 state.
2. **Foreign-key click-through.** With `pets` open, a `category_id` cell is a link; clicking it navigates to `?q=select * from categories where id = <that value>` and the result table shows exactly that one category row, with `categories` now highlighted in the sidebar.

## Open questions

(populated in Phase 2)

## Decisions

## Risks

- Existing specs and `helpers/api.js` are coupled to the `/api/tables/:name/rows` endpoint and to pager button `onclick`s. Part 5 is not optional cleanup; the suite goes red without it.
- `POST /api/query` executes arbitrary SQL. Generating SQL by string-concatenating cell values into `where id = <value>` is injection-by-construction — benign here only because the console is already an unrestricted SQL endpoint, but non-integer/NULL/text FK values need quoting or the query is malformed.
- The inline frontend script is neither linted nor typechecked (`jsconfig.json` includes only `src/**/*.js`), so frontend regressions are caught only by e2e.
