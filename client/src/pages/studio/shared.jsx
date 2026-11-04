// Studio's shared bits: statuses, frame shapes, how long things take, the starting ideas, and the small pieces of UI
// (a frame-shape glyph, a collapsible inspector section, a segmented picker) every part of the workspace uses.
import { useState } from 'react';
import { Icon } from '../../ui';

export const ACTIVE = ['queued', 'rendering', 'checking', 'producing', 'editing'];
export const WAIT = { queued: ['Waiting to start', 0], rendering: ['Rendering', 1], checking: ['Checking quality', 2], producing: ['Making shots and voiceover', 1], editing: ['Editing the video', 2] };
export const BADGE = { ready: null, needs_review: ['Needs a look', 'warn'], failed: ['Couldn’t be made', 'bad'], script_ready: ['Script ready', ''], storyboard_ready: ['Storyboard ready', ''] };
export const TIER_HINT = { quick: 'Fast drafts', standard: 'Good for most ads', cinematic: 'Best quality, slowest' };
export const RATIO = { '9:16': [9, 16], '1:1': [12, 12], '16:9': [16, 9], '4:5': [10, 12.5], '3:4': [10, 13.3] };
export const ASPECT_NAME = { '9:16': 'Reels / Stories', '1:1': 'Square', '16:9': 'Wide', '4:5': 'Feed', '3:4': 'Portrait' };
export const USUALLY = { image: 'usually about a minute', clip: 'usually 2–4 minutes', reel: 'usually 6–12 minutes — we’ll tell you when it’s ready' };
export const IDEAS = {
  image: ['My product on a clean white background, soft studio light', 'My product on a festive Diwali table with diyas and marigolds', 'Lifestyle shot: a happy family using my product at home', 'Flat lay of my product with its ingredients around it'],
  clip: ['Slow push-in on the product as light moves across it', 'The product rotates slowly on a turntable', 'Hands pick up the product and show it to the camera', 'Steam rises and the camera pulls back to reveal the table'],
  reel: ['Launch offer: introduce my product, the price, and how to order on WhatsApp', 'Festive sale: 20% off this week only, free delivery', 'Problem → solution: why customers switch to my product', 'Customer story: a happy buyer shows how they use it'],
};
export const ago = (t) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };
export const toDataUrl = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
export const dayOf = (t) => { const d = new Date(t), now = new Date(); const same = (x) => x.toDateString() === d.toDateString(); if (same(now)) return 'Today'; const y = new Date(now); y.setDate(now.getDate() - 1); return same(y) ? 'Yesterday' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' }); };
export const band = (n) => (n >= 80 ? 'ok' : n >= 60 ? 'warn' : 'bad');
export const okStatus = (a) => a && ['ready', 'needs_review'].includes(a.status);
export const aspectOf = (a) => (a || '1:1').split(':').map(Number);

// the shape of a frame, drawn small (next to "9:16")
export const Ratio = ({ a, scale = 1 }) => { const [w, h] = RATIO[a] || [12, 12]; return <span className="sx-ratio" style={{ width: w * scale, height: h * scale }} />; };

// a score out of 100 as a small ring: quality, virality, the editor's score
export function Score({ value, label, title, hot }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const known = value != null;
  return (
    <span className={`sxi-score ${known ? band(v) : ''}`} title={title || label}>
      <svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15.5" className="bg" /><circle cx="18" cy="18" r="15.5" className="fg" style={{ strokeDasharray: `${known ? v * 0.974 : 0} 100` }} /></svg>
      <b>{known ? v : '–'}</b>
      <small>{hot ? '🔥 ' : ''}{label}</small>
    </span>
  );
}

// a section of the inspector: a heading that folds it away (remembered for the visit)
const folded = new Set();
export function Section({ id, title, icon, extra, children, open: start = true }) {
  const [open, setOpen] = useState(() => (folded.has(id) ? false : start));
  const flip = () => setOpen((o) => { if (o) folded.add(id); else folded.delete(id); return !o; });
  return (
    <section className={`sxi-sec${open ? ' open' : ''}`}>
      <button type="button" className="sxi-sec-h" aria-expanded={open} onClick={flip}>
        {icon && <Icon name={icon} size={14} />}<span>{title}</span>{extra && <span className="sxi-sec-x" onClick={(e) => e.stopPropagation()}>{extra}</span>}
        <span className="sxi-caret" aria-hidden="true"><Icon name="chevron" size={14} /></span>
      </button>
      {open && <div className="sxi-sec-b">{children}</div>}
    </section>
  );
}

// a row of choices, one on (tier, frame, versions, length, resolution)
export function Seg({ value, options, onChange, label, wrap }) {
  return (
    <div className={`sxi-seg${wrap ? ' wrap' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const [k, l, sub, title] = Array.isArray(o) ? o : [o, o];
        return <button key={k} type="button" role="radio" aria-checked={value === k} className={value === k ? 'on' : ''} title={title} onClick={() => onChange(k)}>{l}{sub != null && <small>{sub}</small>}</button>;
      })}
    </div>
  );
}

// a labelled select that reads like a field in a design tool
export function Field({ label, hint, children }) {
  return <label className="sxi-field"><span className="sxi-lbl">{label}</span>{children}{hint && <small className="sxi-hint">{hint}</small>}</label>;
}
