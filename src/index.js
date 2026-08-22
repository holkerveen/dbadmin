import path from 'node:path'
import express from 'express'
import { pool } from './db.js'

const app = express()
app.use(express.json())

// The URL carries executable SQL, so a framed page must not be clickjackable.
app.use((_req, res, next) => {
  res.set('X-Frame-Options', 'DENY')
  next()
})

const publicDir = path.resolve(import.meta.dirname, 'public')
app.use(express.static(publicDir))

/** @param {string} name */
async function assertKnownTable(name) {
  const result = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1",
    [name],
  )
  if (result.rowCount === 0) {
    throw new Error(`Unknown table: ${name}`)
  }
}

app.get('/healthz', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ status: 'ok' })
  } catch (err) {
    res.status(503).json({ status: 'error', error: /** @type {Error} */ (err).message })
  }
})

app.get('/api/tables', async (_req, res) => {
  try {
    const result = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    )
    res.json(result.rows.map((row) => row.table_name))
  } catch (err) {
    res.status(400).json({ error: /** @type {Error} */ (err).message })
  }
})

app.get('/api/tables/:name/columns', async (req, res) => {
  try {
    await assertKnownTable(req.params.name)
    const result = await pool.query(
      'SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position',
      ['public', req.params.name],
    )
    res.json(result.rows)
  } catch (err) {
    res.status(400).json({ error: /** @type {Error} */ (err).message })
  }
})

/** Rows beyond this are dropped rather than buffered into a response. */
const MAX_ROWS = 1000

/** Postgres OIDs whose values need no quoting when inlined into generated SQL. */
const NUMERIC_OIDS = new Set([20, 21, 23, 26, 700, 701, 1700])

/**
 * Resolve which result columns are single-column foreign keys, using the
 * per-column provenance node-postgres returns (`tableID` = pg_class OID,
 * `columnID` = attnum). Keyed by output column name as it appears in `rows`.
 *
 * @param {import('pg').PoolClient} client
 * @param {import('pg').FieldDef[]} fields
 * @returns {Promise<Record<string, {table: string, column: string, quote: boolean}>>}
 */
async function foreignKeysForFields(client, fields) {
  const usable = fields.filter((f) => f.tableID !== 0 && f.columnID !== 0)
  if (usable.length === 0) return {}

  // Dedupe by (tableID, columnID): several output columns can share one
  // physical column (aliases, self-joins), and we only want to ask once.
  const tableIDs = /** @type {number[]} */ ([])
  const columnIDs = /** @type {number[]} */ ([])
  const seen = new Set()
  for (const f of usable) {
    const key = `${f.tableID}.${f.columnID}`
    if (seen.has(key)) continue
    seen.add(key)
    tableIDs.push(f.tableID)
    columnIDs.push(f.columnID)
  }

  let rows
  try {
    // pg_constraint, not information_schema: the latter joins
    // table_constraints, key_column_usage and constraint_column_usage,
    // which cartesian-products composite foreign keys (mismatching
    // referencing/referenced column pairs) and is privilege-filtered, so
    // links would silently disappear under a read-only, non-owner login.
    const result = await client.query(
      `SELECT
         c.conrelid AS table_id,
         c.conkey[1] AS column_id,
         rc.relname AS ref_table,
         ra.attname AS ref_column
       FROM pg_catalog.pg_constraint c
       JOIN unnest($1::oid[], $2::int[]) AS want(table_id, column_id)
         ON c.conrelid = want.table_id AND c.conkey[1] = want.column_id
       JOIN pg_catalog.pg_class rc ON rc.oid = c.confrelid
       JOIN pg_catalog.pg_attribute ra
         ON ra.attrelid = c.confrelid AND ra.attnum = c.confkey[1]
       WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1`,
      [tableIDs, columnIDs],
    )
    rows = result.rows
  } catch {
    // A failed catalog lookup must not sink the query result it's decorating.
    return {}
  }

  const byPair = new Map()
  for (const row of rows) {
    byPair.set(`${row.table_id}.${row.column_id}`, {
      table: row.ref_table,
      column: row.ref_column,
    })
  }

  /** @type {Record<string, {table: string, column: string, quote: boolean}>} */
  const fks = {}
  for (const f of usable) {
    const ref = byPair.get(`${f.tableID}.${f.columnID}`)
    if (!ref) continue
    fks[f.name] = { ...ref, quote: !NUMERIC_OIDS.has(f.dataTypeID) }
  }
  return fks
}

app.post('/api/query', async (req, res) => {
  const { sql, readOnly } = req.body ?? {}
  if (typeof sql !== 'string' || sql.trim() === '') {
    res.status(400).json({ error: 'sql is required' })
    return
  }

  const client = await pool.connect()
  try {
    // READ ONLY is enforced by Postgres, not by parsing the statement here:
    // anything reachable from the URL runs under it, including multi-statement
    // payloads, which the simple query protocol would otherwise happily run.
    if (readOnly) await client.query('BEGIN READ ONLY')
    const raw = await client.query(sql)
    if (readOnly) await client.query('COMMIT')

    // A multi-statement simple query yields one Result per statement.
    const result = Array.isArray(raw) ? raw[raw.length - 1] : raw

    if (result.command === 'SELECT') {
      const truncated = result.rows.length > MAX_ROWS
      const fks = await foreignKeysForFields(client, result.fields)
      res.json({ rows: result.rows.slice(0, MAX_ROWS), fks, truncated })
    } else {
      res.json({ changes: result.rowCount })
    }
  } catch (err) {
    if (readOnly) await client.query('ROLLBACK').catch(() => {})
    res.status(400).json({ error: /** @type {Error} */ (err).message })
  } finally {
    client.release()
  }
})

const port = Number(process.env.DB_ADMIN_PORT ?? 80)
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`DB admin listening on http://0.0.0.0:${port}`)
})

/** @param {NodeJS.Signals} signal */
async function shutdown(signal) {
  console.log(`${signal} received, shutting down`)
  server.close()
  await pool.end()
}

for (const signal of /** @type {const} */ (['SIGTERM', 'SIGINT'])) {
  process.once(signal, () => {
    shutdown(signal).catch((err) => {
      console.error(err)
      process.exit(1)
    })
  })
}
