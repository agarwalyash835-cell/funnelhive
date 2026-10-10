// Settings: email sending (SMTP), WhatsApp Business API, custom domains
import { useEffect, useState } from 'react';
import { Copy, RefreshCw, Trash2, Plus, ExternalLink } from 'lucide-react';
import { api } from '../api';
import { Panel, toast } from '../ui';

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
  useEffect(() => { api('/channels').then((c) => { setCh(c); setV({ ...c.email, pass: '' }); }); }, []);
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
  const clear = async () => { if (!confirm('Remove your SMTP settings?')) return; const c = await api('/channels/email', 'PUT', { clear: true }); setCh(c); setV({ ...c.email, pass: '' }); };
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
  const [v, setV] = useState({ phoneNumberId: '', businessId: '', token: '' });
  const [to, setTo] = useState('');
  const [tpl, setTpl] = useState('hello_world');
  const [busy, setBusy] = useState('');
  useEffect(() => { api('/channels').then((c) => { setCh(c); setV({ phoneNumberId: c.whatsapp.phoneNumberId, businessId: c.whatsapp.businessId, token: '' }); }); }, []);
  if (!ch) return <Panel title="WhatsApp"><div className="skeleton sm" /></Panel>;
  const save = async () => { setBusy('save'); try { const c = await api('/channels/whatsapp', 'PUT', v); setCh(c); setV((x) => ({ ...x, token: '' })); toast('WhatsApp connected'); } catch (e) { toast(e.message); } setBusy(''); };
  const test = async () => { setBusy('test'); try { await api('/channels/whatsapp/test', 'POST', { to, template: tpl, language: tpl === 'hello_world' ? 'en_US' : 'en' }); toast('Test message sent'); } catch (e) { toast(e.message); } setBusy(''); };
  const clear = async () => { if (!confirm('Disconnect WhatsApp?')) return; const c = await api('/channels/whatsapp', 'PUT', { clear: true }); setCh(c); setV({ phoneNumberId: '', businessId: '', token: '' }); };
  return (
    <Panel title="WhatsApp Business API" actions={<span className={`pill ${ch.whatsapp.configured ? 'ok' : 'warn'}`}>{ch.whatsapp.configured ? 'Connected' : 'Not connected'}</span>}>
      <p className="muted sm">Send WhatsApp messages from automations and the contact screen through Meta’s official WhatsApp Cloud API. Until it’s connected, the WhatsApp button opens WhatsApp on your phone instead.</p>
      <div className="form2">
        <label>Phone number ID<input value={v.phoneNumberId} onChange={(e) => setV({ ...v, phoneNumberId: e.target.value.trim() })} placeholder="e.g. 106540352242922" /></label>
        <label>WhatsApp Business account ID <small className="muted">· optional</small><input value={v.businessId} onChange={(e) => setV({ ...v, businessId: e.target.value.trim() })} placeholder="e.g. 102290129340398" /></label>
        <label className="full">Permanent access token {ch.whatsapp.hasToken && <small className="muted">· saved — leave empty to keep it</small>}<input type="password" value={v.token} onChange={(e) => setV({ ...v, token: e.target.value })} placeholder={ch.whatsapp.hasToken ? '••••••••' : 'EAAG…'} autoComplete="new-password" /></label>
      </div>
      <div className="row"><button className="btn primary" disabled={busy || !v.phoneNumberId} onClick={save}>Save WhatsApp</button>{ch.whatsapp.configured && <button className="btn ghost danger" onClick={clear}>Disconnect</button>}
        <a className="btn ghost" href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" target="_blank" rel="noreferrer"><ExternalLink size={14} /> Setup guide</a></div>
      <div className="row test-row"><input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Your WhatsApp number" /><input value={tpl} onChange={(e) => setTpl(e.target.value)} placeholder="template name" style={{ maxWidth: 160 }} /><button className="btn ghost" disabled={busy || !ch.whatsapp.configured || !to} onClick={test}>{busy === 'test' ? 'Sending…' : 'Send test'}</button></div>
      <p className="hint">Find these in Meta Business → WhatsApp Manager → API setup. Business-initiated messages must use a template approved by Meta (“hello_world” works for testing). The token is encrypted and never shown again.</p>
    </Panel>
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
  const remove = async (x) => { if (!confirm(`Disconnect ${x.domain}? Visitors there will no longer see your funnel.`)) return; await api(`/domains/${x.id}`, 'DELETE'); load(); };
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
            {x.status === 'active' && <a className="icon-btn" href={`https://${x.domain}`} target="_blank" rel="noreferrer" title="Open"><ExternalLink size={15} /></a>}
            <button className="icon-btn danger" onClick={() => remove(x)} title="Disconnect"><Trash2 size={15} /></button>
          </div>
          {x.status !== 'active' && <>
            <p className="hint">Add these records where you bought the domain (GoDaddy, Hostinger, BigRock, Namecheap, Cloudflare…). DNS changes can take a few minutes to a few hours; we re-check automatically.</p>
            <table className="tbl compact dns-t"><thead><tr><th>Type</th><th>Name / Host</th><th>Value / Points to</th><th /></tr></thead>
              <tbody>{x.records.map((r) => <tr key={r.type + r.name}><td className="mono strong">{r.type}</td><td className="mono">{r.name}{r.optional && <small className="muted"> · {r.why}</small>}</td><td className="mono">{r.value}</td><td className="r"><button className="icon-btn xs" title="Copy" onClick={() => copy(r.value)}><Copy size={13} /></button></td></tr>)}</tbody></table>
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
  useEffect(() => { api('/channels').then((c) => { setSt(c.razorpay); setV((x) => ({ ...x, keyId: c.razorpay.keyId })); }); }, []);
  if (!st) return <div className="skeleton sm" />;
  const save = async () => {
    setBusy(true);
    try { const r = await api('/channels/razorpay', 'PUT', v); setSt({ ...st, ...r }); setV({ keyId: r.keyId, keySecret: '', webhookSecret: '' }); toast(`Razorpay connected (${r.mode === 'live' ? 'LIVE — real payments' : 'test mode'})`); } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const clear = async () => { if (!confirm('Disconnect Razorpay? Checkouts go back to demo mode (no money collected).')) return; const r = await api('/channels/razorpay', 'PUT', { clear: true }); setSt({ ...st, ...r }); setV({ keyId: '', keySecret: '', webhookSecret: '' }); };
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
        <div className="row"><code className="secret-v">{hook}</code><button className="icon-btn" title="Copy" onClick={() => copy(hook)}><Copy size={15} /></button></div>
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
  const clear = async () => { if (!confirm('Disconnect Stripe? Checkouts in foreign currencies stop taking payments.')) return; setSt(await api('/channels/stripe', 'PUT', { clear: true })); setV({ publishableKey: '', secretKey: '', webhookSecret: '' }); };
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
        <div className="row"><code className="secret-v">{hook}</code><button className="icon-btn" title="Copy" onClick={() => copy(hook)}><Copy size={15} /></button></div>
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
  const revoke = async (t) => { if (!confirm(`Revoke “${t.name}”? Apps using it lose access immediately.`)) return; await api(`/hive/tokens/${t.id}`, 'DELETE'); load(); };
  const config = (tok) => JSON.stringify({ mcpServers: { funnelhive: { command: 'npx', args: ['-y', 'mcp-remote', url, '--header', `Authorization: Bearer ${tok}`] } } }, null, 2);
  return (
    <Panel title="Hive AI · MCP access">
      <p className="muted sm">Let other AI apps (Claude Desktop, Cursor, ChatGPT connectors…) build and edit your funnels, pages, coupons, pipelines and automations through the Model Context Protocol — the same tools Hive AI uses.</p>
      <label className="full">MCP server URL<div className="row"><code className="secret-v">{url}</code><button className="icon-btn" title="Copy" onClick={() => copy(url)}><Copy size={15} /></button></div></label>
      {fresh && (
        <div className="mcp-fresh">
          <b>Copy your token now — it won’t be shown again</b>
          <div className="row"><code className="secret-v">{fresh.token}</code><button className="icon-btn" title="Copy" onClick={() => copy(fresh.token)}><Copy size={15} /></button></div>
          <p className="hint">Claude Desktop → Settings → Developer → Edit config, add:</p>
          <pre className="mcp-cfg">{config(fresh.token)}</pre>
          <button className="btn ghost sm" onClick={() => copy(config(fresh.token))}><Copy size={13} /> Copy config</button>
          <p className="hint">Apps with native remote-MCP support: use the URL above with the header <code>Authorization: Bearer {fresh.token.slice(0, 12)}…</code></p>
        </div>
      )}
      <div className="row"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Token name, e.g. Claude Desktop" style={{ maxWidth: 260 }} /><button className="btn primary" onClick={create}><Plus size={15} /> Create access token</button></div>
      {list?.length > 0 && (
        <table className="tbl compact"><thead><tr><th>Name</th><th>Token</th><th>Created</th><th>Last used</th><th /></tr></thead>
          <tbody>{list.map((t) => <tr key={t.id}><td>{t.name}</td><td className="mono">{t.prefix}…</td><td className="muted sm">{new Date(t.at).toLocaleDateString('en-IN')}</td><td className="muted sm">{t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString('en-IN') : 'never'}</td><td className="r"><button className="icon-btn danger" title="Revoke" onClick={() => revoke(t)}><Trash2 size={15} /></button></td></tr>)}</tbody></table>
      )}
      <p className="hint">Anyone with a token can change your funnels — keep tokens private and revoke ones you no longer use.</p>
    </Panel>
  );
}
