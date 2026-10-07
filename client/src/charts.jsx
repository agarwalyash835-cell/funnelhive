import { useEffect, useRef, useState } from 'react';

function useWidth() {
  const ref = useRef();
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const niceMax = (v) => {
  if (v <= 0) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v) || v;
};
const short = (n) => (n >= 1e7 ? `${+(n / 1e7).toFixed(1)}Cr` : n >= 1e5 ? `${+(n / 1e5).toFixed(1)}L` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : `${Math.round(n)}`);
// d is a calendar date (YYYY-MM-DD) in the business timezone — format it without shifting by the viewer's timezone
const fmtDate = (d) => { const [y, m, day] = d.split('-').map(Number); return new Date(y, m - 1, day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); };

// Single-series area chart with crosshair + tooltip
export function AreaChart({ data, yKey, format = (v) => v, height = 260, label }) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState(null);
  const pad = { l: 44, r: 12, t: 12, b: 28 };
  const iw = Math.max(10, w - pad.l - pad.r), ih = height - pad.t - pad.b;
  const max = niceMax(Math.max(...data.map((d) => d[yKey]), 0));
  const x = (i) => pad.l + (data.length > 1 ? (i / (data.length - 1)) * iw : iw / 2);
  const y = (v) => pad.t + ih - (v / max) * ih;
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[yKey]).toFixed(1)}`).join('');
  const area = `${line}L${x(data.length - 1)},${pad.t + ih}L${x(0)},${pad.t + ih}Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const every = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(iw / 80))));
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left - pad.l) / iw) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };
  const h = hover != null ? data[hover] : null;
  return (
    <div className="chart" ref={ref} style={{ height }}>
      <svg width={w} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={label}>
        <defs>
          <linearGradient id={`g-${yKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--c-accent)" stopOpacity=".28" />
            <stop offset="100%" stopColor="var(--c-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={pad.l + iw} y1={y(t)} y2={y(t)} className="grid-l" />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="axis-t">{short(t)}</text>
          </g>
        ))}
        {data.map((d, i) => (i % every === 0 ? <text key={d.date} x={x(i)} y={height - 8} textAnchor="middle" className="axis-t">{fmtDate(d.date)}</text> : null))}
        <path d={area} fill={`url(#g-${yKey})`} />
        <path d={line} fill="none" stroke="var(--c-accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {h && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} className="cross" />
            <circle cx={x(hover)} cy={y(h[yKey])} r="5" fill="var(--c-accent)" stroke="var(--c-surface)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {h && (
        <div className="tip" style={{ left: Math.min(Math.max(x(hover), 70), w - 70), top: Math.max(0, y(h[yKey]) - 58) }}>
          <small>{fmtDate(h.date)}</small><b>{format(h[yKey])}</b>
        </div>
      )}
    </div>
  );
}

export function Sparkline({ data, yKey, width = 96, height = 28 }) {
  if (!data?.length) return null;
  const max = Math.max(...data.map((d) => d[yKey]), 1);
  const pts = data.map((d, i) => `${(i / Math.max(1, data.length - 1)) * width},${height - 2 - (d[yKey] / max) * (height - 4)}`).join(' ');
  return <svg width={width} height={height} className="spark" aria-hidden="true"><polyline points={pts} fill="none" stroke="var(--c-accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

// Horizontal bars — one hue, values labelled in text ink
export function HBars({ items, format = (v) => v }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="hbars">
      {items.map((i) => (
        <div className="hb" key={i.label} title={`${i.label}: ${format(i.value)}`}>
          <div className="hb-top"><span>{i.label}</span><b>{format(i.value)}</b></div>
          <div className="hb-track"><div style={{ width: `${Math.max(i.value ? 2 : 0, (i.value / max) * 100)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}
