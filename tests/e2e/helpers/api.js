// Thin page helpers wrapping the dbadmin UI's stable element ids and its
// URL contract (see src/public/index.html).

/** Must match LIMIT in src/public/index.html. */
export const PAGE_LIMIT = 100

/**
 * Mirror of the frontend's buildGenerated(): the only query shape the app
 * generates, and the only one it will ever rewrite for paging.
 */
export function generatedQuery(table, { where = null, offset = 0, limit = PAGE_LIMIT } = {}) {
  return `select * from ${table}${where ? ' where ' + where : ''} limit ${limit} offset ${offset}`
}

/** @param {string} sql */
export function queryUrl(sql) {
  return '/?q=' + encodeURIComponent(sql)
}

/**
 * The app fetches one row beyond the page to learn whether a next page
 * exists, so the SQL on the wire never equals the SQL in the URL.
 * @param {string} sql
 */
function sentSql(sql) {
  return sql.replace(/ limit (\d+) /, (_m, n) => ` limit ${Number(n) + 1} `)
}

/**
 * Run `action` and wait for the POST /api/query it triggers for `sql`.
 * Matching on the request body rather than just the path keeps this from
 * resolving against an unrelated in-flight query.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} sql the query as it appears in the URL
 * @param {() => Promise<void>} action
 */
export async function waitForQuery(page, sql, action) {
  const expected = sentSql(sql)
  const responsePromise = page.waitForResponse(
    (res) =>
      res.url().endsWith('/api/query') &&
      res.request().method() === 'POST' &&
      JSON.parse(res.request().postData() ?? '{}').sql === expected,
  )
  await action()
  await responsePromise
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 */
export async function selectTable(page, name) {
  const sql = generatedQuery(name)
  await waitForQuery(page, sql, () => page.locator(`#tableList li[data-table="${name}"] a`).click())
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {'Prev' | 'Next'} label
 * @param {string} expectedSql the query the link navigates to
 */
export async function clickPager(page, label, expectedSql) {
  await waitForQuery(page, expectedSql, () =>
    pager(page).getByRole('link', { name: label }).click(),
  )
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} sql
 */
export async function runSql(page, sql) {
  await page.locator('#sql').fill(sql)
  const responsePromise = page.waitForResponse(
    (res) => res.url().endsWith('/api/query') && res.request().method() === 'POST',
  )
  await page.locator('#run').click()
  await responsePromise
}

/** The nth cell of a named column in the result table, 0-indexed by row. */
export async function cell(page, column, rowIndex) {
  const headers = await page.locator('#result th').allTextContents()
  const col = headers.indexOf(column)
  if (col === -1) throw new Error(`no such column: ${column} (have ${headers.join(', ')})`)
  return page.locator('#result tr').nth(rowIndex + 1).locator('td').nth(col)
}

/** @param {import('@playwright/test').Page} page */
export function status(page) {
  return page.locator('#status')
}

/** @param {import('@playwright/test').Page} page */
export function resultTable(page) {
  return page.locator('#result')
}

/** @param {import('@playwright/test').Page} page */
export function pager(page) {
  return page.locator('#pager')
}

/** @param {import('@playwright/test').Page} page */
export function activeTable(page) {
  return page.locator('#tableList li.active')
}
