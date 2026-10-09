import { useEffect, useState } from 'react';
import { api } from '../api';
import { Panel, Icon, toast } from '../ui';

// Settings → Privacy & policies: the consent banner and form consent (India's DPDP Act), the grievance officer,
// and the Privacy / Terms / Refund / Contact pages generated from the business details
export function PrivacyPanel() {
  const [v, setV] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/privacy').then(setV).catch(() => setV(false)); }, []);
  if (v === false) return null;
  if (!v) return <Panel title="Privacy & policies"><div className="skeleton sm" /></Panel>;
  const set = (patch) => setV({ ...v, ...patch });
  const save = async () => { setBusy(true); try { setV(await api('/privacy', 'PUT', v)); toast('Privacy settings saved'); } catch (e) { toast(e.message); } setBusy(false); };
  const pages = [['privacy', 'Privacy Policy'], ['terms', 'Terms & Conditions'], ['refund', 'Refund & Cancellation'], ['contact', 'Contact Us']];
  return (
    <Panel title="Privacy & policies" actions={<button className="btn primary sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>}>
      <p className="muted sm">India’s Digital Personal Data Protection Act needs clear consent before you collect personal data or use ad cookies. Payment gateways also ask for these policy pages when they verify your business.</p>
      <div className="row wrap">
        <label className="tog"><input type="checkbox" checked={v.banner} onChange={(e) => set({ banner: e.target.checked })} /><span />Cookie consent banner on my funnels (Meta Pixel / GA4 load only after “Accept”)</label>
        <label className="tog"><input type="checkbox" checked={v.checkbox} onChange={(e) => set({ checkbox: e.target.checked })} /><span />Require a consent tick box on opt-in and application forms</label>
      </div>
      <div className="form2">
        <label className="fld full"><span>Consent wording <small className="muted">· shown under forms, saved with each sign-up</small></span><textarea rows={2} value={v.consentText} maxLength={400} onChange={(e) => set({ consentText: e.target.value })} placeholder={v.consentLine} /></label>
        <label className="fld"><span>Grievance officer</span><input value={v.grievanceName} onChange={(e) => set({ grievanceName: e.target.value })} placeholder="Name" /></label>
        <label className="fld"><span>Grievance email</span><input type="email" value={v.grievanceEmail} onChange={(e) => set({ grievanceEmail: e.target.value })} placeholder="privacy@yourbusiness.in" /></label>
        <label className="fld full"><span>Business address</span><input value={v.address} maxLength={400} onChange={(e) => set({ address: e.target.value })} placeholder="Shown on the Contact and Privacy pages" /></label>
        <label className="fld"><span>Refund window</span><select value={v.refundDays} onChange={(e) => set({ refundDays: Number(e.target.value) })}>{[[0, 'No refunds (digital, instant delivery)'], [3, '3 days'], [7, '7 days'], [14, '14 days'], [30, '30 days']].map(([d, l]) => <option key={d} value={d}>{l}</option>)}</select></label>
        <label className="fld"><span>Your own privacy policy <small className="muted">· optional</small></span><input value={v.policyUrl} onChange={(e) => set({ policyUrl: e.target.value })} placeholder="https://… (otherwise the generated one)" /></label>
      </div>
      <div className="legal-links">{pages.map(([k, l]) => <a key={k} className="btn ghost sm" href={`${v.pages}/${k}`} target="_blank" rel="noreferrer"><Icon name="external" size={13} /> {l}</a>)}</div>
      <p className="hint">These pages update automatically from your business, invoice and support details. Link them in your page footers and paste them into Razorpay / Stripe when asked for your website policies. To honour an erasure request, open the contact and use the 🗑 button.</p>
    </Panel>
  );
}
