import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, loggedIn } from '../api';
import { Page } from '../blocks';
import { Layout, Icon, loadFailed } from '../ui';

const TYPES = [['all', 'All funnels'], ['sales', 'Sales pages'], ['vsl', 'VSL + application'], ['webinar', 'Webinars'], ['lead', 'Lead generation']];
const TYPE_LABEL = { sales: 'Sales funnel', vsl: 'VSL · Application', webinar: 'Webinar', lead: 'Lead generation' };

export function TemplateGallery() {
  const nav = useNavigate();
  const [list, setList] = useState([]);
  const [type, setType] = useState('all');
  const [cat, setCat] = useState('All');
  const [style, setStyle] = useState('All');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => { api('/templates').then(setList).catch(loadFailed); }, []);
  // thumbnails are the real hero at desktop width (1280px), scaled to fill whatever width the card has
  const grid = useRef(null);
  useEffect(() => {
    const el = grid.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { const w = el.querySelector('.thumb')?.clientWidth; if (w) el.style.setProperty('--ts', String(w / 1280)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [list.length]);
  const cats = ['All', ...[...new Set(list.map((t) => t.category))].sort()];
  const styles = ['All', ...new Set(list.map((t) => t.style))];
  const shown = list.filter((t) => (type === 'all' || t.type === type) && (cat === 'All' || t.category === cat) && (style === 'All' || t.style === style) && (t.name + t.headline + t.category).toLowerCase().includes(q.toLowerCase()));
  const use = async (id) => { setBusy(id); const f = await api(`/templates/${id}/use`, 'POST'); nav(`/funnels/${f.id}`); };

  return (
    <Layout wide title="Templates" subtitle={`${list.length} complete funnels for Indian businesses — sales pages, video sales letters with applications, and webinars.`} actions={
      <div className="search"><Icon name="search" size={16} /><input placeholder="Search niche… e.g. yoga, pickles, UPSC" value={q} onChange={(e) => setQ(e.target.value)} /></div>
    }>
      <div className="seg ttypes">{TYPES.map(([k, label]) => <button key={k} className={k === type ? 'on' : ''} onClick={() => setType(k)}>{label}<small>{k === 'all' ? list.length : list.filter((t) => t.type === k).length}</small></button>)}</div>
      <div className="filters">
        <div className="chips">{cats.map((c) => <button key={c} className={c === cat ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>)}</div>
        <select value={style} onChange={(e) => setStyle(e.target.value)}>{styles.map((s) => <option key={s} value={s}>{s === 'All' ? 'All styles' : `${s[0].toUpperCase()}${s.slice(1)} style`}</option>)}</select>
      </div>
      <div className="tgallery" ref={grid}>
        {shown.map((t) => (
          <article className="tcard" key={t.id}>
            <Link className="thumb" to={`/t/${t.id}`}>
              <div className="thumb-in"><Page blocks={[t.hero]} theme={t.theme} ctx={{ live: false }} /></div>
              <span className="thumb-hover"><Icon name="eye" size={16} /> Preview</span>
            </Link>
            <div className="tbody">
              <div className="tmeta"><span>{t.category}</span><span className={`ttype tt-${t.type}`}>{TYPE_LABEL[t.type]}</span><span className="dotc" style={{ background: t.theme.primary }} />{t.style}</div>
              <h3>{t.name}</h3>
              <div className="row">
                <Link className="btn ghost sm" to={`/t/${t.id}`}>Preview</Link>
                {loggedIn() && <button className="btn primary sm" disabled={busy === t.id} onClick={() => use(t.id)}>{busy === t.id ? 'Creating…' : 'Use template'}</button>}
              </div>
            </div>
          </article>
        ))}
      </div>
    </Layout>
  );
}

// Standalone preview with all FOMO elements running; clicks walk through the steps, nothing is stored
export function TemplatePreview() {
  const { id } = useParams();
  const nav = useNavigate();
  const [t, setT] = useState(null);
  const [i, setI] = useState(0);
  const claimed = useRef(null);
  useEffect(() => { api(`/templates/${id}`).then(setT).catch(loadFailed); }, [id]);
  useEffect(() => { window.scrollTo(0, 0); }, [i]);
  if (!t) return null;
  const step = t.steps[i];
  const next = () => {
    if (step.blocks.some((b) => b.type === 'optin')) return document.getElementById('optin')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (i < t.steps.length - 1) setI(i + 1);
  };
  const skipDownsells = () => { let n = i + 1; while (t.steps[n]?.type === 'downsell') n++; setI(Math.min(n, t.steps.length - 1)); };
  const ctx = {
    live: true, onNext: next, onOptin: async () => setI(i + 1), onCheckout: async () => setI(i + 1),
    onAccept: async () => skipDownsells(), onDecline: () => setI(Math.min(i + 1, t.steps.length - 1)),
    onCoupon: async (code) => (code === 'INDIA10' ? { valid: true, code, type: 'percent', value: 10 } : { valid: false }),
    onAbandon: () => {}, onCrossSell: async () => {}, onForm: async () => {}, onFormNext: () => setI(Math.min(i + 1, t.steps.length - 1)),
    onClaim: (code) => { claimed.current = code; }, getPendingCoupon: () => claimed.current,
    onBook: async (_, d) => ({ start: d.start, end: d.start + 1800000, manage: null }),
  };
  return (
    <>
      <div className="previewbar">
        <Link to="/templates">← Library</Link>
        <span className="pv-steps">{t.steps.map((s, k) => <button key={s.id} className={k === i ? 'on' : ''} onClick={() => setI(k)}>{k + 1}. {s.name}</button>)}</span>
        {loggedIn() ? <a onClick={async () => nav(`/funnels/${(await api(`/templates/${id}/use`, 'POST')).id}`)}>Use this template →</a> : <a onClick={() => nav('/login')}>Log in to use →</a>}
      </div>
      <Page key={step.id} blocks={step.blocks} theme={t.theme} ctx={ctx} />
    </>
  );
}
