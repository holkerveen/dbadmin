import { test, expect } from '@playwright/test'
import { selectTable, clickPager, pager, generatedQuery, PAGE_LIMIT } from '../helpers/api.js'
import { PET_COUNT, USER_COUNT } from '../../../db/seed-constants.js'

test('pets table paginates through the full seeded set', async ({ page }) => {
  await page.goto('/')
  await selectTable(page, 'pets')

  await expect(pager(page)).toContainText(`1-${PAGE_LIMIT}`)
  await expect(page.locator('#result tr')).toHaveCount(PAGE_LIMIT + 1) // rows + header

  await clickPager(page, 'Next', generatedQuery('pets', { offset: PAGE_LIMIT }))
  await expect(pager(page)).toContainText(`${PAGE_LIMIT + 1}-${PAGE_LIMIT * 2}`)
  await expect(pager(page).getByRole('link', { name: 'Prev' })).toBeVisible()

  await clickPager(page, 'Prev', generatedQuery('pets'))
  await expect(pager(page)).toContainText(`1-${PAGE_LIMIT}`)
  await expect(pager(page).getByRole('link', { name: 'Prev' })).toHaveCount(0)
})

// PET_COUNT is an exact multiple of PAGE_LIMIT, so the last page returns a
// full page of rows. Without limit+1 detection the pager would offer a Next
// leading to an empty phantom page.
test('the last full page offers no Next', async ({ page }) => {
  const lastPage = generatedQuery('pets', { offset: PET_COUNT - PAGE_LIMIT })
  await page.goto(`/?q=${encodeURIComponent(lastPage)}`)

  await expect(pager(page)).toContainText(`${PET_COUNT - PAGE_LIMIT + 1}-${PET_COUNT}`)
  await expect(pager(page).getByRole('link', { name: 'Prev' })).toBeVisible()
  await expect(pager(page).getByRole('link', { name: 'Next' })).toHaveCount(0)
})

test('users table paginates from the first page', async ({ page }) => {
  await page.goto('/')
  await selectTable(page, 'users')
  await expect(pager(page)).toContainText(`1-${PAGE_LIMIT}`)
  expect(USER_COUNT).toBeGreaterThan(PAGE_LIMIT) // otherwise there'd be no Next
  await expect(pager(page).getByRole('link', { name: 'Next' })).toBeVisible()
})

// Hand-typed SQL is executed byte-for-byte and never rewritten, which is what
// keeps a trailing semicolon (or a user's own LIMIT) from being corrupted.
test('a hand-typed query gets no pager', async ({ page }) => {
  await page.goto('/')
  await page.locator('#sql').fill('select * from pets;')
  await page.locator('#run').click()

  await expect(page.locator('#result th').first()).toBeVisible()
  await expect(pager(page)).toBeEmpty()
})
