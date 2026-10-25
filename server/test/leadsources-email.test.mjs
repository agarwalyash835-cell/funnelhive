// Forwarded portal emails (99acres, MagicBricks, Sulekha…): the lead inbox takes mail only for real lead
// addresses, reads the buyer out of the email (never the seller or the portal), recognises the portal, passes
// Gmail's forwarding code to the seller, and skips the same email twice. Real SMTP on a local port; AI off.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-leadmail-'));
process.env.NODE_ENV = 'test';
process.env.INBOUND_EMAIL_DOMAIN = 'in.test.dev';
let DB, L, owner, addr, smtp, port, nodemailer;
before(async () => {
  DB = await import('../db.js'); await import('../sales.js');
  L = await import('../leadsources.js');
  nodemailer = (await import('nodemailer')).default;
  owner = DB.T.users.insert({ id: DB.uid(), email: 'seller@realty.in', name: 'Seller', settings: { supportWhatsapp: '+91 98200 00000' } });
  const ls = L.addressesFor(owner.id);
  addr = `leads-${ls.emailId}@in.test.dev`;
  port = await new Promise((r) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
  smtp = await L.startMailReceiver(port);
});
after(() => smtp?.close());
const send = (msg) => nodemailer.createTransport({ host: '127.0.0.1', port, secure: false, ignoreTLS: true }).sendMail({ from: 'alerts@99acres.com', to: addr, ...msg });
const contact = (key) => DB.T.crm.find({ userId: owner.id, key });

test('a 99acres enquiry forwarded by email becomes a lead — the buyer, not the seller', async () => {
  await send({
    subject: 'You have received a response on your property',
    text: 'Dear Seller,\n\nA buyer has shown interest in your property.\n\nName: Rohit Verma\nMobile: +91 98765 43210\nEmail: rohit.v@example.com\nProperty: 2 BHK in Wakad, Pune\nCity: Pune\n\nContact the seller at seller@realty.in or +91 98200 00000.\n\nRegards, 99acres',
    messageId: '<msg-1@99acres.com>',
  });
  const m = contact('rohit.v@example.com');
  assert.ok(m, 'a contact by the buyer’s email');
  assert.equal(m.name, 'Rohit Verma');
  assert.equal(m.phone, '9876543210');
  assert.ok(m.tags.includes('99acres'));
  assert.match(JSON.stringify(m.activities), /2 BHK in Wakad/);
  assert.equal(m.source, 'lead:99acres');
  assert.ok(!contact('seller@realty.in'), 'never the seller');
});

test('the same email twice counts once; MagicBricks and Sulekha are recognised; HTML-only mail works', async () => {
  await send({ subject: 'again', text: 'Name: Rohit Verma\nMobile: 9876543210', messageId: '<msg-1@99acres.com>' });
  assert.equal(JSON.stringify(contact('rohit.v@example.com').activities).match(/New enquiry from 99acres/g).length, 1);
  await send({ from: 'leads@magicbricks.com', subject: 'New lead', html: '<table><tr><td>Name: Sneha Kulkarni</td></tr><tr><td>Mobile: 9822012345</td></tr><tr><td>Project: Skyline Heights</td></tr></table>', messageId: '<mb-1@magicbricks.com>' });
  assert.ok(contact('phone:9822012345').tags.includes('MagicBricks'));
  await send({ from: 'noreply@sulekha.com', subject: 'Sulekha: new requirement', text: 'Customer Name: Farhan Ali\nPhone: 9900112233\nLooking for: Home painting', messageId: '<s-1@sulekha.com>' });
  assert.ok(contact('phone:9900112233').tags.includes('Sulekha'));
});

test('Gmail’s forwarding confirmation reaches the seller as a code, and is not a lead', async () => {
  await send({ from: 'Gmail Team <forwarding-noreply@google.com>', subject: '(#123456789) Gmail Forwarding Confirmation', text: 'seller@gmail.com has requested to automatically forward mail.\nConfirmation code: 123456789\nTo allow, click: https://mail-settings.google.com/mail/vf-%5BANGjdJ%5D-abc', messageId: '<g-1@google.com>' });
  const u = DB.T.users.get(owner.id);
  assert.equal(u.leadSources.gmailCode, '123456789');
  assert.match(u.leadSources.gmailLink, /^https:\/\/mail-settings\.google\.com\//);
  assert.match(JSON.stringify(DB.T.notifications.all({ userId: owner.id })), /Gmail forwarding: confirm with code 123456789/);
});

test('mail for anyone else is refused (never an open relay)', async () => {
  await assert.rejects(send({ to: 'leads-0000000000@in.test.dev', text: 'Name: X\nMobile: 9876500000' }), /550|No such mailbox|recipients/i);
  await assert.rejects(send({ to: 'someone@gmail.com', text: 'hi' }), /550|No such mailbox|recipients/i);
});
