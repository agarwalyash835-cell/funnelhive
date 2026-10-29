import { useEffect, useState } from 'react';
import { api } from '../api';
import { Panel, Modal, toast, confirmDialog, inr } from '../ui';
import { t } from '../appI18n';
import '../shipping.css';

// Courier integration (server/shipping.js): Settings → Shipping, and the Orders pieces — ship with a courier
// (rates), the shipment card (label / manifest / tracking timeline), and bulk ship.
export const STAGE = { booked: ['Booked · pickup requested', 'info'], picked_up: ['Picked up', 'info'], in_transit: ['In transit', 'info'], out_for_delivery: ['Out for delivery', 'info'], delivered: ['Delivered', 'ok'], ndr: ['Delivery failed (NDR)', 'warn'], rto_initiated: ['Returning (RTO)', 'bad'], rto_delivered: ['Returned (RTO)', 'bad'], cancelled: ['Shipment cancelled', 'bad'], lost: ['Lost / damaged', 'bad'] };
const fmt = (at) => new Date(at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export function useShipping() {
  const [s, setS] = useState(null);
  useEffect(() => { api('/settings/shipping').then(setS).catch(() => setS(false)); }, []);
  return s;
}

export function ShippingPanel() {
  const [s, setS] = useState(null);
  const [v, setV] = useState({ email: '', password: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/settings/shipping').then((r) => { setS(r); setV({ email: r.shiprocket.email, password: '' }); }).catch(() => setS(false)); }, []);
  if (!s) return null;
  const sr = s.shiprocket;
  const set = (p) => setS({ ...s, shiprocket: { ...sr, ...p } });
  const run = async (fn, ok) => { setBusy(true); try { const r = await fn(); setS(r); setV((x) => ({ ...x, password: '' })); if (ok) toast(ok); } catch (e) { toast(e.message); } setBusy(false); };
  const save = () => run(() => api('/settings/shipping/shiprocket', 'PUT', { email: v.email, ...(v.password ? { password: v.password } : {}), ...(sr.connected ? { pickup: sr.pickup, pkg: sr.pkg, notifyBuyer: sr.notifyBuyer, checkPincode: sr.checkPincode } : {}) }), sr.connected ? t('Settings saved') : t('Shiprocket connected'));
  const disconnect = async () => { if (await confirmDialog({ title: t('Disconnect Shiprocket?'), text: t('Shipments already booked stay in Shiprocket; tracking here stops.'), confirm: t('Disconnect'), danger: true })) run(() => api('/settings/shipping/shiprocket', 'DELETE'), t('Disconnected')); };
  const pk = sr.pkg || {};
  return (
    <Panel title={t('Shipping')}>
      <div className="ship-set">
        <p className="muted sm">{t('Connect Shiprocket to book couriers from Orders: rates, AWB, pickup, label and live tracking. Use an API user (Shiprocket → Settings → API → Configure) — not your own login.')}</p>
        <div className="ship-row">
          <label className="fld"><span>{t('API user email')}</span><input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} placeholder="api@yourbrand.in" /></label>
          <label className="fld"><span>{t('API user password')}{sr.hasPassword && <small className="muted"> · {t('saved — leave blank to keep it')}</small>}</span><input type="password" autoComplete="new-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} placeholder={sr.hasPassword ? '••••••••' : ''} /></label>
        </div>
        {sr.error && <p className="ship-err">{sr.error}</p>}
        {sr.connected && <>
          <div className="ship-row">
            <label className="fld"><span>{t('Pickup address')}</span><select value={sr.pickup} onChange={(e) => set({ pickup: e.target.value })}>{sr.pickups.map((p) => <option key={p.name} value={p.name}>{p.name} · {p.city} {p.pincode}</option>)}</select></label>
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(() => api('/settings/shipping/shiprocket/pickups', 'POST'), t('Pickup addresses refreshed'))}>{t('Refresh')}</button>
          </div>
          <div className="ship-row ship-pkg">
            <span>{t('Default package')}</span>
            {[['weight', 'kg'], ['length', 'L cm'], ['breadth', 'B cm'], ['height', 'H cm']].map(([k, l]) => <label key={k}><input type="number" min={0} step="0.01" value={pk[k] ?? ''} onChange={(e) => set({ pkg: { ...pk, [k]: e.target.value } })} /> {t(l)}</label>)}
          </div>
          <label className="fcheck"><input type="checkbox" checked={sr.notifyBuyer} onChange={(e) => set({ notifyBuyer: e.target.checked })} /><span><b>{t('Tell buyers')}</b><small className="muted"> · {t('WhatsApp / email with the tracking link when shipped, and an email when it’s out for delivery (opted-out numbers are skipped)')}</small></span></label>
          <label className="fcheck"><input type="checkbox" checked={sr.checkPincode} onChange={(e) => set({ checkPincode: e.target.checked })} /><span><b>{t('Check PIN codes with Shiprocket at checkout')}</b><small className="muted"> · {t('buyers see if a courier delivers there and takes cash')}</small></span></label>
          <div className="ship-hook">
            <b>{t('Tracking webhook')}</b> <small className="muted">· {t('paste in Shiprocket → Settings → API → Webhooks so tracking updates arrive instantly (otherwise checked every few hours)')}</small>
            <div className="ship-row"><code>{sr.webhookUrl}</code><button type="button" className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(sr.webhookUrl); toast(t('Copied')); }}>{t('Copy')}</button><button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(() => api('/settings/shipping/shiprocket/webhook', 'POST'), t('New URL — update it in Shiprocket'))}>{t('New URL')}</button></div>
          </div>
        </>}
        <div className="row">
          <button className="btn primary" disabled={busy} onClick={save}>{busy ? t('Saving…') : sr.connected ? t('Save') : t('Connect Shiprocket')}</button>
          {sr.connected && <button className="btn ghost" disabled={busy} onClick={disconnect}>{t('Disconnect')}</button>}
        </div>
      </div>
    </Panel>
  );
}

