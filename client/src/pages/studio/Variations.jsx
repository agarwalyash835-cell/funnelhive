// Hook variations and the ad test for one finished Reel (server studio/variations.js): pick angles, see the new
// openings with their scores and credits, make the ones you like (only the new opening is made — every other scene,
// line and the music are reused), launch them as a paused Meta test (or get the plan to set up by hand), then see how
// each did as an ad, the winner, and make more like it. Self-contained: <Variations reel={reel} onChange={fn} />.
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Icon, toast, confirmDialog } from '../../ui';

const ANGLE_NAME = { original: 'Original', pain: 'Pain', benefit: 'Benefit', proof: 'Social proof', offer: 'Offer first', curiosity: 'Curiosity' };
const BUSY = ['queued', 'producing', 'editing', 'rendering'];
const num = (v, suffix = '') => (v === null || v === undefined ? '–' : `${v}${suffix}`);
const inr = (v) => (v === null || v === undefined ? '–' : `₹${Math.round(v).toLocaleString('en-IN')}`);
const Score = ({ label, v }) => <span className="sxm-item" title={label}><span className="muted">{label}</span> {v ?? '–'}</span>;

export default function Variations({ reel, onChange }) {
  const id = reel?.id;
  const [d, setD] = useState(null);
  const [res, setRes] = useState(null);
  const [angles, setAngles] = useState(['pain', 'benefit', 'proof', 'offer', 'curiosity']);
  const [scenes, setScenes] = useState(1);
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState('');
  const [launch, setLaunch] = useState({ link: '', dailyBudget: 500, pageId: '' });
  const [plan, setPlan] = useState(null);

  const load = async () => {
    try {
      const [v, r] = await Promise.all([api(`/studio/reels/${id}/variations`), api(`/studio/reels/${id}/results`)]);
      setD(v); setRes(r);
    } catch (e) { toast(e.message); }
  };
  useEffect(() => { if (id) load(); }, [id]);
  // while variants are being made, look again every few seconds
  const making = (d?.variants || []).some((v) => BUSY.includes(v.status));
  useEffect(() => { if (!making) return undefined; const t = setInterval(load, 8000); return () => clearInterval(t); }, [making, id]);
  if (!reel) return null;
  if (!d) return <div className="skeleton" />;

  const ideas = d.ideas?.items || [];
  const fresh = ideas.filter((x) => !x.made);
  const cost = fresh.filter((x) => picked.includes(x.key)).reduce((t, x) => t + (x.credits || 0), 0);
  const finished = (d.variants || []).filter((v) => ['ready', 'needs_review'].includes(v.status));

  const write = async (fromWinner = false) => {
    setBusy('ideas');
    try {
      const r = await api(`/studio/reels/${id}/variations/ideas`, 'POST', fromWinner ? { fromWinner: true, count: 4, scenes } : { angles, count: Math.max(3, angles.length), scenes });
      setD((x) => ({ ...x, ...r })); setPicked([]);
      if (fromWinner) toast('New openings in the winning angle');
    } catch (e) { toast(e.message); }
    setBusy('');
  };
  const make = async () => {
    if (!picked.length) return;
    if (!(await confirmDialog({ title: `Make ${picked.length} variation${picked.length === 1 ? '' : 's'}?`, text: `Only each new opening is made — its picture, its movement and its line. Every other scene, line and the music are reused. About ${cost} credits.`, confirm: `Make them · ${cost} credits` }))) return;
    setBusy('make');
    try {
      const r = await api(`/studio/reels/${d.from || id}/variations`, 'POST', { keys: picked });
      toast(`Making ${r.variants.length} — a few minutes`);
      setPicked([]); await load(); onChange?.();
    } catch (e) { toast(e.message); }
    setBusy('');
  };
  const go = async (planOnly) => {
    if (!planOnly && !(await confirmDialog({ title: 'Create the ad test?', text: `A PAUSED campaign and ad set on your Meta ad account with one ad per version (₹${launch.dailyBudget} a day once you switch it on). Nothing spends until you turn it on in Ads Manager.`, confirm: 'Create paused test' }))) return;
    setBusy('launch');
    try {
      const r = await api(`/studio/reels/${id}/launch`, 'POST', { ...launch, dailyBudget: Number(launch.dailyBudget) || 500, planOnly });
      setPlan(r);
      if (r.launched) { toast('Created — everything is paused'); await load(); onChange?.(); } else if (!planOnly && r.reason) toast(r.reason);
    } catch (e) { toast(e.message); }
    setBusy('');
  };
  const copy = (t) => navigator.clipboard?.writeText(t).then(() => toast('Copied'), () => {});

  return (
    <div className="sxv">
      {/* 1. new openings */}
      <section className="sxm-sec">
        <h4>Test new hooks</h4>
        <p className="sx-hint">Agencies test 5–10 openings per ad and put the money behind the winner. Only the opening changes; the rest of this Reel is reused, so each one costs about {d.cost.perVariant[scenes]} credits.</p>
        {d.canVary ? <p className="muted sm">{d.canVary}</p> : <>
          <div className="sxm-items">
            {d.angles.map((a) => <label key={a.id} className="sxm-item" title={a.what}><input type="checkbox" checked={angles.includes(a.id)} onChange={(e) => setAngles((x) => (e.target.checked ? [...x, a.id] : x.filter((y) => y !== a.id)))} /> {a.name}</label>)}
          </div>
          <div className="row">
            <label className="sm">Change<select value={scenes} onChange={(e) => setScenes(Number(e.target.value))}><option value={1}>The first scene</option><option value={2}>The first two scenes</option></select></label>
            <span className="grow" />
            <button type="button" className="btn" disabled={busy === 'ideas' || !angles.length} onClick={() => write(false)}><Icon name="sparkles" size={14} /> {busy === 'ideas' ? 'Writing…' : 'Write hooks (free)'}</button>
          </div>
        </>}
        {fresh.length > 0 && <div className="sxv-ideas">
          {d.ideas.seed && <p className="sx-hint">More like the winner: “{d.ideas.seed.hook}”</p>}
          {fresh.map((x) => (
            <label key={x.key} className="sxm-who" style={{ alignItems: 'flex-start' }}>
              <input type="checkbox" checked={picked.includes(x.key)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, x.key] : p.filter((k) => k !== x.key)))} />
              <span style={{ flex: 1 }}>
                <b>{ANGLE_NAME[x.angle] || x.angle}</b> · “{x.hook}”
                <span className="muted sm" style={{ display: 'block' }}>{x.image}</span>
                {x.line2 && <span className="muted sm" style={{ display: 'block' }}>Then: “{x.line2}”</span>}
                <span className="sxm-items">{x.check ? <><Score label="Hook" v={x.check.hook} /><Score label="Quality" v={x.check.quality} /><Score label="Virality" v={x.check.virality} /></> : <span className="muted sm">Not checked</span>}<span className="sxm-item">{x.credits} credits</span></span>
                {x.check?.problem && <span className="muted sm" style={{ display: 'block' }}>{x.check.problem}</span>}
              </span>
            </label>
          ))}
          <div className="row"><span className="grow" /><button type="button" className="btn" disabled={!picked.length || busy === 'make'} onClick={make}><Icon name="play" size={14} /> Make {picked.length || ''} · {cost} credits</button></div>
        </div>}
      </section>

      {/* 2. the versions, and how each did as an ad */}
      <section className="sxm-sec">
        <h4>Versions and ad results</h4>
        {res?.reason && <p className="sx-hint">{res.decided ? `Winner by ${res.reason}` : res.reason}</p>}
        <div style={{ overflowX: 'auto' }}>
          <table className="table sm">
            <thead><tr><th>Version</th><th>Status</th><th>Ad name</th><th>Spend</th><th>Hook rate</th><th>CTR</th><th>Cost / lead</th><th>ROAS</th><th /></tr></thead>
            <tbody>
              {(res?.variants || []).map((v) => (
                <tr key={v.id}>
                  <td>{v.poster && <img src={v.poster} alt="" style={{ width: 28, height: 44, objectFit: 'cover', borderRadius: 4, marginRight: 6, verticalAlign: 'middle' }} />}<b>{ANGLE_NAME[v.angle] || v.angle}</b><span className="muted sm" style={{ display: 'block', maxWidth: 260 }}>“{v.hook}”</span></td>
                  <td>{v.status}{v.ad ? <span className="muted sm" style={{ display: 'block' }}>Ad {v.ad.status.toLowerCase()}</span> : null}</td>
                  <td><button type="button" className="btn ghost sm" title="Copy the ad name" onClick={() => copy(v.adName)}>{v.adName}</button></td>
                  <td>{inr(v.metrics?.spend)}</td>
                  <td>{num(v.metrics?.hookRate, '%')}</td>
                  <td>{num(v.metrics?.ctr, '%')}</td>
                  <td>{inr(v.metrics?.cpl)}</td>
                  <td>{num(v.metrics?.roas, '×')}</td>
                  <td>{v.verdict === 'winner' ? <span className="badge green">Winner</span> : v.verdict === 'loser' ? <span className="badge red">Loser</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row">
          <button type="button" className="btn ghost sm" onClick={load}><Icon name="redo" size={13} /> Refresh</button>
          <span className="grow" />
          {res?.winner && <button type="button" className="btn" disabled={busy === 'ideas'} onClick={() => write(true)}><Icon name="sparkles" size={14} /> More like the winner</button>}
        </div>
        <p className="muted sm">A winner is called once at least two versions have ₹{res?.rules?.minSpend ?? 500}+ spend and {(res?.rules?.minImpressions ?? 1000).toLocaleString('en-IN')}+ impressions, and one is clearly ahead. Studio remembers what won for your next scripts.</p>
      </section>

      {/* 3. the ad test */}
      {finished.length >= 2 && <section className="sxm-sec">
        <h4>Launch as a Meta ad test</h4>
        <p className="sx-hint">One ad set, one ad per version, so they compete fairly. Everything is created paused — you switch it on in Ads Manager.</p>
        <div className="row">
          <label className="sm">Send people to<input value={launch.link} placeholder="https://…" onChange={(e) => setLaunch({ ...launch, link: e.target.value })} /></label>
          <label className="sm">₹ a day<input type="number" min={100} value={launch.dailyBudget} onChange={(e) => setLaunch({ ...launch, dailyBudget: e.target.value })} style={{ maxWidth: 110 }} /></label>
          <label className="sm">Facebook Page id (optional)<input value={launch.pageId} onChange={(e) => setLaunch({ ...launch, pageId: e.target.value })} style={{ maxWidth: 170 }} /></label>
        </div>
        <div className="row">
          <button type="button" className="btn ghost" disabled={busy === 'launch'} onClick={() => go(true)}>Show the plan</button>
          <span className="grow" />
          <button type="button" className="btn" disabled={busy === 'launch' || !/^https?:\/\//.test(launch.link)} onClick={() => go(false)}>Create paused test</button>
        </div>
        {plan && <div className="sxv-plan">
          {plan.launched ? <p><b>Created, paused.</b> {plan.note}</p> : plan.reason && <p className="sx-hint">{plan.reason}</p>}
          <ol className="sm">{plan.plan.steps.map((s) => <li key={s}>{s}</li>)}</ol>
          <p className="sm"><b>URL parameters</b> <button type="button" className="btn ghost sm" onClick={() => copy(plan.plan.urlParams)}><Icon name="copy" size={12} /> Copy</button></p>
          <code className="sm" style={{ display: 'block', wordBreak: 'break-all' }}>{plan.plan.urlParams}</code>
          <ul className="sm">{plan.plan.ads.map((a) => <li key={a.name}><b>{a.name}</b> — {ANGLE_NAME[a.angle] || a.angle}: “{a.hook}” · <a href={a.video} target="_blank" rel="noreferrer">video</a></li>)}</ul>
        </div>}
      </section>}
    </div>
  );
}
