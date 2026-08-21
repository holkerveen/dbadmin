Status: Phase 2 — roast complete, questions open

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

Each survived verification against the actual code. Findings that didn't are dropped.

**Q1 — Does a URL execute non-SELECT SQL? (security model; verified)**
Today, opening any URL runs zero user SQL: `src/public/index.html:146` only calls `loadTables()`. Cross-origin JS cannot reach `POST /api/query` — there is no CORS middleware in `src/index.js` (verified: no `cors`/`helmet` import), so a cross-origin `fetch` with `Content-Type: application/json` is preflighted and the server never answers the preflight. The loopback-binding advice in `README.md` genuinely holds today.
After this design, step 5 makes initial load execute `location.search`'s `q`. A hidden `<iframe src="http://localhost:8080/?q=drop table pets cascade">` on any page the operator visits then executes DDL same-origin, no click. Verified amplifier: `pool.query(sql)` with no values uses the simple query protocol, which permits multiple statements — `node_modules/pg/lib/query.js:65-69` collects them into an array — so one URL carries `?q=drop table pets; drop table users`.
Same root cause, second symptom: `popstate` re-executes. Run an `INSERT`, click a table, press Back → the INSERT runs again. F5, tab-restore, and omnibox prerender do the same.
Options: (a) URL-driven execution restricted to statements the *server* classifies as read-only, non-SELECT only ever via the Run button and never pushed to the URL; (b) execute anything from the URL but require a confirm click for non-SELECT; (c) accept it as consistent with the existing "this is an open SQL console" posture.

**Q2 — Where does the pager's `of N` total come from?**
`POST /api/query` returns `{rows}` only (`src/index.js:75`). The `1-100 of 400` readout comes from `/api/tables/:name/rows`'s separate `COUNT(*)` (`src/index.js:64-65`), which the unified path removes. `tests/e2e/specs/rows.spec.js` asserts those literal strings.
Without a total, "is there a next page?" is unknowable: on `pets` (`PET_COUNT = 400`) page 4 returns exactly 100 rows, so a naive `rows.length === limit` test renders Next, and clicking it shows `(no rows)` — a phantom page on every table whose count is a multiple of the limit.
Options: (a) server wraps the SELECT as `SELECT COUNT(*) FROM (<sql>) _p` and returns `total`; (b) drop the total, pager becomes `Prev if offset>0` / `Next if rows.length === limit`, accepting the phantom page or fetching `limit+1` rows to detect it; (c) keep `/api/tables/:name/rows` for the plain-table case.

**Q3 — How is a column identified as a foreign key? (regex vs. server-side provenance)**
The design derives the table via a FROM-clause regex and looks up a client-side `{table:{column:...}}` map. Verified failure: `select o.user_id as pet_id, o.id from orders o` matches `orders`, whose FK map has `orders.pet_id → pets.id`, so a column *named* `pet_id` holding user ids renders a link to a wrong-but-plausible pet. `select * from public.pets` captures `public` and yields no links at all. A CTE captures the CTE's inner table.
Verified alternative: node-postgres exposes `result.fields[i].tableID` (pg_class OID) and `.columnID` (attnum) for every result column — `node_modules/pg-protocol/dist/parser.js:211-217`. The server can resolve exactly which physical column each cell came from, aliases and joins included, and return `fks` alongside `rows`. That deletes `GET /api/foreign-keys`, the startup fetch, the client map, the `table` argument to `renderRows`, and `tableOfQuery`'s only non-cosmetic consumer.
Consequence either way: the doc's claim that a `tableOfQuery` miss is "cosmetic" is false under the regex design, since the same value keys FK rendering.

**Q4 — How are FK cell values escaped into the generated SQL?**
The design concatenates cell text into `where <col> = <value>`. `pets.category_id` is nullable (`db/schema.sql:35`); a NULL yields `where id = null` → zero rows, indistinguishable from a deleted row. A text FK value `O'Brien` yields an unterminated literal. A stored value `x'; drop table users; --` yields two statements that the simple query protocol will happily run — meaning anyone who can *insert a row* into the host application's database can attack the admin who browses it, which is a strictly lower bar than needing network access to port 8080.

**Q5 — Does the pager rewrite the user's SQL, and what does it do to SQL it doesn't understand?**
Verified corruptions of "strip trailing `LIMIT n [OFFSET n]`, append new": `select * from pets;` → `select * from pets; LIMIT 100 OFFSET 0` (syntax error — a trailing semicolon is a universal psql habit); `select ... limit 10` → Next silently serves rows 101-200 of a query the user capped at 10; `select * from pets -- todo` → the appended clause lands inside the line comment; `UPDATE users SET ...` → `UPDATE ... LIMIT 100` is not valid Postgres; `... where id in (select id from categories limit 3)` → a loose regex rewrites the *inner* limit and silently changes the result set.
Separately: generated queries carry no `ORDER BY`, and Postgres guarantees no row order across statements, so paging can skip and duplicate rows after any concurrent write. (This is already true of `/api/tables/:name/rows` today; the design promotes it to a bookmarkable artifact.)
Options: (a) keep LIMIT in the SQL as the brief asks and accept these; (b) add `ORDER BY` to generated queries and only render the pager when the query is a bare generated `select * from <t>`; (c) move pagination to a separate URL param and wrap server-side.

