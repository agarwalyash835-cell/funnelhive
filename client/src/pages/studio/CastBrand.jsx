// The seller's cast and brand kit (server studio/cast.js): the same people and brand in every Studio video. Each person
// has a look, an outfit and reference pictures — made once in Studio (front, three-quarter, full body; paid, the price
// confirmed first) or their own photos. Self-contained: mount it anywhere with { onClose }.
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { Modal, Icon, toast, confirmDialog } from '../../ui';
import { BrandKits } from './BrandKits';

const toDataUrl = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
const uploadFiles = async (files) => { const out = []; for (const f of files) out.push((await api('/uploads', 'POST', { type: f.type, data: await toDataUrl(f) })).url); return out; };
const TIERS = [['quick', 'Quick'], ['standard', 'Standard'], ['cinematic', 'Cinematic']];
const thumb = { width: 64, height: 80, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--c-line)', background: 'var(--c-surface)' };
const fontHref = (fonts) => `https://fonts.googleapis.com/css2?${fonts.map((f) => `family=${encodeURIComponent(f.family)}`).join('&')}&display=swap`;

function Photos({ urls, onChange, max, label }) {
  const file = useRef(null);
  const [busy, setBusy] = useState(false);
  const add = async (list) => { setBusy(true); try { onChange([...urls, ...(await uploadFiles([...list].slice(0, max - urls.length)))]); } catch (e) { toast(e.message); } setBusy(false); };
  return (
    <div className="sxm-items">
      {urls.map((u) => <span key={u} style={{ position: 'relative' }}><img src={u} alt="" style={thumb} /><button type="button" className="btn ghost sm" aria-label="Remove photo" style={{ position: 'absolute', top: 2, right: 2, padding: 2 }} onClick={() => onChange(urls.filter((x) => x !== u))}><Icon name="x" size={12} /></button></span>)}
      {urls.length < max && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => file.current?.click()}><Icon name="plus" size={13} /> {busy ? 'Uploading…' : label}</button>}
      <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { add(e.target.files || []); e.target.value = ''; }} />
    </div>
  );
}

function Person({ c, credits, onChange }) {
  const [edit, setEdit] = useState(null);
  const [tier, setTier] = useState(c.sheet.tier || 'standard');
  const making = c.sheet.status === 'making';
  const save = async () => { try { onChange(await api(`/studio/cast/${c.id}`, 'PUT', edit)); setEdit(null); toast('Saved'); } catch (e) { toast(e.message); } };
  const remove = async () => { if (!(await confirmDialog({ title: `Remove ${c.name}?`, text: 'Their reference pictures go too. Videos already made stay.', confirm: 'Remove', danger: true }))) return; try { await api(`/studio/cast/${c.id}`, 'DELETE'); onChange(null); } catch (e) { toast(e.message); } };
  // paid: the price from the server first, then the go-ahead carries it back
  const sheet = async () => {
    try {
      const e = await api(`/studio/cast/${c.id}/sheet-estimate`, 'POST', { tier });
      if (!(await confirmDialog({ title: `Make ${c.name}’s reference pictures?`, text: `A front portrait, a three-quarter view and a full-body shot in their outfit — ${e.credits} credits. They keep ${c.name}’s face the same in every video.`, confirm: `Make them · ${e.credits} credits` }))) return;
      onChange(await api(`/studio/cast/${c.id}/sheet`, 'POST', { tier: e.tier, confirm: e.credits }));
      toast('Making them — about a minute or two');
    } catch (err) { toast(err.message); }
  };
  return (
    <div className="sxm-sec" style={{ border: '1px solid var(--c-line)', borderRadius: 12, padding: 12 }}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
        <div className="grow">
          <b>{c.name}</b>
          {!edit && <p className="sx-hint">{c.look}{c.outfit ? ` · wears ${c.outfit}` : ''}</p>}
        </div>
        {!edit && <button type="button" className="btn ghost sm" onClick={() => setEdit({ name: c.name, look: c.look, outfit: c.outfit, photos: c.photos })}><Icon name="edit" size={13} /> Edit</button>}
        <button type="button" className="btn ghost sm" aria-label={`Remove ${c.name}`} onClick={remove}><Icon name="trash" size={13} /></button>
      </div>
      {edit ? (
        <>
          <div className="row"><input maxLength={30} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} style={{ maxWidth: 140 }} /><input maxLength={300} value={edit.look} placeholder="Look" onChange={(e) => setEdit({ ...edit, look: e.target.value })} /></div>
          <input maxLength={200} value={edit.outfit} placeholder="Outfit" onChange={(e) => setEdit({ ...edit, outfit: e.target.value })} />
          <Photos urls={edit.photos} max={4} label="Add photos of them" onChange={(photos) => setEdit({ ...edit, photos })} />
          <div className="row"><span className="grow" /><button type="button" className="btn ghost sm" onClick={() => setEdit(null)}>Cancel</button><button type="button" className="btn primary sm" onClick={save}>Save</button></div>
        </>
      ) : (
        <>
          <div className="sxm-items">
            {c.sheet.status !== 'none' && c.sheet.parts.map((p) => (p.url ? <img key={p.part} src={p.url} alt={`${c.name} — ${p.label}`} title={p.label} style={thumb} /> : <span key={p.part} className="skeleton" title={p.label} style={{ ...thumb, display: 'inline-block' }} />))}
            {c.photos.map((u) => <img key={u} src={u} alt={`${c.name} — photo`} style={thumb} />)}
            {!c.refs.length && c.sheet.status === 'none' && <span className="muted sm">No reference pictures yet — their face may change between videos</span>}
          </div>
          {c.sheet.status === 'failed' && <p className="sx-hint">The reference pictures couldn’t be made — try again.</p>}
          {!making && (
            <div className="row">
              <select value={tier} onChange={(e) => setTier(e.target.value)} aria-label="Quality">{TIERS.map(([id, name]) => <option key={id} value={id}>{name}{credits?.[id] ? ` · ${credits[id]} credits` : ''}</option>)}</select>
              <button type="button" className="btn ghost sm" onClick={sheet}><Icon name="sparkles" size={13} /> {c.sheet.status === 'ready' ? 'Make them again' : 'Make reference pictures'}</button>
            </div>
          )}
          {making && <p className="sx-hint">Making the reference pictures — the front portrait first, then the other two from it.</p>}
        </>
      )}
    </div>
  );
}

