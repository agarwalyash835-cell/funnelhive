// Counter mode: billing at the shop counter on a phone, one screen. Scan with the camera (BarcodeDetector) or type,
// tap tiles for what sells most, + / − on the cart, customer name / phone, cash / UPI / credit, an optional buyer
// GSTIN, the live total (the server's preview; the phone's own pricing when offline), Save → print.
// Offline: bills wait in IndexedDB with the id the phone gave them and sync in order when the network is back — the
// server prices them again and flags a different total or stock gone below zero (server/inventory-pro.js saveBill).
// Printing: a paired Bluetooth ESC/POS printer (Android Chrome), else the browser's 80 mm print view.
// Installable on its own (public/counter.webmanifest, scope /counter) — it opens straight into this screen.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ScanLine, Printer, Wifi, WifiOff, Minus, Plus, X, Search, Bluetooth, ArrowLeft, CloudUpload, TriangleAlert, Download } from 'lucide-react';
import { api } from '../api';
import { toast, confirmDialog } from '../ui';
import { printBill } from './InventoryPro';
import { priceOffline, newClientId } from '../counter/pricing';
import { encodeReceipt } from '../counter/escpos';
import { btSupported, savedPrinter, pairPrinter, printBytes, forgetPrinter, setPrinterWidth } from '../counter/bt';
import { kvGet, kvSet, enqueue, queued, syncQueue, dequeue, clearError } from '../counter/queue';
import '../counter.css';

const P = '/inventory/pro';
const rs = (n) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const qn = (n) => (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const offlineErr = (e) => !e?.status; // fetch failed: no response at all
// this phone's account (the signed-in person in their workspace): the cache and queue are kept per account
const who = () => { try { const p = JSON.parse(atob(localStorage.getItem('ff_token').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); return `${p.id}:${p.ws || ''}`; } catch { return 'me'; } };
const RECENT = 'ff_counter_recent';
const recentIds = () => { try { return JSON.parse(localStorage.getItem(RECENT) || '[]'); } catch { return []; } };
const pushRecent = (ids) => { try { localStorage.setItem(RECENT, JSON.stringify([...new Set([...ids, ...recentIds()])].slice(0, 24))); } catch {} };

// the installed app's identity: manifest, colour, home-screen icon, and the service worker that opens it offline
function useInstall() {
  const [offer, setOffer] = useState(null);
  useEffect(() => {
    const put = (sel, make) => document.head.querySelector(sel) || document.head.appendChild(make());
    const link = put('link[rel="manifest"]', () => Object.assign(document.createElement('link'), { rel: 'manifest' }));
    const prev = link.getAttribute('href');
    link.setAttribute('href', '/counter.webmanifest');
    put('meta[name="theme-color"]', () => Object.assign(document.createElement('meta'), { name: 'theme-color' })).content = '#1c1917';
    put('meta[name="apple-mobile-web-app-capable"]', () => Object.assign(document.createElement('meta'), { name: 'apple-mobile-web-app-capable' })).content = 'yes';
    put('meta[name="apple-mobile-web-app-title"]', () => Object.assign(document.createElement('meta'), { name: 'apple-mobile-web-app-title' })).content = 'Counter';
    put('link[rel="apple-touch-icon"]', () => Object.assign(document.createElement('link'), { rel: 'apple-touch-icon' })).href = '/counter-icon.svg';
    // the worker keeps the files this page already loaded (before it took over), so the next start works offline
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/counter-sw.js', { scope: '/counter' }).then(() => navigator.serviceWorker.ready).then((reg) => {
      const urls = [...new Set(performance.getEntriesByType('resource').map((e) => e.name).filter((u) => u.includes('/assets/')))];
      reg.active?.postMessage({ cache: urls });
    }).catch(() => {});
    const h = (e) => { e.preventDefault(); setOffer(e); };
    window.addEventListener('beforeinstallprompt', h);
    return () => { window.removeEventListener('beforeinstallprompt', h); if (prev) link.setAttribute('href', prev); else link.remove(); };
  }, []);
  return offer && (async () => { offer.prompt(); await offer.userChoice.catch(() => {}); setOffer(null); });
}

