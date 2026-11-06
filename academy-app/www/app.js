// AiHive Academy: the app's own screens (first-run tour, your academies, add one). Opening an academy loads
// its members area from app.getaihive.in inside this same, locked window (see MainActivity.java).
'use strict';

const BASE = 'https://app.getaihive.in';
const KEY = 'aa_academies';
const SEEN = 'aa_tour_done';
const $ = (s) => document.querySelector(s);
const app = $('#app');

// ---------- small helpers ----------
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const color = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '#8b5cff');
const safeImg = (u) => (/^https:\/\//.test(u || '') ? u : /^\//.test(u || '') ? BASE + u : '');
const plugin = (n) => window.Capacitor?.Plugins?.[n];
const tap = (style = 'LIGHT') => plugin('Haptics')?.impact({ style }).catch(() => {});
const logo = (a, cls = 'logo') => {
  const src = safeImg(a.logo);
  return `<span class="${cls}">${src ? `<img src="${esc(src)}" alt="" />` : esc((a.name || '?').trim()[0]?.toUpperCase() || '?')}</span>`;
};
const icon = {
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3l7 3v6c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="4.5" y="10.5" width="15" height="10" rx="3"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>',
  arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  rec: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M6.5 6.5l11 11"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>',
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/></svg>',
};
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2400); }

// ---------- the academies kept on this phone ----------
const list = () => read(KEY, []).sort((a, b) => (b.last || 0) - (a.last || 0));
const save = (all) => write(KEY, all);
function remember(info) {
  const all = read(KEY, []).filter((a) => a.handle !== info.handle);
  all.push({ ...info, last: Date.now() });
  save(all);
}
const forget = (handle) => save(read(KEY, []).filter((a) => a.handle !== handle));

// a pasted link (app.getaihive.in/learn/<handle>/…, with or without https) or the bare code
function handleOf(text) {
  const s = String(text || '').trim();
  const m = s.match(/(?:^|\/\/|^)(?:www\.)?app\.getaihive\.in\/learn\/([a-z0-9][a-z0-9_-]{0,63})/i) || s.match(/\/learn\/([a-z0-9][a-z0-9_-]{0,63})/i);
  if (m) return m[1].toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(s) ? s.toLowerCase() : '';
}
async function lookup(handle) {
  let r;
  try { r = await fetch(`${BASE}/api/learn/${encodeURIComponent(handle)}`, { headers: { Accept: 'application/json' } }); }
  catch { throw new Error('No internet — check your connection and try again.'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.school) throw new Error(r.status === 404 ? 'We couldn’t find that academy. Check the link and try again.' : d.error || 'That academy couldn’t be loaded right now.');
  const s = d.school;
  return { handle, name: s.name || handle, tagline: s.tagline || '', logo: s.logo || '', cover: s.cover || '', color: color(s.color) };
}

// ---------- first run: a three-step tour ----------
const TOUR = [
  { h: 'Your courses.<br><em>Locked to you.</em>', p: 'Every lesson is encrypted and signed to your account. Only you can open it.', g: icon.lock },
  { h: 'No screenshots.<br><em>No recordings.</em>', p: 'This app blacks out screenshots and screen recordings, so your teacher’s work stays safe.', g: icon.rec },
  { h: 'Pick up<br><em>where you left.</em>', p: 'Videos, audiobooks and PDFs remember your place — in your own language.', g: icon.play },
];
function tour(i = 0) {
  const s = TOUR[i];
  app.innerHTML = `
    <section class="ob">
      <div class="ob-top"><span class="pill"><i class="live"></i>Protected mode</span><button class="ob-skip" data-skip>Skip</button></div>
      <div class="ob-stage">
        <div class="orb"><span class="glyph">${s.g}</span></div>
        <span class="pill ob-chip c1">${icon.shield}Encrypted</span>
        <span class="pill ob-chip c2">${icon.rec}Record-proof</span>
        <span class="pill ob-chip c3">${icon.globe}12 languages</span>
      </div>
      <div class="ob-copy swap"><h1 class="display">${s.h}</h1><p>${s.p}</p></div>
      <div class="dots">${TOUR.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
      <button class="cta" data-next><span>${i < TOUR.length - 1 ? 'Next' : 'Add my academy'}</span>${icon.arrow}</button>
    </section>`;
  const done = () => { write(SEEN, 1); home(); openSheet(); };
  app.querySelector('[data-skip]').onclick = () => { write(SEEN, 1); home(); };
  app.querySelector('[data-next]').onclick = () => { tap(); i < TOUR.length - 1 ? tour(i + 1) : done(); };
  swipe(app.querySelector('.ob'), (dir) => { if (dir < 0 && i < TOUR.length - 1) tour(i + 1); if (dir > 0 && i > 0) tour(i - 1); });
}
function swipe(el, cb) {
  let x0 = null;
  el.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  el.addEventListener('touchend', (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) cb(dx < 0 ? -1 : 1); x0 = null; });
}

