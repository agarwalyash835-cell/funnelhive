import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Layout, Panel, Icon, Empty, inr, num, downloadCSV } from '../ui';
import { AreaChart, HBars } from '../charts';

// Revenue reports: what came in, what went back, who buys and what a buyer is worth over time
const PERIODS = [['30', '30 days'], ['90', '90 days'], ['365', '12 months'], ['all', 'All time'], ['custom', 'Custom']];
const KIND_LABEL = { main: 'Main offer', bump: 'Order bumps', upsell: 'Upsells', downsell: 'Downsells', crosssell: 'Cross-sells', renewal: 'Renewals & instalments', booking: 'Paid calls', quote: 'Quotes', shipping: 'Shipping', cod_fee: 'COD fees' };
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const pctS = (v) => `${v}%`;
const monthName = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }); };

function Delta({ now, prev }) {
  if (prev == null) return null;
  if (!prev) return now ? <span className="delta up">new</span> : <span className="delta">—</span>;
  const d = ((now - prev) / prev) * 100;
  return <span className={`delta ${d >= 0 ? 'up' : 'down'}`} title="Compared with the period before">{d >= 0 ? '▲' : '▼'} {Math.abs(d).toFixed(1)}%</span>;
}
const Csv = ({ name, rows }) => <button className="btn ghost sm" disabled={!rows.length} onClick={() => downloadCSV(name, rows)}><Icon name="download" size={14} /> CSV</button>;

function Kpis({ d }) {
  const o = d.overview, p = o.prev, r = d.recurring;
  const tiles = [
    ['Gross sales', inr(o.gross), <Delta now={o.gross} prev={p?.gross} />],
    ['Refunds', inr(o.refunds), <small>{o.refundRate}% of gross</small>],
    ['Net revenue', inr(o.net), <Delta now={o.net} prev={p?.net} />],
    ['Paid orders', num(o.orders), <Delta now={o.orders} prev={p?.orders} />],
    ['Buyers', num(o.buyers), <small>{o.newShare}% new · {num(o.returningBuyers)} returning</small>],
    ['Avg. order value', inr(o.aov), <small>{inr(o.perBuyer)} per buyer</small>],
    ['Add-on revenue', `${o.addOnShare}%`, <small>{inr(o.addOnRevenue)} from bumps, upsells & cross-sells</small>],
    ['Monthly recurring', inr(r.mrr), <small>{num(r.members)} active membership{r.members === 1 ? '' : 's'}{r.pastDue ? ` · ${r.pastDue} past due` : ''}</small>],
    ['Instalments still due', inr(r.instalmentsDue), <small>{num(r.instalmentsLeft)} payment{r.instalmentsLeft === 1 ? '' : 's'} on {num(r.plans)} plan{r.plans === 1 ? '' : 's'}</small>],
    ...(o.spend ? [['Return on ad spend', o.roas != null ? `${o.roas}×` : '—', <small>{inr(o.spend)} spent</small>]] : []),
  ];
  return (
    <div className="kpis rp-kpis">
      {tiles.map(([label, value, foot]) => <div className="kpi" key={label}><span className="kpi-l">{label}</span><b className="kpi-v">{value}</b><div className="kpi-f">{foot}</div></div>)}
    </div>
  );
}

