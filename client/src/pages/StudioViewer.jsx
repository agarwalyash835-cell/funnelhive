// Studio's full-screen viewer: an image you can zoom (scroll, double-click, + / − / 0) and drag around, or a clip that
// loops; ← / → move through the set, Esc closes. The side panel says what it is, how it was checked and what to do next.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../ui';

const STATUS = { ready: 'Passed the quality check', needs_review: 'Needs a look', failed: 'Couldn’t be made' };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function Viewer({ items, index, onIndex, onClose, actions }) {
  const a = items[index];
  const [z, setZ] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef(null);
  const [dragging, setDragging] = useState(false);
  // a new item starts unzoomed
  useEffect(() => { setZ(1); setPan({ x: 0, y: 0 }); }, [index]);
  useEffect(() => {
    const key = (e) => {
      if (e.target.closest?.('input, textarea, select')) return;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && index < items.length - 1) onIndex(index + 1);
      else if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      else if ((e.key === '+' || e.key === '=') && a?.kind === 'image') setZ((v) => clamp(v * 1.4, 1, 6));
      else if (e.key === '-' && a?.kind === 'image') setZ((v) => { const n = clamp(v / 1.4, 1, 6); if (n === 1) setPan({ x: 0, y: 0 }); return n; });
      else if (e.key === '0') { setZ(1); setPan({ x: 0, y: 0 }); }
    };
    document.addEventListener('keydown', key);
    const was = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = was; };
  }, [index, items.length, a?.kind]);
  if (!a) return null;
  const isImg = a.kind === 'image' || (!a.url && a.poster);
  const zoomBy = (f) => setZ((v) => { const n = clamp(v * f, 1, 6); if (n === 1) setPan({ x: 0, y: 0 }); return n; });
  const wheel = (e) => { if (!isImg) return; zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15); };
  const down = (e) => { if (z <= 1) return; drag.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }; setDragging(true); e.currentTarget.setPointerCapture?.(e.pointerId); };
  const move = (e) => { if (!drag.current) return; setPan({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y }); };
  const up = () => { drag.current = null; setDragging(false); };
  const m = a.measured;
  const facts = [
    ['Type', a.kind === 'clip' ? `Video clip · ${a.seconds || m?.seconds || '?'}s` : 'Image'],
    ['Quality', a.tierName || a.tier],
    ['Shape', a.aspect],
    m?.width ? ['Size', `${m.width} × ${m.height}${a.enhanced ? ' · sharpened to 720p' : ''}`] : null,
    a.attempts > 1 ? ['Tries', `${a.attempts} (redone automatically after the check)`] : null,
  ].filter(Boolean);

  return (
    <div className="sxv" role="dialog" aria-modal="true" aria-label="Viewer">
      <div className={`sxv-stage${z > 1 ? ' zoomed' : ''}${dragging ? ' drag' : ''}`} onWheel={wheel} onPointerMove={move} onPointerUp={up} onPointerLeave={up} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <button className="sxv-close" aria-label="Close" onClick={onClose}><Icon name="x" size={18} /></button>
        {isImg
          ? <img src={a.url || a.poster} alt={a.prompt} draggable={false} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${z})` }} onPointerDown={down} onDoubleClick={() => (z > 1 ? (setZ(1), setPan({ x: 0, y: 0 })) : setZ(2.5))} />
          : <video key={a.url} src={a.url} poster={a.poster || undefined} controls autoPlay loop playsInline />}
        {index > 0 && <button className="sxv-nav prev" aria-label="Previous" onClick={() => onIndex(index - 1)}><span style={{ display: 'grid', transform: 'rotate(180deg)' }}><Icon name="chevron" size={20} /></span></button>}
        {index < items.length - 1 && <button className="sxv-nav next" aria-label="Next" onClick={() => onIndex(index + 1)}><Icon name="chevron" size={20} /></button>}
        {isImg && (
          <div className="sxv-tools">
            <button aria-label="Zoom out" onClick={() => zoomBy(1 / 1.4)}>−</button>
            <span>{Math.round(z * 100)}%</span>
            <button aria-label="Zoom in" onClick={() => zoomBy(1.4)}>+</button>
            <button aria-label="Fit" title="Fit (0)" onClick={() => { setZ(1); setPan({ x: 0, y: 0 }); }}><Icon name="desktop" size={15} /></button>
          </div>
        )}
      </div>
      <aside className="sxv-side">
        <div><h3>{a.kind === 'clip' ? 'Clip' : 'Image'} {index + 1} of {items.length}</h3></div>
        <p>{a.prompt}</p>
        <dl className="sxv-facts">{facts.map(([k, v]) => [<dt key={`${k}t`}>{k}</dt>, <dd key={`${k}d`}>{v}</dd>])}</dl>
        {a.status !== 'failed' && (
          <div className={`sxv-qa${a.status === 'needs_review' ? ' warn' : ''}`}>
            <b>{STATUS[a.status] || a.status}</b>
            {a.status === 'ready' && <span>{a.reviewed ? 'Checked frame by frame: same product, no garbled text, no glitches.' : 'Measured for size, length, black frames, freezes and blur.'}</span>}
            {a.issues?.length > 0 && <ul>{a.issues.map((x) => <li key={x}>{x}</li>)}</ul>}
          </div>
        )}
        {a.error && <div className="sxv-qa warn"><b>{a.error}</b></div>}
        {actions?.(a)}
        <small style={{ color: '#8d8d98' }}>Scroll or double-click to zoom · drag to move · ← → to browse · Esc to close</small>
      </aside>
    </div>
  );
}
