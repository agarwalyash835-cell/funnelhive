// Campaigns → Templates and Build with AI: ready campaigns per industry (an email, a WhatsApp template and an
// AI-call script for each occasion), or a new one written by AI from a sentence. "Use" makes a draft on that
// channel; a WhatsApp template is sent to Meta for approval through the seller's WhatsApp connection.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Modal, Icon, toast } from '../ui';

const CH = [['email', 'Email', 'mail'], ['whatsapp', 'WhatsApp', 'send'], ['call', 'AI call', 'phone']];
// fills the seller must still type are shown as highlighted [brackets]
const Marked = ({ text }) => <>{String(text || '').split(/(\[[^\]\n]+\]|\{\{\w+\}\})/g).map((p, i) => (/^\[/.test(p) ? <mark key={i} className="ct-fill">{p}</mark> : /^\{\{/.test(p) ? <span key={i} className="ct-var">{p}</span> : p))}</>;

// make the draft; for WhatsApp, also send the template to Meta for approval
export async function useTemplate(body) {
  const r = await api('/campaign-templates/use', 'POST', body);
  if (r.channel === 'whatsapp' && r.submit) {
    try { await api('/channels/whatsapp/hive/templates/custom', 'POST', r.submit); toast('Draft ready — the WhatsApp template was sent to Meta for approval (usually minutes)'); } catch (e) {
      if (/already have a template/i.test(e.message)) toast('Draft ready — this WhatsApp template was already submitted');
      else { navigator.clipboard?.writeText(r.submit.body); toast('Draft ready — create this template in Meta WhatsApp Manager (its text is copied)'); }
    }
  } else if (r.channel === 'call') { navigator.clipboard?.writeText(r.script || ''); toast('Draft ready — the agent script is copied for your Sarvam agent'); }
  else toast('Draft ready — fill in the [highlighted] details and send');
  return r;
}

function Preview({ t, onUse, busy }) {
  const [ch, setCh] = useState('email');
  if (!t) return <div className="skeleton" />;
  return (
    <div className="ct-prev">
      <div className="ct-prev-h"><b>{t.name}</b><small className="muted">{t.goal} · {t.when}</small></div>
      <div className="seg">{CH.map(([k, l]) => <button key={k} type="button" className={ch === k ? 'on' : ''} onClick={() => setCh(k)}>{l}</button>)}</div>
      {ch === 'email' && <div className="ct-box"><p className="ct-subj">Subject: <Marked text={t.email.subject} /></p><pre className="ct-body"><Marked text={t.email.body} /></pre></div>}
      {ch === 'whatsapp' && <div className="ct-box ct-wa"><small className="muted">{t.whatsapp.category === 'UTILITY' ? 'Utility template (reminders)' : 'Marketing template'} · <code>{t.whatsapp.name}</code></small><pre className="ct-body">{t.whatsapp.body}</pre>{t.whatsapp.footer && <small className="muted">{t.whatsapp.footer}</small>}
        <ul className="ct-vars">{t.whatsapp.vars.map((v, i) => <li key={i}><code>{`{{${i + 1}}}`}</code> {v.key ? `the contact’s ${v.key.replace('_', ' ')}` : <>you type: <b>{v.fill}</b></>} <small className="muted">e.g. {v.example}</small></li>)}</ul></div>}
      {ch === 'call' && <div className="ct-box"><pre className="ct-body">{t.callScript}</pre><small className="muted">Paste this into your Sarvam agent’s instructions; the campaign fills its variables from each contact.</small></div>}
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <button type="button" className="btn primary" disabled={busy} onClick={() => onUse(ch)}><Icon name={CH.find((x) => x[0] === ch)[2]} size={15} /> Use as {CH.find((x) => x[0] === ch)[1].toLowerCase()} campaign</button>
      </div>
    </div>
  );
}

export function TemplatePicker({ onClose, onUsed }) {
  const [d, setD] = useState(null);
  const [ind, setInd] = useState('');
  const [sel, setSel] = useState(null);
  const [full, setFull] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/campaign-templates').then((x) => { setD(x); setInd(x.industry || ''); }).catch((e) => toast(e.message)); }, []);
  useEffect(() => { setFull(null); if (sel) api(`/campaign-templates/${sel}`).then(setFull).catch((e) => toast(e.message)); }, [sel]);
  const list = (d?.templates || []).filter((t) => t.industry === ind);
  const use = async (channel) => { setBusy(true); try { const r = await useTemplate({ id: sel, channel }); onUsed(r); } catch (e) { toast(e.message); } setBusy(false); };
  return (
    <Modal title="Campaign templates" onClose={onClose} width={980}>
      <div className="m-body ct">
        {!d ? <div className="skeleton" /> : (<>
          <label className="fld"><span>Industry</span><select value={ind} onChange={(e) => { setInd(e.target.value); setSel(null); }}>{d.industries.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.count})</option>)}</select></label>
          <div className="ct-cols">
            <div className="ct-list">{list.map((t) => (
              <button key={t.id} type="button" className={`ct-item ${sel === t.id ? 'on' : ''}`} onClick={() => setSel(t.id)}>
                <b>{t.name}</b><small>{t.goal}</small><small className="muted">{t.when}</small>
              </button>
            ))}</div>
            <div className="ct-side">{sel ? <Preview t={full} onUse={use} busy={busy} /> : <p className="muted">Pick an occasion to see its email, WhatsApp message and AI-call script.</p>}</div>
          </div>
        </>)}
      </div>
    </Modal>
  );
}

export function AiBuilder({ onClose, onUsed }) {
  const [brief, setBrief] = useState('');
  const [t, setT] = useState(null);
  const [busy, setBusy] = useState(false);
  const build = async (e) => { e?.preventDefault(); setBusy(true); try { setT(await api('/campaign-templates/ai', 'POST', { brief })); } catch (x) { toast(x.message); } setBusy(false); };
  const use = async (channel) => { setBusy(true); try { const r = await useTemplate({ template: t, channel }); onUsed(r); } catch (x) { toast(x.message); } setBusy(false); };
  return (
    <Modal title="Build a campaign with AI" onClose={onClose} width={t ? 860 : 560}>
      <div className="m-body">
        <form onSubmit={build}>
          <label className="fld"><span>What’s the campaign? <small className="muted">· who it’s for and what you want them to do</small></span>
            <textarea rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="e.g. Remind leads who enquired last month that our weekend batch starts on 5 May and invite them to a free demo class" autoFocus /></label>
          <div className="row" style={{ gap: 8 }}><button className="btn primary" disabled={busy || brief.trim().length < 8}>{busy && !t ? 'Writing…' : t ? 'Write again' : <><Icon name="sparkles" size={15} /> Write it</>}</button><small className="muted">Writes an email, a WhatsApp template and an AI-call script · uses 1 AI credit</small></div>
        </form>
        {t && <div style={{ marginTop: 14 }}><Preview t={t} onUse={use} busy={busy} /></div>}
      </div>
    </Modal>
  );
}