// ---------- home ----------
function greeting() { const h = new Date().getHours(); return h < 5 ? 'Late night study' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
function home() {
  const all = list();
  const [first, ...rest] = all;
  app.innerHTML = `
    <section class="screen rise">
      <div class="bar"><span class="mark"><i>${icon.shield}</i>Academy</span><span class="pill"><i class="live"></i>Protected</span></div>
      ${first ? `
        <div><div class="hello">${greeting()}</div><h1 class="title display">Ready to <em>level up?</em></h1></div>
        <button class="hero" data-open="${esc(first.handle)}" style="--acc:${color(first.color)};${safeImg(first.cover) ? `--cover:url('${esc(safeImg(first.cover))}')` : ''}">
          <span class="hero-k">${icon.play}Continue</span>
          ${logo(first)}
          <h2 class="display">${esc(first.name)}</h2>
          ${first.tagline ? `<p>${esc(first.tagline)}</p>` : '<p>Jump back in where you left off.</p>'}
          <span class="go">${icon.arrow}</span>
        </button>
        ${rest.length ? `<div class="sec"><h3>Your academies</h3><small>${all.length}</small></div>
        <div class="list">${rest.map((a) => `
          <button class="row" data-open="${esc(a.handle)}" style="--acc:${color(a.color)}">${logo(a)}<span><b>${esc(a.name)}</b><small>${esc(a.tagline || 'Tap to open')}</small></span><span class="chev">${icon.chev}</span></button>`).join('')}
        </div>` : ''}
        <p class="mute" style="font-size:12.5px;text-align:center;margin-top:22px">Hold an academy to remove it from this phone.</p>
      ` : `
        <div class="empty">
          <div class="orb"><span class="glyph">${icon.lock}</span></div>
          <h2 class="display">Your learning,<br>locked and loaded.</h2>
          <p>Add the academy your teacher shared — paste their link or type the code.</p>
        </div>
        <div class="perks">
          <div class="perk">${icon.lock}Encrypted lessons</div>
          <div class="perk">${icon.rec}Record-proof screen</div>
          <div class="perk">${icon.globe}Your language</div>
        </div>
      `}
    </section>
    <div class="dock"><button class="cta" data-add>${icon.plus}<span>${first ? 'Add another academy' : 'Add my academy'}</span></button></div>`;
  app.querySelector('[data-add]').onclick = () => { tap(); openSheet(); };
  app.querySelectorAll('[data-open]').forEach((el) => {
    const a = all.find((x) => x.handle === el.dataset.open);
    hold(el, () => menu(a), () => open(a, el));
  });
  const hero = app.querySelector('.hero');
  if (hero) tilt(hero);
}
// a tap opens; holding for half a second offers to remove
function hold(el, onHold, onTap) {
  let t, held = false;
  const start = () => { held = false; t = setTimeout(() => { held = true; el.classList.add('held'); tap('MEDIUM'); onHold(); }, 520); };
  const stop = () => clearTimeout(t);
  el.addEventListener('pointerdown', start);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((e) => el.addEventListener(e, stop));
  el.addEventListener('click', (e) => { if (held) { e.preventDefault(); held = false; el.classList.remove('held'); return; } tap(); onTap(); });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
// the hero card leans toward your finger, with a moving shine
function tilt(el) {
  const move = (e) => {
    const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    el.style.setProperty('--ry', `${(x - .5) * 10}deg`); el.style.setProperty('--rx', `${(.5 - y) * 10}deg`);
    el.style.setProperty('--gx', `${x * 100}%`); el.style.setProperty('--gy', `${y * 100}%`);
  };
  const reset = () => { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); };
  el.addEventListener('pointermove', move); el.addEventListener('pointerleave', reset); el.addEventListener('pointerup', reset);
}
function menu(a) {
  const m = document.createElement('div');
  m.className = 'menu';
  m.innerHTML = `<div class="menu-in"><div style="--acc:${color(a.color)}">${logo(a)}<b>${esc(a.name)}</b></div><button data-o>Open</button><button class="danger" data-r>Remove from this phone</button><button data-c>Cancel</button></div>`;
  const close = () => m.remove();
  m.onclick = (e) => { if (e.target === m) close(); };
  m.querySelector('[data-o]').onclick = () => { close(); open(a); };
  m.querySelector('[data-r]').onclick = () => { close(); forget(a.handle); home(); toast('Removed — your purchases are safe'); };
  m.querySelector('[data-c]').onclick = close;
  document.body.appendChild(m);
}

// ---------- open: the card grows into the academy, then its members area loads here ----------
function open(a, from) {
  remember(a);
  const p = $('#portal');
  const r = from?.getBoundingClientRect();
  p.style.setProperty('--acc', color(a.color));
  p.style.setProperty('--px', r ? `${r.left + r.width / 2}px` : '50%');
  p.style.setProperty('--py', r ? `${r.top + r.height / 2}px` : '50%');
  $('#portalLogo').innerHTML = logo(a);
  $('#portalName').textContent = a.name;
  p.classList.remove('open'); void p.offsetWidth; p.classList.add('open');
  tap('MEDIUM');
  setTimeout(() => { location.href = `${BASE}/learn/${encodeURIComponent(a.handle)}`; }, 650);
}

// ---------- add an academy ----------
let found = null, sheetStep = false;
function openSheet(prefill = '') {
  found = null;
  if (!sheetStep) { history.pushState({ sheet: 1 }, ''); sheetStep = true; }
  $('#sheetBg').hidden = false; const s = $('#sheet'); s.hidden = false; s.classList.remove('out');
  $('#addInput').value = prefill; $('#addErr').textContent = ''; $('#preview').hidden = true; setBtn('Find academy');
  setTimeout(() => $('#addInput').focus(), 350);
  if (prefill) $('#addForm').requestSubmit();
}
function closeSheet(fromBack) {
  if (sheetStep) { sheetStep = false; if (!fromBack) history.back(); } // take back the history step the sheet added
  const s = $('#sheet'); if (s.hidden || s.classList.contains('out')) return;
  s.classList.add('out');
  setTimeout(() => { s.hidden = true; $('#sheetBg').hidden = true; }, 280);
}
function setBtn(label, busy = false) { const b = $('#addBtn'); b.disabled = busy; b.innerHTML = busy ? '<i class="spin"></i>' : `<span>${label}</span>${icon.arrow}`; }
$('#sheetBg').onclick = closeSheet;
$('#addInput').oninput = () => { if (found) { found = null; $('#preview').hidden = true; setBtn('Find academy'); } $('#addErr').textContent = ''; };
$('#pasteBtn').onclick = async () => {
  try { const t = await navigator.clipboard.readText(); if (t) { $('#addInput').value = t.trim(); $('#addForm').requestSubmit(); } }
  catch { toast('Long-press the box and choose Paste'); }
};
$('#addForm').onsubmit = async (e) => {
  e.preventDefault();
  if (found) { const a = found; closeSheet(); home(); setTimeout(() => open(a, document.querySelector(`[data-open="${CSS.escape(a.handle)}"]`)), 320); return; }
  const handle = handleOf($('#addInput').value);
  if (!handle) { $('#addErr').textContent = 'Paste the academy link (it has /learn/ in it) or type its code.'; tap('HEAVY'); return; }
  setBtn('', true);
  try {
    found = await lookup(handle);
    const p = $('#preview');
    p.style.setProperty('--acc', found.color);
    p.innerHTML = `${logo(found)}<span><b>${esc(found.name)}</b><small>${esc(found.tagline || 'Found it!')}</small></span>`;
    p.hidden = false; tap('MEDIUM');
    setBtn(`Open ${found.name.length > 18 ? 'academy' : found.name}`);
  } catch (x) { $('#addErr').textContent = x.message; setBtn('Try again'); tap('HEAVY'); }
};
// drag the sheet down to close it
(() => {
  const s = $('#sheet'); let y0 = null, dy = 0;
  s.addEventListener('touchstart', (e) => { if (e.target.closest('input,button')) return; y0 = e.touches[0].clientY; s.style.transition = 'none'; }, { passive: true });
  s.addEventListener('touchmove', (e) => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); s.style.transform = `translateY(${dy}px)`; }, { passive: true });
  s.addEventListener('touchend', () => { if (y0 == null) return; s.style.transition = ''; s.style.transform = ''; if (dy > 90) closeSheet(); y0 = null; dy = 0; });
})();

// ---------- start ----------
// a link opened from WhatsApp / email arrives as #open/<handle> (MainActivity passes it in)
function route() {
  const m = location.hash.match(/^#open\/([a-z0-9][a-z0-9_-]{0,63})/i);
  if (m) {
    history.replaceState(null, '', location.pathname);
    const known = read(KEY, []).find((a) => a.handle === m[1].toLowerCase());
    write(SEEN, 1);
    if (known) { home(); open(known); } else { home(); openSheet(m[1]); }
    return;
  }
  read(SEEN, 0) ? home() : tour();
}
window.addEventListener('hashchange', route);
// Android's back button walks the page history (Capacitor's default), so an open sheet is a history step
window.addEventListener('popstate', () => { document.querySelector('.menu')?.remove(); if (!$('#sheet').hidden) closeSheet(true); });
plugin('StatusBar')?.setOverlaysWebView?.({ overlay: true }).catch(() => {});
route();
