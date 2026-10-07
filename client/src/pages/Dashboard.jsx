import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Layout, Panel, Icon, Empty, CreateFunnel, RangePicker, inr, num, ago, toast } from '../ui';
import { AreaChart, Sparkline, HBars } from '../charts';

const METRICS = [
  ['revenue', 'Revenue', inr],
  ['orders', 'Orders', num],
  ['leads', 'Leads', num],
  ['views', 'Visitors', num],
];
const KIND_LABEL = { main: 'Main offer', bump: 'Order bumps', upsell: 'Upsells', downsell: 'Downsells', crosssell: 'Cross-sells' };

export function Delta({ now, prev }) {
  if (!prev) return now ? <span className="delta up">new</span> : <span className="delta">—</span>;
  const d = ((now - prev) / prev) * 100;
  return <span className={`delta ${d >= 0 ? 'up' : 'down'}`}>{d >= 0 ? '▲' : '▼'} {Math.abs(d).toFixed(1)}%</span>;
}

export function Kpis({ data }) {
  const t = data.totals, p = data.prev;
  const tiles = [
    ['Revenue', inr(t.revenue), t.revenue, p.revenue, 'revenue'],
    ['Orders', num(t.orders), t.orders, p.orders, 'orders'],
    ['Leads', num(t.leads), t.leads, p.leads, 'leads'],
    ['Visitors', num(t.visitors), t.visitors, p.visitors, 'views'],
    ['Conversion', `${t.conversion}%`, t.conversion, p.conversion, null],
    ['Avg. order value', inr(t.aov), t.aov, p.aov, null],
  ];
  return (
    <div className="kpis">
      {tiles.map(([label, value, n, prev, key]) => (
        <div className="kpi" key={label}>
          <span className="kpi-l">{label}</span>
          <b className="kpi-v">{value}</b>
          <div className="kpi-f"><Delta now={n} prev={prev} />{key && <Sparkline data={data.series} yKey={key} />}</div>
        </div>
      ))}
    </div>
  );
}

export function TrendPanel({ data }) {
  const [metric, setMetric] = useState('revenue');
  const m = METRICS.find((x) => x[0] === metric);
  return (
    <Panel title="Performance" actions={<div className="seg sm">{METRICS.map(([k, l]) => <button key={k} className={metric === k ? 'on' : ''} onClick={() => setMetric(k)}>{l}</button>)}</div>}>
      <AreaChart data={data.series} yKey={metric} format={m[2]} label={`${m[1]} per day`} />
    </Panel>
  );
}

export const OfferMix = ({ byKind }) => (
  <HBars format={inr} items={Object.entries(KIND_LABEL).map(([k, label]) => ({ label, value: byKind[k] || 0 }))} />
);

export const Sources = ({ rows }) => (
  <table className="tbl compact">
    <thead><tr><th>Source</th><th className="r">Visitors</th><th className="r">Orders</th><th className="r">Revenue</th></tr></thead>
    <tbody>{rows.slice(0, 7).map((s) => <tr key={s.source}><td><span className="src">{s.source}</span></td><td className="r">{num(s.views)}</td><td className="r">{num(s.orders)}</td><td className="r">{inr(s.revenue)}</td></tr>)}</tbody>
  </table>
);

