import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon, inr } from '../ui';

export const useSite = () => {
  const [s, setS] = useState(null);
  useEffect(() => { fetch('/api/site').then((r) => r.json()).then(setS).catch(() => setS({})); }, []);
  return s;
};

const FEATURES = [
  ['sparkles', 'Hive AI builds it for you', 'Describe your business in a chat. Hive AI writes and designs the landing page, checkout, upsell, downsell and thank-you page — then sets up your follow-up automations.'],
  ['layout', '53 templates for Indian niches', 'Coaching, courses, D2C brands, clinics, salons, real estate, events… each one a complete funnel you can edit with drag & drop.'],
  ['wallet', 'Checkout that converts', 'Razorpay checkout with UPI, cards and netbanking, order bumps, one-click upsells, cross-sells, coupons and abandoned-cart recovery.'],
  ['users', 'CRM & pipelines', 'Every lead and buyer in one place with a full timeline — visits, sign-ups, purchases, emails and WhatsApp messages. Kanban pipelines and custom fields.'],
  ['flow', 'Email + WhatsApp automations', 'Welcome sequences, cart reminders, post-purchase upsells and birthday offers with if/else branches, A/B splits and open & click tracking.'],
  ['globe', 'Your own domain', 'Publish on offer.yourbrand.in with free SSL. Pages are server-rendered, so they load fast and look great when shared on WhatsApp.'],
  ['chart', 'Analytics & A/B tests', 'Views, conversion, revenue per visitor and traffic sources per step — plus split tests that tell you when a winner is real.'],
  ['shield', 'Built for India', 'Prices in ₹, reports in IST, UPI checkout, GST invoices, WhatsApp built in, plus Meta Pixel and Google Analytics 4.'],
];
const STEPS = [['Tell Hive AI what you sell', 'One line is enough: “Online yoga classes for working women, ₹499”.'], ['Review and tweak', 'Edit any text or section, swap images, change colours. Everything is drag & drop.'], ['Publish and start selling', 'Connect Razorpay, publish on your domain, and watch leads and orders arrive.']];

export function SiteHeader({ site }) {
  return (
    <header className="site-h">
      <Link to="/" className="brand"><span className="logo"><Icon name="bolt" size={18} /></span>{site?.brand || 'FunnelHive'}</Link>
      <nav><a href="/#features">Features</a><a href="/#pricing">Pricing</a><a href="/#faq">FAQ</a></nav>
      <div className="row"><Link className="btn ghost sm" to="/login?mode=login">Log in</Link><Link className="btn primary sm" to="/login">Start free trial</Link></div>
    </header>
  );
}
export function SiteFooter({ site }) {
  const c = site?.company || {};
  return (
    <footer className="site-f">
      <div><b>{site?.brand || 'FunnelHive'}</b><p>AI sales funnels for Indian businesses.</p>{c.name && <small>{c.name}{c.address ? ` · ${c.address}` : ''}{c.gstin ? ` · GSTIN ${c.gstin}` : ''}</small>}</div>
      <nav><Link to="/terms">Terms of service</Link><Link to="/privacy">Privacy policy</Link><Link to="/refunds">Cancellation & refunds</Link><Link to="/contact">Contact</Link></nav>
    </footer>
  );
}

