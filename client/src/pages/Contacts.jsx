import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Mail, Phone, MessageCircle, StickyNote, PhoneCall, ShoppingBag, Eye, LogIn, UserPlus, TrendingUp, TrendingDown, PackagePlus, ShoppingCart,
  ArrowRightLeft, X, Plus, Sparkles, ArrowUp, Users, BadgeCheck, Sprout, IndianRupee, Trash2, LayoutList, Kanban, Copy, Send, Repeat, ChevronUp, ChevronDown, SlidersHorizontal, Footprints, CalendarDays, CalendarPlus, Upload, Download, Paperclip,
} from 'lucide-react';
import { api } from '../api';
import { KitIcon } from '../blockIcons';
import { ContactFiles } from '../vaultKit';
import { GitMerge } from 'lucide-react';
import '../contacts-merge.css';
import { Layout, Panel, Icon, Empty, Modal, toast, inr, num, ago, downloadCSV, confirmDialog, promptDialog } from '../ui';

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
// each person gets their own avatar colour (stable: from their name)
const AV = ['#6366f1', '#0ea5e9', '#14b8a6', '#16a34a', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#0891b2', '#b45309'];
const avStyle = (c) => { let h = 0; for (const ch of label(c)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return { '--av': AV[h % AV.length] }; };
const keyUrl = (k) => `/contacts/${encodeURIComponent(k)}`;
const FIELD_TYPE_LABELS = [['text', 'Short text'], ['longtext', 'Long text'], ['number', 'Number'], ['money', 'Money (₹)'], ['phone', 'Phone'], ['date', 'Date'], ['select', 'Dropdown'], ['url', 'Link'], ['checkbox', 'Yes / no']];
const PAGE = 100; // contacts per page of the list
const fieldText = (f, v) => (v == null || v === '' ? '' : f.type === 'checkbox' ? (v ? 'Yes' : 'No') : f.type === 'date' ? new Date(v).toLocaleDateString('en-IN') : f.type === 'money' ? `₹${Number(v).toLocaleString('en-IN')}` : String(v));
// big rupee amounts the way Indian businesses say them: ₹45 L, ₹1.2 Cr
const lakh = (n) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(n >= 1e8 ? 0 : 1)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(n >= 1e6 ? 0 : 1)} L` : `₹${Math.round(n).toLocaleString('en-IN')}`);

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
  const [modal, setModal] = useState(null); // 'add' | 'import' | 'fields' | 'pipes' | 'dups'
  const [merging, setMerging] = useState(null); // { keys, primary }: the merge dialog
  const [picked, setPicked] = useState(() => new Set());
  const [autos, setAutos] = useState([]);
  const [kit, setKit] = useState(null); // the CRM style: words, columns, filters, value field
  const [cf, setCf] = useState({}); // quick filters on the kit's fields
  const [valueTotal, setValueTotal] = useState(null);
  useEffect(() => { api('/automations').then((d) => setAutos(d.automations.filter((a) => a.active))).catch(() => {}); }, []);
  // the server filters and pages the list (a page at a time; "Show more" fetches the next one)
  const [page, setPage] = useState(null); // { nextCursor, total, kpis }
  const [boardTick, setBoardTick] = useState(0); // the board reloads its columns when this changes
  const [more, setMore] = useState(false);
  const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const seq = useRef(0);
  const cfOn = Object.fromEntries(Object.entries(cf).filter(([, v]) => v));
  const filterQs = () => `${type !== 'all' ? `&type=${type}` : ''}${dq ? `&q=${encodeURIComponent(dq)}` : ''}${Object.keys(cfOn).length ? `&cf=${encodeURIComponent(JSON.stringify(cfOn))}` : ''}`;
  const loadList = (keep = 0) => {
    const n = ++seq.current;
    return api(`/contacts?limit=${Math.min(1000, Math.max(PAGE, keep))}${filterQs()}`).then((d) => { if (n !== seq.current) return; setList(d.contacts); setPage(d); });
  };
  const load = () => Promise.all([loadList(list?.length || 0), api('/pipelines'), api('/crm/fields'), api('/crm/kits')]).then(([, p, f, k]) => { setPipes(p); setFields(f); setKit(k.current); setBoardTick((t) => t + 1); });
  // the kit's money field, totalled over everyone the filters match (e.g. budgets in the pipeline)
  useEffect(() => { if (!kit?.valueField) return setValueTotal(null); api(`/contacts?limit=1&sum=${kit.valueField}${filterQs()}`).then((d) => setValueTotal(d.totalValue || 0)).catch(() => {}); }, [kit?.valueField, type, dq, JSON.stringify(cfOn), boardTick]);
  useEffect(() => { load(); }, []);
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } setPicked(new Set()); loadList(); }, [type, dq, JSON.stringify(cfOn)]);
  const showMore = async () => {
    if (!page?.nextCursor || more) return;
    setMore(true);
    const n = seq.current;
    try { const d = await api(`/contacts?limit=${PAGE}&cursor=${encodeURIComponent(page.nextCursor)}${filterQs()}`); if (n === seq.current) { setList((l) => [...l, ...d.contacts]); setPage((p) => ({ ...p, nextCursor: d.nextCursor })); } } catch (e) { toast(e.message); }
    setMore(false);
  };
  useEffect(() => { LS.set('ff_contacts_view', view); }, [view]);
  const pipe = pipes.find((p) => p.id === pid) || pipes.find((p) => p.id === kit?.pipelineId) || pipes[0];
  const L = kit?.labels || { title: 'Contacts', one: 'contact', customers: 'Customers', leads: 'Leads', value: 'Lifetime value' };
  const sales = kit ? kit.showSales !== false : true;
  const byId = Object.fromEntries(fields.map((x) => [x.id, x]));
  const cols = (kit?.columns || []).map((id) => byId[id]).filter(Boolean);
  const filters = (kit?.filters || []).map((id) => byId[id]).filter((x) => x?.type === 'select');
  useEffect(() => { if (pipe) LS.set('ff_pipeline', pipe.id); }, [pipe?.id]);
  // a newly chosen CRM style (here, by Hive or on another device) opens on its own pipeline
  useEffect(() => {
    if (!kit?.at || !kit.pipelineId || LS.get('ff_kit_at', '') === String(kit.at)) return;
    LS.set('ff_kit_at', String(kit.at)); setPid(kit.pipelineId);
  }, [kit?.at]);

  const rows = list || [];
  const total = page?.total ?? rows.length;
  const kpis = page?.kpis || { total: 0, customers: 0, leads: 0, avgLtv: 0 };
  const stageOf = (c) => pipe?.stages.find((s) => s.id === c.stages?.[pipe.id]);
  const open = (k) => nav(keyUrl(k));
  const toggle = (k) => setPicked((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const allPicked = rows.length > 0 && rows.every((c) => picked.has(c.key)) && picked.size >= total;
  // everyone this filter matches, not just the rows loaded so far
  const pickAll = async () => {
    if (allPicked) return setPicked(new Set());
    if (total <= rows.length) return setPicked(new Set(rows.map((c) => c.key)));
    try { setPicked(new Set((await api(`/contacts?keys=1${filterQs()}`)).keys)); } catch (e) { toast(e.message); }
  };
  const bulk = async (action, value) => {
    const keys = [...picked];
    try {
      if (action === 'automation') { const r = await api(`/automations/${value}/enroll-bulk`, 'POST', { keys }); toast(`${r.added} added${r.skipped ? ` · ${r.skipped} already in it or skipped` : ''}`); }
      else if (action === 'stage') { const r = await api('/contacts/bulk', 'POST', { keys, stage: { pipelineId: pipe.id, stageId: value } }); toast(`${r.updated} moved`); }
      else { const tag = await promptDialog({ title: action === 'addTag' ? 'Add a tag' : 'Remove a tag', label: action === 'addTag' ? 'Tag to add to the selected contacts' : 'Tag to remove from the selected contacts', confirm: action === 'addTag' ? 'Add tag' : 'Remove tag' }); if (!tag) return; const r = await api('/contacts/bulk', 'POST', { keys, [action]: tag.trim() }); toast(`${r.updated} updated`); }
      setPicked(new Set()); load();
    } catch (e) { toast(e.message); }
  };

  // the whole filtered list, page by page — not just what is on screen
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      const all = [];
      let cursor = '';
      do { const d = await api(`/contacts?limit=1000${filterQs()}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`); all.push(...d.contacts); cursor = d.nextCursor; } while (cursor);
      csvOf(all);
    } catch (e) { toast(e.message); }
    setExporting(false);
  };
  const csvOf = (list) => downloadCSV('contacts.csv', list.map((c) => ({
    name: c.name, email: c.email, phone: c.phone, type: c.type, [`stage (${pipe?.name || 'pipeline'})`]: stageOf(c)?.name || '', tags: (c.tags || []).join(' | '),
    ...Object.fromEntries(fields.map((f) => [f.label, fieldText(f, c.custom?.[f.id])])),
    orders: c.orders, lifetime_value: c.ltv, source: c.source, answers: c.fields ? Object.entries(c.fields).map(([k, v]) => `${k}: ${v}`).join(' | ') : '',
    funnels: c.funnels.join(' | '), first_seen: new Date(c.firstSeen).toISOString(), last_seen: new Date(c.lastSeen).toISOString(),
  })));

  return (
    <Layout title={L.title} subtitle={kit && kit.id !== 'general' ? `${kit.name} CRM — every ${L.one} with their full journey.` : 'Every lead and customer — with their full journey.'} wide={view === 'board'} actions={<>
      <button className="btn ghost" onClick={() => setModal('kit')} title="Switch how your CRM looks for your kind of business"><KitIcon type={kit?.id} size={15} /> CRM style</button>
      <button className="btn ghost" onClick={() => setModal('fields')}><SlidersHorizontal size={16} /> Custom fields</button>
      <button className="btn ghost" onClick={exportCsv} disabled={!rows.length || exporting}><Icon name="download" size={16} /> {exporting ? 'Exporting…' : 'Export'}</button>
      <button className="btn ghost" onClick={() => setModal('import')}><Upload size={16} /> Import CSV</button>
      <button className="btn ghost" onClick={() => setModal('dups')} title="Find the same person added more than once and merge them"><GitMerge size={16} /> Duplicates</button>
      <button className="btn primary" onClick={() => setModal('add')}><UserPlus size={16} /> Add contact</button>
    </>}>
      <AskHive kit={kit} L={L} />
      {!list ? <div className="skeleton" /> : (
        <>
          <div className="kpis k4">
            <div className="kpi crm-kpi" style={{ '--k': '#6366f1' }}><span className="crm-kpi-ic"><Users size={17} /></span><span className="kpi-l">Total {L.title.toLowerCase()}</span><b className="kpi-v">{num(kpis.total)}</b></div>
            <div className="kpi crm-kpi" style={{ '--k': '#16a34a' }}><span className="crm-kpi-ic"><BadgeCheck size={17} /></span><span className="kpi-l">{L.customers}</span><b className="kpi-v">{num(kpis.customers)}</b></div>
            <div className="kpi crm-kpi" style={{ '--k': '#f59e0b' }}><span className="crm-kpi-ic"><Sprout size={17} /></span><span className="kpi-l">{L.leads}</span><b className="kpi-v">{num(kpis.leads)}</b></div>
            <div className="kpi crm-kpi" style={{ '--k': '#ec4899' }}><span className="crm-kpi-ic"><IndianRupee size={17} /></span>{kit?.valueField && valueTotal != null ? <><span className="kpi-l">Total {L.value.toLowerCase()}</span><b className="kpi-v">{lakh(valueTotal)}</b></> : <><span className="kpi-l">Avg. lifetime value</span><b className="kpi-v">{inr(kpis.avgLtv)}</b></>}</div>
          </div>
          {view === 'list' && pipe && kpis.total > 0 && <StageStrip pipe={pipe} filterQs={filterQs()} tick={boardTick} onOpen={() => setView('board')} />}
          {kit && !kit.at && (
            <div className="kit-nudge">
              <span className="kit-nudge-ic" aria-hidden="true">{['realestate', 'clinic', 'consultant', 'education'].map((t) => <span key={t} className="ti-box sm"><KitIcon type={t} size={14} /></span>)}</span>
              <div><b>Make this CRM fit your business</b><small>Real estate, clinic, consultant, coaching, travel, events and more — or describe yours and AI builds it. Switch any time.</small></div>
              <button className="btn primary sm" onClick={() => setModal('kit')}>Choose CRM style</button>
            </div>
          )}
          <div className="crm-bar">
            <div className="seg">
              <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}><LayoutList size={14} /> List</button>
              <button className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}><Kanban size={14} /> Pipeline board</button>
            </div>
            <div className="seg">{[['all', 'All'], ['customer', L.customers], ['lead', L.leads]].map(([k, l]) => <button key={k} className={type === k ? 'on' : ''} onClick={() => setType(k)}>{l}</button>)}</div>
            <div className="crm-pipe">
              <select value={pipe?.id || ''} onChange={(e) => setPid(e.target.value)} aria-label="Pipeline">{pipes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <button className="btn ghost sm" onClick={() => setModal('pipes')}><Icon name="settings" size={14} /> Pipelines</button>
            </div>
            <div className="search"><Icon name="search" size={16} /><input placeholder="Search name, email, phone, tag…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          </div>
          {filters.length > 0 && (
            <div className="crm-filters">{filters.map((x) => (
              <select key={x.id} value={cf[x.id] || ''} onChange={(e) => setCf({ ...cf, [x.id]: e.target.value })} className={cf[x.id] ? 'on' : ''} aria-label={x.label}>
                <option value="">{x.label}: any</option>{String(x.options || '').split(',').map((o) => o.trim()).filter(Boolean).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ))}{Object.keys(cfOn).length > 0 && <button className="link-btn" onClick={() => setCf({})}>Clear filters</button>}</div>
          )}

          {view === 'board' && pipe ? <Board pipe={pipe} filterQs={filterQs()} tick={boardTick} onOpen={open} onMoved={() => loadList(rows.length)} kit={kit} fields={byId} /> : (
            <Panel pad={false}>
              {!rows.length ? <Empty icon="users" title={Object.keys(cfOn).length || dq ? `No ${L.title.toLowerCase()} match` : `No ${L.title.toLowerCase()} yet`} text={Object.keys(cfOn).length || dq ? 'Try clearing the filters.' : `${L.leads} from your forms and ${L.customers.toLowerCase()} from checkouts appear here automatically — or add one yourself.`} /> : (
                <div className="tbl-wrap">
                  {picked.size > 0 && (
                    <div className="bulkbar">
                      <b>{picked.size} selected</b>
                      <select value="" onChange={(e) => e.target.value && bulk('automation', e.target.value)} disabled={!autos.length} title={autos.length ? '' : 'Turn on an automation first'}><option value="">{autos.length ? 'Add to automation…' : 'No active automations'}</option>{autos.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
                      {pipe && <select value="" onChange={(e) => e.target.value && bulk('stage', e.target.value)}><option value="">Move to stage…</option>{pipe.stages.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}</select>}
                      <button className="btn ghost sm" onClick={() => bulk('addTag')}>Add tag</button>
                      <button className="btn ghost sm" onClick={() => bulk('removeTag')}>Remove tag</button>
                      {picked.size >= 2 && picked.size <= 20 && <button className="btn ghost sm" onClick={() => setMerging({ keys: [...picked] })}><GitMerge size={14} /> Merge</button>}
                      <button className="link-btn" onClick={() => setPicked(new Set())}>Clear</button>
                    </div>
                  )}
                  <table className="tbl tbl-click">
                    <thead><tr><th className="ck"><input type="checkbox" checked={allPicked} onChange={pickAll} title={`Select all ${total} shown by this filter`} aria-label="Select all" /></th><th>{L.one[0].toUpperCase() + L.one.slice(1)}</th><th>Stage</th>{cols.map((x) => <th key={x.id} className={x.type === 'money' || x.type === 'number' ? 'r' : ''}>{x.label.replace(/ \(₹\)$/, '')}</th>)}<th>Status</th>{sales && <><th className="r">Orders</th><th className="r">Lifetime value</th><th>Source</th><th>Form answers</th></>}<th className="r">Last activity</th></tr></thead>
                    <tbody>{rows.map((c) => {
                      const st = stageOf(c);
                      return (
                        <tr key={c.key} tabIndex={0} onClick={() => open(c.key)} onKeyDown={(e) => e.key === 'Enter' && open(c.key)} className={`${key === c.key ? 'on' : ''} ${picked.has(c.key) ? 'picked' : ''}`}>
                          <td className="ck" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={picked.has(c.key)} onChange={() => toggle(c.key)} aria-label={`Select ${label(c)}`} /></td>
                          <td><div className="who"><span className="who-av" style={avStyle(c)}>{initial(c)}</span><div><b>{c.name || '—'}</b><small className="sub-t">{c.email}{c.email && c.phone && ' · '}{c.phone}</small></div></div></td>
                          <td>{st && <span className="stage-pill" style={{ '--sc': st.color }}><i />{st.name}</span>}</td>
                          {cols.map((x) => <td key={x.id} className={x.type === 'money' || x.type === 'number' ? 'r strong' : ''}>{fieldText(x, c.custom?.[x.id]) || <span className="muted">—</span>}</td>)}
                          <td><span className={`pill ${c.type === 'customer' ? 'ok' : ''}`}>{c.type === 'customer' ? L.customers.replace(/s$/, '') : L.leads.replace(/s$/, '').replace(/ie$/, 'y')}</span></td>
                          {sales && <><td className="r">{c.orders}</td><td className="r strong">{inr(c.ltv)}</td>
                          <td><span className="src">{c.source}</span></td>
                          <td>{c.fields ? <span className="answers" title={Object.entries(c.fields).map(([k, v]) => `${k}: ${v}`).join('\n')}>📝 {Object.keys(c.fields).length} {Object.keys(c.fields).length === 1 ? 'answer' : 'answers'}</span> : <span className="muted">—</span>}</td></>}
                          <td className="r muted">{ago(c.lastSeen)}</td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                  {page?.nextCursor && <div className="or-more"><button className="btn ghost sm" disabled={more} onClick={showMore}>{more ? 'Loading…' : `Show more (${num(total - rows.length)} more)`}</button></div>}
                </div>
              )}
            </Panel>
          )}
        </>
      )}
      {key && list && <ContactPanel key={key} ckey={key} pipes={pipes} fields={fields} onClose={() => nav('/contacts')} onChanged={load} onEditFields={() => setModal('fields')} onMerge={(keys) => setMerging({ keys, primary: key })} />}
      {modal === 'dups' && <DuplicatesModal onClose={() => setModal(null)} onMerge={(g) => setMerging({ keys: g.keys, primary: g.primary })} onOpen={(k) => { setModal(null); open(k); }} tick={merging} />}
      {merging && <MergeModal keys={merging.keys} primary={merging.primary} onClose={() => setMerging(null)} onDone={(k) => { setMerging(null); setPicked(new Set()); load(); if (key) open(k); }} />}
      {modal === 'add' && <AddContact onClose={() => setModal(null)} onDone={(k) => { setModal(null); load().then(() => open(k)); }} />}
      {modal === 'import' && <ImportContacts fields={fields} onClose={() => setModal(null)} onDone={load} />}
      {modal === 'fields' && <FieldsEditor fields={fields} onClose={() => setModal(null)} onSaved={(f) => { setFields(f); setModal(null); toast('Custom fields saved'); }} />}
      {modal === 'kit' && <KitPicker current={kit} onClose={() => setModal(null)} onApplied={(r) => { setModal(null); setKit(r.current); setCf({}); if (r.current.pipelineId) setPid(r.current.pipelineId); load(); toast(`${r.current.name} CRM is ready`); }} />}
      {modal === 'pipes' && <PipelinesEditor pipes={pipes} current={pipe?.id} onClose={() => setModal(null)} onSaved={(id) => { setModal(null); if (id) setPid(id); load(); }} />}
    </Layout>
  );
}

// ---------------- kanban board ----------------
// each column is its own server query (first 200 cards, with the stage's count and value)
const BOARD_CARDS = 200;
function Board({ pipe, filterQs, tick, onOpen, onMoved, kit, fields = {} }) {
  const vf = kit?.valueField && fields[kit.valueField];
  const cardFields = (kit?.cardFields || []).map((id) => fields[id]).filter(Boolean);
  const [drag, setDrag] = useState(null);
  const [cols, setCols] = useState({}); // stageId → { items, total, ltv }
  const boardRef = useRef();
  const suppress = useRef(false);
  const seq = useRef(0);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const n = ++seq.current;
    Promise.all(pipe.stages.map((s) => api(`/contacts?limit=${BOARD_CARDS}&pipeline=${encodeURIComponent(pipe.id)}&stage=${encodeURIComponent(s.id)}${filterQs}${vf ? `&sum=${vf.id}` : ''}`).then((d) => [s.id, { items: d.contacts, total: d.total, ltv: vf ? d.totalValue || 0 : d.totalLtv }])))
      .then((list) => { if (n === seq.current) setCols(Object.fromEntries(list)); }).catch((e) => toast(e.message));
  }, [pipe, filterQs, tick, retry, vf?.id]);
  const onMove = async (c, stageId) => {
    const from = c.stages?.[pipe.id];
    if (from === stageId) return;
    const moved = { ...c, stages: { ...c.stages, [pipe.id]: stageId } };
    const worth = vf ? Number(c.custom?.[vf.id]) || 0 : c.ltv;
    const shift = (col, add) => col && ({ items: add ? [moved, ...col.items] : col.items.filter((x) => x.key !== c.key), total: col.total + (add ? 1 : -1), ltv: col.ltv + (add ? worth : -worth) });
    setCols((m) => ({ ...m, [from]: shift(m[from], false), [stageId]: shift(m[stageId], true) }));
    try { await api(`/contacts/${encodeURIComponent(c.key)}`, 'PATCH', { stage: { pipelineId: pipe.id, stageId } }); onMoved?.(); } catch (e) { toast(e.message); setRetry((r) => r + 1); }
  };

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
        const col = cols[s.id] || { items: [], total: 0, ltv: 0 };
        const items = col.items;
        return (
          <section key={s.id} className={`bcol ${drag?.over === s.id ? 'over' : ''}`} data-stage={s.id} style={{ '--sc': s.color }}>
            <header><i /><b>{s.name}</b><span className="cnt">{col.total}</span><small title={vf ? `Total ${vf.label}` : 'Lifetime value'}>{vf ? lakh(col.ltv) : inr(col.ltv)}</small></header>
            <div className="bcards">
              {items.slice(0, BOARD_CARDS).map((c) => (
                <article key={c.key} className={`bcard ${drag?.key === c.key ? 'ghosted' : ''}`} tabIndex={0}
                  onPointerDown={(e) => down(e, c)} onClick={() => { if (!suppress.current) onOpen(c.key); }} onKeyDown={(e) => e.key === 'Enter' && onOpen(c.key)}>
                  <div className="bc-top"><span className="who-av sm" style={avStyle(c)}>{initial(c)}</span><b>{label(c)}</b>{c.type === 'customer' && <span className="pill ok">{inr(c.ltv)}</span>}</div>
                  {(c.email || c.phone) && <small className="bc-sub">{c.email || c.phone}</small>}
                  {cardFields.some((x) => c.custom?.[x.id] != null && c.custom[x.id] !== '') && <div className="bc-fields">{cardFields.map((x) => (c.custom?.[x.id] != null && c.custom[x.id] !== '' ? <span key={x.id} title={x.label}>{x.type === 'money' ? lakh(Number(c.custom[x.id])) : fieldText(x, c.custom[x.id])}</span> : null))}</div>}
                  <div className="bc-foot">{(c.tags || []).slice(0, 2).map((t) => <span key={t} className="tag">{t}</span>)}<span className="muted">{ago(c.lastSeen)}</span></div>
                </article>
              ))}
              {col.total > Math.min(items.length, BOARD_CARDS) && <p className="hint center">+{col.total - Math.min(items.length, BOARD_CARDS)} more — use search</p>}
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
  email: [Mail, '#8b5cf6'], whatsapp: [MessageCircle, '#22c55e'], call: [PhoneCall, '#0f766e'], note: [StickyNote, '#a16207'], meeting: [CalendarDays, '#0369a1'], stage: [ArrowRightLeft, '#64748b'], file: [Paperclip, '#7c3aed'],
};
function ContactPanel({ ckey, pipes, fields, onClose, onChanged, onEditFields, onMerge }) {
  const [c, setC] = useState(null);
  const [mergeWith, setMergeWith] = useState(false);
  const [tab, setTab] = useState('timeline');
  const [err, setErr] = useState('');
  const [booking, setBooking] = useState(false);
  const load = () => api(`/contacts/${encodeURIComponent(ckey)}`).then(setC).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [ckey]);
  // a dialog on top handles its own Escape (and marks it handled), so this panel stays open
  useEffect(() => { const k = (e) => e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('.m-scrim, .dlg-scrim') && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const refresh = () => { load(); onChanged(); };
  const setStage = async (p, stageId) => { try { await api(`/contacts/${encodeURIComponent(ckey)}`, 'PATCH', { stage: { pipelineId: p.id, stageId } }); refresh(); } catch (e) { toast(e.message); } };
  const copy = (t) => { navigator.clipboard?.writeText(t); toast('Copied'); };

  return (
    <div className="cp-scrim" onMouseDown={onClose}>
      <aside className="cpanel" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Contact">
        {err ? <div className="cp-body"><Empty icon="users" title="Contact not found" text={err}><button className="btn ghost" onClick={onClose}>Back to contacts</button></Empty></div> : !c ? <div className="cp-body"><div className="skeleton" /></div> : (
          <>
            <header className="cp-head">
              <span className="who-av lg" style={avStyle(c)}>{initial(c)}</span>
              <div className="cp-id"><h2>{label(c)}</h2><div><span className={`pill ${c.type === 'customer' ? 'ok' : ''}`}>{c.type}</span>{c.unsubscribed && <span className="pill warn" title="Clicked unsubscribe — automated emails are skipped">unsubscribed</span>}<button className={`pill btnpill ${c.optIn ? 'ok' : ''}`} title={c.optIn ? 'Agreed to marketing — gets broadcasts. Click if they withdrew.' : 'No marketing consent on record — broadcasts skip them. Click only if they agreed.'} onClick={async () => { try { await api(`/contacts/${encodeURIComponent(ckey)}`, 'PATCH', { optIn: !c.optIn }); refresh(); } catch (e) { toast(e.message); } }}>{c.optIn ? 'opted in' : 'not opted in'}</button>{(c.tags || []).map((t) => <span key={t} className="tag">{t}</span>)}</div></div>
              <button className="icon-btn danger" title="Erase this contact’s data (privacy request)" onClick={async () => {
                if ((await promptDialog({ title: `Erase everything about ${label(c)}?`, text: 'Sign-ups, messages, bookings and product access are deleted; orders and invoices are kept for tax records without their name and contact details. This can’t be undone.', label: 'Type ERASE to confirm', confirmWord: 'ERASE', confirm: 'Erase', danger: true })) !== 'ERASE') return;
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
            <div className="cp-quick"><button className="btn ghost sm" onClick={() => setBooking(true)}><CalendarPlus size={15} /> Book a call</button>{onMerge && <button className="btn ghost sm" onClick={() => setMergeWith(true)} title="The same person added twice? Merge them into this contact"><GitMerge size={15} /> Merge with…</button>}</div>
            {mergeWith && <MergeWith c={c} ckey={ckey} onClose={() => setMergeWith(false)} onPick={(keys) => { setMergeWith(false); onMerge([ckey, ...keys]); }} />}
            {booking && <BookCall c={c} onClose={() => setBooking(false)} onDone={() => { setBooking(false); load(); onChanged?.(); }} />}
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
              <button className={tab === 'files' ? 'on' : ''} onClick={() => setTab('files')}><Paperclip size={13} /> Files</button>
            </div>
            <div className="cp-body">
              {tab === 'timeline' && <><Composer c={c} ckey={ckey} onDone={refresh} /><Timeline items={c.timeline} ckey={ckey} onChanged={refresh} /></>}
              {tab === 'files' && <ContactFiles ckey={ckey} onAdded={refresh} />}
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
  const del = async (a) => { if (!(await confirmDialog({ title: 'Delete this entry?', confirm: 'Delete', danger: true }))) return; await api(`/contacts/${encodeURIComponent(ckey)}/activity/${a.id}`, 'DELETE'); onChanged(); };
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
    return <input type={f.type === 'number' || f.type === 'money' ? 'number' : f.type === 'date' ? 'date' : f.type === 'url' ? 'url' : f.type === 'phone' ? 'tel' : 'text'} inputMode={f.type === 'money' ? 'numeric' : undefined} value={val} onChange={(e) => setCustom(f.id, e.target.value)} placeholder={f.type === 'url' ? 'https://…' : f.type === 'money' ? '₹' : f.type === 'phone' ? '+91 98765 43210' : ''} />;
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
  const [agreed, setAgreed] = useState(false); // the seller confirms these people agreed to marketing (else broadcasts skip them)
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
        const r = await api('/contacts/import', 'POST', { rows: part, mapping, tags: extra, consent: agreed });
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
              <label className="tog"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /><span />These contacts agreed to receive marketing from me <small className="muted">· without this, broadcasts skip them</small></label>
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
    const name = await promptDialog({ title: 'New pipeline', label: 'Name the new pipeline', value: 'Webinar follow-up', confirm: 'Create' });
    if (!name) return;
    try { const np = await api('/pipelines', 'POST', { name }); setDrafts((d) => ({ ...d, [np.id]: np })); setPid(np.id); } catch (e) { toast(e.message); }
  };
  const save = async () => {
    setBusy(true);
    try { await api(`/pipelines/${pid}`, 'PUT', { name: p.name, stages: p.stages }); toast('Pipeline saved'); onSaved(pid); } catch (e) { toast(e.message); setBusy(false); }
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: `Delete the “${p.name}” pipeline?`, text: 'Contacts are not deleted.', confirm: 'Delete pipeline', danger: true }))) return;
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

// ---------- CRM style: the CRM shaped for a kind of business, or designed by AI from a description ----------
const TYPE_WORD = { text: 'text', longtext: 'notes', number: 'number', money: '₹', phone: 'phone', date: 'date', select: 'choice', url: 'link', checkbox: 'yes/no' };
function KitPreview({ kit }) {
  return (
    <div className="kit-prev">
      <div className="kit-row"><b>{kit.labels?.title}</b><span className="muted"> · {kit.labels?.customers} & {kit.labels?.leads?.toLowerCase()}{kit.valueField ? ` · board totals ${kit.labels?.value?.toLowerCase()}` : ''}</span></div>
      {kit.pipeline && <div className="kit-stages" aria-label="Pipeline stages">{kit.pipeline.stages.map((s, i) => <span key={i} style={{ '--st': s.color }}>{s.name}</span>)}</div>}
      {kit.fields?.length > 0 && <div className="kit-fields">{kit.fields.map((x) => <span key={x.id}>{x.label.replace(/ \(₹\)$/, '')} <small>{TYPE_WORD[x.type]}</small></span>)}</div>}
    </div>
  );
}
function KitPicker({ current, onClose, onApplied }) {
  const [kits, setKits] = useState(null);
  const [sel, setSel] = useState(current?.id && current.id !== 'custom' ? current.id : null);
  const [tab, setTab] = useState(current?.id === 'custom' ? 'ai' : 'ready');
  const [desc, setDesc] = useState('');
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/crm/kits').then((d) => setKits(d.kits)).catch((e) => toast(e.message)); }, []);
  const chosen = tab === 'ai' ? draft : kits?.find((k) => k.id === sel);
  const design = async () => {
    setBusy(true);
    try { const r = await api('/ai/crm-kit', 'POST', { description: desc }); setDraft(r.kit); } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const apply = async () => {
    if (!chosen) return;
    if (chosen.id === current?.id && chosen.id !== 'custom') return onClose();
    setBusy(true);
    try { onApplied(await api('/crm/kit', 'POST', tab === 'ai' ? { kit: draft } : { id: chosen.id })); } catch (e) { toast(e.message); setBusy(false); }
  };
  const IDEAS = ['Interior design studio — site measurements, design fee, 3D render approval, execution', 'Wedding photographer — event date, venue, package, advance paid', 'Coaching institute for NEET — student class, parent phone, demo class, batch', 'Car dealership — model, variant, test drive, finance, delivery'];
  return (
    <Modal title="CRM style" onClose={onClose} width={820}>
      <div className="m-body">
        <p className="hint" style={{ marginTop: 0 }}>Make your CRM speak your business — its words, fields, pipeline stages and board. Switch any time: <b>no contact or field is ever deleted</b>, only what’s shown changes.</p>
        <div className="seg" style={{ marginBottom: 14 }}>
          <button className={tab === 'ready' ? 'on' : ''} onClick={() => setTab('ready')}>Ready-made</button>
          <button className={tab === 'ai' ? 'on' : ''} onClick={() => setTab('ai')}><KitIcon type="custom" size={14} /> Build with AI</button>
        </div>
        {tab === 'ready' ? (
          !kits ? <div className="spinner" /> : (
            <div className="kit-grid">{kits.map((k) => (
              <button key={k.id} className={`kit-card ${sel === k.id ? 'on' : ''}`} onClick={() => setSel(k.id)} aria-pressed={sel === k.id}>
                <span className="ti-box lg kit-ic"><KitIcon type={k.id} size={20} /></span>
                <b>{k.name}{current?.id === k.id && <span className="pill ok">Current</span>}</b>
                <small>{k.desc}</small>
              </button>
            ))}</div>
          )
        ) : (
          <div className="kit-ai">
            <div className="fld"><label>Describe your business and how you sell</label>
              <textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={1500} placeholder="e.g. We run a dental clinic in Pune. Patients find us on Google and Practo, book a consultation, then start a treatment plan like braces or implants…" />
            </div>
            {!draft && <div className="kit-ideas">{IDEAS.map((t) => <button key={t} className="kit-idea" onClick={() => setDesc(t)}>{t.split(' — ')[0]}</button>)}</div>}
            <button className="btn soft" disabled={busy || desc.trim().length < 8} onClick={design}><KitIcon type="custom" size={15} /> {busy ? 'Designing…' : draft ? 'Redesign' : 'Design my CRM'}</button>
            {current?.id === 'custom' && !draft && <p className="hint">You’re using “{current.name}”, designed earlier. Describe changes to design a new version.</p>}
          </div>
        )}
        {chosen && (chosen.fields?.length > 0 || chosen.pipeline) && <><h5 className="cp-h5 kit-h"><span className="ti-box sm"><KitIcon type={chosen.id} size={14} /></span>{chosen.name} — what you’ll get</h5><KitPreview kit={chosen} /></>}
        <div className="m-foot">
          <span style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !chosen} onClick={apply}>{chosen && chosen.id === current?.id && chosen.id !== 'custom' ? 'Keep this style' : `Use ${chosen ? chosen.name : 'this'} CRM`}</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Ask Hive: questions about the CRM, answered (and acted on) by Hive AI ----------
const ASK_IDEAS = {
  general: ['Who are my top 10 customers by spend?', 'Leads from the last 7 days who haven’t bought', 'Tag everyone who bought twice as “loyal”'],
  realestate: ['Who has a site visit this week?', 'Total budget of 3 BHK prospects', 'Move Rohan to Negotiation and note “wants a corner flat”'],
  clinic: ['Which patients have an appointment tomorrow?', 'Patients due for a follow-up this month', 'Draft a WhatsApp reminder for next week’s appointments'],
  consultant: ['Which deals are in Proposal sent?', 'Total deal value in Negotiation', 'Who haven’t I followed up with in 2 weeks?'],
  education: ['Who booked a demo class this week?', 'Enquiries for the NEET batch', 'Draft a fee reminder for pending admissions'],
  fitness: ['Whose membership renews this month?', 'Trials that didn’t join yet', 'Draft a renewal offer for expiring members'],
  finance: ['Clients with documents pending', 'Total ticket size of home-loan leads', 'Follow-ups due this week'],
  interior: ['Projects waiting for 3D approval', 'Total value of signed projects', 'Site measurements this week'],
  events: ['Events in the next 30 days', 'Enquiries without a quote yet', 'Total package value of booked weddings'],
  travel: ['Trips departing this month', 'International enquiries to follow up', 'Total value of booked trips'],
  auto: ['Test drives scheduled this week', 'Prospects who need a loan', 'Deliveries due this month'],
  professional: ['Deadlines and hearings this week', 'Clients with documents pending', 'Total fees of engaged clients'],
  recruitment: ['Interviews this week', 'Immediate joiners for the open roles', 'Candidates at offer stage'],
  homeservices: ['Site surveys this week', 'Customers due for service (AMC)', 'Quotes sent but not confirmed'],
  hospitality: ['Check-ins this week', 'Banquet enquiries to follow up', 'Total booking value this month'],
  store: ['COD orders waiting to be confirmed', 'Customers due to reorder this week', 'Who hasn’t been asked for a review?'],
  manufacturer: ['Quotations waiting for an answer', 'Dispatches due this week', 'Dealer enquiries from IndiaMART this month'],
  retailer: ['Birthdays and anniversaries this week', 'Customers who visited but didn’t buy', 'Home deliveries still to make'],
  distributor: ['Accounts with payment overdue', 'Rate lists sent but no order yet', 'Accounts that stopped ordering this month'],
  abroad: ['Application deadlines this month', 'Students with documents pending', 'Canada enquiries for the September intake'],
  wellness: ['Sessions this week', 'Clients consulted but without a package', 'Draft a follow-up for last week’s consultations'],
  saas: ['Trials ending this week', 'Demos booked for tomorrow', 'Total annual value in Proposal'],
  ngo: ['Monthly donors who lapsed', 'Donors waiting for an 80G receipt', 'Total donated this month'],
};
function AskHive({ kit, L }) {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const ideas = ASK_IDEAS[kit?.id] || [`Which ${L.leads.toLowerCase()} need a follow-up?`, `Total ${L.value.toLowerCase()} in the pipeline`, `Move a ${L.one} to the next stage`];
  const go = (text) => { const t = String(text || '').trim(); if (t) nav(`/hive?ask=${encodeURIComponent(t)}`); };
  return (
    <div className="ask-hive">
      <div className="ask-hive-top">
        <span className="ask-hive-ic"><Sparkles size={18} /></span>
        <form onSubmit={(e) => { e.preventDefault(); go(q); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Ask Hive AI about your ${L.title.toLowerCase()} — find, total, update, follow up…`} aria-label="Ask Hive AI" maxLength={500} />
          <button className="ask-hive-go" disabled={!q.trim()} aria-label="Ask Hive AI"><ArrowUp size={17} /></button>
        </form>
      </div>
      <div className="ask-hive-ideas">{ideas.map((t) => <button key={t} onClick={() => go(t)}>{t}</button>)}</div>
    </div>
  );
}

