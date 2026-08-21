// Thin page helpers wrapping the dbadmin UI's stable element ids
// (see src/public/index.html).

/** @param {import('@playwright/test').Page} page */
export async function selectTable(page, name) {
  const responsePromise = page.waitForResponse(
    (res) => res.url().includes(`/api/tables/${name}/rows`) && res.ok(),
  )
  await page.locator('#tableList li', { hasText: name }).click()
  await responsePromise
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
