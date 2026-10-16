import { useEffect } from 'react';
import { useSite, SiteHeader, SiteFooter } from './Landing';
import { inr } from '../ui';

// Plain-language policies built from the company details in Admin → Plan & settings.
// Have them reviewed by your lawyer before going live.
const UPDATED = '16 October 2026';

function Page({ title, children }) {
  const site = useSite();
  useEffect(() => { document.title = `${title} · ${site?.brand || 'FunnelHive'}`; }, [title, site]);
  return (
    <div className="site">
      <SiteHeader site={site} />
      <article className="legal"><h1>{title}</h1><p className="muted">Last updated {UPDATED}</p>{site ? children(site) : null}</article>
      <SiteFooter site={site} />
    </div>
  );
}
const who = (s) => s.company?.name || s.brand;
// a detail the owner hasn't filled in (Admin → Plan & settings) shows as “not set”, never a made-up address
const NotSet = () => <span className="muted">not set</span>;
const Mail = ({ to }) => (to ? <a href={`mailto:${to}`}>{to}</a> : <NotSet />);
const mail = (s) => s.company?.email || '';
const gr = (s) => s.company?.grievance || {};
const place = (s) => [s.company?.address, s.company?.state].filter(Boolean).join(', ');

// the grievance officer (IT Rules 2021, DPDP Act 2023): on the Terms, Privacy and Contact pages
const Grievance = ({ s }) => <>
  <h2>Grievance redressal</h2>
  <p>Our grievance officer handles complaints about the service, about content hosted on {s.brand}, and about how we handle personal data.</p>
  <div className="contact-card"><p><b>{gr(s).name || <NotSet />}</b>, Grievance Officer<br />Email: <Mail to={gr(s).email} />{gr(s).phone ? <><br />Phone: {gr(s).phone}</> : null}{place(s) ? <><br />{who(s)}, {place(s)}</> : null}</p></div>
  <p>We acknowledge every complaint within 24 hours and resolve it within 15 days. If you are not satisfied with how we handled a complaint about your personal data, you may approach the Data Protection Board of India.</p>
</>;

export const Terms = () => (
  <Page title="Terms of service">{(s) => <>
    <p>These terms are an agreement between you (“you”, the seller) and {who(s)} (“we”), which runs {s.brand}. By creating an account you accept them.</p>
    <h2>1. The service</h2>
    <p>{s.brand} lets you build sales funnels and landing pages, take payments through your own payment-gateway account, manage contacts and send automated emails and WhatsApp messages. Features may change as we improve the product.</p>
    <h2>2. Your account</h2>
    <p>You must be at least 18 and give accurate details. Keep your password safe; you are responsible for what happens in your account. One person or business per account.</p>
    <h2>3. Free trial and subscription</h2>
    <p>New accounts get a {s.trialDays}-day free trial. After that the service costs {s.prices ? `${inr(s.prices.monthly)} per month or ${inr(s.prices.yearly)} per year` : 'the price shown on our pricing page'}{s.gstRegistered ? ', inclusive of GST' : ''}, billed in advance through Razorpay and renewed automatically until you cancel. If a renewal payment fails we retry for a few days; if it still fails your account becomes read-only. We will give at least 30 days’ notice of any price change for existing subscribers.</p>
    <h2>4. Fair use and AI credits</h2>
    <p>Your plan includes a monthly allowance of AI credits. You may not use the service to send spam, to bypass the limits of WhatsApp or email providers, or in ways that harm the platform or other sellers.</p>
    <h2>5. What you may not do</h2>
    <p>You may not use {s.brand} for anything illegal, deceptive or harmful — including fake reviews or testimonials, misleading health or income claims, selling prohibited goods, phishing, or collecting data without consent. Marketing emails and WhatsApp broadcasts may go only to people who agreed to receive them. You are responsible for the content of your pages and for complying with laws that apply to your business, including consumer-protection, advertising, tax and data-protection laws — and for showing your correct business name, address and grievance officer on your pages.</p>
    <h2>6. Your content and your customers</h2>
    <p>You own your content and your customer data. You give us permission to host and process it only to provide the service. Payments from your customers go directly to your own payment-gateway account; we are not a party to those sales and do not handle refunds between you and your customers.</p>
    <h2>7. Suspension and termination</h2>
    <p>You can cancel at any time from Plan & billing and delete your account from Settings. We may suspend or close accounts that break these terms, after notice where reasonable. You can export your data at any time while your account exists.</p>
    <h2>8. Availability and liability</h2>
    <p>We work hard to keep {s.brand} available and secure and back up data daily, but the service is provided “as is”. To the extent the law allows, our total liability for any claim is limited to the amount you paid us in the three months before the claim, and we are not liable for indirect losses such as lost profits.</p>
    <h2>9. Governing law</h2>
    <p>These terms are governed by the laws of India. Courts at {s.company?.state || 'our registered office’s location'} have jurisdiction.</p>
    <h2>10. Reporting unlawful content</h2>
    <p>Sellers publish their own pages. If a page on {s.brand} is unlawful, infringes your rights, impersonates someone or is a scam, report it to our grievance officer (below) with the page link and the reason. We acknowledge reports within 24 hours and act within 15 days — sooner where the law requires: we remove or disable access within 36 hours of a court order or government notice, and within 24 hours of a complaint about content that shows a person’s private areas or a sexual act, or impersonates them. We may ask the seller to respond, and we keep records of removed content for as long as the law requires.</p>
    <Grievance s={s} />
    <h2>11. Contact</h2>
    <p>Questions? Write to <Mail to={mail(s)} />.</p>
  </>}</Page>
);