// ---------- the pipeline at a glance: how many sit in each stage ----------
function StageStrip({ pipe, filterQs, tick, onOpen }) {
  const [counts, setCounts] = useState(null);
  useEffect(() => {
    let live = true;
    Promise.all(pipe.stages.map((s) => api(`/contacts?limit=1&pipeline=${encodeURIComponent(pipe.id)}&stage=${encodeURIComponent(s.id)}${filterQs}`).then((d) => d.total).catch(() => 0)))
      .then((r) => { if (live) setCounts(r); });
    return () => { live = false; };
  }, [pipe, filterQs, tick]);
  if (!counts) return <div className="stage-strip ghost" />;
  const total = counts.reduce((a, b) => a + b, 0);
  return (
    <button className="stage-strip" onClick={onOpen} title="Open the pipeline board">
      <span className="ss-h"><b>{pipe.name}</b><small>{total} in the pipeline · open board →</small></span>
      <span className="ss-bar">{pipe.stages.map((s, i) => counts[i] > 0 && <i key={s.id} style={{ flex: counts[i], background: s.color }} />)}{!total && <i style={{ flex: 1 }} />}</span>
      <span className="ss-legend">{pipe.stages.map((s, i) => <span key={s.id} className={counts[i] ? '' : 'zero'}><i style={{ background: s.color }} />{s.name} <b>{counts[i]}</b></span>)}</span>
    </button>
  );
}

