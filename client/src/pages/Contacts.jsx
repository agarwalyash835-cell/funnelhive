import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Mail, Phone, MessageCircle, StickyNote, PhoneCall, ShoppingBag, Eye, LogIn, UserPlus, TrendingUp, TrendingDown, PackagePlus, ShoppingCart,
  ArrowRightLeft, X, Plus, Trash2, LayoutList, Kanban, Copy, Send, Repeat, ChevronUp, ChevronDown, SlidersHorizontal, Footprints, CalendarDays, Upload, Download,
} from 'lucide-react';
import { api } from '../api';
import { Layout, Panel, Icon, Empty, Modal, toast, inr, num, ago, downloadCSV } from '../ui';

const LS = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const when = (t) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const dayLabel = (t) => {
  const d = new Date(t), today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};
const waNumber = (p = '') => { const d = String(p).replace(/\D/g, ''); return d.length === 10 ? `91${d}` : d; };
const label = (c) => c.name || c.email || c.phone || 'Unknown';
const initial = (c) => label(c)[0]?.toUpperCase() || '?';
const keyUrl = (k) => `/contacts/${encodeURIComponent(k)}`;
const FIELD_TYPE_LABELS = [['text', 'Short text'], ['longtext', 'Long text'], ['number', 'Number'], ['date', 'Date'], ['select', 'Dropdown'], ['url', 'Link'], ['checkbox', 'Yes / no']];
const fieldText = (f, v) => (v == null || v === '' ? '' : f.type === 'checkbox' ? (v ? 'Yes' : 'No') : f.type === 'date' ? new Date(v).toLocaleDateString('en-IN') : String(v));

