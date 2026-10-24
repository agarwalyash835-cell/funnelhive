// Vault: a seller's private files (folders and subfolders), saved passwords and secure notes — and the Files tab
// on every CRM contact, which is the same store: a file uploaded on a contact lands in the system folder
// "CRM uploads" linked to that contact; linking any vault file to a contact shows it on that contact.
//
//  - Files: PDF, Word, images, audio and common office files, up to 15 MB each. The type comes from the
//    extension AND the file's first bytes (pdf, png, jpg, gif, webp, heic, zip-based office, OLE office, mp3/ID3,
//    m4a, wav, ogg, aac, webm); the browser's MIME type is never trusted. Stored like product files: on the
//    storage bucket under vault/<userId>/<fileId> (private; short-lived signed links), else on this server's disk.
//  - Quota: limitsFor(u).vaultMB (2 GB on a paid plan, 200 MB on the trial; Admin → limits can change both).
//  - Passwords and secure notes: encrypted at rest (messaging.js encrypt), never in a list; shown only by
//    POST /api/vault/secrets/:id/reveal — rate-limited, recorded in the activity log, owners and admins only
//    (team.js keeps them from other roles; API keys and platform support can't reveal them either).
//  - A contact erased on request (legal.js): their links go; files they had only in "CRM uploads" are deleted
//    with them (they were uploaded for that person). Files the seller filed elsewhere are kept, unlinked.
//  - Share links: a file can get a link anyone can open for 1 or 7 days, revocable.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { T, q, tx, uid, dir as DATA_DIR } from './db.js';
import { encrypt, decrypt } from './messaging.js';
import { logActivity, metaFor } from './crm.js';
import { limitsFor } from './limits.js';
import { randomToken, hashToken } from './security.js';
import { s3Enabled, putFile, deleteObject, presign } from './storage.js';

