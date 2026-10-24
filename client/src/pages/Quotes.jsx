// Quotes / proposals: write one, send the private link, the client pays (deposit and balance) — each payment is an order.
import { useEffect, useState } from 'react';
import { api, fmtDate } from '../api';
import { Layout, Panel, Icon, Empty, Modal, toast, confirmDialog, promptDialog } from '../ui';
import { fmtMoney } from '../stripePay';

const STATUS = { draft: ['Draft', ''], sent: ['Sent', 'info'], viewed: ['Viewed', 'info'], deposit_paid: ['Deposit paid', 'warn'], paid: ['Paid', 'ok'], accepted: ['Accepted', 'ok'], declined: ['Declined', 'bad'], expired: ['Expired', 'bad'] };
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'SGD', 'AED'];
const blank = () => ({ client: { name: '', email: '', phone: '', company: '', gstin: '', state: '' }, title: '', intro: '', items: [{ name: '', detail: '', qty: 1, price: 0 }], currency: 'INR', deposit: 0, validDays: 14, terms: '', taxNote: '', design: 'classic', details: [], accent: '' });
// accent colours for the client's page (or any colour from the picker)
const ACCENTS = ['#4f46e5', '#0f766e', '#b45309', '#be123c', '#7c3aed', '#0369a1', '#15803d', '#c2410c', '#1f2937', '#a16207'];
// how the client's quote page looks (QuotePublic.jsx, .qd-<id> in styles.css)
export const DESIGNS = [['classic', 'Classic', 'Clean card, your accent colour'], ['modern', 'Modern', 'Bold colour header band'], ['minimal', 'Minimal', 'Black on white, hairline rules'], ['bold', 'Bold', 'Dark header, big total'], ['elegant', 'Elegant', 'Serif type, warm gold accents'], ['compact', 'Compact', 'Dense — fits long item lists']];
const fromTemplate = (t) => ({ ...blank(), title: t.title, intro: t.intro, items: [...t.items.map((i) => ({ ...i })), ...(t.addons || []).map((i) => ({ ...i, optional: true }))], details: (t.details || []).map((d) => ({ ...d })), deposit: t.deposit, validDays: t.validDays, terms: t.terms, taxNote: t.taxNote, templateId: t.id });
const copy = (t) => navigator.clipboard?.writeText(t).then(() => toast('Link copied'), () => promptDialog({ title: 'Copy the link', value: t, readOnly: true, confirm: 'Done', cancel: null }));