export default function Contacts() {
  const { key } = useParams();
  const nav = useNavigate();
  const [list, setList] = useState(null);
  const [pipes, setPipes] = useState([]);
  const [fields, setFields] = useState([]);
  const [q, setQ] = useState('');
  const [type, setType] = useState('all');
  const [view, setView] = useState(() => LS.get('ff_contacts_view', 'list'));
  const [pid, setPid] = useState(() => LS.get('ff_pipeline', ''));
  const [modal, setModal] = useState(null); // 'add' | 'import' | 'fields' | 'pipes'
  const [picked, setPicked] = useState(() => new Set());
  const [autos, setAutos] = useState([]);
  useEffect(() => { api('/automations').then((d) => setAutos(d.automations.filter((a) => a.active))).catch(() => {}); }, []);
  const load = () => Promise.all([api('/contacts'), api('/pipelines'), api('/crm/fields')]).then(([c, p, f]) => { setList(c); setPipes(p); setFields(f); });
  useEffect(() => { load(); }, []);
  useEffect(() => { LS.set('ff_contacts_view', view); }, [view]);
  const pipe = pipes.find((p) => p.id === pid) || pipes[0];
  useEffect(() => { if (pipe) LS.set('ff_pipeline', pipe.id); }, [pipe?.id]);

  const rows = (list || []).filter((c) => (type === 'all' || c.type === type) && `${c.name} ${c.email} ${c.phone} ${(c.tags || []).join(' ')}`.toLowerCase().includes(q.toLowerCase()));
  const customers = (list || []).filter((c) => c.type === 'customer');
  const ltv = customers.reduce((a, c) => a + c.ltv, 0);
  const stageOf = (c) => pipe?.stages.find((s) => s.id === c.stages?.[pipe.id]);
  const open = (k) => nav(keyUrl(k));
  const toggle = (k) => setPicked((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const allPicked = rows.length > 0 && rows.every((c) => picked.has(c.key));
  const pickAll = () => setPicked(allPicked ? new Set() : new Set(rows.map((c) => c.key)));
  const bulk = async (action, value) => {
    const keys = [...picked];
    try {
      if (action === 'automation') { const r = await api(`/automations/${value}/enroll-bulk`, 'POST', { keys }); toast(`${r.added} added${r.skipped ? ` · ${r.skipped} already in it or skipped` : ''}`); }
      else if (action === 'stage') { const r = await api('/contacts/bulk', 'POST', { keys, stage: { pipelineId: pipe.id, stageId: value } }); toast(`${r.updated} moved`); }
      else { const tag = prompt(action === 'addTag' ? 'Tag to add to the selected contacts' : 'Tag to remove from the selected contacts'); if (!tag) return; const r = await api('/contacts/bulk', 'POST', { keys, [action]: tag.trim() }); toast(`${r.updated} updated`); }
      setPicked(new Set()); load();
    } catch (e) { toast(e.message); }
  };

  const moveTo = async (c, stageId) => {
    if (!pipe || c.stages?.[pipe.id] === stageId) return;
    setList((l) => l.map((x) => (x.key === c.key ? { ...x, stages: { ...x.stages, [pipe.id]: stageId } } : x)));
    try { await api(`/contacts/${encodeURIComponent(c.key)}`, 'PATCH', { stage: { pipelineId: pipe.id, stageId } }); } catch (e) { toast(e.message); load(); }
  };

  const exportCsv = () => downloadCSV('contacts.csv', rows.map((c) => ({
    name: c.name, email: c.email, phone: c.phone, type: c.type, [`stage (${pipe?.name || 'pipeline'})`]: stageOf(c)?.name || '', tags: (c.tags || []).join(' | '),
    ...Object.fromEntries(fields.map((f) => [f.label, fieldText(f, c.custom?.[f.id])])),
    orders: c.orders, lifetime_value: c.ltv, source: c.source, answers: c.fields ? Object.entries(c.fields).map(([k, v]) => `${k}: ${v}`).join(' | ') : '',
    funnels: c.funnels.join(' | '), first_seen: new Date(c.firstSeen).toISOString(), last_seen: new Date(c.lastSeen).toISOString(),
  })));

  return (
    <Layout title="Contacts" subtitle="Every lead and customer — with their full journey." wide={view === 'board'} actions={<>
      <button className="btn ghost" onClick={() => setModal('fields')}><SlidersHorizontal size={16} /> Custom fields</button>
      <button className="btn ghost" onClick={exportCsv} disabled={!rows.length}><Icon name="download" size={16} /> Export</button>
      <button className="btn ghost" onClick={() => setModal('import')}><Upload size={16} /> Import CSV</button>
      <button className="btn primary" onClick={() => setModal('add')}><UserPlus size={16} /> Add contact</button>
    </>}>
      {!list ? <div className="skeleton" /> : (
        <>
          <div className="kpis k4">
            <div className="kpi"><span className="kpi-l">Total contacts</span><b className="kpi-v">{num(list.length)}</b></div>
            <div className="kpi"><span className="kpi-l">Customers</span><b className="kpi-v">{num(customers.length)}</b></div>
            <div className="kpi"><span className="kpi-l">Leads (not yet bought)</span><b className="kpi-v">{num(list.length - customers.length)}</b></div>
            <div className="kpi"><span className="kpi-l">Avg. lifetime value</span><b className="kpi-v">{inr(customers.length ? ltv / customers.length : 0)}</b></div>
          </div>
          <div className="crm-bar">
            <div className="seg">
              <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}><LayoutList size={14} /> List</button>
              <button className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}><Kanban size={14} /> Pipeline board</button>
            </div>
            <div className="seg">{[['all', 'All'], ['customer', 'Customers'], ['lead', 'Leads']].map(([k, l]) => <button key={k} className={type === k ? 'on' : ''} onClick={() => setType(k)}>{l}</button>)}</div>
            <div className="crm-pipe">
              <select value={pipe?.id || ''} onChange={(e) => setPid(e.target.value)} aria-label="Pipeline">{pipes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <button className="btn ghost sm" onClick={() => setModal('pipes')}><Icon name="settings" size={14} /> Pipelines</button>
            </div>
            <div className="search"><Icon name="search" size={16} /><input placeholder="Search name, email, phone, tag…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          </div>

          {view === 'board' && pipe ? <Board pipe={pipe} rows={rows} onOpen={open} onMove={moveTo} /> : (
            <Panel pad={false}>
              {!rows.length ? <Empty icon="users" title="No contacts yet" text="Leads from opt-in forms and customers from checkouts appear here automatically — or add one yourself." /> : (
                <div className="tbl-wrap">
                  {picked.size > 0 && (
                    <div className="bulkbar">
                      <b>{picked.size} selected</b>
                      <select value="" onChange={(e) => e.target.value && bulk('automation', e.target.value)} disabled={!autos.length} title={autos.length ? '' : 'Turn on an automation first'}><option value="">{autos.length ? 'Add to automation…' : 'No active automations'}</option>{autos.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
                      {pipe && <select value="" onChange={(e) => e.target.value && bulk('stage', e.target.value)}><option value="">Move to stage…</option>{pipe.stages.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}</select>}
                      <button className="btn ghost sm" onClick={() => bulk('addTag')}>Add tag</button>
                      <button className="btn ghost sm" onClick={() => bulk('removeTag')}>Remove tag</button>
                      <button className="link-btn" onClick={() => setPicked(new Set())}>Clear</button>
                    </div>
                  )}
                  <table className="tbl tbl-click">
                    <thead><tr><th className="ck"><input type="checkbox" checked={allPicked} onChange={pickAll} title={`Select all ${rows.length} shown by this filter`} aria-label="Select all" /></th><th>Contact</th><th>Stage</th><th>Status</th><th className="r">Orders</th><th className="r">Lifetime value</th><th>Source</th><th>Form answers</th><th className="r">Last activity</th></tr></thead>
                    <tbody>{rows.slice(0, 300).map((c) => {
                      const st = stageOf(c);
                      return (
                        <tr key={c.key} tabIndex={0} onClick={() => open(c.key)} onKeyDown={(e) => e.key === 'Enter' && open(c.key)} className={`${key === c.key ? 'on' : ''} ${picked.has(c.key) ? 'picked' : ''}`}>
                          <td className="ck" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={picked.has(c.key)} onChange={() => toggle(c.key)} aria-label={`Select ${label(c)}`} /></td>
                          <td><div className="who"><span className="who-av">{initial(c)}</span><div><b>{c.name || '—'}</b><small className="sub-t">{c.email}{c.email && c.phone && ' · '}{c.phone}</small></div></div></td>
                          <td>{st && <span className="stage-pill" style={{ '--sc': st.color }}><i />{st.name}</span>}</td>
                          <td><span className={`pill ${c.type === 'customer' ? 'ok' : ''}`}>{c.type}</span></td>
                          <td className="r">{c.orders}</td><td className="r strong">{inr(c.ltv)}</td>
                          <td><span className="src">{c.source}</span></td>
                          <td>{c.fields ? <span className="answers" title={Object.entries(c.fields).map(([k, v]) => `${k}: ${v}`).join('\n')}>📝 {Object.keys(c.fields).length} {Object.keys(c.fields).length === 1 ? 'answer' : 'answers'}</span> : <span className="muted">—</span>}</td>
                          <td className="r muted">{ago(c.lastSeen)}</td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                  {rows.length > 300 && <p className="hint center">Showing 300 of {num(rows.length)} — search to narrow down, or export for the full list.</p>}
                </div>
              )}
            </Panel>
          )}
        </>
      )}
      {key && list && <ContactPanel key={key} ckey={key} pipes={pipes} fields={fields} onClose={() => nav('/contacts')} onChanged={load} onEditFields={() => setModal('fields')} />}
      {modal === 'add' && <AddContact onClose={() => setModal(null)} onDone={(k) => { setModal(null); load().then(() => open(k)); }} />}
      {modal === 'import' && <ImportContacts fields={fields} onClose={() => setModal(null)} onDone={load} />}
      {modal === 'fields' && <FieldsEditor fields={fields} onClose={() => setModal(null)} onSaved={(f) => { setFields(f); setModal(null); toast('Custom fields saved'); }} />}
      {modal === 'pipes' && <PipelinesEditor pipes={pipes} current={pipe?.id} onClose={() => setModal(null)} onSaved={(id) => { setModal(null); if (id) setPid(id); load(); }} />}
    </Layout>
  );
}

// ---------------- kanban board ----------------
function Board({ pipe, rows, onOpen, onMove }) {
  const [drag, setDrag] = useState(null);
  const boardRef = useRef();
  const suppress = useRef(false);
  const byStage = useMemo(() => Object.fromEntries(pipe.stages.map((s) => [s.id, rows.filter((c) => c.stages?.[pipe.id] === s.id)])), [pipe, rows]);

  // pointer drag: mouse moves 6px, touch presses and holds first (so the board still scrolls)
  const down = (e, c) => {
    if (e.button > 0) return;
    const s = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, on: false, touch: e.pointerType !== 'mouse' };
    const colAt = () => document.elementFromPoint(s.x, s.y)?.closest('[data-stage]')?.dataset.stage || null;
    const begin = () => { s.on = true; suppress.current = true; navigator.vibrate?.(15); setDrag({ key: c.key, label: label(c), x: s.x, y: s.y, over: colAt() }); };
    if (s.touch) s.timer = setTimeout(begin, 260);
    const move = (ev) => {
      s.x = ev.clientX; s.y = ev.clientY;
      if (!s.on) {
        const d = Math.hypot(s.x - s.x0, s.y - s.y0);
        if (!s.touch && d > 6) begin(); else if (s.touch && d > 10) stop();
        return;
      }
      const b = boardRef.current?.getBoundingClientRect();
      if (b) { if (s.x > b.right - 70) boardRef.current.scrollLeft += 14; else if (s.x < b.left + 70) boardRef.current.scrollLeft -= 14; }
      setDrag((d) => d && { ...d, x: s.x, y: s.y, over: colAt() });
    };
    const block = (ev) => { if (s.on) ev.preventDefault(); };
    const stop = () => { clearTimeout(s.timer); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); window.removeEventListener('touchmove', block); };
    const up = () => { stop(); if (!s.on) return; const to = colAt(); setDrag(null); if (to) onMove(c, to); setTimeout(() => { suppress.current = false; }, 0); };
    const cancel = () => { stop(); setDrag(null); setTimeout(() => { suppress.current = false; }, 0); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
    window.addEventListener('touchmove', block, { passive: false });
  };

  return (
    <div className={`board ${drag ? 'dragging' : ''}`} ref={boardRef}>
      {pipe.stages.map((s) => {
        const items = byStage[s.id] || [];
        return (
          <section key={s.id} className={`bcol ${drag?.over === s.id ? 'over' : ''}`} data-stage={s.id} style={{ '--sc': s.color }}>
            <header><i /><b>{s.name}</b><span className="cnt">{items.length}</span><small>{inr(items.reduce((a, c) => a + c.ltv, 0))}</small></header>
            <div className="bcards">
              {items.slice(0, 200).map((c) => (
                <article key={c.key} className={`bcard ${drag?.key === c.key ? 'ghosted' : ''}`} tabIndex={0}
                  onPointerDown={(e) => down(e, c)} onClick={() => { if (!suppress.current) onOpen(c.key); }} onKeyDown={(e) => e.key === 'Enter' && onOpen(c.key)}>
                  <div className="bc-top"><span className="who-av sm">{initial(c)}</span><b>{label(c)}</b>{c.type === 'customer' && <span className="pill ok">{inr(c.ltv)}</span>}</div>
                  {(c.email || c.phone) && <small className="bc-sub">{c.email || c.phone}</small>}
                  <div className="bc-foot">{(c.tags || []).slice(0, 2).map((t) => <span key={t} className="tag">{t}</span>)}<span className="muted">{ago(c.lastSeen)}</span></div>
                </article>
              ))}
              {items.length > 200 && <p className="hint center">+{items.length - 200} more — use search</p>}
              {!items.length && <div className="bempty">Drop contacts here</div>}
            </div>
          </section>
        );
      })}
      {drag && <div className="bghost" style={{ left: drag.x, top: drag.y }}>{drag.label}</div>}
    </div>
  );
}

// ---------------- contact panel ----------------
const TL = {
  visit: [Footprints, '#0ea5e9'], lead: [LogIn, '#6366f1'], created: [UserPlus, '#6366f1'], abandon: [ShoppingCart, '#f59e0b'], purchase: [ShoppingBag, '#16a34a'],
  bump: [PackagePlus, '#16a34a'], upsell: [TrendingUp, '#16a34a'], downsell: [TrendingDown, '#16a34a'], crosssell: [PackagePlus, '#16a34a'],
  email: [Mail, '#8b5cf6'], whatsapp: [MessageCircle, '#22c55e'], call: [PhoneCall, '#0f766e'], note: [StickyNote, '#a16207'], meeting: [CalendarDays, '#0369a1'], stage: [ArrowRightLeft, '#64748b'],
};
function ContactPanel({ ckey, pipes, fields, onClose, onChanged, onEditFields }) {
  const [c, setC] = useState(null);
  const [tab, setTab] = useState('timeline');
  const [err, setErr] = useState('');
  const load = () => api(`/contacts/${encodeURIComponent(ckey)}`).then(setC).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [ckey]);
  useEffect(() => { const k = (e) => e.key === 'Escape' && !document.querySelector('.m-scrim') && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const refresh = () => { load(); onChanged(); };
  const setStage = async (p, stageId) => { try { await api(`/contacts/${encodeURIComponent(ckey)}`, 'PATCH', { stage: { pipelineId: p.id, stageId } }); refresh(); } catch (e) { toast(e.message); } };
  const copy = (t) => { navigator.clipboard?.writeText(t); toast('Copied'); };

  return (
    <div className="cp-scrim" onMouseDown={onClose}>
      <aside className="cpanel" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Contact">
        {err ? <div className="cp-body"><Empty icon="users" title="Contact not found" text={err}><button className="btn ghost" onClick={onClose}>Back to contacts</button></Empty></div> : !c ? <div className="cp-body"><div className="skeleton" /></div> : (
          <>
            <header className="cp-head">
              <span className="who-av lg">{initial(c)}</span>
              <div className="cp-id"><h2>{label(c)}</h2><div><span className={`pill ${c.type === 'customer' ? 'ok' : ''}`}>{c.type}</span>{c.unsubscribed && <span className="pill warn" title="Clicked unsubscribe — automated emails are skipped">unsubscribed</span>}{(c.tags || []).map((t) => <span key={t} className="tag">{t}</span>)}</div></div>
              <button className="icon-btn danger" title="Erase this contact’s data (privacy request)" onClick={async () => {
                if (prompt(`Erase everything about ${label(c)}? Sign-ups, messages, bookings and product access are deleted; orders and invoices are kept for tax records without their name and contact details. This can’t be undone. Type ERASE to confirm.`) !== 'ERASE') return;
                try { await api(`/contacts/${encodeURIComponent(ckey)}`, 'DELETE'); toast('Contact erased'); onChanged?.(); onClose(); } catch (x) { toast(x.message); }
              }}><Trash2 size={17} /></button>
              <button className="icon-btn" title="Download their data (a privacy access request)" onClick={async () => {
                const r = await fetch(`/api/contacts/${encodeURIComponent(ckey)}/export`, { headers: { Authorization: `Bearer ${localStorage.getItem('ff_token')}` } });
                if (!r.ok) return toast((await r.json().catch(() => ({}))).error || 'Download failed');
                const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = `contact-${ckey.replace(/[^a-z0-9@._+-]/gi, '_').slice(0, 80)}.json`; a.click();
              }}><Download size={17} /></button>
              <button className="icon-btn" onClick={onClose} title="Close"><X size={18} /></button>
            </header>
            <div className="cp-contact">
              {c.email && <div><Mail size={15} /><a href={`mailto:${c.email}`}>{c.email}</a><button className="icon-btn xs" title="Copy email" onClick={() => copy(c.email)}><Copy size={13} /></button></div>}
              {c.phone && <div><Phone size={15} /><a href={`tel:${c.phone}`}>{c.phone}</a><button className="icon-btn xs" title="Copy phone" onClick={() => copy(c.phone)}><Copy size={13} /></button></div>}
              {!c.email && !c.phone && <div className="muted">No email or phone yet — add them under Details.</div>}
            </div>
            <div className="cp-stats">
              <div><small>Lifetime value</small><b>{inr(c.ltv)}</b></div>
              <div><small>Orders</small><b>{c.orders}</b></div>
              <div><small>First seen</small><b title={when(c.firstSeen)}>{ago(c.firstSeen)}</b></div>
              <div><small>Source</small><b>{c.source}</b></div>
            </div>
            <div className="cp-stages">
              {pipes.map((p) => {
                const cur = p.stages.find((s) => s.id === c.stages?.[p.id]);
                return (
                  <label key={p.id} style={{ '--sc': cur?.color }}>
                    <span>{p.name}</span>
                    <div className="stage-sel"><i /><select value={c.stages?.[p.id] || ''} onChange={(e) => setStage(p, e.target.value)}>{p.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
                  </label>
                );
              })}
            </div>
            <AddToAutomation ckey={ckey} onDone={refresh} />
            <div className="cp-tabs seg">
              <button className={tab === 'timeline' ? 'on' : ''} onClick={() => setTab('timeline')}>Timeline</button>
              <button className={tab === 'details' ? 'on' : ''} onClick={() => setTab('details')}>Details</button>
              <button className={tab === 'orders' ? 'on' : ''} onClick={() => setTab('orders')}>Orders · {c.orderList.length}</button>
            </div>
            <div className="cp-body">
              {tab === 'timeline' && <><Composer c={c} ckey={ckey} onDone={refresh} /><Timeline items={c.timeline} ckey={ckey} onChanged={refresh} /></>}
              {tab === 'details' && <Details c={c} ckey={ckey} fields={fields} onSaved={refresh} onEditFields={onEditFields} />}
              {tab === 'orders' && (c.orderList.length ? c.orderList.map((o) => (
                <div key={o.id} className="cp-order">
                  <div className="cpo-h"><b>{inr(o.total)}</b><span className="muted sm">{o.funnel} · {when(o.at)}</span></div>
                  {o.items.map((it, i) => <div key={i} className="cpo-i"><span className={`kind k-${it.kind}`}>{it.kind === 'main' ? 'product' : it.kind}</span><span>{it.name}</span><b>{inr(it.price)}</b></div>)}
                  {o.coupon && <small className="muted">Coupon {o.coupon}</small>}
                </div>
              )) : <Empty icon="cart" title="No purchases yet" text="When this contact buys, every product, bump, upsell and add-on shows here." />)}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

// Put this contact into an automation by hand (works for every trigger, and is the only way in for "manual" ones)
function AddToAutomation({ ckey, onDone }) {
  const [list, setList] = useState(null);
  const [aid, setAid] = useState('');
  useEffect(() => { api('/automations').then((d) => setList(d.automations.filter((a) => a.active))).catch(() => setList([])); }, []);
  if (!list?.length) return null;
  const add = async () => {
    try { await api(`/automations/${aid}/enroll`, 'POST', { key: ckey }); toast('Added — the first step runs now'); setAid(''); setTimeout(onDone, 800); } catch (e) { toast(e.message); }
  };
  return (
    <div className="cp-auto">
      <select value={aid} onChange={(e) => setAid(e.target.value)} aria-label="Add to automation"><option value="">Add to an automation…</option>{list.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
      <button className="btn ghost sm" disabled={!aid} onClick={add}>Add</button>
    </div>
  );
}

function Composer({ c, ckey, onDone }) {
  const [mode, setMode] = useState('note');
  const [text, setText] = useState('');
  const [subject, setSubject] = useState('');
  const [busy, setBusy] = useState(false);
  const modes = [['note', 'Note', StickyNote], ['email', 'Email', Mail], ['whatsapp', 'WhatsApp', MessageCircle], ['call', 'Log call', PhoneCall]];
  const disabled = (mode === 'email' && !c.email) || (mode === 'whatsapp' && !c.phone);
  const submit = async () => {
    if (!text.trim() && mode !== 'call') return toast('Write something first');
    setBusy(true);
    try {
      if (mode === 'email') {
        const r = await api(`/contacts/${encodeURIComponent(ckey)}/email`, 'POST', { subject, text });
        toast(r.status === 'sent' ? 'Email sent' : 'Saved to the timeline — email sending isn’t set up yet (add RESEND_API_KEY on the server)');
        setSubject('');
      } else {
        if (mode === 'whatsapp' && c.whatsappConfigured) {
          await api(`/contacts/${encodeURIComponent(ckey)}/whatsapp`, 'POST', { text });
          toast('WhatsApp sent');
        } else {
          if (mode === 'whatsapp') window.open(`https://wa.me/${waNumber(c.phone)}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
          await api(`/contacts/${encodeURIComponent(ckey)}/activity`, 'POST', { type: mode, text });
          toast(mode === 'whatsapp' ? 'WhatsApp opened — logged on the timeline' : 'Added to the timeline');
        }
      }
      setText(''); onDone();
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  return (
    <div className="composer">
      <div className="cm-modes">{modes.map(([k, l, I]) => <button key={k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}><I size={14} /> {l}</button>)}</div>
      {mode === 'email' && <input placeholder={c.email ? `Subject — to ${c.email}` : 'This contact has no email address'} value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!c.email} />}
      <textarea rows={3} disabled={disabled} value={text} onChange={(e) => setText(e.target.value)}
        placeholder={disabled ? `Add a ${mode === 'email' ? 'email address' : 'phone number'} under Details first` : mode === 'note' ? 'Add a note about this contact…' : mode === 'email' ? 'Write your email…' : mode === 'whatsapp' ? `Message for ${c.phone} — opens WhatsApp to send` : 'What was discussed on the call?'} />
      <div className="cm-foot">
        <span className="muted sm">{mode === 'whatsapp' ? (c.whatsappConfigured ? 'Sent through your WhatsApp Business number (works if they messaged you in the last 24 h).' : 'Opens WhatsApp with this message and records it here.') : mode === 'email' && !c.mailConfigured ? 'Email delivery isn’t set up yet — messages are recorded only.' : mode === 'email' && c.unsubscribed ? 'This contact unsubscribed from automated emails — one-to-one emails still go through.' : ''}</span>
        <button className="btn primary sm" disabled={busy || disabled} onClick={submit}><Send size={14} /> {mode === 'email' ? 'Send email' : mode === 'whatsapp' ? (c.whatsappConfigured ? 'Send WhatsApp' : 'Open WhatsApp') : 'Save'}</button>
      </div>
    </div>
  );
}

function Timeline({ items, ckey, onChanged }) {
  if (!items.length) return <Empty icon="clock" title="Nothing yet" text="Visits, sign-ups, purchases and messages will appear here." />;
  const del = async (a) => { if (!confirm('Delete this entry?')) return; await api(`/contacts/${encodeURIComponent(ckey)}/activity/${a.id}`, 'DELETE'); onChanged(); };
  let lastDay = '';
  return (
    <ol className="tl">
      {items.map((a, i) => {
        const [I, color] = TL[a.type] || [Repeat, '#64748b'];
        const day = dayLabel(a.at);
        const head = day !== lastDay ? (lastDay = day) : null;
        return (
          <li key={a.id || `${a.type}-${a.at}-${i}`}>
            {head && <div className="tl-day">{head}</div>}
            <div className="tl-row">
              <span className="tl-ic" style={{ '--tc': color }}><I size={14} /></span>
              <div className="tl-main">
                <div className="tl-t"><b>{a.title}</b>{a.by === 'automation' && <span className="tag" title={a.automation}>automation</span>}{a.amount != null && <span className="tl-amt">{inr(a.amount)}</span>}<time title={when(a.at)}>{new Date(a.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</time></div>
                {a.text && <p className={a.type === 'note' || a.type === 'email' || a.type === 'whatsapp' || a.type === 'call' ? 'tl-msg' : 'tl-sub'}>{a.text}</p>}
                {a.fields && <dl className="tl-fields">{Object.entries(a.fields).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)}</dd></div>)}</dl>}
              </div>
              {a.by === 'you' && a.id && <button className="icon-btn xs tl-del" title="Delete" onClick={() => del(a)}><Trash2 size={13} /></button>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Details({ c, ckey, fields, onSaved, onEditFields }) {
  const emailLocked = !!c.email && !ckey.startsWith('phone:') && c.source !== 'added by you' && !String(c.source).startsWith('import');
  const [v, setV] = useState({ name: c.name, email: c.email, phone: c.phone, tags: (c.tags || []).join(', '), custom: { ...c.custom } });
  const [busy, setBusy] = useState(false);
  const set = (k, val) => setV((x) => ({ ...x, [k]: val }));
  const setCustom = (id, val) => setV((x) => ({ ...x, custom: { ...x.custom, [id]: val } }));
  const save = async () => {
    setBusy(true);
    try {
      await api(`/contacts/${encodeURIComponent(ckey)}`, 'PATCH', { name: v.name, phone: v.phone, ...(emailLocked ? {} : { email: v.email }), tags: v.tags.split(',').map((t) => t.trim()).filter(Boolean), custom: v.custom });
      toast('Contact saved'); onSaved();
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const input = (f) => {
    const val = v.custom[f.id] ?? '';
    if (f.type === 'checkbox') return <label className="tog"><input type="checkbox" checked={!!val} onChange={(e) => setCustom(f.id, e.target.checked)} /><span />{val ? 'Yes' : 'No'}</label>;
    if (f.type === 'select') return <select value={val} onChange={(e) => setCustom(f.id, e.target.value)}><option value="">—</option>{String(f.options || '').split(',').map((o) => o.trim()).filter(Boolean).map((o) => <option key={o}>{o}</option>)}</select>;
    if (f.type === 'longtext') return <textarea rows={3} value={val} onChange={(e) => setCustom(f.id, e.target.value)} />;
    return <input type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'url' ? 'url' : 'text'} value={val} onChange={(e) => setCustom(f.id, e.target.value)} placeholder={f.type === 'url' ? 'https://…' : ''} />;
  };
  return (
    <div className="cp-details">
      <div className="fld"><label>Name</label><input value={v.name} onChange={(e) => set('name', e.target.value)} /></div>
      <div className="form2c">
        <div className="fld"><label>Email</label><input type="email" value={v.email} disabled={emailLocked} onChange={(e) => set('email', e.target.value)} title={emailLocked ? 'This contact is identified by this email' : ''} /></div>
        <div className="fld"><label>Phone / WhatsApp</label><input type="tel" value={v.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+91 98765 43210" /></div>
      </div>
      <div className="fld"><label>Tags</label><input value={v.tags} onChange={(e) => set('tags', e.target.value)} placeholder="vip, follow-up, webinar" /><span className="hint">Separate with commas</span></div>
      <h5 className="cp-h5">Custom fields <button className="link-btn" onClick={onEditFields}><SlidersHorizontal size={13} /> Manage</button></h5>
      {fields.length ? fields.map((f) => <div className="fld" key={f.id}><label>{f.label}</label>{input(f)}</div>) : <p className="hint">No custom fields yet — create some (e.g. City, Budget, Course interest) with “Manage”.</p>}
      <button className="btn primary block" disabled={busy} onClick={save}>Save changes</button>
      {c.fields && <>
        <h5 className="cp-h5">Form answers</h5>
        <dl className="tl-fields">{Object.entries(c.fields).map(([k, val]) => <div key={k}><dt>{k}</dt><dd>{typeof val === 'boolean' ? (val ? 'Yes' : 'No') : String(val)}</dd></div>)}</dl>
      </>}
      <h5 className="cp-h5">Activity</h5>
      <dl className="tl-fields">
        <div><dt>First seen</dt><dd>{c.firstSeen ? when(c.firstSeen) : '—'}</dd></div>
        <div><dt>Last activity</dt><dd>{when(c.lastSeen)}</dd></div>
        <div><dt>Source</dt><dd>{c.source}</dd></div>
        <div><dt>Funnels</dt><dd>{c.funnels.join(', ') || '—'}</dd></div>
      </dl>
    </div>
  );
}

// ---------------- modals ----------------
// A small CSV reader: quoted fields (commas, quotes and line breaks inside), CRLF, a BOM, and ; or tab
// separated files (Excel in some locales). Returns the rows as arrays of strings.
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const head = text.slice(0, text.search(/\r?\n/) >>> 0);
  const sep = [',', ';', '\t'].map((d) => [d, head.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], f = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (ch !== '"') f += ch; else if (text[i + 1] === '"') { f += '"'; i++; } else quoted = false; }
    else if (ch === '"' && f === '') quoted = true;
    else if (ch === sep) { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += ch;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}
const IMPORT_MAX = 10000;
const IMPORT_TARGETS = [['email', 'Email', ['email', 'e-mail', 'email address', 'e-mail address', 'mail']], ['phone', 'Phone / WhatsApp', ['phone', 'mobile', 'whatsapp', 'number', 'phone number', 'mobile number', 'whatsapp number', 'contact number']],
  ['name', 'Name', ['name', 'full name', 'fullname', 'contact name']], ['first', 'First name', ['first name', 'firstname', 'first']], ['last', 'Last name', ['last name', 'lastname', 'surname', 'last']],
  ['tags', 'Tags', ['tags', 'tag', 'labels']], ['stage', 'Pipeline stage', ['stage', 'pipeline stage']], ['source', 'Source', ['source', 'lead source']], ['notes', 'Notes', ['notes', 'note', 'comments', 'remarks']]];
const normH = (h) => String(h).trim().toLowerCase().replace(/[_\s]+/g, ' ');
const autoTarget = (h, fields) => IMPORT_TARGETS.find(([, , al]) => al.includes(normH(h)))?.[0] || ((f) => f && `custom:${f.id}`)(fields.find((f) => normH(f.label) === normH(h))) || 'extra';
const SAMPLE = [
  { name: 'Priya Sharma', email: 'priya@example.com', phone: '+91 98765 43210', tags: 'vip; webinar', stage: 'New lead', source: 'Instagram', notes: 'Met at the Pune workshop' },
  { name: 'Rahul Verma', email: '', phone: '+91 91234 56789', tags: 'follow-up', stage: 'Contacted', source: 'Referral', notes: '' },
];

function ImportContacts({ fields, onClose, onDone }) {
  const [file, setFile] = useState(null); // { name, headers, rows }
  const [map, setMap] = useState({});
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const read = (f) => {
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) return toast('That file is over 10 MB — please split it');
    const r = new FileReader();
    r.onload = () => {
      const all = parseCSV(String(r.result || ''));
      if (all.length < 2) return toast('No rows found — the first line should be the column names');
      const seen = {};
      const headers = all[0].map((h, i) => { const b = h.trim() || `Column ${i + 1}`; seen[b] = (seen[b] || 0) + 1; return seen[b] > 1 ? `${b} (${seen[b]})` : b; });
      const rows = all.slice(1).map((x) => Object.fromEntries(headers.map((h, i) => [h, (x[i] ?? '').trim()])));
      setFile({ name: f.name, headers, rows });
      setMap(Object.fromEntries(headers.map((h) => [h, autoTarget(h, fields)])));
      setRes(null);
    };
    r.onerror = () => toast('Couldn’t read that file');
    r.readAsText(f);
  };
  const hasId = Object.values(map).some((t) => t === 'email' || t === 'phone');
  const tooMany = file && file.rows.length > IMPORT_MAX;
  const run = async () => {
    setBusy(true);
    const used = file.headers.filter((h) => map[h]);
    const mapping = Object.fromEntries(used.map((h) => [h, map[h]]));
    const extra = tags.split(',').map((t) => t.trim()).filter(Boolean);
    const out = { created: 0, updated: 0, skipped: 0, errors: [] };
    try {
      // in parts, so a big file stays under the request size limit
      for (let i = 0; i < file.rows.length; i += 2000) {
        const part = file.rows.slice(i, i + 2000).map((x) => Object.fromEntries(used.map((h) => [h, x[h]])));
        const r = await api('/contacts/import', 'POST', { rows: part, mapping, tags: extra });
        out.created += r.created; out.updated += r.updated; out.skipped += r.skipped;
        out.errors.push(...r.errors.map((e) => ({ ...e, row: e.row + i })));
      }
      setRes(out); onDone();
    } catch (e) { toast(e.message); if (out.created + out.updated) { setRes(out); onDone(); } }
    setBusy(false);
  };
  const options = [['', 'Don’t import'], ...IMPORT_TARGETS.map(([k, l]) => [k, l]), ...fields.map((f) => [`custom:${f.id}`, `Custom field: ${f.label}`]), ['extra', 'Keep in a note']];
  return (
    <Modal title="Import contacts from a CSV file" onClose={onClose} width={760}>
      <div className="m-body">
        {res ? (
          <div className="imp-res">
            <div className="kpis imp-kpis">
              <div className="kpi"><span className="kpi-l">Added</span><b className="kpi-v">{num(res.created)}</b></div>
              <div className="kpi"><span className="kpi-l">Updated</span><b className="kpi-v">{num(res.updated)}</b></div>
              <div className="kpi"><span className="kpi-l">Skipped</span><b className="kpi-v">{num(res.skipped)}</b></div>
            </div>
            {res.errors.length > 0 && <><h5 className="cp-h5">Rows to check</h5><ul className="imp-errs">{res.errors.slice(0, 50).map((e, i) => <li key={i}><b>Row {e.row}</b> {e.reason}</li>)}</ul></>}
            <p className="hint">Imported contacts don’t start automations and aren’t counted as funnel sign-ups. Add them to an automation from the list if you want to.</p>
            <div className="m-foot"><button className="btn primary" onClick={onClose}>Done</button></div>
          </div>
        ) : (
          <>
            <p className="hint top">The first line must be the column names. People already in your contacts (same email, or same phone number) are updated — nothing they gave you is overwritten. <a href="#" onClick={(e) => { e.preventDefault(); downloadCSV('contacts-sample.csv', SAMPLE); }}>Download a sample CSV</a></p>
            <label className="imp-drop">
              <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => read(e.target.files?.[0])} />
              <Upload size={18} /> {file ? <span><b>{file.name}</b> · {num(file.rows.length)} rows — choose another file</span> : <span>Choose a CSV file</span>}
            </label>
            {file && <>
              {tooMany && <p className="imp-warn">Up to {num(IMPORT_MAX)} rows at a time — this file has {num(file.rows.length)}. Please split it.</p>}
              <h5 className="cp-h5">Match the columns</h5>
              <div className="tbl-wrap imp-map">
                <table className="tbl">
                  <thead><tr><th>Column in your file</th><th>Goes into</th>{file.rows.slice(0, 5).map((_, i) => <th key={i} className="muted">Row {i + 1}</th>)}</tr></thead>
                  <tbody>{file.headers.map((h) => (
                    <tr key={h}>
                      <td><b>{h}</b></td>
                      <td><select value={map[h] ?? ''} onChange={(e) => setMap((m) => ({ ...m, [h]: e.target.value }))} aria-label={`What ${h} is`}>{options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                      {file.rows.slice(0, 5).map((x, i) => <td key={i} className="imp-cell" title={x[h]}>{x[h]}</td>)}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <div className="fld"><label>Add these tags to everyone (optional)</label><input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="imported, expo-2026" /><span className="hint">Separate with commas. A Tags column in the file is added too (tags separated by ; or ,).</span></div>
              {!hasId && <p className="imp-warn">Pick the column that holds the email or the phone number — rows without either are skipped.</p>}
            </>}
            <div className="m-foot"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!file || !hasId || tooMany || busy} onClick={run}><Upload size={15} /> {busy ? 'Importing…' : file ? `Import ${num(file.rows.length)} rows` : 'Import'}</button></div>
          </>
        )}
      </div>
    </Modal>
  );
}

function AddContact({ onClose, onDone }) {
  const [v, setV] = useState({ name: '', email: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { const r = await api('/contacts', 'POST', v); onDone(r.key); } catch (x) { toast(x.message); setBusy(false); }
  };
  return (
    <Modal title="Add a contact" onClose={onClose} width={460}>
      <form className="m-body" onSubmit={submit}>
        <div className="fld"><label>Name</label><input autoFocus value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Priya Sharma" /></div>
        <div className="fld"><label>Email</label><input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} placeholder="priya@example.com" /></div>
        <div className="fld"><label>Phone / WhatsApp</label><input type="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} placeholder="+91 98765 43210" /></div>
        <p className="hint">An email or a phone number is needed.</p>
        <button className="btn primary block" disabled={busy}>Add contact</button>
      </form>
    </Modal>
  );
}

function FieldsEditor({ fields, onClose, onSaved }) {
  const [list, setList] = useState(fields.map((f) => ({ ...f })));
  const [busy, setBusy] = useState(false);
  const upd = (i, k, val) => setList((l) => l.map((f, j) => (j === i ? { ...f, [k]: val } : f)));
  const mv = (i, d) => setList((l) => { const n = [...l]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n; });
  const save = async () => { setBusy(true); try { onSaved(await api('/crm/fields', 'PUT', { fields: list })); } catch (e) { toast(e.message); setBusy(false); } };
  return (
    <Modal title="Custom contact fields" onClose={onClose} width={620}>
      <div className="m-body">
        <p className="hint top">Extra details you want to keep for every contact — e.g. City, Budget, Course interest, Follow-up date.</p>
        {list.map((f, i) => (
          <div key={f.id || i} className="cf-row">
            <input value={f.label} onChange={(e) => upd(i, 'label', e.target.value)} placeholder="Field name" />
            <select value={f.type} onChange={(e) => upd(i, 'type', e.target.value)}>{FIELD_TYPE_LABELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <button className="icon-btn xs" disabled={i === 0} onClick={() => mv(i, -1)} title="Move up"><ChevronUp size={14} /></button>
            <button className="icon-btn xs" disabled={i === list.length - 1} onClick={() => mv(i, 1)} title="Move down"><ChevronDown size={14} /></button>
            <button className="icon-btn xs danger" onClick={() => setList((l) => l.filter((_, j) => j !== i))} title="Delete field"><Trash2 size={14} /></button>
            {f.type === 'select' && <input className="cf-opts" value={f.options || ''} onChange={(e) => upd(i, 'options', e.target.value)} placeholder="Options, separated by commas — e.g. Beginner, Intermediate, Advanced" />}
          </div>
        ))}
        <button className="btn soft block" onClick={() => setList((l) => [...l, { id: Math.random().toString(36).slice(2, 10), label: '', type: 'text' }])} disabled={list.length >= 30}><Plus size={15} /> Add field</button>
        <div className="m-foot"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save fields</button></div>
      </div>
    </Modal>
  );
}

const SWATCHES = ['#6366f1', '#0ea5e9', '#14b8a6', '#16a34a', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#94a3b8'];
function PipelinesEditor({ pipes, current, onClose, onSaved }) {
  const [pid, setPid] = useState(current || pipes[0]?.id);
  const [drafts, setDrafts] = useState(() => Object.fromEntries(pipes.map((p) => [p.id, JSON.parse(JSON.stringify(p))])));
  const [busy, setBusy] = useState(false);
  const p = drafts[pid];
  const upd = (fn) => setDrafts((d) => ({ ...d, [pid]: fn(d[pid]) }));
  const updStage = (i, k, val) => upd((x) => ({ ...x, stages: x.stages.map((s, j) => (j === i ? { ...s, [k]: val } : k === 'won' && val ? { ...s, won: false } : s)) }));
  const mv = (i, d) => upd((x) => { const st = [...x.stages]; [st[i], st[i + d]] = [st[i + d], st[i]]; return { ...x, stages: st }; });
  const create = async () => {
    const name = prompt('Name the new pipeline', 'Webinar follow-up');
    if (!name) return;
    try { const np = await api('/pipelines', 'POST', { name }); setDrafts((d) => ({ ...d, [np.id]: np })); setPid(np.id); } catch (e) { toast(e.message); }
  };
  const save = async () => {
    setBusy(true);
    try { await api(`/pipelines/${pid}`, 'PUT', { name: p.name, stages: p.stages }); toast('Pipeline saved'); onSaved(pid); } catch (e) { toast(e.message); setBusy(false); }
  };
  const remove = async () => {
    if (!confirm(`Delete the “${p.name}” pipeline? Contacts are not deleted.`)) return;
    try { await api(`/pipelines/${pid}`, 'DELETE'); toast('Pipeline deleted'); onSaved(null); } catch (e) { toast(e.message); }
  };
  if (!p) return null;
  return (
    <Modal title="Pipelines" onClose={onClose} width={640}>
      <div className="m-body">
        <div className="pl-top">
          <select value={pid} onChange={(e) => setPid(e.target.value)}>{Object.values(drafts).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <button className="btn soft sm" onClick={create}><Plus size={14} /> New pipeline</button>
        </div>
        <div className="fld"><label>Pipeline name</label><input value={p.name} onChange={(e) => upd((x) => ({ ...x, name: e.target.value }))} /></div>
        <h5 className="cp-h5">Stages <small className="muted">· left to right on the board</small></h5>
        {p.stages.map((s, i) => (
          <div key={s.id || `new-${i}`} className="st-row">
            <div className="swatches">{SWATCHES.map((c) => <button key={c} className={s.color === c ? 'on' : ''} style={{ background: c }} onClick={() => updStage(i, 'color', c)} title={c} />)}</div>
            <input value={s.name} onChange={(e) => updStage(i, 'name', e.target.value)} placeholder="Stage name" />
            <label className="st-won" title="Customers who haven't been placed yet start here"><input type="checkbox" checked={!!s.won} onChange={(e) => updStage(i, 'won', e.target.checked)} /> Won</label>
            <button className="icon-btn xs" disabled={i === 0} onClick={() => mv(i, -1)} title="Move left"><ChevronUp size={14} /></button>
            <button className="icon-btn xs" disabled={i === p.stages.length - 1} onClick={() => mv(i, 1)} title="Move right"><ChevronDown size={14} /></button>
            <button className="icon-btn xs danger" disabled={p.stages.length <= 1} onClick={() => upd((x) => ({ ...x, stages: x.stages.filter((_, j) => j !== i) }))} title="Delete stage"><Trash2 size={14} /></button>
          </div>
        ))}
        <button className="btn soft block" disabled={p.stages.length >= 20} onClick={() => upd((x) => ({ ...x, stages: [...x.stages, { id: '', name: '', color: SWATCHES[x.stages.length % SWATCHES.length] }] }))}><Plus size={15} /> Add stage</button>
        <p className="hint">New contacts start in the first stage; customers start in the stage marked “Won”. Deleting a stage moves its contacts back to those defaults.</p>
        <div className="m-foot">
          <button className="btn ghost danger-t" onClick={remove} disabled={pipes.length <= 1 && !!pipes.find((x) => x.id === pid)}><Trash2 size={14} /> Delete pipeline</button>
          <span style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy} onClick={save}>Save pipeline</button>
        </div>
      </div>
    </Modal>
  );
}
