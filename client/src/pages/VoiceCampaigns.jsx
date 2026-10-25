// Campaigns → AI calls: outbound AI calling on the seller's own Sarvam AI account. Connect it once, then pick the
// agent, who to call from the CRM, the hours (9 am–9 pm only) and retries; each call's outcome, answers and
// transcript land on the contact.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Panel, Icon, Empty, toast, num, ago, confirmDialog, promptDialog } from '../ui';
import { AudienceFields, localInput } from './Broadcasts';

const STATUS = { draft: ['Draft', ''], launching: ['Launching…', 'warn'], scheduled: ['Scheduled', 'info'], active: ['Calling', 'warn'], paused: ['Paused', ''], ended: ['Finished', 'ok'], cancelled: ['Cancelled', 'bad'] };
const RESULT = { connected: 'Talked', busy: 'Busy', no_answer: 'No answer', failed: 'Failed' };
const outcomeOf = (o = {}) => ['outcome', 'disposition', 'interest', 'interested', 'call_outcome', 'lead_status', 'status', 'result'].map((k) => o[k]).find((x) => x != null && x !== '');

export function VoiceCampaigns({ meta, funnels, newSignal }) {
  const [d, setD] = useState(null);
  const [sel, setSel] = useState(null);
  const [editConn, setEditConn] = useState(false);
  const load = () => api('/voice').then((x) => { setD(x); return x; }).catch((e) => { toast(e.message); setD(false); });
  useEffect(() => { load(); }, []);
  const create = async () => { try { const c = await api('/voice/campaigns', 'POST', { name: 'New AI calling campaign', segment: {} }); await load(); setSel(c.id); } catch (e) { toast(e.message); } };
  useEffect(() => { if (newSignal && d?.connected) create(); }, [newSignal]);
  if (d === false) return null;
  if (!d) return <div className="skeleton" />;
  if (!d.connected || editConn) return <Connect d={d} onDone={() => { setEditConn(false); load(); }} onCancel={d.connected ? () => setEditConn(false) : null} />;
  const current = d.campaigns.find((c) => c.id === sel);
  if (current) return <CallEditor key={current.id} c={current} d={d} meta={meta} funnels={funnels} onBack={() => { setSel(null); load(); }} onChange={load} />;
  return (
    <>
      <div className="note-bar"><span>📞 Sarvam AI connected · key {d.keyHint} · calls go out from <b>{d.agentNumber}</b>{d.agentsError && <> — <b className="bad-t">{d.agentsError}</b></>}</span>
        <span className="row" style={{ gap: 6 }}><button className="btn ghost sm" onClick={() => setEditConn(true)}>Change</button><button className="btn primary sm" onClick={create}><Icon name="plus" size={14} /> New AI calling campaign</button></span></div>
      <Panel pad={false}>
        {!d.campaigns.length ? <Empty icon="phone" title="No AI calling campaigns yet" text="Your Sarvam agent calls a segment of your contacts — new enquiries, demo-class no-shows, quote follow-ups — and every outcome, answer and transcript lands on the contact in your CRM.">
          <button className="btn primary" onClick={create}>Create your first AI calling campaign</button>
        </Empty> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Campaign</th><th>Status</th><th className="r">To call</th><th className="r">Calls</th><th className="r">Talked</th><th className="r">No answer / busy</th><th className="r">When</th></tr></thead>
            <tbody>{d.campaigns.map((c) => { const s = c.stats || {}; return (
              <tr key={c.id} className="click" onClick={() => setSel(c.id)}>
                <td><b>📞 {c.name}</b><small className="sub-t">{c.agentName || 'No agent picked yet'}</small></td>
                <td><span className={`pill ${STATUS[c.status]?.[1] || ''}`}>{STATUS[c.status]?.[0] || c.status}</span></td>
                <td className="r">{s.total != null ? num(s.total) : '—'}</td>
                <td className="r">{num(s.attempts || 0)}</td>
                <td className="r">{num(s.connected || 0)}</td>
                <td className="r">{num((s.noAnswer || 0) + (s.busy || 0))}</td>
                <td className="r muted">{c.launchedAt ? ago(c.launchedAt) : ago(c.at)}</td>
              </tr>); })}</tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}

function Connect({ d, onDone, onCancel }) {
  const [v, setV] = useState({ apiKey: '', orgId: d.orgId, workspaceId: d.workspaceId, connectionId: d.connectionId, agentNumber: d.agentNumber });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const save = async (e) => { e.preventDefault(); setBusy(true); try { const r = await api('/voice/connect', 'PUT', v); toast(`Connected — ${r.agents.length} calling agent${r.agents.length === 1 ? '' : 's'} found`); onDone(); } catch (x) { toast(x.message); } setBusy(false); };
  const disconnect = async () => { if (!await confirmDialog({ title: 'Disconnect Sarvam AI?', text: 'Running campaigns keep calling in Sarvam, but their results stop reaching your CRM.', confirm: 'Disconnect', danger: true })) return; await api('/voice/connect', 'DELETE'); onDone(); };
  return (
    <Panel title="Connect your Sarvam AI account" actions={onCancel && <button className="btn ghost sm" onClick={onCancel}>Cancel</button>}>
      <p className="muted sm">AI calls run on your own Sarvam AI account — your agent, your numbers, your Sarvam minutes. FunnelHive picks who to call from your CRM and brings every result back.</p>
      <ol className="ls-steps">
        <li>Create an account at <b>sarvam.ai</b> and build your calling agent (what it says, the questions it asks, the variables it uses like <code>customer_name</code>).</li>
        <li>In Sarvam → <b>Deploy → Telephony</b>, connect your phone provider (Exotel, Plivo…) and the number calls go out from. Copy the <b>connection ID</b>.</li>
        <li>Deploy the agent for outbound calls, then create an API key in Sarvam → <b>Settings → API Key</b>. Your <b>org ID</b> and <b>workspace ID</b> are in the dashboard URL.</li>
      </ol>
      <p className="note-bar warn">In India, automated calls must go out from numbers registered for them (140-series for promotional, 1600-series for service calls, via your provider and DLT). FunnelHive only calls contacts who agreed to marketing, never anyone tagged “DND”, and only between 9 am and 9 pm.</p>
      <form className="form2" onSubmit={save}>
        <label className="fld full"><span>API key {d.keyHint && <small className="muted">· saved ({d.keyHint}) — leave blank to keep it</small>}</span><input type="password" autoComplete="off" value={v.apiKey} onChange={set('apiKey')} placeholder={d.keyHint ? '••••••••' : 'sk_…'} /></label>
        <label className="fld"><span>Org ID</span><input value={v.orgId} onChange={set('orgId')} required /></label>
        <label className="fld"><span>Workspace ID</span><input value={v.workspaceId} onChange={set('workspaceId')} required /></label>
        <label className="fld"><span>Telephony connection ID</span><input value={v.connectionId} onChange={set('connectionId')} placeholder="conn-…" required /></label>
        <label className="fld"><span>Number calls go out from</span><input value={v.agentNumber} onChange={set('agentNumber')} placeholder="+91 80 4716 8000" required /></label>
        <div className="row full" style={{ gap: 8 }}><button className="btn primary" disabled={busy}>{busy ? 'Checking…' : 'Connect'}</button>{d.connected && <button type="button" className="btn ghost" onClick={disconnect}>Disconnect</button>}</div>
      </form>
    </Panel>
  );
}

function CallEditor({ c, d, meta, funnels, onBack, onChange }) {
  const [v, setV] = useState(c);
  const [detail, setDetail] = useState(null);
  const [aud, setAud] = useState(null);
  const [busy, setBusy] = useState(false);
  const draft = c.status === 'draft';
  const seg = v.segment || {};
  const sch = v.schedule || {};
  const set = (patch) => setV({ ...v, ...patch });
  const setSeg = (patch) => set({ segment: { ...seg, ...patch } });
  const setSch = (patch) => set({ schedule: { ...sch, ...patch } });
  const reload = () => api(`/voice/campaigns/${c.id}`).then(setDetail).catch(() => {});
  useEffect(() => { reload(); }, [c.id, c.status]);
  useEffect(() => { // a running campaign refreshes itself
    if (!['scheduled', 'active', 'launching'].includes(detail?.status)) return undefined;
    const t = setInterval(reload, 10000);
    return () => clearInterval(t);
  }, [detail?.status]);
  const segKey = JSON.stringify(seg);
  useEffect(() => { if (!draft) return undefined; const t = setTimeout(() => api('/voice/audience', 'POST', { segment: seg }).then(setAud).catch(() => {}), 250); return () => clearTimeout(t); }, [segKey]);
  const run = async (fn) => { setBusy(true); try { await fn(); } catch (e) { toast(e.message); } setBusy(false); };
  const save = async (quiet) => { try { await api(`/voice/campaigns/${c.id}`, 'PUT', v); if (!quiet) toast('Saved'); await onChange(); return true; } catch (e) { toast(e.message); return false; } };
  const agent = d.agents.find((a) => a.appId === v.appId);
  const pickAgent = (id) => { const a = d.agents.find((x) => x.id === id); set(a ? { deploymentId: a.id, appId: a.appId, appVersion: a.appVersion, agentName: a.name } : { deploymentId: '', appId: '', appVersion: null, agentName: '' }); };
  const launch = () => run(async () => {
    if (!(await save(true))) return;
    if (!await confirmDialog({ title: `Start calling ${num(aud?.reach || 0)} contacts?`, text: `Your Sarvam agent calls them ${sch.from}–${sch.to} on ${(sch.days || []).join(', ')}, retrying ${v.retries?.max ?? 2} time(s) when they don’t pick up. You can pause or cancel any time.`, confirm: 'Start campaign' })) return;
    await api(`/voice/campaigns/${c.id}/launch`, 'POST');
    toast('Launched — calls start at the scheduled time'); await onChange(); reload();
  });
  const act = (action, label) => run(async () => { if (action === 'cancel' && !await confirmDialog({ title: 'Cancel this campaign?', text: 'No new calls are made; calls in progress finish.', confirm: 'Cancel campaign', danger: true })) return; await api(`/voice/campaigns/${c.id}/status`, 'POST', { action }); toast(label); await onChange(); reload(); });
  const testCall = () => run(async () => { const phone = await promptDialog({ title: 'Test call', text: 'Your agent calls this number once (it isn’t counted in the campaign).', label: 'Your phone number', placeholder: '+91 98765 43210', value: '' }); if (!phone) return; await api('/voice/test-call', 'POST', { phone, appId: v.appId, appVersion: v.appVersion }); toast('Calling you now'); });
  const s = detail?.stats || c.stats || {};
  const days = d.days;
  return (
    <>
      <div className="row between bc-top">
        <button className="link-btn" onClick={onBack}>← All AI calling campaigns</button>
        <div className="row">
          <span className={`pill ${STATUS[detail?.status || c.status]?.[1] || ''}`}>{STATUS[detail?.status || c.status]?.[0]}</span>
          {['scheduled', 'active'].includes(detail?.status) && <button className="btn ghost sm" disabled={busy} onClick={() => act('pause', 'Paused')}>Pause</button>}
          {detail?.status === 'paused' && <button className="btn ghost sm" disabled={busy} onClick={() => act('resume', 'Resumed')}>Resume</button>}
          {['scheduled', 'active', 'paused'].includes(detail?.status) && <button className="btn ghost sm" disabled={busy} onClick={() => act('cancel', 'Cancelled')}>Cancel</button>}
          <button className="btn ghost sm" onClick={() => run(async () => { await api(`/voice/campaigns/${c.id}/duplicate`, 'POST'); await onChange(); onBack(); toast('Copied as a new draft'); })}>Duplicate</button>
          {!['scheduled', 'active', 'paused', 'launching'].includes(detail?.status || c.status) && <button className="icon-btn" title="Delete" aria-label="Delete" onClick={() => run(async () => { if (await confirmDialog({ title: 'Delete this campaign and its call log?', confirm: 'Delete', danger: true })) { await api(`/voice/campaigns/${c.id}`, 'DELETE'); onBack(); } })}><Icon name="trash" size={15} /></button>}
        </div>
      </div>
      {c.error && draft && <p className="note-bar warn">The last launch didn’t go through: {c.error}</p>}
      {s.total != null && (
        <div className="kpis k4">
          <div className="kpi"><span className="kpi-l">To call</span><b className="kpi-v">{num(s.total)}</b>{s.rejected > 0 && <small>{num(s.rejected)} numbers rejected by Sarvam</small>}</div>
          <div className="kpi"><span className="kpi-l">Calls made</span><b className="kpi-v">{num(s.attempts || 0)}</b><small>retries included</small></div>
          <div className="kpi"><span className="kpi-l">Talked</span><b className="kpi-v">{num(s.connected || 0)}</b></div>
          <div className="kpi"><span className="kpi-l">No answer · busy · failed</span><b className="kpi-v">{num(s.noAnswer || 0)} · {num(s.busy || 0)} · {num(s.failed || 0)}</b></div>
        </div>
      )}
      <div className="pr-cols">
        <div className="pr-main">
          <Panel title="Agent and script" actions={draft && <button className="btn ghost sm" onClick={() => save()}>Save draft</button>}>
            <fieldset disabled={!draft} className="plain">
              <label className="fld"><span>Name <small className="muted">· only you see this</small></span><input value={v.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} /></label>
              <label className="fld"><span>Sarvam agent that makes the calls</span><select value={agent?.id || ''} onChange={(e) => pickAgent(e.target.value)}><option value="">Pick an agent…</option>{d.agents.map((a) => <option key={a.id} value={a.id}>{a.name} (v{a.appVersion}){a.status === 'paused' ? ' — paused' : ''}</option>)}</select>
                {!d.agents.length && <small className="muted">No outbound agents found — deploy one for outbound calls in Sarvam first.</small>}</label>
              <div className="fld"><span>Fill the agent’s variables from each contact <small className="muted">· names must match the variables in your Sarvam agent</small></span>
                {(v.vars || []).map((x, i) => (
                  <div className="row" key={i} style={{ gap: 6, marginBottom: 6 }}>
                    <input value={x.agent} onChange={(e) => set({ vars: v.vars.map((y, j) => (j === i ? { ...y, agent: e.target.value.replace(/[^\w]/g, '') } : y)) })} placeholder="customer_name" style={{ flex: 1 }} />
                    <span className="muted">←</span>
                    <select value={x.field} onChange={(e) => set({ vars: v.vars.map((y, j) => (j === i ? { ...y, field: e.target.value } : y)) })}>{Object.entries(d.fields).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                    <button type="button" className="icon-btn" aria-label="Remove" onClick={() => set({ vars: v.vars.filter((_, j) => j !== i) })}><Icon name="x" size={14} /></button>
                  </div>
                ))}
                <button type="button" className="btn ghost sm" onClick={() => set({ vars: [...(v.vars || []), { agent: '', field: 'first_name' }] })}><Icon name="plus" size={14} /> Add a variable</button>
              </div>
              {v.appId && <button type="button" className="btn ghost sm" disabled={busy} onClick={testCall}><Icon name="phone" size={14} /> Test call to my phone</button>}
            </fieldset>
          </Panel>
          {detail?.calls?.length > 0 && (
            <Panel pad={false} title={`Calls (${num(detail.calls.length)}${detail.calls.length >= 100 ? '+' : ''})`}>
              <table className="tbl compact"><tbody>{detail.calls.map((x) => (
                <tr key={x.id}><td><b>{x.name || x.phone}</b><small className="sub-t">{x.phone}{x.retry ? ` · retry ${x.retry}` : ''}</small></td>
                  <td>{RESULT[x.connectivity] || x.connectivity || '—'}{x.duration ? ` · ${Math.round(x.duration)}s` : ''}{outcomeOf(x.outputs) && <span className="pill ok" style={{ marginLeft: 6 }}>{String(outcomeOf(x.outputs))}</span>}</td>
                  <td className="muted sm">{x.transcript ? <details><summary>Transcript</summary><pre className="vc-tr">{x.transcript}</pre></details> : '—'}</td>
                  <td className="r muted">{ago(x.at)}</td></tr>
              ))}</tbody></table>
            </Panel>
          )}
        </div>
        <aside className="pr-side">
          <Panel title="Who to call">
            <AudienceFields seg={seg} setSeg={setSeg} meta={meta} funnels={funnels} locked={!draft} />
            {draft && aud && (
              <div className="bc-reach"><b>{num(aud.reach)}</b> will be called
                {(aud.left.notOptedIn > 0 || aud.left.unsubscribed > 0 || aud.left.noAddress > 0 || aud.left.dnd > 0) && <small>{[aud.left.notOptedIn && `${num(aud.left.notOptedIn)} not opted in`, aud.left.unsubscribed && `${num(aud.left.unsubscribed)} unsubscribed`, aud.left.dnd && `${num(aud.left.dnd)} tagged DND`, aud.left.noAddress && `${num(aud.left.noAddress)} without a phone`].filter(Boolean).join(' · ')} left out</small>}
              </div>
            )}
          </Panel>
          <Panel title="When">
            <fieldset disabled={!draft} className="plain">
              <label className="fld"><span>Start</span><input type="datetime-local" value={sch.startAt ? localInput(sch.startAt) : ''} min={localInput(Date.now())} onChange={(e) => setSch({ startAt: e.target.value ? new Date(e.target.value).getTime() : null })} /><small className="muted">Blank = right away</small></label>
              <label className="fld"><span>Stop by</span><input type="datetime-local" value={sch.endAt ? localInput(sch.endAt) : ''} onChange={(e) => setSch({ endAt: e.target.value ? new Date(e.target.value).getTime() : null })} /><small className="muted">Blank = 1 hour after the start (add more for big lists)</small></label>
              <div className="form2">
                <label className="fld"><span>Call from</span><input type="time" min="09:00" max="21:00" value={sch.from || '10:00'} onChange={(e) => setSch({ from: e.target.value })} /></label>
                <label className="fld"><span>Until</span><input type="time" min="09:00" max="21:00" value={sch.to || '19:00'} onChange={(e) => setSch({ to: e.target.value })} /></label>
              </div>
              <div className="chips">{days.map((dd) => { const on = (sch.days || days.slice(0, 6)).includes(dd); return <button type="button" key={dd} className={on ? 'on' : ''} onClick={() => { const cur = sch.days || days.slice(0, 6); setSch({ days: on ? cur.filter((x) => x !== dd) : days.filter((x) => cur.includes(x) || x === dd) }); }}>{dd.slice(0, 3)}</button>; })}</div>
              <small className="muted">India time · calls only go out between 9 am and 9 pm</small>
              <div className="form2" style={{ marginTop: 10 }}>
                <label className="fld"><span>Retries if no answer / busy</span><select value={v.retries?.max ?? 2} onChange={(e) => set({ retries: { ...v.retries, max: Number(e.target.value) } })}>{[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
                <label className="fld"><span>Wait between tries</span><select value={v.retries?.interval ?? 60} onChange={(e) => set({ retries: { ...v.retries, interval: Number(e.target.value) } })}>{[[30, '30 minutes'], [60, '1 hour'], [180, '3 hours'], [1440, 'Next day']].map(([n, l]) => <option key={n} value={n}>{l}</option>)}</select></label>
              </div>
              <label className="fld"><span>New calls per second</span><select value={v.cps ?? 1} onChange={(e) => set({ cps: Number(e.target.value) })}>{[0.2, 0.5, 1, 2, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            </fieldset>
          </Panel>
          {draft && (
            <Panel title="Start">
              <label className="tog"><input type="checkbox" checked={!!v.consent} onChange={(e) => set({ consent: e.target.checked })} /><span />These contacts agreed to be called, and my numbers are registered for automated calls</label>
              <button className="btn primary block" disabled={busy || !aud?.reach || !v.appId} onClick={launch}>{busy ? 'Working…' : `Start calling ${num(aud?.reach || 0)}`}</button>
            </Panel>
          )}
        </aside>
      </div>
    </>
  );
}
