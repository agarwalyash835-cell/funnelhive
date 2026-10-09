import { useEffect, useState } from 'react';
import { api } from '../api';
import { Layout, Panel, Icon, Empty, Modal, inr, num, ago, downloadCSV, toast } from '../ui';

const STATUS = { refunded: ['Refunded', 'bad'], partially_refunded: ['Part refunded', 'warn'], cod: ['COD · unpaid', 'warn'], cancelled: ['Cancelled', 'bad'] };
const PLAN = { active: ['', 'ok'], authenticated: ['starting', ''], created: ['starting', ''], pending: ['payment due', 'warn'], halted: ['payment failed', 'bad'], cancelled: ['cancelled', 'bad'], completed: ['paid in full', 'ok'], expired: ['ended', ''], demo: ['demo', ''] };
const planLabel = (pl) => (pl.type === 'installments' ? `${Math.min(pl.paid || 1, pl.count)}/${pl.count} instalments` : `₹${Number(pl.amount).toLocaleString('en-IN')}/${pl.interval === 'yearly' ? 'yr' : 'mo'}`);
const SHIP = { pending: ['To ship', ''], shipped: ['Shipped', 'info'], delivered: ['Delivered', 'ok'], returned: ['Returned', 'bad'] };
const addrText = (a) => (a ? [a.line1, a.line2, `${a.city}${a.state ? `, ${a.state}` : ''} – ${a.pincode}`].filter(Boolean).join(', ') : '');
const SYM = { USD: '$', EUR: '€', GBP: '£', AUD: 'A$', CAD: 'C$', SGD: 'S$', AED: 'AED ' };
const money = (n, o) => (o?.currency && o.currency !== 'INR' ? `${SYM[o.currency] || `${o.currency} `}${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : inr(n));
const campaignOf = (o) => [o.attr?.utm_campaign, o.attr?.utm_content].filter(Boolean).join(' · ');

export default function Orders() {
  const [d, setD] = useState(null);
  const [tab, setTab] = useState('orders');
  const [q, setQ] = useState('');
  const [refund, setRefund] = useState(null);
  const [ship, setShip] = useState(null);
  const load = () => api('/orders').then(setD);
  useEffect(() => { load(); }, []);
  const match = (o) => `${o.name} ${o.email} ${o.funnel} ${o.id} ${campaignOf(o)}`.toLowerCase().includes(q.toLowerCase());
  const orders = (d?.orders || []).filter(match), abandoned = (d?.abandoned || []).filter(match);
  const revenue = (d?.orders || []).filter((o) => o.status !== 'cod').reduce((a, o) => a + o.total * (o.fx || 1), 0);
  const codDue = (d?.orders || []).filter((o) => o.status === 'cod').reduce((a, o) => a + o.total, 0);
  const toShip = (d?.orders || []).filter((o) => o.fulfilment?.status === 'pending' && o.status !== 'cancelled' && o.status !== 'refunded');
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
  const refunded = (d?.orders || []).reduce((a, o) => a + (o.refunded || 0), 0);
  const lost = abandoned.length;
  const recoverMsg = (a) => `Hi ${a.name?.split(' ')[0] || 'there'} 👋 You were just one step away from getting ${a.funnel}. Your special price is still reserved — complete your order here: ${location.origin}. Use code INDIA10 for an extra 10% OFF today!`;
  const exportCsv = () => tab === 'orders'
    ? downloadCSV('orders.csv', orders.map((o) => ({ id: o.id, date: new Date(o.at).toISOString(), name: o.name, email: o.email, phone: o.phone, funnel: o.funnel, items: o.items.map((i) => `${i.name} (${i.kind})${i.refunded ? ' [refunded]' : ''}`).join(' | '), coupon: o.coupon || '', discount: o.discount || 0, total: o.total, refunded: o.refunded || 0, status: o.status, source: o.source, utm_source: o.attr?.utm_source || '', utm_medium: o.attr?.utm_medium || '', utm_campaign: o.attr?.utm_campaign || '', utm_content: o.attr?.utm_content || '', utm_term: o.attr?.utm_term || '', click_id: o.attr?.fbclid ? 'fbclid' : o.attr?.gclid ? 'gclid' : '', invoices: (o.invoices || []).map((i) => i.number).join(' | '), payment: o.provider ? `${o.provider} (${o.mode})` : 'demo' })))
    : downloadCSV('abandoned-carts.csv', abandoned.map((a) => ({ date: new Date(a.at).toISOString(), name: a.name, email: a.email, phone: a.phone, funnel: a.funnel, utm_campaign: a.attr?.utm_campaign || '' })));
  // GST register for filing (GSTR-1): every invoice and credit note
  const exportInvoices = async () => {
    const list = await api('/sales-invoices');
    if (!list.length) return toast('No invoices yet — turn on GST invoices in Settings');
    downloadCSV('gst-invoices.csv', list.map((i) => ({ number: i.number, type: i.type === 'credit' ? 'Credit note' : 'Invoice', against: i.against || '', date: new Date(i.at).toISOString().slice(0, 10), buyer: i.billedTo.name, buyer_email: i.billedTo.email, buyer_gstin: i.billedTo.gstin, place_of_supply: i.placeOfSupply, state_code: i.billedTo.stateCode || '', taxable: i.taxable, rate: i.rate, cgst: i.cgst, sgst: i.sgst, igst: i.igst, total: i.total, payment: i.paymentId || '', order: i.orderId })));
  };

  return (
    <Layout title="Orders" subtitle="Sales, one-click upsells, refunds and abandoned checkouts." actions={<>
      {toShip.length > 0 && <button className="btn ghost" onClick={exportShipping}><Icon name="box" size={16} /> To ship ({num(toShip.length)})</button>}
      <button className="btn ghost" onClick={exportInvoices}><Icon name="receipt" size={16} /> GST invoices</button>
      <button className="btn ghost" onClick={exportCsv}><Icon name="download" size={16} /> Export CSV</button>
    </>}>
      {!d ? <div className="skeleton" /> : (
        <>
          <div className="kpis k4">
            <div className="kpi"><span className="kpi-l">Revenue (after refunds)</span><b className="kpi-v">{inr(revenue)}</b>{refunded > 0 && <small>{inr(refunded)} refunded</small>}{codDue > 0 && <small>+ {inr(codDue)} COD to collect</small>}</div>
            <div className="kpi"><span className="kpi-l">Orders</span><b className="kpi-v">{num(d.orders.length)}</b></div>
            <div className="kpi"><span className="kpi-l">Avg. order value</span><b className="kpi-v">{inr(d.orders.length ? revenue / d.orders.length : 0)}</b></div>
            <div className="kpi warn"><span className="kpi-l">Abandoned checkouts</span><b className="kpi-v">{num(d.abandoned.length)}</b><small>recover them via WhatsApp ↓</small></div>
          </div>
          <Panel pad={false} title={<div className="seg">
            <button className={tab === 'orders' ? 'on' : ''} onClick={() => setTab('orders')}>Orders ({num(d.orders.length)})</button>
            <button className={tab === 'abandoned' ? 'on' : ''} onClick={() => setTab('abandoned')}>Abandoned ({num(lost)})</button>
          </div>} actions={<div className="search"><Icon name="search" size={16} /><input placeholder="Search name, email, campaign…" value={q} onChange={(e) => setQ(e.target.value)} /></div>}>
            {tab === 'orders' ? (!orders.length ? <Empty icon="cart" title="No orders yet" text="Orders from your checkouts and one-click upsells land here." /> : (
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Order</th><th>Customer</th><th>Funnel</th><th>Items</th><th className="r">Total</th><th>Source</th><th className="r">Date</th><th /></tr></thead>
                <tbody>{orders.slice(0, 300).map((o) => (
                  <tr key={o.id}>
                    <td className="mono">#{o.id}{STATUS[o.status] && <span className={`pill ${STATUS[o.status][1]}`}>{STATUS[o.status][0]}</span>}</td>
                    <td><b>{o.name || '—'}</b><small className="sub-t">{o.email}</small>{o.address && <small className="sub-t addr" title={addrText(o.address)}>📍 {o.address.city} {o.address.pincode}</small>}</td><td>{o.funnel}</td>
                    <td className="items">{o.fulfilment && SHIP[o.fulfilment.status] && <span className={`pill ${SHIP[o.fulfilment.status][1]}`} title={[o.fulfilment.courier, o.fulfilment.tracking].filter(Boolean).join(' · ')}>{o.fulfilment.trackingUrl ? <a href={o.fulfilment.trackingUrl} target="_blank" rel="noreferrer">{SHIP[o.fulfilment.status][0]}</a> : SHIP[o.fulfilment.status][0]}</span>}{o.items.map((i, k) => <span key={k} className={`it k-${i.kind} ${i.refunded ? 'refunded' : ''}`} title={`${i.name} · ${inr(i.price)}${i.refunded ? ' · refunded' : ''}`}>{i.productId && '📦 '}{i.kind === 'main' ? i.name : i.kind}</span>)}{o.coupon && <span className="it">🏷 {o.coupon}</span>}{o.plan && <span className={`pill ${PLAN[o.plan.status]?.[1] || ''}`} title={o.plan.cancelAtEnd ? 'Cancels at the end of this period' : o.plan.nextAt ? `Next charge ${new Date(o.plan.nextAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}>🔁 {planLabel(o.plan)}{PLAN[o.plan.status]?.[0] ? ` · ${PLAN[o.plan.status][0]}` : ''}{o.plan.cancelAtEnd ? ' · ending' : ''}</span>}
                      {o.undelivered && <span className="it warn" title="Demo checkout — products are delivered only after a real payment (Razorpay or Stripe)">not delivered</span>}</td>
                    <td className="r strong">{money(o.total, o)}{o.currency && o.currency !== 'INR' && <small className="sub-t" title="Counted in your revenue at this rate">≈ {inr(o.total * (o.fx || 1))}</small>}{o.refunded > 0 && <small className="sub-t">−{money(o.refunded, o)}</small>}{o.mode === 'test' && <span className="pill warn" title="Paid with Razorpay test keys — no real money">test</span>}{o.provider === 'razorpay' && o.mode === 'live' && <span className="pill ok" title="Paid through Razorpay">paid</span>}</td>
                    <td><span className="src">{o.attr?.utm_source || o.source}</span>{campaignOf(o) && <small className="sub-t" title={[o.attr?.utm_medium, o.attr?.utm_term].filter(Boolean).join(' · ')}>{campaignOf(o)}</small>}</td>
                    <td className="r muted">{new Date(o.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td>
                    <td className="r"><div className="row end">
                      {(o.invoices || []).map((i) => <a key={i.id} className="icon-btn" title={`${i.type === 'credit' ? 'Credit note' : 'Invoice'} ${i.number}`} href={i.url} target="_blank" rel="noreferrer"><Icon name="receipt" size={15} /></a>)}
                      {o.fulfilment && !['cancelled', 'refunded'].includes(o.status) && <button className="icon-btn" title="Shipping" onClick={() => setShip(o)}><Icon name="box" size={15} /></button>}
                      {o.plan?.subId && ['active', 'pending', 'halted', 'authenticated'].includes(o.plan.status) && !o.plan.cancelAtEnd && <button className="icon-btn" title={o.plan.type === 'recurring' ? 'Cancel membership (at the end of the paid period)' : 'Stop the remaining instalments'} onClick={() => planCancel(o)}><Icon name="x" size={15} /></button>}
                      {o.status === 'cod' && <button className="btn soft sm" title="Cash collected — issue the invoice and deliver" onClick={() => codAct(o, 'paid')}>Paid</button>}
                      {o.status === 'cod' && <button className="icon-btn" title="Cancel this COD order" onClick={() => codAct(o, 'cancel')}><Icon name="x" size={15} /></button>}
                      {!['refunded', 'cod', 'cancelled'].includes(o.status) && <button className="icon-btn" title="Refund" onClick={() => setRefund(o)}><Icon name="refund" size={15} /></button>}
                    </div></td>
                  </tr>
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
      {ship && <ShipModal o={ship} onClose={() => setShip(null)} onDone={() => { setShip(null); load(); }} />}
      {refund && <RefundModal o={refund} onClose={() => setRefund(null)} onDone={() => { setRefund(null); load(); }} />}
    </Layout>
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
        <div className="ship-to"><b>{o.name}</b> · {o.phone}<br />{addrText(o.address) || 'No address on this order'}{o.status === 'cod' && <div className="pill warn">Collect {inr(o.total)} in cash</div>}</div>
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
      toast(r.errors?.length ? `Partly done: ${r.errors.join(' · ')}` : `Refunded ${inr(amount)}`);
      onDone();
    } catch (e) { toast(e.message); setBusy(false); }
  };
  return (
    <Modal title={`Refund order #${o.id}`} onClose={onClose} width={520}>
      <div className="m-body">
        <p className="muted sm">{o.name} · {o.email}</p>
        <div className="refund-items">{open.map((it) => (
          <label key={it.i} className="fcheck"><input type="checkbox" checked={pick.includes(it.i)} onChange={(e) => setPick(e.target.checked ? [...pick, it.i] : pick.filter((x) => x !== it.i))} />
            <span>{it.name} <small className="muted">· {it.kind}{it.productId ? ' · access will be removed' : ''}</small></span><b>{inr(it.price)}</b></label>
        ))}</div>
        <label className="fld"><span>Reason <small className="muted">· optional, for your records</small></span><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Asked within the 7-day guarantee" /></label>
        <p className="hint">{viaRzp ? `The money goes back through ${via} to the buyer’s original payment method (usually 5–10 working days).` : 'This order wasn’t paid online here, so the refund is only recorded — pay the buyer back yourself.'} A credit note is issued for invoiced items, and the refund is taken out of your reports.</p>
        <div className="m-foot"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn danger" disabled={!pick.length || busy} onClick={go}>{busy ? 'Refunding…' : `Refund ${inr(amount)}`}</button></div>
      </div>
    </Modal>
  );
}
