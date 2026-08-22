import { test, expect } from '@playwright/test'
import {
  selectTable,
  clickPager,
  waitForQuery,
  cell,
  pager,
  activeTable,
  resultTable,
  generatedQuery,
  queryUrl,
  PAGE_LIMIT,
} from '../helpers/api.js'

test('table navigation is bookmarkable and survives Back and Forward', async ({ page }) => {
  await page.goto('/')
  await expect(pager(page)).toBeEmpty() // no q param -> empty state

  await selectTable(page, 'pets')
  await expect(page).toHaveURL(queryUrl(generatedQuery('pets')))
  await expect(activeTable(page)).toHaveText('pets')
  await expect(page.locator('#sql')).toHaveAttribute('placeholder', generatedQuery('pets'))

  const secondPage = generatedQuery('pets', { offset: PAGE_LIMIT })
  await clickPager(page, 'Next', secondPage)
  await expect(page).toHaveURL(queryUrl(secondPage))
  await expect(pager(page)).toContainText(`${PAGE_LIMIT + 1}-${PAGE_LIMIT * 2}`)

  await waitForQuery(page, generatedQuery('pets'), () => page.goBack())
  await expect(page).toHaveURL(queryUrl(generatedQuery('pets')))
  await expect(pager(page)).toContainText(`1-${PAGE_LIMIT}`)
  await expect(activeTable(page)).toHaveText('pets')

  await waitForQuery(page, secondPage, () => page.goForward())
  await expect(pager(page)).toContainText(`${PAGE_LIMIT + 1}-${PAGE_LIMIT * 2}`)

  // The deep link restores the same state cold, in a page that never saw a click.
  await page.goto(queryUrl(secondPage))
  await expect(pager(page)).toContainText(`${PAGE_LIMIT + 1}-${PAGE_LIMIT * 2}`)
  await expect(activeTable(page)).toHaveText('pets')
})

test('a foreign key cell links through to the referenced row', async ({ page }) => {
  await page.goto(queryUrl(generatedQuery('pets')))
  await expect(page.locator('#result th').first()).toBeVisible()

  const categoryCell = await cell(page, 'category_id', 0)
  const link = categoryCell.locator('a')
  await expect(link).toBeVisible()
  const categoryId = await link.textContent()

  const target = generatedQuery('categories', { where: `id = ${categoryId}` })
  await expect(link).toHaveAttribute('href', queryUrl(target))

  await waitForQuery(page, target, () => link.click())
  await expect(page).toHaveURL(queryUrl(target))
  await expect(activeTable(page)).toHaveText('categories')
  await expect(resultTable(page).locator('tr')).toHaveCount(2) // header + the one row
  await expect(await cell(page, 'id', 0)).toHaveText(categoryId ?? '')
})

// The URL is executed read-only, so a link cannot be a write no matter who
// crafted it -- and Back can never re-run a mutation.
test('a write in the URL is refused', async ({ page }) => {
  await page.goto(queryUrl("update users set phone = '555-0199'"))
  await expect(page.locator('#status')).toContainText('read-only transaction')
})