// Book a call for this contact from the CRM: one of your calendars, a free time, and it's booked — the same booking
// as on your booking page (confirmation email + invite to them, the CRM stage and booking automations follow)
// ---------- duplicates and merging ----------
const who2 = (c) => [c.email, c.phone].filter(Boolean).join(' · ') || c.key;
// likely duplicates (same number, same email, similar name in the same city), each group with why
function DuplicatesModal({ onClose, onMerge, onOpen, tick }) {
  const [groups, setGroups] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/contacts/duplicates').then((r) => setGroups(r.groups)).catch((e) => setErr(e.message)); }, [tick]);
  return (
    <Modal title="Duplicate contacts" onClose={onClose} width={860}>
      <div className="m-body cm-body">
        {err ? <p className="err">{err}</p> : !groups ? <div className="skeleton" /> : !groups.length ? (
          <Empty icon="users" title="No duplicates found" text="Nobody shares a phone number or email with another contact, and no two names in the same city look alike." />
        ) : <>
          <p className="hint">{groups.length} group{groups.length > 1 ? 's' : ''} that look like the same person. Merging moves orders, timeline, chats and automations to the one you keep.</p>
          {groups.map((g) => <DupGroup key={g.id} g={g} onMerge={onMerge} onOpen={onOpen} />)}
        </>}
      </div>
    </Modal>
  );
}
function DupGroup({ g, onMerge, onOpen }) {
  const [primary, setPrimary] = useState(g.suggested);
  const [on, setOn] = useState(() => new Set(g.contacts.map((c) => c.key)));
  const keys = g.contacts.map((c) => c.key).filter((k) => on.has(k) || k === primary);
  const flip = (k) => setOn((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  return (
    <section className="cm-group">
      <div className="cm-why">{g.reasons.map((r) => <span key={r} className="cm-reason">{r}</span>)}</div>
      <table className="tbl cm-tbl">
        <thead><tr><th className="ck" title="Include in the merge">In</th><th>Keep</th><th>Contact</th><th className="r">Orders</th><th className="r">Value</th><th>Last seen</th></tr></thead>
        <tbody>{g.contacts.map((c) => (
          <tr key={c.key} className={c.key === primary ? 'cm-keep' : on.has(c.key) ? '' : 'cm-off'}>
            <td className="ck"><input type="checkbox" checked={on.has(c.key) || c.key === primary} disabled={c.key === primary} onChange={() => flip(c.key)} aria-label={`Include ${label(c)}`} /></td>
            <td><input type="radio" name={`keep-${g.id}`} checked={c.key === primary} onChange={() => setPrimary(c.key)} aria-label={`Keep ${label(c)}`} /></td>
            <td><button className="link-btn cm-who" onClick={() => onOpen(c.key)}><b>{c.name || '—'}</b><small className="sub-t">{who2(c)}{c.city ? ` · ${c.city}` : ''}</small></button>{c.waOptOut && <span className="pill warn">WhatsApp opt-out</span>}{c.unsubscribed && <span className="pill warn">unsubscribed</span>}</td>
            <td className="r">{c.orders || <span className="muted">—</span>}</td>
            <td className="r">{c.ltv ? inr(c.ltv) : <span className="muted">—</span>}</td>
            <td>{c.lastSeen ? ago(c.lastSeen) : '—'}</td>
          </tr>
        ))}</tbody>
      </table>
      <div className="cm-act"><button className="btn primary sm" disabled={keys.length < 2} onClick={() => onMerge({ keys, primary })}><GitMerge size={14} /> Merge {keys.length}…</button></div>
    </section>
  );
}

// "Merge with…" on a contact: their likely duplicates first, or search for anyone
function MergeWith({ c, ckey, onClose, onPick }) {
  const [sugg, setSugg] = useState(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const [sel, setSel] = useState(() => new Set());
  useEffect(() => { api(`/contacts/duplicates?key=${encodeURIComponent(ckey)}`).then((r) => setSugg((r.groups[0]?.contacts || []).filter((x) => x.key !== ckey))).catch(() => setSugg([])); }, [ckey]);
  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) { setFound([]); return undefined; }
    const t = setTimeout(() => api(`/contacts?q=${encodeURIComponent(s)}&limit=8`).then((r) => setFound((r.contacts || []).filter((x) => x.key !== ckey))).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [q, ckey]);
  const flip = (k) => setSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else if (n.size < 19) n.add(k); return n; });
  const row = (x) => (
    <label key={x.key} className={`cm-pick ${sel.has(x.key) ? 'on' : ''}`}>
      <input type="checkbox" checked={sel.has(x.key)} onChange={() => flip(x.key)} />
      <span className="who-av" style={avStyle(x)}>{initial(x)}</span>
      <span><b>{x.name || '—'}</b><small className="sub-t">{who2(x)}{x.orders ? ` · ${x.orders} order${x.orders > 1 ? 's' : ''}` : ''}</small></span>
    </label>
  );
  const shown = new Set((sugg || []).map((x) => x.key));
  return (
    <Modal title={`Merge with ${label(c)}`} onClose={onClose} width={560}>
      <div className="m-body cm-body">
        <h4 className="cm-h">Looks like the same person</h4>
        {!sugg ? <div className="skeleton" /> : sugg.length ? sugg.map(row) : <p className="muted sm">No likely duplicates — search below.</p>}
        <h4 className="cm-h">Or find a contact</h4>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email or phone" />
        <div className="cm-found">{found.filter((x) => !shown.has(x.key)).map(row)}</div>
        <div className="m-foot"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!sel.size} onClick={() => onPick([...sel])}>Next: choose what to keep</button></div>
      </div>
    </Modal>
  );
}

