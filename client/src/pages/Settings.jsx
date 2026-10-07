import { useEffect, useState } from 'react';
import { api } from '../api';
import { Layout, Panel, Icon, toast } from '../ui';
import SecurityPanel from './SecurityPanel';
import { EmailPanel, WhatsAppPanel, DomainsPanel, RazorpayPanel, HiveMcpPanel } from './SettingsChannels';


const couponRulesText = (c, funnels) => {
  const r = [];
  if (c.expiresAt) r.push(`${Date.now() > c.expiresAt ? 'expired' : 'until'} ${new Date(c.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`);
  if (c.minOrder) r.push(`min ₹${c.minOrder.toLocaleString('en-IN')}`);
  if (c.oncePerCustomer) r.push('once per customer');
  if (c.funnelIds?.length) r.push(c.funnelIds.map((id) => funnels.find((f) => f.id === id)?.name).filter(Boolean).join(', '));
  return r.join(' · ') || 'No limits';
};

export default function Settings() {
  const [s, setS] = useState(null);
  const [me, setMe] = useState(null);
  const [coupons, setCoupons] = useState([]);
  const NC = { code: '', type: 'percent', value: 10, expiresAt: '', maxUses: '', minOrder: '', oncePerCustomer: false, funnelIds: [] };
  const [nc, setNc] = useState(NC);
  const [more, setMore] = useState(false);
  const [funnels, setFunnels] = useState([]);
  const [hook, setHook] = useState('');
  const [deliveries, setDeliveries] = useState([]);
  const [showSecret, setShowSecret] = useState(false);
  const loadDeliveries = () => api('/webhooks/deliveries').then(setDeliveries);
  useEffect(() => { api('/settings').then(setS); api('/coupons').then(setCoupons); api('/me').then(setMe); api('/funnels').then(setFunnels).catch(() => {}); loadDeliveries(); }, []);
  if (!s) return <Layout title="Settings"><div className="skeleton" /></Layout>;
  const set = (patch) => setS({ ...s, ...patch });
  const save = async (patch = s) => { try { setS(await api('/settings', 'PUT', patch)); toast('Settings saved'); return true; } catch (e) { toast(e.message); return false; } };
  const addCoupon = async (e) => { e.preventDefault(); try { const c = await api('/coupons', 'POST', nc); setCoupons([...coupons, c]); setNc(NC); setMore(false); toast(`Coupon ${c.code} created`); } catch (x) { toast(x.message); } };
  const toggle = async (c) => { const u = await api(`/coupons/${c.id}`, 'PUT', { active: !c.active }); setCoupons(coupons.map((x) => (x.id === c.id ? u : x))); };
  const delCoupon = async (c) => { await api(`/coupons/${c.id}`, 'DELETE'); setCoupons(coupons.filter((x) => x.id !== c.id)); };
  const testHook = async () => { if (!(await save())) return; setHook('Sending…'); const r = await api('/settings/test-webhook', 'POST'); setHook(r.skipped ? 'Add a URL first' : r.status >= 200 && r.status < 300 ? `✓ Delivered (HTTP ${r.status})` : `✕ Failed: ${r.error || `HTTP ${r.status}`} — we’ll retry automatically`); loadDeliveries(); };
  const rotate = async () => { if (!confirm('Generate a new signing secret? Your receiver must be updated to the new one.')) return; const r = await api('/settings/webhook-secret', 'POST'); setS({ ...s, webhookSecret: r.webhookSecret }); setShowSecret(true); toast('New signing secret generated'); };
  const retry = async (d) => { await api(`/webhooks/deliveries/${d.id}/retry`, 'POST'); loadDeliveries(); };

  return (
    <Layout title="Settings" subtitle="Payments, tracking, integrations and discounts.">
      <div className="settings">
        <Panel title="Business profile">
          <div className="form2">
            <label>Business name<input value={s.businessName} onChange={(e) => set({ businessName: e.target.value })} placeholder="e.g. Sharma Yoga Studio" /></label>
            <label>Support WhatsApp <small className="muted">· powers the WhatsApp buttons on your funnels</small><input value={s.supportWhatsapp} onChange={(e) => set({ supportWhatsapp: e.target.value })} placeholder="+91 98765 43210" /></label>
          </div>
          <button className="btn primary" onClick={() => save()}>Save</button>
        </Panel>

        <Panel title="Payments">
          <RazorpayPanel />
          <p className="hint">Stripe, Cashfree and PhonePe aren’t connected yet — Razorpay covers UPI, cards, netbanking, wallets and EMI in India.</p>
        </Panel>

        <Panel title="Tracking pixels">
          <p className="muted sm">Fires PageView on every step, Lead on opt-ins and Purchase on every sale — upsells and add-ons are reported with their own amount, each with a unique order id so Meta and Google never count a sale twice. Pixels don’t load in preview.</p>
          <div className="form2">
            <label>Meta (Facebook) Pixel ID<input value={s.tracking.fbPixel} onChange={(e) => set({ tracking: { ...s.tracking, fbPixel: e.target.value } })} placeholder="123456789012345" /></label>
            <label>Google Analytics 4 ID<input value={s.tracking.ga4} onChange={(e) => set({ tracking: { ...s.tracking, ga4: e.target.value } })} placeholder="G-XXXXXXX" /></label>
          </div>
          <button className="btn primary" onClick={() => save()}>Save tracking</button>
        </Panel>

        <Panel title="Webhooks">
          <p className="muted sm">We POST every new lead and order as JSON. Connect Zapier, Pabbly, Make, n8n, Google Sheets, your CRM or email tool.</p>
          <label className="full">Webhook URL<input value={s.webhookUrl} onChange={(e) => set({ webhookUrl: e.target.value })} placeholder="https://hooks.zapier.com/…" /></label>
          <div className="row"><button className="btn primary" onClick={() => save()}>Save</button><button className="btn ghost" onClick={testHook}><Icon name="send" size={15} /> Send test event</button>{hook && <span className="muted sm">{hook}</span>}</div>
          <p className="hint">Events: <code>lead.created</code>, <code>order.created</code>, <code>order.updated</code> (upsells & cross-sells), <code>automation.step</code> (from “Send to webhook” automation steps). Failed deliveries retry automatically for ~7 hours.</p>
          <div className="secret">
            <label>Signing secret</label>
            <div className="row"><code className="secret-v">{showSecret ? s.webhookSecret : `whsec_${'•'.repeat(24)}`}</code>
              <button className="icon-btn" title={showSecret ? 'Hide' : 'Show'} onClick={() => setShowSecret(!showSecret)}><Icon name="eye" size={15} /></button>
              <button className="icon-btn" title="Copy" onClick={() => { navigator.clipboard?.writeText(s.webhookSecret); toast('Secret copied'); }}><Icon name="copy" size={15} /></button>
              <button className="btn ghost sm" onClick={rotate}>Rotate</button></div>
            <p className="hint">Verify each request: <code>HMAC-SHA256(secret, t + "." + rawBody)</code> must equal <code>v1</code> in the <code>X-FunnelForge-Signature</code> header (<code>t=…,v1=…</code>). Use <code>X-FunnelForge-Delivery</code> to ignore duplicates.</p>
          </div>
          {deliveries.length > 0 && (
            <table className="tbl compact">
              <thead><tr><th>Event</th><th>Status</th><th className="r">Tries</th><th>Last result</th><th /></tr></thead>
              <tbody>{deliveries.slice(0, 8).map((d) => (
                <tr key={d.id}><td className="mono">{d.event}</td>
                  <td><span className={`pill ${d.status === 'delivered' ? 'ok' : d.status === 'failed' ? 'bad' : 'warn'}`}>{d.status}</span></td>
                  <td className="r">{d.attempts}</td><td className="muted sm">{d.lastError || (d.lastStatus ? `HTTP ${d.lastStatus}` : '—')}</td>
                  <td className="r">{d.status !== 'delivered' && <button className="btn ghost sm" onClick={() => retry(d)}>Retry</button>}</td></tr>
              ))}</tbody>
            </table>
          )}
        </Panel>

        <EmailPanel me={me} />

        <WhatsAppPanel />

        <Panel title="Discount coupons">
          <form className="coupon-form" onSubmit={addCoupon}>
            <input placeholder="CODE e.g. INDIA10" value={nc.code} onChange={(e) => setNc({ ...nc, code: e.target.value.toUpperCase() })} />
            <select value={nc.type} onChange={(e) => setNc({ ...nc, type: e.target.value })}><option value="percent">% off</option><option value="flat">₹ off</option></select>
            <input type="number" min="1" max={nc.type === 'percent' ? 100 : undefined} value={nc.value} onChange={(e) => setNc({ ...nc, value: e.target.value })} />
            <button className="btn primary" disabled={!nc.code}><Icon name="plus" size={15} /> Add</button>
            <button type="button" className="link-btn" onClick={() => setMore(!more)}>{more ? 'Fewer options' : 'Expiry & limits'}</button>
            {more && (
              <div className="coupon-more">
                <label>Expires on<input type="date" value={nc.expiresAt} onChange={(e) => setNc({ ...nc, expiresAt: e.target.value })} /></label>
                <label>Total uses allowed<input type="number" min="1" placeholder="Unlimited" value={nc.maxUses} onChange={(e) => setNc({ ...nc, maxUses: e.target.value })} /></label>
                <label>Minimum order (₹)<input type="number" min="0" placeholder="None" value={nc.minOrder} onChange={(e) => setNc({ ...nc, minOrder: e.target.value })} /></label>
                <label className="tog"><input type="checkbox" checked={nc.oncePerCustomer} onChange={(e) => setNc({ ...nc, oncePerCustomer: e.target.checked })} /><span />Once per customer (by email)</label>
                {funnels.length > 0 && <label className="full">Only for these funnels <small className="muted">· leave empty for all</small>
                  <select multiple value={nc.funnelIds} onChange={(e) => setNc({ ...nc, funnelIds: [...e.target.selectedOptions].map((o) => o.value) })}>{funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}
              </div>
            )}
          </form>
          {coupons.length ? (
            <table className="tbl compact"><thead><tr><th>Code</th><th>Discount</th><th>Rules</th><th className="r">Uses</th><th>Status</th><th /></tr></thead>
              <tbody>{coupons.map((c) => <tr key={c.id}><td className="mono strong">{c.code}</td><td>{c.type === 'percent' ? `${c.value}% off` : `₹${c.value} off`}</td><td className="muted sm">{couponRulesText(c, funnels)}</td><td className="r">{c.uses}{c.maxUses ? ` / ${c.maxUses}` : ''}</td><td><button className={`pill btnpill ${c.active ? 'ok' : ''}`} onClick={() => toggle(c)}>{c.active ? 'Active' : 'Paused'}</button></td><td className="r"><button className="icon-btn danger" onClick={() => delCoupon(c)}><Icon name="trash" size={15} /></button></td></tr>)}</tbody></table>
          ) : <p className="hint">Tip: your templates’ exit popups advertise <b>INDIA10</b> — create it here so it works at checkout.</p>}
        </Panel>

        <DomainsPanel />

        <HiveMcpPanel />

        <SecurityPanel me={me} onChange={() => api('/me').then(setMe)} />

        <Panel title="Demo data">
          <p className="muted sm">{me?.hasDemo ? 'Your account contains sample visits, leads and orders. Remove them before you go live — real data is never touched.' : 'No demo data in your account.'}</p>
          <button className="btn ghost danger" disabled={!me?.hasDemo} onClick={async () => { if (!confirm('Remove all demo data?')) return; const r = await api('/demo', 'DELETE'); toast(`Removed ${r.removed.orders} demo orders and ${r.removed.events} visits`); setMe(await api('/me')); }}><Icon name="trash" size={15} /> Remove demo data</button>
        </Panel>

        <Panel title="AI">
          <div className={`ai-card ${me?.aiEnabled ? 'on' : ''}`}>
            <Icon name="sparkles" size={22} />
            <div><b>{me?.aiEnabled ? `AI connected · ${me.aiProvider}` : 'Running the offline AI assistant'}</b>
              <p className="muted sm">{me?.aiEnabled ? 'Funnel generation, AI chat, page edits and marketing agents use this model — with your template library as built-in examples, so new pages follow the same structure and quality.' : 'Chat commands and template matching work offline. Set KIE_API_KEY in server/.env for AI copywriting and page generation.'}</p></div>
          </div>
        </Panel>
      </div>
    </Layout>
  );
}
