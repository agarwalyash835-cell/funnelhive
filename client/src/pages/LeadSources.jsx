// Settings → Lead sources: IndiaMART, JustDial, Google Ads lead forms and the listing portals (by forwarded email)
// deliver enquiries straight into the CRM. Each card: the private address to paste, the steps, and a test lead.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Panel, Icon, toast, ago, confirmDialog } from '../ui';

// a blocked clipboard (no focus, permissions) said “Copied” anyway — say so instead
const copy = (v, what = 'Copied') => (navigator.clipboard ? navigator.clipboard.writeText(v).then(() => toast(what), () => toast('Couldn’t copy — select it and press Ctrl+C')) : toast('Couldn’t copy — select it and press Ctrl+C'));
const Copy = ({ label, value }) => (
  <label className="ls-copy"><span>{label}</span>
    <div className="ls-copy-row"><input readOnly value={value} onFocus={(e) => e.target.select()} /><button type="button" className="icon-btn" title="Copy" aria-label={`Copy ${label}`} onClick={() => copy(value, `${label} copied`)}><Icon name="copy" size={15} /></button></div>
  </label>
);
const Status = ({ st }) => (st?.count ? <span className="pill ok">{st.count} lead{st.count > 1 ? 's' : ''} in 30 days · last {ago(st.last)}</span> : <span className="pill">No leads yet</span>);

