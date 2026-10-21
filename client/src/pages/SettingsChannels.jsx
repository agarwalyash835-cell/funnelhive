// Settings: email sending (SMTP), WhatsApp Business API, custom domains
import { Fragment, useEffect, useRef, useState } from 'react';
import { Copy, RefreshCw, Trash2, Plus, ExternalLink } from 'lucide-react';
import { api } from '../api';
import { Panel, toast, confirmDialog, loadFailed } from '../ui';

const SMTP_PRESETS = [
  ['custom', 'Other / custom', '', 465],
  ['gmail', 'Gmail / Google Workspace', 'smtp.gmail.com', 465, 'Use an App Password (Google Account → Security → App passwords), not your normal password.'],
  ['zoho', 'Zoho Mail (India)', 'smtp.zoho.in', 465, 'Use your Zoho email and an app-specific password.'],
  ['hostinger', 'Hostinger email', 'smtp.hostinger.com', 465],
  ['brevo', 'Brevo (Sendinblue)', 'smtp-relay.brevo.com', 587, 'Username is your Brevo login; password is an SMTP key from Brevo → SMTP & API.'],
  ['ses', 'Amazon SES (Mumbai)', 'email-smtp.ap-south-1.amazonaws.com', 587, 'Use SES SMTP credentials, and a verified “from” address.'],
  ['sendgrid', 'SendGrid', 'smtp.sendgrid.net', 587, 'Username is literally “apikey”; password is your SendGrid API key.'],
];
const copy = (t) => { navigator.clipboard?.writeText(t); toast('Copied'); };

export function EmailPanel({ me }) {
  const [ch, setCh] = useState(null);
  const [v, setV] = useState(null);
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => { api('/channels').then((c) => { setCh(c); setV({ ...c.email, pass: '' }); }).catch(loadFailed); }, []);
  useEffect(() => { if (me?.email) setTestTo((t) => t || me.email); }, [me]);
  if (!v) return <Panel title="Email sending"><div className="skeleton sm" /></Panel>;
  const preset = SMTP_PRESETS.find((p) => p[2] === v.host) || SMTP_PRESETS[0];
  const set = (k, val) => setV((x) => ({ ...x, [k]: val }));
  const save = async () => {
    setBusy('save');
    try { const c = await api('/channels/email', 'PUT', v); setCh(c); setV({ ...c.email, pass: '' }); toast('Email settings saved'); } catch (e) { toast(e.message); }
    setBusy('');
  };
  const test = async () => { setBusy('test'); try { const r = await api('/channels/email/test', 'POST', { to: testTo }); toast(`Test email sent to ${r.to} — check your inbox (and spam)`); } catch (e) { toast(e.message); } setBusy(''); };
  const clear = async () => { if (!await confirmDialog({ title: 'Remove your SMTP settings?', confirm: 'Remove', danger: true })) return; const c = await api('/channels/email', 'PUT', { clear: true }); setCh(c); setV({ ...c.email, pass: '' }); };
  return (
    <Panel title="Email sending (SMTP)" actions={<span className={`pill ${ch.email.configured ? 'ok' : 'warn'}`}>{ch.email.configured ? `Connected · ${ch.email.via}` : 'Not set up'}</span>}>
      <p className="muted sm">Emails to your contacts — automations, cart reminders, one-to-one emails — are sent from your own mailbox or email service.</p>
      <label className="full">Provider<select value={preset[0]} onChange={(e) => { const p = SMTP_PRESETS.find((x) => x[0] === e.target.value); setV((x) => ({ ...x, host: p[2] || x.host, port: p[3], secure: p[3] === 465 })); }}>{SMTP_PRESETS.map((p) => <option key={p[0]} value={p[0]}>{p[1]}</option>)}</select></label>
      {preset[4] && <p className="hint">{preset[4]}</p>}
      <div className="form2">
        <label>SMTP server<input value={v.host} onChange={(e) => set('host', e.target.value)} placeholder="smtp.yourprovider.com" /></label>
        <label>Port<select value={v.port} onChange={(e) => { const port = Number(e.target.value); setV((x) => ({ ...x, port, secure: port === 465 })); }}><option value={465}>465 (SSL)</option><option value={587}>587 (STARTTLS)</option><option value={25}>25</option><option value={2525}>2525</option></select></label>
        <label>Username<input value={v.user} onChange={(e) => set('user', e.target.value)} placeholder="you@yourbrand.in" autoComplete="off" /></label>
        <label>Password {ch.email.hasPassword && <small className="muted">· saved — leave empty to keep it</small>}<input type="password" value={v.pass} onChange={(e) => set('pass', e.target.value)} placeholder={ch.email.hasPassword ? '••••••••' : 'SMTP / app password'} autoComplete="new-password" /></label>
        <label>From name<input value={v.fromName} onChange={(e) => set('fromName', e.target.value)} placeholder="Sharma Yoga Studio" /></label>
        <label>From email<input value={v.fromEmail} onChange={(e) => set('fromEmail', e.target.value)} placeholder="hello@yourbrand.in" /></label>
        <label>Reply-to <small className="muted">· optional</small><input value={v.replyTo} onChange={(e) => set('replyTo', e.target.value)} placeholder="support@yourbrand.in" /></label>
      </div>
      <div className="row"><button className="btn primary" disabled={busy || !v.host} onClick={save}>Save email settings</button>{ch.email.via === 'your SMTP' && <button className="btn ghost danger" onClick={clear}>Remove</button>}</div>
      <div className="row test-row"><input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Send a test to…" /><button className="btn ghost" disabled={busy || !ch.email.configured} onClick={test}>{busy === 'test' ? 'Sending…' : 'Send test email'}</button></div>
      <p className="hint">Passwords are encrypted and never shown again. For best delivery, use a “from” address on your own domain with SPF/DKIM set up at your provider.</p>
    </Panel>
  );
}

