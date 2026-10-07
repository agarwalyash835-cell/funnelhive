import { useEffect, useState } from 'react';
import { api } from '../api';
import { Layout, Panel, Icon, Empty, inr, num, ago, downloadCSV, toast } from '../ui';

export default function Orders() {
  const [d, setD] = useState(null);
  const [tab, setTab] = useState('orders');
  const [q, setQ] = useState('');
  useEffect(() => { api('/orders').then(setD); }, []);
  const match = (o) => `${o.name} ${o.email} ${o.funnel}`.toLowerCase().includes(q.toLowerCase());
  const orders = (d?.orders || []).filter(match), abandoned = (d?.abandoned || []).filter(match);
  const revenue = (d?.orders || []).reduce((a, o) => a + o.total, 0);
  const lost = abandoned.length;
  const recoverMsg = (a) => `Hi ${a.name?.split(' ')[0] || 'there'} 👋 You were just one step away from getting ${a.funnel}. Your special price is still reserved — complete your order here: ${location.origin}. Use code INDIA10 for an extra 10% OFF today!`;
  const exportCsv = () => tab === 'orders'
    ? downloadCSV('orders.csv', orders.map((o) => ({ id: o.id, date: new Date(o.at).toISOString(), name: o.name, email: o.email, funnel: o.funnel, items: o.items.map((i) => `${i.name} (${i.kind})`).join(' | '), coupon: o.coupon || '', discount: o.discount || 0, total: o.total, source: o.source, status: o.status, payment: o.provider ? `${o.provider} (${o.mode})` : 'demo' })))
    : downloadCSV('abandoned-carts.csv', abandoned.map((a) => ({ date: new Date(a.at).toISOString(), name: a.name, email: a.email, phone: a.phone, funnel: a.funnel })));

  return (
    <Layout title="Orders" subtitle="Sales, one-click upsells and abandoned checkouts." actions={<button className="btn ghost" onClick={exportCsv}><Icon name="download" size={16} /> Export CSV</button>}>
      {!d ? <div className="skeleton" /> : (
        <>
          <div className="kpis k4">
            <div className="kpi"><span className="kpi-l">Total revenue</span><b className="kpi-v">{inr(revenue)}</b></div>
            <div className="kpi"><span className="kpi-l">Orders</span><b className="kpi-v">{num(d.orders.length)}</b></div>
            <div className="kpi"><span className="kpi-l">Avg. order value</span><b className="kpi-v">{inr(d.orders.length ? revenue / d.orders.length : 0)}</b></div>
            <div className="kpi warn"><span className="kpi-l">Abandoned checkouts</span><b className="kpi-v">{num(d.abandoned.length)}</b><small>recover them via WhatsApp ↓</small></div>
          </div>
          <Panel pad={false} title={<div className="seg">
            <button className={tab === 'orders' ? 'on' : ''} onClick={() => setTab('orders')}>Orders ({num(d.orders.length)})</button>
            <button className={tab === 'abandoned' ? 'on' : ''} onClick={() => setTab('abandoned')}>Abandoned ({num(lost)})</button>
          </div>} actions={<div className="search"><Icon name="search" size={16} /><input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} /></div>}>
            {tab === 'orders' ? (!orders.length ? <Empty icon="cart" title="No orders yet" text="Orders from your checkouts and one-click upsells land here." /> : (
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Order</th><th>Customer</th><th>Funnel</th><th>Items</th><th className="r">Total</th><th>Source</th><th className="r">Date</th></tr></thead>
                <tbody>{orders.slice(0, 300).map((o) => (
                  <tr key={o.id}><td className="mono">#{o.id}</td><td><b>{o.name || '—'}</b><small className="sub-t">{o.email}</small></td><td>{o.funnel}</td>
                    <td className="items">{o.items.map((i, k) => <span key={k} className={`it k-${i.kind}`} title={`${i.name} · ${inr(i.price)}`}>{i.kind === 'main' ? i.name : i.kind}</span>)}{o.coupon && <span className="it">🏷 {o.coupon}</span>}</td>
                    <td className="r strong">{inr(o.total)}{o.mode === 'test' && <span className="pill warn" title="Paid with Razorpay test keys — no real money">test</span>}{o.provider === 'razorpay' && o.mode === 'live' && <span className="pill ok" title="Paid through Razorpay">paid</span>}</td><td><span className="src">{o.source}</span></td><td className="r muted">{new Date(o.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td></tr>
                ))}</tbody>
              </table></div>
            )) : (!abandoned.length ? <Empty icon="check" title="No abandoned checkouts 🎉" text="When someone enters their email at checkout but doesn’t pay, they show up here so you can follow up." /> : (
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Contact</th><th>Funnel</th><th className="r">When</th><th className="r">Recover</th></tr></thead>
                <tbody>{abandoned.slice(0, 300).map((a) => (
                  <tr key={a.id}><td><b>{a.name || '—'}</b><small className="sub-t">{a.email}{a.phone && ` · ${a.phone}`}</small></td><td>{a.funnel}</td><td className="r muted">{ago(a.at)}</td>
                    <td className="r"><div className="row end">
                      {a.phone && <a className="btn soft sm" href={`https://wa.me/${a.phone.replace(/\D/g, '')}?text=${encodeURIComponent(recoverMsg(a))}`} target="_blank" rel="noreferrer">💬 WhatsApp</a>}
                      <button className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(recoverMsg(a)); toast('Recovery message copied'); }}><Icon name="copy" size={14} /> Copy message</button>
                    </div></td></tr>
                ))}</tbody>
              </table></div>
            ))}
          </Panel>
        </>
      )}
    </Layout>
  );
}
