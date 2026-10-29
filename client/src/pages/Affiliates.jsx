// Affiliates (server/affiliates.js): the seller's referral program — settings, affiliates (approve / block, coupon,
// masked payout details), the commissions ledger with filters and CSV, and payouts marked paid by hand (UPI / bank).
import { useEffect, useState } from 'react';
import { api, fmtDate } from '../api';
import { Layout, Panel, Icon, Empty, Modal, toast, confirmDialog, inr } from '../ui';
import '../affiliates.css';

const STATUS = { awaiting: ['Awaiting COD', 'Cash not collected yet — no commission until it is'], pending: ['On hold', 'In the hold period, in case of a refund'], approved: ['Approved', 'Ready to pay'], paid: ['Paid', ''], reversed: ['Reversed', 'Refunded, cancelled or returned'] };
const AFF_STATUS = { pending: 'Waiting for approval', approved: 'Approved', blocked: 'Blocked' };
const rateText = (r) => (r?.type === 'flat' ? `₹${r.value} per sale` : `${r?.value ?? 0}%`);
const copy = (s) => { navigator.clipboard?.writeText(s).then(() => toast('Copied'), () => {}); };

export default function Affiliates() {
  const [d, setD] = useState(null);
  const [tab, setTab] = useState('affiliates');
  const [rev, setRev] = useState(0);
  const reload = () => setRev((r) => r + 1);
  useEffect(() => { api('/affiliates').then(setD).catch((e) => { toast(e.message); setD(false); }); }, [rev]);
  if (d === false) return <Layout title="Affiliates"><Empty icon="users" title="Couldn’t load affiliates" /></Layout>;
  if (!d) return <Layout title="Affiliates"><div className="skeleton" style={{ height: 240 }} /></Layout>;
  const on = d.program.enabled;
  return (
    <Layout title="Affiliates" subtitle="People who sell for you — links, coupons and commission" actions={<InviteButton onDone={reload} />}>
      {!on && <div className="aff-note"><Icon name="bolt" size={15} /> Your program is off — turn it on under <button className="linkish" onClick={() => setTab('settings')}>Settings</button> to start tracking sales.</div>}
      {on && d.signupUrl && <div className="aff-note"><Icon name="link" size={15} /> Sign-up page for affiliates: <a href={d.signupUrl} target="_blank" rel="noreferrer">{d.signupUrl}</a> <button className="btn ghost sm" onClick={() => copy(d.signupUrl)}><Icon name="copy" size={14} /></button></div>}
      <div className="aff-kpis">
        <Kpi label="Affiliates" value={d.totals.affiliates} sub={d.totals.pending ? `${d.totals.pending} to approve` : ''} />
        <Kpi label="Clicks" value={d.totals.clicks.toLocaleString('en-IN')} />
        <Kpi label="Sales" value={d.totals.sales.toLocaleString('en-IN')} />
        <Kpi label="On hold" value={inr(d.totals.commissionPending + d.totals.awaiting)} />
        <Kpi label="To pay" value={inr(d.totals.payable)} />
        <Kpi label="Paid" value={inr(d.totals.paid)} />
      </div>
      <div className="seg aff-tabs">{[['affiliates', 'Affiliates'], ['commissions', 'Commissions'], ['payouts', 'Payouts'], ['settings', 'Settings']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'affiliates' && <AffList d={d} onChange={reload} />}
      {tab === 'commissions' && <Commissions affiliates={d.affiliates} />}
      {tab === 'payouts' && <Payouts d={d} onChange={reload} />}
      {tab === 'settings' && <Settings d={d} onSaved={reload} />}
    </Layout>
  );
}
const Kpi = ({ label, value, sub }) => <div className="aff-kpi"><small>{label}</small><b>{value}</b>{sub && <span>{sub}</span>}</div>;

function InviteButton({ onDone }) {
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await api('/affiliates', 'POST', { name: f.name, email: f.email, phone: f.phone, ...(f.code ? { code: f.code } : {}), ...(f.coupon ? { coupon: f.coupon } : {}) }); toast('Invited — we emailed them their link'); setF(null); onDone(); } catch (err) { toast(err.message); }
    setBusy(false);
  };
  return <>
    <button className="btn primary" onClick={() => setF({ name: '', email: '', phone: '', code: '', coupon: '' })}><Icon name="plus" size={16} /> Invite affiliate</button>
    {f && <Modal title="Invite an affiliate" onClose={() => setF(null)} width={480}>
      <form className="aff-form" onSubmit={save}>
        <label>Name<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label>Email<input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label>Phone<input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        <label>Referral code <small className="muted">· optional, made for you otherwise</small><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></label>
        <label>Their coupon <small className="muted">· optional — sales with it count for them even without the link</small><input value={f.coupon} onChange={(e) => setF({ ...f, coupon: e.target.value.toUpperCase() })} /></label>
        <button className="btn primary" disabled={busy}>{busy ? 'Inviting…' : 'Invite'}</button>
      </form>
    </Modal>}
  </>;
}