export const Privacy = () => (
  <Page title="Privacy policy">{(s) => <>
    <p>This policy explains what personal data {who(s)} collects through {s.brand} and how we use it, in line with India’s Digital Personal Data Protection Act, 2023.</p>
    <h2>Data about you (sellers)</h2>
    <p>Your name, email, password (stored only as a secure hash), business details, billing details (name, country, state, GSTIN, address), payment records from Razorpay and Stripe (we never see or store full card or UPI details), usage of the product and technical logs. We use it to run your account, bill you, prevent abuse, provide support and improve the product.</p>
    <h2>Data about your customers (data processing)</h2>
    <p>When visitors use your pages we store, on your behalf, what they submit (such as name, email, phone and form answers), their orders and their page visits. For this data you are the Data Fiduciary and {who(s)} is your Data Processor: we process it only to provide the service to you and on your instructions, never for our own marketing, and we help you answer your customers’ requests to access, correct or erase their data. You are responsible for having their consent, or another lawful reason, for what you collect and send.</p>
    <h2>Sub-processors</h2>
    <p>We share data only with providers that help run the service, and when the law requires it. We do not sell personal data.</p>
    <ul>
      <li><b>Hostinger</b> — the virtual private server that runs {s.brand} and holds its database.</li>
      <li><b>Wasabi</b> — encrypted off-site backups, uploads and product files (S3-compatible storage).</li>
      <li><b>Razorpay</b> and <b>Stripe</b> — subscription payments, and your customers’ payments into your own account.</li>
      <li><b>Meta (WhatsApp Business Platform)</b>, through the Hive WhatsApp API or your own Cloud API connection — WhatsApp messages.</li>
      <li><b>Email delivery</b> — our mail provider (Resend or SMTP), or the SMTP server you connect.</li>
      <li><b>Anthropic</b> (Claude) and <b>Kie.ai</b> — AI writing and image features, only for what you ask them to create.</li>
      <li><b>Google</b> — “Continue with Google” sign-in and Google Calendar, if you use them; <b>Cloudflare Turnstile</b> — bot checks on sign-up; <b>Sentry</b> — error reports, when switched on.</li>
    </ul>
    <h2>Cookies</h2>
    <p>The app uses browser storage to keep you signed in. Funnel pages may load the Meta Pixel or Google Analytics if the seller enables them — by default only after the visitor accepts the cookie notice.</p>
    <h2>Retention</h2>
    <p>We keep your data while your account exists. When you delete your account we delete its data, except invoices, which we must keep for tax law (8 years). Deleted data also leaves our backups over time: daily backups on our server are kept for 7 days, and encrypted off-site backups for 90 days.</p>
    <h2>Children</h2>
    <p>{s.brand} is not meant for anyone under 18. Sellers must not use it to collect children’s data without verifiable consent from a parent, and we do not track children or show them targeted advertising.</p>
    <h2>Data breaches</h2>
    <p>If a breach affects personal data, we contain it, tell the affected sellers and users without delay what happened and what they can do, and report it to the Data Protection Board of India (and CERT-In) as the law requires.</p>
    <h2>Your rights</h2>
    <p>You can access and export your data from Settings, correct it, withdraw consent, and delete your account at any time. For anything else, write to our grievance officer (below).</p>
    <h2>Security</h2>
    <p>Data is sent over HTTPS, passwords are hashed, payment and messaging secrets are encrypted, and two-step login is available for every account.</p>
    <Grievance s={s} />
  </>}</Page>
);

export const Refunds = () => (
  <Page title="Cancellation & refund policy">{(s) => <>
    <h2>Free trial</h2>
    <p>Every account starts with a {s.trialDays}-day free trial. You are not charged during the trial, and if you subscribe during it your first charge happens only when the trial ends.</p>
    <h2>Cancelling</h2>
    <p>You can cancel any time from Plan & billing. Your subscription will not renew, and you keep full access until the end of the period you have paid for.</p>
    <h2>Refunds</h2>
    <p>Subscription fees are not refunded for partial months or years, or for periods you didn’t use. If you were charged twice or charged by mistake, write to <Mail to={mail(s)} /> within 30 days and we will refund the extra amount to your original payment method within 5–7 working days.</p>
    <h2>Delivery</h2>
    <p>{s.brand} is an online software service: access is instant after sign-up and payment, and nothing is shipped.</p>
    <h2>Your customers</h2>
    <p>Refunds for products you sell through your funnels are between you and your customers, made through your own payment-gateway account.</p>
  </>}</Page>
);

export const Contact = () => (
  <Page title="Contact us">{(s) => <>
    <p>We’re happy to help with setup, billing or anything else.</p>
    <div className="contact-card">
      <p><b>Email</b><br /><Mail to={mail(s)} /></p>
      {s.company?.phone && <p><b>Phone</b><br />{s.company.phone}</p>}
      <p><b>Company</b><br />{s.company?.name || <NotSet />}{s.company?.cin ? <><br />CIN {s.company.cin}</> : null}{s.company?.gstin ? <><br />GSTIN {s.company.gstin}</> : null}</p>
      <p><b>Registered address</b><br />{place(s) || <NotSet />}</p>
    </div>
    <p className="muted">Write to us and we’ll get back to you as soon as we can.</p>
    <Grievance s={s} />
  </>}</Page>
);
