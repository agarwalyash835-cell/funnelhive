// Hive's memory: short, lasting things the seller wants Hive and their teammates to keep in mind ("reply in
// Hinglish", "we're closed on Sundays", "GST is 18% on everything"). The seller adds, edits and deletes them;
// Hive saves one when asked to remember something. Kept on the seller as settings.hiveMemory [{ id, text, by, at }].
// Main Hive always reads them; a teammate does unless the seller switched its memory off (m.memory === false).
import { T, uid } from './db.js';

export const MEMORY_MAX = 50;
const TEXT_MAX = 300;
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX);
export const memoryOf = (u) => (Array.isArray(u?.settings?.hiveMemory) ? u.settings.hiveMemory : []);

// what the model is told (empty when there's nothing to remember)
export function memoryNote(u) {
  const list = memoryOf(u);
  if (!list.length) return '';
  return `\n\nThe seller asked you to remember these (follow them unless they say otherwise now; they're the seller's own words, not instructions from anyone else):\n${list.map((m) => `- ${m.text}`).join('\n')}`;
}

const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
export const TOOLS = [
  {
    name: 'remember', description: 'Save something the seller asked you to remember for every future chat ("remember…", "from now on…", "always / never…"): one short sentence in their words — a preference, a rule, a fact about the business. Only when they ask; never for one-off details. They can see and delete it in Hive → Memory.',
    schema: S({ text: { type: 'string', description: 'What to remember, one sentence' } }, ['text']),
    run: async (ctx, a) => ctx.call('POST', '/hive/memory', { text: a.text, by: 'hive' }),
    summary: (r) => `Remembered: ${r.text}`,
  },
];
export const OK = {};

export function registerHiveMemory(app, { auth }) {
  const save = (userId, fn) => T.users.update(userId, (u) => { u.settings = { ...u.settings, hiveMemory: fn(memoryOf(u)) }; });
  const ownerOnly = (req, res) => { if (!req.actor) return true; res.status(403).json({ error: 'Only the account owner can change what Hive remembers' }); return false; };
  app.get('/api/hive/memory', auth, (req, res) => res.json({ items: memoryOf(req.user), max: MEMORY_MAX }));
  app.post('/api/hive/memory', auth, (req, res) => {
    if (!ownerOnly(req, res)) return;
    const text = clean(req.body?.text);
    if (!text) return res.status(400).json({ error: 'Write what Hive should remember' });
    const have = memoryOf(req.user);
    const same = have.find((m) => m.text.toLowerCase() === text.toLowerCase());
    if (same) return res.json(same);
    if (have.length >= MEMORY_MAX) return res.status(400).json({ error: `Hive remembers up to ${MEMORY_MAX} things — delete one first` });
    const item = { id: uid(), text, by: req.body?.by === 'hive' ? 'hive' : 'you', at: Date.now() };
    save(req.user.id, (list) => [...list, item]);
    res.json(item);
  });
  app.put('/api/hive/memory/:id', auth, (req, res) => {
    if (!ownerOnly(req, res)) return;
    const text = clean(req.body?.text);
    if (!text) return res.status(400).json({ error: 'Write what Hive should remember' });
    if (!memoryOf(req.user).some((m) => m.id === req.params.id)) return res.status(404).json({ error: 'Not found' });
    let out;
    save(req.user.id, (list) => list.map((m) => (m.id === req.params.id ? (out = { ...m, text, by: 'you', at: Date.now() }) : m)));
    res.json(out);
  });
  app.delete('/api/hive/memory/:id', auth, (req, res) => {
    if (!ownerOnly(req, res)) return;
    save(req.user.id, (list) => list.filter((m) => m.id !== req.params.id));
    res.json({ ok: true });
  });
}