function AffList({ d, onChange }) {
  const [open, setOpen] = useState(null);
  const set = async (a, body, msg) => { try { await api(`/affiliates/${a.id}`, 'PUT', body); if (msg) toast(msg); onChange(); } catch (e) { toast(e.message); } };
  if (!d.affiliates.length) return <Empty icon="users" title="No affiliates yet" text="Share your sign-up page or invite someone. Each affiliate gets links with their code and, if you like, a coupon of their own." />;
  return (
    <Panel pad={false}>
      <div className="aff-table-wrap"><table className="aff-table">
        <thead><tr><th>Affiliate</th><th>Code / coupon</th><th>Status</th><th className="num">Clicks</th><th className="num">Sales</th><th className="num">On hold</th><th className="num">To pay</th><th className="num">Paid</th><th /></tr></thead>
        <tbody>{d.affiliates.map((a) => (
          <tr key={a.id}>
            <td><b>{a.name}</b><small>{a.email}{a.phone ? ` · ${a.phone}` : ''}</small></td>
            <td><code>{a.code}</code>{a.coupon && <small>Coupon {a.coupon}</small>}</td>
            <td><span className={`aff-pill ${a.status}`}>{AFF_STATUS[a.status]}</span></td>
            <td className="num">{a.stats.clicks}</td>
            <td className="num">{a.stats.sales}</td>
            <td className="num">{inr(a.stats.pending + a.stats.awaiting)}</td>
            <td className="num">{inr(a.payable)}</td>
            <td className="num">{inr(a.stats.paid)}</td>
            <td className="aff-actions">
              {a.status !== 'approved' && <button className="btn sm primary" onClick={() => set(a, { status: 'approved' }, 'Approved')}>Approve</button>}
              {a.status !== 'blocked' && <button className="btn sm ghost" onClick={async () => { if (await confirmDialog({ title: `Block ${a.name}?`, text: 'Their links and coupon stop counting. Earlier commissions stay.', confirm: 'Block', danger: true })) set(a, { status: 'blocked' }, 'Blocked'); }}>Block</button>}
              <button className="btn sm ghost" onClick={() => setOpen(a)}>Details</button>
            </td>
          </tr>))}
        </tbody>
      </table></div>
      {open && <AffDetails a={open} onClose={() => setOpen(null)} onChange={onChange} />}
    </Panel>
  );
}

function AffDetails({ a, onClose, onChange }) {
  const [coupon, setCoupon] = useState(a.coupon || '');
  const [full, setFull] = useState(null);
  const saveCoupon = async () => { try { await api(`/affiliates/${a.id}`, 'PUT', { coupon }); toast(coupon ? 'Coupon linked' : 'Coupon removed'); onChange(); onClose(); } catch (e) { toast(e.message); } };
  const reveal = async () => { try { setFull((await api(`/affiliates/${a.id}/payout-details`, 'POST', {})).payout); } catch (e) { toast(e.message); } };
  const p = full || a.payout;
  return (
    <Modal title={a.name} onClose={onClose} width={520}>
      <div className="aff-form">
        <p className="muted sm">{a.email}{a.phone ? ` · ${a.phone}` : ''} · joined {fmtDate(a.at)}{a.invited ? ' (invited)' : ''}</p>
        <label>Coupon code <small className="muted">· sales with it are theirs, link or not</small>
          <span className="row"><input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="e.g. PRIYA10" /><button type="button" className="btn" onClick={saveCoupon}>Save</button></span></label>
        <h4>Payout details</h4>
        {!p ? <p className="muted sm">Not added yet — they can add a UPI ID or bank account in their dashboard.</p> : <div className="aff-payout">
          {p.upi && <div>UPI: <b>{p.upi}</b></div>}
          {p.account && <div>Bank: <b>{p.account}</b> · IFSC {p.ifsc} · {p.holder}{p.bank ? ` · ${p.bank}` : ''}</div>}
          {!full && <button type="button" className="btn sm ghost" onClick={reveal}><Icon name="eye" size={14} /> Show in full to pay</button>}
        </div>}
      </div>
    </Modal>
  );
}

