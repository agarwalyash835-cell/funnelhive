// Website chat: the WhatsApp AI agent (and chatbots, and the team) on the seller's own website, as a chat bubble.
// The seller pastes one line on any site — <script src="https://app…/wc.js" data-key="…" async></script> — or turns it
// on for their FunnelHive pages. A visitor's chat is a normal inbox conversation marked Website (wainbox.js webInbound):
// the same AI agent, knowledge, chatbots, hand-over, labels and team replies; replies wait for the chat window to fetch
// them (it asks every few seconds while open).
//   GET  /wc.js                                  the widget (one script for every seller; it reads data-key)
//   GET  /api/public/webchat/:key/config                what the window shows (title, greeting, colour, form, WhatsApp link)
//   POST /api/public/webchat/:key/hello                 → { visitor } a new chat's id (a long random string, kept by the browser)
//   POST /api/public/webchat/:key/send                  { visitor, text, iid?, name?, email?, phone?, page? }
//   GET  /api/public/webchat/:key/messages?visitor&since → { messages, busy, human }
//   GET|PUT /api/webchat (signed in)             the seller's settings, the snippet; PUT { reset: true } → a new key
// The public routes answer any website (Access-Control-Allow-Origin: *) unless the seller listed their sites; requests
// are "simple" (GET, and POST as text/plain) so no preflight is needed. The key is signed, so a made-up one opens nothing.
import crypto from 'node:crypto';
import { COLOR, ASK, webchatOf, webchatKey, sellerOf, setWebchatSecret } from './webchat-key.js';
import express from 'express';
import { T, hit } from './db.js';
import { webInbound, webMessages, agentOf } from './wainbox.js';
import { waLive } from './hive-wa.js';
import { aiEnabled } from './ai.js';

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const VISITOR = /^[A-Za-z0-9_-]{32}$/;
const DAY_CAP = Number(process.env.WEBCHAT_DAY_CAP || 3000); // visitor messages a day per seller (spam can't run up AI credits)

