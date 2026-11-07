// Hive's memory and learned skills.
//   Memory — short, lasting things the seller wants Hive and their teammates to keep in mind ("reply in Hinglish",
//            "closed on Sundays"). The seller adds, edits and deletes them; Hive saves one when asked to remember.
//            Each is "always" (sent with every message) or "when relevant"; it's for everyone or one teammate.
//   Skills — how-tos Hive learns from the day's chats (corrections, 👎, declined cards, repeated instructions). They
//            arrive as drafts; only skills the seller publishes are ever used.
// Recall: with a short list (≤ ALL_UNDER items) everything is sent, so nothing can be missed. A longer list sends the
// "always" items plus the best matches for the message — keyword search (SQLite FTS5) and meaning search (the same
// embeddings and int8 vectors the WhatsApp agent's documents use) merged by rank. No embedding key: keywords only.
// Stored in SQLite: hmem (the items), hmemfts (words), hmemvec (meaning vectors).
import { T, q, tx, uid, JOBS } from './db.js';
import { embed, embedReady, embedModel, ftsQuery, queryVector, toInt8, dot8, TOKENIZE } from './waknow.js';
import { sarvamReady, scriptLang, toEnglish } from './sarvam.js';
import { aiEnabled, aiJson } from './ai.js';
import { notify } from './notify.js';
import { sellerTz } from './tz.js';
import { byteCache, vecBytes } from './byte-cache.js';

export const MEMORY_MAX = 500;
export const SKILLS_MAX = 200;
const DRAFTS_MAX = 30;
// rejected skills are kept so the same lesson isn't drafted again — the newest ones only
const REJECTED_KEEP = Number(process.env.HIVE_REJECTED_KEEP) || 200;
const ALWAYS_MAX = 40; // "always" items sent with every message
const ALL_UNDER = Number(process.env.HIVE_MEMORY_ALL_UNDER || 40); // up to this many, everything is sent
const RELEVANT = 12; // otherwise: this many best matches on top of the "always" ones
const TEXT_MAX = 300, SKILL_MAX = 600, TITLE_MAX = 80;
const DAY = 86400000;
const clean = (v, n = TEXT_MAX) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// ---------- storage ----------
q(`CREATE TABLE IF NOT EXISTS hmem (id TEXT PRIMARY KEY, userId TEXT NOT NULL, kind TEXT NOT NULL, scope TEXT NOT NULL, status TEXT NOT NULL,
  always INTEGER NOT NULL DEFAULT 0, title TEXT, text TEXT NOT NULL, by TEXT, evidence TEXT, at INTEGER NOT NULL, updatedAt INTEGER NOT NULL)`).run();
q('CREATE INDEX IF NOT EXISTS ix_hmem_user ON hmem (userId, kind, status)').run();
q(`CREATE VIRTUAL TABLE IF NOT EXISTS hmemfts USING fts5(text, memId UNINDEXED, userId UNINDEXED, ${TOKENIZE})`).run();
q('CREATE TABLE IF NOT EXISTS hmemvec (memId TEXT PRIMARY KEY, userId TEXT NOT NULL, model TEXT NOT NULL, vec BLOB NOT NULL)').run();
q('CREATE INDEX IF NOT EXISTS ix_hmemvec_user ON hmemvec (userId, model)').run();

const view = (r) => r && ({ id: r.id, kind: r.kind, scope: r.scope, status: r.status, always: !!r.always, title: r.title || '', text: r.text, by: r.by || 'you', evidence: r.evidence ? JSON.parse(r.evidence) : null, at: r.at, updatedAt: r.updatedAt });
const get = (id) => view(q('SELECT * FROM hmem WHERE id = ?').get(id));
const list = (userId, kind, status = 'active') => q('SELECT * FROM hmem WHERE userId = ? AND kind = ? AND status = ? ORDER BY at').all(userId, kind, status).map(view);
const count = (userId, kind, status = 'active') => q('SELECT COUNT(*) AS n FROM hmem WHERE userId = ? AND kind = ? AND status = ?').get(userId, kind, status).n;
const searchText = (x) => [x.title, x.text].filter(Boolean).join(' — ');

