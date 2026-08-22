import { test, expect } from '@playwright/test'
import { selectTable, activeTable } from '../helpers/api.js'

const EXPECTED_TABLES = ['categories', 'orders', 'pet_tags', 'pets', 'tags', 'users']

test('sidebar lists all pet-store tables', async ({ page }) => {
  await page.goto('/')
  const items = page.locator('#tableList li')
  await expect(items).toHaveCount(EXPECTED_TABLES.length)
  const names = (await items.allTextContents()).sort()
  expect(names).toEqual(EXPECTED_TABLES)
})

test('selecting pets shows its columns as headers', async ({ page }) => {
  await page.goto('/')
  await selectTable(page, 'pets')

  const headers = page.locator('#result th')
  await expect(headers).toContainText([
    'id',
    'name',
    'category_id',
    'status',
    'photo_urls',
    'price',
    'created_at',
  ])
})

test('selecting a table highlights it as active', async ({ page }) => {
  await page.goto('/')
  await selectTable(page, 'orders')
  await expect(activeTable(page)).toHaveText('orders')
})
