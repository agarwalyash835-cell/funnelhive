import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Layout, Panel, Icon, Empty, toast, num, ago, useWaTemplates, WaTemplateSelect, WaTemplateInfo } from '../ui';

const STATUS = { draft: ['Draft', ''], scheduled: ['Scheduled', 'info'], sending: ['Sending…', 'warn'], sent: ['Sent', 'ok'], cancelled: ['Cancelled', 'bad'] };
const VARS = ['first_name', 'name', 'email', 'phone', 'business'];
const when = (t) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const localInput = (t) => new Date(t - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export default function Broadcasts() {
  const [d, setD] = useState(null);
  const [sel, setSel] = useState(null);
  const [funnels, setFunnels] = useState([]);
  const load = () => api('/broadcasts').then((x) => { setD(x); return x; });
  useEffect(() => { load(); api('/funnels').then((l) => setFunnels(Array.isArray(l) ? l : l.funnels || [])).catch(() => {}); }, []);
  // a broadcast that's going out refreshes itself
  useEffect(() => {
    if (!d?.broadcasts.some((b) => b.status === 'sending' || (b.status === 'scheduled' && b.scheduledAt < Date.now() + 60000))) return undefined;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [d]);
  const create = async (channel) => {
    try { const b = await api('/broadcasts', 'POST', { channel, name: channel === 'email' ? 'New email broadcast' : 'New WhatsApp broadcast', segment: {} }); await load(); setSel(b.id); } catch (e) { toast(e.message); }
  };
  const current = d?.broadcasts.find((b) => b.id === sel);
  return (
    <Layout title="Broadcasts" subtitle="Send one email or WhatsApp message to a segment of your contacts — now or at a time you pick." actions={<>
      <button className="btn ghost" onClick={() => create('whatsapp')}><Icon name="send" size={16} /> WhatsApp</button>
      <button className="btn primary" onClick={() => create('email')}><Icon name="mail" size={16} /> New email</button>
    </>}>
      {!d ? <div className="skeleton" /> : current ? (
        <Editor key={current.id} b={current} meta={d} funnels={funnels} onBack={() => setSel(null)} onChange={load} />
      ) : (
        <>
          {(!d.email.configured || !d.whatsapp.configured) && (
            <div className="note-bar">{!d.email.configured && <span>✉️ Email isn’t set up yet.</span>}{!d.whatsapp.configured && <span>💬 WhatsApp isn’t connected.</span>} <Link to="/settings">Connect in Settings →</Link></div>
          )}
          <Panel pad={false}>
            {!d.broadcasts.length ? <Empty icon="mail" title="No broadcasts yet" text="Announce a launch, a sale or a new batch to everyone — or just to a tag, a funnel’s leads or your customers. Only contacts who opted in to marketing get them; unsubscribed ones never do.">
              <button className="btn primary" onClick={() => create('email')}>Write your first broadcast</button>
            </Empty> : (
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Broadcast</th><th>Status</th><th className="r">Recipients</th><th className="r">Delivered</th><th className="r">Opened</th><th className="r">Clicked</th><th className="r">When</th></tr></thead>
                <tbody>{d.broadcasts.map((b) => { const s = b.stats || {}; return (
                  <tr key={b.id} className="click" onClick={() => setSel(b.id)}>
                    <td><b>{b.channel === 'whatsapp' ? '💬 ' : '✉️ '}{b.name}</b><small className="sub-t">{b.channel === 'email' ? b.subject || 'No subject yet' : b.wa?.template || 'No template yet'}</small></td>
                    <td><span className={`pill ${STATUS[b.status]?.[1] || ''}`}>{STATUS[b.status]?.[0] || b.status}</span></td>
                    <td className="r">{s.total != null ? num(s.total) : '—'}</td>
                    <td className="r">{s.total != null ? `${num(s.sent)}${s.failed ? ` · ${num(s.failed)} failed` : ''}` : '—'}</td>
                    <td className="r">{b.channel === 'email' && s.sent ? pct(s.opened || 0, s.sent) : '—'}</td>
                    <td className="r">{b.channel === 'email' && s.sent ? pct(s.clicked || 0, s.sent) : '—'}</td>
                    <td className="r muted">{b.status === 'scheduled' ? when(b.scheduledAt) : b.doneAt ? ago(b.doneAt) : b.startedAt ? ago(b.startedAt) : ago(b.at)}</td>
                  </tr>); })}</tbody>
              </table></div>
            )}
          </Panel>
        </>
      )}
    </Layout>
  );
}

function Editor({ b, meta, funnels, onBack, onChange }) {
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
    if (!confirm(at ? `Schedule for ${when(at)}? It goes to everyone in the audience at that time.` : `Send to ${num(aud?.reach || 0)} contacts now?`)) return;
    await api(`/broadcasts/${b.id}/send`, 'POST', at ? { at } : {});
    toast(at ? 'Scheduled' : 'Sending — it goes out in the background'); await onChange();
  });
  const test = () => run(async () => { if (!(await save(true))) return; await api(`/broadcasts/${b.id}/test`, 'POST', v.channel === 'whatsapp' ? { phone: testTo } : testTo ? { to: testTo } : {}); toast('Test sent'); });
  const insert = (k) => set({ body: `${v.body || ''}{{${k}}}` });
  const s = b.stats || {};
  const p = meta.pipelines?.find((x) => x.id === seg.pipelineId);
  return (
    <>
      <div className="row between bc-top">
        <button className="link-btn" onClick={onBack}>← All broadcasts</button>
        <div className="row">
          <span className={`pill ${STATUS[b.status]?.[1] || ''}`}>{STATUS[b.status]?.[0]}{b.status === 'scheduled' ? ` · ${when(b.scheduledAt)}` : ''}</span>
          {b.status === 'scheduled' && <button className="btn ghost sm" disabled={busy} onClick={() => run(async () => { await api(`/broadcasts/${b.id}/cancel`, 'POST'); await onChange(); })}>Unschedule</button>}
          {b.status === 'sending' && <button className="btn ghost sm" disabled={busy} onClick={() => run(async () => { if (confirm('Stop sending? Messages already sent can’t be recalled.')) { await api(`/broadcasts/${b.id}/cancel`, 'POST'); await onChange(); } })}>Stop</button>}
          <button className="btn ghost sm" onClick={() => run(async () => { await api(`/broadcasts/${b.id}/duplicate`, 'POST'); await onChange(); onBack(); toast('Copied as a new draft'); })}>Duplicate</button>
          {b.status !== 'sending' && <button className="icon-btn" title="Delete" onClick={() => run(async () => { if (confirm('Delete this broadcast and its report?')) { await api(`/broadcasts/${b.id}`, 'DELETE'); await onChange(); onBack(); } })}><Icon name="trash" size={15} /></button>}
        </div>
      </div>

      {s.total != null && (
        <div className="kpis k4">
          <div className="kpi"><span className="kpi-l">Recipients</span><b className="kpi-v">{num(s.total)}</b>{s.skipped > 0 && <small>{num(s.skipped)} skipped</small>}</div>
          <div className="kpi"><span className="kpi-l">Delivered</span><b className="kpi-v">{num(s.sent)}</b>{s.failed > 0 && <small>{num(s.failed)} failed</small>}</div>
          <div className="kpi"><span className="kpi-l">Opened</span><b className="kpi-v">{b.channel === 'email' ? pct(s.opened || 0, s.sent) : '—'}</b>{b.channel === 'email' && <small>{num(s.opened || 0)} people</small>}</div>
          <div className="kpi"><span className="kpi-l">Clicked</span><b className="kpi-v">{b.channel === 'email' ? pct(s.clicked || 0, s.sent) : '—'}</b>{b.channel === 'email' && <small>{num(s.clicked || 0)} people</small>}</div>
        </div>
      )}

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
            {!locked && aud && (
              <div className="bc-reach">
                <b>{num(aud.reach)}</b> {v.channel === 'email' ? 'will get this email' : 'will get this on WhatsApp'}
                {/* marketing reaches only people who agreed to it: form consent, or marked opted in on the contact / at import */}
                {aud.left.notOptedIn > 0 && <small>{num(aud.reach)} opted in · <b>{num(aud.left.notOptedIn)} not opted in</b> — they won’t receive this</small>}
                {(aud.left.unsubscribed > 0 || aud.left.noAddress > 0) && <small>{[aud.left.unsubscribed && `${num(aud.left.unsubscribed)} unsubscribed`, aud.left.noAddress && `${num(aud.left.noAddress)} without ${v.channel === 'email' ? 'an email' : 'a phone number'}`].filter(Boolean).join(' · ')} left out</small>}
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