// pick the contact to keep, see what the merged contact will have, then merge
function MergeModal({ keys, primary: first, onClose, onDone }) {
  const [primary, setPrimary] = useState(first || keys[0]);
  const [pv, setPv] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setErr(''); api('/contacts/merge', 'POST', { keys, primary, dryRun: true }).then(setPv).catch((e) => setErr(e.message)); }, [primary, keys.join('|')]);
  const go = async () => {
    setBusy(true);
    try { const r = await api('/contacts/merge', 'POST', { keys, primary }); toast(`Merged ${r.merged.length + 1} contacts`); onDone(r.key); } catch (e) { toast(e.message); setBusy(false); }
  };
  const k = pv?.kept;
  return (
    <Modal title={`Merge ${keys.length} contacts`} onClose={onClose} width={720}>
      <div className="m-body cm-body">
        {err && <p className="err">{err}</p>}
        {!pv && !err ? <div className="skeleton" /> : pv && <>
          <h4 className="cm-h">Keep</h4>
          <div className="cm-cards">{pv.contacts.map((c) => (
            <label key={c.key} className={`cm-card ${c.key === primary ? 'on' : ''}`}>
              <input type="radio" name="cm-primary" checked={c.key === primary} onChange={() => setPrimary(c.key)} />
              <span className="who-av" style={avStyle(c)}>{initial(c)}</span>
              <span className="cm-card-t"><b>{c.name || '—'}</b><small className="sub-t">{who2(c)}</small><small className="muted">{c.orders ? `${c.orders} order${c.orders > 1 ? 's' : ''} · ${inr(c.ltv)}` : c.type}</small></span>
            </label>
          ))}</div>
          <h4 className="cm-h">The merged contact</h4>
          <dl className="cm-kept">
            <dt>Name</dt><dd>{k.name || '—'}</dd>
            <dt>Email</dt><dd>{k.email || '—'}{pv.key !== pv.primary && <small className="muted"> — filed under this email, since orders are tracked by email</small>}</dd>
            <dt>Phone</dt><dd>{k.phone || '—'}</dd>
            <dt>Orders</dt><dd>{k.orders} · {inr(k.ltv)}</dd>
            {Object.keys(k.stages || {}).length > 0 && <><dt>Stage</dt><dd>{Object.entries(k.stages).map(([p, s]) => `${s}${Object.keys(k.stages).length > 1 ? ` (${p})` : ''}`).join(' · ')}</dd></>}
            <dt>Tags</dt><dd>{k.tags.length ? k.tags.map((t) => <span key={t} className="tag">{t}</span>) : '—'}</dd>
            <dt>Messages</dt><dd>{k.waOptOut || k.unsubscribed ? <span className="pill warn">{[k.waOptOut && 'opted out of WhatsApp', k.unsubscribed && 'unsubscribed from emails'].filter(Boolean).join(' · ')}</span> : k.optIn ? <span className="pill ok">opted in</span> : <span className="muted">no marketing consent on record</span>}</dd>
          </dl>
          <p className="hint cm-note">Details come from the contact you keep; blanks are filled from the others. Tags, notes, timeline, orders, bookings, chats and automations all move to it, and an opt-out on any copy stays. The other {keys.length - 1} contact{keys.length > 2 ? 's are' : ' is'} removed — this can’t be undone.</p>
        </>}
        <div className="m-foot"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!pv || busy} onClick={go}><GitMerge size={15} /> {busy ? 'Merging…' : 'Merge'}</button></div>
      </div>
    </Modal>
  );
}

