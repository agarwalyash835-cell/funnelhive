import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Layout, Panel, Icon, Empty, Modal, toast, num, ago, inr, useWaTemplates, WaTemplateSelect, WaTemplateInfo, confirmDialog } from '../ui';
import { VoiceCampaigns } from './VoiceCampaigns';
import { TemplatePicker, AiBuilder } from './CampaignTemplates';

const STATUS = { draft: ['Draft', ''], scheduled: ['Scheduled', 'info'], sending: ['Sending…', 'warn'], sent: ['Sent', 'ok'], cancelled: ['Cancelled', 'bad'] };
const VARS = ['first_name', 'name', 'email', 'phone', 'business'];
const when = (t) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
export const localInput = (t) => new Date(t - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const FOLLOW = { all: 'Everyone it reached', not_opened: 'Didn’t open it', not_clicked: 'Didn’t click a link', opened: 'Opened it', clicked: 'Clicked a link', not_read: 'Didn’t read it', read_no_reply: 'Read it but didn’t reply', failed: 'Didn’t receive it' };
// which follow-ups each channel can do (WhatsApp tells us delivered / read; replies come into the inbox)
const FOLLOW_FOR = { email: ['all', 'not_opened', 'not_clicked', 'opened', 'clicked', 'failed'], whatsapp: ['all', 'not_read', 'read_no_reply', 'failed'] };
const TABS = [['all', 'All'], ['whatsapp', 'WhatsApp'], ['email', 'Email'], ['calls', 'AI calls']];

// /campaigns (and /broadcasts): WhatsApp and email campaigns, and AI calling campaigns
export default function Broadcasts() {
  const [d, setD] = useState(null);
  const [sel, setSel] = useState(null);
  const [tab, setTab] = useState(() => { try { return localStorage.getItem('ff_camp_tab') || 'all'; } catch { return 'all'; } });
  const [newCall, setNewCall] = useState(0);
  const [modal, setModal] = useState(null); // 'templates' | 'ai'
  const [openCall, setOpenCall] = useState(null);
  const used = async (r) => { setModal(null); if (r.channel === 'call') { pickTab('calls'); setOpenCall(r.id); } else { await load(); pickTab(r.channel); setSel(r.id); } };
  const pickTab = (k) => { setTab(k); setSel(null); try { localStorage.setItem('ff_camp_tab', k); } catch {} };
  const [funnels, setFunnels] = useState([]);
  const load = () => api('/broadcasts').then((x) => { setD(x); return x; });
  useEffect(() => { load(); api('/funnels').then((l) => setFunnels(Array.isArray(l) ? l : l.funnels || [])).catch(() => {}); }, []);
  // a broadcast that's going out refreshes itself
  useEffect(() => {
    if (!d?.broadcasts.some((b) => b.status === 'sending' || (b.status === 'scheduled' && b.scheduledAt < Date.now() + 60000))) return undefined;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [d]);
  const create = async (channel, name) => {
    try { const b = await api('/broadcasts', 'POST', { channel, name: name || (channel === 'email' ? 'New email campaign' : 'New WhatsApp campaign'), segment: {} }); await load(); pickTab(channel); setSel(b.id); } catch (e) { toast(e.message); }
  };
  // the "New campaign" chooser: a channel (WhatsApp, email, AI calls), a template or AI
  const start = async (how, name) => {
    setModal(null);
    if (how === 'templates' || how === 'ai') return setModal(how);
    if (how === 'calls') { pickTab('calls'); setNewCall((n) => n + 1); return undefined; }
    return create(how, name);
  };
  const current = d?.broadcasts.find((b) => b.id === sel);
  return (
    <Layout title="Campaigns" subtitle="WhatsApp, email and AI calling campaigns to a segment of your contacts — now or at a time you pick, with follow-ups and the sales each one brought." actions={<>
      <button className="btn ghost" onClick={() => setModal('templates')}><Icon name="layout" size={16} /> Templates</button>
      <button className="btn ghost" onClick={() => setModal('ai')}><Icon name="sparkles" size={16} /> Build with AI</button>
      <button className="btn primary" onClick={() => setModal('new')}><Icon name="plus" size={16} /> New campaign</button>
    </>}>
      {!current && <div className="seg camp-tabs" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => pickTab(k)}>{l}</button>)}</div>}
      {!d ? <div className="skeleton" /> : tab === 'calls' && !current ? (
        <VoiceCampaigns meta={d} funnels={funnels} newSignal={newCall} openId={openCall} />
      ) : current ? (
        <Editor key={current.id} b={current} meta={d} funnels={funnels} onBack={() => setSel(null)} onChange={load} onOpen={(id) => setSel(id)} />
      ) : (
        <CampaignList d={d} tab={tab} onOpen={setSel} onNew={(how) => (how ? start(how) : setModal('new'))} />
      )}
      {modal === 'new' && <NewCampaign meta={d} onClose={() => setModal(null)} onPick={start} />}
      {modal === 'templates' && <TemplatePicker onClose={() => setModal(null)} onUsed={used} />}
      {modal === 'ai' && <AiBuilder onClose={() => setModal(null)} onUsed={used} />}
    </Layout>
  );
}