// a heat-map table: the colour follows the value, and the value is always written in the cell
function Cohorts({ c }) {
  const [view, setView] = useState('ltv');
  const max = Math.max(1, ...c.rows.flatMap((r) => r.cells.filter(Boolean).map((x) => x[view])));
  const fmt = view === 'ltv' ? inr : pctS;
  const csv = c.rows.map((r) => ({ cohort: r.month, buyers: r.buyers, ...Object.fromEntries(r.cells.map((x, i) => [`month_${i}_${view === 'ltv' ? 'revenue_per_buyer' : 'repeat_rate_pct'}`, x ? x[view] : ''])) }));
  return (
    <Panel title="Cohorts by month of first purchase" pad={false} actions={<>
      <div className="seg sm">{[['ltv', 'Revenue per buyer'], ['repeat', 'Bought again']].map(([k, l]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}</div>
      <Csv name={`cohorts-${view}.csv`} rows={csv} />
    </>}>
      {!c.rows.length ? <Empty icon="users" title="No buyers yet" text="Each month's new buyers get a row here, with what they've spent since." /> : (
        <div className="tbl-wrap">
          <table className="tbl compact rp-heat">
            <caption className="sr-only">{view === 'ltv' ? 'Cumulative revenue per buyer' : 'Share of buyers who paid again'}, by months since their first purchase</caption>
            <thead><tr><th scope="col">Cohort</th><th scope="col" className="r">Buyers</th>{Array.from({ length: c.months }, (_, i) => <th scope="col" key={i} className="r">M{i}</th>)}</tr></thead>
            <tbody>{c.rows.map((r) => (
              <tr key={r.month}>
                <th scope="row">{monthName(r.month)}</th><td className="r">{num(r.buyers)}</td>
                {r.cells.map((x, i) => x
                  ? <td key={i} className="r rp-cell" style={{ '--rp-a': `${Math.round((x[view] / max) * 70)}%` }} title={`${monthName(r.month)} buyers, month ${i}: ${fmt(x[view])}`}>{fmt(x[view])}</td>
                  : <td key={i} className="rp-none" aria-label="not yet" />)}
              </tr>
            ))}</tbody>
          </table>
          <p className="hint pad">{view === 'ltv' ? 'Total spent per buyer so far (after refunds), counting renewals and instalments in the month they were paid.' : 'Share of the cohort who had paid again by then — another order, a renewal or an instalment.'} M0 is the month of the first purchase.</p>
        </div>
      )}
    </Panel>
  );
}

const MoneyTable = ({ rows, label, file }) => (
  <Panel title={`By ${label}`} pad={false} actions={<Csv name={file} rows={rows.map((r) => ({ [label]: r.name, orders: r.orders, buyers: r.buyers, gross: r.gross, refunds: r.refunds, refund_rate_pct: r.refundRate, net: r.net, aov: r.aov }))} />}>
    {!rows.length ? <p className="hint pad">No sales in this period.</p> : (
      <div className="tbl-wrap"><table className="tbl compact">
        <thead><tr><th>{label[0].toUpperCase() + label.slice(1)}</th><th className="r">Orders</th><th className="r">Gross</th><th className="r">Refunds</th><th className="r">Net</th></tr></thead>
        <tbody>{rows.slice(0, 15).map((r) => <tr key={r.name}><td className="strong">{label === 'source' ? <span className="src">{r.name}</span> : r.name}</td><td className="r">{num(r.orders)}</td><td className="r">{inr(r.gross)}</td><td className="r muted">{r.refunds ? `${inr(r.refunds)} · ${r.refundRate}%` : '—'}</td><td className="r strong">{inr(r.net)}</td></tr>)}</tbody>
      </table></div>
    )}
  </Panel>
);

function Funnels({ rows, spend }) {
  const ads = rows.some((r) => r.spend != null);
  const csv = rows.map((r) => ({ funnel: r.name, gross: r.gross, refunds: r.refunds, refund_rate_pct: r.refundRate, net: r.net, orders: r.orders, aov: r.aov, buyers: r.buyers, buyers_acquired: r.acquired, ltv_of_acquired: r.ltv, ...(ads ? { ad_spend: r.spend ?? '', roas: r.roas ?? '' } : {}) }));
  return (
    <Panel title="By funnel" pad={false} actions={<Csv name="funnels.csv" rows={csv} />}>
      {!rows.length ? <p className="hint pad">No sales in this period.</p> : (
        <div className="tbl-wrap"><table className="tbl compact">
          <thead><tr><th>Funnel</th><th className="r">Gross</th><th className="r">Refunds</th><th className="r">Net</th><th className="r">Orders</th><th className="r">AOV</th><th className="r">Buyers</th><th className="r" title="Average lifetime value of the buyers whose first purchase was in this funnel">LTV</th>{ads && <><th className="r">Ad spend</th><th className="r">ROAS</th></>}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id || r.name}>
              <td className="strong">{r.id && !r.deleted ? <Link to={`/funnels/${r.id}/analytics`}>{r.name}</Link> : r.name}</td>
              <td className="r">{inr(r.gross)}</td><td className="r muted">{r.refunds ? <>{inr(r.refunds)}<small className="sub-t">{r.refundRate}%</small></> : '—'}</td><td className="r strong">{inr(r.net)}</td>
              <td className="r">{num(r.orders)}</td><td className="r">{inr(r.aov)}</td><td className="r">{num(r.buyers)}</td><td className="r">{r.acquired ? inr(r.ltv) : '—'}</td>
              {ads && <><td className="r">{r.spend != null ? inr(r.spend) : '—'}</td><td className="r">{r.roas != null ? <span className={`pill ${r.roas >= 2 ? 'ok' : r.roas >= 1 ? 'warn' : 'bad'}`}>{r.roas}×</span> : '—'}</td></>}
            </tr>
          ))}</tbody>
        </table>
        {spend.total > 0 && <p className="hint pad">Ad spend is matched to a funnel when the campaign's UTM-tagged visitors all landed on it.{spend.unmapped > 0 && ` ${inr(spend.unmapped)} couldn't be matched to one funnel and only counts in the overall ROAS.`}</p>}
        </div>
      )}
    </Panel>
  );
}

function Ltv({ l }) {
  const csv = l.top.map((c) => ({ name: c.name, email: c.email, phone: c.phone, lifetime_value: c.total, orders: c.orders, first_purchase: new Date(c.first).toISOString().slice(0, 10) }));
  return (
    <div className="grid-2-1">
      <Panel title="Top customers by lifetime value" pad={false} actions={<Csv name="top-customers.csv" rows={csv} />}>
        {!l.top.length ? <p className="hint pad">No buyers in this period.</p> : (
          <div className="tbl-wrap"><table className="tbl compact">
            <thead><tr><th>Customer</th><th className="r">Orders</th><th className="r">Lifetime value</th></tr></thead>
            <tbody>{l.top.map((c, i) => (
              <tr key={c.key || i}>
                <td>{c.key ? <Link to={`/contacts/${encodeURIComponent(c.key)}`}><b>{c.name || c.email}</b></Link> : <b>{c.name || c.phone || 'Guest'}</b>}{c.email && <small className="sub-t">{c.email}</small>}</td>
                <td className="r">{num(c.orders)}</td><td className="r strong">{inr(c.total)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      <Panel title="Lifetime value" actions={<Csv name="ltv-by-funnel.csv" rows={l.byFunnel.map((f) => ({ funnel: f.name, buyers: f.buyers, avg_ltv: f.avg, avg_orders: f.avgOrders }))} />}>
        <div className="mini-kpis">
          <div><b>{inr(l.avg)}</b><small>per buyer, to date</small></div>
          <div><b>{l.avgOrders}</b><small>orders per buyer</small></div>
        </div>
        {l.byFunnel.length > 0 && <HBars format={inr} items={l.byFunnel.slice(0, 8).map((f) => ({ label: f.name, value: f.avg }))} />}
        <p className="hint">Buyers whose first purchase was in this period, by the funnel they first bought from — everything they've paid since, after refunds.</p>
      </Panel>
    </div>
  );
}

export default function Reports() {
  const [period, setPeriod] = useState('30');
  const [range, setRange] = useState({ from: daysAgo(29), to: today() });
  const [applied, setApplied] = useState(null);
  const [funnel, setFunnel] = useState('');
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const qs = period === 'custom' ? (applied ? `from=${applied.from}&to=${applied.to}` : null) : `days=${period}`;
  useEffect(() => {
    if (!qs) return;
    let live = true;
    setErr('');
    api(`/reports?${qs}${funnel ? `&funnel=${encodeURIComponent(funnel)}` : ''}`).then((x) => live && setD(x)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [qs, funnel]);
  const o = d?.overview;
  const mix = o ? Object.entries(o.kinds).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: KIND_LABEL[k] || k, value: v })) : [];

  return (
    <Layout title="Reports" subtitle="Revenue, refunds, buyers and lifetime value" actions={<>
      <div className="seg rp-periods">{PERIODS.map(([k, l]) => <button key={k} className={period === k ? 'on' : ''} onClick={() => { setPeriod(k); if (k === 'custom' && !applied) setApplied(range); }}>{l}</button>)}</div>
      <select className="rp-funnel" value={funnel} onChange={(e) => setFunnel(e.target.value)} aria-label="Funnel">
        <option value="">All funnels</option>
        {(d?.funnels || []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
    </>}>
      {period === 'custom' && (
        <form className="row rp-custom" onSubmit={(e) => { e.preventDefault(); if (range.from && range.to && range.from <= range.to) setApplied({ ...range }); }}>
          <label>From <input type="date" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
          <label>To <input type="date" value={range.to} min={range.from} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
          <button className="btn ghost sm" disabled={!range.from || !range.to || range.from > range.to}>Apply</button>
        </form>
      )}
      {err ? <div className="err">{err}</div> : !d ? <div className="skeleton" /> : (
        <>
          <Kpis d={d} />
          {!o.orders && !d.cohorts.rows.length ? (
            <Panel><Empty icon="chart" title="No sales yet" text="When buyers pay on your funnels, gross sales, refunds, cohorts and lifetime value show up here. Test orders and unpaid Cash on Delivery don't count."><Link className="btn primary" to="/funnels">Go to funnels</Link></Empty></Panel>
          ) : (
            <>
              <div className="grid-2-1">
                <Panel title="Net revenue" actions={<Csv name="revenue.csv" rows={d.series.map((s) => ({ date: s.date, orders: s.orders, net: s.net, refunds: s.refunds }))} />}>
                  {d.series.length > 1 ? <AreaChart data={d.series} yKey="net" format={inr} label="Net revenue over time" /> : <p className="hint">Not enough days to draw a chart.</p>}
                </Panel>
                <Panel title="Where the money comes from">
                  <div className="mini-kpis">
                    <div><b>{inr(o.newRevenue)}</b><small>from {num(o.newBuyers)} new buyers</small></div>
                    <div><b>{inr(o.returningRevenue)}</b><small>from {num(o.returningBuyers)} returning</small></div>
                  </div>
                  {mix.length ? <HBars format={inr} items={mix} /> : <p className="hint">No items sold in this period.</p>}
                </Panel>
              </div>
              <Cohorts c={d.cohorts} />
              <Ltv l={d.ltv} />
              <Funnels rows={d.byFunnel} spend={d.spend} />
              <div className="grid-1-1">
                <MoneyTable rows={d.products} label="product" file="products.csv" />
                <MoneyTable rows={d.sources} label="source" file="sources.csv" />
              </div>
              <p className="hint">Real money only: test orders, unpaid Cash on Delivery and cancelled orders are left out. Net is after refunds; gross is net plus refunds. Foreign-currency orders are in rupees at the rate on the day.</p>
            </>
          )}
        </>
      )}
    </Layout>
  );
}
