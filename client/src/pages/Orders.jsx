import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Layout, Panel, Icon, Empty, Modal, inr, num, ago, downloadCSV, toast, confirmDialog } from '../ui';
import { t, tx } from '../appI18n';
import '../cod.css';
import { Gstr1Panel, GstDocsModal } from '../gstDocs';
import { STAGE, useShipping, CourierShipModal, ShipmentCard, BulkShipModal } from './Shipping';

const STATUS = { refunded: ['Refunded', 'bad'], partially_refunded: ['Part refunded', 'warn'], cod: ['COD · unpaid', 'warn'], cancelled: ['Cancelled', 'bad'] };
const PLAN = { active: ['', 'ok'], authenticated: ['starting', ''], created: ['starting', ''], pending: ['payment due', 'warn'], halted: ['payment failed', 'bad'], cancelled: ['cancelled', 'bad'], completed: ['paid in full', 'ok'], expired: ['ended', ''], demo: ['demo', ''] };
const SHIP = { pending: ['To ship', ''], shipped: ['Shipped', 'info'], delivered: ['Delivered', 'ok'], returned: ['Returned', 'bad'] };
const addrText = (a) => (a ? [a.line1, a.line2, `${a.city}${a.state ? `, ${a.state}` : ''} – ${a.pincode}`].filter(Boolean).join(', ') : '');
const SYM = { USD: '$', EUR: '€', GBP: '£', AUD: 'A$', CAD: 'C$', SGD: 'S$', AED: 'AED ' };
const money = (n, o) => (o?.currency && o.currency !== 'INR' ? `${SYM[o.currency] || `${o.currency} `}${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : inr(n));
const planLabel = (pl, o) => (pl.type === 'installments' ? t('{paid}/{count} instalments', { paid: Math.min(pl.paid || 1, pl.count), count: pl.count }) : t(pl.interval === 'yearly' ? '{amount}/yr' : '{amount}/mo', { amount: money(pl.amount, o) }));
const campaignOf = (o) => [o.attr?.utm_campaign, o.attr?.utm_content].filter(Boolean).join(' · ');
// no real money moved: Razorpay/Stripe test keys, or a checkout placed while no payment provider was connected
const isTest = (o) => o.mode === 'test' || (!o.provider && !o.demo && o.paymentMethod !== 'cod' && o.total > 0 && !['cod', 'cancelled'].includes(o.status));
const thisYear = new Date().getFullYear();
const shortDate = (t) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(new Date(t).getFullYear() !== thisYear ? { year: 'numeric' } : {}) });
const fullDate = (t) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const RANGES = [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last 12 months'], [0, 'All time']];
// Cash on Delivery confirmation (server/cod.js)
const CODST = { pending: ['COD · awaiting reply', ''], confirmed: ['COD · confirmed', 'ok'], unconfirmed: ['COD · no reply', 'warn'], cancelled: ['COD · cancelled by buyer', 'bad'] };
const VIA = { whatsapp: 'WhatsApp', whatsapp_buttons: 'WhatsApp buttons', email: 'email', none: 'not sent — no WhatsApp or email available' };
const FILTERS = [['all', 'All orders'], ['paid', 'Paid'], ['cod', 'COD to collect'], ['cod_pending', 'COD · awaiting reply'], ['cod_confirmed', 'COD · confirmed'], ['cod_unconfirmed', 'COD · no reply'], ['cod_cancelled', 'COD · cancelled by buyer'], ['rto', 'Returned (RTO)'], ['ship', 'To ship'], ['in_transit', 'Shipped · on the way'], ['ndr', 'Delivery failed (NDR)'], ['refunded', 'Refunded'], ['plan', 'Memberships & instalments'], ['test', 'Test orders']];
const PAGE = 100;

export default function Orders() {
  const [d, setD] = useState(null);
  const [tab, setTab] = useState('orders');
  const [q, setQ] = useState('');
  const [days, setDays] = useState(0);
  const [funnel, setFunnel] = useState('');
  const [status, setStatus] = useState('all');
  const [open, setOpen] = useState(null);
  const [refund, setRefund] = useState(null);
  const [ship, setShip] = useState(null);
  const [ret, setRet] = useState(null); // a buyer's return / exchange request (store orders)
  // a connected courier (Settings → Shipping): ship from here, one order or several
  const shipCfg = useShipping();
  const srOn = !!shipCfg?.shiprocket?.connected;
  const [courier, setCourier] = useState(null);
  const [sel, setSel] = useState([]);
  const [bulk, setBulk] = useState(false);
  const canCourier = (o) => srOn && o.fulfilment?.status === 'pending' && !o.shipment?.awb && !['cancelled', 'refunded'].includes(o.status) && !!o.address;
  const [gstr1, setGstr1] = useState(false); // GSTR-1 for a month (checkout sales, plus counter bills)
  // the server filters, searches, pages and totals (server/orderlist.js); "Show more" fetches the next page
  const [orders, setOrders] = useState([]);
  const [abandoned, setAbandoned] = useState([]);
  const [more, setMore] = useState(false);
  const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const seq = useRef(0);
  const filterQs = `${days ? `&days=${days}` : ''}${funnel ? `&funnel=${encodeURIComponent(funnel)}` : ''}${dq ? `&q=${encodeURIComponent(dq)}` : ''}`;
  const qs = `${filterQs}${status !== 'all' ? `&status=${status}` : ''}`;
  const openRef = useRef(null);
  openRef.current = open;
  // after a change, as many rows stay loaded as were on screen; a new filter starts from the first page
  const load = (keep = true) => {
    const n = ++seq.current;
    return api(`/orders?limit=${keep ? Math.min(1000, Math.max(PAGE, orders.length, abandoned.length)) : PAGE}${qs}`).then((r) => {
      if (n !== seq.current) return;
      setD(r); setOrders(r.orders); setAbandoned(r.abandoned);
      // the order open in the panel: fresh from this page, or fetched on its own when it's further down
      const o = openRef.current;
      if (!o) return;
      const hit = r.orders.find((x) => x.id === o.id);
      if (hit) setOpen(hit);
      else api(`/orders?limit=1&id=${encodeURIComponent(o.id)}`).then((x) => setOpen((cur) => (cur?.id === o.id ? x.orders[0] || null : cur))).catch(() => {});
    });
  };
  useEffect(() => { load(false); }, [qs]);
  const showMore = async () => {
    const cursor = tab === 'orders' ? d?.nextCursor : d?.abandonedCursor;
    if (!cursor || more) return;
    setMore(true);
    const n = seq.current;
    try {
      const r = await api(`/orders?limit=${PAGE * 2}&tab=${tab}&cursor=${encodeURIComponent(cursor)}${qs}`);
      if (n === seq.current) {
        if (tab === 'orders') { setOrders((l) => [...l, ...r.orders]); setD((x) => ({ ...x, nextCursor: r.nextCursor })); }
        else { setAbandoned((l) => [...l, ...r.abandoned]); setD((x) => ({ ...x, abandonedCursor: r.abandonedCursor })); }
      }
    } catch (e) { toast(e.message); }
    setMore(false);
  };
  // every matching row, page by page (CSV exports cover the whole list, not just what's on screen)
  const fetchAll = async (query, key, cursorKey) => {
    const all = [];
    let cursor = '';
    do { const r = await api(`/orders?limit=1000&tab=${key === 'abandoned' ? 'abandoned' : 'orders'}${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`); all.push(...r[key]); cursor = r[cursorKey]; } while (cursor);
    return all;
  };
  const funnels = d?.funnels || [];
  // the numbers follow the period, funnel and search chosen; test orders never count as revenue
  const k = d?.kpis || {};
  const paidCount = k.paid || 0, revenue = k.revenue || 0, refunded = k.refunded || 0, codDue = k.codDue || 0, tests = k.tests || 0;
  const ordersTotal = d?.total ?? orders.length, abandonedTotal = d?.abandonedTotal ?? abandoned.length;
  const toShipCount = k.toShip || 0;
  const filtered = !!(days || funnel || status !== 'all' || dq);
  const planCancel = async (o) => {
    if (!(await confirmDialog(o.plan.type === 'recurring' ? { title: t('Cancel this membership?'), text: t('The buyer keeps access until the end of the period they paid for.'), confirm: t('Cancel membership'), cancel: t('Keep it'), danger: true } : { title: t('Stop the remaining instalments?'), text: t('Nothing more is charged; the buyer keeps access.'), confirm: t('Stop instalments'), cancel: t('Keep them'), danger: true }))) return;
    try { await api(`/orders/${o.id}/plan/cancel`, 'POST', {}); toast(t('Cancelled')); load(); } catch (e) { toast(e.message); }
  };
  const codAct = async (o, action) => {
    if (action === 'cancel' && !(await confirmDialog({ title: t('Cancel COD order #{id}?', { id: o.id }), text: t('The buyer’s access (if any) is removed.'), confirm: t('Cancel order'), cancel: t('Keep it'), danger: true }))) return;
    try {
      const r = await api(`/orders/${o.id}/cod`, 'POST', { action });
      toast(action === 'paid' ? t('Marked paid — invoice and delivery sent') : action === 'resend' ? (r.sentVia === 'none' ? t('Couldn’t send — no WhatsApp or email for this buyer. Copy the link from the order instead.') : t('Confirmation sent by {via}', { via: VIA[r.sentVia] || r.sentVia })) : t('Order cancelled'));
      load();
    } catch (e) { toast(e.message); }
  };
  // a courier-ready sheet (Shiprocket / Delhivery bulk upload columns) of everything waiting to ship
  const exportShipping = async () => {
    let toShip;
    try { toShip = await fetchAll('&status=ship', 'orders', 'nextCursor'); } catch (e) { return toast(e.message); }
    if (!toShip.length) return toast(t('Nothing waiting to ship'));
    downloadCSV('to-ship.csv', toShip.map((o) => ({ order_id: o.id, order_date: new Date(o.at).toISOString().slice(0, 10), customer_name: o.name, phone: o.phone, email: o.email, address_line1: o.address?.line1, address_line2: o.address?.line2 || '', city: o.address?.city, state: o.address?.state || '', pincode: o.address?.pincode, products: o.items.filter((i) => !['shipping', 'cod_fee'].includes(i.kind)).map((i) => i.name).join(' | '), payment_method: o.status === 'cod' ? 'COD' : 'Prepaid', cod_amount: o.status === 'cod' ? (o.codDue ?? o.total) : 0, advance_paid: o.prepaid?.amount || 0, order_total: o.total })));
  };
  const recoverMsg = (a) => `Hi ${a.name?.split(' ')[0] || 'there'} 👋 You were one step away from getting ${a.cartTitle || a.funnel}.${a.link ? ` You can finish your order here: ${a.link}` : ' Reply here and we’ll help you finish your order.'}`;
  const exportCsv = async () => {
    let rows;
    try { rows = tab === 'orders' ? await fetchAll(qs, 'orders', 'nextCursor') : await fetchAll(filterQs, 'abandoned', 'abandonedCursor'); } catch (e) { return toast(e.message); }
    csvOf(rows);
  };
  const csvOf = (list) => tab === 'orders'
    ? downloadCSV('orders.csv', list.map((o) => ({ id: o.id, date: new Date(o.at).toISOString(), name: o.name, email: o.email, phone: o.phone, funnel: o.funnel, items: o.items.map((i) => `${i.name} (${i.kind})${i.refunded ? ' [refunded]' : ''}`).join(' | '), coupon: o.coupon || '', discount: o.discount || 0, currency: o.currency || 'INR', total: o.total, refunded: o.refunded || 0, status: o.status, test: isTest(o) ? 'yes' : '', tags: (o.tags || []).join(' | '), note: o.note || '', source: o.source, utm_source: o.attr?.utm_source || '', utm_medium: o.attr?.utm_medium || '', utm_campaign: o.attr?.utm_campaign || '', utm_content: o.attr?.utm_content || '', utm_term: o.attr?.utm_term || '', click_id: o.attr?.fbclid ? 'fbclid' : o.attr?.gclid ? 'gclid' : '', gclid: o.attr?.gclid || '', invoices: (o.invoices || []).map((i) => i.number).join(' | '), payment: o.provider ? `${o.provider} (${o.mode})` : 'none' })))
    : downloadCSV('abandoned-carts.csv', list.map((a) => ({ date: new Date(a.at).toISOString(), name: a.name, email: a.email, phone: a.phone, funnel: a.funnel, link: a.link || '', utm_campaign: a.attr?.utm_campaign || '' })));
  // GST register for filing (GSTR-1): every invoice and credit note
  const exportInvoices = async () => {
    // the server sends up to 10,000 at a time, newest first: older ones are fetched until none are left
    const list = [], seen = new Set();
    for (let to = 0, n = 0; n < 100; n++) {
      const got = await api(`/sales-invoices${to ? `?to=${to}` : ''}`);
      const fresh = got.filter((i) => !seen.has(i.id));
      fresh.forEach((i) => { seen.add(i.id); list.push(i); });
      if (got.length < 10000 || !fresh.length) break;
      to = got.at(-1).at + 1; // the same moment again (deduplicated), so none is skipped
    }
    if (!list.length) return toast(t('No invoices yet — turn on GST invoices in Settings'));
    // one row per invoice line: each line has its own HSN/SAC and rate
    downloadCSV('gst-invoices.csv', list.flatMap((i) => i.items.map((l) => ({ number: i.number, type: i.type === 'credit' ? 'Credit note' : 'Invoice', against: i.against || '', date: new Date(i.at).toISOString().slice(0, 10), buyer: i.billedTo.name, buyer_email: i.billedTo.email, buyer_gstin: i.billedTo.gstin, place_of_supply: i.placeOfSupply, state_code: i.billedTo.stateCode || '', item: l.name, hsn: l.sac || '', taxable: l.taxable, rate: l.rate ?? i.rate, cgst: l.cgst, sgst: l.sgst, igst: l.igst, total: l.amount, invoice_total: i.total, payment: i.paymentId || '', order: i.orderId }))));
  };
  const actions = (o) => (
    <div className="row end" onClick={(e) => e.stopPropagation()}>
      {(o.invoices || []).map((i) => <a key={i.id} className="icon-btn" title={`${i.type === 'credit' ? t('Credit note') : t('Invoice')} ${i.number}`} href={i.url} target="_blank" rel="noreferrer"><Icon name="receipt" size={15} /></a>)}
      {canCourier(o) && <button className="btn soft sm" title={t('Book a courier with Shiprocket')} onClick={() => setCourier(o)}>{t('Ship')}</button>}
      {o.fulfilment && !['cancelled', 'refunded'].includes(o.status) && <button className="icon-btn" title={t('Shipping')} onClick={() => setShip(o)}><Icon name="box" size={15} /></button>}
      {o.plan?.subId && ['active', 'pending', 'halted', 'authenticated'].includes(o.plan.status) && !o.plan.cancelAtEnd && <button className="icon-btn" title={o.plan.type === 'recurring' ? t('Cancel membership (at the end of the paid period)') : t('Stop the remaining instalments')} onClick={() => planCancel(o)}><Icon name="x" size={15} /></button>}
      {o.status === 'cod' && <button className="btn soft sm" title={t('Cash collected — issue the invoice and deliver')} onClick={() => codAct(o, 'paid')}>{t('Paid')}</button>}
      {o.status === 'cod' && ['pending', 'unconfirmed'].includes(o.codStatus) && <button className="btn ghost sm" title={t('Send the confirmation message again')} onClick={() => codAct(o, 'resend')}>{t('Resend')}</button>}
      {o.status === 'cod' && <button className="icon-btn" title={t('Cancel this COD order')} onClick={() => codAct(o, 'cancel')}><Icon name="x" size={15} /></button>}
      {(o.returns || []).some((x) => ['requested', 'approved', 'received'].includes(x.status)) && <button className="btn soft sm" title={t('A return or exchange the buyer asked for')} onClick={() => setRet(o)}>{(o.returns || []).some((x) => x.status === 'requested') ? t('Return asked') : t('Return')}</button>}
      {!['refunded', 'cod', 'cancelled'].includes(o.status) && <button className="icon-btn" title={t('Refund')} onClick={() => setRefund(o)}><Icon name="refund" size={15} /></button>}
    </div>
  );
  const payPill = (o) => (isTest(o) ? <span className="pill warn" title={o.mode === 'test' ? t('Paid with test keys — no real money') : t('Placed while no payment provider was connected — no money was collected')}>{t('test')}</span> : o.provider && o.mode === 'live' && !['cod', 'cancelled'].includes(o.status) ? <span className="pill ok" title={t('Paid through {provider}', { provider: o.provider === 'stripe' ? 'Stripe' : 'Razorpay' })}>{t('paid')}</span> : null);

  return (
    <Layout title={t('Orders')} subtitle={t('Sales, one-click upsells, refunds and abandoned checkouts.')} actions={<>
      {toShipCount > 0 && <button className="btn ghost" onClick={exportShipping}><Icon name="box" size={16} /> {t('To ship ({n})', { n: num(toShipCount) })}</button>}
      <button className="btn ghost" onClick={exportInvoices}><Icon name="receipt" size={16} /> {t('GST invoices')}</button>
      <button className="btn ghost" onClick={() => setGstr1(true)}><Icon name="download" size={16} /> GSTR-1</button>
      <button className="btn ghost" onClick={exportCsv}><Icon name="download" size={16} /> {t('Export CSV')}</button>
    </>}>
      {!d ? <div className="skeleton" /> : (
        <>
          <div className="or-filters">
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label={t('Period')}>{RANGES.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select>
            <select value={funnel} onChange={(e) => setFunnel(e.target.value)} aria-label={t('Funnel')}><option value="">{t('All funnels')}</option>{funnels.map((f) => <option key={f}>{f}</option>)}</select>
            {tab === 'orders' && <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('Status')}>{FILTERS.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select>}
            {(days || funnel || status !== 'all' || q) ? <button className="link-btn" onClick={() => { setDays(0); setFunnel(''); setStatus('all'); setQ(''); }}>{t('Clear filters')}</button> : null}
          </div>
          <div className="kpis k4">
            <div className="kpi"><span className="kpi-l"><span className="kpi-ic"><Icon name="wallet" size={14} /></span>{t('Revenue · after refunds')}</span><b className="kpi-v">{inr(revenue)}</b>{refunded > 0 && <small>{t('{amount} refunded', { amount: inr(refunded) })}</small>}{codDue > 0 && <small>{t('+ {amount} COD to collect', { amount: inr(codDue) })}</small>}{(k.rto > 0 || k.codUnconfirmed > 0) && <small>{t('{rto} RTO · {n} COD with no reply', { rto: num(k.rto || 0), n: num(k.codUnconfirmed || 0) })}</small>}</div>
            <div className="kpi"><span className="kpi-l"><span className="kpi-ic"><Icon name="cart" size={14} /></span>{t('Paid orders')}</span><b className="kpi-v">{num(paidCount)}</b>{tests > 0 && <small>{t('+ {n} test, not counted', { n: num(tests) })}</small>}</div>
            <div className="kpi"><span className="kpi-l"><span className="kpi-ic"><Icon name="tag" size={14} /></span>{t('Avg. order value')}</span><b className="kpi-v">{inr(k.aov || 0)}</b></div>
            <div className="kpi warn"><span className="kpi-l"><span className="kpi-ic"><Icon name="clock" size={14} /></span>{t('Abandoned checkouts')}</span><b className="kpi-v">{num(abandonedTotal)}</b><small>{t('recover them via WhatsApp ↓')}</small></div>
          </div>
          <Panel pad={false} title={<div className="seg">
            <button className={tab === 'orders' ? 'on' : ''} onClick={() => setTab('orders')}>{t('Orders ({n})', { n: num(ordersTotal) })}</button>
            <button className={tab === 'abandoned' ? 'on' : ''} onClick={() => setTab('abandoned')}>{t('Abandoned ({n})', { n: num(abandonedTotal) })}</button>
          </div>} actions={<div className="search"><Icon name="search" size={16} /><input placeholder={t('Search name, email, tag, campaign…')} value={q} onChange={(e) => setQ(e.target.value)} /></div>}>
            {tab === 'orders' ? (!orders.length ? <Empty icon="cart" title={filtered ? t('No orders match') : t('No orders yet')} text={filtered ? t('Try another period, funnel or status.') : t('Orders from your checkouts and one-click upsells land here.')} /> : (
              <div className="tbl-wrap">
              {sel.length > 0 && <div className="or-bulk"><b>{t('{n} selected', { n: sel.length })}</b><button className="btn primary sm" onClick={() => setBulk(true)}>{t('Ship with Shiprocket')}</button><button className="link-btn" onClick={() => setSel([])}>{t('Clear')}</button></div>}
              <table className="tbl">
                <thead><tr>{srOn && <th className="or-pick"><input type="checkbox" aria-label={t('Select all to ship')} checked={sel.length > 0 && orders.filter(canCourier).every((o) => sel.includes(o.id))} onChange={(e) => setSel(e.target.checked ? orders.filter(canCourier).map((o) => o.id).slice(0, 50) : [])} /></th>}<th>{t('Order')}</th><th>{t('Customer')}</th><th>{t('Funnel')}</th><th>{t('Items')}</th><th className="r">{t('Total')}</th><th>{t('Source')}</th><th className="r">{t('Date')}</th><th /></tr></thead>
                <tbody>{orders.map((o) => (
                  <tr key={o.id} className="click" onClick={() => setOpen(o)}>
                    {srOn && <td className="or-pick" onClick={(e) => e.stopPropagation()}>{canCourier(o) && <input type="checkbox" aria-label={t('Select to ship')} checked={sel.includes(o.id)} onChange={(e) => setSel(e.target.checked ? [...sel, o.id].slice(0, 50) : sel.filter((x) => x !== o.id))} />}</td>}
                    <td className="mono">#{o.id}{STATUS[o.status] && <span className={`pill ${STATUS[o.status][1]}`}>{t(STATUS[o.status][0])}</span>}{CODST[o.codStatus] && (o.status === 'cod' || o.codStatus === 'cancelled') && <span className={`pill cod-st ${CODST[o.codStatus][1]}`}>{t(CODST[o.codStatus][0])}</span>}{o.rtoAt || o.cancelReason === 'returned' ? <span className="pill bad cod-st">RTO</span> : null}{(o.tags || []).map((t) => <span key={t} className="pill or-tag">{t}</span>)}</td>
                    <td><b>{o.name || '—'}</b><small className="sub-t">{o.email}</small>{o.address && <small className="sub-t addr" title={addrText(o.address)}>📍 {o.address.city} {o.address.pincode}</small>}</td><td>{o.funnel}</td>
                    <td className="items">{o.fulfilment && (STAGE[o.fulfilment.stage] || SHIP[o.fulfilment.status]) && <span className={`pill ${(STAGE[o.fulfilment.stage] || SHIP[o.fulfilment.status])[1]}`} title={[o.fulfilment.courier, o.fulfilment.tracking].filter(Boolean).join(' · ')}>{t((STAGE[o.fulfilment.stage] || SHIP[o.fulfilment.status])[0])}</span>}{o.items.map((i, k) => <span key={k} className={`it k-${i.kind} ${i.refunded ? 'refunded' : ''}`} title={`${i.name} · ${money(i.price, o)}${i.refunded ? ` · ${t('refunded')}` : ''}`}>{i.productId && '📦 '}{i.kind === 'main' ? i.name : i.kind}</span>)}{o.coupon && <span className="it">🏷 {o.coupon}</span>}{o.plan && <span className={`pill ${PLAN[o.plan.status]?.[1] || ''}`}>🔁 {planLabel(o.plan, o)}{PLAN[o.plan.status]?.[0] ? ` · ${t(PLAN[o.plan.status][0])}` : ''}{o.plan.cancelAtEnd ? ` · ${t('ending')}` : ''}</span>}
                      {o.stockShort && <span className="it warn" title={t('Another buyer paid for the last units at the same time — restock or refund')}>{t('oversold')}: {o.stockShort.join(', ')}</span>}{o.undelivered && <span className="it warn" title={t('Products are delivered only after a real payment (Razorpay or Stripe)')}>{t('not delivered')}</span>}{o.note && <span className="it" title={o.note}>📝 {t('note')}</span>}</td>
                    <td className="r strong">{money(o.total, o)}{o.currency && o.currency !== 'INR' && <small className="sub-t" title={t('Counted in your revenue at this rate')}>≈ {inr(o.total * (o.fx || 1))}</small>}{o.refunded > 0 && <small className="sub-t">{t('{amount} refunded', { amount: money(o.refunded, o) })}</small>}{payPill(o)}</td>
                    <td><span className="src">{o.attr?.utm_source || o.source}</span>{campaignOf(o) && <small className="sub-t" title={[o.attr?.utm_medium, o.attr?.utm_term].filter(Boolean).join(' · ')}>{campaignOf(o)}</small>}</td>
                    <td className="r muted" title={fullDate(o.at)}>{shortDate(o.at)}</td>
                    <td className="r">{actions(o)}</td>
                  </tr>
                ))}</tbody>
              </table>
              {d.nextCursor && <div className="or-more"><button className="btn ghost sm" disabled={more} onClick={showMore}>{more ? t('Loading…') : t('Show more ({n} older)', { n: num(ordersTotal - orders.length) })}</button></div>}
              </div>
            )) : (!abandoned.length ? <Empty icon="check" title={t('No abandoned checkouts')} text={t('When someone enters their email or WhatsApp number at checkout but doesn’t pay, they show up here so you can follow up.')} /> : (
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>{t('Contact')}</th><th>{t('Funnel')}</th><th className="r">{t('When')}</th><th className="r">{t('Recover')}</th></tr></thead>
                <tbody>{abandoned.map((a) => (
                  <tr key={a.id}><td><b>{a.name || '—'}</b><small className="sub-t">{[a.email, a.phone].filter(Boolean).join(' · ')}</small></td><td>{a.funnel}{a.cartTitle && <small className="sub-t">{a.cartTitle}{a.amount ? ` · ₹${Number(a.amount).toLocaleString('en-IN')}` : ''}</small>}</td><td className="r muted" title={fullDate(a.at)}>{ago(a.at)}</td>
                    <td className="r"><div className="row end">
                      {a.phone && <a className="btn soft sm" href={`https://wa.me/${a.phone.replace(/\D/g, '').replace(/^(\d{10})$/, '91$1')}?text=${encodeURIComponent(recoverMsg(a))}`} target="_blank" rel="noreferrer">💬 WhatsApp</a>}
                      {a.email && <a className="icon-btn" title={t('Email')} href={`mailto:${a.email}?subject=${encodeURIComponent(`Your order — ${a.funnel}`)}&body=${encodeURIComponent(recoverMsg(a))}`}><Icon name="mail" size={15} /></a>}
                      <button className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(recoverMsg(a)); toast('Recovery message copied'); }}><Icon name="copy" size={14} /> Copy message</button>
                    </div></td></tr>
                ))}</tbody>
              </table>
              {d.abandonedCursor && <div className="or-more"><button className="btn ghost sm" disabled={more} onClick={showMore}>{more ? 'Loading…' : 'Show more'}</button></div>}
              </div>
            ))}
          </Panel>
        </>
      )}
      {open && <OrderDetail o={open} actions={actions(open)} onClose={() => setOpen(null)} onSaved={load} />}
      {gstr1 && <Modal title="GSTR-1" onClose={() => setGstr1(false)} width={760}><div className="m-body"><Gstr1Panel title="Your GST return for a month" /></div></Modal>}
      {ship && <ShipModal o={ship} onClose={() => setShip(null)} onDone={() => { setShip(null); load(); }} />}
      {courier && <CourierShipModal o={courier} onClose={() => setCourier(null)} onDone={() => { setCourier(null); load(); }} />}
      {bulk && <BulkShipModal ids={sel} onClose={() => setBulk(false)} onDone={() => { setBulk(false); setSel([]); load(); }} />}
      {ret && <ReturnsModal o={ret} onClose={() => setRet(null)} onRefund={() => { setRefund(ret); setRet(null); }} onDone={load} />}
      {refund && <RefundModal o={refund} onClose={() => setRefund(null)} onDone={() => { setRefund(null); load(); }} />}
    </Layout>
  );
}