**Q6 — `data-query` attribute, or a real `<a href="/?q=...">`?**
The handler cost is identical — `closest('a[href^="/?q="]')` plus modifier-key guards. With a real href the operator gets middle-click-to-new-tab, ctrl/cmd-click, hover URL preview, right-click → Copy Link Address, and native keyboard focus. With `data-query` on an `<a>` with no `href`, middle-click fires `auxclick` (not `click`), so nothing happens at all, `getByRole('link')` matches nothing, and Tab can't reach FK cells. The "degrades without JS" argument is void either way — `src/index.js:8-9` serves one static file and never renders `?q=` server-side.
Also unguarded in the current design: the handler calls `preventDefault()` with no `e.button`/`ctrlKey`/`metaKey`/`shiftKey` check, so ctrl-click hijacks the current tab, and finishing a drag-select over a sidebar item navigates away.

**Q7 — What bounds the result size?**
`src/index.js:58` caps `limit` at 1000 and is today the only path a sidebar click takes. The brief's URL shape `?q=select * from tablename` has no LIMIT. Pointed at a 10M-row table, `pool.query` buffers every row into the Node heap (no cursor, no stream) and `res.json` serializes the lot → OOM; if the server survives, `renderRows` builds tens of millions of DOM nodes. `src/db.js:5-11` sets no `statement_timeout` and `Pool` defaults to `max: 10`, so a handful of such clicks exhausts the pool and `/healthz`'s `SELECT 1` blocks.

**Q8 — The placeholder only renders while the textarea is empty.**
The brief asks for the current query to show as the `#sql` placeholder. A placeholder is invisible once the field has content. Type `select 1`, Run — the textarea now permanently contains `select 1`, so every subsequent navigation updates a placeholder nobody can see, and the requirement silently stops holding. Clearing the textarea on navigate would destroy in-progress typing on every FK click.

**Q9 — Concurrent `render()` calls paint out of order.**
`render` is async with no generation token or `AbortController`. Click `orders` (600 rows) then `categories` (8 rows) within ~50 ms: `categories` paints first, then the `orders` response overwrites `#result` while the URL and sidebar highlight both say `categories`. Same for the cold-load `render('')` racing `loadTables()` and the FK fetch. In CI this makes `expect(page.locator('#result tr')).toHaveCount(101)` flaky, and `playwright.config.js` sets no `retries`, so one flake fails the pipeline.

**Q10 — Minor, but decide now rather than during implementation.**
(a) The `table_constraints ⋈ key_column_usage ⋈ constraint_column_usage` join is the classic broken FK query: for a 2-column FK it produces a cartesian product and maps column A to referenced column B. `pg_constraint` with `conkey`/`confkey` ordinality is correct. `pet_tags` (`db/schema.sql:42-46`) has a composite PK today.
(b) `information_schema` filters to objects the current role has privileges on, so under a non-owner read-only login FK links silently never appear.
(c) `navigate` pushes unconditionally, so clicking `pets` twice makes Back a visible no-op.
(d) Empty/whitespace `q`: `pool.query('   ')` returns EmptyQueryResponse, so `result.command !== 'SELECT'` and the UI prints `OK: null row(s) changed` (`src/index.js:75-78`, `src/public/index.html:134`). The current `if (!sql) return` guard (`src/public/index.html:117`) has no equivalent in the new flow.
(e) SQL in the URL leaks into reverse-proxy access logs, browser history, and browser account sync — a different exposure from the network-reachability one the README covers. Node caps the request line + headers at 16 KB by default, so a ~24 KB query works in-page via `pushState` but returns 431 on reload.
(f) `GET /api/tables/:name/rows` becomes dead code, still documented in `README.md` as the row browser.

## Decisions

## Risks

- Existing specs and `helpers/api.js` are coupled to the `/api/tables/:name/rows` endpoint and to pager button `onclick`s. Part 5 is not optional cleanup; the suite goes red without it.
- `POST /api/query` executes arbitrary SQL. Generating SQL by string-concatenating cell values into `where id = <value>` is injection-by-construction — benign here only because the console is already an unrestricted SQL endpoint, but non-integer/NULL/text FK values need quoting or the query is malformed.
- The inline frontend script is neither linted nor typechecked (`jsconfig.json` includes only `src/**/*.js`), so frontend regressions are caught only by e2e.