const MB = 1024 * 1024;
export const VAULT_FILE_MAX = 15 * MB;
const FILE_DIR = path.resolve(DATA_DIR, 'vault');
const LINK_TTL = 300; // seconds a download / preview link works
const FOLDERS_MAX = 1000, DEPTH_MAX = 10, LINKS_MAX = 50;
const DAY = 86400000;

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const cleanName = (v) => clip(v, 200).replace(/[\\/\0<>:"|?*\x00-\x1f]+/g, '_');
const keyOf = (v) => { const s = String(v || '').trim(); return s.toLowerCase().startsWith('phone:') ? s : s.toLowerCase(); };

// ---------- what may be stored ----------
const at = (b, i, bytes) => bytes.every((x, n) => b[i + n] === x);
const ascii = (b, i, s) => b.length >= i + s.length && b.toString('latin1', i, i + s.length) === s;
const isZip = (b) => at(b, 0, [0x50, 0x4b, 0x03, 0x04]);
const isOle = (b) => at(b, 0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const isFtyp = (b, brands) => ascii(b, 4, 'ftyp') && (!brands || brands.includes(b.toString('latin1', 8, 12)));
const isText = (b) => !b.includes(0);
const isMp3 = (b) => ascii(b, 0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
// ext → [kind, served type, check of the first bytes]
const TYPES = {
  pdf: ['pdf', 'application/pdf', (b) => ascii(b, 0, '%PDF-')],
  doc: ['doc', 'application/msword', isOle],
  docx: ['doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', isZip],
  xls: ['sheet', 'application/vnd.ms-excel', isOle],
  xlsx: ['sheet', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', isZip],
  csv: ['sheet', 'text/csv', isText],
  ppt: ['slides', 'application/vnd.ms-powerpoint', isOle],
  pptx: ['slides', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', isZip],
  txt: ['text', 'text/plain', isText],
  jpg: ['image', 'image/jpeg', (b) => at(b, 0, [0xff, 0xd8, 0xff])],
  jpeg: ['image', 'image/jpeg', (b) => at(b, 0, [0xff, 0xd8, 0xff])],
  png: ['image', 'image/png', (b) => at(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  gif: ['image', 'image/gif', (b) => ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a')],
  webp: ['image', 'image/webp', (b) => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')],
  heic: ['image', 'image/heic', (b) => isFtyp(b, ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis'])],
  heif: ['image', 'image/heif', (b) => isFtyp(b, ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis'])],
  mp3: ['audio', 'audio/mpeg', isMp3],
  m4a: ['audio', 'audio/mp4', (b) => isFtyp(b)],
  wav: ['audio', 'audio/wav', (b) => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WAVE')],
  ogg: ['audio', 'audio/ogg', (b) => ascii(b, 0, 'OggS')],
  oga: ['audio', 'audio/ogg', (b) => ascii(b, 0, 'OggS')],
  aac: ['audio', 'audio/aac', (b) => ascii(b, 0, 'ID3') || (b[0] === 0xff && (b[1] & 0xf6) === 0xf0)],
  weba: ['audio', 'audio/webm', (b) => at(b, 0, [0x1a, 0x45, 0xdf, 0xa3])],
  webm: ['audio', 'audio/webm', (b) => at(b, 0, [0x1a, 0x45, 0xdf, 0xa3])],
};
export const VAULT_EXTS = Object.keys(TYPES);
const extOf = (name) => (/\.([a-z0-9]{1,5})$/i.exec(name)?.[1] || '').toLowerCase();
// shown in the browser (previews) rather than downloaded: images the browser can draw, audio, PDFs
const INLINE = /^(image\/(png|jpeg|gif|webp)|audio\/|application\/pdf)$/;

// → { kind, type } or an error message
function checkFile(name, head) {
  const t = TYPES[extOf(name)];
  if (!t) return { error: 'That file type isn’t allowed — upload PDF, Word, Excel, PowerPoint, text/CSV, images (JPG, PNG, WEBP, GIF, HEIC) or audio (MP3, M4A, WAV, OGG, AAC, WEBM)' };
  if (!head.length || !t[2](head)) return { error: 'This file’s contents don’t match its type — it may be damaged or renamed' };
  return { kind: t[0], type: t[1] };
}

// ---------- storage ----------
const filePath = (userId, id) => path.join(FILE_DIR, userId, id);
const s3Key = (userId, id) => `vault/${userId}/${id}`;
const dropObject = (f) => {
  fs.rmSync(filePath(f.userId, f.id), { force: true });
  if (f.s3) deleteObject(s3Key(f.userId, f.id)).catch((e) => console.error('storage delete failed', e.message));
};
export const vaultUsed = (userId) => q('SELECT COALESCE(SUM(size), 0) AS n FROM vaultFiles WHERE userId = ?').get(userId).n;
const quotaOf = (u) => limitsFor(u).vaultMB * MB;

// the system folder a contact's uploads go to
function crmFolder(userId) {
  const f = q("SELECT data FROM vaultFolders WHERE userId = ? AND json_extract(data, '$.system') = 'crm' LIMIT 1").get(userId);
  if (f) return JSON.parse(f.data);
  return T.vaultFolders.insert({ id: uid(), userId, parentId: null, name: 'CRM uploads', system: 'crm', at: Date.now() });
}

// Streams the raw request body to disk, checks it and moves it to the bucket. → the new file record, or throws {status}
async function receive(req, { folderId, contactKey: ckey }) {
  const userId = req.user.id;
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const name = cleanName(decodeURIComponent(String(req.headers['x-file-name'] || ''))) || 'file';
  if (!TYPES[extOf(name)]) { req.resume(); throw fail(415, checkFile(name, Buffer.alloc(0)).error); }
  const declared = Number(req.headers['content-length'] || 0);
  const used = vaultUsed(userId), quota = quotaOf(req.user);
  const tooBigMsg = `Files can be up to ${VAULT_FILE_MAX / MB} MB`;
  const fullMsg = `Your vault is full (${Math.round(quota / MB)} MB) — delete files you don’t need first`;
  if (declared > VAULT_FILE_MAX) { req.resume(); throw fail(413, tooBigMsg); }
  if (used + declared > quota) { req.resume(); throw fail(413, fullMsg); }
  const id = `${Date.now().toString(36)}${crypto.randomBytes(6).toString('hex')}`;
  fs.mkdirSync(path.join(FILE_DIR, userId), { recursive: true });
  const dest = filePath(userId, id), tmp = `${dest}.part`;
  let size = 0, over = null;
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    req.on('data', (chunk) => {
      size += chunk.length;
      if (!over && (size > VAULT_FILE_MAX || used + size > quota)) { over = size > VAULT_FILE_MAX ? tooBigMsg : fullMsg; req.unpipe(out); out.destroy(); req.resume(); resolve(); }
    });
    req.on('error', reject);
    req.on('aborted', () => reject(new Error('Upload cancelled')));
    req.on('close', () => { if (!req.complete && !over) reject(new Error('Upload cancelled')); });
    out.on('error', reject);
    out.on('finish', resolve);
    req.pipe(out);
  }).catch((e) => { fs.rmSync(tmp, { force: true }); throw e; });
  if (over) { fs.rmSync(tmp, { force: true }); throw fail(413, over); }
  if (!size) { fs.rmSync(tmp, { force: true }); throw fail(400, 'That file is empty'); }
  const head = Buffer.alloc(Math.min(size, 8192));
  const fd = fs.openSync(tmp, 'r');
  try { fs.readSync(fd, head, 0, head.length, 0); } finally { fs.closeSync(fd); }
  const ok = checkFile(name, head);
  if (ok.error) { fs.rmSync(tmp, { force: true }); throw fail(415, ok.error); }
  fs.renameSync(tmp, dest);
  const who = req.actor || req.user;
  const file = { id, userId, folderId: folderId || null, name, ext: extOf(name), kind: ok.kind, type: ok.type, size, by: { name: who.name || who.email || '', email: who.email || '' }, at: Date.now() };
  // with a storage bucket the file moves there (any server can then hand it out); on failure it stays on disk
  if (s3Enabled()) {
    try { await putFile(s3Key(userId, id), dest, ok.type); file.s3 = true; fs.rmSync(dest, { force: true }); } catch (e) { console.error('storage upload failed — kept on disk', e.message); }
  }
  tx(() => {
    T.vaultFiles.insert(file);
    if (ckey) T.vaultLinks.insert({ id: uid(), userId, fileId: id, ckey, at: Date.now() });
  });
  return file;
}

// ---------- contacts ----------
// a contact of this seller (their sign-ups, orders, carts or CRM record)
export const contactExists = (userId, key) => !!key && (T.crm.exists({ userId, key }) || T.leads.exists({ userId, ckey: key }) || T.orders.exists({ userId, ckey: key }) || T.abandoned.exists({ userId, ckey: key }));
function contactName(userId, key) {
  const m = metaFor(userId, key);
  const lead = !m?.name && q("SELECT json_extract(data, '$.name') AS n FROM leads WHERE userId = ? AND ckey = ? AND json_extract(data, '$.name') <> '' LIMIT 1").get(userId, key);
  return m?.name || lead?.n || m?.email || (key.startsWith('phone:') ? key.slice(6) : key);
}

// What the dashboard sees of a file
function views(userId, files) {
  if (!files.length) return [];
  const ids = files.map((f) => f.id);
  const links = T.vaultLinks.all({ userId, fileId: ids });
  const names = new Map();
  const nameOf = (k) => { if (!names.has(k)) names.set(k, contactName(userId, k)); return names.get(k); };
  const now = Date.now();
  const shares = T.vaultShares.all({ userId, fileId: ids }).filter((s) => !s.revoked && s.expiresAt > now);
  return files.map((f) => ({
    id: f.id, name: f.name, ext: f.ext, kind: f.kind, type: f.type, size: f.size, folderId: f.folderId || null, by: f.by?.name || '', at: f.at, updatedAt: f.updatedAt || null,
    preview: INLINE.test(f.type),
    contacts: links.filter((l) => l.fileId === f.id).map((l) => ({ key: l.ckey, name: nameOf(l.ckey) })),
    shares: shares.filter((s) => s.fileId === f.id).map((s) => ({ id: s.id, expiresAt: s.expiresAt, at: s.at })),
  }));
}

function deleteFiles(files) {
  if (!files.length) return 0;
  const ids = files.map((f) => f.id);
  tx(() => {
    for (const f of files) T.vaultFiles.del(f.id);
    T.vaultLinks.delWhere({ fileId: ids });
    T.vaultShares.delWhere({ fileId: ids });
  });
  for (const f of files) dropObject(f);
  return files.length;
}

// A contact erased on request: unlink them everywhere; what was only theirs in "CRM uploads" goes too
export function eraseContactFiles(userId, key) {
  const links = T.vaultLinks.all({ userId, ckey: key });
  if (!links.length) return 0;
  T.vaultLinks.delWhere({ userId, ckey: key });
  const sys = q("SELECT id FROM vaultFolders WHERE userId = ? AND json_extract(data, '$.system') = 'crm'").all(userId).map((r) => r.id);
  const gone = T.vaultFiles.all({ userId, id: [...new Set(links.map((l) => l.fileId))] }).filter((f) => sys.includes(f.folderId) && !T.vaultLinks.exists({ userId, fileId: f.id }));
  return deleteFiles(gone);
}
// the whole account is being deleted (account.js removes the rows)
export const removeVaultFiles = (userId) => fs.rmSync(path.join(FILE_DIR, userId), { recursive: true, force: true });

// ---------- folders ----------
const foldersOf = (userId) => T.vaultFolders.all({ userId }, { order: 'at' });
// a folder and everything below it
function subtree(all, id) {
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const f of all) if (f.parentId === out[i]) out.push(f.id);
  return out;
}
const depthOf = (all, id) => { let d = 0, cur = all.find((f) => f.id === id); while (cur?.parentId && d < 50) { d++; cur = all.find((f) => f.id === cur.parentId); } return d; };

// ---------- secrets ----------
const KINDS = ['password', 'note'];
const httpUrl = (v) => { const s = clip(v, 500); return !s || /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : /^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(s) ? `https://${s}` : null; };
const secretView = (userId, s) => ({ id: s.id, kind: s.kind, title: s.title, username: s.username || '', url: s.url || '', category: s.category || '', contact: s.ckey ? { key: s.ckey, name: contactName(userId, s.ckey) } : null, hasPassword: !!s.passwordEnc, hasNotes: !!s.notesEnc, at: s.at, updatedAt: s.updatedAt || null, revealedAt: s.revealedAt || null });
// owners and admins (and an agency running the account); never an API key or platform support
// (or a custom team role that grants passwords & notes; the auth middleware already held it to view or edit)
const canSecrets = (req) => !req.apiKey && !req.impersonator && (!req.actor || ['admin', 'agency'].includes(req.role) || ['view', 'edit'].includes(req.customPerms?.secrets));

// ---------- routes ----------
export function registerVault(app, { auth, wrap, rateLimit, isTest, secret }) {
  const sig = (s) => crypto.createHmac('sha256', `vault:${secret}`).update(s).digest('base64url').slice(0, 32);
  const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const uploadLimiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 30, key: (req) => req.user.id });
  const revealLimiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 20, key: (req) => req.user.id, message: 'Too many passwords shown in a short time — please wait a minute.' });
  const shareLimiter = rateLimit({ windowMs: 60000, max: isTest ? 5000 : 60 });
  const own = (t, userId, id) => { const r = T[t].get(String(id || '')); return r && r.userId === userId ? r : null; };
  const ownFolder = (userId, id) => own('vaultFolders', userId, id);
  const fileOr404 = (req, res) => { const f = own('vaultFiles', req.user.id, req.params.id); if (!f) res.status(404).json({ error: 'File not found' }); return f; };
  const one = (req, f) => views(req.user.id, [f])[0];

  // a link that works for a few minutes: signed straight to the bucket, or to this server
  const linkFor = (req, f, inline) => {
    const show = inline && INLINE.test(f.type);
    if (f.s3 && !fs.existsSync(filePath(f.userId, f.id))) return presign(s3Key(f.userId, f.id), { expires: LINK_TTL, filename: show ? undefined : f.name });
    const e = Date.now() + LINK_TTL * 1000, i = show ? '1' : '0';
    return `/api/vault/dl/${f.id}?e=${e}&i=${i}&s=${sig(`${f.id}.${e}.${i}`)}`;
  };
  const send = (res, f, inline) => {
    const show = inline && INLINE.test(f.type);
    res.set({
      'Content-Type': f.type || 'application/octet-stream',
      'Content-Disposition': `${show ? 'inline' : 'attachment'}; filename="${f.name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; media-src 'self'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      'Cache-Control': 'private, no-store',
    });
    if (!fs.existsSync(filePath(f.userId, f.id))) {
      if (f.s3) return res.redirect(302, presign(s3Key(f.userId, f.id), { expires: LINK_TTL, filename: show ? undefined : f.name }));
      return res.status(404).type('text').send('File not found');
    }
    res.sendFile(filePath(f.userId, f.id), { acceptRanges: true, headers: {} }, (err) => { if (err && !res.headersSent) res.status(err.status || 500).end(); });
  };

  // ---- overview: folders, usage, what this person may open ----
  app.get('/api/vault', auth, (req, res) => {
    const counts = Object.fromEntries(q('SELECT folderId AS f, COUNT(*) AS n FROM vaultFiles WHERE userId = ? GROUP BY folderId').all(req.user.id).map((r) => [r.f ?? 'root', r.n]));
    crmFolder(req.user.id); // always there, so the CRM's files have a home
    res.json({
      folders: foldersOf(req.user.id).map((f) => ({ id: f.id, name: f.name, parentId: f.parentId || null, system: f.system || null, files: counts[f.id] || 0, at: f.at })),
      rootFiles: counts.root || 0,
      usage: { used: vaultUsed(req.user.id), limit: quotaOf(req.user), files: T.vaultFiles.count({ userId: req.user.id }), fileMax: VAULT_FILE_MAX },
      types: VAULT_EXTS,
      secrets: canSecrets(req) ? { passwords: T.vaultSecrets.count({ userId: req.user.id, kind: 'password' }), notes: T.vaultSecrets.count({ userId: req.user.id, kind: 'note' }) } : null,
    });
  });

  // ---- files ----
  // ?folder=<id>|root (default root) · ?q= searches every folder · ?contact=<key>
  app.get('/api/vault/files', auth, (req, res) => {
    const userId = req.user.id, s = clip(req.query.q, 100).toLowerCase();
    let files;
    if (s) files = q("SELECT data FROM vaultFiles WHERE userId = ? AND instr(lower(json_extract(data, '$.name')), ?) > 0 ORDER BY at DESC LIMIT 500").all(userId, s).map((r) => JSON.parse(r.data));
    else if (req.query.contact) files = T.vaultFiles.all({ userId, id: T.vaultLinks.all({ userId, ckey: keyOf(req.query.contact) }).map((l) => l.fileId) }, { order: 'at', desc: true });
    else {
      const folder = req.query.folder && req.query.folder !== 'root' ? ownFolder(userId, req.query.folder) : null;
      if (req.query.folder && req.query.folder !== 'root' && !folder) return res.status(404).json({ error: 'Folder not found' });
      files = T.vaultFiles.all({ userId, folderId: folder ? folder.id : null }, { order: 'at', desc: true, limit: 2000 });
    }
    res.json(views(userId, files));
  });
  app.post('/api/vault/files', auth, uploadLimiter, wrap(async (req, res) => {
    const fid = String(req.query.folder || '');
    if (fid && fid !== 'root' && !ownFolder(req.user.id, fid)) { req.resume(); return res.status(404).json({ error: 'Folder not found' }); }
    const f = await receive(req, { folderId: fid && fid !== 'root' ? fid : null });
    res.json(one(req, f));
  }));
  app.get('/api/vault/files/:id', auth, (req, res) => { const f = fileOr404(req, res); if (f) res.json(one(req, f)); });
  // rename and/or move
  app.patch('/api/vault/files/:id', auth, (req, res) => {
    const f = fileOr404(req, res);
    if (!f) return;
    const b = req.body || {};
    let name, folderId;
    if ('name' in b) {
      name = cleanName(b.name);
      if (!name) return res.status(400).json({ error: 'Give the file a name' });
      if (extOf(name) !== f.ext) name = `${name.replace(/\.[a-z0-9]{1,5}$/i, '')}.${f.ext}`.slice(0, 200); // the type stays what was checked
    }
    if ('folderId' in b) {
      folderId = b.folderId && b.folderId !== 'root' ? String(b.folderId) : null;
      if (folderId && !ownFolder(req.user.id, folderId)) return res.status(404).json({ error: 'Folder not found' });
    }
    const saved = T.vaultFiles.update(f.id, (x) => { if (name) x.name = name; if (folderId !== undefined) x.folderId = folderId; x.updatedAt = Date.now(); });
    res.json(one(req, saved));
  });
  app.delete('/api/vault/files/:id', auth, (req, res) => {
    const f = fileOr404(req, res);
    if (!f) return;
    deleteFiles([f]);
    res.json({ ok: true });
  });
  // a short-lived link for download (or ?inline=1 for a preview / the audio player)
  app.get('/api/vault/files/:id/link', auth, (req, res) => {
    const f = fileOr404(req, res);
    if (f) res.json({ url: linkFor(req, f, req.query.inline === '1'), expiresIn: LINK_TTL });
  });
  // the file itself, through the signed-in session
  app.get('/api/vault/files/:id/download', auth, (req, res) => { const f = fileOr404(req, res); if (f) send(res, f, req.query.inline === '1'); });
  // what a signed link opens (files kept on this server)
  app.get('/api/vault/dl/:id', shareLimiter, (req, res) => {
    const e = Number(req.query.e), i = req.query.i === '1' ? '1' : '0';
    if (!(e > Date.now()) || !same(sig(`${req.params.id}.${e}.${i}`), String(req.query.s || ''))) return res.status(403).type('text').send('This link has expired — open the file again.');
    const f = T.vaultFiles.get(req.params.id);
    if (!f) return res.status(404).type('text').send('File not found');
    send(res, f, i === '1');
  });

  // ---- linking files to contacts ----
  app.post('/api/vault/files/:id/contacts', auth, (req, res) => {
    const f = fileOr404(req, res);
    if (!f) return;
    const key = keyOf(req.body?.key);
    if (!contactExists(req.user.id, key)) return res.status(404).json({ error: 'Contact not found' });
    if (!T.vaultLinks.exists({ userId: req.user.id, fileId: f.id, ckey: key })) {
      if (T.vaultLinks.count({ userId: req.user.id, fileId: f.id }) >= LINKS_MAX) return res.status(400).json({ error: `A file can be linked to up to ${LINKS_MAX} contacts` });
      T.vaultLinks.insert({ id: uid(), userId: req.user.id, fileId: f.id, ckey: key, at: Date.now() });
      logActivity(req.user.id, key, { type: 'file', title: `File linked: ${f.name}`, text: '', fileId: f.id, by: 'you' });
    }
    res.json(one(req, f));
  });
  app.delete('/api/vault/files/:id/contacts/:key', auth, (req, res) => {
    const f = fileOr404(req, res);
    if (!f) return;
    T.vaultLinks.delWhere({ userId: req.user.id, fileId: f.id, ckey: keyOf(req.params.key) });
    res.json(one(req, f));
  });

  // ---- share links (anyone with the link, for 1 or 7 days) ----
  app.post('/api/vault/files/:id/shares', auth, (req, res) => {
    const f = fileOr404(req, res);
    if (!f) return;
    const days = Number(req.body?.days) === 7 ? 7 : 1;
    if (T.vaultShares.count({ fileId: f.id }) >= 20) return res.status(400).json({ error: 'Revoke an old link first (up to 20 per file)' });
    const token = randomToken();
    const s = T.vaultShares.insert({ id: uid(), userId: req.user.id, fileId: f.id, hash: hashToken(token), expiresAt: Date.now() + days * DAY, at: Date.now() });
    res.json({ id: s.id, url: `${(process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '')}/api/vault-share/${token}`, expiresAt: s.expiresAt });
  });
  app.delete('/api/vault/shares/:sid', auth, (req, res) => {
    const s = own('vaultShares', req.user.id, req.params.sid);
    if (!s) return res.status(404).json({ error: 'Link not found' });
    T.vaultShares.update(s.id, (x) => { x.revoked = true; });
    res.json({ ok: true });
  });
  app.get('/api/vault-share/:token', shareLimiter, (req, res) => {
    const s = T.vaultShares.find({ hash: hashToken(String(req.params.token || '')) });
    const f = s && !s.revoked && s.expiresAt > Date.now() && T.vaultFiles.get(s.fileId);
    if (!f) return res.status(410).type('text').send('This link has expired or was turned off.');
    send(res, f, false);
  });

  // ---- folders ----
  app.post('/api/vault/folders', auth, (req, res) => {
    const userId = req.user.id, name = cleanName(req.body?.name).slice(0, 80);
    if (!name) return res.status(400).json({ error: 'Name the folder' });
    const parentId = req.body?.parentId && req.body.parentId !== 'root' ? String(req.body.parentId) : null;
    const all = foldersOf(userId);
    if (parentId && !all.some((f) => f.id === parentId)) return res.status(404).json({ error: 'Folder not found' });
    if (all.length >= FOLDERS_MAX) return res.status(400).json({ error: `Up to ${FOLDERS_MAX} folders` });
    if (parentId && depthOf(all, parentId) + 1 >= DEPTH_MAX) return res.status(400).json({ error: `Folders can be nested up to ${DEPTH_MAX} levels` });
    const f = T.vaultFolders.insert({ id: uid(), userId, parentId, name, at: Date.now() });
    res.json({ id: f.id, name: f.name, parentId: f.parentId, system: null, files: 0, at: f.at });
  });
  app.patch('/api/vault/folders/:id', auth, (req, res) => {
    const userId = req.user.id, f = ownFolder(userId, req.params.id);
    if (!f) return res.status(404).json({ error: 'Folder not found' });
    if (f.system) return res.status(400).json({ error: 'This folder is managed for you — it can’t be renamed or moved' });
    const b = req.body || {};
    let name, parentId;
    if ('name' in b) { name = cleanName(b.name).slice(0, 80); if (!name) return res.status(400).json({ error: 'Name the folder' }); }
    if ('parentId' in b) {
      parentId = b.parentId && b.parentId !== 'root' ? String(b.parentId) : null;
      const all = foldersOf(userId);
      if (parentId && !all.some((x) => x.id === parentId)) return res.status(404).json({ error: 'Folder not found' });
      if (parentId && subtree(all, f.id).includes(parentId)) return res.status(400).json({ error: 'A folder can’t go inside itself' });
      const below = Math.max(...subtree(all, f.id).map((id) => depthOf(all, id) - depthOf(all, f.id)));
      if (parentId && depthOf(all, parentId) + 1 + below >= DEPTH_MAX) return res.status(400).json({ error: `Folders can be nested up to ${DEPTH_MAX} levels` });
    }
    const saved = T.vaultFolders.update(f.id, (x) => { if (name) x.name = name; if (parentId !== undefined) x.parentId = parentId; x.updatedAt = Date.now(); });
    res.json({ id: saved.id, name: saved.name, parentId: saved.parentId || null, system: null, at: saved.at });
  });
  // a folder, its subfolders and every file in them
  app.delete('/api/vault/folders/:id', auth, (req, res) => {
    const userId = req.user.id, f = ownFolder(userId, req.params.id);
    if (!f) return res.status(404).json({ error: 'Folder not found' });
    if (f.system) return res.status(400).json({ error: 'This folder is managed for you — move or delete its files instead' });
    const ids = subtree(foldersOf(userId), f.id);
    const files = deleteFiles(T.vaultFiles.all({ userId, folderId: ids }));
    T.vaultFolders.delWhere({ userId, id: ids });
    res.json({ ok: true, folders: ids.length, files });
  });

  // ---- a contact's Files tab: the same files ----
  app.get('/api/contacts/:key/files', auth, (req, res) => {
    const key = keyOf(req.params.key);
    if (!contactExists(req.user.id, key)) return res.status(404).json({ error: 'Contact not found' });
    const ids = T.vaultLinks.all({ userId: req.user.id, ckey: key }).map((l) => l.fileId);
    res.json({ files: views(req.user.id, T.vaultFiles.all({ userId: req.user.id, id: ids }, { order: 'at', desc: true })), usage: { used: vaultUsed(req.user.id), limit: quotaOf(req.user), fileMax: VAULT_FILE_MAX }, types: VAULT_EXTS });
  });
  app.post('/api/contacts/:key/files', auth, uploadLimiter, wrap(async (req, res) => {
    const key = keyOf(req.params.key);
    if (!contactExists(req.user.id, key)) { req.resume(); return res.status(404).json({ error: 'Contact not found' }); }
    const f = await receive(req, { folderId: crmFolder(req.user.id).id, contactKey: key });
    logActivity(req.user.id, key, { type: 'file', title: `File added: ${f.name}`, text: '', fileId: f.id, by: (req.actor || req.user).name || 'you' });
    res.json(one(req, f));
  }));

  // ---- passwords and secure notes ----
  const secretsOnly = (req, res, next) => (canSecrets(req) ? next() : res.status(403).json({ error: req.impersonator ? 'Platform support can’t open saved passwords' : 'Only the account owner and admins can open saved passwords and notes' }));
  const secretOr404 = (req, res) => { const s = own('vaultSecrets', req.user.id, req.params.id); if (!s) res.status(404).json({ error: 'Not found' }); return s; };
  // → the fields to save, or { error }
  const fields = (b, cur) => {
    const out = {};
    if ('title' in b || !cur) { out.title = clip(b.title, 120); if (!out.title) return { error: 'Give it a title' }; }
    if ('username' in b) out.username = clip(b.username, 200);
    if ('url' in b) { out.url = httpUrl(b.url); if (out.url == null) return { error: 'The website must start with http:// or https://' }; }
    if ('category' in b) out.category = clip(b.category, 60);
    if ('password' in b) { const p = String(b.password ?? '').slice(0, 500); out.passwordEnc = p ? encrypt(p) : ''; }
    if ('notes' in b) { const n = String(b.notes ?? '').slice(0, 20000); out.notesEnc = n ? encrypt(n) : ''; }
    return out;
  };
  const contactOf = (req, b) => {
    if (!('contact' in b)) return undefined;
    const key = keyOf(b.contact);
    if (!key) return null;
    return contactExists(req.user.id, key) ? key : false;
  };
  app.get('/api/vault/secrets', auth, secretsOnly, (req, res) => {
    const kind = KINDS.includes(req.query.kind) ? req.query.kind : undefined;
    res.json(T.vaultSecrets.all({ userId: req.user.id, kind }, { order: 'at', desc: true, limit: 5000 }).map((s) => secretView(req.user.id, s)));
  });
  app.post('/api/vault/secrets', auth, secretsOnly, (req, res) => {
    const b = req.body || {}, kind = KINDS.includes(b.kind) ? b.kind : 'password';
    if (T.vaultSecrets.count({ userId: req.user.id }) >= 5000) return res.status(400).json({ error: 'Up to 5,000 entries' });
    const f = fields(b, null);
    if (f.error) return res.status(400).json(f);
    const ckey = contactOf(req, b);
    if (ckey === false) return res.status(404).json({ error: 'Contact not found' });
    const s = T.vaultSecrets.insert({ id: uid(), userId: req.user.id, kind, ...f, ...(ckey ? { ckey } : {}), at: Date.now() });
    res.json(secretView(req.user.id, s));
  });
  app.patch('/api/vault/secrets/:id', auth, secretsOnly, (req, res) => {
    const s = secretOr404(req, res);
    if (!s) return;
    const b = req.body || {}, f = fields(b, s);
    if (f.error) return res.status(400).json(f);
    const ckey = contactOf(req, b);
    if (ckey === false) return res.status(404).json({ error: 'Contact not found' });
    const saved = T.vaultSecrets.update(s.id, (x) => { Object.assign(x, f); if (ckey !== undefined) { if (ckey) x.ckey = ckey; else delete x.ckey; } x.updatedAt = Date.now(); });
    res.json(secretView(req.user.id, saved));
  });
  app.delete('/api/vault/secrets/:id', auth, secretsOnly, (req, res) => {
    const s = secretOr404(req, res);
    if (!s) return;
    T.vaultSecrets.del(s.id);
    res.json({ ok: true });
  });
  // the only way a password or note leaves the server: one entry at a time, counted, in the activity log
  app.post('/api/vault/secrets/:id/reveal', auth, secretsOnly, revealLimiter, (req, res) => {
    const s = secretOr404(req, res);
    if (!s) return;
    T.vaultSecrets.update(s.id, (x) => { x.revealedAt = Date.now(); x.reveals = (x.reveals || 0) + 1; });
    res.set('Cache-Control', 'no-store').json({ id: s.id, password: decrypt(s.passwordEnc), notes: decrypt(s.notesEnc) });
  });
}