export function WhatsAppPanel() {
  const [ch, setCh] = useState(null);
  const [tab, setTab] = useState(null);
  const reload = () => api('/channels').then((c) => { setCh(c); setTab((t) => t || (c.whatsapp.provider === 'hive' || !c.whatsapp.configured ? 'hive' : 'meta')); });
  useEffect(() => { reload(); }, []);
  if (!ch) return <Panel title="WhatsApp"><div className="skeleton sm" /></Panel>;
  const using = ch.whatsapp.provider === 'hive' ? 'Hive WhatsApp' : 'Meta direct';
  return (
    <Panel title="WhatsApp" actions={<span className={`pill ${ch.whatsapp.configured ? 'ok' : 'warn'}`}>{ch.whatsapp.configured ? `Connected · ${using}` : 'Not connected'}</span>}>
      <div className="seg" role="tablist" style={{ marginBottom: 10 }}>
        <button type="button" role="tab" className={tab === 'hive' ? 'on' : ''} onClick={() => setTab('hive')}>WhatsApp (Hive)</button>
        <button type="button" role="tab" className={tab === 'meta' ? 'on' : ''} onClick={() => setTab('meta')}>Meta direct (Cloud API)</button>
      </div>
      {tab === 'hive' ? <HiveWhatsApp onChange={reload} /> : <MetaWhatsApp ch={ch} setCh={setCh} />}
    </Panel>
  );
}

function MetaWhatsApp({ ch, setCh }) {
  const [v, setV] = useState({ phoneNumberId: ch.whatsapp.phoneNumberId, businessId: ch.whatsapp.businessId, token: '' });
  const [to, setTo] = useState('');
  const [tpl, setTpl] = useState('hello_world');
  const [busy, setBusy] = useState('');
  const metaOn = !!(ch.whatsapp.phoneNumberId && ch.whatsapp.hasToken);
  const save = async () => { setBusy('save'); try { const c = await api('/channels/whatsapp', 'PUT', v); setCh(c); setV((x) => ({ ...x, token: '' })); toast('WhatsApp connected'); } catch (e) { toast(e.message); } setBusy(''); };
  const test = async () => { setBusy('test'); try { await api('/channels/whatsapp/test', 'POST', { to, template: tpl, language: tpl === 'hello_world' ? 'en_US' : 'en' }); toast('Test message sent'); } catch (e) { toast(e.message); } setBusy(''); };
  const clear = async () => { if (!await confirmDialog({ title: 'Disconnect WhatsApp?', confirm: 'Disconnect', danger: true })) return; const c = await api('/channels/whatsapp', 'PUT', { clear: true }); setCh(c); setV({ phoneNumberId: '', businessId: '', token: '' }); };
  const useMeta = async () => { try { await api('/channels/whatsapp/hive', 'PUT', { provider: 'meta' }); setCh(await api('/channels')); toast('WhatsApp now sends through Meta directly'); } catch (e) { toast(e.message); } };
  return (
    <>
      <p className="muted sm">Send WhatsApp messages from automations and the contact screen through Meta’s official WhatsApp Cloud API. Until it’s connected, the WhatsApp button opens WhatsApp on your phone instead.</p>
      {ch.whatsapp.provider === 'hive' && <p className="hint warn">Messages go through Hive WhatsApp right now. {metaOn && <button className="link-btn" onClick={useMeta}>Send through Meta directly instead</button>}</p>}
      <div className="form2">
        <label>Phone number ID<input value={v.phoneNumberId} onChange={(e) => setV({ ...v, phoneNumberId: e.target.value.trim() })} placeholder="e.g. 106540352242922" /></label>
        <label>WhatsApp Business account ID <small className="muted">· optional</small><input value={v.businessId} onChange={(e) => setV({ ...v, businessId: e.target.value.trim() })} placeholder="e.g. 102290129340398" /></label>
        <label className="full">Permanent access token {ch.whatsapp.hasToken && <small className="muted">· saved — leave empty to keep it</small>}<input type="password" value={v.token} onChange={(e) => setV({ ...v, token: e.target.value })} placeholder={ch.whatsapp.hasToken ? '••••••••' : 'EAAG…'} autoComplete="new-password" /></label>
      </div>
      <div className="row"><button className="btn primary" disabled={busy || !v.phoneNumberId} onClick={save}>Save WhatsApp</button>{metaOn && <button className="btn ghost danger" onClick={clear}>Disconnect</button>}
        <a className="btn ghost" href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" target="_blank" rel="noreferrer"><ExternalLink size={14} /> Setup guide</a></div>
      <div className="row test-row"><input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Your WhatsApp number" /><input value={tpl} onChange={(e) => setTpl(e.target.value)} placeholder="template name" style={{ maxWidth: 160 }} /><button className="btn ghost" disabled={busy || !ch.whatsapp.configured || !to} onClick={test}>{busy === 'test' ? 'Sending…' : 'Send test'}</button></div>
      <p className="hint">Find these in Meta Business → WhatsApp Manager → API setup. Business-initiated messages must use a template approved by Meta (“hello_world” works for testing). The token is encrypted and never shown again.</p>
    </>
  );
}

