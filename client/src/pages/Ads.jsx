import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Layout, Panel, Icon, Empty, inr, num, downloadCSV, toast } from '../ui';

// Ads: which ads really make money — spend, leads, calls, sales and lifetime value per ad, by first or last click
const PERIODS = [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['365', '12 months']];
const MODELS = [['last', 'Last click', 'Each lead, call and sale goes to the ad clicked just before it'], ['first', 'First click', 'Everything a person does goes to the ad that first brought them in']];
const x = (v) => (v == null ? '—' : `${v}×`);
const verdict = (r) => {
  if (!r.spend) return null;
  if (r.ltvRoas >= 2) return ['ok', 'Scale'];
  if (r.ltvRoas >= 1) return ['', 'Keep'];
  if (r.spend >= 2000 && !r.sales && !r.calls && !r.customers) return ['bad', 'Kill'];
  return ['warn', 'Watch'];
};

export default function Ads() {
  const nav = useNavigate();
  const [days, setDays] = useState('30');
  const [model, setModel] = useState('last');
  const [funnel, setFunnel] = useState('');
  const [funnels, setFunnels] = useState([]);
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { api('/funnels').then((l) => setFunnels(Array.isArray(l) ? l : l.funnels || [])).catch(() => {}); }, []);
  useEffect(() => {
    let live = true;
    setErr('');
    api(`/ads/report?days=${days}&model=${model}${funnel ? `&funnelId=${funnel}` : ''}`).then((r) => live && setD(r)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [days, model, funnel]);
  const rows = useMemo(() => (d?.rows || []).filter((r) => !q || `${r.campaign} ${r.adset} ${r.ad} ${r.source}`.toLowerCase().includes(q.toLowerCase())), [d, q]);
  const t = d?.totals;
  const s = d?.setup;
  const copy = async () => { try { await navigator.clipboard.writeText(s.urlParams); toast('Copied — paste it into each Meta ad’s URL parameters'); } catch { toast('Couldn’t copy — select the text and copy it'); } };
  return (
    <Layout title="Ads" subtitle="Which ads bring leads, calls and sales — and what each one is really worth" actions={<>
      <div className="seg">{PERIODS.map(([k, l]) => <button key={k} className={days === k ? 'on' : ''} onClick={() => setDays(k)}>{l}</button>)}</div>
      <select value={funnel} onChange={(e) => setFunnel(e.target.value)} aria-label="Funnel"><option value="">All funnels</option>{funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
    </>}>
      {err && <p className="hint warn">{err}</p>}
      {!d ? <div className="skeleton" style={{ height: 300 }} /> : <>
        <div className="kpis">
          {[['Ad spend', inr(t.spend), s.anySpend ? '' : 'Connect Meta to pull spend'], ['Leads', num(t.leads), t.spend && t.leads ? `${inr(Math.round(t.spend / t.leads))} per lead` : ''], ['Booked calls', num(t.calls), t.won ? `${num(t.won)} won deals` : ''], ['Sales', num(t.sales), inr(t.revenue)], ['ROAS', x(t.roas), 'revenue in the period ÷ spend'], ['Lifetime ROAS', x(t.ltvRoas), `${inr(t.ltv)} from ${num(t.customers)} customers so far`]].map(([l, v, f]) => (
            <div className="kpi" key={l}><span className="kpi-l">{l}</span><b className="kpi-v">{v}</b><div className="kpi-f"><small>{f}</small></div></div>
          ))}
        </div>

        {(!s.meta || !s.adSpend || !s.taggedAds) && (
          <Panel title="Set up ad tracking">
            <ol className="ads-setup">
              <li className={s.meta ? 'done' : ''}><b>Connect Meta Ads</b> and pick your ad account — spend per ad comes in daily. {!s.meta && <Link to="/settings#apps">Connect →</Link>}</li>
              <li className={s.taggedAds ? 'done' : ''}><b>Add this to every ad</b> (Ads Manager → your ad → Tracking → URL parameters), so each lead and sale is matched to its ad:
                <div className="ads-params"><code>{s.urlParams}</code><button className="btn ghost sm" onClick={copy}><Icon name="copy" size={14} /> Copy</button></div>
                <small className="muted">Or ask Hive AI: “add the tracking parameters to all my Meta ads”.</small>
              </li>
              <li><b>Use one email or phone per person</b> on your forms and checkout — that’s how a lead today is joined to their purchase next month.</li>
            </ol>
          </Panel>
        )}

        <Panel pad={false} title={<span className="seg sm">{MODELS.map(([k, l, help]) => <button key={k} title={help} className={model === k ? 'on' : ''} onClick={() => setModel(k)}>{l}</button>)}</span>} actions={<>
          <input className="ads-q" placeholder="Search ads…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn ghost sm" disabled={!rows.length} onClick={() => downloadCSV(`ads-${model}-click.csv`, rows.map(({ key, ...r }) => r))}><Icon name="download" size={14} /> CSV</button>
          <button className="btn ghost sm" onClick={() => nav(`/hive?ask=${encodeURIComponent(`Look at my ads report for the last ${days} days and tell me which ads to kill and which to scale`)}`)}><Icon name="sparkles" size={14} /> Ask Hive AI</button>
        </>}>
          {rows.length ? (
            <div className="tbl-wrap">
              <table className="tbl ads-tbl">
                <thead><tr><th>Ad</th><th className="r">Spend</th><th className="r">Leads</th><th className="r">Cost / lead</th><th className="r">Calls</th><th className="r">Sales</th><th className="r">Revenue</th><th className="r">ROAS</th><th className="r" title="Every purchase so far by the people this ad first brought in (in this period)">Lifetime value</th><th className="r">Lifetime ROAS</th><th /></tr></thead>
                <tbody>{rows.map((r) => { const v = verdict(r); return (
                  <tr key={r.key}>
                    <td className="ads-name"><b>{r.ad || r.campaign || (r.source === 'direct' ? 'Direct / organic' : r.source)}</b>
                      <small className="sub-t">{[r.source !== 'direct' && r.source, r.ad && r.campaign, r.adset].filter(Boolean).join(' · ') || (r.campaign ? 'no ad tag' : '')}</small></td>
                    <td className="r">{r.spend ? inr(r.spend) : '—'}</td>
                    <td className="r">{num(r.leads)}</td>
                    <td className="r">{r.cpl != null ? inr(r.cpl) : '—'}</td>
                    <td className="r">{num(r.calls)}{r.won ? <small className="sub-t">{r.won} won</small> : null}</td>
                    <td className="r">{num(r.sales)}</td>
                    <td className="r">{inr(r.revenue)}</td>
                    <td className="r">{x(r.roas)}</td>
                    <td className="r">{inr(r.ltv)}{r.customers ? <small className="sub-t">{r.customers} customer{r.customers === 1 ? '' : 's'}</small> : null}</td>
                    <td className="r"><b>{x(r.ltvRoas)}</b></td>
                    <td>{v && <span className={`pill ${v[0]}`}>{v[1]}</span>}</td>
                  </tr>); })}</tbody>
              </table>
            </div>
          ) : <Empty icon="chart" title="No ad traffic yet" text="Once people arrive from your ads (with the URL parameters above), every lead, call and sale shows here per ad." />}
        </Panel>
        <p className="hint">“Scale” = lifetime ROAS 2× or more · “Kill” = ₹2,000+ spent with no calls or sales. Lifetime value counts every later purchase (upsells, renewals, repeat orders) by people the ad first brought in during this period.</p>
      </>}
    </Layout>
  );
}
