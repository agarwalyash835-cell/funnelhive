// Hive and the seller's Vault (vault.js): find files, read what's in one (PDFs, Word, sheets, text and photos — the same
// reader the AI agent's knowledge uses), and save a note Hive writes (a summary, a proposal, an SOP) as a file. Reading
// runs; saving is a change, so an "ask first" teammate or a scheduled run waits for the seller's OK.
import { T } from './db.js';
import { vaultBytes, saveVaultText } from './vault.js';
import { extractText } from './waknow.js';
import { creditsShort, spendCredits } from './billing.js';

const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const str = (description) => ({ type: 'string', description });
const TEXT_MAX = 20000;
const clip = (v, n) => String(v ?? '').slice(0, n);

export const TOOLS = [
  {
    name: 'vault_files', description: 'Find files in the seller’s Vault (brochures, price lists, agreements, invoices, photos) by name. Returns id, name, type, size and date — use read_vault_file to read one.',
    schema: S({ query: str('Part of the file name (optional — blank lists the newest)') }),
    run: async (ctx, a) => {
      const list = await ctx.call('GET', `/vault/files${a.query ? `?q=${encodeURIComponent(a.query)}` : ''}`);
      return { total: list.length, files: list.slice(0, 30).map((f) => ({ id: f.id, name: f.name, kind: f.kind, sizeKB: Math.round((f.size || 0) / 1024), at: new Date(f.at).toISOString().slice(0, 10) })) };
    },
    summary: (r) => `Looked in your Vault (${r.total} file${r.total === 1 ? '' : 's'})`,
  },
  {
    name: 'read_vault_file', description: 'Read the text of one Vault file (PDF, Word, Excel/CSV, text, or a photo of a document). Long files come back shortened — say so if it matters.',
    schema: S({ fileId: str('The file id from vault_files') }, ['fileId']),
    run: async (ctx, a) => ctx.call('GET', `/hive/vault/${encodeURIComponent(a.fileId)}/text`),
    summary: (r) => `Read “${r.name}”`,
  },
  {
    name: 'save_to_vault', description: 'Save text Hive wrote (a summary, proposal, SOP, script, checklist, meeting notes) as a file in the seller’s Vault so they keep it. Give it a clear name.',
    schema: S({ name: str('File name, e.g. "Aranya site visit script"'), text: str('The full text to save') }, ['name', 'text']),
    run: async (ctx, a) => ctx.call('POST', '/hive/vault/notes', { name: a.name, text: a.text }),
    summary: (r) => `Saved “${r.name}” in your Vault`,
  },
];
export const OK = {};

export function registerHiveDocs(app, { auth, wrap, rateLimit, isTest }) {
  const limiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 30, key: (req) => req.user.id });
  // the text of one of the seller's files (pages read by the Indian-script reader cost AI credits, as for knowledge)
  app.get('/api/hive/vault/:id/text', auth, limiter, wrap(async (req, res) => {
    const f = T.vaultFiles.get(req.params.id);
    if (!f || f.userId !== req.user.id) return res.status(404).json({ error: 'File not found' });
    const buf = await vaultBytes(f);
    if (!buf) return res.status(404).json({ error: 'That file’s content isn’t available' });
    let text = '', note = '';
    if (f.kind === 'text' || /^text\//.test(f.type || '')) text = buf.toString('utf8');
    else {
      const used = { n: 0 };
      const r = await extractText(f, buf, { lang: 'auto', canSpend: (n) => !creditsShort(req.user, n), sarvamPages: used });
      if (used.n) spendCredits(req.user, used.n);
      text = (r.pages || []).map((p) => (r.pages.length > 1 ? `[page ${p.n}]\n${p.text}` : p.text)).join('\n\n');
      note = r.note || '';
    }
    res.json({ id: f.id, name: f.name, text: clip(text, TEXT_MAX), truncated: text.length > TEXT_MAX, ...(note ? { note } : {}) });
  }));
  app.post('/api/hive/vault/notes', auth, limiter, wrap(async (req, res) => {
    const text = clip(req.body?.text, 200000);
    if (!text.trim()) return res.status(400).json({ error: 'Nothing to save' });
    try {
      const f = await saveVaultText(req.user, req.actor || req.user, { name: clip(req.body?.name, 120), text });
      res.json({ id: f.id, name: f.name, sizeKB: Math.round(f.size / 1024) });
    } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
  }));
}
