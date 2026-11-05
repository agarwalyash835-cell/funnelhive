// Brand kits (server studio/brand.js): one place for a brand — name, logo, colours, font, design lettering, tone, product
// photos, the closing card's call to action and a legal line. An agency keeps one per client, a seller one per brand;
// each Reel and design is made with one. Locked elements are used exactly as the kit has them, and only the account's
// owner (or its agency) can lock or unlock them — the director in the chat, team members and edits can't change them.
// Self-contained: mount it anywhere with { onClose, onChanged }.
import { useEffect, useRef, useState } from 'react';
import { Lock, LockOpen } from 'lucide-react';
import { api } from '../../api';
import { Modal, Icon, toast, confirmDialog, promptDialog } from '../../ui';

const toDataUrl = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
const upload = async (f) => (await api('/uploads', 'POST', { type: f.type, data: await toDataUrl(f) })).url;
const fontHref = (fonts) => `https://fonts.googleapis.com/css2?${fonts.map((f) => `family=${encodeURIComponent(f.family)}`).join('&')}&display=swap`;
const LETTERING = { sans: 'Clean (sans)', serif: 'Classic (serif)', display: 'Heavy (display)' };
const FIELDS = ['label', 'name', 'logo', 'colours', 'font', 'lettering', 'tone', 'products', 'cta', 'legal'];
const pick = (k) => Object.fromEntries(FIELDS.map((f) => [f, k[f] ?? (f === 'colours' || f === 'products' ? [] : f === 'lettering' ? null : '')]));

// a lockable element's lock: who holds it, and whether this person may change it
function LockBtn({ field, k, meta, locks, setLocks }) {
  const on = !!locks[field], held = k.locks[field];
  const agencyHeld = held === 'agency' && meta.you !== 'agency';
  const can = meta.canLock && !agencyHeld;
  const label = on ? (held === 'agency' ? 'Locked by your agency' : 'Locked') : 'Not locked';
  return (
    <button type="button" className={`sxk-lock${on ? ' on' : ''}`} aria-pressed={on} disabled={!can} title={can ? `${label} — click to ${on ? 'unlock' : 'lock'} the ${meta.lockable[field]}` : agencyHeld ? 'Your agency locked this — only they can unlock it' : 'Only the account’s owner (or its agency) can lock or unlock'} onClick={() => setLocks((x) => ({ ...x, [field]: !on }))}>
      {on ? <Lock size={13} /> : <LockOpen size={13} />}<span>{on ? (held === 'agency' ? 'Agency lock' : 'Locked') : 'Lock'}</span>
    </button>
  );
}

// one element of the kit: what it is, its value, and its lock (outside Editor, so typing doesn't remount the inputs)
function Row({ label, hint, lock, children }) {
  return (
    <div className="sxk-row">
      <div className="sxk-lbl"><b>{label}</b>{hint && <small>{hint}</small>}</div>
      <div className="sxk-val">{children}</div>
      {lock || <span />}
    </div>
  );
}