// "Ship with Shiprocket": couriers with rates for this order, then book (AWB + pickup + label)
export function CourierShipModal({ o, onClose, onDone }) {
  const [r, setR] = useState(null);
  const [pick, setPick] = useState(null);
  const [busy, setBusy] = useState(false);
  const [block, setBlock] = useState(null);
  useEffect(() => { api(`/orders/${o.id}/shipping/rates`).then((x) => { setR(x); setPick(x.recommended); setBlock(x.codBlock); }).catch((e) => setR({ error: e.message })); }, [o.id]);
  const ship = async (override) => {
    setBusy(true);
    try { const x = await api(`/orders/${o.id}/shipping/shiprocket`, 'POST', { courierId: pick, override }); toast(t('Booked · AWB {awb}', { awb: x.shipment?.awb })); onDone(); } catch (e) { toast(e.message); }
    setBusy(false);
  };
  return (
    <Modal title={t('Ship #{id} with Shiprocket', { id: o.id })} onClose={onClose} width={560}>
      <div className="m-body ship-modal">
        {!r ? <div className="skeleton" /> : r.error ? <p className="ship-err">{r.error}</p> : <>
          <p className="muted sm">{t('From {pickup} · {w} kg', { pickup: r.pickup, w: r.pkg?.weight })}{o.status === 'cod' ? ` · ${t('COD {amount}', { amount: inr(o.total) })}` : ` · ${t('Prepaid')}`}</p>
          {!r.couriers.length ? <p className="ship-err">{t('No courier serves this PIN code')}</p> : (
            <div className="ship-couriers">{r.couriers.map((c) => (
              <label key={c.id} className={`ship-courier ${pick === c.id ? 'on' : ''}`}><input type="radio" name="courier" checked={pick === c.id} onChange={() => setPick(c.id)} />
                <span><b>{c.name}</b>{c.id === r.recommended && <span className="pill ok">{t('recommended')}</span>}<small className="muted">{[c.etd && t('by {d}', { d: c.etd }), c.days && t('{n} days', { n: c.days }), c.rating && `★ ${c.rating}`].filter(Boolean).join(' · ')}</small></span>
                <b>{inr(c.rate)}</b></label>
            ))}</div>
          )}
          {block && <p className="ship-warn">{block}</p>}
          <div className="m-foot">
            <button className="btn ghost" onClick={onClose}>{t('Cancel')}</button>
            {block ? <button className="btn danger" disabled={busy || !pick} onClick={() => ship(true)}>{t('Ship anyway')}</button>
              : <button className="btn primary" disabled={busy || !pick} onClick={() => ship(false)}>{busy ? t('Booking…') : t('Book courier')}</button>}
          </div>
        </>}
      </div>
    </Modal>
  );
}

