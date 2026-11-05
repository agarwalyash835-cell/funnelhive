// What Studio remembers about the seller (server studio/memory.js): their brand, what they like and want avoided
// (learned from script edits and redo notes), their recurring characters, their usual choices and the scripts they
// approved as written. Every new Reel script uses it, so the seller can see it, correct it, and wipe it.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Modal, Icon, toast, confirmDialog } from '../ui';
import { BrandKits } from './studio/BrandKits';

const PREF_LABEL = { tier: 'Quality', vmodel: 'Video model', imodel: 'Stills', res: 'Video', voice: 'Voice', captions: 'Captions', aspect: 'Frame', lang: 'Language', seconds: 'Length', motion: 'Motion' };
const MOTION = { video: 'AI video', story: 'Storyline', photo: 'Photo motion' };

function List({ title, hint, items, onChange, placeholder }) {
  const [add, setAdd] = useState('');
  const push = () => { const t = add.trim(); if (t.length < 2) return; onChange([t, ...items.filter((x) => x.toLowerCase() !== t.toLowerCase())]); setAdd(''); };
  return (
    <section className="sxm-sec">
      <h4>{title}</h4>
      {hint && <p className="sx-hint">{hint}</p>}
      <div className="sxm-items">{items.length ? items.map((x, i) => <span key={x} className="sxm-item">{x}<button type="button" aria-label={`Remove ${x}`} onClick={() => onChange(items.filter((_, j) => j !== i))}><Icon name="x" size={12} /></button></span>) : <span className="muted sm">Nothing yet</span>}</div>
      <div className="row"><input maxLength={100} value={add} placeholder={placeholder} onChange={(e) => setAdd(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') push(); }} /><button type="button" className="btn ghost sm" disabled={add.trim().length < 2} onClick={push}><Icon name="plus" size={13} /> Add</button></div>
    </section>
  );
}

export function StudioMemory({ d, onClose }) {
  const [m, setM] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [who, setWho] = useState({ name: '', look: '' });
  const [kits, setKits] = useState(false);
  const reload = () => api('/studio/memory').then((x) => setM((was) => (was ? { ...was, brand: x.brand } : x))).catch((e) => { toast(e.message); onClose(); });
  useEffect(() => { reload(); }, []);
  if (!m) return <Modal title="What Studio remembers about you" onClose={onClose} width={640}><div className="skeleton" /></Modal>;
  const change = (p) => { setM((x) => ({ ...x, ...p })); setDirty(true); };
  // the usual choices, in words (model ids → their names on the tier's menu)
  const tier = d.tiers.find((t) => t.id === m.prefs.tier);
  const prefText = (k, v) => k === 'tier' ? tier?.name || v : k === 'vmodel' ? tier?.models?.video?.find((x) => x.id === v)?.name || v : k === 'imodel' ? tier?.models?.image?.find((x) => x.id === v)?.name || v
    : k === 'voice' ? d.voices?.find((x) => x.id === v)?.name || v : k === 'captions' ? d.captionStyles.find((x) => x.id === v)?.name || v : k === 'lang' ? d.languages.find((x) => x.id === v)?.name || v : k === 'seconds' ? `${v}s` : k === 'motion' ? MOTION[v] || v : v;
  const prefs = Object.entries(m.prefs || {}).filter(([k]) => PREF_LABEL[k]);
  const save = async () => { try { setM(await api('/studio/memory', 'PUT', { likes: m.likes, avoid: m.avoid, characters: m.characters, wins: m.wins, prefs: m.prefs })); setDirty(false); toast('Saved — your next scripts use it'); } catch (e) { toast(e.message); } };
  const wipe = async () => {
    if (!(await confirmDialog({ title: 'Forget everything?', text: 'Studio forgets what it learned: likes, things to avoid, characters, usual choices. Your brand kits, images, clips and Reels stay.', confirm: 'Forget everything', danger: true }))) return;
    try { await api('/studio/memory', 'DELETE'); onClose(); toast('Studio has forgotten it all'); } catch (e) { toast(e.message); }
  };
  const addWho = () => { if (!who.name.trim() || who.look.trim().length < 5) return; change({ characters: [{ name: who.name.trim(), look: who.look.trim() }, ...m.characters.filter((c) => c.name.toLowerCase() !== who.name.trim().toLowerCase())].slice(0, 3) }); setWho({ name: '', look: '' }); };

  return (
    <Modal title="What Studio remembers about you" onClose={onClose} width={680}>
      <div className="sxm">
        <p className="sx-hint">Studio learns from your script edits, redo notes and what you approve, and writes every new Reel with it. Change anything that isn’t right.</p>
        <section className="sxm-sec">
          <h4>Your brand</h4>
          <p className="sx-hint">Your name, logo, colours, font, call to action and legal line live in your brand kits (one per brand or client, with locks).</p>
          <div className="row">
            <span className="sxm-items grow">{m.brand.logo && <img src={m.brand.logo} alt="Logo" style={{ height: 22, maxWidth: 70, objectFit: 'contain' }} />}<b className="sm">{m.brand.name || 'Your brand'}</b>{m.brand.colours.map((c) => <i key={c} className="sxm-swatch" title={c} style={{ background: c }} />)}</span>
            <button type="button" className="btn ghost sm" onClick={() => setKits(true)}><Icon name="palette" size={13} /> Brand kits</button>
          </div>
        </section>
        <List title="You like" hint="Look and tone — e.g. warm morning light, short punchy lines." items={m.likes} onChange={(likes) => change({ likes })} placeholder="Something you like in your ads" />
        <List title="Avoid" hint="Learned from your redo notes and edits." items={m.avoid} onChange={(avoid) => change({ avoid })} placeholder="Something not to do again" />
        <section className="sxm-sec">
          <h4>Your characters</h4>
          <p className="sx-hint">People who appear in your ads again and again. Name them in a brief and they look the same in every shot.</p>
          {m.characters.map((c, i) => <div key={c.name} className="sxm-who"><b>{c.name}</b><span>{c.look}</span><button type="button" className="btn ghost sm" aria-label={`Remove ${c.name}`} onClick={() => change({ characters: m.characters.filter((_, j) => j !== i) })}><Icon name="trash" size={13} /></button></div>)}
          {m.characters.length < 3 && <div className="row"><input maxLength={30} value={who.name} placeholder="Name, e.g. Asha" onChange={(e) => setWho({ ...who, name: e.target.value })} style={{ maxWidth: 140 }} /><input maxLength={200} value={who.look} placeholder="Look: age, hair, clothes — e.g. 30s, wavy hair, mustard kurta" onChange={(e) => setWho({ ...who, look: e.target.value })} /><button type="button" className="btn ghost sm" disabled={!who.name.trim() || who.look.trim().length < 5} onClick={addWho}><Icon name="plus" size={13} /> Add</button></div>}
        </section>
        <section className="sxm-sec">
          <h4>Your usual choices</h4>
          <p className="sx-hint">A new Reel starts with these when you don’t pick.</p>
          <div className="sxm-items">{prefs.length ? prefs.map(([k, v]) => <span key={k} className="sxm-item"><span className="muted">{PREF_LABEL[k]}</span> {prefText(k, v)}<button type="button" aria-label={`Forget ${PREF_LABEL[k]}`} onClick={() => { const p = { ...m.prefs }; delete p[k]; change({ prefs: p }); }}><Icon name="x" size={12} /></button></span>) : <span className="muted sm">Nothing yet — approve a Reel and Studio remembers your choices</span>}</div>
        </section>
        {m.wins.length > 0 && <section className="sxm-sec">
          <h4>Scripts you approved as written</h4>
          {m.wins.map((w, i) => <div key={w.title} className="sxm-who"><b>{w.title}</b><span>{w.hook}</span><button type="button" className="btn ghost sm" aria-label={`Remove ${w.title}`} onClick={() => change({ wins: m.wins.filter((_, j) => j !== i) })}><Icon name="trash" size={13} /></button></div>)}
        </section>}
        <div className="row sxm-foot">
          <button type="button" className="btn ghost" onClick={wipe}><Icon name="trash" size={14} /> Forget everything</button>
          <span className="grow" />
          <button type="button" className="btn ghost" onClick={onClose}>Close</button>
          <button type="button" className="btn primary" disabled={!dirty} onClick={save}>Save</button>
        </div>
      </div>
      {kits && <BrandKits onClose={() => { setKits(false); reload(); }} />}
    </Modal>
  );
}