// one order in full: items, payment, customer, delivery, invoices — plus your own note and tags
function OrderDetail({ o, actions, onClose, onSaved }) {
  const [note, setNote] = useState(o.note || '');
  const [tags, setTags] = useState((o.tags || []).join(', '));
  const [busy, setBusy] = useState(false);
  const [gstOpen, setGstOpen] = useState(false);
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
            {(o.invoices || []).some((i) => i.registered && !i.test) && <button className="btn ghost sm" onClick={() => setGstOpen(true)}><Icon name="receipt" size={13} /> GST · e-invoice{o.invoices.some((i) => i.irn) ? ' ✓' : ''}</button>}
          </section>
        </div>
        {o.paymentMethod === 'cod' && <CodBox o={o} onSaved={onSaved} />}
        <ShipmentCard o={o} onSaved={onSaved} />
        <section>
          <h4>Items</h4>
          <table className="od-items"><tbody>
            {o.items.map((i, k) => <tr key={k} className={i.refunded ? 'refunded' : ''}><td>{i.name}<small className="muted"> · {i.kind}{i.refunded ? ` · refunded ${new Date(i.refunded.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}</small></td><td className="r">{money(i.price, o)}</td></tr>)}
            {o.discount > 0 && <tr><td>Discount{o.coupon ? ` (${o.coupon})` : ''}</td><td className="r">−{money(o.discount, o)}</td></tr>}
            {/* a refund already lowers the order total */}
            <tr className="od-sum"><td>{o.refunded > 0 ? 'Paid' : 'Total'}</td><td className="r">{money((o.total || 0) + (o.refunded || 0), o)}</td></tr>
            {o.refunded > 0 && <tr><td>Refunded</td><td className="r">−{money(o.refunded, o)}</td></tr>}
            {o.refunded > 0 && <tr className="od-sum"><td>Kept</td><td className="r">{money(o.total, o)}</td></tr>}
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
      {gstOpen && <GstDocsModal title={`GST documents — order #${o.id}`} onClose={() => setGstOpen(false)} onChanged={onSaved} eway={null}
        docs={o.invoices.filter((i) => i.registered && !i.test).map((i) => ({ source: 'checkout', id: i.id, number: i.number, label: `${i.type === 'credit' ? 'Credit note' : 'Tax invoice'} · ${money(i.total, o)}${i.gstin ? ` · GSTIN ${i.gstin}` : ' · no buyer GSTIN'}`, b2b: !!i.gstin, irn: i.irn }))} />}
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
    if (status === 'returned' && !(await confirmDialog({ title: 'Mark as returned?', text: o.status === 'cod' ? 'The unpaid COD order is cancelled.' : 'Refund the buyer from Orders if needed.', confirm: 'Mark returned' }))) return;
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
  const [restock, setRestock] = useState(true); // store items go back into stock unless the goods didn't come back
  const [busy, setBusy] = useState(false);
  const amount = open.filter((it) => pick.includes(it.i)).reduce((s, it) => s + it.price, 0);
  const viaRzp = open.some((it) => pick.includes(it.i) && it.paymentId);
  const via = o.provider === 'stripe' || open.some((it) => String(it.paymentId || '').startsWith('pi_')) ? 'Stripe' : 'Razorpay';
  const go = async () => {
    setBusy(true);
    try {
      const r = await api(`/orders/${o.id}/refund`, 'POST', { items: pick, reason, restock });
      // a COD order paid partly online: the online part went back automatically, the rest is cash to hand back
      const split = r.cashToReturn ? ` — ${money(r.refundedOnline || 0, o)} back to their card/UPI; give ${money(r.cashToReturn, o)} back in cash` : '';
      toast(r.errors?.length ? `Partly done: ${r.errors.join(' · ')}` : `Refunded ${money(amount, o)}${split}`);
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
        {o.items.some((it, k) => pick.includes(k) && it.itemId) && <label className="fcheck"><input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} /> Put the items back in stock <small className="muted">· untick if the goods didn’t come back</small></label>}
        <p className="hint">{viaRzp ? `The money goes back through ${via} to the buyer’s original payment method (usually 5–10 working days).` : 'This order wasn’t paid online here, so the refund is only recorded — pay the buyer back yourself.'} A credit note is issued for invoiced items, and the refund is taken out of your reports.</p>
        <div className="m-foot"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn danger" disabled={!pick.length || busy} onClick={go}>{busy ? 'Refunding…' : `Refund ${money(amount, o)}`}</button></div>
      </div>
    </Modal>
  );
}

// a COD order's confirmation, the buyer's COD record with you, and the seller's actions
function CodBox({ o, onSaved }) {
  const [risk, setRisk] = useState(null);
  useEffect(() => { api(`/orders/${o.id}/cod-risk`).then(setRisk).catch(() => {}); }, [o.id, o.status, o.codStatus]);
  const act = async (action) => {
    if (action === 'rto' && !(await confirmDialog({ title: t('Mark returned to origin (RTO)?'), text: t('An unpaid COD order is cancelled. It counts against this buyer’s number for your COD risk rules.'), confirm: t('Mark RTO'), danger: true }))) return;
    try { const r = await api(`/orders/${o.id}/cod`, 'POST', { action }); toast(action === 'resend' ? (r.sentVia === 'none' ? t('Couldn’t send — copy the link instead') : t('Confirmation sent by {via}', { via: VIA[r.sentVia] || r.sentVia })) : t('Updated')); onSaved(); } catch (e) { toast(e.message); }
  };
  const c = o.codConfirm || {}, last = c.sends?.at(-1);
  const rto = !!(o.rtoAt || o.cancelReason === 'returned');
  return (
    <section className="cod-box">
      <h4>{t('Cash on Delivery')}</h4>
      <p>{o.codStatus ? t(CODST[o.codStatus]?.[0] || o.codStatus) : t('No confirmation asked')}{c.answeredAt ? ` · ${fullDate(c.answeredAt)} (${c.by})` : ''}{rto ? ` · ${t('returned to origin (RTO)')}` : ''}</p>
      {last && <small className="muted">{t('Last asked {when} by {via}', { when: fullDate(last.at), via: t(VIA[last.via] || last.via) })}{c.dueAt && o.codStatus === 'pending' ? ` · ${t('no reply after {when}', { when: fullDate(c.dueAt) })}` : ''}</small>}
      {o.prepaid && <p className="cod-adv">{t('Advance paid online {amount}', { amount: inr(o.prepaid.amount) })}{o.status === 'cod' ? ` · ${t('to collect on delivery {amount}', { amount: inr(o.codDue ?? o.total - o.prepaid.amount) })}` : ''} · {t(o.prepaid.policy === 'keep' ? 'kept if refused' : 'refunded if refused')}
        {o.prepaid.retained && <><br /><b>{t('Kept as a booking fee: {amount}', { amount: inr(o.prepaid.retained.amount) })}</b> <small className="muted">· {t('may attract GST — check with your CA')}</small></>}
        {o.prepaid.refund?.status === 'done' && <><br /><b>{t('Advance refunded {amount}', { amount: inr(o.prepaid.refund.amount) })}</b> <small className="muted mono">{o.prepaid.refund.id}</small></>}
        {o.prepaid.refund?.status === 'pending' && <><br />{t('Refunding the advance…')}</>}
        {o.prepaid.refund?.status === 'failed' && <><br /><b className="bad">{t('Advance refund failed')}</b> <small className="muted">{o.prepaid.refund.error}</small></>}
      </p>}
      {risk && <p className={`cod-risk ${risk.bad ? 'bad' : ''}`}>{t('This number with you: {n} COD orders · {d} delivered · {r} RTO · {c} cancelled · {u} no reply', { n: risk.orders, d: risk.delivered, r: risk.rto, c: risk.cancelled, u: risk.unconfirmed })}</p>}
      <div className="row">
        {o.status === 'cod' && (!o.codStatus || ['pending', 'unconfirmed'].includes(o.codStatus)) && <button className="btn soft sm" onClick={() => act('resend')}>{t(o.codStatus ? 'Resend confirmation' : 'Ask to confirm')}</button>}
        {o.status === 'cod' && o.codStatus !== 'confirmed' && <button className="btn ghost sm" onClick={() => act('confirm')}>{t('Confirmed by phone')}</button>}
        {risk?.link && o.status === 'cod' && <button className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(risk.link); toast(t('Confirmation link copied')); }}>{t('Copy confirm link')}</button>}
        {o.prepaid?.refund?.status === 'failed' && <button className="btn soft sm" onClick={() => act('refund_advance')}>{t('Retry advance refund')}</button>}
        {!rto && ['cod', 'cancelled'].includes(o.status) && <button className="btn ghost sm" onClick={() => act('rto')}>{t('Returned to origin (RTO)')}</button>}
      </div>
    </section>
  );
}


