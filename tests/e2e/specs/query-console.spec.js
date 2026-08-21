import { test, expect } from '@playwright/test'
import { runSql, status, resultTable } from '../helpers/api.js'
import { FIXTURE_USERNAME } from '../../../db/seed-constants.js'

test('running a SELECT renders matching rows', async ({ page }) => {
  await page.goto('/')
  await runSql(page, `SELECT * FROM users WHERE username = '${FIXTURE_USERNAME}'`)

  await expect(resultTable(page).locator('tr')).toHaveCount(2) // header + 1 row
  await expect(resultTable(page)).toContainText(FIXTURE_USERNAME)
})

test('running an UPDATE reports rows changed', async ({ page }) => {
  await page.goto('/')
  await runSql(
    page,
    `UPDATE users SET phone = '555-0100' WHERE username = '${FIXTURE_USERNAME}'`,
  )

  await expect(status(page)).toHaveText('OK: 1 row(s) changed')
})

test('an invalid query surfaces the error message', async ({ page }) => {
  await page.goto('/')
  await runSql(page, 'SELECT * FROM not_a_real_table')

  await expect(status(page)).toContainText('not_a_real_table')
})
