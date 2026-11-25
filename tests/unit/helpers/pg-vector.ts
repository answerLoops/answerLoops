import type postgres from 'postgres'

/**
 * Creates the pgvector extension for a Postgres-backed test file. CI runs those
 * files in parallel against one fresh database, and CREATE EXTENSION IF NOT
 * EXISTS is not safe to run concurrently: the second session can fail on the
 * catalog's unique index while the first is still creating it. That error
 * means the extension now exists, so it is treated as success once confirmed.
 */
export async function ensureVectorExtension(sql: postgres.Sql): Promise<void> {
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector`
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code !== '23505' && code !== '42710') throw err
    const [row] = await sql`SELECT 1 AS ok FROM pg_extension WHERE extname = 'vector'`
    if (!row) throw err
  }
}
