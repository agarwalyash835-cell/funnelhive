import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Layout, Panel, Icon, toast, ago } from '../ui';

const copy = (t) => { navigator.clipboard?.writeText(t); toast('Copied'); };

// Settings → API & integrations: keys for Zapier / Pabbly / Make / n8n / your own code
export function ApiKeysPanel() {
  const [d, setD] = useState(null);
  const [name, setName] = useState('Zapier');
  const [scope, setScope] = useState('full');
  const [fresh, setFresh] = useState(null);
  const load = () => api('/keys').then(setD).catch(() => setD(false));
  useEffect(() => { load(); }, []);
  if (d === false) return null;
  const create = async () => { try { setFresh(await api('/keys', 'POST', { name, scope })); load(); } catch (e) { toast(e.message); } };
  const revoke = async (k) => { if (!confirm(`Revoke “${k.name}”? Apps using it stop working immediately.`)) return; await api(`/keys/${k.id}`, 'DELETE'); load(); };
  return (
    <Panel title="API & integrations" actions={<Link className="btn ghost sm" to="/developers"><Icon name="external" size={13} /> API reference</Link>}>
      <p className="muted sm">Connect FunnelHive to 5,000+ apps with <b>Zapier</b>, <b>Pabbly Connect</b>, <b>Make</b> or <b>n8n</b> — new leads, orders and bookings start your workflows, and other apps can add contacts, tags and orders here. Or use the REST API from your own code.</p>
      {fresh && (
        <div className="mcp-fresh">
          <b>Copy your key now — it won’t be shown again</b>
          <div className="row"><code className="secret-v">{fresh.token}</code><button className="icon-btn" title="Copy" onClick={() => copy(fresh.token)}><Icon name="copy" size={15} /></button></div>
          <p className="hint">Send it as <code>Authorization: Bearer {fresh.token.slice(0, 14)}…</code> or <code>X-API-Key</code>.</p>
        </div>
      )}
      <div className="row wrap"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Key name, e.g. Zapier" style={{ maxWidth: 220 }} />
        <select value={scope} onChange={(e) => setScope(e.target.value)}><option value="full">Full access</option><option value="read">Read-only</option></select>
        <button className="btn primary" onClick={create}><Icon name="plus" size={15} /> Create API key</button></div>
      {d?.keys?.length > 0 && (
        <table className="tbl compact"><thead><tr><th>Name</th><th>Key</th><th>Access</th><th>Last used</th><th /></tr></thead>
          <tbody>{d.keys.map((k) => <tr key={k.id}><td>{k.name}</td><td className="mono">{k.prefix}…</td><td>{k.scope === 'read' ? 'Read-only' : 'Full'}</td><td className="muted sm">{k.lastUsedAt ? ago(k.lastUsedAt) : 'never'}</td><td className="r"><button className="icon-btn danger" title="Revoke" onClick={() => revoke(k)}><Icon name="trash" size={15} /></button></td></tr>)}</tbody></table>
      )}
      {d?.hooks?.length > 0 && (
        <>
          <p className="hint"><b>Active subscriptions</b> (created by connected apps):</p>
          <table className="tbl compact"><tbody>{d.hooks.map((h) => <tr key={h.id}><td className="mono sm">{h.event}</td><td className="muted sm" style={{ wordBreak: 'break-all' }}>{h.url}</td><td className="r"><button className="icon-btn" title="Remove" onClick={async () => { await api(`/v1/hooks/${h.id}`, 'DELETE'); load(); }}><Icon name="x" size={14} /></button></td></tr>)}</tbody></table>
        </>
      )}
      <p className="hint">Keys can do what an admin team member can — never billing, your account, the team or other keys. 120 requests a minute per key.</p>
    </Panel>
  );
}

