#!/usr/bin/env node
// Deterministic pet-store seeder. Connects using the same POSTGRES_* env
// vars as src/db.js. Run via `dbadmin.sh seed` (or `npm run db:seed`).

import pg from 'pg'
import { faker } from '@faker-js/faker'
import {
  CATEGORY_COUNT,
  TAG_COUNT,
  USER_COUNT,
  PET_COUNT,
  ORDER_COUNT,
  FIXTURE_USERNAME,
  SEED_RANDOM_SEED,
} from './seed-constants.js'

const { Pool } = pg

const pool = new Pool({
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  user: process.env.POSTGRES_USER ?? 'postgres',
  database: process.env.POSTGRES_DB ?? 'postgres',
  password: process.env.POSTGRES_PASSWORD,
})

const BATCH_SIZE = 500

/**
 * Bulk-insert rows in chunks of BATCH_SIZE using multi-row VALUES lists,
 * returning the generated ids in insertion order.
 * @param {pg.Pool} client
 * @param {string} table
 * @param {string[]} columns
 * @param {unknown[][]} rows
 * @param {{returningId?: boolean}} [options]
 * @returns {Promise<number[]>}
 */
async function bulkInsert(client, table, columns, rows, options = {}) {
  const returningId = options.returningId ?? true
  /** @type {number[]} */
  const ids = []
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE)
    const values = []
    const placeholders = batch.map((row, rowIdx) => {
      const base = rowIdx * columns.length
      const cells = row.map((_, colIdx) => `$${base + colIdx + 1}`)
      values.push(...row)
      return `(${cells.join(', ')})`
    })
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders.join(', ')}${returningId ? ' RETURNING id' : ''}`
    const result = await client.query(sql, values)
    if (returningId) {
      ids.push(...result.rows.map((r) => r.id))
    }
  }
  return ids
}

const PET_SPECIES = ['Dog', 'Cat', 'Bird', 'Fish', 'Rabbit', 'Hamster', 'Reptile', 'Horse']
const PET_STATUSES = ['available', 'available', 'available', 'pending', 'sold']
const ORDER_STATUSES = ['placed', 'approved', 'delivered']

function uniqueWords(count, generator) {
  const set = new Set()
  while (set.size < count) {
    set.add(generator())
  }
  return [...set]
}

async function seed() {
  faker.seed(SEED_RANDOM_SEED)

  console.log('Seeding categories...')
  const categoryIds = await bulkInsert(
    pool,
    'categories',
    ['name'],
    PET_SPECIES.slice(0, CATEGORY_COUNT).map((name) => [name]),
  )

  console.log('Seeding tags...')
  const tagNames = uniqueWords(TAG_COUNT, () => faker.word.adjective())
  const tagIds = await bulkInsert(
    pool,
    'tags',
    ['name'],
    tagNames.map((name) => [name]),
  )

  console.log('Seeding users...')
  const userRows = [
    [
      FIXTURE_USERNAME,
      'e2e-fixture-user@example.com',
      'Fixture',
      'User',
      faker.phone.number(),
      1,
    ],
  ]
  const usedUsernames = new Set([FIXTURE_USERNAME])
  while (userRows.length < USER_COUNT) {
    const firstName = faker.person.firstName()
    const lastName = faker.person.lastName()
    const username = faker.internet
      .username({ firstName, lastName })
      .toLowerCase()
    if (usedUsernames.has(username)) continue
    usedUsernames.add(username)
    userRows.push([
      username,
      faker.internet.email({ firstName, lastName }).toLowerCase(),
      firstName,
      lastName,
      faker.phone.number(),
      faker.number.int({ min: 0, max: 2 }),
    ])
  }
  const userIds = await bulkInsert(
    pool,
    'users',
    ['username', 'email', 'first_name', 'last_name', 'phone', 'user_status'],
    userRows,
  )
  const fixtureUserId = userIds[0]

  console.log('Seeding pets...')
  const petRows = Array.from({ length: PET_COUNT }, () => {
    const categoryId = faker.helpers.arrayElement(categoryIds)
    const status = faker.helpers.arrayElement(PET_STATUSES)
    const photoUrls = Array.from(
      { length: faker.number.int({ min: 1, max: 3 }) },
      () => faker.image.urlPicsumPhotos(),
    )
    return [
      faker.person.firstName(),
      categoryId,
      status,
      photoUrls,
      faker.commerce.price({ min: 10, max: 2500 }),
    ]
  })
  const petIds = await bulkInsert(
    pool,
    'pets',
    ['name', 'category_id', 'status', 'photo_urls', 'price'],
    petRows,
  )

  console.log('Seeding pet_tags...')
  const petTagRows = []
  for (const petId of petIds) {
    const tagCount = faker.number.int({ min: 1, max: 4 })
    const chosenTags = faker.helpers.arrayElements(tagIds, tagCount)
    for (const tagId of chosenTags) {
      petTagRows.push([petId, tagId])
    }
  }
  await bulkInsert(pool, 'pet_tags', ['pet_id', 'tag_id'], petTagRows, { returningId: false })

  console.log('Seeding orders...')
  const orderRows = Array.from({ length: ORDER_COUNT }, (_, i) => {
    const status = faker.helpers.arrayElement(ORDER_STATUSES)
    const userId = i === 0 ? fixtureUserId : faker.helpers.arrayElement(userIds)
    return [
      faker.helpers.arrayElement(petIds),
      userId,
      faker.number.int({ min: 1, max: 5 }),
      faker.date.soon({ days: 30 }),
      status,
      status === 'delivered',
    ]
  })
  await bulkInsert(
    pool,
    'orders',
    ['pet_id', 'user_id', 'quantity', 'ship_date', 'status', 'complete'],
    orderRows,
  )

  console.log(
    `Seeded ${categoryIds.length} categories, ${tagIds.length} tags, ${userIds.length} users, ${petIds.length} pets, ${petTagRows.length} pet_tags, ${orderRows.length} orders.`,
  )
}

seed()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