function BookCall({ c, onClose, onDone }) {
  const [cals, setCals] = useState(null);
  const [cal, setCal] = useState('');
  const [d, setD] = useState(null);
  const [day, setDay] = useState('');
  const [slot, setSlot] = useState(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/calendars').then((l) => { const list = Array.isArray(l) ? l : l.calendars || []; setCals(list); if (list[0]) setCal(list[0].id); }).catch(() => setCals([])); }, []);
  useEffect(() => { if (!cal) return; setD(null); setSlot(null); api(`/calendars/${cal}/slots`).then((r) => { setD(r); setDay(''); }).catch((e) => { toast(e.message); setD({ slots: [] }); }); }, [cal]);
  const tz = d?.calendar?.timezone;
  const fmt = (t, o) => new Date(t).toLocaleString('en-IN', { timeZone: tz, ...o });
  const dayOf = (t) => fmt(t, { year: 'numeric', month: '2-digit', day: '2-digit' });
  const days = d ? [...new Set(d.slots.map(dayOf))] : [];
  const cur = day || days[0];
  const times = d ? d.slots.filter((t) => dayOf(t) === cur) : [];
  const save = async () => {
    setBusy(true);
    try { await api('/bookings', 'POST', { calendarId: cal, start: slot, email: c.email, name: c.name, phone: c.phone, notes }); toast(`Booked — ${c.name || c.email} gets the confirmation and invite`); onDone(); } catch (e) { toast(e.message); setBusy(false); }
  };
  return (
    <Modal title={`Book a call with ${c.name || c.email || c.phone}`} onClose={onClose} width={560}><div className="m-body">
      {cals === null ? <div className="skeleton sm" /> : !cals.length ? <p className="muted">You have no calendars yet — set your available hours in Bookings first.</p> : <>
        {!c.email && <p className="hint warn">Add an email address under Details first — the confirmation and invite are sent there.</p>}
        {cals.length > 1 && <div className="fld"><label>Calendar</label><select value={cal} onChange={(e) => setCal(e.target.value)}>{cals.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.duration} min</option>)}</select></div>}
        {!d ? <div className="skeleton sm" /> : !d.slots.length ? <p className="muted">No free times in this calendar's booking window — widen your hours in Bookings.</p> : <>
          <div className="bk-days">{days.slice(0, 21).map((k) => { const t = d.slots.find((x) => dayOf(x) === k); return <button key={k} className={k === cur ? 'on' : ''} onClick={() => { setDay(k); setSlot(null); }}><small>{fmt(t, { weekday: 'short' })}</small><b>{fmt(t, { day: 'numeric' })}</b><small>{fmt(t, { month: 'short' })}</small></button>; })}</div>
          <div className="bk-times">{times.map((t) => <button key={t} className={t === slot ? 'on' : ''} onClick={() => setSlot(t)}>{fmt(t, { hour: 'numeric', minute: '2-digit' })}</button>)}</div>
          <div className="fld"><label>Note for the booking (optional)</label><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Site visit — Baner 3BHK" /></div>
          <p className="hint">Times are in {tz || 'your time zone'}. {c.name || 'They'} get the confirmation email and calendar invite.</p>
          <div className="row"><button className="btn primary" disabled={!slot || busy || !c.email} onClick={save}>{busy ? 'Booking…' : slot ? `Book ${fmt(slot, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : 'Pick a time'}</button><button className="btn ghost" onClick={onClose}>Cancel</button></div>
        </>}
      </>}
    </div></Modal>
  );
}