export default function Landing() {
  const site = useSite();
  const [yearly, setYearly] = useState(true);
  const p = site?.prices;
  const brand = site?.brand || 'FunnelHive';
  const FAQ = [
    ['Do I need a credit card for the trial?', `No. Sign up and use every feature free for ${site?.trialDays ?? 14} days. Subscribe only if you want to keep going.`],
    ['What does it cost after the trial?', p ? `${inr(p.monthly)} a month, or ${inr(p.yearly)} a year (${inr(p.yearlyPerMonth)}/month — two months free). One plan with everything included${site?.gstRegistered ? ', GST included' : ''}.` : ''],
    ['Do you take a cut of my sales?', 'No. Your customers pay you directly through your own Razorpay account. We never touch your revenue.'],
    ['Can I use my own domain?', 'Yes — connect as many domains as you like. SSL certificates are issued automatically.'],
    ['Will I get a GST invoice?', 'Yes, every payment comes with a downloadable GST invoice. Add your GSTIN in Billing to claim input tax credit.'],
    ['What if I cancel?', 'You keep full access until the end of the period you paid for, and you can export all your data at any time.'],
    ['What are AI credits?', `Each month you get ${site?.aiCredits?.paid?.toLocaleString('en-IN') ?? '1,500'} AI credits. Building a full funnel with AI uses 5; an AI edit or Hive AI message uses 1. Everything else is unlimited.`],
  ];
  return (
    <div className="site">
      <SiteHeader site={site} />
      <section className="hero-s">
        <span className="badge"><Icon name="sparkles" size={14} /> New: Hive AI — build a whole funnel by chatting</span>
        <h1>Sales funnels that sell,<br /><span>built by AI in minutes.</span></h1>
        <p>{brand} gives Indian businesses landing pages, checkout with UPI, upsells, CRM and WhatsApp automations — in one place, without hiring a developer.</p>
        <div className="row center"><Link className="btn primary lg" to="/login">Start your {site?.trialDays ?? 14}-day free trial</Link><a className="btn ghost lg" href="#pricing">See pricing</a></div>
        <small className="muted">No credit card needed · cancel any time</small>
        <div className="hero-flow" aria-hidden="true">
          {[['Landing page', 'layout', '1,284 visits'], ['Checkout', 'wallet', '212 orders'], ['Upsell', 'bolt', '+₹38,400'], ['Thank you', 'check', 'WhatsApp sent']].map(([t, ic, m], i) => (
            <div key={t} className="hf-step" style={{ animationDelay: `${i * 0.12}s` }}><span className="hf-ic"><Icon name={ic} size={18} /></span><b>{t}</b><small>{m}</small></div>
          ))}
        </div>
      </section>

      <section id="features" className="sec">
        <h2>Everything you need to sell online</h2>
        <p className="sec-sub">Replace five tools with one — and stop paying for each of them separately.</p>
        <div className="feat-grid">{FEATURES.map(([ic, t, d]) => <div key={t} className="feat"><span className="feat-ic"><Icon name={ic} size={20} /></span><h3>{t}</h3><p>{d}</p></div>)}</div>
      </section>

      <section className="sec how">
        <h2>Live in an afternoon</h2>
        <div className="how-grid">{STEPS.map(([t, d], i) => <div key={t}><span className="how-n">{i + 1}</span><h3>{t}</h3><p>{d}</p></div>)}</div>
      </section>

      <section id="pricing" className="sec">
        <h2>One simple plan. Everything included.</h2>
        <p className="sec-sub">Start free for {site?.trialDays ?? 14} days. No setup fees, no commission on your sales.</p>
        <div className="price-box">
          <div className="seg center-seg"><button className={!yearly ? 'on' : ''} onClick={() => setYearly(false)}>Monthly</button><button className={yearly ? 'on' : ''} onClick={() => setYearly(true)}>Yearly <span className="save-tag">2 months free</span></button></div>
          {p && <div className="plan-price big"><span className="amt">{inr(yearly ? p.yearly : p.monthly)}</span><span className="per">/{yearly ? 'year' : 'month'}</span></div>}
          {p && <p className="muted">{yearly ? `That’s ${inr(p.yearlyPerMonth)}/month — you save ${inr(p.yearlySaves)}` : 'Billed monthly, cancel any time'}{site?.gstRegistered ? ' · GST included' : ''}</p>}
          <ul className="plan-feats">{['Unlimited funnels & pages', 'Unlimited contacts & leads', 'Hive AI + AI page builder', `${site?.aiCredits?.paid?.toLocaleString('en-IN') ?? '1,500'} AI credits / month`, 'Email + WhatsApp automations', 'Custom domains with SSL', 'A/B tests & analytics', 'GST invoices'].map((f) => <li key={f}><Icon name="check" size={15} />{f}</li>)}</ul>
          <Link className="btn primary lg block" to="/login">Start free trial</Link>
        </div>
      </section>

      <section id="faq" className="sec faq">
        <h2>Questions, answered</h2>
        {FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
      </section>

      <section className="cta-band">
        <h2>Your next funnel is one sentence away.</h2>
        <Link className="btn lg" to="/login">Start free — {site?.trialDays ?? 14} days on us</Link>
      </section>
      <SiteFooter site={site} />
    </div>
  );
}
