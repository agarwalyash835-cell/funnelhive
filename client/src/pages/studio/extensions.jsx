// Where new Studio features plug in. Studio renders whatever is registered here (or passed as its `extensions` prop),
// and each one shows only when the server says it's available (`when(d)` reads GET /api/studio). With nothing on the
// server, nothing renders — no empty tabs, no "coming soon".
//
// An extension is { id, slot, label, icon, when(d) → bool, ...the slot's component }:
//   slot 'mode'       a canvas mode beside Image / Clip / Reel (e.g. Designs: posters, carousels, thumbnails)
//                     → Stage({ d, assets, load, openAsset }) fills the canvas; Inspector({ d, load }) the right column
//   slot 'inspector'  a panel in the right column, in every mode (e.g. Cast & brand)
//                     → Panel({ d, reel, mode, load })
//   slot 'scene'      something a Reel scene can be or carry (e.g. a Presenter — a talking person — scene)
//                     → SceneTag({ r, i, shot }) under the scene's picture; SceneActions({ r, i, act, busy }) beside its buttons
//   slot 'concept'    actions on a whole concept (e.g. Variations: several hooks for one idea)
//                     → ConceptBar({ r, d, act, busy, load }) above the storyboard
// The built-in entries below are the mount points for features being built on the server; each reads only what the
// server returns and does nothing else until that feature ships its own component.
import { useState } from 'react';
import { Icon } from '../../ui';
import CastBrand from './CastBrand';
import PresenterPicker from './PresenterPicker';
import Variations from './Variations';
import Designs from './Designs';

const registry = [];
export function registerStudioExtension(x) {
  if (!x?.id || !x.slot) return;
  const i = registry.findIndex((y) => y.id === x.id);
  if (i >= 0) registry[i] = { ...registry[i], ...x }; else registry.push(x);
}
export const studioExtensions = () => [...registry];
// what can show now: the slot's entries the server supports and that bring their component
const NEEDS = { mode: 'Stage', inspector: 'Panel', concept: 'ConceptBar' };
export const extOf = (list, slot, d) => (list || []).filter((x) => x.slot === slot && (!NEEDS[slot] || x[NEEDS[slot]]) && (!x.when || safe(() => x.when(d))));
const safe = (f) => { try { return !!f(); } catch { return false; } };
const feature = (d, k) => !!(d?.features?.[k] || d?.[k]?.on);

// Cast & brand: the people and brand assets the server keeps for the seller, and the panel to manage them
function CastPanel({ d, load }) {
  const [open, setOpen] = useState(false);
  const cast = Array.isArray(d?.cast) ? d.cast : Array.isArray(d?.cast?.people) ? d.cast.people : [];
  return (
    <>
    <button type="button" className="btn ghost sm" onClick={() => setOpen(true)}><Icon name="users" size={13} /> {cast.length ? 'Manage cast & brand' : 'Add your cast & brand'}</button>
    {open && <CastBrand onClose={() => { setOpen(false); load?.(); }} />}
    {cast.length > 0 && (
    <div className="sxi-cast">{cast.slice(0, 8).map((c) => (
      <span key={c.id || c.name} className="sxi-person" title={c.look || c.note || c.name}>{c.photo || c.url ? <img src={c.photo || c.url} alt="" /> : <i>{String(c.name || '?').slice(0, 1)}</i>}<b>{c.name}</b></span>
    ))}</div>)}
    </>
  );
}

// Variations: once a Reel is made, more openings for it (several hooks for one idea), and how each did as an ad
const MADE = ['ready', 'needs_review'];
function VariationsBar({ r, load }) { return MADE.includes(r?.status) || r?.parentId ? <Variations reel={r} onChange={load} /> : null; }
// the presenter: who speaks to camera, and which scenes they speak (before anything is made)
function PresenterBar({ r, load }) { return ['script_ready', 'storyboard_ready'].includes(r?.status) ? <PresenterPicker reel={r} onChange={load} /> : null; }

// Presenter: a scene played by a talking person (shown when the server marks a shot as one)
function PresenterTag({ shot }) {
  if (shot?.type !== 'presenter' && !shot?.presenter) return null;
  return <span className="sxs-tag"><Icon name="mic" size={12} /> Presenter{shot.presenter?.name ? ` · ${shot.presenter.name}` : ''}</span>;
}

registerStudioExtension({ id: 'cast', slot: 'inspector', label: 'Cast & brand', icon: 'users', when: (d) => feature(d, 'cast') || (Array.isArray(d?.cast) && d.cast.length > 0), Panel: CastPanel });
// Designs: posts, stories, thumbnails and carousels with words in any Indian language — the designer opens over the canvas
function DesignsStage({ load }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="sx-empty-stage">
      <Icon name="layout" size={28} />
      <h3>Posts, stories, thumbnails and carousels</h3>
      <p className="sx-hint">Festive greetings, sale posters, launch posts, quotes and YouTube thumbnails — with your words typeset in English or any Indian language, on your brand. A free preview first; only the picture costs credits.</p>
      <button type="button" className="btn primary" onClick={() => setOpen(true)}><Icon name="plus" size={14} /> New design</button>
      {open && <Designs onClose={() => { setOpen(false); load?.(); }} />}
    </div>
  );
}
registerStudioExtension({ id: 'designs', slot: 'mode', label: 'Designs', icon: 'layout', when: (d) => feature(d, 'designs'), Stage: DesignsStage });
registerStudioExtension({ id: 'presenter', slot: 'scene', label: 'Presenter', icon: 'mic', when: (d) => feature(d, 'presenter'), SceneTag: PresenterTag });
registerStudioExtension({ id: 'presenter-pick', slot: 'concept', label: 'Presenter', icon: 'mic', when: (d) => feature(d, 'presenter'), ConceptBar: PresenterBar });
registerStudioExtension({ id: 'variations', slot: 'concept', label: 'Variations', icon: 'layers', when: (d) => feature(d, 'variations'), ConceptBar: VariationsBar });
