// Builds the VSL + application funnels and the webinar funnels from their copy
// (templates-vsl.js, templates-webinar.js). Section layouts and order vary per template.

const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const inr = (n) => '₹' + Number(n).toLocaleString('en-IN');
const split = (s) => String(s).split('|');
const pairs = (arr, ...keys) => arr.map((s) => Object.fromEntries(split(s).map((v, i) => [keys[i], v])));
const emojiOf = (s) => (String(s).match(/^\S+/) || ['✦'])[0];
const plain = (h) => h.replace(/\*/g, '');
const WA = '919999999999';

// people for the "just applied / just registered" popups
const FIRST = ['Aarav', 'Ishita', 'Kabir', 'Meher', 'Vihaan', 'Tanvi', 'Rehan', 'Diya', 'Arnav', 'Sana', 'Yash', 'Nandini', 'Pranav', 'Zoya', 'Siddharth', 'Riya', 'Harsh', 'Ananya'];
const LAST = ['S.', 'K.', 'M.', 'R.', 'P.', 'N.', 'G.', 'D.', 'T.', 'B.'];
const TOWNS = ['Indore', 'Kochi', 'Guwahati', 'Ludhiana', 'Coimbatore', 'Nagpur', 'Surat', 'Bhubaneswar', 'Mysuru', 'Dehradun', 'Vadodara', 'Ranchi', 'Pune', 'Jaipur', 'Lucknow', 'Hyderabad', 'Chennai', 'Bengaluru'];
const popups = (h) => Array.from({ length: 12 }, (_, i) => ({ name: `${FIRST[(h + i * 5) % FIRST.length]} ${LAST[(h + i) % LAST.length]}`, city: TOWNS[(h + i * 7) % TOWNS.length] }));

// Order a page: fixed sections stay put, the middle ones are reshuffled per template
function arrange(blocks, h, movable) {
  const mid = blocks.filter((b) => movable.includes(b.type));
  const swaps = [[0, 2], [1, 3], [2, 4], [0, 1]];
  swaps.forEach(([a, b], r) => { if (((h >> (r + 3)) & 1) && mid[a] && mid[b]) [mid[a], mid[b]] = [mid[b], mid[a]]; });
  let k = 0;
  return blocks.map((b) => (movable.includes(b.type) ? mid[k++] : b));
}
const variantPicker = (h) => (opts, salt) => opts[(h + salt * 7) % opts.length];

