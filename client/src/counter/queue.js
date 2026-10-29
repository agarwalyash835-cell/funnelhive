// The phone's own storage for counter mode (IndexedDB): bills waiting for the network, in the order they were made,
// and the cached catalog for offline pricing. Bills are kept per account (owner = the seller's id).
const DB = 'ff-counter', V = 1;
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, V);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('bills')) d.createObjectStore('bills', { keyPath: 'clientId' }).createIndex('seq', 'seq');
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => { dbp = null; rej(r.error); };
  });
  return dbp;
}
const run = async (store, mode, fn) => {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode), s = t.objectStore(store);
    let out;
    const r = fn(s);
    if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
};

export const kvGet = (k) => run('kv', 'readonly', (s) => s.get(k)).catch(() => null);
export const kvSet = (k, v) => run('kv', 'readwrite', (s) => s.put(v, k)).catch(() => {});

let seq = 0;
// entry: { clientId, owner, body, bill (priced offline, for the receipt), at }
export const enqueue = (e) => run('bills', 'readwrite', (s) => s.put({ ...e, seq: Date.now() * 1000 + (seq++ % 1000) }));
export const queued = async (owner) => ((await run('bills', 'readonly', (s) => s.getAll())) || []).filter((e) => !owner || e.owner === owner).sort((a, b) => a.seq - b.seq);
export const dequeue = (clientId) => run('bills', 'readwrite', (s) => s.delete(clientId));
export const markFailed = (e, error) => run('bills', 'readwrite', (s) => s.put({ ...e, error, failedAt: Date.now() }));
export const clearError = (e) => run('bills', 'readwrite', (s) => s.put({ ...e, error: null }));

// Sends queued bills one by one, oldest first. post(body) → the saved bill, or throws { status } (none when there's no
// network). No network or a server error stops the run (it's tried again later); a bill the server refuses (4xx — an
// item deleted meanwhile, say) is kept with the reason for the seller to see and the rest go on.
let running = null;
export function syncQueue(owner, post) {
  if (running) return running;
  running = (async () => {
    const done = [], failed = [];
    for (const e of await queued(owner)) {
      if (e.error) continue; // refused before: waits for the seller (retry / remove)
      try {
        const b = await post({ ...e.body, clientId: e.clientId, offline: { total: e.bill?.total, at: e.at } });
        await dequeue(e.clientId);
        done.push(b);
      } catch (err) {
        if (!err.status || err.status >= 500 || err.status === 429 || err.status === 401) break;
        await markFailed(e, err.message);
        failed.push({ ...e, error: err.message });
      }
    }
    return { done, failed };
  })().finally(() => { running = null; });
  return running;
}