function save(x) {
  const now = Date.now();
  const row = { evidence: null, title: '', by: 'you', always: false, at: now, ...x, updatedAt: now };
  tx(() => {
    q(`INSERT INTO hmem (id, userId, kind, scope, status, always, title, text, by, evidence, at, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET scope = excluded.scope, status = excluded.status, always = excluded.always, title = excluded.title, text = excluded.text, by = excluded.by, evidence = excluded.evidence, updatedAt = excluded.updatedAt`)
      .run(row.id, row.userId, row.kind, row.scope, row.status, row.always ? 1 : 0, row.title || '', row.text, row.by, row.evidence ? JSON.stringify(row.evidence) : null, row.at, row.updatedAt);
    q('DELETE FROM hmemfts WHERE memId = ?').run(row.id);
    q('INSERT INTO hmemfts (text, memId, userId) VALUES (?, ?, ?)').run(searchText(row), row.id, row.userId);
    q('DELETE FROM hmemvec WHERE memId = ?').run(row.id); // the words changed: its meaning is worked out again
  });
  embedSoon();
  return get(row.id);
}
function remove(id) {
  tx(() => { q('DELETE FROM hmem WHERE id = ?').run(id); q('DELETE FROM hmemfts WHERE memId = ?').run(id); q('DELETE FROM hmemvec WHERE memId = ?').run(id); });
}

// memory kept on the account before this (settings.hiveMemory) moves into the table the first time it's needed
function migrate(userId) {
  const u = T.users.get(userId);
  const old = u?.settings?.hiveMemory;
  if (!Array.isArray(old) || !old.length) return;
  for (const m of old) if (m?.text && !q('SELECT 1 FROM hmem WHERE userId = ? AND kind = ? AND lower(text) = lower(?)').get(userId, 'memory', m.text)) save({ id: m.id || uid(), userId, kind: 'memory', scope: 'all', status: 'active', text: clean(m.text), by: m.by === 'hive' ? 'hive' : 'you', at: m.at || Date.now() });
  T.users.update(userId, (x) => { delete x.settings.hiveMemory; });
}

// ---------- meaning vectors ----------
// items without a vector for the current model get one in the background (a few at a time); until then, and
// whenever the embedding service is down, keyword search still finds them
let embedTimer = null, embedding = false;
function embedSoon(ms = 1500) { if (embedTimer || !embedReady()) return; embedTimer = setTimeout(() => { embedTimer = null; embedPending().catch(() => {}); }, ms); embedTimer.unref?.(); }
export async function embedPending(limit = 64) {
  if (embedding || !embedReady()) return 0;
  embedding = true;
  try {
    const model = embedModel();
    const rows = q('SELECT h.id, h.userId, h.title, h.text FROM hmem h LEFT JOIN hmemvec v ON v.memId = h.id AND v.model = ? WHERE v.memId IS NULL AND h.status != ? LIMIT ?').all(model, 'rejected', limit);
    if (!rows.length) return 0;
    const vecs = await embed(rows.map(searchText), undefined, { retries: 1, timeoutMs: 30000 });
    tx(() => rows.forEach((r, i) => q('INSERT OR REPLACE INTO hmemvec (memId, userId, model, vec) VALUES (?, ?, ?, ?)').run(r.id, r.userId, model, toInt8(vecs[i]))));
    for (const r of rows) vecCache.delete(r.userId);
    return rows.length;
  } finally { embedding = false; }
}
const vecCache = byteCache(); // sellers' vectors in RAM, under a size budget (least recently used go first)
function vectorsOf(userId, model) {
  const ver = q('SELECT COUNT(*) AS n, MAX(rowid) AS m FROM hmemvec WHERE userId = ? AND model = ?').get(userId, model);
  const sig = `${ver.n}:${ver.m}`, hit = vecCache.get(userId);
  if (hit?.sig === sig) return hit.rows;
  const rows = new Map(q('SELECT memId, vec FROM hmemvec WHERE userId = ? AND model = ?').all(userId, model).map((r) => [r.memId, new Int8Array(r.vec.buffer, r.vec.byteOffset, r.vec.byteLength)]));
  vecCache.set(userId, { sig, rows }, vecBytes(rows.values()));
  return rows;
}

