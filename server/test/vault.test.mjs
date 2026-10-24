// The vault: files in folders (also a CRM contact's Files tab — one store), type and size checks, contact links,
// share links, passwords and secure notes encrypted at rest and shown only through the reveal route, and one
// seller never reaching another's vault.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, register } from './helpers.mjs';

let srv, api, A, B, base;
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('1 0 obj << >> endobj\n%%EOF\n')]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64, 1)]);
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]);

// a raw upload, the way the dashboard sends it
const upload = async (p, name, body, token) => {
  const r = await fetch(`${base}/api${p}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name) }, body });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const raw = (sqlText, ...args) => {
  const db = new DatabaseSync(path.join(srv.dataDir, 'funnelhive.db'));
  try { return db.prepare(sqlText).all(...args); } finally { db.close(); }
};

before(async () => {
  srv = await startServer();
  ({ api, base } = srv);
  A = await register(api);
  B = await register(api);
  await api('/contacts', 'POST', { email: 'asha@example.in', name: 'Asha Rao' }, A.token);
  await api('/contacts', 'POST', { email: 'ravi@example.in', name: 'Ravi K' }, A.token);
});
after(() => srv.stop());

test('upload, list, download, rename and delete a file', async () => {
  const up = await upload('/vault/files', 'Brochure.pdf', PDF, A.token);
  assert.equal(up.status, 200, JSON.stringify(up.data));
  assert.equal(up.data.kind, 'pdf');
  assert.equal(up.data.type, 'application/pdf');
  assert.equal(up.data.size, PDF.length);
  const list = (await api('/vault/files', 'GET', null, A.token)).data;
  assert.ok(list.some((f) => f.id === up.data.id && f.name === 'Brochure.pdf'));
  // download through the session, and through the short-lived link
  const dl = await fetch(`${base}/api/vault/files/${up.data.id}/download`, { headers: { authorization: `Bearer ${A.token}` } });
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition'), /attachment/);
  assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await dl.arrayBuffer()), PDF);
  const link = (await api(`/vault/files/${up.data.id}/link`, 'GET', null, A.token)).data;
  const viaLink = await fetch(base + link.url);
  assert.equal(viaLink.status, 200);
  assert.deepEqual(Buffer.from(await viaLink.arrayBuffer()), PDF);
  assert.equal((await fetch(base + link.url.replace(/s=[^&]+/, 's=forged'))).status, 403, 'a tampered link fails');
  // rename keeps the checked extension
  const ren = await api(`/vault/files/${up.data.id}`, 'PATCH', { name: 'Price list.exe' }, A.token);
  assert.equal(ren.status, 200);
  assert.equal(ren.data.name, 'Price list.pdf');
  // delete
  assert.equal((await api(`/vault/files/${up.data.id}`, 'DELETE', null, A.token)).status, 200);
  assert.equal((await api(`/vault/files/${up.data.id}`, 'GET', null, A.token)).status, 404);
  assert.equal((await fetch(base + link.url)).status, 404, 'the old link stops working');
});

test('files over 15 MB and disallowed or disguised files are refused', async () => {
  const big = Buffer.concat([PDF, Buffer.alloc(15 * 1024 * 1024)]);
  const r = await upload('/vault/files', 'huge.pdf', big, A.token);
  assert.equal(r.status, 413);
  assert.match(r.data.error, /15 MB/);
  const exe = await upload('/vault/files', 'setup.exe', EXE, A.token);
  assert.equal(exe.status, 415);
  const disguised = await upload('/vault/files', 'invoice.pdf', EXE, A.token);
  assert.equal(disguised.status, 415, 'bytes that don’t match the extension');
  assert.match(disguised.data.error, /don’t match/);
  const svg = await upload('/vault/files', 'logo.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), A.token);
  assert.equal(svg.status, 415);
  assert.equal((await upload('/vault/files', 'empty.pdf', Buffer.alloc(0), A.token)).status, 400);
  // images and audio pass, with their real types
  assert.equal((await upload('/vault/files', 'photo.png', PNG, A.token)).data.type, 'image/png');
  assert.equal((await upload('/vault/files', 'call.mp3', MP3, A.token)).data.kind, 'audio');
  // no stray files are left in the vault from refused uploads
  assert.equal(raw("SELECT COUNT(*) AS n FROM vaultFiles WHERE json_extract(data, '$.name') IN ('huge.pdf', 'setup.exe', 'invoice.pdf')")[0].n, 0);
});

test('folders and subfolders: create, move, rename, upload into, delete with everything inside', async () => {
  const top = (await api('/vault/folders', 'POST', { name: 'Clients' }, A.token)).data;
  const sub = (await api('/vault/folders', 'POST', { name: 'Contracts', parentId: top.id }, A.token)).data;
  const other = (await api('/vault/folders', 'POST', { name: 'Archive' }, A.token)).data;
  assert.equal(sub.parentId, top.id);
  const f = (await upload(`/vault/files?folder=${sub.id}`, 'deal.pdf', PDF, A.token)).data;
  assert.equal(f.folderId, sub.id);
  assert.deepEqual((await api(`/vault/files?folder=${sub.id}`, 'GET', null, A.token)).data.map((x) => x.id), [f.id]);
  // search finds it from anywhere
  assert.ok((await api('/vault/files?q=DEAL', 'GET', null, A.token)).data.some((x) => x.id === f.id));
  // a folder can't go inside itself (or its own subfolder)
  assert.equal((await api(`/vault/folders/${top.id}`, 'PATCH', { parentId: sub.id }, A.token)).status, 400);
  assert.equal((await api(`/vault/folders/${sub.id}`, 'PATCH', { parentId: other.id, name: 'Signed contracts' }, A.token)).data.parentId, other.id);
  // move the file to the root and back
  assert.equal((await api(`/vault/files/${f.id}`, 'PATCH', { folderId: 'root' }, A.token)).data.folderId, null);
  assert.equal((await api(`/vault/files/${f.id}`, 'PATCH', { folderId: sub.id }, A.token)).data.folderId, sub.id);
  const ov = (await api('/vault', 'GET', null, A.token)).data;
  assert.equal(ov.folders.find((x) => x.id === sub.id).name, 'Signed contracts');
  assert.ok(ov.folders.some((x) => x.system === 'crm'), 'the CRM uploads folder is there');
  assert.ok(ov.usage.limit > 0 && ov.usage.used > 0);
  // deleting Archive takes its subfolder and the file with it
  const del = await api(`/vault/folders/${other.id}`, 'DELETE', null, A.token);
  assert.deepEqual([del.data.folders, del.data.files], [2, 1]);
  assert.equal((await api(`/vault/files/${f.id}`, 'GET', null, A.token)).status, 404);
  // the CRM folder is managed: not renamed or deleted
  const crm = ov.folders.find((x) => x.system === 'crm');
  assert.equal((await api(`/vault/folders/${crm.id}`, 'DELETE', null, A.token)).status, 400);
  assert.equal((await api(`/vault/folders/${crm.id}`, 'PATCH', { name: 'x' }, A.token)).status, 400);
});

test('contacts: a CRM upload is a vault file, a vault file linked to a contact shows on them, erase unlinks', async () => {
  // uploaded on the contact → in the vault (CRM uploads), linked, on the timeline
  const c = await upload('/contacts/asha%40example.in/files', 'Prescription.png', PNG, A.token);
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const ov = (await api('/vault', 'GET', null, A.token)).data;
  assert.equal(c.data.folderId, ov.folders.find((x) => x.system === 'crm').id);
  assert.deepEqual(c.data.contacts.map((x) => x.name), ['Asha Rao']);
  assert.ok((await api(`/vault/files?folder=${c.data.folderId}`, 'GET', null, A.token)).data.some((x) => x.id === c.data.id));
  const contact = (await api('/contacts/asha%40example.in', 'GET', null, A.token)).data;
  assert.ok(contact.timeline.some((t) => t.title === 'File added: Prescription.png'));
  // a vault file linked to Ravi appears in Ravi's Files tab
  const v = (await upload('/vault/files', 'Agreement.pdf', PDF, A.token)).data;
  assert.equal((await api('/contacts/ravi%40example.in/files', 'GET', null, A.token)).data.files.length, 0);
  const linked = await api(`/vault/files/${v.id}/contacts`, 'POST', { key: 'ravi@example.in' }, A.token);
  assert.equal(linked.status, 200);
  assert.deepEqual((await api('/contacts/ravi%40example.in/files', 'GET', null, A.token)).data.files.map((x) => x.id), [v.id]);
  assert.equal((await api(`/vault/files/${v.id}/contacts`, 'POST', { key: 'nobody@example.in' }, A.token)).status, 404);
  // also link the Asha upload to Ravi, then erase Asha: her CRM-only file goes, the shared one stays for Ravi
  const asha2 = (await upload('/contacts/asha%40example.in/files', 'Report.pdf', PDF, A.token)).data;
  await api(`/vault/files/${asha2.id}/contacts`, 'POST', { key: 'ravi@example.in' }, A.token);
  await api(`/vault/files/${v.id}/contacts`, 'POST', { key: 'asha@example.in' }, A.token);
  const er = await api('/contacts/asha%40example.in', 'DELETE', null, A.token);
  assert.equal(er.status, 200);
  assert.equal(er.data.erased.vaultFiles, 1);
  assert.equal((await api(`/vault/files/${c.data.id}`, 'GET', null, A.token)).status, 404, 'her own upload is gone');
  assert.deepEqual((await api(`/vault/files/${asha2.id}`, 'GET', null, A.token)).data.contacts.map((x) => x.key), ['ravi@example.in']);
  assert.deepEqual((await api(`/vault/files/${v.id}`, 'GET', null, A.token)).data.contacts.map((x) => x.key), ['ravi@example.in'], 'a filed document stays, unlinked from her');
});

test('share links open the file for a while and can be revoked', async () => {
  const f = (await upload('/vault/files', 'menu.pdf', PDF, A.token)).data;
  const s = (await api(`/vault/files/${f.id}/shares`, 'POST', { days: 7 }, A.token)).data;
  assert.ok(s.expiresAt > Date.now() + 6 * 86400000);
  const u = new URL(s.url);
  assert.equal((await fetch(base + u.pathname)).status, 200);
  assert.equal((await api(`/vault/shares/${s.id}`, 'DELETE', null, B.token)).status, 404, 'not someone else’s to revoke');
  assert.equal((await api(`/vault/shares/${s.id}`, 'DELETE', null, A.token)).status, 200);
  assert.equal((await fetch(base + u.pathname)).status, 410);
});

test('passwords and secure notes: encrypted at rest, never listed, shown only by reveal', async () => {
  const pw = 'Tr0ub4dor&3-horse-battery';
  const s = await api('/vault/secrets', 'POST', { kind: 'password', title: 'Razorpay dashboard', username: 'owner@shop.in', password: pw, url: 'dashboard.razorpay.com', notes: 'backup codes 1234-5678', contact: 'ravi@example.in' }, A.token);
  assert.equal(s.status, 200, JSON.stringify(s.data));
  assert.equal(s.data.url, 'https://dashboard.razorpay.com');
  assert.equal(s.data.contact.name, 'Ravi K');
  const note = await api('/vault/secrets', 'POST', { kind: 'note', title: 'Bank details', notes: 'IFSC HDFC0001234 account 50100012345678' }, A.token);
  assert.equal(note.status, 200);
  // at rest: no plaintext anywhere in the rows
  const rows = raw('SELECT data FROM vaultSecrets').map((r) => r.data).join('\n');
  assert.ok(!rows.includes(pw) && !rows.includes('backup codes') && !rows.includes('50100012345678'));
  assert.match(rows, /"passwordEnc":"v1:/);
  // lists carry no secrets
  const list = await api('/vault/secrets', 'GET', null, A.token);
  const txt = JSON.stringify(list.data);
  assert.ok(!txt.includes(pw) && !txt.includes('50100012345678') && !txt.includes('Enc'));
  assert.equal(list.data.find((x) => x.id === s.data.id).hasPassword, true);
  // reveal
  const r = await api(`/vault/secrets/${s.data.id}/reveal`, 'POST', {}, A.token);
  assert.deepEqual([r.data.password, r.data.notes], [pw, 'backup codes 1234-5678']);
  assert.equal((await api(`/vault/secrets/${note.data.id}/reveal`, 'POST', {}, A.token)).data.notes, 'IFSC HDFC0001234 account 50100012345678');
  // the reveal is in the activity log
  const act = raw("SELECT data FROM activity WHERE json_extract(data, '$.path') LIKE '/api/vault/secrets/%/reveal'");
  assert.ok(act.length >= 2);
  // edit: a new password replaces the old, the title alone leaves it
  await api(`/vault/secrets/${s.data.id}`, 'PATCH', { title: 'Razorpay' }, A.token);
  assert.equal((await api(`/vault/secrets/${s.data.id}/reveal`, 'POST', {}, A.token)).data.password, pw);
  await api(`/vault/secrets/${s.data.id}`, 'PATCH', { password: 'new-one-99' }, A.token);
  assert.equal((await api(`/vault/secrets/${s.data.id}/reveal`, 'POST', {}, A.token)).data.password, 'new-one-99');
  assert.equal((await api(`/vault/secrets/${s.data.id}`, 'DELETE', null, A.token)).status, 200);
  assert.equal((await api(`/vault/secrets/${s.data.id}/reveal`, 'POST', {}, A.token)).status, 404);
});

test('a team member who isn’t an admin can use files but not passwords', async () => {
  const sec = (await api('/vault/secrets', 'POST', { title: 'Wi-Fi', password: 'chai-1234' }, A.token)).data;
  const join = async (role) => {
    const me = await register(api);
    const inv = (await api('/team/invite', 'POST', { email: me.email, role }, A.token)).data;
    return (await api('/team/accept', 'POST', { token: inv.token }, me.token)).data.token;
  };
  const sales = await join('sales');
  assert.equal((await api('/vault/secrets', 'GET', null, sales)).status, 403);
  assert.equal((await api(`/vault/secrets/${sec.id}/reveal`, 'POST', {}, sales)).status, 403);
  assert.equal((await upload('/contacts/ravi%40example.in/files', 'notes.txt', Buffer.from('called, follow up Friday'), sales)).status, 200);
  const admin = await join('admin');
  assert.equal((await api(`/vault/secrets/${sec.id}/reveal`, 'POST', {}, admin)).data.password, 'chai-1234');
  const viewer = await join('viewer');
  assert.equal((await api('/vault', 'GET', null, viewer)).status, 403);
});

test('another seller gets 404 for everything', async () => {
  const f = (await upload('/vault/files', 'private.pdf', PDF, A.token)).data;
  const folder = (await api('/vault/folders', 'POST', { name: 'Mine' }, A.token)).data;
  const sec = (await api('/vault/secrets', 'POST', { title: 'Mine', password: 'x' }, A.token)).data;
  const T = B.token;
  for (const [p, m, b] of [[`/vault/files/${f.id}`, 'GET'], [`/vault/files/${f.id}`, 'PATCH', { name: 'x' }], [`/vault/files/${f.id}`, 'DELETE'], [`/vault/files/${f.id}/link`, 'GET'], [`/vault/files/${f.id}/download`, 'GET'],
    [`/vault/files/${f.id}/contacts`, 'POST', { key: 'ravi@example.in' }], [`/vault/files/${f.id}/shares`, 'POST', { days: 1 }], [`/vault/files?folder=${folder.id}`, 'GET'],
    [`/vault/folders/${folder.id}`, 'PATCH', { name: 'x' }], [`/vault/folders/${folder.id}`, 'DELETE'], ['/vault/folders', 'POST', { name: 'x', parentId: folder.id }],
    [`/vault/secrets/${sec.id}`, 'PATCH', { title: 'x' }], [`/vault/secrets/${sec.id}`, 'DELETE'], [`/vault/secrets/${sec.id}/reveal`, 'POST', {}],
    ['/contacts/ravi%40example.in/files', 'GET']]) {
    assert.equal((await api(p, m, b, T)).status, 404, `${m} ${p}`);
  }
  assert.equal((await upload(`/vault/files?folder=${folder.id}`, 'x.pdf', PDF, T)).status, 404);
  assert.equal((await upload('/contacts/ravi%40example.in/files', 'x.pdf', PDF, T)).status, 404);
  // B's own lists are empty of A's things
  assert.ok(!(await api('/vault/files?q=private', 'GET', null, T)).data.length);
  assert.ok(!(await api('/vault/secrets', 'GET', null, T)).data.length);
  // and A's file is untouched
  assert.equal((await api(`/vault/files/${f.id}`, 'GET', null, A.token)).data.name, 'private.pdf');
});