// ---------- VSL + application ----------
export function buildVsl(t) {
  const h = hash(t.id);
  const pick = variantPicker(h);
  const [ename, erole, ebio] = split(t.expert);
  const [gTitle, gBody] = split(t.guarantee);
  const stats = pairs(t.stats, 'value', 'label');
  const results = pairs(t.results, 'name', 'quote', 'tag');
  const chapters = t.chapters.map((c) => { const [time, title] = split(c); return { text: `${time} · ${title}` }; });
  const faq = pairs(t.faqs, 'q', 'a');
  const apply = { ctaText: t.cta };
  const hero = {
    variant: t.hero, badge: t.badge, headline: t.headline, subheadline: t.sub, ...apply, secondaryText: 'See client results',
    rating: t.rating, reviews: t.reviews, socialText: t.social, image: '', cardEmoji: emojiOf(t.badge), cardTitle: t.name, cardPrice: 'By application', cardMrp: '',
    cardPoints: chapters, chip1: `⏳ ${t.urgency}`, chip2: '🔒 Your answers stay private', cardTag: 'Free training', videoUrl: '', videoNote: t.videoNote, videoLength: t.videoLength,
  };
  const watch = [
    { type: 'hellobar', props: { messages: [{ text: `⏳ ${t.urgency}` }, { text: '🎥 Watch the full video, then apply for your call' }] } },
    { type: 'hero', props: hero },
    { type: 'stats', props: { variant: pick(['strip', 'band', 'cards'], 1), items: stats } },
    { type: 'problem', props: { variant: pick(['split', 'list', 'cards'], 2), eyebrow: pick(['Sound familiar?', 'The real problem', 'If this is you'], 3), title: pick(['Why hard work alone isn’t getting you there', 'What’s really holding you back', 'You’re not short of effort'], 4), subtitle: 'Every applicant we speak to says some version of this.', items: t.pains.map((text) => ({ text })), closing: `${t.name} was built to fix exactly this. 👇` } },
    { type: 'features', props: { variant: pick(['zigzag', 'grid', 'list', 'cards'], 5), eyebrow: pick(['The method', 'How it works', 'What you get'], 6), title: `Inside ${t.name}`, subtitle: 'Four parts, built around where you are today.', items: pairs(t.pillars, 'icon', 'title', 'text') } },
    { type: 'testimonials', props: { variant: pick(['spotlight', 'cards', 'wall'], 7), eyebrow: 'Results', title: pick(['What changed for our clients', 'Real people, real numbers', 'In their own words'], 8), items: results } },
    { type: 'compare', props: { variant: pick(['columns', 'table'], 9), eyebrow: 'Is this for you?', title: 'We only work with people we can help', leftTitle: 'Not a fit if…', rightTitle: 'A great fit if…', tag: 'You?', rows: pairs(t.fit, 'left', 'right') } },
    { type: 'mentor', props: { variant: pick(['story', 'split', 'card'], 10), eyebrow: pick(['Who you’ll work with', 'Behind the programme', 'Your guide'], 11), name: ename, role: erole, bio: ebio, image: '', points: t.creds.map((text) => ({ text })) } },
    { type: 'steps', props: { variant: pick(['timeline', 'cards', 'columns'], 12), eyebrow: 'Next steps', title: 'What happens after you apply', items: pairs(t.process, 'title', 'text') } },
    { type: 'guarantee', props: { variant: pick(['strip', 'box'], 13), title: gTitle, body: gBody, days: 0 } },
    { type: 'faq', props: { variant: pick(['accordion', 'two'], 14), eyebrow: 'FAQ', title: 'Questions before you apply', items: faq } },
    { type: 'cta', props: { variant: pick(['banner', 'plain'], 15), headline: 'Ready to see if it’s a fit?', subheadline: `Applications take about 3 minutes. ${t.urgency}.`, buttonText: t.cta, note: '✅ Free call · ✅ No obligation · ✅ Every application reviewed personally' } },
    { type: 'stickybar', props: { text: t.urgency, price: 'By application', buttonText: 'Apply now' } },
    { type: 'proof', props: { action: 'just applied for a call', intervalSec: 12, items: popups(h) } },
    { type: 'whatsapp', props: { number: WA, message: `Hi! I have a question about ${t.name}.`, label: 'Questions? Chat with us' } },
  ];
  const fields = [
    { label: 'Full name', type: 'text', required: true },
    { label: 'Email', type: 'email', required: true },
    { label: 'WhatsApp number', type: 'tel', required: true },
    ...t.questions.map((q) => ({ label: q.label, type: 'select', options: q.options, required: true, ...(q.reject ? { reject: q.reject } : {}) })),
  ];
  const application = [
    { type: 'hellobar', props: { messages: [{ text: 'Step 2 of 3 · Takes about 3 minutes' }, { text: '🔒 Reviewed personally — never shared' }] } },
    { type: 'form', props: { title: t.formTitle, subtitle: t.formSub, fields, buttonText: 'Submit my application', after: 'next', successMessage: 'Application received — taking you to the next step…', rejectMessage: t.rejectMessage, note: '🔒 Your answers are private and only seen by our team.' } },
    { type: 'testimonials', props: { variant: 'cards', eyebrow: 'You’re in good company', title: 'People who applied before you', items: results.slice(0, 3) } },
    { type: 'whatsapp', props: { number: WA, message: `Hi! I’m filling the application for ${t.name}.`, label: 'Need help?' } },
  ];
  const booked = [
    { type: 'thankyou', props: { headline: 'You’re a fit — pick a time for your call 🎉', body: 'Choose a slot below. You’ll get the confirmation and joining link on email right away.', steps: t.booked.map((text) => ({ text })) } },
    { type: 'booking', props: { calendarId: '', eyebrow: 'Book your call', title: `Pick a time for your call — ${t.name}`, subtitle: 'Times are shown in your own time zone. Takes 20 seconds.', buttonText: 'Confirm my call', successTitle: 'Your call is booked ✅', successText: 'The confirmation, calendar invite and joining link are in your email. Can’t make it? Use the reschedule link in that email.', qualifiedOnly: true } },
    { type: 'testimonials', props: { variant: 'spotlight', eyebrow: 'Before your call', title: 'What to expect', items: results.slice(2, 5) } },
    { type: 'whatsapp', props: { number: WA, message: `Hi! I just applied for ${t.name}.`, label: 'Message us' } },
  ];
  const steps = [
    { name: 'Watch the video', type: 'sales', slug: 'watch', blocks: arrange(watch, h, ['problem', 'features', 'testimonials', 'compare', 'mentor']) },
    { name: 'Application', type: 'optin', slug: 'apply', blocks: application },
    { name: 'Book your call', type: 'thankyou', slug: 'book-call', blocks: booked },
  ];
  return { id: t.id, category: t.category, name: t.name, style: t.style, kind: 'vsl', type: 'vsl', headline: plain(t.headline), steps, color: t.color };
}

