#!/usr/bin/env node
// Applies db/schema.sql against the database configured by POSTGRES_* env
// vars (same convention as src/db.js). Idempotent — safe to re-run.

import fs from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'

const { Pool } = pg

const pool = new Pool({
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  user: process.env.POSTGRES_USER ?? 'postgres',
  database: process.env.POSTGRES_DB ?? 'postgres',
  password: process.env.POSTGRES_PASSWORD,
})

async function applySchema() {
  const schemaPath = path.resolve(import.meta.dirname, 'schema.sql')
  const sql = await fs.readFile(schemaPath, 'utf8')
  await pool.query(sql)
  console.log('Schema applied.')
}

applySchema()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
