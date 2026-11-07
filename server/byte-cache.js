// A per-process cache that stays under a size budget in bytes: the least recently used entries go first. Used for
// sellers' meaning vectors (Hive memory, the WhatsApp agent's documents), so RAM stays flat however many sellers
// there are — a seller who drops out is simply read from SQLite again next time.
export const VEC_CACHE_BYTES = Math.max(1, Number(process.env.VEC_CACHE_MB) || 32) * 1048576;

export function byteCache(maxBytes = VEC_CACHE_BYTES) {
  const m = new Map();
  let total = 0;
  const drop = (k) => { const e = m.get(k); if (e) { m.delete(k); total -= e.bytes; } };
  return {
    get(k) { const e = m.get(k); if (!e) return undefined; m.delete(k); m.set(k, e); return e.v; }, // now the most recent
    set(k, v, bytes) {
      drop(k);
      if (bytes > maxBytes) return; // bigger than the whole budget: not kept
      m.set(k, { v, bytes });
      total += bytes;
      while (total > maxBytes) drop(m.keys().next().value);
    },
    delete: drop,
    get bytes() { return total; },
    get size() { return m.size; },
  };
}
// the size of a seller's vectors: the vectors themselves plus a little for each entry's keys
export const vecBytes = (vecs) => { let n = 0; for (const v of vecs) n += (v?.byteLength || 0) + 96; return n; };