// ---------- webinar ----------
export function buildWebinar(t) {
  const h = hash(t.id);
  const pick = variantPicker(h);
  const [hname, hrole, hbio] = split(t.host);
  const [gTitle, gBody] = split(t.guarantee);
  const o = t.offer;
  const disc = Math.round((1 - o.price / o.mrp) * 100);
  const stats = pairs(t.stats, 'value', 'label');
  const quotes = pairs(t.testimonials, 'name', 'quote', 'tag');
  const learn = pairs(t.learn, 'icon', 'title', 'text');
  const bonusItems = t.bonuses.map((s) => { const [icon, title, value] = split(s); return { icon, title, value: inr(value) }; });
  const bonusTotal = t.bonuses.reduce((a, s) => a + Number(split(s)[2]), 0);
  const faq = pairs(t.faqs, 'q', 'a');
  const mins = Number((t.length.match(/(\d+)\s*min/) || [])[1]) || 90;
  const agendaTitle = (s) => split(s)[0].replace(/^[\d:–-]+\s*(min|mins)?\s*[·:—-]\s*/i, '');
  const chapters = t.agenda.map((s, i) => ({ text: `${String(Math.round((i * mins) / t.agenda.length)).padStart(2, '0')}:${i ? '30' : '00'} · ${agendaTitle(s)}` }));
  const [bumpTitle, bumpPrice] = split(o.bump);
  const [upTitle, upPrice] = split(o.up);
  const host = { name: hname, role: hrole, bio: hbio, image: '', points: t.hostCreds.map((text) => ({ text })) };
  const countdownMins = [45, 90, 180, 240][h % 4];

  const register = [
    { type: 'hellobar', props: { messages: [{ text: t.seats }, { text: `📅 ${t.when} · ${t.time} · ${t.length}` }, { text: `🎁 Live attendees get bonuses worth ${inr(bonusTotal)}` }] } },
    { type: 'hero', props: {
      variant: t.hero, badge: t.badge, headline: t.headline, subheadline: t.sub, ctaText: t.cta, secondaryText: 'See what you’ll learn',
      rating: t.rating, reviews: t.reviews, socialText: t.social, image: '', cardEmoji: emojiOf(t.badge), cardTitle: t.name, cardPrice: 'FREE', cardMrp: '',
      cardPoints: t.forWho.map((text) => ({ text })), chip1: t.seats, chip2: '🔒 No spam — joining link on WhatsApp', cardTag: 'Live masterclass',
      eventDate: t.when, eventTime: t.time, eventLength: t.length, hostName: hname, hostRole: hrole,
    } },
    { type: 'countdown', props: { label: 'Registrations close in', minutes: countdownMins } },
    { type: 'problem', props: { variant: pick(['cards', 'list', 'split'], 1), eyebrow: pick(['Sound familiar?', 'Why this session exists', 'The honest truth'], 2), title: pick(['If any of this sounds like you, save a seat', 'Where most people get stuck', 'This is what we’ll fix together'], 3), subtitle: 'You’re not alone — thousands of attendees started right here.', items: t.pains.map((text) => ({ text })), closing: `In ${t.length.split('·')[0].trim()}, we’ll show you a better way. 👇` } },
    { type: 'features', props: { variant: pick(['grid', 'zigzag', 'list', 'cards'], 4), eyebrow: 'In this free session', title: 'What you’ll learn', subtitle: 'Live, practical and specific — no fluff, no recycled tips.', items: learn } },
    { type: 'steps', props: { variant: pick(['timeline', 'cards', 'columns'], 5), eyebrow: 'Run of show', title: 'The session, minute by minute', items: pairs(t.agenda, 'title', 'text') } },
    { type: 'mentor', props: { variant: pick(['split', 'story', 'card'], 6), eyebrow: 'Your host', ...host } },
    { type: 'bonuses', props: { variant: pick(['dark', 'light'], 7), eyebrow: 'Attend live and get', title: 'Free bonuses for live attendees', items: bonusItems, totalText: `Total value: ${inr(bonusTotal)} — free when you attend live` } },
    { type: 'testimonials', props: { variant: pick(['wall', 'cards', 'spotlight', 'chat'], 8), eyebrow: 'From past sessions', title: 'What attendees said', items: quotes } },
    { type: 'stats', props: { variant: pick(['band', 'cards', 'strip'], 9), items: stats } },
    { type: 'optin', props: { webinarId: '', eyebrow: 'Free · Live · Limited seats', title: 'Save your free seat', subtitle: `${t.when} at ${t.time}. We’ll send the joining link on WhatsApp and email.`, buttonText: t.cta, askPhone: true, points: learn.map((l) => ({ text: l.title })) } },
    { type: 'faq', props: { variant: pick(['accordion', 'two'], 10), eyebrow: 'FAQ', title: 'About the session', items: faq } },
    { type: 'cta', props: { variant: pick(['banner', 'plain'], 11), headline: `Join ${t.name} — ${t.when.toLowerCase()} at ${t.time}`, subheadline: `${t.social}. Your seat is free.`, buttonText: t.cta, note: '✅ Free · ✅ Live Q&A · ✅ Joining link on WhatsApp' } },
    { type: 'proof', props: { action: 'just saved a seat', intervalSec: 10, items: popups(h) } },
    { type: 'stickybar', props: { text: `${t.name} · ${t.when}, ${t.time}`, price: 'FREE', buttonText: 'Save my seat' } },
    { type: 'whatsapp', props: { number: WA, message: `Hi! I have a question about ${t.name}.`, label: 'Chat with us' } },
  ];
  const registered = [
    { type: 'thankyou', props: { headline: `You’re in! 🎉 See you ${t.when.toLowerCase()}`, body: `${t.name} · ${t.time} · ${t.length}. Your joining link is on its way to your email and WhatsApp.`, steps: t.confirm.map((text) => ({ text })) } },
    { type: 'countdown', props: { label: 'The masterclass starts in', minutes: countdownMins + 30 } },
    { type: 'mentor', props: { variant: 'card', eyebrow: 'See you there', ...host } },
    { type: 'whatsapp', props: { number: WA, message: `Hi! I just registered for ${t.name}.`, label: 'Message us' } },
  ];
  const offerBullets = [...o.points.map((text) => ({ text })), ...bonusItems.map((b) => ({ text: `BONUS: ${b.title} (${b.value})` }))];
  const replay = [
    { type: 'hellobar', props: { messages: [{ text: '⏳ The replay comes down in 48 hours' }, { text: `🔥 Attendee price: ${disc}% off ${o.name}` }] } },
    { type: 'hero', props: {
      variant: pick(['videosplit', 'video'], 12), badge: '▶ Masterclass replay', headline: t.replayHeadline, subheadline: `Missed it live? Here’s the full session — and ${o.name} at the attendee price.`, ctaText: 'Join the programme', secondaryText: 'See what’s included',
      rating: t.rating, reviews: t.reviews, socialText: t.social, image: '', cardEmoji: '🎓', cardTitle: o.name, cardPrice: inr(o.price), cardMrp: inr(o.mrp),
      cardPoints: chapters, chip1: `🔥 ${disc}% off for attendees`, chip2: '🔒 Secure UPI & card payments', cardTag: 'Replay', videoUrl: '', videoNote: `Watch the full ${t.name} replay`, videoLength: `${Math.max(30, mins - 4)}:${String(10 + (h % 49)).padStart(2, '0')}`,
    } },
    { type: 'pricing', props: { variant: pick(['split', 'card'], 13), badge: `🔥 Attendee price — ${disc}% off`, title: o.name, mrp: o.mrp, price: o.price, currency: '₹', bullets: offerBullets, buttonText: 'Yes, I’m in', note: '🔒 Secure checkout · UPI, cards & EMI' } },
    { type: 'countdown', props: { label: 'Attendee price ends in', minutes: 60 * (24 + (h % 24)) } },
    { type: 'testimonials', props: { variant: pick(['spotlight', 'cards'], 14), eyebrow: 'Inside the programme', title: 'What members say', items: quotes } },
    { type: 'guarantee', props: { variant: pick(['box', 'strip'], 15), title: gTitle, body: gBody, days: Number((gTitle.match(/(\d+)-day/) || [])[1]) || 7 } },
    { type: 'faq', props: { variant: 'accordion', eyebrow: 'FAQ', title: 'Before you join', items: faq } },
    { type: 'cta', props: { variant: 'banner', headline: `Join ${o.name} at ${inr(o.price)} — *attendee price*`, subheadline: `Save ${inr(o.mrp - o.price)} before the replay comes down.`, buttonText: 'Join the programme', note: '🔒 Secure UPI & card payments · ✅ Money-back guarantee' } },
    { type: 'stickybar', props: { text: `${disc}% off ends soon`, price: inr(o.price), buttonText: 'Join now' } },
    { type: 'whatsapp', props: { number: WA, message: `Hi! I watched ${t.name} and have a question.`, label: 'Chat with us' } },
  ];
  const checkout = [
    { type: 'hellobar', props: { messages: [{ text: '⏰ Your attendee price is held for 15 minutes' }, { text: '🔒 100% secure payment · money-back guarantee' }] } },
    { type: 'countdown', props: { label: 'Your price is locked for', minutes: 15 } },
    { type: 'checkout', props: { productName: o.name, description: 'Instant access · confirmation on email & WhatsApp', price: o.price, mrp: o.mrp, currency: '₹', bumpEnabled: true, bumpTitle: bumpTitle, bumpDescription: `One-time offer — add this for just ₹${bumpPrice}. Not available later.`, bumpPrice: Number(bumpPrice), buttonText: 'Pay Securely' } },
    { type: 'testimonials', props: { variant: 'cards', eyebrow: 'You’re in good company', title: `Join ${stats[0].value} ${stats[0].label}`, items: quotes.slice(0, 3) } },
    { type: 'guarantee', props: { variant: 'strip', title: gTitle, body: gBody, days: Number((gTitle.match(/(\d+)-day/) || [])[1]) || 7 } },
    { type: 'whatsapp', props: { number: WA, message: 'Hi! I need help with my payment.', label: 'Need help?' } },
  ];
  const upsell = [
    { type: 'offer', props: {
      progress: 'Step 2 of 3 · Make it count', headline: `Wait — add a *${upTitle}*`, description: 'Members who add this get results faster. One click adds it to your order — no need to re-enter payment details.',
      productName: upTitle, emoji: '🚀', price: Number(upPrice), mrp: Math.round((Number(upPrice) * 2.5) / 100) * 100 - 1, currency: '₹',
      bullets: [{ text: `Personal guidance from ${hname.split(' ')[0]}’s team` }, { text: 'A plan built around your situation' }, { text: 'Priority answers on WhatsApp' }], minutes: 10,
      acceptText: `Yes! Add the ${upTitle}`, declineText: 'No thanks, take me to my access',
    } },
    { type: 'testimonials', props: { variant: 'spotlight', eyebrow: 'Why members add this', title: 'What upgraders say', items: quotes.slice(1, 4) } },
    { type: 'guarantee', props: { variant: 'box', title: gTitle, body: 'Your upgrade is covered by the same guarantee.', days: Number((gTitle.match(/(\d+)-day/) || [])[1]) || 7 } },
  ];
  const welcome = [
    { type: 'thankyou', props: { headline: `Welcome to ${o.name} 🎉`, body: 'Your access details are on their way to your email and WhatsApp.', steps: [{ text: 'Check your email for your login and first lesson' }, { text: 'Save our WhatsApp number so you never miss a live call' }, { text: `Introduce yourself in the members’ group — ${hname.split(' ')[0]} reads every message` }] } },
    { type: 'whatsapp', props: { number: WA, message: `Hi! I just joined ${o.name}.`, label: 'Message us' } },
  ];
  const steps = [
    { name: 'Registration', type: 'optin', slug: 'register', blocks: arrange(register, h, ['problem', 'features', 'steps', 'mentor', 'bonuses', 'testimonials']) },
    { name: 'You’re registered', type: 'thankyou', slug: 'registered', blocks: registered },
    { name: 'Replay & offer', type: 'sales', slug: 'replay', blocks: replay },
    { name: 'Checkout', type: 'checkout', slug: 'checkout', blocks: checkout },
    { name: 'Upsell', type: 'upsell', slug: 'upsell', blocks: upsell },
    { name: 'Thank you', type: 'thankyou', slug: 'thank-you', blocks: welcome },
  ];
  return { id: t.id, category: t.category, name: t.name, style: t.style, kind: 'webinar', type: 'webinar', headline: plain(t.headline), steps, color: t.color };
}
