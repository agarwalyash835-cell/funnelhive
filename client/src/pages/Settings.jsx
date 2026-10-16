import { useEffect, useState } from 'react';
import { api } from '../api';
import { Layout, Panel, Icon, toast, confirmDialog, promptDialog } from '../ui';
import SecurityPanel from './SecurityPanel';
import { TeamPanel } from './Team';
import { PrivacyPanel } from './Privacy';
import { ApiKeysPanel } from './Developers';
import { AdSpendPanel } from './AdSpend';
import { ActivityPanel } from './Agency';
import { allZones, zoneOption } from '../tzfmt';
import { EmailPanel, WhatsAppPanel, DomainsPanel, RazorpayPanel, StripePanel, HiveMcpPanel } from './SettingsChannels';


// flat coupons are in one currency (₹500 off never applies to a $ price)
const CUR_SYMBOL = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AUD: 'A$', CAD: 'C$', SGD: 'S$', AED: 'AED ' };
const sym = (c) => CUR_SYMBOL[c.currency || 'INR'] || '₹';
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
  const NC = { code: '', type: 'percent', value: 10, currency: 'INR', expiresAt: '', maxUses: '', minOrder: '', oncePerCustomer: false, funnelIds: [] };
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
  const rotate = async () => { if (!await confirmDialog({ title: 'Generate a new signing secret?', text: 'Your receiver must be updated to the new one.', confirm: 'Generate' })) return; const r = await api('/settings/webhook-secret', 'POST'); setS({ ...s, webhookSecret: r.webhookSecret }); setShowSecret(true); toast('New signing secret generated'); };
  const retry = async (d) => { await api(`/webhooks/deliveries/${d.id}/retry`, 'POST'); loadDeliveries(); };

  return (
    <Layout title="Settings" subtitle="Payments, tracking, integrations and discounts.">
      <div className="settings">
        <Panel title="Business profile">
          <div className="form2">
            <label>Business name<input value={s.businessName} onChange={(e) => set({ businessName: e.target.value })} placeholder="e.g. Sharma Yoga Studio" /></label>
            <label>Time zone <small className="muted">· booking hours, webinars, “wait until” and report days</small><select value={s.timezone || 'Asia/Kolkata'} onChange={(e) => set({ timezone: e.target.value })}>{allZones().map((z) => <option key={z} value={z}>{zoneOption(z)}</option>)}</select></label>
            <label>Support WhatsApp <small className="muted">· powers the WhatsApp buttons on your funnels</small><input value={s.supportWhatsapp} onChange={(e) => set({ supportWhatsapp: e.target.value })} placeholder="+91 98765 43210" /></label>
          </div>
          <button className="btn primary" onClick={() => save()}>Save</button>
        </Panel>

        <Panel title="Payments">
          <RazorpayPanel />
          <StripePanel />
          <p className="hint">Stripe, Cashfree and PhonePe aren’t connected yet — Razorpay covers UPI, cards, netbanking, wallets and EMI in India.</p>
        </Panel>

        <Panel title="Tracking pixels">
          <p className="muted sm">Fires PageView on every step, ViewContent on sales pages, Lead on opt-ins, InitiateCheckout and AddPaymentInfo at checkout, and Purchase on every sale — upsells and add-ons are reported with their own amount, each with a unique id so Meta and Google never count a sale twice. Pixels don’t load in preview. UTM tags and Meta/Google click ids are saved on every lead and order automatically.</p>
          <div className="form2">
            <label>Meta (Facebook) Pixel ID<input value={s.tracking.fbPixel} onChange={(e) => set({ tracking: { ...s.tracking, fbPixel: e.target.value } })} placeholder="123456789012345" /></label>
            <label>Google Analytics 4 ID<input value={s.tracking.ga4} onChange={(e) => set({ tracking: { ...s.tracking, ga4: e.target.value } })} placeholder="G-XXXXXXX" /></label>
          </div>
          <p className="muted sm">Google Ads conversions: the AW- id and the label of each conversion action (Google Ads → Goals → Conversions → Tag setup). Leave a label blank to skip that action.</p>
          <div className="form2">
            {[['conversionId', 'Google Ads conversion ID', 'AW-123456789'], ['purchaseLabel', 'Purchase label', 'AbC-D_efG12'], ['leadLabel', 'Lead label', ''], ['bookingLabel', 'Booking label', '']].map(([k, l, ph]) => (
              <label key={k}>{l}<input value={s.tracking.googleAds?.[k] || ''} onChange={(e) => set({ tracking: { ...s.tracking, googleAds: { ...s.tracking.googleAds, [k]: e.target.value } } })} placeholder={ph} /></label>
            ))}
          </div>
          <button className="btn primary" onClick={() => save()}>Save tracking</button>
          <ServerTracking pixel={s.tracking.fbPixel} ga4={s.tracking.ga4} />
        </Panel>

        <InvoicingPanel s={s} setS={setS} />

        <Panel title="Webhooks">
          <p className="muted sm">We POST every new lead and order as JSON. Connect Zapier, Pabbly, Make, n8n, Google Sheets, your CRM or email tool.</p>
          <label className="full">Webhook URL<input value={s.webhookUrl} onChange={(e) => set({ webhookUrl: e.target.value })} placeholder="https://hooks.zapier.com/…" /></label>
          <div className="row"><button className="btn primary" onClick={() => save()}>Save</button><button className="btn ghost" onClick={testHook}><Icon name="send" size={15} /> Send test event</button>{hook && <span className="muted sm">{hook}</span>}</div>
          <p className="hint">Events: <code>lead.created</code>, <code>order.created</code>, <code>order.updated</code> (upsells & cross-sells), <code>order.refunded</code>, <code>booking.created</code>, <code>booking.rescheduled</code>, <code>booking.cancelled</code>, <code>webinar.registered</code>, <code>webinar.attended</code>, <code>webinar.missed</code>, <code>order.shipped</code>, <code>order.cancelled</code>, <code>automation.step</code> (from “Send to webhook” automation steps). Failed deliveries retry automatically for ~7 hours.</p>
          <div className="secret">
            <label>Signing secret</label>
            <div className="row"><code className="secret-v">{showSecret ? s.webhookSecret : `whsec_${'•'.repeat(24)}`}</code>
              <button className="icon-btn" title={showSecret ? 'Hide' : 'Show'} aria-label={showSecret ? 'Hide' : 'Show'} onClick={() => setShowSecret(!showSecret)}><Icon name="eye" size={15} /></button>
              <button className="icon-btn" title="Copy" aria-label="Copy" onClick={() => { navigator.clipboard?.writeText(s.webhookSecret); toast('Secret copied'); }}><Icon name="copy" size={15} /></button>
              <button className="btn ghost sm" onClick={rotate}>Rotate</button></div>
            <p className="hint">Verify each request: <code>HMAC-SHA256(secret, t + "." + rawBody)</code> must equal <code>v1</code> in the <code>X-FunnelHive-Signature</code> header (<code>t=…,v1=…</code>). Use <code>X-FunnelHive-Delivery</code> to ignore duplicates.</p>
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
            <select value={nc.type} onChange={(e) => setNc({ ...nc, type: e.target.value })}><option value="percent">% off</option><option value="flat">Amount off</option></select>
            {nc.type === 'flat' && <select value={nc.currency} onChange={(e) => setNc({ ...nc, currency: e.target.value })} title="Currency of the discount — it only applies to funnels priced in this currency">{Object.entries(CUR_SYMBOL).map(([k, v]) => <option key={k} value={k}>{v.trim()} {k}</option>)}</select>}
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
              <tbody>{coupons.map((c) => <tr key={c.id}><td className="mono strong">{c.code}</td><td>{c.type === 'percent' ? `${c.value}% off` : `${sym(c)}${c.value} off`}</td><td className="muted sm">{couponRulesText(c, funnels)}</td><td className="r">{c.uses}{c.maxUses ? ` / ${c.maxUses}` : ''}</td><td><button className={`pill btnpill ${c.active ? 'ok' : ''}`} onClick={() => toggle(c)}>{c.active ? 'Active' : 'Paused'}</button></td><td className="r"><button className="icon-btn danger" aria-label="Delete coupon" onClick={() => delCoupon(c)}><Icon name="trash" size={15} /></button></td></tr>)}</tbody></table>
          ) : <p className="hint">Tip: your templates’ exit popups advertise <b>INDIA10</b> — create it here so it works at checkout.</p>}
        </Panel>

        <DomainsPanel />

        <HiveMcpPanel />

        <TeamPanel />

        <ActivityPanel />

        <PrivacyPanel />

        <ApiKeysPanel />

        <AdSpendPanel />

        {!me?.workspace && <SecurityPanel me={me} onChange={() => api('/me').then(setMe)} />}

        {!me?.workspace && <Panel title="Your data">
          <p className="muted sm">Download everything in your account — funnels, contacts, leads, orders, automations and invoices — as one file. Deleting your account removes all of it permanently.</p>
          <div className="row">
            <button className="btn ghost" onClick={async () => { const r = await fetch('/api/account/export', { headers: { Authorization: `Bearer ${localStorage.getItem('ff_token')}` } }); if (!r.ok) return toast('Export failed'); const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = `account-export-${new Date().toISOString().slice(0, 10)}.json`; a.click(); }}><Icon name="download" size={15} /> Export my data</button>
            <button className="btn ghost danger" onClick={async () => {
              const password = await promptDialog({ title: 'Delete your account', text: 'This permanently deletes your account and all its data. Enter your password to continue:', label: 'Password', type: 'password', confirm: 'Continue', danger: true });
              if (!password) return;
              if (await promptDialog({ title: 'Delete your account', confirmWord: 'DELETE', confirm: 'Delete my account', danger: true }) !== 'DELETE') return toast('Not deleted');
              try { await api('/account/delete', 'POST', { password, confirm: 'DELETE' }); localStorage.removeItem('ff_token'); location.href = '/login'; } catch (e) { toast(e.message); }
            }}><Icon name="trash" size={15} /> Delete my account</button>
          </div>
        </Panel>}

        <Panel title="Demo data">
          <p className="muted sm">{me?.hasDemo ? 'Your account contains sample visits, leads and orders. Remove them before you go live — real data is never touched.' : 'No demo data in your account.'}</p>
          <button className="btn ghost danger" disabled={!me?.hasDemo} onClick={async () => { if (!await confirmDialog({ title: 'Remove all demo data?', confirm: 'Remove', danger: true })) return; const r = await api('/demo', 'DELETE'); toast(`Removed ${r.removed.orders} demo orders and ${r.removed.events} visits`); setMe(await api('/me')); }}><Icon name="trash" size={15} /> Remove demo data</button>
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