export default function Quotes() {
  const [list, setList] = useState(null);
  const [edit, setEdit] = useState(null);
  const [picking, setPicking] = useState(false);
  const load = () => api('/quotes').then(setList).catch((e) => toast(e.message));
  useEffect(() => { load(); }, []);
  const act = async (path, method = 'POST', body = {}, msg) => { try { const r = await api(path, method, body); if (msg) toast(msg); load(); return r; } catch (e) { toast(e.message); return null; } };
  const open = list?.filter((q) => ['sent', 'viewed', 'deposit_paid'].includes(q.status)) || [];
  return (
    <Layout title="Quotes" subtitle="Proposals with a pay link — your client reads it and pays the deposit or the full amount online" actions={<button className="btn primary" onClick={() => setPicking(true)}><Icon name="plus" size={16} /> New quote</button>}>
      {!list ? <div className="skeleton" /> : !list.length ? (
        <Empty icon="receipt" title="No quotes yet" text="Write a proposal with line items and an optional deposit. Your client gets a private link to accept and pay — by UPI / card in ₹, or by card in any currency.">
          <button className="btn primary" onClick={() => setPicking(true)}>Write your first quote</button>
        </Empty>
      ) : (
        <Panel title={`${list.length} quote${list.length === 1 ? '' : 's'}${open.length ? ` · ${open.length} awaiting payment` : ''}`} pad={false}>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Quote</th><th>Client</th><th className="r">Total</th><th className="r">Paid</th><th>Status</th><th>Created</th><th /></tr></thead>
            <tbody>{list.map((q) => (
              <tr key={q.id}>
                <td><b>{q.title}</b><small className="sub-t mono">{q.number}</small></td>
                <td>{q.client.name || '—'}<small className="sub-t">{q.client.email}</small></td>
                <td className="r">{fmtMoney(q.total, q.currency)}</td>
                <td className="r">{q.paid ? fmtMoney(q.paid, q.currency) : '—'}</td>
                <td><span className={`pill ${STATUS[q.status]?.[1] || ''}`}>{STATUS[q.status]?.[0] || q.status}</span></td>
                <td>{fmtDate(q.at)}</td>
                <td className="r nowrap">
                  <button className="btn ghost sm" title="Copy the client’s link" aria-label="Copy the client’s link" onClick={() => copy(q.link)}><Icon name="link" size={14} /></button>
                  <a className="btn ghost sm" title="See what your client sees" aria-label="See what your client sees" href={`${q.link}&preview=1`} target="_blank" rel="noreferrer"><Icon name="eye" size={14} /></a>
                  {!q.paid && <button className="btn ghost sm" title="Edit" aria-label="Edit" onClick={() => setEdit({ ...q, validDays: '' })}><Icon name="edit" size={14} /></button>}
                  {!q.paid && q.client.email && <button className="btn ghost sm" title="Email the link to the client" aria-label="Email the link to the client" onClick={() => act(`/quotes/${q.id}/send`, 'POST', {}, `Sent to ${q.client.email}`)}><Icon name="send" size={14} /></button>}
                  <button className="btn ghost sm" title="Duplicate" aria-label="Duplicate" onClick={() => act(`/quotes/${q.id}/duplicate`, 'POST', {}, 'Duplicated')}><Icon name="copy" size={14} /></button>
                  {!q.paid && <button className="btn ghost sm danger" title="Delete" aria-label="Delete" onClick={async () => (await confirmDialog({ title: `Delete ${q.number}?`, confirm: 'Delete', danger: true })) && act(`/quotes/${q.id}`, 'DELETE', null, 'Deleted')}><Icon name="trash" size={14} /></button>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        </Panel>
      )}
      {picking && <TemplatePicker onClose={() => setPicking(false)} onPick={(t) => { setPicking(false); setEdit(t ? fromTemplate(t) : blank()); }} />}
      {edit && <QuoteEditor q={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </Layout>
  );
}

function QuoteEditor({ q: q0, onClose, onSaved }) {
  const [q, setQ] = useState(q0);
  const [busy, setBusy] = useState(false);
  const set = (patch) => setQ({ ...q, ...patch });
  const setC = (patch) => setQ({ ...q, client: { ...q.client, ...patch } });
  const setItem = (i, patch) => setQ({ ...q, items: q.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  const total = q.items.reduce((s, i) => s + (i.optional ? 0 : (Number(i.qty) || 1) * (Number(i.price) || 0)), 0);
  const addons = q.items.filter((i) => i.optional).reduce((s, i) => s + (Number(i.qty) || 1) * (Number(i.price) || 0), 0);
  const setDetail = (i, patch) => setQ({ ...q, details: (q.details || []).map((d, j) => (j === i ? { ...d, ...patch } : d)) });
  const save = async (send) => {
    setBusy(true);
    try {
      const body = { client: q.client, title: q.title, intro: q.intro, items: q.items, currency: q.currency, deposit: q.deposit, terms: q.terms, taxNote: q.taxNote || '', design: q.design || 'classic', details: (q.details || []).filter((d) => d.label && d.value), accent: q.accent || '', ...(q.validDays !== '' ? { validDays: q.validDays } : {}) };
      const r = q.id ? await api(`/quotes/${q.id}`, 'PUT', body) : await api('/quotes', 'POST', body);
      if (send) { await api(`/quotes/${r.id}/send`, 'POST', {}); toast(`Sent to ${r.client.email}`); } else toast('Quote saved');
      onSaved(r);
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  return (
    <Modal title={q.id ? `Edit ${q.number}` : 'New quote'} onClose={onClose} width={820}>
      <div className="m-body q-edit">
      <div className="form2">
        <label className="fld"><span>Client name</span><input value={q.client.name} onChange={(e) => setC({ name: e.target.value })} placeholder="Meera Rao" /></label>
        <label className="fld"><span>Client email</span><input type="email" value={q.client.email} onChange={(e) => setC({ email: e.target.value })} placeholder="meera@company.com" /></label>
        <label className="fld"><span>Company <small className="muted">· optional</small></span><input value={q.client.company} onChange={(e) => setC({ company: e.target.value })} /></label>
        <label className="fld"><span>Phone <small className="muted">· optional</small></span><input value={q.client.phone} onChange={(e) => setC({ phone: e.target.value })} /></label>
        {q.currency === 'INR' && <label className="fld"><span>Client GSTIN <small className="muted">· for their input tax credit</small></span><input value={q.client.gstin} maxLength={15} onChange={(e) => setC({ gstin: e.target.value.toUpperCase() })} /></label>}
        {q.currency === 'INR' && q.client.gstin && <label className="fld"><span>Client state</span><input value={q.client.state} onChange={(e) => setC({ state: e.target.value })} placeholder="Maharashtra" /></label>}
      </div>
      <label className="fld"><span>Title</span><input value={q.title} onChange={(e) => set({ title: e.target.value })} placeholder="Brand strategy sprint" /></label>
      <div className="fld"><span>Key details <small className="muted">· shown in a card at the top — e.g. event date, venue, property, travellers</small></span>
        <div className="q-details-ed">{(q.details || []).map((d, i) => (
          <div key={i} className="q-det-row">
            <input value={d.label} maxLength={40} onChange={(e) => setDetail(i, { label: e.target.value })} placeholder="Label — e.g. Event date" aria-label="Detail label" />
            <input value={d.value} maxLength={160} onChange={(e) => setDetail(i, { value: e.target.value })} placeholder="Value — e.g. 14 Feb 2027" aria-label="Detail value" />
            <button type="button" className="btn ghost sm" aria-label="Remove detail" onClick={() => set({ details: q.details.filter((_, j) => j !== i) })}><Icon name="x" size={14} /></button>
          </div>
        ))}
        {(q.details || []).length < 12 && <button type="button" className="btn ghost sm" onClick={() => set({ details: [...(q.details || []), { label: '', value: '' }] })}><Icon name="plus" size={14} /> Add a detail</button>}</div>
      </div>
      <label className="fld"><span>Introduction <small className="muted">· what you’ll do and the outcome</small></span><textarea rows={3} value={q.intro} onChange={(e) => set({ intro: e.target.value })} /></label>
      <div className="tbl-wrap"><table className="tbl q-items">
        <thead><tr><th>Item</th><th style={{ width: 80 }}>Qty</th><th style={{ width: 130 }}>Price</th><th className="r" style={{ width: 110 }}>Amount</th><th /></tr></thead>
        <tbody>{q.items.map((it, i) => (
          <tr key={i}>
            <td><input value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} placeholder="Strategy workshop" /><input className="sub-in" value={it.detail || ''} onChange={(e) => setItem(i, { detail: e.target.value })} placeholder="Details (optional)" /><label className="q-opt"><input type="checkbox" checked={!!it.optional} onChange={(e) => setItem(i, { optional: e.target.checked })} /> Optional add-on — the client can tick it on</label></td>
            <td><input type="number" min="1" value={it.qty} onChange={(e) => setItem(i, { qty: e.target.value })} /></td>
            <td><input type="number" min="0" value={it.price} onChange={(e) => setItem(i, { price: e.target.value })} /></td>
            <td className="r">{it.optional ? <span className="muted">+{fmtMoney((Number(it.qty) || 1) * (Number(it.price) || 0), q.currency)}</span> : fmtMoney((Number(it.qty) || 1) * (Number(it.price) || 0), q.currency)}</td>
            <td>{q.items.length > 1 && <button className="btn ghost sm" onClick={() => set({ items: q.items.filter((_, j) => j !== i) })}><Icon name="x" size={14} /></button>}</td>
          </tr>
        ))}</tbody>
        <tfoot><tr><td colSpan={3}><button className="btn ghost sm" onClick={() => set({ items: [...q.items, { name: '', detail: '', qty: 1, price: 0 }] })}><Icon name="plus" size={14} /> Add item</button></td><td className="r"><b>{fmtMoney(total, q.currency)}</b>{addons > 0 && <small className="sub-t">+ up to {fmtMoney(addons, q.currency)} in add-ons</small>}</td><td /></tr></tfoot>
      </table></div>
      <div className="form2">
        <label className="fld"><span>Currency</span><select value={q.currency} onChange={(e) => set({ currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="fld"><span>Deposit to start <small className="muted">· % paid first, the rest later from the same link</small></span><select value={q.deposit} onChange={(e) => set({ deposit: Number(e.target.value) })}>{[...new Set([0, 10, 20, 25, 30, 40, 50, 60, 75, 100, Number(q.deposit) || 0])].sort((a, b) => a - b).map((d) => <option key={d} value={d}>{d ? `${d}% (${fmtMoney((total * d) / 100, q.currency)})` : 'No deposit — pay in full'}</option>)}</select></label>
        <label className="fld"><span>Valid for</span><select value={q.validDays} onChange={(e) => set({ validDays: e.target.value })}>{q.id && <option value="">Keep {q.validUntil ? `(until ${fmtDate(q.validUntil)})` : '(no expiry)'}</option>}{[...(![7, 14, 30, 60, 0, ''].includes(Number(q.validDays)) && q.validDays !== '' ? [[Number(q.validDays), `${q.validDays} days`]] : []), [7, '7 days'], [14, '14 days'], [30, '30 days'], [60, '60 days'], [0, 'No expiry']].map(([d, l]) => <option key={d} value={d}>{l}</option>)}</select></label>
      </div>
      <label className="fld"><span>GST / tax line <small className="muted">· shown under the total, e.g. “Exclusive of GST @18% (SAC 998311)”</small></span><input value={q.taxNote || ''} maxLength={300} onChange={(e) => set({ taxNote: e.target.value })} placeholder="Prices are exclusive of GST @18%" /></label>
      <label className="fld"><span>Terms <small className="muted">· payment, timelines, revisions, cancellation</small></span><textarea rows={q.terms?.length > 200 ? 6 : 3} value={q.terms} onChange={(e) => set({ terms: e.target.value })} /></label>
      <div className="fld"><span>Colour <small className="muted">· the accent on your client’s page</small></span>
        <div className="q-colors">
          <button type="button" className={`q-col auto ${!q.accent ? 'on' : ''}`} onClick={() => set({ accent: '' })} title="Your brand colour">Auto</button>
          {ACCENTS.map((c) => <button type="button" key={c} className={`q-col ${q.accent === c ? 'on' : ''}`} style={{ background: c }} aria-label={`Accent ${c}`} onClick={() => set({ accent: c })} />)}
          <label className="q-col custom" title="Any colour"><input type="color" value={q.accent || '#4f46e5'} onChange={(e) => set({ accent: e.target.value })} /><Icon name="edit" size={12} /></label>
        </div>
      </div>
      <div className="fld"><span>Design <small className="muted">· how your client sees it</small></span>
        <div className="qd-pick">{DESIGNS.map(([id, name, about]) => (
          <button type="button" key={id} className={`qd-sw qd-${id} ${(q.design || 'classic') === id ? 'on' : ''}`} onClick={() => set({ design: id })} title={about} style={{ '--qa': q.accent || '#4f46e5' }}>
            <span className="qd-mini"><i /><b /><b /><b /><em /></span><span className="qd-name">{name}</span>
          </button>
        ))}</div>
      </div>
      <p className="hint">{q.currency === 'INR' ? 'Paid through your Razorpay (UPI, cards, netbanking) — or Stripe if that’s what you connected.' : `Paid by card in ${q.currency} through your Stripe account.`} Each payment becomes an order with an invoice.</p>
      <div className="m-foot">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn ghost" disabled={busy} onClick={() => save(false)}>Save</button>
        <button className="btn primary" disabled={busy || !q.client.email} title={q.client.email ? '' : 'Add the client’s email to send it'} onClick={() => save(true)}><Icon name="send" size={15} /> Save & email to client</button>
      </div>
      </div>
    </Modal>
  );
}

function TemplatePicker({ onClose, onPick }) {
  const [d, setD] = useState(null);
  const [ind, setInd] = useState('');
  const [qy, setQy] = useState('');
  useEffect(() => { api('/quote-templates').then((r) => { setD(r); setInd(r.current); }).catch(() => setD({ industries: [] })); }, []);
  const cur = d?.industries.find((x) => x.id === ind);
  const words = qy.trim().toLowerCase();
  const list = words ? (d?.industries || []).flatMap((x) => x.templates.map((t) => ({ ...t, ind: x.name }))).filter((t) => `${t.name} ${t.about} ${t.title} ${t.ind}`.toLowerCase().includes(words)) : cur?.templates || [];
  return (
    <Modal title="New quote" onClose={onClose} width={980}>
      <div className="m-body qt-body">
        <div className="qt-top">
          <p className="muted sm">Start from a ready-made quote written the way businesses in your industry quote in India — line items, GST line, advance and terms filled in. Change anything before you send it.</p>
          <button className="btn ghost" onClick={() => onPick(null)}><Icon name="plus" size={15} /> Blank quote</button>
        </div>
        {!d ? <div className="skeleton" /> : !d.industries.length ? <p className="muted">No templates yet — start with a blank quote.</p> : <>
          <div className="qt-filters">
            <select value={ind} onChange={(e) => { setInd(e.target.value); setQy(''); }} aria-label="Industry">{d.industries.map((x) => <option key={x.id} value={x.id}>{x.name}{x.id === d.current ? ' — your CRM style' : ''}</option>)}</select>
            <input value={qy} onChange={(e) => setQy(e.target.value)} placeholder="Search all industries — e.g. kitchen, audit, wedding" aria-label="Search templates" />
          </div>
          <div className="qt-grid">{list.map((t) => (
            <button type="button" key={t.id} className="qt-card" onClick={() => onPick(t)}>
              <span className="qt-h"><b>{t.name}</b>{t.ind && <small className="pill">{t.ind}</small>}</span>
              <span className="qt-about">{t.about}</span>
              <span className="qt-items">{t.items.slice(0, 3).map((i) => <span key={i.name}>{i.name}</span>)}{t.items.length > 3 && <span className="muted">+{t.items.length - 3} more</span>}</span>
              {t.addons?.length > 0 && <span className="qt-add">+ {t.addons.length} optional add-on{t.addons.length === 1 ? '' : 's'}</span>}
              <span className="qt-f"><b>{fmtMoney(t.total, 'INR')}</b><small>{t.deposit ? `${t.deposit}% advance` : 'Pay in full'} · valid {t.validDays} days</small></span>
            </button>
          ))}</div>
          {!list.length && <p className="muted">Nothing matches “{qy}”.</p>}
        </>}
      </div>
    </Modal>
  );
}
