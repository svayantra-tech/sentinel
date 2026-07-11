// ─────────────────────────────────────────────────────────────────────────────
// Embeddings (supports FR-04) — provider chain:
//   1. Any OpenAI-compatible embeddings endpoint (EMBEDDINGS_URL) — production.
//   2. Deterministic local hash-ngram embedder — zero-dependency fallback that
//      keeps retrieval meaningful on a 50-doc corpus and makes `npm run dev`
//      work offline. Swap-in-place per 12-Factor backing services (NFR-06).
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from 'crypto';

export const EMBED_DIM = 384;

/** Which embedder is configured — surfaced in /api/memory/stats so the UI can
 *  state it truthfully ("semantic" claims must match reality). */
export function embedderInfo(): { mode: 'remote' | 'local-hash'; model: string } {
  const url = process.env.EMBEDDINGS_URL?.trim();
  return url
    ? { mode: 'remote', model: process.env.EMBEDDINGS_MODEL || 'text-embedding-3-small' }
    : { mode: 'local-hash', model: 'deterministic n-gram hash (no ML model)' };
}

const cache = new Map<string, number[]>();

export async function embed(text: string): Promise<number[]> {
  const key = text.slice(0, 512);
  const hit = cache.get(key);
  if (hit) return hit;

  const url = process.env.EMBEDDINGS_URL?.trim();
  let vec: number[];
  if (url) {
    try {
      vec = await remoteEmbed(url, text);
    } catch {
      vec = localEmbed(text); // graceful degradation — never break the run
    }
  } else {
    vec = localEmbed(text);
  }
  cache.set(key, vec);
  if (cache.size > 2000) cache.clear();
  return vec;
}

async function remoteEmbed(baseUrl: string, text: string): Promise<number[]> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/embeddings`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(process.env.EMBEDDINGS_API_KEY
        ? { authorization: `Bearer ${process.env.EMBEDDINGS_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model: process.env.EMBEDDINGS_MODEL || 'text-embedding-3-small',
      input: text.slice(0, 6000),
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`embeddings ${res.status}`);
  const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
  const v = data.data[0].embedding;
  // Project to EMBED_DIM if the provider returns a different width.
  if (v.length === EMBED_DIM) return v;
  const out = new Array(EMBED_DIM).fill(0);
  for (let i = 0; i < v.length; i++) out[i % EMBED_DIM] += v[i];
  return l2(out);
}

// Hash-ngram embedding: word unigrams + bigrams + char trigrams hashed into
// EMBED_DIM buckets with tf weighting. Deterministic, explainable, fast.
function localEmbed(text: string): number[] {
  const v = new Array<number>(EMBED_DIM).fill(0);
  const words = text.toLowerCase().replace(/[^a-z0-9°%.\- ]+/g, ' ').split(/\s+/).filter(Boolean);
  const grams: string[] = [];
  for (let i = 0; i < words.length; i++) {
    grams.push(words[i]);
    if (i + 1 < words.length) grams.push(words[i] + '_' + words[i + 1]);
    const w = words[i];
    for (let j = 0; j + 3 <= w.length; j++) grams.push('#' + w.slice(j, j + 3));
  }
  for (const gtoken of grams) {
    const h = createHash('md5').update(gtoken).digest();
    const idx = h.readUInt32BE(0) % EMBED_DIM;
    const sign = h[4] % 2 === 0 ? 1 : -1;
    v[idx] += sign;
  }
  return l2(v);
}

function l2(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / n);
}