const EP = [
  ['Account', [['GET', '/api/v1/me', 'Who the key belongs to']]],
  ['Triggers (newest first; ?since=<ms>&limit=…)', [['GET', '/api/v1/leads', 'New sign-ups and applications'], ['GET', '/api/v1/orders', 'Orders, with items, currency and status'], ['GET', '/api/v1/bookings', 'Booked, rescheduled and cancelled calls'], ['GET', '/api/v1/contacts', 'Contacts by latest activity']]],
  ['REST hooks (instant triggers)', [['POST', '/api/v1/hooks', '{ "url": "https://…", "event": "lead.created" } → { id }'], ['GET', '/api/v1/hooks', 'Your subscriptions'], ['DELETE', '/api/v1/hooks/:id', 'Unsubscribe']]],
  ['Contacts & CRM', [['POST', '/api/v1/contacts', '{ email | phone, name, tags: ["vip"] } — creates or updates; new tags start tag automations'], ['GET', '/api/contacts/:email', 'One contact with their full timeline'], ['PATCH', '/api/contacts/:email', '{ tags, name, phone, custom, stages }'], ['DELETE', '/api/contacts/:email', 'Erase a contact (privacy request)']]],
  ['Automations', [['GET', '/api/automations', 'List'], ['POST', '/api/automations/:id/enroll', '{ email, name, phone } — start the automation for someone']]],
  ['Products & access', [['GET', '/api/products', 'List'], ['POST', '/api/products/:id/grant', '{ email, name } — give someone access and email their library link']]],
  ['Sales', [['GET', '/api/orders', 'Orders and abandoned checkouts'], ['POST', '/api/orders/:id/refund', '{ items: [index], reason }'], ['POST', '/api/orders/:id/fulfil', '{ status: shipped|delivered|returned, courier, tracking }'], ['GET', '/api/sales-invoices', 'GST invoices and credit notes']]],
  ['Funnels & reports', [['GET', '/api/funnels', 'Funnels with 30-day stats'], ['GET', '/api/funnels/:id', 'One funnel with its pages'], ['GET', '/api/analytics/overview?days=30', 'Visitors, leads, orders, revenue, sources, campaigns']]],
  ['Broadcasts, bookings & webinars', [['POST', '/api/broadcasts', 'Create a draft'], ['POST', '/api/broadcasts/:id/send', '{ at? } — send now or schedule'], ['GET', '/api/bookings', 'Calls'], ['GET', '/api/webinars/:id/registrations', 'Registrants and attendance']]],
];
const EVENTS = ['lead.created', 'order.created', 'order.updated', 'order.refunded', 'order.shipped', 'order.cancelled', 'order.renewed', 'order.payment_failed', 'order.plan_ended', 'booking.created', 'booking.rescheduled', 'booking.cancelled', 'webinar.registered', 'webinar.attended', 'webinar.missed'];

export default function Developers() {
  const base = location.origin;
  return (
    <Layout title="API reference" subtitle="Everything in FunnelHive is available over a REST API — the same one the app uses.">
      <Panel title="Getting started">
        <ol className="dev-steps">
          <li>Create a key in <Link to="/settings">Settings → API &amp; integrations</Link> (full or read-only).</li>
          <li>Send it with every request: <code>Authorization: Bearer fh_live_…</code> (or <code>X-API-Key</code>).</li>
          <li>JSON in, JSON out. Errors come back as <code>{'{ "error": "…" }'}</code> with a 4xx status. 120 requests a minute per key.</li>
        </ol>
        <pre className="mcp-cfg">{`curl ${base}/api/v1/contacts \\
  -H "Authorization: Bearer fh_live_…" -H "Content-Type: application/json" \\
  -d '{"email":"priya@example.com","name":"Priya","tags":["webinar-lead"]}'`}</pre>
      </Panel>
      <Panel title="Zapier, Pabbly Connect, Make, n8n">
        <p className="muted sm"><b>Instant triggers</b>: subscribe a URL to an event with <code>POST /api/v1/hooks</code> (Zapier’s REST hooks do this for you); each delivery is <code>{'{ id, event, data, at }'}</code>, signed with the <code>X-FunnelHive-Signature</code> HMAC of your webhook signing secret and retried with back-off. <b>Polling triggers</b>: the <code>/api/v1/*</code> lists with <code>?since=</code>. <b>Actions</b>: any endpoint below. Without a key you can still send every event to one URL from Settings → Webhooks.</p>
        <div className="chips">{EVENTS.map((e) => <span key={e} className="chip mono">{e}</span>)}</div>
      </Panel>
      {EP.map(([group, rows]) => (
        <Panel key={group} title={group} pad={false}>
          <table className="tbl compact"><tbody>{rows.map(([m, p, d]) => <tr key={m + p}><td style={{ width: 80 }}><span className={`pill ${m === 'GET' ? '' : m === 'DELETE' ? 'bad' : 'ok'}`}>{m}</span></td><td className="mono sm">{p}</td><td className="muted sm">{d}</td></tr>)}</tbody></table>
        </Panel>
      ))}
    </Layout>
  );
}