function NewPerson({ onAdd }) {
  const [p, setP] = useState({ name: '', look: '', outfit: '', photos: [] });
  const ok = p.name.trim().length >= 2 && (p.look.trim().length >= 5 || p.photos.length);
  const add = async () => { try { onAdd(await api('/studio/cast', 'POST', p)); setP({ name: '', look: '', outfit: '', photos: [] }); } catch (e) { toast(e.message); } };
  return (
    <section className="sxm-sec">
      <h4>Add someone</h4>
      <p className="sx-hint">Describe them, or add 1–4 clear photos of a real person (with their permission).</p>
      <div className="row"><input maxLength={30} value={p.name} placeholder="Name, e.g. Asha" onChange={(e) => setP({ ...p, name: e.target.value })} style={{ maxWidth: 140 }} /><input maxLength={300} value={p.look} placeholder="Look: age, face, skin tone, hair — e.g. early 30s, round face, wavy black hair" onChange={(e) => setP({ ...p, look: e.target.value })} /></div>
      <input maxLength={200} value={p.outfit} placeholder="Outfit, e.g. a mustard cotton kurta" onChange={(e) => setP({ ...p, outfit: e.target.value })} />
      <Photos urls={p.photos} max={4} label="Add photos of them" onChange={(photos) => setP({ ...p, photos })} />
      <div className="row"><span className="grow" /><button type="button" className="btn primary sm" disabled={!ok} onClick={add}><Icon name="plus" size={13} /> Add to cast</button></div>
    </section>
  );
}

export default function CastBrand({ onClose }) {
  const [d, setD] = useState(null);
  const [kits, setKits] = useState(false);
  const load = () => api('/studio/cast').then(setD).catch((e) => { toast(e.message); onClose?.(); });
  useEffect(() => { load(); }, []);
  // while reference pictures are being made, look again every few seconds
  const making = d?.characters.some((c) => c.sheet.status === 'making');
  useEffect(() => { if (!making) return undefined; const t = setInterval(load, 5000); return () => clearInterval(t); }, [making]);
  useEffect(() => {
    if (!d?.fonts?.length || document.getElementById('sx-brand-fonts')) return;
    const l = document.createElement('link'); l.id = 'sx-brand-fonts'; l.rel = 'stylesheet'; l.href = fontHref(d.fonts); document.head.appendChild(l);
  }, [d?.fonts]);
  if (!d) return <Modal title="Your cast and brand" onClose={onClose} width={720}><div className="skeleton" /></Modal>;
  const swap = (id, c) => setD((x) => ({ ...x, characters: c ? x.characters.map((y) => (y.id === id ? c : y)) : x.characters.filter((y) => y.id !== id) }));
  return (
    <Modal title="Your cast and brand" onClose={onClose} width={720}>
      <div className="sxm">
        <p className="sx-hint">Cast once, like an agency: name someone in a brief or pick them for a Reel, and they look the same in every scene and every video.</p>
        <section className="sxm-sec">
          <h4>Your cast</h4>
          {d.characters.length ? d.characters.map((c) => <Person key={c.id} c={c} credits={d.sheet.credits} onChange={(x) => swap(c.id, x)} />) : <span className="muted sm">No one yet</span>}
        </section>
        <NewPerson onAdd={(c) => setD((x) => ({ ...x, characters: [...x.characters, c] }))} />
        <section className="sxm-sec">
          <h4>Brand</h4>
          <p className="sx-hint">Logo, colours, font, call to action and legal line live in your brand kits — one per brand or client, with locks.</p>
          <div className="row"><span className="muted sm grow">{d.brand?.label || d.brand?.name || 'Your brand'}{d.brand?.logo ? ' · logo set' : ''}{d.brand?.colours?.length ? ` · ${d.brand.colours.length} colour${d.brand.colours.length === 1 ? '' : 's'}` : ''}</span><button type="button" className="btn ghost sm" onClick={() => setKits(true)}><Icon name="palette" size={13} /> Brand kits</button></div>
        </section>
        <div className="row sxm-foot"><span className="grow" /><button type="button" className="btn ghost" onClick={onClose}>Close</button></div>
      </div>
      {kits && <BrandKits onClose={() => { setKits(false); load(); }} />}
    </Modal>
  );
}
export { CastBrand };
