import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Layout, Panel, Icon, Empty, inr, num, downloadCSV, toast } from '../ui';

// Ads: which ads really make money — spend, leads, calls, sales and lifetime value per ad, by first or last click
const PERIODS = [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['365', '12 months']];
const MODELS = [['last', 'Last click', 'Each lead, call and sale goes to the ad clicked just before it'], ['first', 'First click', 'Everything a person does goes to the ad that first brought them in']];
const x = (v) => (v == null ? '—' : `${v}×`);
const p = (v) => (v == null ? '—' : `${v}%`);
const n0 = (v) => (v ? num(v) : '—');
// the table's two views: what each ad earned, and how it delivered (what Ads Manager shows, side by side with results)
const VIEWS = [['results', 'Results'], ['delivery', 'Delivery & creative']];
const WINDOWS = [['7d_click_1d_view', '7-day click + 1-day view (Meta default)'], ['7d_click', '7-day click'], ['1d_click', '1-day click'], ['28d_click', '28-day click']];
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
  const [view, setView] = useState('results');
  const [tick, setTick] = useState(0);
  useEffect(() => { api('/funnels').then((l) => setFunnels(Array.isArray(l) ? l : l.funnels || [])).catch(() => {}); }, []);
  useEffect(() => {
    let live = true;
    setErr('');
    api(`/ads/report?days=${days}&model=${model}${funnel ? `&funnelId=${funnel}` : ''}`).then((r) => live && setD(r)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [days, model, funnel, tick]);
  const setWindow = async (window) => { try { const r = await api('/ads/window', 'PUT', { window }); toast(r.error ? `Saved — Meta couldn’t be re-read yet: ${r.error}` : 'Meta’s results pulled again in that window'); setTick((n) => n + 1); } catch (e) { toast(e.message); } };
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
        {t.impressions > 0 && <div className="kpis kpis-sm">
          {[['Reach', n0(t.reach), `${n0(t.impressions)} impressions · ${t.frequency ?? '—'} frequency`], ['CPM', t.cpm != null ? inr(t.cpm) : '—', 'cost per 1,000 impressions'], ['CTR (link)', p(t.ctr), `${n0(t.linkClicks)} link clicks · ${t.cpc != null ? inr(t.cpc) : '—'} each`], ['Landing page views', n0(t.lpv), `${p(t.lpvRate)} of clicks loaded the page`], ['Hook / hold', `${p(t.hookRate)} / ${p(t.holdRate)}`, '3-second plays per impression / ThruPlays per 3-second play'], ['Cost per customer', t.cac != null ? inr(t.cac) : '—', `${num(t.customers)} new customers`]].map(([l, v, f]) => (
            <div className="kpi" key={l}><span className="kpi-l">{l}</span><b className="kpi-v">{v}</b><div className="kpi-f"><small>{f}</small></div></div>
          ))}
        </div>}
        {t.check && (t.check.leads || t.check.sales) && (
          <Panel title="Meta’s count vs what we tracked" actions={<select value={t.check.window} onChange={(e) => setWindow(e.target.value)} aria-label="Attribution window">{WINDOWS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}>
            <div className="ads-check">{[['Leads', t.check.leads], ['Purchases', t.check.sales], ['Revenue', t.check.revenue, true]].filter(([, c]) => c).map(([l, c, money]) => (
              <div key={l}><span className="kpi-l">{l}</span><b>{money ? inr(c.meta) : num(c.meta)}</b> <small className="muted">Meta</small> · <b>{money ? inr(c.ours) : num(c.ours)}</b> <small className="muted">tracked</small>{c.diff != null && Math.abs(c.diff) >= 25 && <span className="pill warn">{c.diff > 0 ? '+' : ''}{c.diff}%</span>}</div>
            ))}</div>
            <small className="muted">A gap of more than about a quarter usually means the pixel or the URL parameters are missing on some ads, or the window counts views that didn’t really lead to the sale. Your own tracked numbers are the ones to trust for ROAS.</small>
          </Panel>
        )}

        {(!s.meta || !s.adSpend || !s.taggedAds) && (
          <Panel title="Set up ad tracking">
            <ol className="ads-setup">
              <li className={s.meta ? 'done' : ''}><b>Connect Meta Ads</b> and pick your ad account — spend per ad comes in daily. {!s.meta && <Link to="/settings#apps">Connect →</Link>}</li>
              <li className={s.taggedAds ? 'done' : ''}><b>Add this to every ad</b> (Ads Manager → your ad → Tracking → URL parameters), so each lead and sale is matched to its ad:
                <div className="ads-params"><code>{s.urlParams}</code><button className="btn ghost sm" onClick={copy}><Icon name="copy" size={14} /> Copy</button></div>
                <small className="muted">Paste it once per ad — Meta fills in each ad’s own name and id when someone clicks.</small>
              </li>
              <li><b>Use one email or phone per person</b> on your forms and checkout — that’s how a lead today is joined to their purchase next month.</li>
            </ol>
          </Panel>
        )}

        <Panel pad={false} title={<><span className="seg sm">{MODELS.map(([k, l, help]) => <button key={k} title={help} className={model === k ? 'on' : ''} onClick={() => setModel(k)}>{l}</button>)}</span> <span className="seg sm">{VIEWS.map(([k, l]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}</span></>} actions={<>
          <input className="ads-q" placeholder="Search ads…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn ghost sm" disabled={!rows.length} onClick={() => downloadCSV(`ads-${model}-click.csv`, rows.map(({ key, ...r }) => r))}><Icon name="download" size={14} /> CSV</button>
          <button className="btn ghost sm" onClick={() => nav(`/hive?ask=${encodeURIComponent(`Look at my ads report for the last ${days} days and tell me which ads to kill and which to scale`)}`)}><Icon name="sparkles" size={14} /> Ask Hive AI</button>
        </>}>
          {rows.length ? (
            <div className="tbl-wrap">
              {view === 'delivery' ? <table className="tbl ads-tbl">
                <thead><tr><th>Ad</th><th className="r">Spend</th><th className="r">Impressions</th><th className="r">Reach</th><th className="r">Frequency</th><th className="r">CPM</th><th className="r">Link clicks</th><th className="r">CTR</th><th className="r">CPC</th><th className="r" title="Landing page views, and the share of link clicks that loaded the page">Page views</th><th className="r" title="3-second video plays per impression">Hook</th><th className="r" title="ThruPlays per 3-second play">Hold</th><th className="r" title="Leads and purchases Meta counted in your attribution window">Meta results</th><th className="r">Meta ROAS</th></tr></thead>
                <tbody>{rows.filter((r) => r.impressions || r.spend).map((r) => (
                  <tr key={r.key}>
                    <AdName r={r} />
                    <td className="r">{r.spend ? inr(r.spend) : '—'}</td>
                    <td className="r">{n0(r.impressions)}</td>
                    <td className="r">{n0(r.reach)}</td>
                    <td className="r">{r.frequency ?? '—'}</td>
                    <td className="r">{r.cpm != null ? inr(r.cpm) : '—'}</td>
                    <td className="r">{n0(r.linkClicks)}</td>
                    <td className="r">{p(r.ctr)}</td>
                    <td className="r">{r.cpc != null ? inr(r.cpc) : '—'}</td>
                    <td className="r">{n0(r.lpv)}{r.lpvRate != null ? <small className="sub-t">{r.lpvRate}%</small> : null}</td>
                    <td className="r">{p(r.hookRate)}</td>
                    <td className="r">{p(r.holdRate)}</td>
                    <td className="r">{r.metaLeads || r.metaPurchases ? `${num(r.metaLeads)} leads · ${num(r.metaPurchases)} sales` : '—'}</td>
                    <td className="r">{x(r.metaRoas)}</td>
                  </tr>))}</tbody>
              </table> : <table className="tbl ads-tbl">
                <thead><tr><th>Ad</th><th className="r">Spend</th><th className="r">Leads</th><th className="r">Cost / lead</th><th className="r">Calls</th><th className="r">Sales</th><th className="r">Revenue</th><th className="r">ROAS</th><th className="r" title="Every purchase so far by the people this ad first brought in (in this period)">Lifetime value</th><th className="r">Lifetime ROAS</th><th /></tr></thead>
                <tbody>{rows.map((r) => { const v = verdict(r); return (
                  <tr key={r.key}>
                    <AdName r={r} />
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
              </table>}
            </div>
          ) : <Empty icon="chart" title="No ad traffic yet" text="Once people arrive from your ads (with the URL parameters above), every lead, call and sale shows here per ad." />}
        </Panel>
        <p className="hint">“Scale” = lifetime ROAS 2× or more · “Kill” = ₹2,000+ spent with no calls or sales. Lifetime value counts every later purchase (upsells, renewals, repeat orders) by people the ad first brought in during this period.</p>
        <WhatsAppAds days={days} />
      </>}
    </Layout>
  );
}

// an ad's name cell: its creative's thumbnail (from Meta), name, and where it sits
function AdName({ r }) {
  return (
    <td className="ads-name"><div className="ads-ad">{r.creative?.thumb && <img src={r.creative.thumb} alt="" loading="lazy" title={[r.creative.title, r.creative.body].filter(Boolean).join(' — ')} />}<div><b>{r.ad || r.campaign || (r.source === 'direct' ? 'Direct / organic' : r.source)}</b>
      <small className="sub-t">{[r.source !== 'direct' && r.source, r.ad && r.campaign, r.adset].filter(Boolean).join(' · ') || (r.campaign ? 'no ad tag' : '')}</small></div></div></td>
  );
}

// chats started from click-to-WhatsApp ads, per ad: chats, leads, orders and revenue (and spend, once Meta is synced)
function WhatsAppAds({ days }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    let live = true;
    api(`/ads/whatsapp?days=${days}`).then((r) => live && setD(r)).catch(() => live && setD({ rows: [], totals: {} }));
    return () => { live = false; };
  }, [days]);
  if (!d) return null;
  const t = d.totals;
  return (
    <Panel pad={false} title="WhatsApp chats from ads" actions={d.rows.length > 0 && <>
      <Link className="btn ghost sm" to="/inbox?filter=ads"><Icon name="chat" size={14} /> Open these chats</Link>
      <button className="btn ghost sm" onClick={() => downloadCSV('whatsapp-ads.csv', d.rows)}><Icon name="download" size={14} /> CSV</button>
    </>}>
      {d.rows.length ? (
        <div className="tbl-wrap">
          <table className="tbl ads-tbl">
            <thead><tr><th>Ad</th><th className="r">Spend</th><th className="r">Chats</th><th className="r">Cost / chat</th><th className="r" title="Shared an email, filled a form or bought">Leads</th><th className="r">Orders</th><th className="r">Revenue</th><th className="r">ROAS</th></tr></thead>
            <tbody>{d.rows.map((r) => (
              <tr key={r.adId || r.headline}>
                <td className="ads-name">{r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer"><b>{r.name || r.headline || `Ad ${r.adId}`}</b></a> : <b>{r.name || r.headline || `Ad ${r.adId}`}</b>}
                  <small className="sub-t">{[r.campaign, r.name && r.headline, r.adId && `ID ${r.adId}`].filter(Boolean).join(' · ')}</small></td>
                <td className="r">{r.spend ? inr(r.spend) : '—'}</td>
                <td className="r">{num(r.chats)}</td>
                <td className="r">{r.costPerChat != null ? inr(r.costPerChat) : '—'}</td>
                <td className="r">{num(r.leads)}</td>
                <td className="r">{num(r.orders)}</td>
                <td className="r">{inr(r.revenue)}</td>
                <td className="r"><b>{x(r.roas)}</b></td>
              </tr>))}
              <tr className="ctwa-total"><td><b>Total</b></td><td className="r">{t.spend ? inr(t.spend) : '—'}</td><td className="r">{num(t.chats)}</td><td /><td className="r">{num(t.leads)}</td><td className="r">{num(t.orders)}</td><td className="r">{inr(t.revenue)}</td><td className="r"><b>{x(t.roas)}</b></td></tr>
            </tbody>
          </table>
        </div>
      ) : <Empty icon="chat" title="No chats from ads yet" text="Run a Meta ad with the “Send WhatsApp message” button. Every chat it starts shows here, with the orders and revenue it brought." />}
    </Panel>
  );
}
