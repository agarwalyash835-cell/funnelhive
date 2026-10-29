import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Layout, Panel, Icon, toast, confirmDialog, promptDialog } from '../ui';
import { t } from '../appI18n';
import SecurityPanel from './SecurityPanel';
import { TeamPanel } from './Team';
import { PrivacyPanel } from './Privacy';
import { ApiKeysPanel } from './Developers';
import { AdSpendPanel } from './AdSpend';
import { AppsPanel } from './AppsPanel';
import { ActivityPanel } from './Agency';
import { allZones, zoneOption } from '../tzfmt';
import { EmailPanel, WhatsAppPanel, DomainsPanel, RazorpayPanel, StripePanel, HiveMcpPanel } from './SettingsChannels';
import { LeadSourcesPanel } from './LeadSources';


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
  const wrap = useRef(null); // the sections, for the jump bar
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
  useEffect(() => { api('/settings').then(setS).catch(() => setS(false)); api('/coupons').then(setCoupons).catch(() => {}); api('/me').then(setMe); api('/funnels').then(setFunnels).catch(() => {}); loadDeliveries().catch(() => {}); }, []);
  // a team member whose role manages the team but not the settings: just the team
  if (s === false) return <Layout title={t('Settings')}><div className="settings"><TeamPanel /></div></Layout>;
  if (!s) return <Layout title={t('Settings')}><div className="skeleton" /></Layout>;
  const set = (patch) => setS({ ...s, ...patch });
  const save = async (patch = s) => { try { setS(await api('/settings', 'PUT', patch)); toast(t('Settings saved')); return true; } catch (e) { toast(e.message); return false; } };
  const addCoupon = async (e) => { e.preventDefault(); try { const c = await api('/coupons', 'POST', nc); setCoupons([...coupons, c]); setNc(NC); setMore(false); toast(`Coupon ${c.code} created`); } catch (x) { toast(x.message); } };
  const toggle = async (c) => { const u = await api(`/coupons/${c.id}`, 'PUT', { active: !c.active }); setCoupons(coupons.map((x) => (x.id === c.id ? u : x))); };
  const delCoupon = async (c) => { await api(`/coupons/${c.id}`, 'DELETE'); setCoupons(coupons.filter((x) => x.id !== c.id)); };
  const testHook = async () => { if (!(await save())) return; setHook('Sending…'); const r = await api('/settings/test-webhook', 'POST'); setHook(r.skipped ? 'Add a URL first' : r.status >= 200 && r.status < 300 ? `✓ Delivered (HTTP ${r.status})` : `✕ Failed: ${r.error || `HTTP ${r.status}`} — we’ll retry automatically`); loadDeliveries(); };
  const rotate = async () => { if (!await confirmDialog({ title: 'Generate a new signing secret?', text: 'Your receiver must be updated to the new one.', confirm: 'Generate' })) return; const r = await api('/settings/webhook-secret', 'POST'); setS({ ...s, webhookSecret: r.webhookSecret }); setShowSecret(true); toast('New signing secret generated'); };
  const retry = async (d) => { await api(`/webhooks/deliveries/${d.id}/retry`, 'POST'); loadDeliveries(); };

  return (
    <Layout title={t('Settings')} subtitle={t('Payments, tracking, integrations and discounts.')}>
      <SectionNav of={wrap} rev={s} />
      <div className="settings" ref={wrap}>
        <Panel title={t('Business profile')}>
          <div className="form2">
            <label>{t('Business name')}<input value={s.businessName} onChange={(e) => set({ businessName: e.target.value })} placeholder={t('e.g. Sharma Yoga Studio')} /></label>
            <label>{t('Time zone')} <small className="muted">{t('· booking hours, webinars, “wait until” and report days')}</small><select value={s.timezone || 'Asia/Kolkata'} onChange={(e) => set({ timezone: e.target.value })}>{allZones().map((z) => <option key={z} value={z}>{zoneOption(z)}</option>)}</select></label>
            <label>{t('Support WhatsApp')} <small className="muted">{t('· powers the WhatsApp buttons on your funnels')}</small><input value={s.supportWhatsapp} onChange={(e) => set({ supportWhatsapp: e.target.value })} placeholder="+91 98765 43210" /></label>
          </div>
          <button className="btn primary" onClick={() => save()}>{t('Save')}</button>
        </Panel>

        <LeadSourcesPanel />

        <Panel title={t('Payments')}>
          <RazorpayPanel />
          <StripePanel />
          <p className="hint">{t('Stripe, Cashfree and PhonePe aren’t connected yet — Razorpay covers UPI, cards, netbanking, wallets and EMI in India.')}</p>
        </Panel>

        <Panel title={t('Tracking pixels')}>
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
          <GoogleAdsOffline />
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

        <AppsPanel />
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
            <div><b>{me?.aiEnabled ? `FunnelHive AI is on${me.aiProvider ? ` · ${me.aiProvider}` : ''}` : 'Running the offline AI assistant'}</b>
              <p className="muted sm">{me?.aiEnabled ? 'Funnel generation, AI chat, page edits and marketing agents use this model — with your template library as built-in examples, so new pages follow the same structure and quality.' : 'Chat commands and template matching work offline. AI copywriting and page generation turn on when full AI is enabled for your account.'}</p></div>
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
      <h4>Server-side tracking <span className={`pill ${st.metaToken || st.viaApps || st.ga4Secret ? 'ok' : ''}`}>{st.metaToken || st.viaApps || st.ga4Secret ? 'on' : 'off'}</span></h4>
      <p className="muted sm">Recovers the conversions the browser pixel misses (ad blockers, iOS, closed tabs). Events share ids with the pixel, so nothing is counted twice.</p>
      {st.viaApps && !st.metaToken && <p className="hint ok-t">Meta: on — sent through your Meta connection (Apps &amp; ads). No token needed.</p>}
      <div className="form2">
        <label>Meta Conversions API token {st.viaApps && !st.metaToken && <small className="muted">· optional, not needed</small>}{st.metaToken && <small className="ok-t">· connected</small>}<input type="password" value={f.metaToken} onChange={(e) => setF({ ...f, metaToken: e.target.value })} placeholder={st.metaToken ? '•••••••• (saved — paste a new one to replace)' : 'Events Manager → pixel → Settings → Generate access token'} disabled={!pixel} /></label>
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

// Google Ads offline conversions: sales that close days after the ad click (after a call, a quote) are imported
// into Google Ads from a secret feed it fetches on a schedule — or uploaded through the Google Ads API (beta)
const GADS_KINDS = [['purchase', 'Paid sales', 'net value in ₹, refunds off; test orders and unpaid COD left out'], ['booking', 'Booked calls', 'no value'], ['lead', 'Qualified applications', 'application forms that pass your questions; no value']];
function GoogleAdsOffline() {
  const [st, setSt] = useState(null);
  const [f, setF] = useState(null);
  const [a, setA] = useState({ developerToken: '', clientSecret: '', refreshToken: '' });
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState(false);
  const take = (x) => { setSt(x); setF({ names: { ...x.names }, include: { ...x.include }, hashed: x.hashed, api: { clientId: x.api.clientId, customerId: x.api.customerId, loginCustomerId: x.api.loginCustomerId, actions: { ...x.api.actions }, enabled: x.api.enabled } }); };
  useEffect(() => { api('/channels/gads').then(take).catch(() => {}); }, []);
  if (!st || !f) return null;
  const save = async (patch, msg = 'Offline conversions saved') => { try { take(await api('/channels/gads', 'PUT', patch)); setA({ developerToken: '', clientSecret: '', refreshToken: '' }); toast(msg); return true; } catch (e) { toast(e.message); return false; } };
  const rotate = async () => { if (!await confirmDialog({ title: 'Make a new feed address?', text: 'The old address stops working at once — update the schedule in Google Ads with the new one.', confirm: 'Make new address' })) return; take(await api('/channels/gads/rotate', 'POST')); toast('New address made'); };
  const saveApi = () => save({ api: { ...f.api, ...Object.fromEntries(Object.entries(a).filter(([, v]) => v)) } }, 'Google Ads API details saved');
  const testApi = async () => { setBusy('test'); try { const r = await api('/channels/gads/test', 'POST'); toast(r.ok ? `✓ Connected${r.actions?.length ? ` · ${r.actions.map((x) => x.name).join(', ')}` : ''}` : `✕ ${r.error}`); } catch (e) { toast(e.message); } setBusy(''); };
  const upload = async () => { setBusy('up'); try { const r = await api('/channels/gads/upload', 'POST'); take(r.status); toast(r.busy ? 'An upload is already running' : `Uploaded ${r.sent}${r.failed ? ` · ${r.failed} failed` : ''}${r.error ? ` · ${r.error}` : ''}`); } catch (e) { toast(e.message); } setBusy(''); };
  const setApi = (patch) => setF({ ...f, api: { ...f.api, ...patch } });
  const ap = st.api;
  return (
    <div className="srv-track">
      <h4>Google Ads offline conversions <span className={`pill ${st.eligible ? 'ok' : ''}`}>{st.eligible} in the last 90 days</span></h4>
      <p className="muted sm">Many sales close after a call — the lead came from a Google ad, the payment days later. FunnelHive credits each sale to the ad click that brought the person in (from the sale itself, or their earlier lead or booking) so Google Ads can optimise for real revenue, not just form fills.</p>
      <label className="full">Scheduled upload address <small className="muted">· secret — anyone with it can read these conversions</small>
        <div className="row"><input readOnly value={st.feedUrl} onFocus={(e) => e.target.select()} />
          <button className="icon-btn" title="Copy" aria-label="Copy the address" onClick={() => { navigator.clipboard?.writeText(st.feedUrl); toast('Address copied'); }}><Icon name="copy" size={15} /></button>
          <a className="btn ghost sm" href={`${st.feedUrl}&download=1`}><Icon name="download" size={15} /> Download CSV</a>
          <button className="btn ghost sm" onClick={rotate}>New address</button></div>
      </label>
      <div className="form2">
        {GADS_KINDS.map(([k, l, hint]) => (
          <div key={k}>
            <label className="tog"><input type="checkbox" checked={!!f.include[k]} onChange={(e) => setF({ ...f, include: { ...f.include, [k]: e.target.checked } })} /><span />{l} <small className="muted">· {hint}</small></label>
            <label>Conversion name in Google Ads<input value={f.names[k]} disabled={!f.include[k]} onChange={(e) => setF({ ...f, names: { ...f.names, [k]: e.target.value } })} /></label>
          </div>
        ))}
      </div>
      <label className="tog"><input type="checkbox" checked={!!f.hashed} onChange={(e) => setF({ ...f, hashed: e.target.checked })} /><span />Add hashed email and phone (enhanced conversions for leads) <small className="muted">· off by default; only for contacts who agreed on your form or whose consent you recorded — anyone who refused is never sent</small></label>
      <div className="row"><button className="btn primary" onClick={() => save({ names: f.names, include: f.include, hashed: f.hashed })}>Save offline conversions</button></div>
      {st.braidOnly > 0 && <p className="hint">{st.braidOnly} conversion(s) came from iOS clicks (gbraid / wbraid) — Google’s file import only takes gclid, so these are sent only by the API upload below.</p>}
      {st.preview.length > 0 ? (
        <table className="tbl compact">
          <thead><tr><th>Conversion</th><th>Click id</th><th>Time</th><th className="r">Value</th><th>Id</th></tr></thead>
          <tbody>{st.preview.map((r) => (
            <tr key={r.key}><td>{r.name}{(r.hashedEmail || r.hashedPhone) && <small className="sub-t">+ hashed {[r.hashedEmail && 'email', r.hashedPhone && 'phone'].filter(Boolean).join(' & ')}</small>}</td>
              <td className="mono sm">{r.gclid ? `${r.gclid.slice(0, 14)}…` : r.gbraid ? 'gbraid' : r.wbraid ? 'wbraid' : '—'}{r.clickFrom && <small className="sub-t">from an earlier lead/booking</small>}</td>
              <td className="muted sm">{r.time}</td><td className="r">{r.value != null ? `₹${r.value.toLocaleString('en-IN')}` : '—'}</td><td className="mono sm">{r.id}</td></tr>
          ))}</tbody>
        </table>
      ) : <p className="hint">Nothing to import yet: conversions appear here once a buyer who came through a Google ad (with a gclid) pays.</p>}
      <details className="hint">
        <summary>How to set it up in Google Ads</summary>
        <ol>
          <li>Google Ads → <b>Goals → Conversions → + New conversion action → Import</b>.</li>
          <li>Choose <b>Other data sources or CRMs → Track conversions from clicks</b>, then Continue.</li>
          <li>Name it exactly as above (e.g. <b>{f.names.purchase}</b>), category Purchase, value “Use different values for each conversion”, and save. Repeat for bookings / qualified leads if you turned them on.</li>
          <li>Go to <b>Goals → Conversions → Uploads → Schedules → + New schedule</b>, source <b>HTTPS</b>, paste the address above, and run it daily.</li>
          <li>Or upload once by hand: <b>Uploads → + → Upload a file</b> with the CSV from “Download CSV”.</li>
          <li>If your website tag already reports purchases to Google Ads, make one of the two actions “secondary” so each sale counts once. Clicks must be from the last 90 days, and Google can take a few hours to show imported conversions.</li>
        </ol>
      </details>
      <button className="link-btn" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Upload directly with the Google Ads API'} <span className="pill">beta</span></button>
      {open && (
        <div>
          <p className="muted sm">Optional, for accounts with Google Ads API access (a developer token from Tools → API Center and an OAuth client). Uploads new conversions every hour, each once; rows Google rejects are retried up to 3 times and listed below. The feed above keeps working either way. Secrets are stored encrypted.</p>
          <div className="form2">
            <label>Developer token {ap.developerToken && <small className="ok-t">· saved</small>}<input type="password" value={a.developerToken} onChange={(e) => setA({ ...a, developerToken: e.target.value })} placeholder={ap.developerToken ? '•••••••• (saved — paste to replace)' : 'Tools → API Center'} /></label>
            <label>OAuth client ID<input value={f.api.clientId} onChange={(e) => setApi({ clientId: e.target.value })} placeholder="1234-abc.apps.googleusercontent.com" /></label>
            <label>OAuth client secret {ap.clientSecret && <small className="ok-t">· saved</small>}<input type="password" value={a.clientSecret} onChange={(e) => setA({ ...a, clientSecret: e.target.value })} placeholder={ap.clientSecret ? '•••••••• (saved)' : 'GOCSPX-…'} /></label>
            <label>Refresh token {ap.refreshToken && <small className="ok-t">· saved</small>}<input type="password" value={a.refreshToken} onChange={(e) => setA({ ...a, refreshToken: e.target.value })} placeholder={ap.refreshToken ? '•••••••• (saved)' : '1//…'} /></label>
            <label>Customer ID<input value={f.api.customerId} onChange={(e) => setApi({ customerId: e.target.value })} placeholder="123-456-7890" /></label>
            <label>Manager (MCC) ID <small className="muted">· only if you sign in through one</small><input value={f.api.loginCustomerId} onChange={(e) => setApi({ loginCustomerId: e.target.value })} placeholder="optional" /></label>
            {GADS_KINDS.map(([k, l]) => <label key={k}>{l}: conversion action id<input value={f.api.actions[k]} onChange={(e) => setApi({ actions: { ...f.api.actions, [k]: e.target.value } })} placeholder="ctId from the action’s address, or customers/…/conversionActions/…" /></label>)}
          </div>
          <label className="tog"><input type="checkbox" checked={!!f.api.enabled} onChange={(e) => setApi({ enabled: e.target.checked })} /><span />Upload automatically every hour</label>
          <div className="row">
            <button className="btn primary" onClick={saveApi}>Save API details</button>
            <button className="btn ghost sm" disabled={!ap.ready || !!busy} onClick={testApi}>{busy === 'test' ? 'Testing…' : 'Test connection'}</button>
            <button className="btn ghost sm" disabled={!ap.ready || !!busy} onClick={upload}>{busy === 'up' ? 'Uploading…' : 'Upload now'}</button>
            {ap.ready && <button className="btn ghost sm" onClick={async () => (await confirmDialog({ title: 'Disconnect the Google Ads API?', confirm: 'Disconnect', danger: true })) && save({ api: null }, 'Google Ads API disconnected')}>Disconnect</button>}
          </div>
          {ap.lastRun && <p className="hint">Last upload {new Date(ap.lastRun).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}: {ap.lastResult?.sent || 0} sent, {ap.lastResult?.failed || 0} failed{ap.lastResult?.error ? ` · ${ap.lastResult.error}` : ''} · {ap.uploaded} uploaded in total.</p>}
          {ap.failing.length > 0 && (
            <table className="tbl compact"><thead><tr><th>Conversion</th><th className="r">Tries</th><th>Google said</th></tr></thead>
              <tbody>{ap.failing.map((x) => <tr key={x.key}><td className="mono sm">{x.key}</td><td className="r">{x.tries}</td><td className="muted sm">{x.err}</td></tr>)}</tbody></table>
          )}
        </div>
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
            <label>PIN code<input value={v.pincode || ''} inputMode="numeric" maxLength={6} onChange={(e) => set({ pincode: e.target.value.replace(/\D/g, '') })} placeholder="411001" /></label>
            <label>City / town<input value={v.city || ''} onChange={(e) => set({ city: e.target.value })} placeholder="Pune" /></label>
            <label>Phone<input value={v.phone || ''} inputMode="tel" onChange={(e) => set({ phone: e.target.value })} placeholder="9876543210" /></label>
            <label>State<select value={v.state} onChange={(e) => set({ state: e.target.value })} disabled={!!v.gstin && v.gstin.length === 15}><option value="">Choose…</option>{STATES.map((x) => <option key={x}>{x}</option>)}</select></label>
            <label>Default GST rate<select value={v.rate} onChange={(e) => set({ rate: Number(e.target.value) })}>{[0, 0.25, 3, 5, 12, 18, 28, 40].map((r) => <option key={r} value={r}>{r}%</option>)}</select></label>
            <label>Default HSN / SAC code<input value={v.sac} inputMode="numeric" maxLength={8} onChange={(e) => set({ sac: e.target.value.replace(/\D/g, '') })} placeholder="998431" /><small className="hint">For lines without a product (checkout prices, bumps, upsells, calls, quotes). Set a code and rate per product in Products → Settings.</small></label>
            <label>Invoice number prefix<input value={v.prefix} onChange={(e) => set({ prefix: e.target.value })} placeholder="INV" /><small className="hint">Numbers look like {v.prefix || 'INV'}/2026-27/0001 and restart every financial year.</small></label>
            <label>Email on invoices<input value={v.email} onChange={(e) => set({ email: e.target.value })} placeholder="accounts@yourbrand.in" /></label>
          </div>
          <p className="hint">E-invoicing: if your turnover is above ₹5 crore you must also generate e-invoices (IRN) on the government portal — FunnelHive makes the e-invoice JSON for your B2B invoices (Orders → order → GST, or the counter bill’s GST button) — upload it on the IRP portal and paste the IRN back; it then prints on the invoice. E-invoices and e-way bills need your PIN code above.</p>
          <div className="row"><button className="btn primary" onClick={() => save({ enabled: true })}>Save invoice settings</button><span className="hint">Business buyers can add their GSTIN at checkout once a GSTIN is saved here.</span></div>
        </>
      )}
    </Panel>
  );
}

// a long page of sections: chips that jump to each one (read from the panel headings, so new sections join by themselves)
function SectionNav({ of, rev }) {
  const [secs, setSecs] = useState([]);
  useEffect(() => {
    const t = setTimeout(() => setSecs([...(of.current?.querySelectorAll(':scope > .panel > .panel-h h3, :scope > * > .panel > .panel-h h3') || [])].map((h) => ({ el: h.closest('.panel'), name: h.textContent.trim() })).filter((x) => x.name)), 300);
    return () => clearTimeout(t);
  }, [of, rev]);
  if (secs.length < 4) return null;
  return (
    <nav className="set-nav" aria-label="Settings sections">
      {secs.map((x) => <button key={x.name} type="button" onClick={() => x.el.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{x.name}</button>)}
    </nav>
  );
}