export default function Counter() {
  const me = useMemo(who, []);
  const install = useInstall();
  const [cat, setCat] = useState(null);
  const [denied, setDenied] = useState('');
  const [online, setOnline] = useState(typeof navigator === 'undefined' || navigator.onLine !== false);
  const [q, setQ] = useState('');
  const [cart, setCart] = useState([]); // [{ itemId, qty }]
  const [clientId, setClientId] = useState(newClientId);
  const [cust, setCust] = useState({ name: '', phone: '', gstin: '' });
  const [pay, setPay] = useState('cash');
  const [showGst, setShowGst] = useState(false);
  const [pre, setPre] = useState(null);
  const [preErr, setPreErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(null);
  const [scan, setScan] = useState(false);
  const [sheet, setSheet] = useState(null); // 'printer' | 'queue'
  const [queue, setQueue] = useState([]);
  const [flagged, setFlagged] = useState([]); // synced offline bills the server flagged
  const [printer, setPrinter] = useState(savedPrinter);
  const searchRef = useRef(null);

  const loadCatalog = async () => {
    try { const c = await api(`${P}/counter/catalog`); setCat(c); setOnline(true); kvSet(`catalog:${me}`, c); } catch (e) {
      if (offlineErr(e)) setOnline(false);
      else if (e.status === 403) setDenied(e.message);
      else toast(e.message);
    }
  };
  const refreshQueue = () => queued(me).then(setQueue).catch(() => {});
  const sync = async () => {
    const r = await syncQueue(me, (body) => api(`${P}/bills`, 'POST', body)).catch(() => ({ done: [], failed: [] }));
    refreshQueue();
    if (r.done.length) {
      setOnline(true);
      const fl = r.done.filter((b) => b.flags?.length);
      if (fl.length) setFlagged((x) => [...fl, ...x].slice(0, 20));
      toast(`${r.done.length} offline ${r.done.length === 1 ? 'bill' : 'bills'} synced${fl.length ? ` — ${fl.length} to check` : ''}`);
      loadCatalog();
    }
    if (r.failed.length) toast(`${r.failed.length} offline ${r.failed.length === 1 ? 'bill was' : 'bills were'} refused — open the queue`);
  };
  useEffect(() => {
    kvGet(`catalog:${me}`).then((c) => c && setCat((cur) => cur || c));
    loadCatalog(); refreshQueue(); sync();
    const up = () => { setOnline(true); sync(); }, down = () => setOnline(false);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // retry queued bills every 20 s while any wait
  const waiting = queue.filter((e) => !e.error).length;
  useEffect(() => { if (!waiting) return undefined; const t = setInterval(sync, 20000); return () => clearInterval(t); }, [waiting]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = cat?.items || [];
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const add = (it, n = 1) => {
    if (!it) return;
    setCart((c) => { const k = c.findIndex((l) => l.itemId === it.id); return k >= 0 ? c.map((l, j) => (j === k ? { ...l, qty: Math.round((Number(l.qty) + n) * 1000) / 1000 } : l)) : [...c, { itemId: it.id, qty: n }]; });
    if (navigator.vibrate) navigator.vibrate(30);
  };
  const setQty = (id, v) => setCart((c) => (Number(v) <= 0 && v !== '' ? c.filter((l) => l.itemId !== id) : c.map((l) => (l.itemId === id ? { ...l, qty: v } : l))));
  const byCode = (code) => { const s = String(code).trim(), l = s.toLowerCase(); return items.find((i) => i.barcode === s) || items.find((i) => i.sku && i.sku.toLowerCase() === l); };
  const onCode = (code) => { const it = byCode(code); if (it) { add(it); toast(`+1 ${it.name}`); } else toast(`No item with code ${code}`); };
  const typed = (e) => {
    e.preventDefault();
    const s = q.trim(); if (!s) return;
    const it = byCode(s) || (hits.length === 1 ? hits[0] : null);
    if (it) { add(it); setQ(''); } else toast(hits.length ? 'Tap the item' : `No item “${s}”`);
  };
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const words = s.split(/\s+/);
    return items.filter((i) => { const hay = `${i.name} ${i.sku || ''} ${i.barcode || ''} ${i.category || ''}`.toLowerCase(); return words.every((w) => hay.includes(w)); }).slice(0, 40);
  }, [q, items]);
  const tiles = useMemo(() => {
    if (q.trim()) return hits;
    const ids = [...new Set([...recentIds(), ...(cat?.popular || [])])];
    const t = ids.map((id) => byId.get(id)).filter(Boolean);
    return [...t, ...items.filter((i) => !ids.includes(i.id))].slice(0, 24); // recent and popular first, then the rest
  }, [q, hits, cat, byId, items, last]); // eslint-disable-line react-hooks/exhaustive-deps

  const body = {
    lines: cart.filter((l) => Number(l.qty) > 0).map((l) => ({ itemId: l.itemId, qty: Number(l.qty) })),
    party_name: cust.name.trim() || undefined, party_phone: cust.phone.trim() || undefined,
    credit: pay === 'credit', pay_mode: pay === 'credit' ? undefined : pay,
    buyer: showGst && cust.gstin.trim() ? { gstin: cust.gstin.trim().toUpperCase() } : undefined,
  };
  const key = JSON.stringify(body);
  const local = useMemo(() => { if (!cat || !body.lines.length) return null; try { return priceOffline(cat, body); } catch { return null; } }, [key, cat]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setPre(null); setPreErr('');
    if (!body.lines.length || !online) return undefined;
    const t = setTimeout(() => api(`${P}/bills/preview`, 'POST', body).then(setPre).catch((e) => { if (offlineErr(e)) setOnline(false); else setPreErr(e.message); }), 300);
    return () => clearTimeout(t);
  }, [key, online]); // eslint-disable-line react-hooks/exhaustive-deps
  const priced = (online && pre) || local;
  const lineOf = (id) => priced?.lines.find((l) => l.itemId === id);

  const upi = cat?.settings?.upi_id ? { id: cat.settings.upi_id, name: cat.settings.upi_name || cat.seller?.name || '' } : null;
  const print = async (b) => {
    const p = savedPrinter();
    if (btSupported() && p) {
      try { await printBytes(encodeReceipt(b, { width: p.width || 58, upi })); return; } catch (e) {
        toast(e.code === 'NOT_PAIRED' ? 'Printer not connected — tap the printer button to connect it' : `Printer: ${e.message} — opening the print view`);
      }
    }
    printBill(b, { settings: { businessName: cat?.seller?.name } }, { thermal: true });
  };
  const finish = (b, offline) => {
    toast(offline ? `No network — bill saved on this phone (${rs(b.total)}); it syncs by itself` : `Bill ${b.number} saved — ${rs(b.total)}`);
    pushRecent(cart.map((l) => l.itemId));
    setCart([]); setCust({ name: '', phone: '', gstin: '' }); setShowGst(false); setPay('cash'); setClientId(newClientId()); setLast(b);
    print(b);
  };
  const save = async () => {
    if (busy || !body.lines.length) return;
    if (pay === 'credit' && !cust.name.trim()) { toast('A credit (udhaar) bill needs the customer’s name'); return; }
    setBusy(true);
    const payload = { ...body, clientId };
    try {
      let b;
      try { b = await api(`${P}/bills`, 'POST', payload); } catch (e) {
        if (e.data?.code !== 'CREDIT_LIMIT') throw e;
        if (!(await confirmDialog({ title: 'Over the credit limit', text: `${e.message}. Save the bill anyway?`, confirm: 'Save anyway', danger: true }))) { setBusy(false); return; }
        b = await api(`${P}/bills`, 'POST', { ...payload, override: true });
      }
      setOnline(true);
      finish(b, false);
    } catch (e) {
      if (!offlineErr(e)) { toast(e.message); setBusy(false); return; }
      // no network: keep it on the phone, priced from the saved catalog; the server prices it again on sync
      let bill;
      try { bill = { ...priceOffline(cat, body), pay_mode: body.pay_mode, party_phone: body.party_phone, clientId, offline_pending: true }; } catch (e2) { toast(e2.message); setBusy(false); return; }
      await enqueue({ clientId, owner: me, body: payload, bill, at: Date.now() });
      setOnline(false); refreshQueue();
      finish(bill, true);
    }
    setBusy(false);
  };

  if (denied) return <div className="cm cm-msg"><h1>Counter mode</h1><p>{denied}</p><p className="muted">Counter mode needs the Inventory add-on and the Counter area — ask the account owner.</p><Link className="cm-btn" to="/">Back</Link></div>;
  if (!cat) return <div className="cm cm-msg"><div className="skeleton" />{!online && <p>No network, and this phone hasn’t saved the catalog yet — open counter mode once while online.</p>}</div>;
  const failed = queue.filter((e) => e.error);
  return (
    <div className="cm">
      <header className="cm-top">
        <Link to="/inventory" className="cm-ic" aria-label="Back to Inventory"><ArrowLeft size={20} /></Link>
        <b className="cm-shop">{cat.seller?.name || 'Counter'}</b>
        <button className={`cm-net ${online ? 'on' : 'off'} ${failed.length ? 'bad' : ''}`} onClick={() => setSheet('queue')} aria-label="Sync status">
          {online ? <Wifi size={15} /> : <WifiOff size={15} />} {online ? 'Online' : 'Offline'}{queue.length > 0 && <em>{queue.length} queued</em>}
        </button>
        {install && <button className="cm-ic" onClick={install} aria-label="Install counter app"><Download size={20} /></button>}
        <button className={`cm-ic ${printer ? 'paired' : ''}`} onClick={() => setSheet('printer')} aria-label="Printer"><Printer size={20} /></button>
      </header>

      {flagged.length > 0 && <div className="cm-flag" role="status"><TriangleAlert size={16} /><div>{flagged.map((b) => <p key={b.id}><b>{b.number}</b> {b.flags.map((f) => f.message).join(' · ')}</p>)}</div><button className="cm-ic" aria-label="Dismiss" onClick={() => setFlagged([])}><X size={16} /></button></div>}

      <form className="cm-find" onSubmit={typed}>
        <Search size={18} />
        <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Item name, barcode or SKU" aria-label="Find item" enterKeyHint="search" autoComplete="off" />
        {q && <button type="button" className="cm-ic" aria-label="Clear" onClick={() => setQ('')}><X size={18} /></button>}
        <button type="button" className="cm-scan" onClick={() => ('BarcodeDetector' in window ? setScan(true) : (toast('This browser can’t scan with the camera — type or use a USB / Bluetooth scanner'), searchRef.current?.focus()))} aria-label="Scan barcode"><ScanLine size={22} /></button>
      </form>

      <div className="cm-tiles" aria-label={q ? 'Matching items' : 'Popular and recent items'}>
        {tiles.map((i) => (
          <button key={i.id} className={`cm-tile ${i.stock <= 0 ? 'out' : ''}`} onClick={() => { add(i); if (q) setQ(''); }}>
            <b>{i.name}</b><span>{i.sale_rate != null ? rs(i.sale_rate) : 'no rate'}</span><small>{qn(i.stock)} {i.unit} left</small>
          </button>
        ))}
        {!tiles.length && <p className="muted cm-none">{q ? 'No item matches.' : 'Add items in Inventory to bill them here.'}</p>}
      </div>

      {cart.length > 0 && <section className="cm-cart" aria-label="Bill">
        {cart.map((l) => { const it = byId.get(l.itemId), p = lineOf(l.itemId); return (
          <div key={l.itemId} className="cm-line">
            <div className="cm-ln"><b>{it?.name || 'Item'}</b><small>{p ? `${rs(p.rate)} · GST ${p.gst_percent}%${p.scheme ? ` · ${p.scheme.name}${p.free_qty ? ` (+${qn(p.free_qty)} free)` : ''}` : ''}` : ''}</small></div>
            <div className="cm-qty">
              <button aria-label={`One less ${it?.name}`} onClick={() => setQty(l.itemId, Math.round((Number(l.qty) - 1) * 1000) / 1000)}><Minus size={18} /></button>
              <input type="number" inputMode="decimal" min="0" step="any" value={l.qty} onChange={(e) => setQty(l.itemId, e.target.value)} aria-label={`Quantity of ${it?.name}`} />
              <button aria-label={`One more ${it?.name}`} onClick={() => add(it)}><Plus size={18} /></button>
            </div>
            <b className="cm-amt">{p ? rs(p.amount) : ''}</b>
          </div>
        ); })}
      </section>}

      {cart.length > 0 && <section className="cm-cust">
        <div className="cm-pay" role="radiogroup" aria-label="Payment">{[['cash', 'Cash'], ['upi', 'UPI'], ['credit', 'Credit']].map(([k, l]) => <button key={k} role="radio" aria-checked={pay === k} className={pay === k ? 'on' : ''} onClick={() => setPay(k)}>{l}</button>)}</div>
        <div className="cm-two">
          <input value={cust.name} onChange={(e) => setCust({ ...cust, name: e.target.value })} placeholder={pay === 'credit' ? 'Customer name (needed)' : 'Customer name'} aria-label="Customer name" autoComplete="off" />
          <input value={cust.phone} onChange={(e) => setCust({ ...cust, phone: e.target.value.replace(/[^\d+ ]/g, '') })} placeholder="Phone" type="tel" inputMode="tel" aria-label="Customer phone" maxLength={15} />
        </div>
        {showGst ? <input value={cust.gstin} maxLength={15} onChange={(e) => setCust({ ...cust, gstin: e.target.value.toUpperCase() })} placeholder="Buyer GSTIN (B2B)" aria-label="Buyer GSTIN" autoCapitalize="characters" />
          : <button className="cm-link" onClick={() => setShowGst(true)}>+ Buyer GSTIN</button>}
        {preErr && <p className="cm-err">{preErr}</p>}
      </section>}

      {last && !cart.length && <div className="cm-last"><span>Last: <b>{last.number || 'saved offline'}</b> · {rs(last.total)}</span><button className="cm-btn ghost" onClick={() => print(last)}><Printer size={16} /> Print again</button></div>}

      <footer className="cm-foot">
        <div className="cm-total">
          <small>{priced ? (priced.intra === false ? `IGST ${rs(priced.igst)}` : `GST ${rs(priced.gst)}`) : `${cart.length ? '…' : 'Add items'}`}{priced && !(online && pre) ? ' · offline price' : ''}</small>
          <b>{rs(priced?.total || 0)}</b>
        </div>
        <button className="cm-save" disabled={busy || !body.lines.length || (pay === 'credit' && !cust.name.trim())} onClick={save}>{busy ? 'Saving…' : online ? 'Save & print' : 'Save offline & print'}</button>
      </footer>

      {scan && <Scanner onCode={onCode} onClose={() => setScan(false)} />}
      {sheet === 'printer' && <PrinterSheet printer={printer} setPrinter={setPrinter} onTest={() => print({ number: 'TEST', day: new Date().toISOString().slice(0, 10), seller: cat.seller, doc_type: 'BILL', lines: [{ name: 'Test print', qty: 1, rate: 1, amount: 1, gst_percent: 0 }], taxable: 1, total: 1, pay_mode: 'cash' })} onClose={() => setSheet(null)} />}
      {sheet === 'queue' && <div className="cm-sheet" role="dialog" aria-label="Offline bills"><div className="cm-sheet-in">
        <div className="cm-sheet-h"><b>Offline bills</b><button className="cm-ic" onClick={() => setSheet(null)} aria-label="Close"><X size={18} /></button></div>
        {!queue.length ? <p className="muted">Nothing waiting — every bill is on the server.</p> : queue.map((e) => (
          <div key={e.clientId} className="cm-q">
            <span>{new Date(e.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · <b>{rs(e.bill?.total)}</b>{e.bill?.party_name ? ` · ${e.bill.party_name}` : ''}</span>
            {e.error ? <><small className="cm-err">{e.error}</small><span className="cm-row"><button className="cm-btn ghost" onClick={async () => { await clearError(e); refreshQueue(); sync(); }}>Retry</button><button className="cm-btn ghost danger" onClick={async () => { if (await confirmDialog({ title: 'Remove this offline bill?', text: 'It won’t reach your books or stock. Make the bill again if the sale happened.', confirm: 'Remove', danger: true })) { await dequeue(e.clientId); refreshQueue(); } }}>Remove</button></span></> : <small className="muted">waiting for the network</small>}
          </div>
        ))}
        <button className="cm-btn" onClick={sync} disabled={!queue.length}><CloudUpload size={16} /> Sync now</button>
      </div></div>}
    </div>
  );
}

// the camera, scanning continuously until closed; the same code again needs a 1.5 s gap (no double counting)
function Scanner({ onCode, onClose }) {
  const video = useRef(null), cb = useRef(onCode);
  cb.current = onCode;
  const [err, setErr] = useState('');
  useEffect(() => {
    let stream = null, stop = false, timer = null;
    (async () => {
      try {
        const want = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar', 'qr_code'];
        const have = await window.BarcodeDetector.getSupportedFormats?.().catch(() => null);
        const det = new window.BarcodeDetector({ formats: have?.length ? want.filter((f) => have.includes(f)) : want });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stop) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.current.srcObject = stream;
        await video.current.play();
        let lastCode = '', lastAt = 0;
        const tick = async () => {
          if (stop) return;
          try {
            const code = (await det.detect(video.current))[0]?.rawValue;
            if (code && (code !== lastCode || Date.now() - lastAt > 1500)) { lastCode = code; lastAt = Date.now(); cb.current(code); }
          } catch { /* a frame that couldn't be read */ }
          timer = setTimeout(tick, 180);
        };
        tick();
      } catch (e) { setErr(e?.name === 'NotAllowedError' ? 'Allow the camera to scan barcodes' : 'The camera couldn’t start — type the code instead'); }
    })();
    return () => { stop = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, []);
  return (
    <div className="cm-cam" role="dialog" aria-label="Scan barcode">
      <video ref={video} playsInline muted />
      <i className="cm-aim" aria-hidden="true" />
      {err && <p className="cm-cam-err">{err}</p>}
      <button className="cm-btn" onClick={onClose}>Done</button>
    </div>
  );
}

function PrinterSheet({ printer, setPrinter, onTest, onClose }) {
  const [busy, setBusy] = useState(false);
  const pair = async () => {
    setBusy(true);
    try { setPrinter(await pairPrinter(printer?.width || 58)); toast('Printer connected'); } catch (e) { if (e.name !== 'NotFoundError') toast(e.message); }
    setBusy(false);
  };
  const width = (w) => { setPrinterWidth(w); setPrinter(savedPrinter()); };
  return (
    <div className="cm-sheet" role="dialog" aria-label="Printer"><div className="cm-sheet-in">
      <div className="cm-sheet-h"><b>Receipt printer</b><button className="cm-ic" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
      {!btSupported() ? <p className="muted">Bluetooth printing works in Chrome on Android. On this device, receipts open the print view (80 mm layout) — print to any printer from there.</p> : <>
        <p>{printer ? <>Connected to <b>{printer.name}</b></> : 'Pair a Bluetooth thermal printer (58 or 80 mm ESC/POS). Turn it on first.'}</p>
        <button className="cm-btn" onClick={pair} disabled={busy}><Bluetooth size={16} /> {printer ? 'Change printer' : 'Pair printer'}</button>
        {printer && <>
          <div className="cm-pay" role="radiogroup" aria-label="Paper width">{[58, 80].map((w) => <button key={w} role="radio" aria-checked={(printer.width || 58) === w} className={(printer.width || 58) === w ? 'on' : ''} onClick={() => width(w)}>{w} mm</button>)}</div>
          <span className="cm-row"><button className="cm-btn ghost" onClick={onTest}><Printer size={16} /> Test print</button><button className="cm-btn ghost danger" onClick={() => { forgetPrinter(); setPrinter(null); }}>Forget</button></span>
        </>}
      </>}
    </div></div>
  );
}