export default function Dashboard() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [me, setMe] = useState(null);
  const [create, setCreate] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const load = () => { api(`/analytics/overview?days=${days}`).then(setData); api('/me').then(setMe); };
  useEffect(() => { load(); }, [days]);
  const removeDemo = async () => {
    if (!confirm('Remove all demo visits, leads and orders? Your real data stays untouched.')) return;
    await api('/demo', 'DELETE'); toast('Demo data removed'); load();
  };
  const seed = async () => { setSeeding(true); await api('/demo/seed', 'POST'); setSeeding(false); toast('Demo data loaded — explore away!'); load(); };

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const ob = me?.onboarding;
  const checklist = ob && [
    ['Create your first funnel', ob.funnel, () => setCreate(true)],
    ['Publish it', ob.published, '/funnels'],
    ['Connect payments (Razorpay / Stripe)', ob.payments, '/settings'],
    ['Add Meta Pixel or Google Analytics', ob.tracking, '/settings'],
    ['Capture your first lead', ob.lead, '/funnels'],
  ];
  const doneCount = checklist?.filter((c) => c[1]).length || 0;
  const noData = data && !data.funnels.length;

  return (
    <Layout
      title={`${greet}${me ? `, ${me.name.split(' ')[0]}` : ''} 👋`}
      subtitle="Here’s how your funnels are performing."
      actions={<>
        {data && !noData && <RangePicker value={days} onChange={setDays} />}
        <button className="btn primary" onClick={() => setCreate(true)}><Icon name="plus" /> New funnel</button>
      </>}
    >
      {create && <CreateFunnel onClose={() => setCreate(false)} aiEnabled={me?.aiEnabled} />}
      {!data ? <div className="skeleton" /> : noData ? (
        <div className="hero-empty">
          <div>
            <span className="ca-badge"><Icon name="sparkles" size={14} /> Zero learning curve</span>
            <h2>Launch your first funnel in 60 seconds</h2>
            <p>Describe your business in one line and our AI builds the full funnel — landing page, checkout, order bump, upsell, downsell, cross-sells and thank-you page — ready to publish.</p>
            <div className="row">
              <button className="btn primary lg" onClick={() => setCreate(true)}><Icon name="wand" /> Build with AI</button>
              <Link className="btn ghost lg" to="/templates"><Icon name="layout" /> Browse 53 templates</Link>
            </div>
            <button className="linkish" onClick={seed} disabled={seeding}>{seeding ? 'Loading demo…' : 'Or explore with demo data →'}</button>
          </div>
          <ol className="how">
            <li><b>1</b><div><h4>Describe it</h4><p>“Online yoga classes for women, ₹499”</p></div></li>
            <li><b>2</b><div><h4>Chat to tweak it</h4><p>“Make it dark, add an upsell”</p></div></li>
            <li><b>3</b><div><h4>Publish & sell</h4><p>UPI-ready checkout, analytics built in</p></div></li>
          </ol>
        </div>
      ) : (
        <>
          {checklist && doneCount < 5 && (
            <Panel className="onboard" title={`Get set up · ${doneCount}/5 done`} actions={!data.totals.views && <button className="btn ghost sm" onClick={seed} disabled={seeding}>{seeding ? 'Loading…' : 'Load demo data'}</button>}>
              <div className="ob-bar"><div style={{ width: `${doneCount * 20}%` }} /></div>
              <div className="ob-list">
                {checklist.map(([label, done, go]) => (
                  typeof go === 'string'
                    ? <Link key={label} to={go} className={`ob ${done ? 'done' : ''}`}><span className="ob-c">{done && <Icon name="check" size={13} />}</span>{label}</Link>
                    : <button key={label} onClick={go} className={`ob ${done ? 'done' : ''}`}><span className="ob-c">{done && <Icon name="check" size={13} />}</span>{label}</button>
                ))}
              </div>
            </Panel>
          )}
          {me?.hasDemo && (
            <div className="demo-banner"><Icon name="sparkles" size={16} /><span><b>You’re viewing demo data.</b> It’s here so you can explore the dashboards — remove it before you go live.</span><button className="btn ghost sm" onClick={removeDemo}><Icon name="trash" size={14} /> Remove demo data</button></div>
          )}
          <Kpis data={data} />
          <div className="grid-2-1">
            <TrendPanel data={data} />
            <Panel title="Revenue by offer type"><OfferMix byKind={data.byKind} /><p className="hint">Bumps, upsells & cross-sells lift your average order value.</p></Panel>
          </div>
          <div className="grid-2-1">
            <Panel title="Your funnels" actions={<Link className="btn ghost sm" to="/funnels">View all</Link>} pad={false}>
              <table className="tbl">
                <thead><tr><th>Funnel</th><th className="r">Visitors</th><th className="r">Orders</th><th className="r">Conv.</th><th className="r">Revenue</th><th /></tr></thead>
                <tbody>{data.funnels.slice(0, 6).map((f) => (
                  <tr key={f.id}>
                    <td><Link to={`/funnels/${f.id}`} className="strong">{f.name}</Link> <span className={`pill ${f.published ? 'ok' : ''}`}>{f.published ? 'Live' : 'Draft'}</span></td>
                    <td className="r">{num(f.visitors)}</td><td className="r">{num(f.orders)}</td><td className="r">{f.conversion}%</td><td className="r strong">{inr(f.revenue)}</td>
                    <td className="r"><Link className="icon-btn" to={`/funnels/${f.id}/analytics`} title="Analytics"><Icon name="chart" size={16} /></Link></td>
                  </tr>
                ))}</tbody>
              </table>
            </Panel>
            <Panel title="Traffic sources" pad={false}><Sources rows={data.sources} /></Panel>
          </div>
          <Panel title="Recent orders" actions={<Link className="btn ghost sm" to="/orders">All orders</Link>} pad={false}>
            {data.recentOrders.length ? (
              <table className="tbl">
                <thead><tr><th>Customer</th><th>Funnel</th><th>Items</th><th className="r">Total</th><th className="r">When</th></tr></thead>
                <tbody>{data.recentOrders.map((o) => (
                  <tr key={o.id}><td><b>{o.name || '—'}</b><small className="sub-t">{o.email}</small></td><td>{o.funnel}</td><td className="items">{o.items.map((i, k) => <span key={k} className={`it k-${i.kind}`}>{i.kind === 'main' ? i.name : i.kind}</span>)}</td><td className="r strong">{inr(o.total)}</td><td className="r muted">{ago(o.at)}</td></tr>
                ))}</tbody>
              </table>
            ) : <Empty icon="cart" title="No orders yet" text="Publish a funnel and share the link — orders will show up here in real time." />}
          </Panel>
        </>
      )}
    </Layout>
  );
}
