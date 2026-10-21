// A business website made of funnel pages: Home, About, Services and Contact, each with the same header menu and
// footer. Used by the website templates and by Hive AI's create_website. No made-up numbers, reviews or urgency:
// stats and testimonials appear only when the seller gave real ones.
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const list = (v) => (Array.isArray(v) ? v : []);

export const WEBSITE_PAGES = [['home', 'Home'], ['about', 'About'], ['services', 'Services'], ['contact', 'Contact']];

export function websiteSteps(input = {}) {
  const brand = clip(input.brand, 60) || 'Your Brand';
  const ctaText = clip(input.ctaText, 40) || 'Get in touch';
  const services = list(input.services).slice(0, 9).map((s) => ({ icon: clip(s.icon, 4) || '✨', title: clip(s.title, 80), text: clip(s.text, 300), price: clip(s.price, 40) })).filter((s) => s.title);
  const owner = input.owner || {};
  const contact = input.contact || {};
  const testimonials = list(input.testimonials).slice(0, 6).map((t) => ({ name: clip(t.name, 60), quote: clip(t.quote, 400), tag: clip(t.tag, 60) })).filter((t) => t.name && t.quote);
  const stats = list(input.stats).slice(0, 4).map((x) => ({ value: clip(x.value, 20), label: clip(x.label, 60) })).filter((x) => x.value && x.label);
  const faqs = list(input.faqs).slice(0, 10).map((x) => ({ q: clip(x.q, 200), a: clip(x.a, 600) })).filter((x) => x.q && x.a);
  const steps = list(input.process).slice(0, 4).map((x) => ({ title: clip(x.title, 80), text: clip(x.text, 200) })).filter((x) => x.title);
  const wa = String(contact.whatsapp || contact.phone || '').replace(/\D/g, '');

  const links = WEBSITE_PAGES.map(([slug, label]) => ({ label, to: slug === 'home' ? '' : slug }));
  const nav = { type: 'navbar', props: { brand, logo: clip(input.logo, 500), links, buttonText: ctaText, buttonTo: 'contact' } };
  const foot = { type: 'footer', props: { brand, text: clip(input.tagline, 200) || clip(input.sub, 200), links, note: `© ${new Date().getFullYear()} ${brand}` } };
  const toContact = { ctaAction: 'page', ctaUrl: 'contact' };
  const cta = (headline, sub) => ({ type: 'cta', props: { variant: 'banner', headline, subheadline: sub, buttonText: ctaText, buttonAction: 'page', buttonUrl: 'contact', note: '' } });
  const pageHero = (headline, sub) => ({ type: 'hero', props: { variant: 'center', badge: '', headline, subheadline: sub, ctaText, ...toContact, secondaryText: '', showCard: false, showTrust: false, socialText: '', chip1: '', chip2: '', rating: '', reviews: '' } });
  const servicesBlock = (title, items) => ({ type: 'features', props: { variant: input.servicesVariant || (items.length > 4 ? 'grid' : 'cards'), eyebrow: 'Services', title, subtitle: '', items: items.map((s) => ({ icon: s.icon, title: s.price ? `${s.title} · ${s.price}` : s.title, text: s.text })) } });
  const about = { type: 'mentor', props: { variant: input.ownerVariant || 'split', eyebrow: `About ${brand}`, name: clip(owner.name, 80) || brand, role: clip(owner.role, 120), bio: clip(owner.bio, 1500), image: clip(owner.image, 500), points: list(owner.points).slice(0, 6).map((t) => ({ text: clip(t?.text ?? t, 160) })).filter((p) => p.text), badge: '' } };

  const home = [
    nav,
    { type: 'hero', props: { variant: input.heroVariant || 'split', badge: clip(input.badge, 80), headline: clip(input.headline, 160) || `${brand} — ${clip(input.tagline, 100)}`, subheadline: clip(input.sub, 300), ctaText, ...toContact, secondaryText: '', showCard: false, showTrust: false, socialText: '', chip1: '', chip2: '', rating: '', reviews: '', image: clip(input.heroImage, 500) } },
    ...(stats.length ? [{ type: 'stats', props: { items: stats } }] : []),
    ...(services.length ? [servicesBlock(clip(input.servicesTitle, 100) || 'How we can help', services.slice(0, 3))] : []),
    ...(steps.length ? [{ type: 'steps', props: { variant: input.processVariant || 'cards', eyebrow: 'How it works', title: 'Simple from the first call', items: steps } }] : []),
    ...(owner.bio ? [about] : []),
    ...(testimonials.length ? [{ type: 'testimonials', props: { eyebrow: 'Clients', title: 'What clients say', items: testimonials } }] : []),
    cta(clip(input.ctaHeadline, 120) || 'Let’s talk about what you need', clip(input.ctaSub, 200) || 'Tell us a little about yourself — we reply within one working day.'),
    foot,
  ];
  const aboutPage = [
    nav,
    pageHero(`The people and the story behind *${brand}*`, clip(input.tagline, 200)),
    about,
    ...(clip(input.story, 3000) ? [{ type: 'text', props: { title: 'Our story', body: clip(input.story, 3000) } }] : []),
    ...(stats.length ? [{ type: 'stats', props: { items: stats } }] : []),
    cta('Want to work together?', 'Send a message and we’ll take it from there.'),
    foot,
  ];
  const servicesPage = [
    nav,
    pageHero('Services built around *what you need*', clip(input.servicesIntro, 300) || `What ${brand} can do for you.`),
    ...(services.length ? [servicesBlock('Everything we offer', services)] : [{ type: 'text', props: { title: 'What we offer', body: 'Describe your services here.' } }]),
    ...(faqs.length ? [{ type: 'faq', props: { eyebrow: 'FAQ', title: 'Questions, answered', items: faqs } }] : []),
    cta('Not sure what fits?', 'Tell us what you need and we’ll suggest the right option.'),
    foot,
  ];
  const lines = [contact.phone && `📞 ${clip(contact.phone, 40)}`, contact.email && `✉️ ${clip(contact.email, 120)}`, contact.address && `📍 ${clip(contact.address, 300)}`, contact.hours && `🕘 ${clip(contact.hours, 120)}`].filter(Boolean);
  const contactPage = [
    nav,
    pageHero('Let’s talk about *what you need*', clip(input.contactIntro, 300) || 'Tell us what you need — we reply within one working day.'),
    { type: 'form', props: { title: 'Send us a message', subtitle: '', fields: [{ label: 'Full name', type: 'text', required: true }, { label: 'Email', type: 'email', required: true }, { label: 'WhatsApp number', type: 'tel', required: false }, { label: 'How can we help?', type: 'textarea', required: false }], buttonText: 'Send message', after: 'message', successMessage: 'Thank you! We’ll get back to you shortly.', note: '🔒 We never share your details.' } },
    ...(lines.length ? [{ type: 'text', props: { title: 'Other ways to reach us', body: lines.join('\n') } }] : []),
    // no number given: 919999999999 means “the Support WhatsApp from Settings” (hidden when there isn't one)
    { type: 'whatsapp', props: { number: wa.length === 10 ? `91${wa}` : wa.length >= 11 ? wa : '919999999999', message: `Hi ${brand}! I have a question.`, label: 'Chat on WhatsApp' } },
    foot,
  ];
  return [
    { name: 'Home', type: 'landing', slug: 'home', blocks: home },
    { name: 'About', type: 'landing', slug: 'about', blocks: aboutPage },
    { name: 'Services', type: 'landing', slug: 'services', blocks: servicesPage },
    { name: 'Contact', type: 'landing', slug: 'contact', blocks: contactPage },
  ];
}