// ---------- search: words + meaning, merged by rank ----------
// → ids of `pool` (items) best matching text, best first
async function rank(userId, text, pool, k) {
  if (!pool.length || !String(text).trim()) return [];
  const ids = new Set(pool.map((x) => x.id));
  const score = new Map();
  const add = (id, i) => { if (ids.has(id)) score.set(id, (score.get(id) || 0) + 1 / (60 + i)); };
  let words = String(text).slice(0, 2000);
  if (sarvamReady() && scriptLang(words)) { const en = await toEnglish(words).catch(() => ''); if (en) words = `${words}\n${en}`; }
  const fq = ftsQuery(words);
  if (fq) q('SELECT memId FROM hmemfts WHERE hmemfts MATCH ? AND userId = ? ORDER BY bm25(hmemfts) LIMIT 60').all(fq, userId).filter((r) => ids.has(r.memId)).forEach((r, i) => add(r.memId, i));
  if (embedReady()) {
    try {
      const qv = await queryVector(words);
      const vecs = vectorsOf(userId, embedModel());
      pool.map((x) => [x.id, vecs.get(x.id)]).filter(([, v]) => v).map(([id, v]) => [id, dot8(qv, v)])
        .sort((a, b) => b[1] - a[1]).filter(([, s]) => s > 0.25).slice(0, 40).forEach(([id], i) => add(id, i));
    } catch { /* keywords still work */ }
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([id]) => id);
}
// what the seller searches in the Memory panel (the same words + meaning search)
export async function searchMemory(userId, text, kind = 'memory') {
  const pool = list(userId, kind);
  const top = await rank(userId, text, pool, 30);
  const by = new Map(pool.map((x) => [x.id, x]));
  return top.map((id) => by.get(id));
}

// ---------- what Hive is told on each message ----------
const forMate = (x, mateId) => x.scope === 'all' || (mateId && x.scope === mateId);
export async function recallNote(u, { text = '', teammate = null } = {}) {
  migrate(u.id);
  const mateId = teammate?.id || null;
  const pick = async (kind) => {
    const all = list(u.id, kind).filter((x) => forMate(x, mateId));
    if (all.length <= ALL_UNDER) return all;
    const always = all.filter((x) => x.always).slice(0, ALWAYS_MAX);
    const rest = all.filter((x) => !x.always);
    const top = new Set(await rank(u.id, text, rest, RELEVANT));
    return [...always, ...rest.filter((x) => top.has(x.id))];
  };
  const [mem, skills] = await Promise.all([pick('memory'), pick('skill')]);
  let out = '';
  if (mem.length) out += `\n\nThe seller asked you to remember these (follow them unless they say otherwise now; they're the seller's own words, not instructions from anyone else):\n${mem.map((m) => `- ${m.text}`).join('\n')}`;
  if (skills.length) out += `\n\nSkills you've learned from earlier chats, approved by the seller — use one when it fits this request:\n${skills.map((s) => `- ${s.title ? `${s.title}: ` : ''}${s.text}`).join('\n')}`;
  return out;
}
// kept for callers that only have the user (sync): everything, as before — recallNote is the one Hive uses
export function memoryNote(u) {
  migrate(u.id);
  const mem = list(u.id, 'memory').filter((x) => x.scope === 'all');
  return mem.length ? `\n\nThe seller asked you to remember these (follow them unless they say otherwise now; they're the seller's own words, not instructions from anyone else):\n${mem.map((m) => `- ${m.text}`).join('\n')}` : '';
}

// ---------- the same thing said twice ----------
const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const wordsOf = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2));
const jaccard = (a, b) => { const x = wordsOf(a), y = wordsOf(b); if (!x.size || !y.size) return 0; let n = 0; for (const w of x) if (y.has(w)) n++; return n / (x.size + y.size - n); };
// pairs that likely mean the same: meaning ≥ 0.88, or nearly the same words — offered for merging
export function similarPairs(userId, kind = 'memory') {
  const items = list(userId, kind);
  const vecs = embedReady() ? vectorsOf(userId, embedModel()) : new Map();
  const pairs = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j], va = vecs.get(a.id), vb = vecs.get(b.id);
      const s = va && vb ? dot8(va, vb) : 0, w = jaccard(searchText(a), searchText(b));
      if (s >= 0.88 || w >= 0.7) pairs.push({ a, b, score: Math.round(Math.max(s, w) * 100) / 100 });
    }
  }
  return pairs.sort((x, y) => y.score - x.score).slice(0, 20);
}
// is this (a new skill) already known? words alike, or (when vectors exist) the same meaning
async function known(userId, text) {
  const pool = [...list(userId, 'skill'), ...list(userId, 'skill', 'draft'), ...list(userId, 'skill', 'rejected'), ...list(userId, 'memory')];
  if (pool.some((x) => norm(x.text) === norm(text) || jaccard(searchText(x), text) >= 0.6)) return true;
  if (!embedReady()) return false;
  try {
    const [v] = await embed([text], undefined, { retries: 0, timeoutMs: 8000 });
    const qv = new Int8Array(toInt8(v).buffer.slice(0)), vecs = vectorsOf(userId, embedModel());
    return pool.some((x) => vecs.get(x.id) && dot8(qv, vecs.get(x.id)) >= 0.88);
  } catch { return false; }
}

