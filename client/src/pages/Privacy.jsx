import { useEffect, useState } from 'react';
import { api } from '../api';
import { Panel, Icon, toast } from '../ui';

// Settings → Business & legal: who the seller is (needed before a funnel can be published), the consent banner
// and form consent (India's DPDP Act), the grievance officer, and the generated Privacy / Terms / Refund / Contact pages
export function PrivacyPanel() {
  const [v, setV] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/privacy').then(setV).catch(() => setV(false)); }, []);
  // links from the editor and publish errors land here (/settings#legal)
  useEffect(() => { if (v && location.hash === '#legal') document.getElementById('legal')?.scrollIntoView({ block: 'start' }); }, [!!v]);
  if (v === false) return null;
  if (!v) return <Panel title="Business & legal"><div className="skeleton sm" /></Panel>;
  const set = (patch) => setV({ ...v, ...patch });
  const save = async () => { setBusy(true); try { setV(await api('/privacy', 'PUT', v)); toast('Business & legal details saved'); } catch (e) { toast(e.message); } setBusy(false); };
  const pages = [['privacy', 'Privacy Policy'], ['terms', 'Terms & Conditions'], ['refund', 'Refund & Cancellation'], ['contact', 'Contact Us']];
  return (
    <div id="legal">
    <Panel title="Business & legal" actions={<button className="btn primary sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>}>
      <p className="muted sm">Indian law (Consumer Protection (E-Commerce) Rules, DPDP Act) needs your business name, address, contact and grievance officer on your pages, and clear consent before you collect personal data or use ad cookies. Payment gateways also ask for these policy pages when they verify your business. Fields marked * are needed before a funnel can be published.</p>
      {v.missing?.length > 0 && <p className="hint warn-t"><b>Before you can publish:</b> add your {v.missing.join(', ')}.</p>}
      <div className="row wrap">
        <label className="tog"><input type="checkbox" checked={v.banner} onChange={(e) => set({ banner: e.target.checked })} /><span />Cookie consent banner on my funnels (Meta Pixel / GA4 load only after “Accept”)</label>
        <label className="tog"><input type="checkbox" checked={v.checkbox} onChange={(e) => set({ checkbox: e.target.checked })} /><span />Require a consent tick box on opt-in and application forms</label>
      </div>
      <div className="form2">
        <label className="fld"><span>Legal business name *</span><input value={v.legalName || ''} maxLength={160} onChange={(e) => set({ legalName: e.target.value })} placeholder="As registered, e.g. Sharma Learning Pvt Ltd" /></label>
        <label className="fld"><span>Country of origin of goods <small className="muted">· default for physical products</small></span><input value={v.originDefault || ''} maxLength={60} onChange={(e) => set({ originDefault: e.target.value })} placeholder="India" /></label>
        <label className="fld full"><span>Business address * <small className="muted">· at least city and state</small></span><input value={v.address} maxLength={400} onChange={(e) => set({ address: e.target.value })} placeholder="Shop 4, Link Road, Andheri, Mumbai, Maharashtra 400053" /></label>
        <label className="fld"><span>Grievance officer *</span><input value={v.grievanceName} onChange={(e) => set({ grievanceName: e.target.value })} placeholder="Name" /></label>
        <label className="fld"><span>Grievance email * <small className="muted">· also your contact email</small></span><input type="email" value={v.grievanceEmail} onChange={(e) => set({ grievanceEmail: e.target.value })} placeholder="privacy@yourbusiness.in" /></label>
        <label className="fld"><span>Grievance phone</span><input value={v.grievancePhone || ''} maxLength={40} onChange={(e) => set({ grievancePhone: e.target.value })} placeholder="+91 98xxx xxxxx" /></label>
        <label className="fld full"><span>Consent wording <small className="muted">· shown under forms, saved with each sign-up</small></span><textarea rows={2} value={v.consentText} maxLength={400} onChange={(e) => set({ consentText: e.target.value })} placeholder={v.consentLine} /></label>
        <label className="fld"><span>Refund window</span><select value={v.refundDays} onChange={(e) => set({ refundDays: Number(e.target.value) })}>{[[0, 'No refunds (digital, instant delivery)'], [3, '3 days'], [7, '7 days'], [14, '14 days'], [30, '30 days']].map(([d, l]) => <option key={d} value={d}>{l}</option>)}</select></label>
        <label className="fld"><span>Your own privacy policy <small className="muted">· optional</small></span><input value={v.policyUrl} onChange={(e) => set({ policyUrl: e.target.value })} placeholder="https://… (otherwise the generated one)" /></label>
      </div>
      <div className="legal-links">{pages.map(([k, l]) => <a key={k} className="btn ghost sm" href={`${v.pages}/${k}`} target="_blank" rel="noreferrer"><Icon name="external" size={13} /> {l}</a>)}</div>
      <p className="hint">These pages update automatically from your business, invoice and support details (a funnel’s own legal details, in the editor, override them). Link them in your page footers and paste them into Razorpay / Stripe when asked for your website policies. To honour an erasure request, open the contact and use the 🗑 button.</p>
    </Panel>
    </div>
  );
}
