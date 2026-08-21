import path from 'node:path'
import express from 'express'
import { pool } from './db.js'

const app = express()
app.use(express.json())

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

app.get('/api/tables/:name/rows', async (req, res) => {
  try {
    await assertKnownTable(req.params.name)
    const limit = Math.min(Number(req.query.limit) || 100, 1000)
    const offset = Number(req.query.offset) || 0
    const rows = await pool.query(
      `SELECT * FROM "${req.params.name}" LIMIT $1 OFFSET $2`,
      [limit, offset],
    )
    const total = await pool.query(`SELECT COUNT(*) AS count FROM "${req.params.name}"`)
    res.json({ rows: rows.rows, total: Number(total.rows[0].count) })
  } catch (err) {
    res.status(400).json({ error: /** @type {Error} */ (err).message })
  }
})

app.post('/api/query', async (req, res) => {
  const { sql } = req.body
  try {
    const result = await pool.query(sql)
    if (result.command === 'SELECT') {
      res.json({ rows: result.rows })
    } else {
      res.json({ changes: result.rowCount })
    }
  } catch (err) {
    res.status(400).json({ error: /** @type {Error} */ (err).message })
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