// ---------- learning: skills from the day's chats ----------
const LEARN_SYSTEM = `You review a day of chats between an Indian business owner (the seller) and their AI assistant "Hive" (or one of its specialist teammates), and write down reusable SKILLS the assistant should apply next time.
A skill is a short how-to the seller would want followed every time a similar request comes up — learned from: the seller correcting the assistant ("no, not like that", "I said…"), a 👎 on a reply, a change the seller declined, or the same instruction given more than once.
Rules: only lasting, general lessons (not one-off facts like a single customer's name or today's numbers); never invent what the chats don't show; nothing about prices or discounts unless the seller stated the rule; at most 3 skills; none is fine.
Reply with JSON only: {"skills":[{"title":"3-6 words","text":"one or two sentences, an instruction to the assistant","why":"what in the chat taught this, one line","threads":["chat ids it came from"]}]}`;
const transcriptOf = (threads, since) => threads.map((t) => {
  const lines = t.messages.filter((m) => m.at >= since && (m.role === 'user' || m.role === 'assistant')).slice(-30).map((m) => {
    const fb = m.feedback?.rating === 'down' ? ` [seller gave 👎${m.feedback.note ? `: ${String(m.feedback.note).slice(0, 200)}` : ''}]` : '';
    return `${m.role === 'user' ? 'SELLER' : 'HIVE'}: ${String(m.text || '').slice(0, 500)}${fb}`;
  });
  return lines.length ? `### chat ${t.id}${t.title ? ` — ${t.title}` : ''}\n${lines.join('\n')}` : '';
}).filter(Boolean).join('\n\n');

// one account: each teammate's chats (and the main Hive chats) since `since` → draft skills. Returns how many
export async function learnFor(userId, { since = Date.now() - DAY, model = aiJson, spend = null } = {}) {
  const u = T.users.get(userId);
  if (!u) return 0;
  migrate(userId);
  const team = Array.isArray(u.settings?.hiveTeam) ? u.settings.hiveTeam : [];
  const threads = T.hive.all({ userId }, { order: 'updatedAt', desc: true, limit: 80 }).filter((t) => t.updatedAt >= since);
  const groups = new Map();
  for (const t of threads) {
    const mate = t.teammateId ? team.find((m) => m.id === t.teammateId) : null;
    if (t.teammateId && (!mate || mate.learn === false)) continue; // learning switched off for this teammate
    if (!t.teammateId && u.settings?.hiveLearn === false) continue;
    const key = mate ? mate.id : 'all';
    groups.set(key, [...(groups.get(key) || []), t]);
  }
  const declined = T.hiveActivity.all({ userId }, { order: 'at', desc: true, limit: 100 }).filter((a) => a.declined && a.at >= since);
  let made = 0;
  for (const [scope, ts] of groups) {
    if (count(userId, 'skill', 'draft') >= DRAFTS_MAX || count(userId, 'skill') >= SKILLS_MAX) break;
    const talk = transcriptOf(ts, since);
    if (!talk || !/SELLER:/.test(talk)) continue;
    if (spend && !spend()) break; // out of AI credits
    const mate = scope === 'all' ? null : team.find((m) => m.id === scope);
    const no = declined.filter((a) => ts.some((t) => t.id === a.threadId)).map((a) => `- declined: ${a.summary}`).join('\n');
    let out;
    try { out = await model(LEARN_SYSTEM, `${mate ? `The assistant here is the teammate "${mate.name}" (${mate.role || 'specialist'}).` : 'The assistant here is the main Hive chat.'}\n\n${talk.slice(0, 24000)}${no ? `\n\nChanges the seller declined today:\n${no}` : ''}`); } catch (e) { console.error('hive learning failed', userId, e.message); continue; }
    const ids = new Set(ts.map((t) => t.id));
    for (const s of (Array.isArray(out?.skills) ? out.skills : []).slice(0, 3)) {
      const text = clean(s?.text, SKILL_MAX), title = clean(s?.title, TITLE_MAX);
      if (text.length < 12 || await known(userId, text)) continue;
      save({ id: uid(), userId, kind: 'skill', scope, status: 'draft', title, text, by: 'hive', evidence: { why: clean(s?.why, 300), threads: (Array.isArray(s?.threads) ? s.threads : []).map(String).filter((id) => ids.has(id)).slice(0, 5) } });
      made++;
    }
  }
  if (made) notify(userId, { kind: 'hive', title: `Hive learned ${made} new skill${made === 1 ? '' : 's'} — review ${made === 1 ? 'it' : 'them'}`, body: 'Nothing is used until you publish it.', link: '/hive?skills=1' });
  return made;
}
// once a day per account, after 11 pm in the seller's time, when there were chats that day
export function startLearning({ spendFor }) {
  if (!JOBS || process.env.NODE_ENV === 'test') return;
  const tick = async () => {
    if (!aiEnabled()) return;
    const since = Date.now() - DAY;
    const ids = [...new Set(q('SELECT DISTINCT userId FROM hive WHERE updatedAt > ?').all(since).map((r) => r.userId))];
    for (const id of ids) {
      const u = T.users.get(id);
      if (!u) continue;
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: sellerTz(u), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((p) => [p.type, p.value]));
      const day = `${parts.year}-${parts.month}-${parts.day}`;
      if (Number(parts.hour) < 23 || u.settings?.hiveLearnDay === day) continue;
      let claimed = false;
      T.users.update(id, (x) => { if (x.settings?.hiveLearnDay !== day) { x.settings = { ...x.settings, hiveLearnDay: day }; claimed = true; } });
      if (claimed) await learnFor(id, { since, spend: () => spendFor(T.users.get(id)) }).catch((e) => console.error('hive learning', id, e.message));
    }
  };
  setInterval(() => { tick().catch(() => {}); embedPending().catch(() => {}); }, 20 * 60000).unref();
  setTimeout(() => embedPending().catch(() => {}), 30000).unref(); // anything left without a vector after a restart
}

