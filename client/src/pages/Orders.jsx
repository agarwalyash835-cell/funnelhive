import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Layout, Panel, Icon, Empty, Modal, inr, num, ago, downloadCSV, toast } from '../ui';

const STATUS = { refunded: ['Refunded', 'bad'], partially_refunded: ['Part refunded', 'warn'], cod: ['COD · unpaid', 'warn'], cancelled: ['Cancelled', 'bad'] };
const PLAN = { active: ['', 'ok'], authenticated: ['starting', ''], created: ['starting', ''], pending: ['payment due', 'warn'], halted: ['payment failed', 'bad'], cancelled: ['cancelled', 'bad'], completed: ['paid in full', 'ok'], expired: ['ended', ''], demo: ['demo', ''] };
const SHIP = { pending: ['To ship', ''], shipped: ['Shipped', 'info'], delivered: ['Delivered', 'ok'], returned: ['Returned', 'bad'] };
const addrText = (a) => (a ? [a.line1, a.line2, `${a.city}${a.state ? `, ${a.state}` : ''} – ${a.pincode}`].filter(Boolean).join(', ') : '');
const SYM = { USD: '$', EUR: '€', GBP: '£', AUD: 'A$', CAD: 'C$', SGD: 'S$', AED: 'AED ' };
const money = (n, o) => (o?.currency && o.currency !== 'INR' ? `${SYM[o.currency] || `${o.currency} `}${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : inr(n));
const planLabel = (pl, o) => (pl.type === 'installments' ? `${Math.min(pl.paid || 1, pl.count)}/${pl.count} instalments` : `${money(pl.amount, o)}/${pl.interval === 'yearly' ? 'yr' : 'mo'}`);
const campaignOf = (o) => [o.attr?.utm_campaign, o.attr?.utm_content].filter(Boolean).join(' · ');
// no real money moved: Razorpay/Stripe test keys, or a checkout placed while no payment provider was connected
const isTest = (o) => o.mode === 'test' || (!o.provider && !o.demo && o.paymentMethod !== 'cod' && o.total > 0 && !['cod', 'cancelled'].includes(o.status));
// money that actually came in, in ₹: paid orders after refunds — a refund already comes off total (server/sales.js) — COD counts once collected
const netOf = (o) => (isTest(o) || ['cod', 'cancelled'].includes(o.status) ? 0 : (o.total || 0) * (o.fx || 1));
const realPaid = (o) => !isTest(o) && !['cod', 'cancelled'].includes(o.status);
const thisYear = new Date().getFullYear();
const shortDate = (t) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(new Date(t).getFullYear() !== thisYear ? { year: 'numeric' } : {}) });
const fullDate = (t) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const RANGES = [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last 12 months'], [0, 'All time']];
const FILTERS = [['all', 'All orders'], ['paid', 'Paid'], ['cod', 'COD to collect'], ['ship', 'To ship'], ['refunded', 'Refunded'], ['plan', 'Memberships & instalments'], ['test', 'Test orders']];
const statusMatch = (o, s) => s === 'all' || (s === 'paid' ? realPaid(o) && !['refunded'].includes(o.status) : s === 'cod' ? o.status === 'cod' : s === 'ship' ? o.fulfilment?.status === 'pending' && !['cancelled', 'refunded'].includes(o.status) : s === 'refunded' ? ['refunded', 'partially_refunded'].includes(o.status) : s === 'plan' ? !!o.plan : isTest(o));
const PAGE = 100;

export default function Orders() {
  const [d, setD] = useState(null);
  const [tab, setTab] = useState('orders');
  const [q, setQ] = useState('');
  const [days, setDays] = useState(0);
  const [funnel, setFunnel] = useState('');
  const [status, setStatus] = useState('all');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState(null);
  const [refund, setRefund] = useState(null);
  const [ship, setShip] = useState(null);
  const load = () => api('/orders').then((r) => { setD(r); setOpen((o) => (o ? r.orders.find((x) => x.id === o.id) || null : null)); });
  useEffect(() => { load(); }, []);
  useEffect(() => { setLimit(PAGE); }, [q, days, funnel, status, tab]);
  const since = days ? Date.now() - days * 864e5 : 0;
  const match = (o) => o.at >= since && (!funnel || o.funnel === funnel) && `${o.name} ${o.email} ${o.phone || ''} ${o.funnel} ${o.id} ${campaignOf(o)} ${(o.tags || []).join(' ')} ${o.note || ''}`.toLowerCase().includes(q.toLowerCase());
  const all = d?.orders || [];
  const inView = all.filter(match);
  const orders = inView.filter((o) => statusMatch(o, status));
  const abandoned = (d?.abandoned || []).filter(match);
  const funnels = [...new Set(all.map((o) => o.funnel))].sort();
  // the numbers follow the period and funnel chosen; test orders never count as revenue
  const paid = inView.filter(realPaid);
  const revenue = inView.reduce((a, o) => a + netOf(o), 0);
  const gross = paid.reduce((a, o) => a + (o.total || 0) * (o.fx || 1), 0);
  const refunded = inView.filter((o) => !isTest(o)).reduce((a, o) => a + (o.refunded || 0) * (o.fx || 1), 0);
  const codDue = inView.filter((o) => o.status === 'cod').reduce((a, o) => a + o.total * (o.fx || 1), 0);
  const tests = inView.filter(isTest).length;
  const toShip = all.filter((o) => statusMatch(o, 'ship'));
  const planCancel = async (o) => {
    if (!confirm(o.plan.type === 'recurring' ? 'Cancel this membership? The buyer keeps access until the end of the period they paid for.' : 'Stop the remaining instalments? Nothing more is charged; the buyer keeps access.')) return;
    try { await api(`/orders/${o.id}/plan/cancel`, 'POST', {}); toast('Cancelled'); load(); } catch (e) { toast(e.message); }
  };
  const codAct = async (o, action) => {
    if (action === 'cancel' && !confirm(`Cancel COD order #${o.id}? The buyer’s access (if any) is removed.`)) return;
    try { await api(`/orders/${o.id}/cod`, 'POST', { action }); toast(action === 'paid' ? 'Marked paid — invoice and delivery sent' : 'Order cancelled'); load(); } catch (e) { toast(e.message); }
  };
  // a courier-ready sheet (Shiprocket / Delhivery bulk upload columns) of everything waiting to ship
  const exportShipping = () => {
    if (!toShip.length) return toast('Nothing waiting to ship');
    downloadCSV('to-ship.csv', toShip.map((o) => ({ order_id: o.id, order_date: new Date(o.at).toISOString().slice(0, 10), customer_name: o.name, phone: o.phone, email: o.email, address_line1: o.address?.line1, address_line2: o.address?.line2 || '', city: o.address?.city, state: o.address?.state || '', pincode: o.address?.pincode, products: o.items.filter((i) => !['shipping', 'cod_fee'].includes(i.kind)).map((i) => i.name).join(' | '), payment_method: o.status === 'cod' ? 'COD' : 'Prepaid', cod_amount: o.status === 'cod' ? o.total : 0, order_total: o.total })));
  };
  const recoverMsg = (a) => `Hi ${a.name?.split(' ')[0] || 'there'} 👋 You were one step away from getting ${a.funnel}.${a.link ? ` You can finish your order here: ${a.link}` : ' Reply here and we’ll help you finish your order.'}`;
  const exportCsv = () => tab === 'orders'
    ? downloadCSV('orders.csv', orders.map((o) => ({ id: o.id, date: new Date(o.at).toISOString(), name: o.name, email: o.email, phone: o.phone, funnel: o.funnel, items: o.items.map((i) => `${i.name} (${i.kind})${i.refunded ? ' [refunded]' : ''}`).join(' | '), coupon: o.coupon || '', discount: o.discount || 0, currency: o.currency || 'INR', total: o.total, refunded: o.refunded || 0, status: o.status, test: isTest(o) ? 'yes' : '', tags: (o.tags || []).join(' | '), note: o.note || '', source: o.source, utm_source: o.attr?.utm_source || '', utm_medium: o.attr?.utm_medium || '', utm_campaign: o.attr?.utm_campaign || '', utm_content: o.attr?.utm_content || '', utm_term: o.attr?.utm_term || '', click_id: o.attr?.fbclid ? 'fbclid' : o.attr?.gclid ? 'gclid' : '', invoices: (o.invoices || []).map((i) => i.number).join(' | '), payment: o.provider ? `${o.provider} (${o.mode})` : 'none' })))
    : downloadCSV('abandoned-carts.csv', abandoned.map((a) => ({ date: new Date(a.at).toISOString(), name: a.name, email: a.email, phone: a.phone, funnel: a.funnel, link: a.link || '', utm_campaign: a.attr?.utm_campaign || '' })));
  // GST register for filing (GSTR-1): every invoice and credit note
  const exportInvoices = async () => {
    const list = await api('/sales-invoices');
    if (!list.length) return toast('No invoices yet — turn on GST invoices in Settings');
    downloadCSV('gst-invoices.csv', list.map((i) => ({ number: i.number, type: i.type === 'credit' ? 'Credit note' : 'Invoice', against: i.against || '', date: new Date(i.at).toISOString().slice(0, 10), buyer: i.billedTo.name, buyer_email: i.billedTo.email, buyer_gstin: i.billedTo.gstin, place_of_supply: i.placeOfSupply, state_code: i.billedTo.stateCode || '', taxable: i.taxable, rate: i.rate, cgst: i.cgst, sgst: i.sgst, igst: i.igst, total: i.total, payment: i.paymentId || '', order: i.orderId })));
  };
  const actions = (o) => (
    <div className="row end" onClick={(e) => e.stopPropagation()}>
      {(o.invoices || []).map((i) => <a key={i.id} className="icon-btn" title={`${i.type === 'credit' ? 'Credit note' : 'Invoice'} ${i.number}`} href={i.url} target="_blank" rel="noreferrer"><Icon name="receipt" size={15} /></a>)}
      {o.fulfilment && !['cancelled', 'refunded'].includes(o.status) && <button className="icon-btn" title="Shipping" onClick={() => setShip(o)}><Icon name="box" size={15} /></button>}
      {o.plan?.subId && ['active', 'pending', 'halted', 'authenticated'].includes(o.plan.status) && !o.plan.cancelAtEnd && <button className="icon-btn" title={o.plan.type === 'recurring' ? 'Cancel membership (at the end of the paid period)' : 'Stop the remaining instalments'} onClick={() => planCancel(o)}><Icon name="x" size={15} /></button>}
      {o.status === 'cod' && <button className="btn soft sm" title="Cash collected — issue the invoice and deliver" onClick={() => codAct(o, 'paid')}>Paid</button>}
      {o.status === 'cod' && <button className="icon-btn" title="Cancel this COD order" onClick={() => codAct(o, 'cancel')}><Icon name="x" size={15} /></button>}
      {!['refunded', 'cod', 'cancelled'].includes(o.status) && <button className="icon-btn" title="Refund" onClick={() => setRefund(o)}><Icon name="refund" size={15} /></button>}
    </div>
  );
  const payPill = (o) => (isTest(o) ? <span className="pill warn" title={o.mode === 'test' ? 'Paid with test keys — no real money' : 'Placed while no payment provider was connected — no money was collected'}>test</span> : o.provider && o.mode === 'live' && !['cod', 'cancelled'].includes(o.status) ? <span className="pill ok" title={`Paid through ${o.provider === 'stripe' ? 'Stripe' : 'Razorpay'}`}>paid</span> : null);

  return (
    <Layout title="Orders" subtitle="Sales, one-click upsells, refunds and abandoned checkouts." actions={<>
      {toShip.length > 0 && <button className="btn ghost" onClick={exportShipping}><Icon name="box" size={16} /> To ship ({num(toShip.length)})</button>}
      <button className="btn ghost" onClick={exportInvoices}><Icon name="receipt" size={16} /> GST invoices</button>
      <button className="btn ghost" onClick={exportCsv}><Icon name="download" size={16} /> Export CSV</button>
    </>}>
      {!d ? <div className="skeleton" /> : (
        <>
          <div className="or-filters">
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">{RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <select value={funnel} onChange={(e) => setFunnel(e.target.value)} aria-label="Funnel"><option value="">All funnels</option>{funnels.map((f) => <option key={f}>{f}</option>)}</select>
            {tab === 'orders' && <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">{FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}
            {(days || funnel || status !== 'all' || q) ? <button className="link-btn" onClick={() => { setDays(0); setFunnel(''); setStatus('all'); setQ(''); }}>Clear filters</button> : null}
          </div>
          <div className="kpis k4">
            <div className="kpi"><span className="kpi-l">Revenue · after refunds</span><b className="kpi-v">{inr(revenue)}</b>{refunded > 0 && <small>{inr(refunded)} refunded</small>}{codDue > 0 && <small>+ {inr(codDue)} COD to collect</small>}</div>
            <div className="kpi"><span className="kpi-l">Paid orders</span><b className="kpi-v">{num(paid.length)}</b>{tests > 0 && <small>+ {num(tests)} test, not counted</small>}</div>
            <div className="kpi"><span className="kpi-l">Avg. order value</span><b className="kpi-v">{inr(paid.length ? gross / paid.length : 0)}</b></div>
            <div className="kpi warn"><span className="kpi-l">Abandoned checkouts</span><b className="kpi-v">{num(abandoned.length)}</b><small>recover them via WhatsApp ↓</small></div>
          </div>
          <Panel pad={false} title={<div className="seg">
            <button className={tab === 'orders' ? 'on' : ''} onClick={() => setTab('orders')}>Orders ({num(orders.length)})</button>
            <button className={tab === 'abandoned' ? 'on' : ''} onClick={() => setTab('abandoned')}>Abandoned ({num(abandoned.length)})</button>
          </div>} actions={<div className="search"><Icon name="search" size={16} /><input placeholder="Search name, email, tag, campaign…" value={q} onChange={(e) => setQ(e.target.value)} /></div>}>
            {tab === 'orders' ? (!orders.length ? <Empty icon="cart" title={all.length ? 'No orders match' : 'No orders yet'} text={all.length ? 'Try another period, funnel or status.' : 'Orders from your checkouts and one-click upsells land here.'} /> : (
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Order</th><th>Customer</th><th>Funnel</th><th>Items</th><th className="r">Total</th><th>Source</th><th className="r">Date</th><th /></tr></thead>
                <tbody>{orders.slice(0, limit).map((o) => (
                  <tr key={o.id} className="click" onClick={() => setOpen(o)}>
                    <td className="mono">#{o.id}{STATUS[o.status] && <span className={`pill ${STATUS[o.status][1]}`}>{STATUS[o.status][0]}</span>}{(o.tags || []).map((t) => <span key={t} className="pill or-tag">{t}</span>)}</td>
                    <td><b>{o.name || '—'}</b><small className="sub-t">{o.email}</small>{o.address && <small className="sub-t addr" title={addrText(o.address)}>📍 {o.address.city} {o.address.pincode}</small>}</td><td>{o.funnel}</td>
                    <td className="items">{o.fulfilment && SHIP[o.fulfilment.status] && <span className={`pill ${SHIP[o.fulfilment.status][1]}`} title={[o.fulfilment.courier, o.fulfilment.tracking].filter(Boolean).join(' · ')}>{SHIP[o.fulfilment.status][0]}</span>}{o.items.map((i, k) => <span key={k} className={`it k-${i.kind} ${i.refunded ? 'refunded' : ''}`} title={`${i.name} · ${money(i.price, o)}${i.refunded ? ' · refunded' : ''}`}>{i.productId && '📦 '}{i.kind === 'main' ? i.name : i.kind}</span>)}{o.coupon && <span className="it">🏷 {o.coupon}</span>}{o.plan && <span className={`pill ${PLAN[o.plan.status]?.[1] || ''}`}>🔁 {planLabel(o.plan, o)}{PLAN[o.plan.status]?.[0] ? ` · ${PLAN[o.plan.status][0]}` : ''}{o.plan.cancelAtEnd ? ' · ending' : ''}</span>}
                      {o.undelivered && <span className="it warn" title="Products are delivered only after a real payment (Razorpay or Stripe)">not delivered</span>}{o.note && <span className="it" title={o.note}>📝 note</span>}</td>
                    <td className="r strong">{money(o.total, o)}{o.currency && o.currency !== 'INR' && <small className="sub-t" title="Counted in your revenue at this rate">≈ {inr(o.total * (o.fx || 1))}</small>}{o.refunded > 0 && <small className="sub-t">−{money(o.refunded, o)}</small>}{payPill(o)}</td>
                    <td><span className="src">{o.attr?.utm_source || o.source}</span>{campaignOf(o) && <small className="sub-t" title={[o.attr?.utm_medium, o.attr?.utm_term].filter(Boolean).join(' · ')}>{campaignOf(o)}</small>}</td>
                    <td className="r muted" title={fullDate(o.at)}>{shortDate(o.at)}</td>
                    <td className="r">{actions(o)}</td>
                  </tr>
                ))}</tbody>
              </table>
              {orders.length > limit && <div className="or-more"><button className="btn ghost sm" onClick={() => setLimit(limit + PAGE * 2)}>Show more ({num(orders.length - limit)} older)</button></div>}
              </div>
            )) : (!abandoned.length ? <Empty icon="check" title="No abandoned checkouts" text="When someone enters their email at checkout but doesn’t pay, they show up here so you can follow up." /> : (
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Contact</th><th>Funnel</th><th className="r">When</th><th className="r">Recover</th></tr></thead>
                <tbody>{abandoned.slice(0, limit).map((a) => (
                  <tr key={a.id}><td><b>{a.name || '—'}</b><small className="sub-t">{a.email}{a.phone && ` · ${a.phone}`}</small></td><td>{a.funnel}</td><td className="r muted" title={fullDate(a.at)}>{ago(a.at)}</td>
                    <td className="r"><div className="row end">
                      {a.phone && <a className="btn soft sm" href={`https://wa.me/${a.phone.replace(/\D/g, '').replace(/^(\d{10})$/, '91$1')}?text=${encodeURIComponent(recoverMsg(a))}`} target="_blank" rel="noreferrer">💬 WhatsApp</a>}
                      {a.email && <a className="icon-btn" title="Email" href={`mailto:${a.email}?subject=${encodeURIComponent(`Your order — ${a.funnel}`)}&body=${encodeURIComponent(recoverMsg(a))}`}><Icon name="mail" size={15} /></a>}
                      <button className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(recoverMsg(a)); toast('Recovery message copied'); }}><Icon name="copy" size={14} /> Copy message</button>
                    </div></td></tr>
                ))}</tbody>
              </table>
              {abandoned.length > limit && <div className="or-more"><button className="btn ghost sm" onClick={() => setLimit(limit + PAGE * 2)}>Show more</button></div>}
              </div>
            ))}
          </Panel>
        </>
      )}
      {open && <OrderDetail o={open} actions={actions(open)} onClose={() => setOpen(null)} onSaved={load} />}
      {ship && <ShipModal o={ship} onClose={() => setShip(null)} onDone={() => { setShip(null); load(); }} />}
      {refund && <RefundModal o={refund} onClose={() => setRefund(null)} onDone={() => { setRefund(null); load(); }} />}
    </Layout>
  );
}