// a buyer's return / exchange requests on a store order: approve, reject with a note they'll read, mark the parcel received
const RET_STATUS = { requested: ['Waiting for you', 'warn'], approved: ['Approved', 'ok'], rejected: ['Rejected', 'bad'], received: ['Received', 'ok'], closed: ['Closed', ''] };
const RET_REASON = { size: 'Wrong size or fit', damaged: 'Arrived damaged', wrong: 'Wrong item sent', different: 'Not as described', mind: 'Changed their mind', other: 'Something else' };
function ReturnsModal({ o, onClose, onRefund, onDone }) {
  const [list, setList] = useState(o.returns || []);
  const [note, setNote] = useState({});
  const [busy, setBusy] = useState('');
  const act = async (r, status) => {
    setBusy(r.id + status);
    try { const x = await api(`/orders/${o.id}/returns/${r.id}`, 'PUT', { status, note: note[r.id] || '' }); setList(x.returns); onDone(); toast(t('Saved — the buyer is told by email')); } catch (e) { toast(e.message); }
    setBusy('');
  };
  return (
    <Modal title={t('Returns and exchanges · #{id}', { id: o.id })} onClose={onClose} width={620}>
      <div className="ret-list">{list.map((r) => { const [lbl, cls] = RET_STATUS[r.status] || [r.status, '']; return (
        <div key={r.id} className="ret-item">
          <div className="row"><b>{r.kind === 'exchange' ? t('Exchange') : t('Return')}</b><span className={`pill ${cls}`}>{t(lbl)}</span><small className="muted">{ago(r.at)}</small></div>
          <p>{(r.names || []).join(', ')}{r.size ? ` → ${t('size')} ${r.size}` : ''}</p>
          <p className="muted sm">{t(RET_REASON[r.reason] || r.reason)}{r.note ? ` — “${r.note}”` : ''}</p>
          {r.sellerNote && <p className="sm">{t('Your note')}: {r.sellerNote}</p>}
          {['requested', 'approved', 'received'].includes(r.status) && <>
            <textarea rows={2} maxLength={500} placeholder={t('A note for the buyer (needed to reject) — e.g. pickup date, or why not')} value={note[r.id] || ''} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} />
            <div className="row">
              {r.status === 'requested' && <button className="btn primary sm" disabled={!!busy} onClick={() => act(r, 'approved')}>{t('Approve')}</button>}
              {r.status === 'requested' && <button className="btn ghost sm" disabled={!!busy} onClick={() => act(r, 'rejected')}>{t('Reject')}</button>}
              {r.status === 'approved' && <button className="btn primary sm" disabled={!!busy} onClick={() => act(r, 'received')}>{t('Mark the parcel received')}</button>}
              {r.kind === 'return' && ['approved', 'received'].includes(r.status) && !['refunded', 'cod', 'cancelled'].includes(o.status) && <button className="btn ghost sm" onClick={onRefund}>{t('Refund these items')}</button>}
              {['approved', 'received'].includes(r.status) && <button className="btn ghost sm" disabled={!!busy} onClick={() => act(r, 'closed')}>{t('Close')}</button>}
            </div>
          </>}
        </div>
      ); })}</div>
      <p className="hint">{t('Refunds go through Refund as usual, so stock, invoices and credit notes stay right. For an exchange, ship the new size as a fresh order or note it here.')}</p>
    </Modal>
  );
}