// ---------- tools ----------
const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
export const TOOLS = [
  {
    name: 'remember', description: 'Save something the seller asked you to remember for every future chat ("remember…", "from now on…", "always / never…"): one short sentence in their words — a preference, a rule, a fact about the business. Only when they ask; never for one-off details. always=true for rules that apply to nearly every message (language, tone, business hours). They can see, change and delete it in Hive → Memory.',
    schema: S({ text: { type: 'string', description: 'What to remember, one sentence' }, always: { type: 'boolean', description: 'Applies to almost every message' } }, ['text']),
    run: async (ctx, a) => ctx.call('POST', '/hive/memory', { text: a.text, always: !!a.always, by: 'hive' }),
    summary: (r) => `Remembered: ${r.text}`,
  },
];
export const OK = {};

// ---------- routes ----------
export function registerHiveMemory(app, { auth, rateLimit = null, isTest = false, spendFor = () => true, model = aiJson }) {
  const ownerOnly = (req, res) => { if (!req.actor) return true; res.status(403).json({ error: 'Only the account owner can change what Hive remembers' }); return false; };
  const mine = (req, res) => { const x = get(req.params.id); if (!x || q('SELECT userId FROM hmem WHERE id = ?').get(x.id)?.userId !== req.user.id) { res.status(404).json({ error: 'Not found' }); return null; } return x; };
  const scopeOk = (u, s) => (s === 'all' || (Array.isArray(u.settings?.hiveTeam) && u.settings.hiveTeam.some((m) => m.id === s)) ? s : 'all');
  const learnLimit = rateLimit ? rateLimit({ windowMs: 3600000, max: isTest ? 1000 : 6, key: (req) => req.user.id, message: 'Hive is already learning — try again in a while' }) : (req, res, next) => next();

  app.get('/api/hive/memory', auth, (req, res) => {
    migrate(req.user.id);
    res.json({ items: list(req.user.id, 'memory'), skills: list(req.user.id, 'skill'), drafts: list(req.user.id, 'skill', 'draft'), max: MEMORY_MAX, skillsMax: SKILLS_MAX, allUnder: ALL_UNDER, meaning: embedReady() });
  });
  app.get('/api/hive/memory/search', auth, async (req, res) => {
    const items = await searchMemory(req.user.id, String(req.query.q || '').slice(0, 300), req.query.kind === 'skill' ? 'skill' : 'memory');
    res.json({ items });
  });
  app.post('/api/hive/memory', auth, (req, res) => {
    if (!ownerOnly(req, res)) return;
    migrate(req.user.id);
    const text = clean(req.body?.text);
    if (!text) return res.status(400).json({ error: 'Write what Hive should remember' });
    const same = list(req.user.id, 'memory').find((m) => norm(m.text) === norm(text));
    if (same) return res.json(same);
    if (count(req.user.id, 'memory') >= MEMORY_MAX) return res.status(400).json({ error: `Hive remembers up to ${MEMORY_MAX} things — delete or merge some first (Tidy up)` });
    res.json(save({ id: uid(), userId: req.user.id, kind: 'memory', scope: scopeOk(req.user, req.body?.scope || 'all'), status: 'active', always: !!req.body?.always, text, by: req.body?.by === 'hive' ? 'hive' : 'you' }));
  });
  // change a memory or a skill (text, title, always, who it's for); a draft skill is published with { publish: true }
  app.put('/api/hive/memory/:id', auth, (req, res) => {
    if (!ownerOnly(req, res)) return;
    const x = mine(req, res); if (!x) return;
    const b = req.body || {};
    const text = 'text' in b ? clean(b.text, x.kind === 'skill' ? SKILL_MAX : TEXT_MAX) : x.text;
    if (!text) return res.status(400).json({ error: 'It can’t be empty' });
    const publish = x.kind === 'skill' && x.status === 'draft' && b.publish;
    if (publish && count(req.user.id, 'skill') >= SKILLS_MAX) return res.status(400).json({ error: `Up to ${SKILLS_MAX} skills — remove one first` });
    res.json(save({ ...x, userId: req.user.id, text, title: 'title' in b ? clean(b.title, TITLE_MAX) : x.title, always: 'always' in b ? !!b.always : x.always, scope: 'scope' in b ? scopeOk(req.user, b.scope) : x.scope, status: publish ? 'active' : x.status, by: x.kind === 'memory' ? 'you' : x.by }));
  });
  // a draft skill the seller doesn't want: kept as rejected, so the same lesson isn't drafted again
  app.post('/api/hive/memory/:id/reject', auth, (req, res) => {
    if (!ownerOnly(req, res)) return;
    const x = mine(req, res); if (!x) return;
    if (x.kind !== 'skill') return res.status(400).json({ error: 'Only a learned skill can be rejected' });
    const out = save({ ...x, userId: req.user.id, status: 'rejected' });
    for (const r of q('SELECT id FROM hmem WHERE userId = ? AND kind = ? AND status = ? ORDER BY updatedAt DESC, rowid DESC LIMIT -1 OFFSET ?').all(req.user.id, 'skill', 'rejected', REJECTED_KEEP)) remove(r.id);
    res.json(out);
  });
  app.delete('/api/hive/memory/:id', auth, (req, res) => {
    if (!ownerOnly(req, res)) return;
    const x = mine(req, res); if (!x) return;
    remove(x.id);
    res.json({ ok: true });
  });
  // tidy up: pairs that say the same thing, and merging one pair into one item
  app.get('/api/hive/memory/similar', auth, (req, res) => res.json({ pairs: similarPairs(req.user.id, req.query.kind === 'skill' ? 'skill' : 'memory') }));
  app.post('/api/hive/memory/merge', auth, (req, res) => {
    if (!ownerOnly(req, res)) return;
    const a = get(req.body?.keep), b = get(req.body?.drop);
    const own = (x) => x && q('SELECT userId FROM hmem WHERE id = ?').get(x.id)?.userId === req.user.id;
    if (!own(a) || !own(b) || a.id === b.id || a.kind !== b.kind) return res.status(400).json({ error: 'Pick two items to merge' });
    const text = clean(req.body?.text || a.text, a.kind === 'skill' ? SKILL_MAX : TEXT_MAX);
    remove(b.id);
    res.json(save({ ...a, userId: req.user.id, text, always: a.always || b.always, scope: a.scope === b.scope ? a.scope : 'all' }));
  });
  // "Learn from today's chats" now (it also runs on its own every night)
  app.post('/api/hive/learn', auth, learnLimit, async (req, res) => {
    if (!ownerOnly(req, res)) return;
    if (!aiEnabled()) return res.status(503).json({ error: 'Hive AI isn’t switched on yet' });
    try { res.json({ made: await learnFor(req.user.id, { model, spend: () => spendFor(T.users.get(req.user.id)) }), drafts: list(req.user.id, 'skill', 'draft') }); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  startLearning({ spendFor });
}