const CHANNELS = [
  ['whatsapp', 'WhatsApp', 'send', 'An approved marketing template to opted-in contacts — read rates are usually far above email.'],
  ['email', 'Email', 'mail', 'A personalised email with tracked opens and clicks, and an unsubscribe link added for you.'],
  ['calls', 'AI calls', 'phone', 'An AI voice agent calls your list, qualifies people and books them in.'],
];
const isReady = (meta, k) => (k === 'email' ? meta?.email?.configured : k === 'whatsapp' ? meta?.whatsapp?.configured : true);

// pick how to start a campaign
function NewCampaign({ meta, onClose, onPick }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async (how) => { setBusy(true); await onPick(how, name.trim()); setBusy(false); };
  return (
    <Modal title="New campaign" onClose={onClose} width={720}>
      <div className="m-body nc">
        <label className="fld"><span>Name <small className="muted">· only you see this — you can change it later</small></span><input autoFocus value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Diwali sale — 30% off" /></label>
        <div className="nc-grid">{CHANNELS.map(([k, l, ic, text]) => (
          <button key={k} type="button" className={`nc-card ch-${k}`} disabled={busy} onClick={() => go(k)}>
            <span className="nc-ic"><Icon name={ic} size={20} /></span>
            <b>{l}</b><small>{text}</small>
            {!isReady(meta, k) && <em>{k === 'email' ? 'Email isn’t set up yet' : 'WhatsApp isn’t connected'} — you can still draft it</em>}
          </button>
        ))}</div>
        <div className="nc-or"><span>or start from</span></div>
        <div className="nc-alt">
          <button type="button" className="btn ghost" disabled={busy} onClick={() => go('templates')}><Icon name="layout" size={16} /> A ready template</button>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => go('ai')}><Icon name="sparkles" size={16} /> Describe it and let AI write it</button>
        </div>
      </div>
    </Modal>
  );
}

const FILTERS = [['', 'Any status'], ['draft', 'Drafts'], ['scheduled', 'Scheduled'], ['sending', 'Sending'], ['sent', 'Sent'], ['cancelled', 'Cancelled']];
const whenOf = (b) => (b.status === 'scheduled' ? when(b.scheduledAt) : ago(b.doneAt || b.startedAt || b.at));

