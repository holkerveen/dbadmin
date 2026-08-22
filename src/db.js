import pg from 'pg'

const { Pool } = pg

export const pool = new Pool({
  host: process.env.POSTGRES_HOST ?? 'db',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  user: process.env.POSTGRES_USER ?? 'postgres',
  database: process.env.POSTGRES_DB ?? 'postgres',
  password: process.env.POSTGRES_PASSWORD,
  // A runaway query would otherwise buffer its whole result into the heap and
  // hold one of the pool's 10 connections until it finished.
  statement_timeout: Number(process.env.STATEMENT_TIMEOUT_MS ?? 30_000),
})
