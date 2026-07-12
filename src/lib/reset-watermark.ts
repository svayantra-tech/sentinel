// ─────────────────────────────────────────────────────────────────────────────
// Reset watermark — makes "Reset Demo" hold across serverless instances.
// /api/reset clears the Turso snapshots and ITS OWN instance's in-memory run
// registry, but other warm instances still hold stale views in memory. The
// watermark (a single row in the same libsql DB) records the last reset time;
// read paths drop any in-memory view that started before it. Cached ~3s so the
// 1.5s dashboard poll doesn't hammer the DB.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient, type Client } from '@libsql/client';

let client: Client | null = null;
function db(): Client {
  if (!client) {
    client = createClient({
      url: process.env.MASTRA_DB_URL || 'file:./sentinel.db',
      authToken: process.env.MASTRA_DB_AUTH_TOKEN || undefined,
    });
  }
  return client;
}

let cached: { at: number; value: string | null } | null = null;

/** ISO time of the last demo reset, or null. Errors read as "no reset". */
export async function getResetWatermark(): Promise<string | null> {
  if (cached && Date.now() - cached.at < 3000) return cached.value;
  try {
    const r = await db().execute("SELECT value FROM sentinel_meta WHERE key = 'last_reset_at'");
    cached = { at: Date.now(), value: (r.rows[0]?.value as string | undefined) ?? null };
  } catch {
    cached = { at: Date.now(), value: null }; // table absent until first reset
  }
  return cached.value;
}

/** Record a reset (called by /api/reset). Returns the watermark written. */
export async function setResetWatermark(): Promise<string> {
  const now = new Date().toISOString();
  const c = db();
  await c.execute('CREATE TABLE IF NOT EXISTS sentinel_meta (key TEXT PRIMARY KEY, value TEXT)');
  await c.execute({
    sql: 'INSERT INTO sentinel_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    args: ['last_reset_at', now],
  });
  cached = { at: Date.now(), value: now };
  return now;
}