// Gallery templates: sample copy the seller replaces (no invented proof)
export const WEBSITE_TEMPLATES = [
  {
    id: 'site-coach', category: 'Coaching', name: 'Coach website', style: 'pastel', color: '#7c3aed',
    input: {
      brand: 'Ananya Rao Coaching', tagline: 'Career and confidence coaching for working professionals', badge: '1:1 coaching · online',
      headline: 'Find work that fits *who you are*', sub: 'Clear, practical coaching for professionals who feel stuck — so you can decide your next move with confidence.', ctaText: 'Book a free call', heroVariant: 'editorial',
      services: [
        { icon: '🧭', title: 'Career clarity sessions', text: 'Three focused sessions to work out what you want next and the steps to get there.' },
        { icon: '🎤', title: 'Interview preparation', text: 'Mock interviews and feedback for the roles you actually want.' },
        { icon: '💬', title: 'Confidence coaching', text: 'Speak up in meetings and negotiate without second-guessing yourself.' },
        { icon: '📄', title: 'CV & LinkedIn review', text: 'A rewrite that tells your story in the words recruiters search for.' },
      ],
      process: [{ title: 'Free 20-minute call', text: 'We talk about where you are and where you want to be.' }, { title: 'A plan for you', text: 'You get a clear plan with the sessions that fit.' }, { title: 'Weekly sessions', text: 'Online, at a time that suits your work.' }],
      owner: { name: 'Ananya Rao', role: 'Career coach', bio: 'Write a few lines about your background, who you help and why you do this work.', points: ['Your qualification or certification', 'Who you’ve worked with', 'Your approach in one line'] },
      faqs: [{ q: 'Are sessions online?', a: 'Yes — on Google Meet or Zoom, at a time that suits you.' }, { q: 'How do I start?', a: 'Book a free call from the Contact page and we’ll take it from there.' }],
      contact: { email: 'hello@yourbrand.in', hours: 'Mon–Sat, 10 am – 7 pm' },
    },
  },
  {
    id: 'site-consultant', category: 'Consulting', name: 'Consultant website', style: 'clean', color: '#0f766e',
    input: {
      brand: 'Mehta Business Advisory', tagline: 'Growth and finance advice for small businesses', badge: 'For founders & SMEs',
      headline: 'Grow your business *with the numbers on your side*', sub: 'Practical advice on pricing, cash flow and growth for owner-run businesses across India.', ctaText: 'Book a consultation', heroVariant: 'editorial', servicesVariant: 'zigzag', processVariant: 'timeline', ownerVariant: 'story',
      services: [
        { icon: '📊', title: 'Cash-flow planning', text: 'Know what’s coming in and going out for the next 12 months.' },
        { icon: '🏷️', title: 'Pricing review', text: 'Find out which products make money and price them properly.' },
        { icon: '🚀', title: 'Growth strategy', text: 'A focused plan for your next stage, with clear owners and dates.' },
        { icon: '🤝', title: 'Monthly advisory', text: 'A monthly session and support on WhatsApp in between.' },
      ],
      process: [{ title: 'Discovery call', text: 'A short call to understand your business.' }, { title: 'Proposal', text: 'A clear scope and fee — no surprises.' }, { title: 'Work together', text: 'Regular check-ins until the plan is in place.' }],
      owner: { name: 'Rohit Mehta', role: 'Founder & advisor', bio: 'Write a few lines about your experience and the kind of businesses you help.', points: ['Your qualification', 'Industries you know well', 'How you work with clients'] },
      contact: { email: 'hello@yourbrand.in', address: 'Your office address', hours: 'Mon–Fri, 10 am – 6 pm' },
    },
  },
  {
    id: 'site-clinic', category: 'Health & Wellness', name: 'Clinic / practice website', style: 'aurora', color: '#0284c7',
    input: {
      brand: 'Sunrise Physiotherapy', tagline: 'Physiotherapy and rehabilitation in your neighbourhood', badge: 'Clinic & home visits',
      headline: 'Move *without pain* again', sub: 'Assessment, treatment and an exercise plan that fits your day — at the clinic or at home.', ctaText: 'Book an appointment', heroVariant: 'banner',
      services: [
        { icon: '🦴', title: 'Back & neck pain', text: 'Assessment and treatment for everyday aches and long-standing pain.' },
        { icon: '🏃', title: 'Sports injuries', text: 'Get back to your game with a guided recovery plan.' },
        { icon: '🦵', title: 'Post-surgery rehab', text: 'Rebuild strength and movement after knee, hip or shoulder surgery.' },
        { icon: '🏠', title: 'Home visits', text: 'Treatment at home for those who can’t travel.' },
      ],
      owner: { name: 'Dr. Your Name', role: 'Physiotherapist', bio: 'Write about your qualifications, registration and experience.', points: ['Degree and registration', 'Areas you specialise in'] },
      faqs: [{ q: 'Do I need a doctor’s referral?', a: 'No — you can book an assessment directly.' }, { q: 'Do you do home visits?', a: 'Yes, within the areas listed on this page.' }],
      contact: { address: 'Your clinic address', hours: 'Mon–Sat, 8 am – 8 pm' },
    },
  },
];