// one order in full: items, payment, customer, delivery, invoices — plus your own note and tags
function OrderDetail({ o, actions, onClose, onSaved }) {
  const [note, setNote] = useState(o.note || '');
  const [tags, setTags] = useState((o.tags || []).join(', '));
  const [busy, setBusy] = useState(false);
  const dirty = note !== (o.note || '') || tags !== (o.tags || []).join(', ');
  const save = async () => {
    setBusy(true);
    try { await api(`/orders/${o.id}`, 'PUT', { note, tags: tags.split(',') }); toast('Saved'); onSaved(); } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const ck = o.email ? o.email.trim().toLowerCase() : o.phone ? `phone:${o.phone.trim()}` : '';
  const payIds = [...new Set(o.items.map((i) => i.paymentId).filter(Boolean))];
  const attr = Object.entries(o.attr || {}).filter(([k, v]) => v && /^(utm_|fbclid|gclid|ref)/.test(k));
  return (
    <Modal title={`Order #${o.id}`} onClose={onClose} width={720}>
      <div className="m-body od">
        <div className="od-top">
          <div><b className="od-total">{money(o.total, o)}</b>{STATUS[o.status] && <span className={`pill ${STATUS[o.status][1]}`}>{STATUS[o.status][0]}</span>}{isTest(o) && <span className="pill warn">test · no real money</span>}<small className="sub-t">{fullDate(o.at)} · {o.funnel}</small></div>
          {actions}
        </div>
        <div className="od-grid">
          <section>
            <h4>Customer</h4>
            <p><b>{o.name || '—'}</b><br />{o.email}{o.phone && <><br />{o.phone}</>}</p>
            {o.address && <p className="muted sm">{addrText(o.address)}</p>}
            {o.gstin && <p className="muted sm">GSTIN {o.gstin}</p>}
            <div className="row">{ck && <Link className="btn ghost sm" to={`/contacts/${encodeURIComponent(ck)}`}>Open contact</Link>}{o.phone && <a className="btn ghost sm" href={`https://wa.me/${o.phone.replace(/\D/g, '').replace(/^(\d{10})$/, '91$1')}`} target="_blank" rel="noreferrer">WhatsApp</a>}</div>
          </section>
          <section>
            <h4>Payment</h4>
            <p>{o.status === 'cod' ? 'Cash on delivery — not collected yet' : o.demo ? 'Sample order (demo data)' : o.provider ? `${o.provider === 'stripe' ? 'Stripe' : 'Razorpay'} · ${o.mode === 'test' ? 'test keys' : 'live'}` : 'No payment provider connected — nothing was charged'}</p>
            {payIds.map((p) => <p key={p} className="mono sm muted">{p}</p>)}
            {o.plan && <p>🔁 {planLabel(o.plan, o)}{PLAN[o.plan.status]?.[0] ? ` · ${PLAN[o.plan.status][0]}` : ''}{o.plan.nextAt ? ` · next ${new Date(o.plan.nextAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}</p>}
            {(o.invoices || []).length > 0 && <p>{o.invoices.map((i) => <a key={i.id} className="od-inv" href={i.url} target="_blank" rel="noreferrer">{i.type === 'credit' ? 'Credit note' : 'Invoice'} {i.number}</a>)}</p>}
          </section>
        </div>
        <section>
          <h4>Items</h4>
          <table className="od-items"><tbody>
            {o.items.map((i, k) => <tr key={k} className={i.refunded ? 'refunded' : ''}><td>{i.name}<small className="muted"> · {i.kind}{i.refunded ? ` · refunded ${new Date(i.refunded.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}</small></td><td className="r">{money(i.price, o)}</td></tr>)}
            {o.discount > 0 && <tr><td>Discount{o.coupon ? ` (${o.coupon})` : ''}</td><td className="r">−{money(o.discount, o)}</td></tr>}
            <tr className="od-sum"><td>Total</td><td className="r">{money(o.total, o)}</td></tr>
            {o.refunded > 0 && <tr><td>Refunded</td><td className="r">−{money(o.refunded, o)}</td></tr>}
            {o.refunded > 0 && <tr className="od-sum"><td>Kept</td><td className="r">{money(o.total - o.refunded, o)}</td></tr>}
          </tbody></table>
        </section>
        {(o.fulfilment || attr.length > 0 || o.source) && (
          <div className="od-grid">
            {o.fulfilment && <section><h4>Delivery</h4><p>{SHIP[o.fulfilment.status]?.[0] || o.fulfilment.status}{o.fulfilment.courier ? ` · ${o.fulfilment.courier} ${o.fulfilment.tracking || ''}` : ''}</p>{o.fulfilment.trackingUrl && <a href={o.fulfilment.trackingUrl} target="_blank" rel="noreferrer">Track the parcel ↗</a>}</section>}
            <section><h4>Where they came from</h4><p>{o.attr?.utm_source || o.source || 'direct'}</p>{attr.map(([k, v]) => <p key={k} className="muted sm">{k}: {String(v).slice(0, 80)}</p>)}</section>
          </div>
        )}
        <section>
          <h4>Your note &amp; tags <small className="muted">· only you see these</small></h4>
          <textarea rows={2} value={note} maxLength={2000} placeholder="e.g. Called to confirm the address · wants a GST invoice" onChange={(e) => setNote(e.target.value)} />
          <input value={tags} placeholder="Tags, separated by commas — e.g. VIP, wholesale" onChange={(e) => setTags(e.target.value)} />
          <div className="row end"><button className="btn primary sm" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></div>
        </section>
      </div>
    </Modal>
  );
}

const COURIERS = ['Delhivery', 'Blue Dart', 'DTDC', 'India Post', 'Ekart', 'Xpressbees', 'Shiprocket', 'Ecom Express'];
function ShipModal({ o, onClose, onDone }) {
  const ff = o.fulfilment || {};
  const [v, setV] = useState({ courier: ff.courier || 'Delhivery', tracking: ff.tracking || '', trackingUrl: '' });
  const [busy, setBusy] = useState(false);
  const go = async (status) => {
    if (status === 'shipped' && !v.tracking.trim()) return toast('Add the tracking (AWB) number');
    if (status === 'returned' && !confirm(o.status === 'cod' ? 'Mark as returned? The unpaid COD order is cancelled.' : 'Mark as returned? Refund the buyer from Orders if needed.')) return;
    setBusy(true);
    try { await api(`/orders/${o.id}/fulfil`, 'POST', { status, ...v }); toast(status === 'shipped' ? 'Marked shipped — the buyer got the tracking link' : status === 'delivered' ? (o.status === 'cod' ? 'Delivered — cash collected, invoice sent' : 'Marked delivered') : 'Updated'); onDone(); } catch (e) { toast(e.message); }
    setBusy(false);
  };
  return (
    <Modal title={`Shipping · #${o.id}`} onClose={onClose}>
      <div className="m-body">
        <div className="ship-to"><b>{o.name}</b> · {o.phone}<br />{addrText(o.address) || 'No address on this order'}{o.status === 'cod' && <div className="pill warn">Collect {money(o.total, o)} in cash</div>}</div>
        {ff.status !== 'delivered' && ff.status !== 'returned' && (
          <div className="form2">
            <label className="fld"><span>Courier</span><input list="couriers" value={v.courier} onChange={(e) => setV({ ...v, courier: e.target.value })} /><datalist id="couriers">{COURIERS.map((c) => <option key={c} value={c} />)}</datalist></label>
            <label className="fld"><span>Tracking / AWB number</span><input value={v.tracking} onChange={(e) => setV({ ...v, tracking: e.target.value })} /></label>
            <label className="fld full"><span>Tracking link <small className="muted">· optional — filled in for the couriers above</small></span><input value={v.trackingUrl} onChange={(e) => setV({ ...v, trackingUrl: e.target.value })} placeholder="https://…" /></label>
          </div>
        )}
        <p className="hint">Status: <b>{SHIP[ff.status]?.[0] || 'To ship'}</b>{ff.courier ? ` · ${ff.courier} ${ff.tracking || ''}` : ''}. Shipping emails the buyer the tracking link and runs your “order shipped” automations.</p>
        <div className="row end">
          {ff.status === 'shipped' && <button className="btn ghost" disabled={busy} onClick={() => go('returned')}>Returned (RTO)</button>}
          {ff.status === 'shipped' && <button className="btn primary" disabled={busy} onClick={() => go('delivered')}>Delivered</button>}
          {(ff.status === 'pending' || ff.status === 'shipped') && <button className={`btn ${ff.status === 'pending' ? 'primary' : 'ghost'}`} disabled={busy} onClick={() => go('shipped')}>{ff.status === 'shipped' ? 'Update tracking' : 'Mark shipped'}</button>}
        </div>
      </div>
    </Modal>
  );
}

function RefundModal({ o, onClose, onDone }) {
  const open = o.items.map((it, i) => ({ ...it, i })).filter((it) => !it.refunded);
  const [pick, setPick] = useState(open.map((it) => it.i));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const amount = open.filter((it) => pick.includes(it.i)).reduce((s, it) => s + it.price, 0);
  const viaRzp = open.some((it) => pick.includes(it.i) && it.paymentId);
  const via = o.provider === 'stripe' || open.some((it) => String(it.paymentId || '').startsWith('pi_')) ? 'Stripe' : 'Razorpay';
  const go = async () => {
    setBusy(true);
    try {
      const r = await api(`/orders/${o.id}/refund`, 'POST', { items: pick, reason });
      toast(r.errors?.length ? `Partly done: ${r.errors.join(' · ')}` : `Refunded ${money(amount, o)}`);
      onDone();
    } catch (e) { toast(e.message); setBusy(false); }
  };
  return (
    <Modal title={`Refund order #${o.id}`} onClose={onClose} width={520}>
      <div className="m-body">
        <p className="muted sm">{o.name} · {o.email}</p>
        <div className="refund-items">{open.map((it) => (
          <label key={it.i} className="fcheck"><input type="checkbox" checked={pick.includes(it.i)} onChange={(e) => setPick(e.target.checked ? [...pick, it.i] : pick.filter((x) => x !== it.i))} />
            <span>{it.name} <small className="muted">· {it.kind}{it.productId ? ' · access will be removed' : ''}</small></span><b>{money(it.price, o)}</b></label>
        ))}</div>
        <label className="fld"><span>Reason <small className="muted">· optional, for your records</small></span><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Asked within the 7-day guarantee" /></label>
        <p className="hint">{viaRzp ? `The money goes back through ${via} to the buyer’s original payment method (usually 5–10 working days).` : 'This order wasn’t paid online here, so the refund is only recorded — pay the buyer back yourself.'} A credit note is issued for invoiced items, and the refund is taken out of your reports.</p>
        <div className="m-foot"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn danger" disabled={!pick.length || busy} onClick={go}>{busy ? 'Refunding…' : `Refund ${money(amount, o)}`}</button></div>
      </div>
    </Modal>
  );
}
