// GST returns and e-documents (server/gst-returns.js): the GSTR-1 panel for counter bills and checkout sales together,
// and the per-document dialog — e-invoice JSON (NIC schema 1.1), the IRN pasted back from the IRP, e-way bill JSON.
// No GST Suvidha Provider is connected yet: the files are uploaded on the government portals by the seller.
import { useEffect, useState } from 'react';
import { api } from './api';
import { Panel, Icon, Modal, toast } from './ui';
import './gst.css';

const rs = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const fail = (e) => toast(e.message);
export const saveJson = (data, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
// the IRP's signed QR as an image (qrcode is already a client dependency)
export const qrImage = (text, width = 160) => (text ? import('qrcode').then((m) => m.toDataURL(text, { margin: 1, width, errorCorrectionLevel: 'M' })).catch(() => null) : Promise.resolve(null));

// GSTR-1 for a month: both sources by default, each can be switched off; JSON for the offline tool, CSV for accountants
export function Gstr1Panel({ title = 'GSTR-1', counter: hasCounter = true }) {
  const now = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()).slice(0, 7);
  const [month, setMonth] = useState(now);
  const [src, setSrc] = useState({ counter: hasCounter, checkout: true });
  const [r, setR] = useState(null);
  const [busy, setBusy] = useState(false);
  const qs = `month=${month}&counter=${src.counter ? 1 : 0}&checkout=${src.checkout ? 1 : 0}`;
  const run = async (download) => {
    setBusy(true);
    try { const d = await api(`/gst/gstr1?${qs}`); setR(d); if (download) saveJson(d.json, `GSTR1_${d.json.gstin}_${d.json.fp}.json`); } catch (e) { fail(e); setR(null); }
    setBusy(false);
  };
  const csv = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/gst/gstr1.csv?${qs}`, { headers: { Authorization: `Bearer ${localStorage.getItem('ff_token') || ''}` } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Couldn’t make the CSV');
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || `GSTR1_${month}.csv`;
      const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { fail(e); }
    setBusy(false);
  };
  const toggle = (k) => { const next = { ...src, [k]: !src[k] }; if (!next.counter && !next.checkout) return; setSrc(next); setR(null); };
  const s = r?.summary;
  return (
    <Panel title={title} actions={<div className="row gst-acts"><input type="month" value={month} max={now} onChange={(e) => { setMonth(e.target.value); setR(null); }} aria-label="Month" /><button className="btn ghost sm" disabled={busy} onClick={() => run(false)}>Check</button><button className="btn ghost sm" disabled={busy} onClick={csv}><Icon name="download" size={13} /> CSV</button><button className="btn primary sm" disabled={busy} onClick={() => run(true)}><Icon name="download" size={13} /> JSON</button></div>}>
      <p className="muted sm">Your tax invoices and credit notes for the month — B2B, B2C (large and small), exports, credit notes, the HSN summary and documents issued — ready for the GST portal’s offline tool. The CSV lists every document for your accountant. Check it on the portal before you file.</p>
      <div className="gst-src" role="group" aria-label="Include">
        <label className="gst-chip"><input type="checkbox" checked={src.counter} onChange={() => toggle('counter')} /> Counter bills</label>
        <label className="gst-chip"><input type="checkbox" checked={src.checkout} onChange={() => toggle('checkout')} /> Checkout sales</label>
      </div>
      {s && <div className="gst-sum">
        <span><b>{s.invoices}</b> {s.invoices === 1 ? 'invoice' : 'invoices'}{s.cancelled ? ` · ${s.cancelled} cancelled` : ''}</span>
        <span><b>{s.b2b}</b> B2B · <b>{s.b2cl}</b> B2C large{s.exp ? <> · <b>{s.exp}</b> export</> : ''}</span>
        <span><b>{s.credit_notes}</b> {s.credit_notes === 1 ? 'credit note' : 'credit notes'}</span>
        <span>Taxable <b>{rs(s.taxable)}</b> · tax <b>{rs(s.tax)}</b></span>
        <span className="muted">Counter {s.by_source.counter.invoices} + {s.by_source.counter.credit_notes} · checkout {s.by_source.checkout.invoices} + {s.by_source.checkout.credit_notes}</span>
        {s.warnings.map((w) => <p key={w} className="hint warn sm">{w}</p>)}
      </div>}
    </Panel>
  );
}

// docs: [{ source: 'counter' | 'counter-note' | 'checkout', id, number, label, b2b, irn }]; eway: a counter bill or null
export function GstDocsModal({ title, docs, eway, onClose, onChanged }) {
  const [irnFor, setIrnFor] = useState(null);
  const [need, setNeed] = useState(null); // { doc, missing } when the e-invoice is missing buyer details
  const [buyer, setBuyer] = useState({ address: '', pincode: '', city: '' });
  const einv = async (d, extra) => {
    try {
      const r = await api(`/gst/einvoice/${d.source}/${d.id}`, 'POST', extra ? { buyer: extra } : {});
      saveJson([r.json], r.filename); // the IRP bulk tool takes an array of invoices; a GSP takes r.json on its own
      toast(`E-invoice JSON for ${d.number} downloaded — upload it on the IRP portal, then add the IRN here`); setNeed(null); onChanged?.();
    } catch (e) { if (e.status === 422) setNeed({ doc: d, missing: e.data?.missing || [e.message] }); else fail(e); }
  };
  const buyerGap = need?.missing.some((m) => /buyer’s (address|6-digit PIN|city)/.test(m));
  return (
    <Modal title={title} onClose={onClose} width={680}>
      <div className="m-body gst-docs">
        <p className="muted sm">E-invoices are for sales to GST-registered buyers. Download the JSON, upload it on the IRP portal (e-Invoice → Bulk upload), then paste the IRN, acknowledgement and signed QR back here — they print on the invoice.</p>
        <table className="gst-tbl"><tbody>{docs.map((d) => (
          <tr key={d.source + d.id}>
            <td><b className="mono">{d.number}</b><small className="sub-t">{d.label}{d.irn ? ' · IRN added' : ''}</small></td>
            <td className="r nowrap">
              <button className="btn ghost sm" disabled={!d.b2b} title={d.b2b ? 'Download the e-invoice JSON' : 'Only for buyers with a GSTIN (B2B)'} onClick={() => einv(d)}><Icon name="download" size={13} /> E-invoice JSON</button>
              <button className="btn ghost sm" disabled={!d.b2b} onClick={() => setIrnFor(d)}>{d.irn ? 'Edit IRN' : 'Add IRN'}</button>
            </td>
          </tr>))}</tbody></table>
        {need && <div className="gst-need" role="alert">
          <p className="sm"><b>{need.doc.number} can’t become an e-invoice yet.</b> Missing:</p>
          <ul className="sm">{need.missing.map((m) => <li key={m}>{m}</li>)}</ul>
          {buyerGap && <form className="gst-form" onSubmit={(e) => { e.preventDefault(); einv(need.doc, buyer); }}>
            <input className="full" placeholder="Buyer’s address" value={buyer.address} onChange={(e) => setBuyer({ ...buyer, address: e.target.value })} aria-label="Buyer address" />
            <input placeholder="City / town" value={buyer.city} onChange={(e) => setBuyer({ ...buyer, city: e.target.value })} aria-label="Buyer city" />
            <input placeholder="PIN code" inputMode="numeric" maxLength={6} value={buyer.pincode} onChange={(e) => setBuyer({ ...buyer, pincode: e.target.value.replace(/\D/g, '') })} aria-label="Buyer PIN code" />
            <button className="btn primary sm">Save & download</button>
          </form>}
        </div>}
        {eway && <EwayForm bill={eway} />}
      </div>
      {irnFor && <IrnModal doc={irnFor} onClose={() => setIrnFor(null)} onSaved={() => { setIrnFor(null); onChanged?.(); }} />}
    </Modal>
  );
}

function IrnModal({ doc, onClose, onSaved }) {
  const [v, setV] = useState({ irn: '', ack_no: '', ack_dt: '', signed_qr: '' });
  const save = async (e) => { e.preventDefault(); try { await api(`/gst/irn/${doc.source}/${doc.id}`, 'PUT', v); toast(`IRN saved on ${doc.number}`); onSaved(); } catch (e2) { fail(e2); } };
  const clear = async () => { try { await api(`/gst/irn/${doc.source}/${doc.id}`, 'DELETE'); toast('IRN removed'); onSaved(); } catch (e) { fail(e); } };
  return (
    <Modal title={`IRN for ${doc.number}`} onClose={onClose} width={560}>
      <form className="m-body gst-form one" onSubmit={save}>
        <label>IRN<input className="mono" required maxLength={64} value={v.irn} onChange={(e) => setV({ ...v, irn: e.target.value.trim() })} placeholder="64 characters from the IRP" /></label>
        <label>Ack no.<input inputMode="numeric" value={v.ack_no} onChange={(e) => setV({ ...v, ack_no: e.target.value })} placeholder="112610000012345" /></label>
        <label>Ack date<input value={v.ack_dt} onChange={(e) => setV({ ...v, ack_dt: e.target.value })} placeholder="2026-10-29 14:05:00" /></label>
        <label>Signed QR code<textarea rows={4} className="mono" value={v.signed_qr} onChange={(e) => setV({ ...v, signed_qr: e.target.value.trim() })} placeholder="The long text (three parts separated by dots) — printed as a QR on the invoice" /></label>
        <div className="row">{doc.irn && <button type="button" className="btn ghost" onClick={clear}>Remove IRN</button>}<span className="grow" /><button className="btn primary">Save IRN</button></div>
      </form>
    </Modal>
  );
}

// transport details → the e-way bill bulk-upload JSON for a counter bill
function EwayForm({ bill }) {
  const [chk, setChk] = useState(null);
  const [t, setT] = useState({ mode: 'road', distance: '', vehicle_no: '', vehicle_type: 'R', transporter_id: '', transporter_name: '', doc_no: '', doc_date: '' });
  const [buyer, setBuyer] = useState({ address: '', pincode: '' });
  const [anyway, setAnyway] = useState(false);
  const [missing, setMissing] = useState([]);
  useEffect(() => { api(`/gst/eway/${bill.id}`).then((d) => { setChk(d); if (d.transport) setT((x) => ({ ...x, ...Object.fromEntries(Object.entries(d.transport).filter(([, v]) => v != null)), distance: String(d.transport.distance ?? '') })); setBuyer(d.buyer); }).catch(fail); }, [bill.id]);
  const make = async (e) => {
    e.preventDefault();
    try {
      const r = await api(`/gst/eway/${bill.id}`, 'POST', { transport: { ...t, distance: t.distance === '' ? '' : Number(t.distance) }, buyer, voluntary: anyway });
      saveJson(r.json, r.filename); setMissing([]); toast('E-way bill JSON downloaded — upload it on ewaybillgst.gov.in (Generate → Bulk)');
    } catch (e2) { setMissing(e2.data?.missing || []); fail(e2); }
  };
  const set = (k) => (e) => setT({ ...t, [k]: e.target.value });
  return (
    <form className="gst-eway" onSubmit={make}>
      <h4>E-way bill for {bill.number}</h4>
      {chk && <p className={`sm ${chk.required ? 'gst-req' : 'muted'}`}>{chk.message}</p>}
      <div className="gst-form">
        <label>Travels by<select value={t.mode} onChange={set('mode')}><option value="road">Road</option><option value="rail">Rail</option><option value="air">Air</option><option value="ship">Ship</option><option value="">Transporter will fill</option></select></label>
        <label>Distance (km)<input type="number" min="0" max="4000" step="1" value={t.distance} onChange={set('distance')} placeholder="0 = from PIN codes" /></label>
        {(t.mode === 'road' || !t.mode) && <label>Vehicle no.<input value={t.vehicle_no} onChange={(e) => setT({ ...t, vehicle_no: e.target.value.toUpperCase() })} placeholder="MH12AB1234" /></label>}
        {t.mode === 'road' && <label>Vehicle<select value={t.vehicle_type} onChange={set('vehicle_type')}><option value="R">Regular</option><option value="O">Over-dimensional</option></select></label>}
        {['rail', 'air', 'ship'].includes(t.mode) && <><label>{t.mode === 'rail' ? 'RR' : t.mode === 'air' ? 'Airway bill' : 'Bill of lading'} no.<input value={t.doc_no} onChange={set('doc_no')} /></label><label>Its date<input type="date" value={t.doc_date} onChange={set('doc_date')} /></label></>}
        <label>Transporter ID<input value={t.transporter_id} maxLength={15} onChange={(e) => setT({ ...t, transporter_id: e.target.value.toUpperCase() })} placeholder="GSTIN / TRANSIN (optional)" /></label>
        <label>Transporter name<input value={t.transporter_name} onChange={set('transporter_name')} placeholder="Optional" /></label>
        <label className="full">Deliver to (buyer’s address)<input value={buyer.address} onChange={(e) => setBuyer({ ...buyer, address: e.target.value })} /></label>
        <label>Buyer PIN code<input inputMode="numeric" maxLength={6} value={buyer.pincode} onChange={(e) => setBuyer({ ...buyer, pincode: e.target.value.replace(/\D/g, '') })} /></label>
      </div>
      {missing.length > 0 && <ul className="sm gst-miss">{missing.map((m) => <li key={m}>{m}</li>)}</ul>}
      <div className="row">{chk && !chk.required && <label className="gst-chip"><input type="checkbox" checked={anyway} onChange={(e) => setAnyway(e.target.checked)} /> Make one anyway</label>}<span className="grow" /><button className="btn primary sm" disabled={chk && !chk.required && !anyway}><Icon name="download" size={13} /> E-way bill JSON</button></div>
    </form>
  );
}