function Commissions({ affiliates }) {
  const [filter, setFilter] = useState({ status: '', affiliateId: '' });
  const [list, setList] = useState(null);
  const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v)).toString();
  useEffect(() => { setList(null); api(`/affiliates/commissions${qs ? `?${qs}` : ''}`).then((r) => setList(r.commissions)).catch((e) => toast(e.message)); }, [qs]);
  const exportCsv = async () => {
    const r = await fetch(`/api/affiliates/commissions.csv${qs ? `?${qs}` : ''}`, { headers: { Authorization: `Bearer ${localStorage.getItem('ff_token')}` } });
    if (!r.ok) return toast('Export failed');
    const url = URL.createObjectURL(await r.blob());
    Object.assign(document.createElement('a'), { href: url, download: 'affiliate-commissions.csv' }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Panel pad={false} title="Commissions" actions={<>
      <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}><option value="">Every status</option>{Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
      <select value={filter.affiliateId} onChange={(e) => setFilter({ ...filter, affiliateId: e.target.value })}><option value="">Every affiliate</option>{affiliates.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
      <button className="btn ghost sm" onClick={exportCsv}><Icon name="download" size={14} /> CSV</button></>}>
      {!list ? <div className="skeleton" style={{ height: 120, margin: 16 }} /> : !list.length ? <Empty icon="receipt" title="No commissions here" text="Sales that come through an affiliate’s link or coupon show up here." /> :
        <div className="aff-table-wrap"><table className="aff-table">
          <thead><tr><th>Date</th><th>Affiliate</th><th>Order</th><th>Via</th><th className="num">Order</th><th className="num">Commission</th><th>Status</th></tr></thead>
          <tbody>{list.map((c) => (
            <tr key={c.id}>
              <td>{fmtDate(c.at)}</td>
              <td>{c.affiliate}</td>
              <td><code>{c.orderId.slice(-6).toUpperCase()}</code>{c.test && <span className="aff-pill test">test</span>}</td>
              <td>{c.via === 'coupon' ? 'Coupon' : 'Link'}</td>
              <td className="num">{inr(c.orderTotal)}</td>
              <td className="num">{inr(c.amount)}{c.refunded > 0 && <small>−{inr(c.refunded)} refunded</small>}{c.clawback > 0 && <small className="bad">{inr(c.clawback)} refunded after payout</small>}</td>
              <td><span className={`aff-pill ${c.status}`} title={STATUS[c.status][1]}>{STATUS[c.status][0]}</span>{c.status === 'pending' && c.holdUntil && <small>until {fmtDate(c.holdUntil)}</small>}{c.reason && <small>{c.reason}</small>}</td>
            </tr>))}
          </tbody>
        </table></div>}
    </Panel>
  );
}

function Payouts({ d, onChange }) {
  const [list, setList] = useState(null);
  const [pay, setPay] = useState(null);
  const [rev, setRev] = useState(0);
  useEffect(() => { api('/affiliates/payouts').then((r) => setList(r.payouts)).catch((e) => toast(e.message)); }, [rev]);
  const due = d.affiliates.filter((a) => a.payable > 0);
  const submit = async (force) => {
    try { const p = await api(`/affiliates/${pay.a.id}/payouts`, 'POST', { reference: pay.reference, note: pay.note, ...(force ? { force: true } : {}) }); toast(`Marked ${inr(p.amount)} paid`); setPay(null); setRev((r) => r + 1); onChange(); } catch (e) {
      if (e.data?.belowMinimum && await confirmDialog({ title: 'Below your minimum payout', text: `${e.message}. Pay anyway?`, confirm: 'Pay anyway' })) return submit(true);
      toast(e.message);
    }
  };
  const csv = async () => {
    const r = await fetch('/api/affiliates/payouts?format=csv', { headers: { Authorization: `Bearer ${localStorage.getItem('ff_token')}` } });
    const url = URL.createObjectURL(await r.blob());
    Object.assign(document.createElement('a'), { href: url, download: 'affiliate-payouts.csv' }).click();
  };
  return <>
    <Panel title="To pay" pad={false}>
      {!due.length ? <p className="muted aff-pad">Nothing approved to pay right now. Commissions are approved once the hold period ({d.program.holdDays} days) after a sale ends.</p> :
        <div className="aff-table-wrap"><table className="aff-table"><tbody>{due.map((a) => (
          <tr key={a.id}><td><b>{a.name}</b><small>{a.payout ? (a.payout.upi || `${a.payout.account} · ${a.payout.ifsc}`) : 'No payout details yet'}</small></td><td className="num"><b>{inr(a.payable)}</b>{a.payable < d.program.minPayout && <small>below the ₹{d.program.minPayout} minimum</small>}</td>
            <td className="aff-actions"><button className="btn sm primary" onClick={() => setPay({ a, reference: '', note: '' })}>Mark paid</button></td></tr>))}</tbody></table></div>}
    </Panel>
    <Panel title="Payout history" pad={false} actions={list?.length ? <button className="btn ghost sm" onClick={csv}><Icon name="download" size={14} /> CSV</button> : null}>
      {!list ? null : !list.length ? <p className="muted aff-pad">No payouts yet.</p> :
        <div className="aff-table-wrap"><table className="aff-table"><thead><tr><th>Date</th><th>Affiliate</th><th className="num">Amount</th><th>Paid to</th><th>Reference</th></tr></thead>
          <tbody>{list.map((p) => <tr key={p.id}><td>{fmtDate(p.at)}</td><td>{p.affiliate}</td><td className="num">{inr(p.amount)}<small>{p.count} sale{p.count > 1 ? 's' : ''}</small></td><td>{p.to || '—'}</td><td><code>{p.reference}</code>{p.note && <small>{p.note}</small>}</td></tr>)}</tbody></table></div>}
    </Panel>
    {pay && <Modal title={`Pay ${pay.a.name} ${inr(pay.a.payable)}`} onClose={() => setPay(null)} width={460}>
      <form className="aff-form" onSubmit={(e) => { e.preventDefault(); submit(false); }}>
        <p className="muted sm">Send the money by UPI or bank transfer first (open Details on the Affiliates tab for the full UPI ID / account), then record it here.</p>
        <label>Transaction reference (UTR)<input required value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></label>
        <label>Note<input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} /></label>
        <button className="btn primary">Mark as paid</button>
      </form>
    </Modal>}
  </>;
}