const STATES = ['Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];

// Meta Conversions API + GA4 Measurement Protocol: the server reports leads and sales too, so ad blockers,
// iOS privacy and buyers who close the tab before the thank-you page don't hide conversions
function ServerTracking({ pixel, ga4 }) {
  const [st, setSt] = useState(null);
  const [f, setF] = useState({ metaToken: '', metaTestCode: '', ga4Secret: '' });
  const [log, setLog] = useState([]);
  const load = () => { api('/channels/tracking').then((x) => { setSt(x); setF((v) => ({ ...v, metaTestCode: x.metaTestCode })); }); api('/conversions').then(setLog); };
  useEffect(() => { load(); }, []);
  if (!st) return null;
  const save = async (patch) => { try { setSt(await api('/channels/tracking', 'PUT', patch)); setF({ metaToken: '', ga4Secret: '', metaTestCode: patch.metaTestCode ?? f.metaTestCode }); toast('Server-side tracking saved'); } catch (e) { toast(e.message); } };
  return (
    <div className="srv-track">
      <h4>Server-side tracking <span className={`pill ${st.metaToken || st.ga4Secret ? 'ok' : ''}`}>{st.metaToken || st.ga4Secret ? 'on' : 'off'}</span></h4>
      <p className="muted sm">Recovers the conversions the browser pixel misses (ad blockers, iOS, closed tabs). Events share ids with the pixel, so nothing is counted twice.</p>
      <div className="form2">
        <label>Meta Conversions API token {st.metaToken && <small className="ok-t">· connected</small>}<input type="password" value={f.metaToken} onChange={(e) => setF({ ...f, metaToken: e.target.value })} placeholder={st.metaToken ? '•••••••• (saved — paste a new one to replace)' : 'Events Manager → pixel → Settings → Generate access token'} disabled={!pixel} /></label>
        <label>Meta test event code <small className="muted">· optional, while testing</small><input value={f.metaTestCode} onChange={(e) => setF({ ...f, metaTestCode: e.target.value })} placeholder="TEST12345" disabled={!pixel} /></label>
        <label>GA4 Measurement Protocol secret {st.ga4Secret && <small className="ok-t">· connected</small>}<input type="password" value={f.ga4Secret} onChange={(e) => setF({ ...f, ga4Secret: e.target.value })} placeholder={st.ga4Secret ? '•••••••• (saved)' : 'GA4 Admin → Data streams → Measurement Protocol API secrets'} disabled={!ga4} /></label>
      </div>
      {(!pixel || !ga4) && <p className="hint">{!pixel && 'Save your Meta Pixel ID above to connect the Conversions API. '}{!ga4 && 'Save your GA4 ID above to connect the Measurement Protocol.'}</p>}
      <div className="row">
        <button className="btn primary" disabled={!pixel && !ga4} onClick={() => save({ ...(f.metaToken ? { metaToken: f.metaToken } : {}), ...(f.ga4Secret ? { ga4Secret: f.ga4Secret } : {}), metaTestCode: f.metaTestCode })}>Save server-side tracking</button>
        {st.metaToken && <button className="btn ghost sm" onClick={async () => (await confirmDialog({ title: 'Disconnect the Meta Conversions API?', confirm: 'Disconnect', danger: true })) && save({ metaToken: '' })}>Disconnect Meta</button>}
        {st.ga4Secret && <button className="btn ghost sm" onClick={async () => (await confirmDialog({ title: 'Disconnect GA4 Measurement Protocol?', confirm: 'Disconnect', danger: true })) && save({ ga4Secret: '' })}>Disconnect GA4</button>}
      </div>
      {log.length > 0 && (
        <table className="tbl compact">
          <thead><tr><th>Event</th><th>To</th><th>Status</th><th>When</th><th /></tr></thead>
          <tbody>{log.slice(0, 10).map((d) => (
            <tr key={d.id}><td className="mono">{d.event}</td><td>{d.provider === 'meta' ? 'Meta' : 'GA4'}</td>
              <td><span className={`pill ${d.status === 'sent' ? 'ok' : d.status === 'failed' ? 'bad' : 'warn'}`}>{d.status}</span>{d.lastError && <small className="sub-t">{d.lastError}</small>}</td>
              <td className="muted sm">{new Date(d.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
              <td className="r">{d.status !== 'sent' && <button className="btn ghost sm" onClick={async () => { await api(`/conversions/${d.id}/retry`, 'POST'); load(); }}>Retry</button>}</td></tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

function InvoicingPanel({ s, setS }) {
  const [v, setV] = useState({ ...s.invoicing });
  const set = (patch) => setV({ ...v, ...patch });
  const save = async (patch = {}) => { try { const next = await api('/settings', 'PUT', { invoicing: { ...v, ...patch } }); setS(next); setV({ ...next.invoicing }); toast('Invoice settings saved'); } catch (e) { toast(e.message); } };
  return (
    <Panel title="GST invoices for your buyers" actions={<label className="tog"><input type="checkbox" checked={!!v.enabled} onChange={(e) => (e.target.checked ? set({ enabled: true }) : save({ enabled: false }))} /><span />{v.enabled ? 'On' : 'Off'}</label>}>
      <p className="muted sm">Every paid order gets a numbered invoice (one per payment — upsells get their own), emailed to the buyer with their purchase and linked on the thank-you page. Refunds issue credit notes. Your prices are treated as GST-inclusive. Without a GSTIN, invoices are issued without tax.</p>
      {v.enabled && (
        <>
          <div className="form2">
            <label>Legal business name<input value={v.legalName} onChange={(e) => set({ legalName: e.target.value })} placeholder="As registered, e.g. Sharma Learning Pvt Ltd" /></label>
            <label>GSTIN <small className="muted">· leave empty if not registered</small><input value={v.gstin} maxLength={15} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} placeholder="27ABCDE1234F1Z5" /></label>
            <label className="full">Address<input value={v.address} onChange={(e) => set({ address: e.target.value })} placeholder="Shown on invoices" /></label>
            <label>State<select value={v.state} onChange={(e) => set({ state: e.target.value })} disabled={!!v.gstin && v.gstin.length === 15}><option value="">Choose…</option>{STATES.map((x) => <option key={x}>{x}</option>)}</select></label>
            <label>Default GST rate<select value={v.rate} onChange={(e) => set({ rate: Number(e.target.value) })}>{[0, 0.25, 3, 5, 12, 18, 28, 40].map((r) => <option key={r} value={r}>{r}%</option>)}</select></label>
            <label>Default HSN / SAC code<input value={v.sac} inputMode="numeric" maxLength={8} onChange={(e) => set({ sac: e.target.value.replace(/\D/g, '') })} placeholder="998431" /><small className="hint">For lines without a product (checkout prices, bumps, upsells, calls, quotes). Set a code and rate per product in Products → Settings.</small></label>
            <label>Invoice number prefix<input value={v.prefix} onChange={(e) => set({ prefix: e.target.value })} placeholder="INV" /><small className="hint">Numbers look like {v.prefix || 'INV'}/2026-27/0001 and restart every financial year.</small></label>
            <label>Email on invoices<input value={v.email} onChange={(e) => set({ email: e.target.value })} placeholder="accounts@yourbrand.in" /></label>
          </div>
          <p className="hint">E-invoicing: if your turnover is above ₹5 crore you must also generate e-invoices (IRN) on the government portal — FunnelHive invoices don’t include an IRN yet.</p>
          <div className="row"><button className="btn primary" onClick={() => save({ enabled: true })}>Save invoice settings</button><span className="hint">Business buyers can add their GSTIN at checkout once a GSTIN is saved here.</span></div>
        </>
      )}
    </Panel>
  );
}
