import { test, expect } from '@playwright/test'
import { selectTable, pager } from '../helpers/api.js'
import { PET_COUNT, USER_COUNT } from '../../../db/seed-constants.js'

test('pets table paginates through the full seeded set', async ({ page }) => {
  await page.goto('/')
  await selectTable(page, 'pets')

  await expect(pager(page)).toContainText(`1-100 of ${PET_COUNT}`)
  await expect(page.locator('#result tr')).toHaveCount(101) // 100 rows + header row

  await pager(page).getByRole('button', { name: 'Next' }).click()
  await expect(pager(page)).toContainText(`101-200 of ${PET_COUNT}`)
  await expect(pager(page).getByRole('button', { name: 'Prev' })).toBeVisible()

  await pager(page).getByRole('button', { name: 'Prev' }).click()
  await expect(pager(page)).toContainText(`1-100 of ${PET_COUNT}`)
  await expect(pager(page).getByRole('button', { name: 'Prev' })).toHaveCount(0)
})

test('users table shows the full seeded count', async ({ page }) => {
  await page.goto('/')
  await selectTable(page, 'users')
  await expect(pager(page)).toContainText(`of ${USER_COUNT}`)
})