// Hive WhatsApp: the owner's own WhatsApp API — key, number, webhook, ready-made templates, what gets sent
const TPL_PILL = { APPROVED: ['ok', 'Approved'], PENDING: ['warn', 'In review'], IN_APPEAL: ['warn', 'In appeal'], REJECTED: ['bad', 'Rejected'], PAUSED: ['bad', 'Paused'], DISABLED: ['bad', 'Disabled'], ERROR: ['bad', 'Not submitted'] };
const QUALITY = { GREEN: ['ok', 'High'], YELLOW: ['warn', 'Medium'], RED: ['bad', 'Low'] };
const when = (t) => (t ? new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
const IN = ['PENDING', 'APPROVED', 'IN_APPEAL']; // submitted: nothing more to do
// the toast after "Create my message templates": what really happened to each one
const setupSummary = (r) => {
  const res = Object.values(r.result || {}), c = (...s) => res.filter((x) => s.includes(x)).length;
  const failed = r.templates.filter((t) => r.result?.[t.event] === 'ERROR');
  return [c('SUBMITTED') && `${c('SUBMITTED')} submitted`, c('APPROVED') && `${c('APPROVED')} already approved`, c('PENDING', 'IN_APPEAL', 'EXISTS') && `${c('PENDING', 'IN_APPEAL', 'EXISTS')} already in review`,
    failed.length && `${failed.length} not accepted${failed[0].reason ? `: ${failed[0].reason}` : ''}`].filter(Boolean).join(' · ') || 'Nothing to submit';
};
function HiveWhatsApp({ onChange }) {
  const [h, setH] = useState(null);
  const [key, setKey] = useState('');
  const [numbers, setNumbers] = useState(null);
  const [mine, setMine] = useState('');
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState(''); // the template whose wording is shown
  const load = (x) => { setH(x); setMine(x.notifyPhone ? `+${x.notifyPhone}` : ''); };
  useEffect(() => { api('/channels/whatsapp/hive').then(load).catch(() => {}); }, []);
  useEffect(() => { if (h?.hasKey) api('/channels/whatsapp/hive/numbers').then((r) => setNumbers(r.numbers)).catch(() => setNumbers([])); }, [h?.hasKey, h?.keyPrefix]);
  if (!h) return <div className="skeleton sm" />;
  const run = async (name, fn, ok) => {
    setBusy(name);
    try { const r = await fn(); if (r?.templates) { load(r); onChange?.(); } if (ok) toast(typeof ok === 'function' ? ok(r) : ok); } catch (e) { toast(e.message); }
    setBusy('');
  };
  const save = (body, ok, name = 'save') => run(name, () => api('/channels/whatsapp/hive', 'PUT', body), ok);
  const saveKey = () => run('key', async () => { const r = await api('/channels/whatsapp/hive', 'PUT', { apiKey: key.trim() }); setKey(''); return r; }, 'Key verified and saved');
  const clear = async () => { if (await confirmDialog({ title: 'Disconnect Hive WhatsApp?', text: 'Messages stop going out through it.', confirm: 'Disconnect', danger: true })) save({ clear: true }, 'Hive WhatsApp disconnected'); };
  const approved = h.templates.filter((t) => t.status === 'APPROVED').length;
  const toSubmit = h.templates.filter((t) => !t.status || ['ERROR', 'REJECTED'].includes(t.status)).length;
  const allIn = h.templates.every((t) => IN.includes(t.status));
  const q = QUALITY[String(h.quality?.rating || '').toUpperCase()];
  return (
    <div className="hive-wa">
      <p className="muted sm">Your own WhatsApp number through the Hive WhatsApp API — it also works with a number you keep using in the WhatsApp Business app. Buyers get their receipt, booking, access and shipping messages on WhatsApp; their replies show up on the contact’s timeline.</p>
      {h.hasKey && h.provider !== 'hive' && <p className="hint warn">WhatsApp messages currently go through Meta directly. <button className="link-btn" onClick={() => save({ provider: 'hive' }, 'WhatsApp now sends through Hive')}>Send through Hive instead</button></p>}

      <div className="form2">
        <label className="full">API key {h.hasKey && <small className="muted">· saved ({h.keyPrefix}…{h.mode === 'test' ? ', test key' : ''}) — leave empty to keep it</small>}
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={h.hasKey ? '••••••••' : 'hk_live_…'} autoComplete="new-password" /></label>
      </div>
      <div className="row"><button className="btn primary" disabled={!!busy || !key.trim()} onClick={saveKey}>{busy === 'key' ? 'Checking with Hive…' : 'Save & verify key'}</button>{h.hasKey && <button className="btn ghost danger" onClick={clear}>Disconnect</button>}</div>

      {h.hasKey && <>
        <div className="form2">
          <label>WhatsApp number
            <select value={h.from} onChange={(e) => save({ from: e.target.value }, 'Number saved')} disabled={!numbers}>
              <option value="">{numbers ? (numbers.length ? 'Choose your number…' : 'No numbers connected in Hive') : 'Loading…'}</option>
              {(numbers || []).map((n) => <option key={n.id} value={n.phone_number_id || n.display || n.id}>{n.display}{n.quality ? ` · quality ${n.quality}` : ''}</option>)}
              {h.from && numbers && !numbers.some((n) => [n.id, n.display, n.phone_number_id].includes(h.from)) && <option value={h.from}>{h.fromLabel || h.from}</option>}
            </select></label>
          <label>Your own WhatsApp <small className="muted">· for new order &amp; booking alerts</small>
            <div className="row"><input type="tel" value={mine} onChange={(e) => setMine(e.target.value)} placeholder="+91 98765 43210" /><button className="btn ghost" disabled={!!busy} onClick={() => save({ notifyPhone: mine }, mine ? 'Alerts will come to this number' : 'Alerts turned off')}>Save</button></div></label>
        </div>
        {h.quality && <p className="muted sm">Number quality: <span className={`pill ${q?.[0] || 'info'}`}>{q?.[1] || h.quality.rating}</span>{h.quality.limit && <> · messaging limit {h.quality.limit}</>}{h.quality.at && <> · updated {when(h.quality.at)}</>}</p>}

        <div className="rzp-hook">
          <b>Replies, opt-outs and delivery updates</b> {h.webhook ? <span className="pill ok">Connected{h.webhook.lastEventAt ? ` · last event ${when(h.webhook.lastEventAt)}` : ''}</span> : <span className="pill warn">Not connected</span>}
          <p className="hint">One click: FunnelHive tells Hive where to send WhatsApp events, with a private signing key — nothing to copy. Old chats from the WhatsApp app aren’t imported.</p>
          <div className="row"><button className="btn ghost" disabled={!!busy || !h.from} onClick={() => run('hook', () => api('/channels/whatsapp/hive/webhook', 'POST'), 'Webhook connected')}>{busy === 'hook' ? 'Connecting…' : h.webhook ? 'Reconnect webhook' : 'Connect webhook'}</button>
            {h.webhook && <button className="btn ghost" disabled={!!busy} onClick={() => run('hooktest', () => api('/channels/whatsapp/hive/webhook/test', 'POST'), 'Test event sent — it shows as “last event” in a few seconds')}>Send test event</button>}</div>
          {/^https?:\/\/(localhost|127\.)/.test(location.origin) && <p className="hint warn">This app is running on your computer — Hive can only reach the webhook once it’s hosted on a public https address.</p>}
        </div>

        <div className="rzp-hook">
          <b>Message templates</b> <span className="muted sm">{approved} of {h.templates.length} approved</span>
          <p className="hint">WhatsApp only lets a business start a chat with templates Meta has approved. Create the standard set once — review usually takes minutes to a few hours. Each message goes out only when its template is approved and its switch is on.</p>
          <div className="row">{toSubmit > 0 && <button className="btn primary" disabled={!!busy || !h.from} onClick={() => run('tpl', () => api('/channels/whatsapp/hive/templates/setup', 'POST'), setupSummary)}>{busy === 'tpl' ? 'Submitting…' : h.templates.some((t) => t.status) ? `Submit ${toSubmit} remaining template${toSubmit > 1 ? 's' : ''}` : 'Create my message templates'}</button>}
            <button className="btn ghost" disabled={!!busy || !h.from} onClick={() => run('refresh', () => api('/channels/whatsapp/hive/templates'), 'Statuses updated')}><RefreshCw size={14} /> Refresh</button>
            {allIn && <span className="muted sm">All {h.templates.length} submitted</span>}</div>
          <table className="tbl compact"><thead><tr><th>Message <small className="muted">· tap to see the wording</small></th><th>Template</th><th>Status</th><th className="r">Send</th></tr></thead>
            <tbody>{h.templates.map((t) => { const pl = TPL_PILL[t.status]; return (
              <Fragment key={t.event}>
                <tr className="click" onClick={() => setOpen(open === t.event ? '' : t.event)}><td title={t.text}>{t.label}</td><td className="mono sm">{t.name}</td>
                  <td>{t.status ? <span className={`pill ${pl?.[0] || 'info'}`} title={t.reason || ''}>{pl?.[1] || t.status}</span> : <span className="muted sm">not created</span>}{t.reason && t.status !== 'APPROVED' && <small className="muted"> {t.reason}</small>}</td>
                  <td className="r" onClick={(e) => e.stopPropagation()}><label className="tog"><input type="checkbox" checked={t.enabled} onChange={(e) => save({ events: { [t.event]: e.target.checked } }, null, `ev-${t.event}`)} /><span /></label></td></tr>
                {open === t.event && <tr><td colSpan={4} className="sm" style={{ whiteSpace: 'pre-wrap' }}>{t.text}</td></tr>}
              </Fragment>); })}</tbody></table>
          <label className="tog"><input type="checkbox" checked={h.abandonedReminder} onChange={(e) => save({ abandonedReminder: e.target.checked }, e.target.checked ? 'Unfinished checkouts get a WhatsApp reminder after 30 minutes' : 'Checkout reminders turned off')} /><span />Send a WhatsApp reminder to abandoned checkouts after 30 minutes (once per cart, never after they buy)</label>
        </div>
        {h.from && <OwnTemplates key={h.from} />}

        {h.recent?.length > 0 && <details className="rzp-hook"><summary><b>Recent WhatsApp messages</b></summary>
          <table className="tbl compact"><thead><tr><th>When</th><th>To</th><th>Message</th><th>Status</th></tr></thead>
            <tbody>{h.recent.map((m) => <tr key={m.id}><td className="muted sm">{when(m.at)}</td><td className="mono sm">+{m.to}</td><td className="sm">{m.template || m.event || 'message'}</td><td><span className={`pill ${m.status === 'failed' ? 'bad' : ['delivered', 'read'].includes(m.status) ? 'ok' : 'info'}`} title={m.error}>{m.status}</span></td></tr>)}</tbody></table></details>}
        <div className="row test-row"><button className="btn ghost" disabled={!!busy || !h.notifyPhone || !h.from} onClick={() => run('test', () => api('/channels/whatsapp/hive/test', 'POST'), (r) => `Test message sent to +${r.to}`)}>{busy === 'test' ? 'Sending…' : 'Send me a test message'}</button>{!h.notifyPhone && <span className="muted sm">Add your own WhatsApp number above first</span>}</div>
        <p className="hint">While Hive WhatsApp is in use, checkouts and booking forms ask for a WhatsApp number. Contacts who reply STOP are never messaged again. Your API key is encrypted and never shown again.</p>
      </>}
    </div>
  );
}

// the seller's own templates (for broadcasts and automations): written here, reviewed by Meta through Hive
const CATS = { UTILITY: ['Utility', 'Updates about something they bought or booked'], MARKETING: ['Marketing', 'Offers and promotions — costs more per message and needs their opt-in'] };
const varsIn = (body) => Math.max(0, ...[...String(body).matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1])));
// the same checks the server runs (server/hive-wa.js checkTemplate), so a mistake shows while typing
function checkTemplate({ name, category, body, samples, footer }) {
  name = name.trim(); body = body.trim(); footer = footer.trim();
  if (!/^[a-z0-9_]{1,60}$/.test(name)) return 'Name: lowercase letters, numbers and _ only (up to 60), e.g. diwali_offer';
  if (name.startsWith('fh_')) return 'Names starting with fh_ are kept for the standard templates — pick another name';
  if (!CATS[category]) return 'Choose a category: Utility or Marketing';
  if (!body) return 'Write the message';
  if (body.length > 1024) return 'The message can be up to 1024 characters';
  const tags = [...body.matchAll(/\{\{([^{}]*)\}\}/g)].map((m) => m[1].trim());
  if (tags.some((x) => !/^\d+$/.test(x))) return 'Variables are numbers in double curly brackets: {{1}}, {{2}}…';
  const nums = [...new Set(tags.map(Number))].sort((a, b) => a - b), n = nums.length;
  if (nums.some((x, i) => x !== i + 1)) return `Number the variables in order from {{1}}, with no gaps (found ${nums.map((x) => `{{${x}}}`).join(', ')})`;
  if (n && body.startsWith('{{')) return 'The message can’t start with a variable — put a few words first, e.g. “Hi {{1}}”';
  if (n && body.endsWith('}}')) return 'The message can’t end with a variable — add a few words after it';
  if (/\}\}\s*\{\{/.test(body)) return 'Two variables can’t sit next to each other — put some words between them';
  const words = body.replace(/\{\{[^{}]*\}\}/g, ' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  if (n && words < 3 * n + 5) return `Too many variables for the length: with ${n} variable${n > 1 ? 's' : ''}, write at least ${3 * n + 5} words of fixed text (now ${words})`;
  const blank = samples.findIndex((x) => !x.trim());
  if (blank >= 0) return `Give an example value for {{${blank + 1}}}`;
  if (footer.length > 60) return 'The footer can be up to 60 characters';
  if (footer.includes('{{')) return 'The footer can’t have variables';
  return null;
}
const NEW_TPL = { name: '', category: 'UTILITY', body: '', samples: [], footer: '' };
function OwnTemplates() {
  const [list, setList] = useState(null);
  const [v, setV] = useState(null); // the new-template form, when open
  const [busy, setBusy] = useState(false);
  const box = useRef(null);
  const load = () => api('/channels/whatsapp/hive/templates/custom').then((r) => setList(r.templates)).catch((e) => { setList([]); toast(e.message); });
  useEffect(() => { load(); }, []);
  const n = v ? varsIn(v.body) : 0;
  const samples = Array.from({ length: n }, (_, i) => v.samples[i] || '');
  const err = v && checkTemplate({ ...v, samples });
  const set = (patch) => setV((x) => ({ ...x, ...patch }));
  // inserts the next {{n}} where the cursor is
  const addVar = () => {
    const el = box.current, pos = el?.selectionStart ?? v.body.length, tag = `{{${n + 1}}}`;
    set({ body: `${v.body.slice(0, pos)}${tag}${v.body.slice(el?.selectionEnd ?? pos)}` });
    setTimeout(() => { el?.focus(); el?.setSelectionRange(pos + tag.length, pos + tag.length); }, 0);
  };
  const preview = v ? v.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (m, i) => samples[i - 1]?.trim() || m) : '';
  const submit = async () => {
    setBusy(true);
    try { await api('/channels/whatsapp/hive/templates/custom', 'POST', { ...v, language: 'en', samples }); toast('Submitted to Meta for review — usually minutes to a few hours'); setV(null); load(); } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const remove = async (t) => {
    if (!await confirmDialog({ title: `Delete the template “${t.name}”?`, text: 'Automations and broadcasts using it stop sending, and Meta may not let you reuse the name for a while.', confirm: 'Delete', danger: true })) return;
    try { await api(`/channels/whatsapp/hive/templates/custom/${t.name}`, 'DELETE'); toast('Template deleted'); load(); } catch (e) { toast(e.message); }
  };
  return (
    <div className="rzp-hook">
      <b>Your own templates</b> <span className="muted sm">· for broadcasts and automations</span>
      <p className="hint">Write your own messages — offers, launches, follow-ups. Meta reviews each one before it can be sent; then pick it by name in a broadcast or an automation’s WhatsApp step.</p>
      {!list ? <div className="skeleton sm" /> : list.length > 0 && (
        <table className="tbl compact"><thead><tr><th>Name</th><th>Category</th><th>Status</th><th>Message</th><th /></tr></thead>
          <tbody>{list.map((t) => { const pl = TPL_PILL[t.status]; return (
            <tr key={`${t.name}:${t.language}`}><td className="mono sm">{t.name}</td><td className="sm">{CATS[t.category]?.[0] || t.category}</td>
              <td><span className={`pill ${pl?.[0] || 'info'}`} title={t.reason || ''}>{pl?.[1] || t.status}</span>{t.reason && t.status !== 'APPROVED' && <small className="muted"> {t.reason}</small>}</td>
              <td className="sm" title={t.body}>{t.body.length > 80 ? `${t.body.slice(0, 80)}…` : t.body}</td>
              <td className="r"><button className="icon-btn danger" title="Delete" aria-label="Delete" onClick={() => remove(t)}><Trash2 size={15} /></button></td></tr>); })}</tbody></table>
      )}
      {!v ? <div className="row"><button className="btn ghost" onClick={() => setV(NEW_TPL)}><Plus size={15} /> New template</button></div> : <>
        <div className="form2">
          <label>Name <small className="muted">· lowercase, e.g. diwali_offer</small><input value={v.name} maxLength={60} onChange={(e) => set({ name: e.target.value.toLowerCase().replace(/[\s-]+/g, '_') })} placeholder="diwali_offer" /></label>
          <label>Category<select value={v.category} onChange={(e) => set({ category: e.target.value })}>{Object.entries(CATS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
        </div>
        <p className="hint">{CATS[v.category][0]}: {CATS[v.category][1]}.</p>
        <label className="full">Message <small className="muted">· {v.body.length}/1024</small>
          <textarea ref={box} rows={5} value={v.body} onChange={(e) => set({ body: e.target.value })} placeholder={'Hi {{1}}, our Diwali sale is live — {{2}} off every course until Sunday night.\n\nReply to this message if you have any questions.'} /></label>
        <div className="row"><button type="button" className="btn ghost sm" onClick={addVar}><Plus size={13} /> Add variable {`{{${n + 1}}}`}</button><span className="muted sm">Variables are filled in when it’s sent — a name, a link, a price…</span></div>
        {n > 0 && <div className="form2">{samples.map((s, i) => <label key={i}>Example for {`{{${i + 1}}}`}<input value={s} onChange={(e) => { const next = [...samples]; next[i] = e.target.value; set({ samples: next }); }} placeholder={i === 0 ? 'Priya' : 'an example value'} /></label>)}</div>}
        <label className="full">Footer <small className="muted">· optional, up to 60 characters, no variables</small><input value={v.footer} maxLength={60} onChange={(e) => set({ footer: e.target.value })} placeholder="Reply STOP to unsubscribe" /></label>
        {v.body.trim() && <div className="hint" style={{ whiteSpace: 'pre-wrap' }}><b>Preview</b>{'\n'}{preview}{v.footer.trim() && <small className="muted">{'\n'}{v.footer}</small>}</div>}
        {err && (v.name || v.body) && <p className="hint warn">{err}</p>}
        <div className="row"><button className="btn primary" disabled={busy || !!err} onClick={submit}>{busy ? 'Submitting…' : 'Submit for review'}</button><button className="btn ghost" onClick={() => setV(null)}>Cancel</button></div>
      </>}
    </div>
  );
}

const STATUS = { active: ['ok', 'Connected'], pending: ['warn', 'Waiting for DNS'] };
export function DomainsPanel() {
  const [d, setD] = useState(null);
  const [funnels, setFunnels] = useState([]);
  const [nd, setNd] = useState({ domain: '', funnelId: '' });
  const [busy, setBusy] = useState('');
  const load = () => api('/domains').then(setD);
  useEffect(() => { load(); api('/funnels').then((f) => { setFunnels(f); setNd((x) => ({ ...x, funnelId: x.funnelId || f[0]?.id || '' })); }); }, []);
  if (!d) return <Panel title="Custom domains"><div className="skeleton sm" /></Panel>;
  const add = async (e) => { e.preventDefault(); setBusy('add'); try { await api('/domains', 'POST', nd); setNd({ ...nd, domain: '' }); load(); toast('Domain added — now add the DNS records below'); } catch (x) { toast(x.message); } setBusy(''); };
  const verify = async (x) => { setBusy(x.id); try { const r = await api(`/domains/${x.id}/verify`, 'POST'); toast(r.status === 'active' ? `${r.domain} is connected` : r.error); load(); } catch (e) { toast(e.message); } setBusy(''); };
  const remove = async (x) => { if (!await confirmDialog({ title: `Disconnect ${x.domain}?`, text: 'Visitors there will no longer see your funnel.', confirm: 'Disconnect', danger: true })) return; await api(`/domains/${x.id}`, 'DELETE'); load(); };
  const point = async (x, funnelId) => { await api(`/domains/${x.id}`, 'PUT', { funnelId }); load(); toast('Domain now shows that funnel'); };
  const fname = (id) => funnels.find((f) => f.id === id)?.name || 'a deleted funnel';
  return (
    <Panel title="Custom domains">
      <p className="muted sm">Show a funnel on your own address, like <b>offer.yourbrand.in</b>. Each domain shows one funnel: its first page at <code>/</code> and the other steps at <code>/step-name</code>.</p>
      <form className="dom-add" onSubmit={add}>
        <input value={nd.domain} onChange={(e) => setNd({ ...nd, domain: e.target.value })} placeholder="offer.yourbrand.in" />
        <select value={nd.funnelId} onChange={(e) => setNd({ ...nd, funnelId: e.target.value })}>{funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
        <button className="btn primary" disabled={!nd.domain || !nd.funnelId || busy === 'add'}><Plus size={15} /> Connect</button>
      </form>
      {d.domains.map((x) => (
        <div key={x.id} className={`dom ${x.status}`}>
          <div className="dom-h">
            <b>{x.domain}</b><span className={`pill ${STATUS[x.status][0]}`}>{STATUS[x.status][1]}</span>
            <select value={x.funnelId} onChange={(e) => point(x, e.target.value)} title="Funnel shown on this domain">{funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}{!funnels.some((f) => f.id === x.funnelId) && <option value={x.funnelId}>{fname(x.funnelId)}</option>}</select>
            {x.status === 'active' && <a className="icon-btn" href={`https://${x.domain}`} target="_blank" rel="noreferrer" title="Open" aria-label="Open"><ExternalLink size={15} /></a>}
            <button className="icon-btn danger" onClick={() => remove(x)} title="Disconnect" aria-label="Disconnect"><Trash2 size={15} /></button>
          </div>
          {x.status !== 'active' && <>
            <p className="hint">Add these records where you bought the domain (GoDaddy, Hostinger, BigRock, Namecheap, Cloudflare…). DNS changes can take a few minutes to a few hours; we re-check automatically.</p>
            <table className="tbl compact dns-t"><thead><tr><th>Type</th><th>Name / Host</th><th>Value / Points to</th><th /></tr></thead>
              <tbody>{x.records.map((r) => <tr key={r.type + r.name}><td className="mono strong">{r.type}</td><td className="mono">{r.name}{r.optional && <small className="muted"> · {r.why}</small>}</td><td className="mono">{r.value}</td><td className="r"><button className="icon-btn xs" title="Copy" aria-label="Copy" onClick={() => copy(r.value)}><Copy size={13} /></button></td></tr>)}</tbody></table>
            <div className="row"><button className="btn ghost" disabled={busy === x.id} onClick={() => verify(x)}><RefreshCw size={14} /> {busy === x.id ? 'Checking…' : 'Check now'}</button>{x.error && <span className="muted sm">{x.error}{x.checkedAt ? ` · checked ${new Date(x.checkedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : ''}</span>}</div>
          </>}
          {x.status === 'active' && <p className="hint">Live at <a href={`https://${x.domain}`} target="_blank" rel="noreferrer">https://{x.domain}</a> — showing “{fname(x.funnelId)}”. HTTPS certificates are issued automatically by the server’s Caddy proxy.</p>}
          {x.status === 'active' && x.failures > 0 && x.error && <p className="hint warn">{x.error}</p>}
        </div>
      ))}
      {!d.target && !d.serverIp && <p className="hint warn">Server setup needed: the administrator must set APP_URL (or CNAME_TARGET / SERVER_IP) and run the Caddy proxy from the deploy guide so domains get HTTPS.</p>}
    </Panel>
  );
}

export function RazorpayPanel() {
  const [st, setSt] = useState(null);
  const [v, setV] = useState({ keyId: '', keySecret: '', webhookSecret: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/channels').then((c) => { setSt(c.razorpay); setV((x) => ({ ...x, keyId: c.razorpay.keyId })); }).catch(loadFailed); }, []);
  if (!st) return <div className="skeleton sm" />;
  const save = async () => {
    setBusy(true);
    try { const r = await api('/channels/razorpay', 'PUT', v); setSt({ ...st, ...r }); setV({ keyId: r.keyId, keySecret: '', webhookSecret: '' }); toast(`Razorpay connected (${r.mode === 'live' ? 'LIVE — real payments' : 'test mode'})`); } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const clear = async () => { if (!await confirmDialog({ title: 'Disconnect Razorpay?', text: 'Checkouts go back to demo mode (no money collected).', confirm: 'Disconnect', danger: true })) return; const r = await api('/channels/razorpay', 'PUT', { clear: true }); setSt({ ...st, ...r }); setV({ keyId: '', keySecret: '', webhookSecret: '' }); };
  const hook = `${location.origin}${st.webhookUrl}`;
  return (
    <div className="rzp">
      <div className="rzp-h"><b>Razorpay</b>{st.configured ? <span className={`pill ${st.mode === 'live' ? 'ok' : 'warn'}`}>{st.mode === 'live' ? 'Live — collecting real payments' : 'Test mode — no real money'}</span> : <span className="pill">Not connected — demo checkout</span>}</div>
      <p className="muted sm">Get your keys in Razorpay Dashboard → Account &amp; Settings → API keys. Start with <b>Test mode</b> keys (rzp_test_…), try a purchase, then switch to Live keys.</p>
      <div className="form2">
        <label>Key ID<input value={v.keyId} onChange={(e) => setV({ ...v, keyId: e.target.value.trim() })} placeholder="rzp_test_…" autoComplete="off" /></label>
        <label>Key Secret {st.hasSecret && <small className="muted">· saved — leave empty to keep it</small>}<input type="password" value={v.keySecret} onChange={(e) => setV({ ...v, keySecret: e.target.value })} placeholder={st.hasSecret ? '••••••••' : 'shown once when you generate the key'} autoComplete="new-password" /></label>
        <label className="full">Webhook secret <small className="muted">· optional, recommended</small><input type="password" value={v.webhookSecret} onChange={(e) => setV({ ...v, webhookSecret: e.target.value })} placeholder={st.hasWebhookSecret ? '•••••••• (saved)' : 'the secret you type when creating the webhook'} autoComplete="new-password" /></label>
      </div>
      <div className="row"><button className="btn primary" disabled={busy || !v.keyId} onClick={save}>{busy ? 'Checking with Razorpay…' : 'Save & verify keys'}</button>{st.configured && <button className="btn ghost danger" onClick={clear}>Disconnect</button>}</div>
      <div className="rzp-hook">
        <b>Webhook (backup for buyers who close the page right after paying)</b>
        <p className="hint">In Razorpay → Account &amp; Settings → Webhooks, add this URL with the events <code>payment.captured</code>, <code>order.paid</code>, <code>refund.processed</code> and (for payment plans &amp; memberships) all <code>subscription.*</code> events, choose a secret and paste the same secret above.</p>
        <div className="row"><code className="secret-v">{hook}</code><button className="icon-btn" title="Copy" aria-label="Copy" onClick={() => copy(hook)}><Copy size={15} /></button></div>
        {/^https?:\/\/(localhost|127\.)/.test(location.origin) && <p className="hint warn">This app is running on your computer — Razorpay can only reach the webhook once it’s hosted on a public address. Payments still work without it.</p>}
      </div>
      <p className="hint">Upsells and cross-sells open Razorpay again with the buyer’s details filled in — one tap with UPI or a saved card. Fully automatic card charging needs Razorpay’s recurring-payments approval.</p>
    </div>
  );
}

// Stripe: international cards and currencies (USD, EUR, GBP…), Apple Pay / Google Pay
export function StripePanel() {
  const [st, setSt] = useState(null);
  const [v, setV] = useState({ publishableKey: '', secretKey: '', webhookSecret: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/channels/stripe').then((s) => { setSt(s); setV((x) => ({ ...x, publishableKey: s.publishableKey })); }).catch(() => {}); }, []);
  if (!st) return <div className="skeleton sm" />;
  const save = async () => {
    setBusy(true);
    try { const r = await api('/channels/stripe', 'PUT', v); setSt(r); setV({ publishableKey: r.publishableKey, secretKey: '', webhookSecret: '' }); toast(`Stripe connected (${r.mode === 'live' ? 'LIVE — real payments' : 'test mode'})`); } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const clear = async () => { if (!await confirmDialog({ title: 'Disconnect Stripe?', text: 'Checkouts in foreign currencies stop taking payments.', confirm: 'Disconnect', danger: true })) return; setSt(await api('/channels/stripe', 'PUT', { clear: true })); setV({ publishableKey: '', secretKey: '', webhookSecret: '' }); };
  const hook = `${location.origin}${st.webhookUrl}`;
  return (
    <div className="rzp">
      <div className="rzp-h"><b>Stripe</b>{st.configured ? <span className={`pill ${st.mode === 'live' ? 'ok' : 'warn'}`}>{st.mode === 'live' ? 'Live — collecting real payments' : 'Test mode — no real money'}</span> : <span className="pill">Not connected</span>}</div>
      <p className="muted sm">For buyers outside India: cards in USD, EUR, GBP and more, plus Apple Pay and Google Pay. Pick the currency on each checkout — ₹ checkouts keep using Razorpay when it’s connected. Keys: Stripe Dashboard → Developers → API keys.</p>
      <div className="form2">
        <label>Publishable key<input value={v.publishableKey} onChange={(e) => setV({ ...v, publishableKey: e.target.value.trim() })} placeholder="pk_test_…" autoComplete="off" /></label>
        <label>Secret key {st.hasSecret && <small className="muted">· saved — leave empty to keep it</small>}<input type="password" value={v.secretKey} onChange={(e) => setV({ ...v, secretKey: e.target.value })} placeholder={st.hasSecret ? '••••••••' : 'sk_test_…'} autoComplete="new-password" /></label>
        <label className="full">Webhook signing secret <small className="muted">· recommended — needed for membership renewals</small><input type="password" value={v.webhookSecret} onChange={(e) => setV({ ...v, webhookSecret: e.target.value })} placeholder={st.hasWebhookSecret ? '•••••••• (saved)' : 'whsec_…'} autoComplete="new-password" /></label>
      </div>
      <div className="row"><button className="btn primary" disabled={busy || !v.publishableKey} onClick={save}>{busy ? 'Checking with Stripe…' : 'Save & verify keys'}</button>{st.configured && <button className="btn ghost danger" onClick={clear}>Disconnect</button>}</div>
      <div className="rzp-hook">
        <b>Webhook</b>
        <p className="hint">Stripe → Developers → Webhooks → Add endpoint with this URL and the events <code>payment_intent.succeeded</code>, <code>invoice.paid</code>, <code>invoice.payment_failed</code>, <code>customer.subscription.updated</code> and <code>customer.subscription.deleted</code>; paste its signing secret above.</p>
        <div className="row"><code className="secret-v">{hook}</code><button className="icon-btn" title="Copy" aria-label="Copy" onClick={() => copy(hook)}><Copy size={15} /></button></div>
      </div>
      <p className="hint">Upsells charge the card saved at checkout in one click (cards that need 3-D Secure show the form again).</p>
    </div>
  );
}

export function HiveMcpPanel() {
  const [list, setList] = useState(null);
  const [name, setName] = useState('Claude Desktop');
  const [fresh, setFresh] = useState(null);
  const url = `${location.origin}/mcp`;
  const load = () => api('/hive/tokens').then(setList);
  useEffect(() => { load(); }, []);
  const create = async () => { try { const t = await api('/hive/tokens', 'POST', { name }); setFresh(t); load(); } catch (e) { toast(e.message); } };
  const revoke = async (t) => { if (!await confirmDialog({ title: `Revoke “${t.name}”?`, text: 'Apps using it lose access immediately.', confirm: 'Revoke', danger: true })) return; await api(`/hive/tokens/${t.id}`, 'DELETE'); load(); };
  const config = (tok) => JSON.stringify({ mcpServers: { funnelhive: { command: 'npx', args: ['-y', 'mcp-remote', url, '--header', `Authorization: Bearer ${tok}`] } } }, null, 2);
  return (
    <Panel title="Hive AI · MCP access">
      <p className="muted sm">Let other AI apps (Claude Desktop, Cursor, ChatGPT connectors…) build and edit your funnels, pages, coupons, pipelines and automations through the Model Context Protocol — the same tools Hive AI uses.</p>
      <label className="full">MCP server URL<div className="row"><code className="secret-v">{url}</code><button className="icon-btn" title="Copy" aria-label="Copy" onClick={() => copy(url)}><Copy size={15} /></button></div></label>
      {fresh && (
        <div className="mcp-fresh">
          <b>Copy your token now — it won’t be shown again</b>
          <div className="row"><code className="secret-v">{fresh.token}</code><button className="icon-btn" title="Copy" aria-label="Copy" onClick={() => copy(fresh.token)}><Copy size={15} /></button></div>
          <p className="hint">Claude Desktop → Settings → Developer → Edit config, add:</p>
          <pre className="mcp-cfg">{config(fresh.token)}</pre>
          <button className="btn ghost sm" onClick={() => copy(config(fresh.token))}><Copy size={13} /> Copy config</button>
          <p className="hint">Apps with native remote-MCP support: use the URL above with the header <code>Authorization: Bearer {fresh.token.slice(0, 12)}…</code></p>
        </div>
      )}
      <div className="row"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Token name, e.g. Claude Desktop" style={{ maxWidth: 260 }} /><button className="btn primary" onClick={create}><Plus size={15} /> Create access token</button></div>
      {list?.length > 0 && (
        <table className="tbl compact"><thead><tr><th>Name</th><th>Token</th><th>Created</th><th>Last used</th><th /></tr></thead>
          <tbody>{list.map((t) => <tr key={t.id}><td>{t.name}</td><td className="mono">{t.prefix}…</td><td className="muted sm">{new Date(t.at).toLocaleDateString('en-IN')}</td><td className="muted sm">{t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString('en-IN') : 'never'}</td><td className="r"><button className="icon-btn danger" title="Revoke" aria-label="Revoke" onClick={() => revoke(t)}><Trash2 size={15} /></button></td></tr>)}</tbody></table>
      )}
      <p className="hint">Anyone with a token can change your funnels — keep tokens private and revoke ones you no longer use.</p>
    </Panel>
  );
}