// the order's shipment: courier, AWB, label / manifest, and the tracking timeline
export function ShipmentCard({ o, onSaved }) {
  const sh = o.shipment;
  const [busy, setBusy] = useState(false);
  if (!sh?.awb) return null;
  const st = STAGE[sh.stage];
  const refresh = async () => { setBusy(true); try { await api(`/orders/${o.id}/shipping-track`, 'POST'); onSaved(); } catch (e) { toast(e.message); } setBusy(false); };
  return (
    <section className="ship-card">
      <h4>{t('Shipment')} {st && <span className={`pill ${st[1]}`}>{t(st[0])}</span>}</h4>
      <p><b>{sh.courier || 'Shiprocket'}</b> · AWB <span className="mono">{sh.awb}</span>{sh.rate != null ? ` · ${inr(sh.rate)}` : ''}{sh.etd ? ` · ${t('expected {d}', { d: sh.etd })}` : ''}</p>
      {sh.pickup?.error && <p className="ship-warn">{t('Pickup not requested: {e}', { e: sh.pickup.error })}</p>}
      {sh.ndr && sh.stage === 'ndr' && <p className="ship-warn">{t('Delivery failed: {r} — call the buyer, then reattempt or return it in Shiprocket.', { r: sh.ndr.reason })}</p>}
      <div className="row">
        {sh.labelUrl && <a className="btn ghost sm" href={sh.labelUrl} target="_blank" rel="noreferrer">{t('Label')}</a>}
        {sh.manifestUrl && <a className="btn ghost sm" href={sh.manifestUrl} target="_blank" rel="noreferrer">{t('Manifest')}</a>}
        {o.fulfilment?.trackingUrl && <a className="btn ghost sm" href={o.fulfilment.trackingUrl} target="_blank" rel="noreferrer">{t('Tracking page ↗')}</a>}
        <button className="btn ghost sm" disabled={busy} onClick={refresh}>{busy ? t('Checking…') : t('Refresh tracking')}</button>
      </div>
      {sh.events?.length > 0 && <ol className="ship-tl">{[...sh.events].reverse().slice(0, 12).map((e, i) => <li key={i}><b>{e.status}</b>{e.location && <span className="muted"> · {e.location}</span>}<small className="muted">{fmt(e.at)}{e.activity && e.activity !== e.status ? ` · ${e.activity}` : ''}</small></li>)}</ol>}
    </section>
  );
}

// several orders → booked one after the other with the recommended courier; a line per order
export function BulkShipModal({ ids, onClose, onDone }) {
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [override, setOverride] = useState(false);
  const go = async () => {
    setBusy(true);
    try { setRes(await api('/shipping/shiprocket/bulk', 'POST', { orders: ids, override })); } catch (e) { toast(e.message); }
    setBusy(false);
  };
  return (
    <Modal title={t('Ship {n} orders with Shiprocket', { n: ids.length })} onClose={res ? onDone : onClose} width={560}>
      <div className="m-body">
        {!res ? <>
          <p className="muted sm">{t('Each order is booked with Shiprocket’s recommended courier, from your default pickup address and package size.')}</p>
          <label className="fcheck"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /><span>{t('Also ship COD orders the buyer hasn’t confirmed')}</span></label>
          <div className="m-foot"><button className="btn ghost" onClick={onClose}>{t('Cancel')}</button><button className="btn primary" disabled={busy} onClick={go}>{busy ? t('Booking… (one at a time)') : t('Ship {n}', { n: ids.length })}</button></div>
        </> : <>
          <p><b>{t('{n} booked', { n: res.shipped })}</b>{res.failed > 0 && ` · ${t('{n} not booked', { n: res.failed })}`}</p>
          <ul className="ship-bulk">{res.results.map((x) => <li key={x.id} className={x.ok ? 'ok' : 'bad'}><span className="mono">#{x.id}</span> {x.ok ? `${x.courier} · AWB ${x.awb}` : x.error}</li>)}</ul>
          <div className="m-foot"><button className="btn primary" onClick={onDone}>{t('Done')}</button></div>
        </>}
      </div>
    </Modal>
  );
}