function Editor({ k, meta, onSaved, onRemoved, onDefault, onCopy }) {
  const [b, setB] = useState(pick(k));
  const [locks, setLocks] = useState(Object.fromEntries(Object.keys(meta.lockable).map((f) => [f, !!k.locks[f]])));
  const [colour, setColour] = useState('#6b6b47');
  const [busy, setBusy] = useState(false);
  const logo = useRef(null), photo = useRef(null);
  useEffect(() => { setB(pick(k)); setLocks(Object.fromEntries(Object.keys(meta.lockable).map((f) => [f, !!k.locks[f]]))); }, [k]);
  const set = (p) => setB((x) => ({ ...x, ...p }));
  const lockChanges = Object.fromEntries(Object.entries(locks).filter(([f, on]) => on !== !!k.locks[f]));
  const dirty = JSON.stringify(b) !== JSON.stringify(pick(k)) || Object.keys(lockChanges).length > 0;
  // a locked element can be edited only by someone who may lift its lock
  const frozen = (f) => !!k.locks[f] && locks[f] && !(meta.canLock && !(k.locks[f] === 'agency' && meta.you !== 'agency'));
  const save = async () => {
    setBusy(true);
    try {
      const body = Object.fromEntries(Object.entries(b).filter(([f, v]) => JSON.stringify(v) !== JSON.stringify(pick(k)[f])));
      onSaved(await api(`/studio/kits/${k.id}`, 'PUT', { ...body, ...(Object.keys(lockChanges).length ? { locks: lockChanges } : {}) }));
      toast('Brand kit saved — every new Reel and design made with it uses it');
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const addFile = async (f, field) => { if (!f) return; if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size > 5 * 1024 * 1024) return toast('Pick a JPG, PNG or WebP picture under 5 MB'); try { const url = await upload(f); set(field === 'logo' ? { logo: url } : { products: [...b.products, url].slice(0, 6) }); } catch (e) { toast(e.message); } };
  const font = meta.fonts.find((f) => f.id === b.font);
  const lk = (field) => (meta.lockable[field] ? <LockBtn field={field} k={k} meta={meta} locks={locks} setLocks={setLocks} /> : null);
  return (
    <section className="sxk-ed" aria-label={`Brand kit ${k.label}`}>
      <header className="sxk-ed-h">
        <input className="sxk-title" maxLength={60} value={b.label} placeholder="Kit name, e.g. a client’s name" onChange={(e) => set({ label: e.target.value })} aria-label="Kit name" />
        {k.isDefault ? <small className="muted">Default — used when no kit is picked</small> : <button type="button" className="btn ghost sm" disabled={busy || !meta.canLock} onClick={onDefault}>Make default</button>}
      </header>
      <Row lock={lk('name')} label="Brand name"><input maxLength={80} value={b.name} placeholder="As it appears on posts and cards" onChange={(e) => set({ name: e.target.value })} /></Row>
      <Row lock={lk('logo')} label="Logo" hint="On every Reel and design made with this kit">
        {b.logo ? <span className="sxm-item"><img src={b.logo} alt="Logo" style={{ height: 26, maxWidth: 90, objectFit: 'contain' }} />{!frozen('logo') && <button type="button" aria-label="Remove logo" onClick={() => set({ logo: '' })}><Icon name="x" size={12} /></button>}</span>
          : <button type="button" className="btn ghost sm" disabled={frozen('logo')} onClick={() => logo.current?.click()}><Icon name="plus" size={13} /> Logo</button>}
        {b.logo && !frozen('logo') && <button type="button" className="btn ghost sm" onClick={() => logo.current?.click()}>Change</button>}
        <input ref={logo} type="file" accept="image/png,image/webp,image/jpeg" hidden onChange={(e) => { addFile(e.target.files?.[0], 'logo'); e.target.value = ''; }} />
      </Row>
      <Row lock={lk('colours')} label="Colours" hint="Up to three; the first leads">
        <div className="sxm-items">
          {b.colours.map((c) => <span key={c} className="sxm-item"><i className="sxm-swatch" style={{ background: c }} />{c}{!frozen('colours') && <button type="button" aria-label={`Remove ${c}`} onClick={() => set({ colours: b.colours.filter((x) => x !== c) })}><Icon name="x" size={12} /></button>}</span>)}
          {b.colours.length < 3 && !frozen('colours') && <span className="sxm-item"><input type="color" value={colour} onChange={(e) => setColour(e.target.value)} aria-label="Brand colour" /><button type="button" className="btn ghost sm" onClick={() => set({ colours: [...new Set([...b.colours, colour.toLowerCase()])] })}>Add</button></span>}
        </div>
      </Row>
      <Row lock={lk('font')} label="Font" hint="Captions and the closing card">
        <select value={b.font} disabled={frozen('font')} onChange={(e) => set({ font: e.target.value })}>{meta.fonts.map((f) => <option key={f.id} value={f.id}>{f.name} — {f.note}</option>)}</select>
        {font && <span className="sxk-sample" style={{ fontFamily: `'${font.family}', sans-serif` }}>{b.name || 'Your brand'} · शुद्ध देसी घी · ₹499</span>}
        <select value={b.lettering || ''} disabled={frozen('font')} aria-label="Lettering in designs" onChange={(e) => set({ lettering: e.target.value || null })}><option value="">Designs: the template’s own lettering</option>{meta.lettering.map((l) => <option key={l} value={l}>Designs: {LETTERING[l] || l}</option>)}</select>
      </Row>
      <Row lock={lk('cta')} label="Call to action" hint="The closing card’s; locked, every Reel and design ends with exactly this"><input maxLength={30} value={b.cta} disabled={frozen('cta')} placeholder="e.g. Order on WhatsApp" onChange={(e) => set({ cta: e.target.value })} /></Row>
      <Row lock={lk('legal')} label="Legal line" hint="Small along the bottom of closing cards and designs"><input maxLength={160} value={b.legal} disabled={frozen('legal')} placeholder="e.g. T&C apply. Offer valid till 31 Dec." onChange={(e) => set({ legal: e.target.value })} /></Row>
      <Row lock={lk('tone')} label="Tone of voice"><input maxLength={200} value={b.tone} placeholder="e.g. warm and homely, no hype" onChange={(e) => set({ tone: e.target.value })} /></Row>
      <Row lock={lk('products')} label="Product photos" hint="The first is used when a Reel has none">
        <div className="sxm-items">
          {b.products.map((u) => <span key={u} className="sxm-item"><img src={u} alt="" style={{ width: 40, height: 48, objectFit: 'cover', borderRadius: 6 }} /><button type="button" aria-label="Remove photo" onClick={() => set({ products: b.products.filter((x) => x !== u) })}><Icon name="x" size={12} /></button></span>)}
          {b.products.length < 6 && <button type="button" className="btn ghost sm" onClick={() => photo.current?.click()}><Icon name="plus" size={13} /> Add</button>}
          <input ref={photo} type="file" accept="image/png,image/webp,image/jpeg" hidden onChange={(e) => { addFile(e.target.files?.[0], 'products'); e.target.value = ''; }} />
        </div>
      </Row>
      {!meta.canLock && <p className="sx-hint">Locks are set by the account’s owner{meta.you === 'member' ? ' — ask them to lock or unlock an element' : ''}.</p>}
      <footer className="row sxk-ed-f">
        <button type="button" className="btn ghost sm" disabled={busy} onClick={onCopy}><Icon name="copy" size={13} /> Copy as a new kit</button>
        {!k.isDefault && meta.canLock && <button type="button" className="btn ghost sm" disabled={busy} onClick={onRemoved}><Icon name="trash" size={13} /> Remove</button>}
        <span className="grow" />
        {dirty && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => { setB(pick(k)); setLocks(Object.fromEntries(Object.keys(meta.lockable).map((f) => [f, !!k.locks[f]]))); }}>Reset</button>}
        <button type="button" className="btn primary sm" disabled={busy || !dirty} onClick={save}>Save kit</button>
      </footer>
    </section>
  );
}