const hostOf = (v) => { try { return new URL(v).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const cleanSites = (list) => [...new Set((Array.isArray(list) ? list : String(list || '').split(/[\s,]+/)).map((s) => hostOf(/^https?:\/\//.test(s) ? s : `https://${s}`)).filter((h) => h && h.includes('.')))].slice(0, 20);

export function cleanWebchat(b = {}, cur = {}) {
  const out = { ...cur };
  if ('on' in b) out.on = !!b.on;
  if ('title' in b) out.title = clip(b.title, 60);
  if ('greeting' in b) out.greeting = clip(b.greeting, 300);
  if ('color' in b) out.color = COLOR.test(b.color) ? b.color : '#4f46e5';
  if ('position' in b) out.position = b.position === 'left' ? 'left' : 'right';
  if ('ask' in b) out.ask = ASK.includes(b.ask) ? b.ask : 'optional';
  if ('whatsapp' in b) out.whatsapp = !!b.whatsapp;
  if ('pages' in b) out.pages = !!b.pages;
  if ('sites' in b) out.sites = cleanSites(b.sites);
  if (b.reset) out.ver = (cur.ver || 0) + 1;
  return out;
}
// what the chat window shows
export function publicConfig(u) {
  const w = webchatOf(u), a = agentOf(u), wa = waLive(u);
  const num = String(wa?.from || wa?.display || '').replace(/\D/g, '');
  const biz = u.settings?.businessName || u.name || '';
  return {
    on: w.on, title: w.title || biz || 'Chat with us', subtitle: a.on && aiEnabled() ? `${a.name} usually replies in seconds` : 'We usually reply within a few hours',
    greeting: w.greeting || a.welcome || `Hi! 👋 How can we help you today?`, color: w.color, position: w.position, ask: w.ask,
    whatsapp: w.whatsapp && num.length >= 10 ? `https://wa.me/${num}` : '', business: biz,
  };
}
const allowed = (u, req) => {
  const sites = webchatOf(u).sites;
  if (!sites.length) return true;
  const h = hostOf(req.headers.origin || req.headers.referer || '');
  // the seller's FunnelHive pages and store (served from this host) always may
  return !!h && (h === String(req.hostname || '').toLowerCase().replace(/^www\./, '') || sites.some((s) => h === s || h.endsWith(`.${s}`)));
};
export function registerWebchat(app, { auth, rateLimit, isTest, secret, appUrl }) {
  setWebchatSecret(secret);
  const pub = (req, res, next) => { res.set('Access-Control-Allow-Origin', '*'); res.set('Cache-Control', 'no-store'); next(); };
  const seller = (req, res) => {
    const u = sellerOf(req.params.key);
    if (!u || !webchatOf(u).on) { res.status(404).json({ error: 'This chat isn’t available' }); return null; }
    if (!allowed(u, req)) { res.status(403).json({ error: 'This chat isn’t switched on for this website' }); return null; }
    return u;
  };
  const body = (req) => { if (req.body && typeof req.body === 'object') return req.body; try { return JSON.parse(req.body || '{}'); } catch { return {}; } };
  const text = express.text({ type: ['text/plain', 'application/json'], limit: '16kb' });
  const perIp = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 60, key: (req) => `wc:${req.ip}`, message: 'Too many messages — please wait a moment.' });
  const perVisitor = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 15, key: (req) => `wcv:${body(req).visitor || req.ip}`, message: 'You’re typing fast — please wait a moment.' });

  // the widget: plain JavaScript, the same for every seller (it reads data-key from its own script tag)
  app.get('/wc.js', (req, res) => { res.set('Access-Control-Allow-Origin', '*'); res.type('application/javascript').set('Cache-Control', isTest ? 'no-store' : 'public, max-age=3600').send(WIDGET); });
  app.options('/api/public/webchat/:key/*', (req, res) => { res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type' }).sendStatus(204); });
  app.get('/api/public/webchat/:key/config', pub, (req, res) => { const u = seller(req, res); if (u) res.json(publicConfig(u)); });
  app.post('/api/public/webchat/:key/hello', pub, perIp, (req, res) => { const u = seller(req, res); if (u) res.json({ visitor: crypto.randomBytes(24).toString('base64url') }); });
  app.post('/api/public/webchat/:key/send', pub, text, perIp, perVisitor, async (req, res) => {
    const u = seller(req, res); if (!u) return;
    const b = body(req), w = webchatOf(u);
    if (!VISITOR.test(String(b.visitor || ''))) return res.status(400).json({ error: 'Start the chat again' });
    const msg = clip(b.text, 1000);
    if (!msg && !b.iid) return res.status(400).json({ error: 'Write a message' });
    const first = !T.waconvs.exists({ userId: u.id, num: `w${b.visitor}` });
    if (first && w.ask === 'required' && !(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(b.email || '') || String(b.phone || '').replace(/\D/g, '').length >= 10)) return res.status(400).json({ error: 'Please share your phone or email so we can reply', ask: true });
    if (hit(`webchat:day:${u.id}`, 86400000).n > DAY_CAP) return res.status(429).json({ error: 'Chat is busy right now — please try again later' });
    webInbound(u, b.visitor, { text: msg, iid: clip(b.iid, 100), name: clip(b.name, 80), email: clip(b.email, 160).toLowerCase(), phone: clip(b.phone, 40), page: clip(b.page, 300) }).catch((e) => console.error('website chat failed', e.message));
    res.json({ ok: true });
  });
  app.get('/api/public/webchat/:key/messages', pub, (req, res) => {
    const u = seller(req, res); if (!u) return;
    const v = String(req.query.visitor || '');
    if (!VISITOR.test(v)) return res.json({ messages: [], busy: false });
    res.json(webMessages(u, v, Number(req.query.since) || 0));
  });

  // the seller's settings and their snippet
  const view = (u, req) => { const base = String(appUrl(req)).replace(/\/+$/, ''); return { ...webchatOf(u), key: webchatKey(u), snippet: `<script src="${base}/wc.js" data-key="${webchatKey(u)}" async></script>`, agent: { on: agentOf(u).on, name: agentOf(u).name }, ai: aiEnabled(), whatsappNumber: !!publicConfig(u).whatsapp, preview: `${base}/api/public/webchat/${webchatKey(u)}/config` }; };
  app.get('/api/webchat', auth, (req, res) => res.json(view(T.users.get(req.user.id), req)));
  app.put('/api/webchat', auth, (req, res) => {
    const u = T.users.update(req.user.id, (x) => { x.webchat = cleanWebchat(req.body || {}, x.webchat || {}); });
    res.json(view(u, req));
  });
}

// the script on the seller's site: a bubble and a chat window in a shadow root (the site's styles can't reach in)
const WIDGET = `(() => {
  const me = document.currentScript || document.querySelector('script[data-key][src*="wc.js"]');
  if (!me || window.__fhChat) return; window.__fhChat = 1;
  const key = me.getAttribute('data-key'), base = new URL(me.src).origin, api = base + '/api/public/webchat/' + encodeURIComponent(key);
  const store = { get: (k) => { try { return localStorage.getItem('fhc_' + k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem('fhc_' + k, v); } catch {} } };
  const post = (p, b) => fetch(api + p, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(b) }).then((r) => r.json().then((j) => (r.ok ? j : Promise.reject(j))));
  const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmt = (s) => esc(s).replace(/\\*([^*\\n]+)\\*/g, '<b>$1</b>').replace(/(https?:\\/\\/[^\\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\\n/g, '<br>');
  fetch(api + '/config').then((r) => (r.ok ? r.json() : null)).then((c) => { if (c && c.on) start(c); }).catch(() => {});
  function start(c) {
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;z-index:2147483000;bottom:20px;' + (c.position === 'left' ? 'left' : 'right') + ':20px';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' +
      ':host{all:initial}*{box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}' +
      '.b{width:58px;height:58px;border-radius:50%;border:0;background:' + c.color + ';color:#fff;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.2);display:grid;place-items:center;position:relative}' +
      '.b svg{width:26px;height:26px}.dot{position:absolute;top:2px;right:2px;width:14px;height:14px;border-radius:50%;background:#ef4444;border:2px solid #fff;display:none}' +
      '.w{position:absolute;bottom:72px;' + (c.position === 'left' ? 'left' : 'right') + ':0;width:min(370px,calc(100vw - 32px));height:min(560px,calc(100vh - 110px));background:#fff;border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.22);display:none;flex-direction:column;overflow:hidden;color:#111}' +
      '.w.on{display:flex}.h{background:' + c.color + ';color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px}.h b{display:block;font-size:15px}.h small{opacity:.85;font-size:12px}.x{margin-left:auto;background:none;border:0;color:#fff;font-size:22px;cursor:pointer;line-height:1}' +
      '.m{flex:1;overflow-y:auto;padding:14px;background:#f6f7fb;display:flex;flex-direction:column;gap:8px}' +
      '.q{max-width:82%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.4;word-wrap:break-word}.q a{color:inherit}.v{align-self:flex-end;background:' + c.color + ';color:#fff;border-bottom-right-radius:4px}.r{align-self:flex-start;background:#fff;border:1px solid #e6e8ef;border-bottom-left-radius:4px}' +
      '.who{font-size:11px;color:#6b7280;margin:0 0 2px 4px}.ch{display:flex;flex-wrap:wrap;gap:6px;align-self:flex-start;max-width:90%}.ch button,.cta{border:1px solid ' + c.color + ';color:' + c.color + ';background:#fff;border-radius:999px;padding:6px 12px;font-size:13px;cursor:pointer;text-decoration:none}' +
      '.q img{max-width:100%;border-radius:8px;display:block;margin-bottom:6px}.t{align-self:flex-start;color:#6b7280;font-size:12px;padding:2px 6px}' +
      '.f{display:flex;gap:8px;padding:10px;border-top:1px solid #eee;background:#fff}.f input{flex:1;border:1px solid #d9dce5;border-radius:999px;padding:10px 14px;font-size:14px;outline:none}.f button{border:0;background:' + c.color + ';color:#fff;border-radius:999px;padding:0 16px;font-size:14px;cursor:pointer}' +
      '.k[hidden]{display:none}.k{padding:14px;display:flex;flex-direction:column;gap:8px;background:#fff;border-top:1px solid #eee}.k input{border:1px solid #d9dce5;border-radius:10px;padding:9px 12px;font-size:14px}.k p{margin:0;font-size:13px;color:#374151}.k .e{color:#b91c1c;font-size:12px}' +
      '.wa{display:block;text-align:center;font-size:12px;padding:7px;color:#15803d;text-decoration:none;background:#f0fdf4}' +
      '</style>' +
      '<div class="w" role="dialog" aria-label="Chat"><div class="h"><div><b></b><small></small></div><button class="x" aria-label="Close">×</button></div><div class="m" aria-live="polite"></div>' +
      '<div class="k" hidden><p>So we can reply even after you leave:</p><input class="kn" placeholder="Your name" autocomplete="name"><input class="kp" placeholder="Phone or email" autocomplete="email"><div class="e"></div></div>' +
      (c.whatsapp ? '<a class="wa" target="_blank" rel="noopener">Continue on WhatsApp →</a>' : '') +
      '<form class="f"><input placeholder="Type a message…" aria-label="Message" maxlength="1000"><button>Send</button></form></div>' +
      '<button class="b" aria-label="Chat with us"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg><span class="dot"></span></button>';
    document.body.appendChild(host);
    const $ = (s) => root.querySelector(s), win = $('.w'), list = $('.m'), form = $('.f'), input = $('.f input'), ask = $('.k');
    $('.h b').textContent = c.title; $('.h small').textContent = c.subtitle;
    let visitor = store.get(key), since = 0, timer = null, seen = new Set(), info = null, openNow = false;
    if (c.whatsapp) $('.wa').href = c.whatsapp + '?text=' + encodeURIComponent('Hi! I was chatting on your website.');
    const bubble = (cls, html, who) => { if (who) { const w = document.createElement('div'); w.className = 'who'; w.textContent = who; list.appendChild(w); } const d = document.createElement('div'); d.className = 'q ' + cls; d.innerHTML = html; list.appendChild(d); list.scrollTop = list.scrollHeight; return d; };
    const typing = (on) => { let t = $('.t'); if (on && !t) { t = document.createElement('div'); t.className = 't'; t.textContent = 'typing…'; list.appendChild(t); list.scrollTop = list.scrollHeight; } if (!on && t) t.remove(); };
    const greet = () => { if (!list.children.length) bubble('r', fmt(c.greeting)); };
    function show(m) {
      if (seen.has(m.id)) return; seen.add(m.id); since = Math.max(since, m.at);
      if (m.from === 'visitor') { const mine = list.querySelector('[data-pending]'); if (mine) { mine.removeAttribute('data-pending'); return; } return bubble('v', fmt(m.text)); }
      typing(false);
      const d = bubble('r', (m.media && m.media.type === 'image' ? '<img src="' + esc(m.media.link) + '" alt="">' : '') + fmt(m.text) + (m.media && m.media.type !== 'image' ? '<br><a href="' + esc(m.media.link) + '" target="_blank" rel="noopener">' + esc(m.media.filename || 'Open file') + '</a>' : ''), m.from === 'team' && m.author ? m.author : '');
      if (m.cta) { const a = document.createElement('a'); a.className = 'cta'; a.href = m.cta.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = m.cta.label; const w = document.createElement('div'); w.className = 'ch'; w.appendChild(a); list.appendChild(w); }
      if (m.choices) { const w = document.createElement('div'); w.className = 'ch'; m.choices.forEach((o) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = o.title; b.onclick = () => { w.remove(); send(o.title, o.id); }; w.appendChild(b); }); list.appendChild(w); }
      list.scrollTop = list.scrollHeight;
      if (!openNow) $('.dot').style.display = 'block';
    }
    function poll() {
      if (!visitor) return;
      fetch(api + '/messages?visitor=' + encodeURIComponent(visitor) + '&since=' + since).then((r) => r.json()).then((d) => { (d.messages || []).forEach(show); typing(!!d.busy); }).catch(() => {});
    }
    const every = (ms) => { clearInterval(timer); timer = setInterval(poll, ms); };
    async function send(text, iid) {
      text = String(text || '').trim(); if (!text) return;
      if (!visitor) { try { visitor = (await post('/hello', {})).visitor; store.set(key, visitor); } catch (e) { return bubble('r', esc((e && e.error) || 'Chat isn’t available right now')); } }
      const mine = bubble('v', fmt(text)); mine.setAttribute('data-pending', '1');
      const b = { visitor, text, iid: iid || '', page: location.href };
      if (info) Object.assign(b, info);
      typing(true);
      try { await post('/send', b); info = null; ask.hidden = true; store.set(key + '_k', '1'); }
      catch (e) { typing(false); mine.remove(); if (e && e.ask) { ask.hidden = false; $('.e').textContent = e.error; input.value = text; return; } bubble('r', esc((e && e.error) || 'Couldn’t send — please try again')); }
      every(2500); setTimeout(poll, 900);
    }
    form.onsubmit = (e) => {
      e.preventDefault();
      if (!ask.hidden) { const n = $('.kn').value.trim(), p = $('.kp').value.trim(); if (!p && c.ask === 'required') { $('.e').textContent = 'Please add your phone or email'; return; } info = { name: n, ...(p.includes('@') ? { email: p } : { phone: p }) }; }
      const t = input.value; input.value = ''; send(t);
    };
    const open = (on) => { openNow = on; win.classList.toggle('on', on); if (on) { $('.dot').style.display = 'none'; greet(); if (c.ask !== 'off' && !store.get(key + '_k') && !visitor) ask.hidden = false; poll(); every(visitor ? 2500 : 60000); setTimeout(() => input.focus(), 50); } else every(20000); };
    $('.b').onclick = () => open(!win.classList.contains('on'));
    $('.x').onclick = () => open(false);
    if (visitor) { poll(); every(20000); }
  }
})();
`;