export function LeadSourcesPanel() {
  const [d, setD] = useState(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState('');
  const load = () => api('/lead-sources').then(setD).catch(() => setD(false));
  useEffect(() => { load(); }, []);
  if (d === false) return null; // a team member without access to settings
  if (!d) return <Panel className="ls-panel" title="Lead sources"><div className="skeleton" /></Panel>;
  const testLead = async (s) => { setBusy(s); try { const r = await api(`/lead-sources/test/${s}`, 'POST'); toast(r.ok ? 'Test lead added — see Contacts' : r.skipped || 'Sent'); load(); } catch (e) { toast(e.message); } setBusy(''); };
  const connectIm = async () => { setBusy('im'); try { const r = await api('/lead-sources/indiamart', 'PUT', { key }); setD(r); setKey(''); toast(r.pulled ? `Connected — ${r.pulled} enquiries from the last day brought in` : 'IndiaMART connected'); } catch (e) { toast(e.message); } setBusy(''); };
  const disconnectIm = async () => { if (!await confirmDialog({ title: 'Disconnect IndiaMART?', text: 'New IndiaMART enquiries stop coming in from the key. Leads already here stay.', confirm: 'Disconnect' })) return; setD(await api('/lead-sources/indiamart', 'DELETE')); };
  const rotate = async () => { if (!await confirmDialog({ title: 'Make new addresses?', text: 'The current IndiaMART, JustDial and Google links, the Google key and the lead email address stop working — you’ll need to paste the new ones everywhere.', confirm: 'Make new addresses', danger: true })) return; setD(await api('/lead-sources/rotate', 'POST')); toast('New addresses made'); };
  const jdMail = `Hello JustDial team,\n\nPlease push all leads for my JustDial listing to our CRM in real time using this webhook URL:\n${d.justdial.url}\n\nYou can send them as a POST (JSON or form) or a GET with the lead fields as parameters (leadid, name, mobile, email, category, area, city).\n\nThank you`;

  return (
    <Panel className="ls-panel" title="Lead sources" actions={<button type="button" className="btn ghost sm" onClick={rotate}>Make new addresses</button>}>
      <p className="muted sm" id="lead-sources">Enquiries from these sites come into your CRM by themselves — the contact is created (or found), the enquiry goes on their timeline tagged with where it came from, you get a notification, and your “New lead” automations (an instant WhatsApp or email reply, assigning a salesperson…) start right away. The same enquiry never comes in twice.</p>

      <div className="ls-grid">
        <section className="ls-card">
          <header><b>IndiaMART</b><Status st={d.stats.indiamart} /></header>
          <p className="muted sm">Buyer enquiries, Buy-Leads and call (PNS) leads. Needs a paid IndiaMART seller plan.</p>
          <h5>Real time (recommended)</h5>
          <ol className="ls-steps"><li>Open <b>seller.indiamart.com → Lead Manager → ⋮ → Import/Export Leads → Push API</b>.</li><li>Choose <b>Other</b>, name it <b>FunnelHive</b> and paste this address as the Webhook Listener URL.</li><li>Confirm with the OTP IndiaMART sends to your mobile.</li></ol>
          <Copy label="IndiaMART push URL" value={d.indiamart.pushUrl} />
          <h5>Or with your Pull API key <small className="muted">(also brings in the last day’s enquiries)</small></h5>
          {d.indiamart.connected ? (
            <div className="ls-on"><span className="pill ok">Connected · key {d.indiamart.keyHint}</span><small className="muted">{d.indiamart.lastError ? `Last check failed: ${d.indiamart.lastError}` : d.indiamart.lastPull ? `Checked ${ago(d.indiamart.lastPull)} · every 15 minutes` : ''}</small><button type="button" className="btn ghost sm" onClick={disconnectIm}>Disconnect</button></div>
          ) : (
            <div className="row" style={{ gap: 8 }}><input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Lead Manager → ⋮ → Import/Export Leads → Pull API → Generate Key" style={{ flex: 1 }} /><button type="button" className="btn primary sm" disabled={!key.trim() || busy === 'im'} onClick={connectIm}>{busy === 'im' ? 'Checking…' : 'Connect'}</button></div>
          )}
          <button type="button" className="btn ghost sm" disabled={busy === 'indiamart'} onClick={() => testLead('indiamart')}>Send a test lead</button>
        </section>

        <section className="ls-card">
          <header><b>JustDial</b><Status st={d.stats.justdial} /></header>
          <p className="muted sm">Enquiries on your JustDial listing. JustDial switches this on from their side — send them this address.</p>
          <ol className="ls-steps"><li>Copy the email below and send it to your JustDial account manager (or JustDial customer support), asking for “webhook lead push”.</li><li>Once they add it, every new JustDial lead appears here within seconds.</li></ol>
          <Copy label="JustDial webhook URL" value={d.justdial.url} />
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn ghost sm" onClick={() => copy(jdMail, 'Email for JustDial copied')}><Icon name="copy" size={14} /> Copy the email for JustDial</button>
            <button type="button" className="btn ghost sm" disabled={busy === 'justdial'} onClick={() => testLead('justdial')}>Send a test lead</button>
          </div>
        </section>

        <section className="ls-card">
          <header><b>Google Ads lead forms</b><Status st={d.stats.google_ads} /></header>
          <p className="muted sm">Leads from lead-form assets on your Search, Performance Max, YouTube and Discovery campaigns.</p>
          <ol className="ls-steps"><li>In Google Ads, open the campaign → <b>Assets → Lead form</b> → edit the form.</li><li>Under <b>Export leads from Google Ads → Other data integration options → Webhook</b>, paste the URL and the key below, and save.</li><li>Click <b>Send test data</b> — a test lead shows up here.</li></ol>
          <Copy label="Webhook URL" value={d.google.url} />
          <Copy label="Key" value={d.google.key} />
          <button type="button" className="btn ghost sm" disabled={busy === 'google_ads'} onClick={() => testLead('google_ads')}>Send a test lead</button>
        </section>

        <section className="ls-card">
          <header><b>Portals by email</b>{d.email.address && <Status st={Object.entries(d.stats).filter(([k]) => !['indiamart', 'justdial', 'google_ads'].includes(k)).reduce((a, [, s]) => ({ count: a.count + s.count, last: Math.max(a.last, s.last) }), { count: 0, last: 0 })} />}</header>
          <p className="muted sm">For portals without a lead API: <b>{d.email.portals.join(', ')}</b>. Their enquiry emails are read automatically and the buyer’s details go into your CRM, tagged with the portal.</p>
          {d.email.address ? (<>
            <Copy label="Your lead email address" value={d.email.address} />
            <ol className="ls-steps">
              <li>Where a portal lets you add another email for lead alerts (most do, under <b>My account / Profile → Contact details</b>), add this address.</li>
              <li>Or forward them automatically: in <b>Gmail → Settings → Forwarding</b> add this address, then make a filter “From: 99acres.com OR magicbricks.com OR housing.com OR nobroker.in OR sulekha.com OR tradeindia.com OR shiksha.com OR collegedunia.com” → <b>Forward to</b> it. In Outlook: <b>Rules → Forward to</b>.</li>
            </ol>
            {d.email.gmailCode && <p className="note-bar">Gmail sent a confirmation code for forwarding: <b>{d.email.gmailCode}</b> — paste it in Gmail → Settings → Forwarding{d.email.gmailLink && <> or <a href={d.email.gmailLink} target="_blank" rel="noreferrer">open the confirmation link</a></>}.</p>}
          </>) : <p className="note-bar">The lead email address is being switched on — it will appear here shortly.</p>}
        </section>
      </div>

      {d.recent.length > 0 && (<>
        <h4 className="ls-h4">Latest enquiries</h4>
        <table className="tbl compact"><tbody>{d.recent.slice(0, 10).map((e) => (
          <tr key={e.id}><td>{e.label}</td><td>{e.name || e.phone || e.email || '—'}{e.test && <small className="sub-t">test</small>}</td><td className="muted">{e.summary}</td>
            <td className="r muted">{e.status === 'new' ? 'New contact' : e.status === 'existing' ? 'Existing contact' : e.status === 'no-contact' ? 'No phone or email' : 'Not an enquiry'} · {ago(e.at)}</td></tr>
        ))}</tbody></table>
      </>)}
    </Panel>
  );
}