export function BrandKits({ onClose, onChanged }) {
  const [d, setD] = useState(null);
  const [open, setOpen] = useState(null);
  const load = (id) => api('/studio/kits').then((x) => { setD(x); setOpen((o) => id || (x.kits.some((k) => k.id === o) ? o : x.kits[0]?.id)); }).catch((e) => { toast(e.message); onClose?.(); });
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!d?.fonts?.length || document.getElementById('sx-brand-fonts')) return;
    const l = document.createElement('link'); l.id = 'sx-brand-fonts'; l.rel = 'stylesheet'; l.href = fontHref(d.fonts); document.head.appendChild(l);
  }, [d?.fonts]);
  if (!d) return <Modal title="Brand kits" onClose={onClose} width={860}><div className="skeleton" /></Modal>;
  const k = d.kits.find((x) => x.id === open) || d.kits[0];
  const done = (msg, id) => { if (msg) toast(msg); load(id); onChanged?.(); };
  const add = async (from) => {
    const label = await promptDialog({ title: from ? 'Copy this kit' : 'A new brand kit', text: 'One kit per client or brand — Reels and designs are made with the one you pick. Locks aren’t copied.', label: 'Kit name', value: from ? `${k.label} (copy)` : '', placeholder: 'e.g. Shuddh Ghee Co' });
    if (!label) return;
    try { const r = await api('/studio/kits', 'POST', { label, ...(from ? { from: k.id } : {}) }); done('Kit added', r.kit.id); } catch (e) { toast(e.message); }
  };
  const remove = async () => { if (!(await confirmDialog({ title: `Remove “${k.label}”?`, text: 'Reels and designs made with it keep how they look, and use the default kit for anything made again.', confirm: 'Remove kit', danger: true }))) return; try { await api(`/studio/kits/${k.id}`, 'DELETE'); done('Kit removed'); } catch (e) { toast(e.message); } };
  const makeDefault = async () => { try { await api(`/studio/kits/${k.id}/default`, 'POST'); done('Now the default kit', k.id); } catch (e) { toast(e.message); } };
  return (
    <Modal title="Brand kits" onClose={onClose} width={860}>
      <div className="sxk">
        <p className="sx-hint">One kit per brand — an agency keeps one per client. A locked element is used exactly as the kit has it in every Reel and design, and can’t be changed from the chat, by your team or in an edit.{d.you === 'agency' ? ' You’re working as the agency: your locks can only be lifted by you.' : ''}</p>
        <div className="sxk-body">
          <nav className="sxk-list" aria-label="Brand kits">
            {d.kits.map((x) => (
              <button key={x.id} type="button" className={x.id === k.id ? 'on' : ''} aria-current={x.id === k.id} onClick={() => setOpen(x.id)}>
                <span className="sxk-sw">{(x.colours.length ? x.colours : ['#9aa58a']).map((c) => <i key={c} style={{ background: c }} />)}</span>
                <span className="sxk-nm"><b>{x.label}</b><small>{x.isDefault ? 'Default' : x.name || '—'}{Object.values(x.locks).some(Boolean) ? ' · locks' : ''}</small></span>
              </button>
            ))}
            {d.kits.length < d.max && d.you !== 'hive' && <button type="button" className="sxk-add" onClick={() => add(false)}><Icon name="plus" size={14} /> New kit</button>}
          </nav>
          <Editor key={k.id} k={k} meta={d} onSaved={() => done(null, k.id)} onRemoved={remove} onDefault={makeDefault} onCopy={() => add(true)} />
        </div>
      </div>
    </Modal>
  );
}
export default BrandKits;
