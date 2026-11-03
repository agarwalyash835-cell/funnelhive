// The website chat's settings and its signed public key (webchat.js has the routes). Kept apart, with nothing but
// db.js, so the store and live pages can add the chat bubble (webchatTag) without importing the inbox.
import crypto from 'node:crypto';
import { T } from './db.js';

export const COLOR = /^#[0-9a-f]{6}$/i;
export const ASK = ['off', 'optional', 'required'];
export function webchatOf(u) {
  const w = u?.webchat || {};
  return {
    on: !!w.on, title: w.title || '', greeting: w.greeting || '', color: COLOR.test(w.color) ? w.color : '#4f46e5', position: w.position === 'left' ? 'left' : 'right',
    ask: ASK.includes(w.ask) ? w.ask : 'optional', whatsapp: w.whatsapp !== false, pages: w.pages !== false, sites: Array.isArray(w.sites) ? w.sites : [], ver: w.ver || 0,
  };
}
// the public key: the seller's id, signed (and versioned, so "reset" stops an old snippet)
let SECRET = '';
export const setWebchatSecret = (s) => { SECRET = s; };
const sig = (id, ver) => crypto.createHmac('sha256', SECRET).update(`webchat:${id}:${ver}`).digest('base64url').slice(0, 16);
export const webchatKey = (u) => `${u.id}.${sig(u.id, webchatOf(u).ver)}`;
export function sellerOf(key) {
  const [id, s] = String(key || '').split('.');
  const u = SECRET && id && /^[\w-]{1,40}$/.test(id) ? T.users.get(id) : null;
  if (!u || !s || s.length !== 16 || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(sig(u.id, webchatOf(u).ver)))) return null;
  return u;
}
// the widget on the seller's own FunnelHive pages and store (index.js renderFunnel, store.js) when they chose it
export const webchatTag = (u) => { const w = webchatOf(u); return u && w.on && w.pages && SECRET ? `<script src="/wc.js" data-key="${webchatKey(u)}" async></script>` : ''; };