// every WhatsApp and email campaign: totals, search, status filter and one card per campaign
function CampaignList({ d, tab, onOpen, onNew }) {
  const [q, setQ] = useState('');
  const [st, setSt] = useState('');
  const mine = d.broadcasts.filter((b) => tab === 'all' || b.channel === tab);
  const list = mine.filter((b) => (!st || b.status === st) && (!q || `${b.name} ${b.subject || ''} ${b.wa?.template || ''}`.toLowerCase().includes(q.toLowerCase())));
  const sent = mine.filter((b) => b.stats?.sent);
  const reached = sent.reduce((n, b) => n + (b.stats.sent || 0), 0);
  const mail = sent.filter((b) => b.channel === 'email');
  const mailSent = mail.reduce((n, b) => n + b.stats.sent, 0);
  const opened = mail.reduce((n, b) => n + (b.stats.opened || 0), 0), clicked = mail.reduce((n, b) => n + (b.stats.clicked || 0), 0);
  const upcoming = mine.filter((b) => b.status === 'scheduled').length, drafts = mine.filter((b) => b.status === 'draft').length;
  return (
    <>
      {(!d.email.configured || !d.whatsapp.configured) && (
        <div className="note-bar">{!d.email.configured && <span>Email isn’t set up yet.</span>}{!d.whatsapp.configured && <span>WhatsApp isn’t connected.</span>} <Link to="/settings">Connect in Settings →</Link></div>
      )}
      {!mine.length ? (
        <div className="cl-empty">
          <h3>Start your first campaign</h3>
          <p className="muted">Announce a launch, a sale or a new batch — to everyone, or just a tag, a funnel’s leads or your customers. Only contacts who opted in to marketing get them.</p>
          <div className="nc-grid">{CHANNELS.filter(([k]) => tab === 'all' || k === tab).map(([k, l, ic, text]) => (
            <button key={k} type="button" className={`nc-card ch-${k}`} onClick={() => onNew(k)}><span className="nc-ic"><Icon name={ic} size={20} /></span><b>{l}</b><small>{text}</small></button>
          ))}</div>
          <div className="nc-alt"><button className="btn ghost" onClick={() => onNew('templates')}><Icon name="layout" size={16} /> Use a template</button><button className="btn ghost" onClick={() => onNew('ai')}><Icon name="sparkles" size={16} /> Build with AI</button></div>
        </div>
      ) : (
        <>
          <div className="kpis k4 cl-kpis">
            <div className="kpi"><span className="kpi-l">Campaigns sent</span><b className="kpi-v">{num(sent.length)}</b><small>{num(drafts)} draft{drafts === 1 ? '' : 's'} · {num(upcoming)} scheduled</small></div>
            <div className="kpi"><span className="kpi-l">Messages delivered</span><b className="kpi-v">{num(reached)}</b><small>across every campaign</small></div>
            <div className="kpi"><span className="kpi-l">Email open rate</span><b className="kpi-v">{pct(opened, mailSent)}</b><small>{num(opened)} opens</small></div>
            <div className="kpi"><span className="kpi-l">Email click rate</span><b className="kpi-v">{pct(clicked, mailSent)}</b><small>{num(clicked)} clicks</small></div>
          </div>
          <div className="cl-bar">
            <div className="cl-search"><Icon name="search" size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search campaigns" aria-label="Search campaigns" /></div>
            <select value={st} onChange={(e) => setSt(e.target.value)} aria-label="Status">{FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <button className="btn primary sm" onClick={() => onNew()}><Icon name="plus" size={14} /> New campaign</button>
          </div>
          {!list.length ? <Panel><Empty icon="search" title="Nothing matches" text="Try another word or status." /></Panel> : (
            <div className="cl-list">{list.map((b) => { const s = b.stats || {}; const done = s.total ? Math.min(100, Math.round(((s.sent || 0) + (s.failed || 0)) * 100 / s.total)) : 0; return (
              <button key={b.id} type="button" className="cl-row" onClick={() => onOpen(b.id)}>
                <span className={`cl-ic ch-${b.channel}`}><Icon name={b.channel === 'whatsapp' ? 'send' : 'mail'} size={17} /></span>
                <span className="cl-main"><b>{b.name}</b><small>{b.channel === 'email' ? b.subject || 'No subject yet' : b.wa?.template || 'No template yet'}</small>
                  {b.status === 'sending' && <span className="cl-prog" aria-label={`${done}% sent`}><i style={{ width: `${done}%` }} /></span>}</span>
                <span className="cl-stat"><b>{s.total != null ? num(s.total) : '—'}</b><small>recipients</small></span>
                <span className="cl-stat"><b>{s.total != null ? num(s.sent || 0) : '—'}</b><small>{s.failed ? `${num(s.failed)} failed` : 'delivered'}</small></span>
                <span className="cl-stat"><b>{b.channel === 'email' && s.sent ? pct(s.opened || 0, s.sent) : '—'}</b><small>opened</small></span>
                <span className="cl-stat"><b>{b.channel === 'email' && s.sent ? pct(s.clicked || 0, s.sent) : '—'}</b><small>clicked</small></span>
                <span className="cl-end"><span className={`pill ${STATUS[b.status]?.[1] || ''}`}>{STATUS[b.status]?.[0] || b.status}</span><small className="muted">{whenOf(b)}</small></span>
              </button>); })}</div>
          )}
        </>
      )}
    </>
  );
}

function Editor({ b, meta, funnels, onBack, onChange, onOpen }) {
  const [v, setV] = useState(b);
  const [aud, setAud] = useState(null);
  const [busy, setBusy] = useState(false);
  const [later, setLater] = useState(b.scheduledAt ? localInput(b.scheduledAt) : '');
  const [testTo, setTestTo] = useState('');
  const [detail, setDetail] = useState(null);
  const waTpls = useWaTemplates(); // approved Hive WhatsApp templates (null: type a name)
  const locked = !['draft', 'scheduled'].includes(b.status);
  const seg = v.segment || {};
  const set = (patch) => setV({ ...v, ...patch });
  const setSeg = (patch) => set({ segment: { ...seg, ...patch } });
  const segKey = JSON.stringify([seg, v.channel]);
  useEffect(() => {
    if (locked) return undefined;
    const t = setTimeout(() => api('/broadcasts/audience', 'POST', { segment: seg, channel: v.channel }).then(setAud).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [segKey]);
  useEffect(() => { api(`/broadcasts/${b.id}`).then(setDetail).catch(() => {}); }, [b.id, b.status, b.stats?.sent]);
  const save = async (quiet) => { try { await api(`/broadcasts/${b.id}`, 'PUT', v); if (!quiet) toast('Saved'); await onChange(); return true; } catch (e) { toast(e.message); return false; } };
  const run = async (fn) => { setBusy(true); try { await fn(); } catch (e) { toast(e.message); } setBusy(false); };
  const send = (at) => run(async () => {
    if (!(await save(true))) return;
    if (!await confirmDialog(at ? { title: `Schedule for ${when(at)}?`, text: 'It goes to everyone in the audience at that time.', confirm: 'Schedule' } : { title: `Send to ${num(aud?.reach || 0)} contacts now?`, confirm: 'Send now' })) return;
    await api(`/broadcasts/${b.id}/send`, 'POST', at ? { at } : {});
    toast(at ? 'Scheduled' : 'Sending — it goes out in the background'); await onChange();
  });
  const test = () => run(async () => { if (!(await save(true))) return; await api(`/broadcasts/${b.id}/test`, 'POST', v.channel === 'whatsapp' ? { phone: testTo } : testTo ? { to: testTo } : {}); toast('Test sent'); });
  const insert = (k) => set({ body: `${v.body || ''}{{${k}}}` });
  const s = b.stats || {};
  return (
    <>
      <div className="row between bc-top">
        <button className="link-btn" onClick={onBack}>← All campaigns</button>
        <div className="row">
          <span className={`pill ${STATUS[b.status]?.[1] || ''}`}>{STATUS[b.status]?.[0]}{b.status === 'scheduled' ? ` · ${when(b.scheduledAt)}` : ''}</span>
          {b.status === 'scheduled' && <button className="btn ghost sm" disabled={busy} onClick={() => run(async () => { await api(`/broadcasts/${b.id}/cancel`, 'POST'); await onChange(); })}>Unschedule</button>}
          {b.status === 'sending' && <button className="btn ghost sm" disabled={busy} onClick={() => run(async () => { if (await confirmDialog({ title: 'Stop sending?', text: 'Messages already sent can’t be recalled.', confirm: 'Stop sending', cancel: 'Keep sending', danger: true })) { await api(`/broadcasts/${b.id}/cancel`, 'POST'); await onChange(); } })}>Stop</button>}
          <button className="btn ghost sm" onClick={() => run(async () => { await api(`/broadcasts/${b.id}/duplicate`, 'POST'); await onChange(); onBack(); toast('Copied as a new draft'); })}>Duplicate</button>
          {b.status !== 'sending' && <button className="icon-btn" title="Delete" aria-label="Delete" onClick={() => run(async () => { if (await confirmDialog({ title: 'Delete this campaign and its report?', confirm: 'Delete', danger: true })) { await api(`/broadcasts/${b.id}`, 'DELETE'); await onChange(); onBack(); } })}><Icon name="trash" size={15} /></button>}
        </div>
      </div>

      {s.total != null && b.channel === 'whatsapp' && detail?.waResults && (() => { const w = detail.waResults; return (
        <>
          <div className="kpis k4">
            <div className="kpi"><span className="kpi-l">Sent</span><b className="kpi-v">{num(w.sent)}</b><small>of {num(s.total)} recipients{s.skipped > 0 ? ` · ${num(s.skipped)} skipped` : ''}</small>{s.mm > 0 && <small className="bc-mm-note">{s.mm === s.sent ? 'All' : num(s.mm)} sent via Marketing Messages API</small>}</div>
            <div className="kpi"><span className="kpi-l">Delivered</span><b className="kpi-v">{pct(w.delivered, w.sent)}</b><small>{num(w.delivered)} people{w.notDelivered + (s.failed || 0) > 0 ? ` · ${num(w.notDelivered + (s.failed || 0))} didn’t get it` : ''}</small></div>
            <div className="kpi"><span className="kpi-l">Read</span><b className="kpi-v">{pct(w.read, w.sent)}</b><small>{num(w.read)} people</small></div>
            <div className="kpi"><span className="kpi-l">Replied</span><b className="kpi-v">{pct(w.replied, w.sent)}</b><small>{num(w.replied)} people · within 7 days</small></div>
            {detail?.sales && <div className="kpi"><span className="kpi-l">Sales it brought</span><b className="kpi-v">{inr(detail.sales.revenue)}</b><small>{num(detail.sales.orders)} order{detail.sales.orders === 1 ? '' : 's'} by {num(detail.sales.buyers)} recipient{detail.sales.buyers === 1 ? '' : 's'} · within 7 days</small></div>}
          </div>
          {w.reasons.length > 0 && <p className="muted sm">Why some didn’t get it: {w.reasons.map((r) => `${r.reason} (${num(r.count)})`).join(' · ')}</p>}
          <p className="muted sm">Delivered and read come from WhatsApp’s receipts and keep updating for a few days; people who turned read receipts off count as read once they reply.</p>
        </>
      ); })()}
      {s.total != null && !(b.channel === 'whatsapp' && detail?.waResults) && (
        <div className="kpis k4">
          <div className="kpi"><span className="kpi-l">Recipients</span><b className="kpi-v">{num(s.total)}</b>{s.skipped > 0 && <small>{num(s.skipped)} skipped</small>}</div>
          <div className="kpi"><span className="kpi-l">Delivered</span><b className="kpi-v">{num(s.sent)}</b>{s.failed > 0 && <small>{num(s.failed)} failed</small>}{s.mm > 0 && <small className="bc-mm-note">{s.mm === s.sent ? 'All' : num(s.mm)} sent via Marketing Messages API</small>}</div>
          <div className="kpi"><span className="kpi-l">Opened</span><b className="kpi-v">{b.channel === 'email' ? pct(s.opened || 0, s.sent) : '—'}</b>{b.channel === 'email' && <small>{num(s.opened || 0)} people</small>}</div>
          <div className="kpi"><span className="kpi-l">Clicked</span><b className="kpi-v">{b.channel === 'email' ? pct(s.clicked || 0, s.sent) : '—'}</b>{b.channel === 'email' && <small>{num(s.clicked || 0)} people</small>}</div>
          {detail?.sales && <div className="kpi"><span className="kpi-l">Sales it brought</span><b className="kpi-v">{inr(detail.sales.revenue)}</b><small>{num(detail.sales.orders)} order{detail.sales.orders === 1 ? '' : 's'} by {num(detail.sales.buyers)} recipient{detail.sales.buyers === 1 ? '' : 's'} · within 7 days</small></div>}
        </div>
      )}
      {locked && b.status !== 'scheduled' && (
        <div className="note-bar camp-follow"><b>Follow up:</b>{Object.entries(FOLLOW).filter(([k]) => (FOLLOW_FOR[b.channel] || ['all', 'failed']).includes(k) && (k !== 'failed' || s.failed > 0 || detail?.waResults?.notDelivered > 0)).map(([k, l]) => (
          <button key={k} className="btn ghost sm" disabled={busy} onClick={() => run(async () => { const n = await api(`/broadcasts/${b.id}/retarget`, 'POST', { who: k }); await onChange(); onOpen?.(n.id); toast(`Follow-up draft ready — ${num(n.audience?.reach || 0)} people`); })}>{l}</button>
        ))}</div>
      )}
      {detail?.followsUp && <div className="note-bar">A follow-up to <b>{detail.followsUp.name}</b> — going to people who: {detail.followsUp.who}.</div>}

      <div className="pr-cols">
        <div className="pr-main">
          <Panel title={v.channel === 'email' ? 'Email' : 'WhatsApp message'} actions={!locked && <button className="btn ghost sm" onClick={() => save()}>Save draft</button>}>
            <fieldset disabled={locked} className="plain">
              <label className="fld"><span>Name <small className="muted">· only you see this</small></span><input value={v.name} maxLength={100} onChange={(e) => set({ name: e.target.value })} /></label>
              {v.channel === 'email' ? (
                <>
                  <label className="fld"><span>Subject</span><input value={v.subject || ''} maxLength={200} onChange={(e) => set({ subject: e.target.value })} placeholder="🎉 Diwali sale — 30% off for {{first_name}}" /></label>
                  <label className="fld"><span>Message</span><textarea rows={12} value={v.body || ''} onChange={(e) => set({ body: e.target.value })} placeholder={'Hi {{first_name}},\n\n…\n\nLinks you paste are tracked automatically.'} /></label>
                  <div className="chips">{VARS.map((k) => <button key={k} type="button" onClick={() => insert(k)}>{`{{${k}}}`}</button>)}</div>
                  <p className="hint">An unsubscribe link is added to every email. Opens and link clicks are tracked per contact.</p>
                </>
              ) : (
                <>
                  <div className="form2">
                    <label className="fld"><span>Approved template name</span>{waTpls
                      ? <WaTemplateSelect list={waTpls} value={v.wa?.template || ''} onPick={(t) => set({ wa: { ...v.wa, template: t?.name || '', language: t?.language || v.wa?.language || 'en' } })} inputProps={{ value: v.wa?.template || '', onChange: (e) => set({ wa: { ...v.wa, template: e.target.value.trim().toLowerCase() } }), placeholder: 'diwali_offer' }} />
                      : <input value={v.wa?.template || ''} onChange={(e) => set({ wa: { ...v.wa, template: e.target.value.trim().toLowerCase() } })} placeholder="diwali_offer" />}</label>
                    <label className="fld"><span>Language code</span><input value={v.wa?.language || 'en'} onChange={(e) => set({ wa: { ...v.wa, language: e.target.value.trim() } })} placeholder="en / hi / en_US" /></label>
                    <label className="fld full"><span>Template variables <small className="muted">· in order, comma-separated — e.g. {'{{first_name}}'}, 30%</small></span><input value={v.wa?.params || ''} onChange={(e) => set({ wa: { ...v.wa, params: e.target.value } })} placeholder="{{first_name}}, 30%" /></label>
                  </div>
                  <WaTemplateInfo t={waTpls?.find((t) => t.name === v.wa?.template)} />
                  <p className="hint">WhatsApp only allows pre-approved <b>marketing templates</b> for broadcasts. {waTpls ? <>Create them in <Link to="/settings">Settings</Link> → Channels → WhatsApp → Your own templates (choose Marketing).</> : 'Create them in Meta Business Manager → WhatsApp Manager → Message templates.'}</p>
                </>
              )}
            </fieldset>
          </Panel>
          {detail?.failed?.length > 0 && (
            <Panel pad={false} title={`Couldn’t deliver (${detail.failed.length})`}>
              <table className="tbl compact"><tbody>{detail.failed.map((f, i) => <tr key={i}><td><b>{f.name || '—'}</b><small className="sub-t">{v.channel === 'email' ? f.email : f.phone}</small></td><td className="muted sm">{f.error}</td></tr>)}</tbody></table>
            </Panel>
          )}
        </div>
        <aside className="pr-side">
          <Panel title="Audience">
            <AudienceFields seg={seg} setSeg={setSeg} meta={meta} funnels={funnels} locked={locked} />
            {!locked && aud && (
              <div className="bc-reach">
                <b>{num(aud.reach)}</b> {v.channel === 'email' ? 'will get this email' : 'will get this on WhatsApp'}
                {/* marketing reaches only people who agreed to it: form consent, or marked opted in on the contact / at import */}
                {aud.left.notOptedIn > 0 && <small>{num(aud.reach)} opted in · <b>{num(aud.left.notOptedIn)} not opted in</b> — they won’t receive this</small>}
                {(aud.left.unsubscribed > 0 || aud.left.noAddress > 0 || aud.left.duplicate > 0) && <small>{[aud.left.unsubscribed && `${num(aud.left.unsubscribed)} unsubscribed`, aud.left.noAddress && `${num(aud.left.noAddress)} without ${v.channel === 'email' ? 'an email' : 'a phone number'}`, aud.left.duplicate && `${num(aud.left.duplicate)} sharing ${v.channel === 'email' ? 'an email' : 'a number'} with another contact (sent once)`].filter(Boolean).join(' · ')} left out</small>}
                {aud.sample?.length > 0 && <small className="muted">{aud.sample.map((c) => c.name || c.email || c.phone).join(', ')}{aud.reach > aud.sample.length ? '…' : ''}</small>}
              </div>
            )}
            {v.channel === 'email' && meta.sharedDaily && !locked && <p className="hint warn-t">You’re sending through the shared mail server: up to {num(meta.sharedDaily)} broadcast emails a day (the rest go the next day). Add your own SMTP in Settings for bigger lists.</p>}
          </Panel>
          {!locked && (
            <Panel title="Send">
              <div className="row"><input className="grow" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder={v.channel === 'email' ? 'Test to (default: your email)' : 'Your WhatsApp number'} /><button className="btn ghost sm" disabled={busy} onClick={test}>Send test</button></div>
              <button className="btn primary block" disabled={busy || !aud?.reach} onClick={() => send()}>{busy ? 'Working…' : `Send now to ${num(aud?.reach || 0)}`}</button>
              <div className="row"><input type="datetime-local" className="grow" value={later} min={localInput(Date.now())} onChange={(e) => setLater(e.target.value)} /><button className="btn ghost sm" disabled={busy || !later || !aud?.reach} onClick={() => send(new Date(later).getTime())}>Schedule</button></div>
            </Panel>
          )}
        </aside>
      </div>
    </>
  );
}

// who a campaign goes to (shared by WhatsApp, email and AI calls)
export function AudienceFields({ seg, setSeg, meta, funnels, locked }) {
  const p = meta.pipelines?.find((x) => x.id === seg.pipelineId);
  return (
    <fieldset disabled={locked} className="plain">
      <div className="seg full">{[['all', 'Everyone'], ['leads', 'Leads'], ['customers', 'Customers']].map(([k, l]) => <button type="button" key={k} className={(seg.type || 'all') === k ? 'on' : ''} onClick={() => setSeg({ type: k })}>{l}</button>)}</div>
      <label className="fld"><span>With any of these tags</span><TagPick value={seg.tags || []} options={meta.tags} onChange={(tags) => setSeg({ tags })} /></label>
      <label className="fld"><span>Without these tags</span><TagPick value={seg.notTags || []} options={meta.tags} onChange={(notTags) => setSeg({ notTags })} /></label>
      <label className="fld"><span>Came through funnel</span><select value={seg.funnelId || ''} onChange={(e) => setSeg({ funnelId: e.target.value || undefined })}><option value="">Any funnel</option>{funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
      {meta.pipelines?.length > 0 && (
        <label className="fld"><span>Pipeline stage</span><select value={seg.pipelineId ? `${seg.pipelineId}:${seg.stageId}` : ''} onChange={(e) => { const [pipelineId, stageId] = e.target.value.split(':'); setSeg({ pipelineId: pipelineId || undefined, stageId: stageId || undefined }); }}>
          <option value="">Any stage</option>{meta.pipelines.map((x) => <optgroup key={x.id} label={x.name}>{x.stages.map((st) => <option key={st.id} value={`${x.id}:${st.id}`}>{st.name}</option>)}</optgroup>)}
        </select>{p && <small className="muted">{p.name}</small>}</label>
      )}
      <div className="form2">
        <label className="fld"><span>Joined in the last</span><select value={seg.days || ''} onChange={(e) => setSeg({ days: Number(e.target.value) || undefined })}><option value="">Any time</option>{[[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '12 months']].map(([n, l]) => <option key={n} value={n}>{l}</option>)}</select></label>
        <label className="fld"><span>Spent at least ₹</span><input type="number" min="0" value={seg.minSpend || ''} onChange={(e) => setSeg({ minSpend: Number(e.target.value) || undefined })} /></label>
      </div>
    </fieldset>
  );
}

function TagPick({ value, options, onChange }) {
  const [t, setT] = useState('');
  const add = (x) => { const s = x.trim(); if (s && !value.some((v) => v.toLowerCase() === s.toLowerCase())) onChange([...value, s]); setT(''); };
  return (
    <div className="tag-pick">
      {value.map((x) => <span key={x} className="chip">{x}<button type="button" onClick={() => onChange(value.filter((y) => y !== x))}>×</button></span>)}
      <input list="bc-tags" value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(t); } }} onBlur={() => t && add(t)} placeholder={value.length ? '' : 'Type a tag…'} />
      <datalist id="bc-tags">{options.map((o) => <option key={o} value={o} />)}</datalist>
    </div>
  );
}