const RateInput = ({ value, onChange }) => <span className="aff-rate"><input type="number" min={0} step="0.01" value={value.value} onChange={(e) => onChange({ ...value, value: e.target.value })} /><select value={value.type} onChange={(e) => onChange({ ...value, type: e.target.value })}><option value="percent">% of sale</option><option value="flat">₹ per sale</option></select></span>;
function Settings({ d, onSaved }) {
  const [p, setP] = useState(d.program);
  const [busy, setBusy] = useState(false);
  const set = (x) => setP({ ...p, ...x });
  const toggle = (k, id) => set({ [k]: p[k].includes(id) ? p[k].filter((x) => x !== id) : [...p[k], id] });
  const setRate = (target, id, v) => {
    const rest = p.rates.filter((r) => !(r.target === target && r.id === id));
    set({ rates: v === '' ? rest : [...rest, { target, id, type: p.rates.find((r) => r.target === target && r.id === id)?.type || p.defaultRate.type, value: Number(v) }] });
  };
  const rateOf = (target, id) => p.rates.find((r) => r.target === target && r.id === id);
  const save = async () => {
    setBusy(true);
    try {
      const { enabled, name, slug, funnelIds, productIds, defaultRate, rates, cookieDays, approval, holdDays, minPayout, terms, couponDiscount, autoCoupon } = p;
      await api('/affiliates/program', 'PUT', { enabled, name, slug, funnelIds, productIds, defaultRate: { ...defaultRate, value: Number(defaultRate.value) }, rates, cookieDays: Number(cookieDays), approval, holdDays: Number(holdDays), minPayout: Number(minPayout), terms, couponDiscount: { ...couponDiscount, value: Number(couponDiscount.value) }, autoCoupon });
      toast('Program saved'); onSaved();
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  return (
    <Panel title="Program settings">
      <div className="aff-form aff-settings">
        <label className="fcheck"><input type="checkbox" checked={p.enabled} onChange={(e) => set({ enabled: e.target.checked })} /><span><b>Affiliate program on</b><small className="muted"> · tracks ?ref= links and affiliate coupons on your funnels</small></span></label>
        <div className="aff-grid">
          <label>Program name<input value={p.name} placeholder="e.g. Asha’s Partner Program" onChange={(e) => set({ name: e.target.value })} /></label>
          <label>Sign-up page address<span className="aff-prefix"><small>/affiliate/</small><input value={p.slug} onChange={(e) => set({ slug: e.target.value })} /></span></label>
          <label>Default commission<RateInput value={p.defaultRate} onChange={(v) => set({ defaultRate: v })} /></label>
          <label>Cookie window (days)<input type="number" min={1} max={365} value={p.cookieDays} onChange={(e) => set({ cookieDays: e.target.value })} /></label>
          <label>Hold period (days after the sale)<input type="number" min={0} max={365} value={p.holdDays} onChange={(e) => set({ holdDays: e.target.value })} /></label>
          <label>Minimum payout (₹)<input type="number" min={0} value={p.minPayout} onChange={(e) => set({ minPayout: e.target.value })} /></label>
          <label>New sign-ups<select value={p.approval} onChange={(e) => set({ approval: e.target.value })}><option value="manual">I approve each one</option><option value="auto">Approved automatically</option></select></label>
          <label>Affiliate coupons give<RateInput value={p.couponDiscount} onChange={(v) => set({ couponDiscount: v })} /></label>
        </div>
        <label className="fcheck"><input type="checkbox" checked={p.autoCoupon} onChange={(e) => set({ autoCoupon: e.target.checked })} /><span>Give every approved affiliate a coupon with their code</span></label>
        <h4>Funnels in the program <small className="muted">· none ticked = all · commission for a funnel overrides the default ({rateText(p.defaultRate)})</small></h4>
        <div className="aff-pick">{d.funnels.map((f) => <div key={f.id} className="aff-pick-row"><label className="fcheck"><input type="checkbox" checked={p.funnelIds.includes(f.id)} onChange={() => toggle('funnelIds', f.id)} /><span>{f.name}{!f.published && <small className="muted"> · not published</small>}</span></label><input className="aff-mini" type="number" min={0} placeholder="default" value={rateOf('funnel', f.id)?.value ?? ''} onChange={(e) => setRate('funnel', f.id, e.target.value)} /></div>)}</div>
        {!!d.products.length && <>
          <h4>Products <small className="muted">· none ticked = every product earns · a product’s commission beats its funnel’s</small></h4>
          <div className="aff-pick">{d.products.map((x) => <div key={x.id} className="aff-pick-row"><label className="fcheck"><input type="checkbox" checked={p.productIds.includes(x.id)} onChange={() => toggle('productIds', x.id)} /><span>{x.name}</span></label><input className="aff-mini" type="number" min={0} placeholder="default" value={rateOf('product', x.id)?.value ?? ''} onChange={(e) => setRate('product', x.id, e.target.value)} /></div>)}</div>
        </>}
        <p className="hint">Funnel / product commissions use the same unit as the default ({p.defaultRate.type === 'flat' ? '₹ per sale' : '% of the sale'}). Shipping and COD fees never earn commission. COD sales earn once the cash is collected; refunds, cancellations and returns reverse the commission automatically.</p>
        <label>Terms affiliates accept<textarea rows={5} value={p.terms} onChange={(e) => set({ terms: e.target.value })} placeholder="How you pay, what’s not allowed (e.g. no paid ads on your brand name)…" /></label>
        <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </Panel>
  );
}
