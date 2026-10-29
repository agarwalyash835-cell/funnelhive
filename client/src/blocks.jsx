import { tr } from './i18n';
import { useViewerTz, dayKey, fmtDay, fmtTime, zoneLabel, zoneCity, fmtWhenShort } from './tzfmt';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ensureFonts, FONT_CHOICES } from './fonts';
import { GripVertical, Copy as CopyIcon, Trash2 } from 'lucide-react';
// a paid call's price in its own currency (₹ by default)
const callPrice = (cal) => { const iso = cal?.currency || 'INR'; try { return new Intl.NumberFormat(iso === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: iso, minimumFractionDigits: 0 }).format(Number(cal?.price || 0)); } catch { return `${iso} ${cal?.price}`; } };

export const STYLES = {
  aurora: 'Aurora — light, soft gradients',
  midnight: 'Midnight — dark, glowing',
  luxe: 'Luxe — serif, premium',
  fresh: 'Fresh — soft & friendly',
  bold: 'Bold — high contrast',
  clean: 'Clean — minimal',
  editorial: 'Editorial — magazine, black & white',
  organic: 'Organic — warm, earthy, handmade',
  tech: 'Tech — dark, neon, monospace',
  playful: 'Playful — bright & chunky',
  royal: 'Royal — jewel tones & gold',
  noir: 'Noir — black, white & one glowing accent',
  glass: 'Glass — frosted panels on a colour mesh',
  swiss: 'Swiss — grid, big type, sharp corners',
  pastel: 'Pastel — soft, dreamy, rounded',
  studio: 'Studio — warm neutral, modern startup',
};

// a buyer's button never stays stuck on Processing…: anything that throws comes back as { error }
const safely = (fn) => Promise.resolve().then(fn).catch((x) => ({ error: x?.message || 'Something went wrong — please try again' }));
const T = 'text', LONG = 'long', NUM = 'number', B = 'bool', L = 'list';
const HL = 'Wrap words in *stars* to highlight them';
// What a built-in button does; "Open a pop-up" opens one of this step's pop-ups (Step → Pop-ups)
const BTN_ACTIONS = [['next', 'Go to the next step'], ['page', 'Open a page of this funnel (its web name in the link field)'], ['url', 'Open a link'], ['scroll', 'Scroll to a section'], ['popup', 'Open a pop-up']];

// Field schema drives the editor's inspector: [key, kind, listSubKeys, hint]
export const BLOCK_TYPES = {
  section: { label: 'Custom section', fields: [['layout', 'select', [['1', 'One column'], ['1-1', 'Two equal columns'], ['2-1', 'Wide + narrow'], ['1-2', 'Narrow + wide'], ['1-1-1', 'Three columns'], ['1-1-1-1', 'Four columns']]], ['valign', 'select', [['top', 'Align to top'], ['center', 'Align to middle']]], ['gap', 'select', [['sm', 'Tight spacing'], ['md', 'Normal spacing'], ['lg', 'Roomy spacing']]]], defaults: { layout: '1', valign: 'top', gap: 'md', columns: [{ id: 'c1', elements: [] }] } },
  hero: { label: 'Hero', fields: [['badge', T], ['headline', LONG, null, HL], ['subheadline', LONG], ['ctaText', T], ['ctaAction', 'select', BTN_ACTIONS], ['ctaUrl', T, null, 'https://…, WhatsApp (https://wa.me/…), tel:… or mailto:… — or a section id like pricing'], ['ctaNewTab', B, null, 'Open the link in a new tab'], ['secondaryText', T], ['secondaryUrl', T, null, 'Where the small link goes — a section id (default: how-it-works) or https://…'], ['socialText', T], ['rating', NUM], ['reviews', T], ['image', T, null, 'Optional image URL — replaces the product card'], ['alt', T, null, 'Image description (for screen readers and SEO)'], ['cardEmoji', T], ['cardTitle', T], ['cardPrice', T], ['cardMrp', T], ['cardPoints', L, ['text']], ['chip1', T], ['chip2', T], ['cardTag', T, null, 'Small label on the product card'], ['showCard', B, null, 'Show the product card (when there is no image)'], ['showTrust', B, null, 'Show the avatars & rating row'], ['videoUrl', T, null, 'Video layouts: YouTube, Vimeo, Loom, Google Drive or .mp4 link'], ['videoNote', T, null, 'Video layouts: label on the cover, e.g. “Watch the free 12-minute training”'], ['videoLength', T, null, 'Video layouts: length shown on the cover, e.g. 14:32. Card points written as “01:10 · Chapter” become chapters'], ['eventDate', T, null, 'Event layouts: when, e.g. “Every Sunday”'], ['eventTime', T, null, 'Event layouts: time, e.g. “7:00 PM IST”'], ['eventLength', T, null, 'Event layouts: e.g. “90 min · Live on Zoom”'], ['hostName', T, null, 'Event layouts: who hosts it'], ['hostRole', T, null, 'Event layouts: the host’s title']], defaults: { badge: '⭐ A true highlight — e.g. your real rating or students taught', headline: 'Your big promise — *the result they want*', subheadline: 'One sentence that makes the reader want it.', ctaText: 'Get Started', secondaryText: 'See how it works', socialText: 'Real proof — e.g. how many people you’ve helped', rating: 4.9, reviews: '2,300', image: '', cardEmoji: '🚀', cardTitle: 'Your Product', cardPrice: '₹499', cardMrp: '₹1,999', cardPoints: [{ text: 'Key benefit one' }, { text: 'Key benefit two' }], chip1: '✅ A real fact — e.g. Lifetime access', chip2: '🔒 Secure payment' } },
  stats: { label: 'Stats strip', fields: [['items', L, ['value', 'label'], 'Use real numbers you can back up']], defaults: { items: [{ value: '[Add your real number]', label: 'customers' }, { value: '[Add your real number]', label: 'rating' }, { value: '[Add your real number]', label: 'cities' }] } },
  problem: { label: 'Pain points', fields: [['eyebrow', T], ['title', T], ['subtitle', T], ['items', L, ['text']], ['closing', T]], defaults: { eyebrow: 'Sound familiar?', title: 'You are not alone if…', subtitle: '', items: [{ text: 'Problem one' }, { text: 'Problem two' }, { text: 'Problem three' }], closing: 'There is a better way 👇' } },
  features: { label: 'Features', fields: [['eyebrow', T], ['title', T], ['subtitle', T], ['items', L, ['icon', 'title', 'text']]], defaults: { eyebrow: 'The solution', title: 'Why you will love it', subtitle: '', items: [{ icon: '⚡', title: 'Benefit one', text: 'Describe it.' }, { icon: '🎯', title: 'Benefit two', text: 'Describe it.' }] } },
  steps: { label: 'How it works', fields: [['eyebrow', T], ['title', T], ['items', L, ['title', 'text']]], defaults: { eyebrow: 'How it works', title: 'Get started in 3 simple steps', items: [{ title: 'Sign up', text: 'Takes 2 minutes' }, { title: 'Get access', text: 'Instantly' }, { title: 'See results', text: 'Fast' }] } },
  compare: { label: 'Comparison', fields: [['eyebrow', T], ['title', T], ['leftTitle', T], ['rightTitle', T], ['rows', L, ['left', 'right']], ['tag', T, null, 'Label on the highlighted column']], defaults: { eyebrow: 'Why us', title: 'The difference is clear', leftTitle: 'Others', rightTitle: 'Us', rows: [{ left: 'Slow', right: 'Fast' }] } },
  testimonials: { label: 'Testimonials', fields: [['eyebrow', T], ['title', T], ['items', L, ['name', 'quote', 'tag'], 'Template reviews are samples: replace them with real ones from your customers']], defaults: { eyebrow: 'Success stories', title: 'What people say', items: [{ name: 'Happy Customer, Pune', quote: 'Amazing results!', tag: '' }] } },
  mentor: { label: 'Expert / About', fields: [['eyebrow', T], ['name', T], ['role', T], ['bio', LONG], ['image', T], ['points', L, ['text']], ['badge', T, null, 'Badge on the photo']], defaults: { eyebrow: 'Meet your expert', name: 'Expert Name', role: 'Title · 10 years', bio: 'Short credibility-building bio.', image: '', points: [{ text: '[Add a real credential]' }] } },
  bonuses: { label: 'Bonus stack', fields: [['eyebrow', T], ['title', T], ['items', L, ['icon', 'title', 'value']], ['totalText', T], ['freeLabel', T, null, 'Corner tag on each bonus'], ['itemLabel', T, null, 'Numbered label, e.g. "Bonus #"'], ['worthLabel', T, null, 'Text before the value']], defaults: { eyebrow: 'Exclusive bonuses', title: 'Order today and get these FREE', items: [{ icon: '🎁', title: 'Bonus one', value: '₹999' }], totalText: 'Total value: ₹999 — free today' } },
  guarantee: { label: 'Guarantee', fields: [['title', T], ['body', LONG], ['days', NUM, null, '0 shows a "100% free" seal'], ['showSeal', B, null, 'Show the seal']], defaults: { title: '7-Day Money-Back Guarantee', body: 'Try it risk-free.', days: 7 } },
  video: { label: 'Video', fields: [['url', T, null, 'YouTube (incl. Shorts), Vimeo, Loom, Google Drive or an .mp4 link']], defaults: { url: '' } },
  image: { label: 'Image', fields: [['src', T], ['alt', T, null, 'Describe the image — helps SEO and screen readers'], ['caption', T], ['link', T, null, 'Optional: make the image a link'], ['width', 'select', [['narrow', 'Narrow'], ['normal', 'Normal'], ['full', 'Full width']]], ['rounded', B], ['shadow', B]], defaults: { src: '', alt: '', caption: '', link: '', width: 'normal', rounded: true, shadow: false } },
  gallery: { label: 'Image gallery', fields: [['eyebrow', T], ['title', T], ['columns', 'select', [['2', '2 per row'], ['3', '3 per row'], ['4', '4 per row']]], ['items', 'gallery', ['src', 'caption']]], defaults: { eyebrow: '', title: 'See it for yourself', columns: '3', items: [] } },
  spacer: { label: 'Spacer', fields: [['height', NUM, null, 'Height in pixels']], defaults: { height: 48 } },
  divider: { label: 'Divider', fields: [['style', 'select', [['line', 'Solid line'], ['dashed', 'Dashed'], ['dots', 'Dots']]]], defaults: { style: 'line' } },
  html: { label: 'Custom code / embed', fields: [['code', 'code', null, 'Paste HTML or an embed code (Calendly, Typeform, Google Maps, Razorpay button…). It runs in a secure sandbox.'], ['height', NUM, null, '0 = size automatically'], ['title', T, null, 'Short description for screen readers']], defaults: { code: '', height: 0, title: 'Embedded content' } },
  quiz: { label: 'Quiz', fields: [['title', T], ['subtitle', T], ['startText', T, null, 'Start button on the intro screen (empty = start at question 1)'], ['image', T], ['questions', 'quizquestions'], ['scoring', 'select', [['outcome', 'Each answer points to a result — most votes wins'], ['points', 'Add up points — score ranges pick the result']]], ['outcomes', 'quizoutcomes'], ['contact', 'select', [['both', 'Ask for email and WhatsApp'], ['email', 'Ask for email'], ['phone', 'Ask for WhatsApp number']]], ['askName', B], ['gateTitle', T], ['gateText', T], ['buttonText', T], ['showScore', B, null, 'Show the points score on the result'], ['note', T]], defaults: {
    title: 'Which plan is *right for you*?', subtitle: 'Answer 3 quick questions — get your personal recommendation in 30 seconds.', startText: 'Start the quiz', image: '', scoring: 'outcome', contact: 'both', askName: true,
    gateTitle: 'Your result is ready!', gateText: 'Where should we send your personalised plan?', buttonText: 'Show my result', showScore: false, note: 'Takes 30 seconds · Free',
    questions: [
      { q: 'What’s your main goal right now?', answers: [{ text: 'Just getting started', outcome: 0 }, { text: 'Growing steadily', outcome: 1 }, { text: 'Scaling fast', outcome: 2 }] },
      { q: 'How much time can you give each week?', answers: [{ text: 'Under 2 hours', outcome: 0 }, { text: '2–5 hours', outcome: 1 }, { text: '5+ hours', outcome: 2 }] },
      { q: 'What’s your budget?', answers: [{ text: 'Under ₹5,000', outcome: 0 }, { text: '₹5,000 – ₹25,000', outcome: 1 }, { text: '₹25,000+', outcome: 2, tag: 'high-budget' }] },
    ],
    outcomes: [
      { title: 'The Starter Path', body: 'You need a simple, guided start. Our starter course gets you your first results in 30 days.', buttonText: 'See the starter course', url: '', tag: 'quiz-starter' },
      { title: 'The Growth Path', body: 'You have the basics — now you need a system. Our growth programme shows you how.', buttonText: 'See the growth programme', url: '', tag: 'quiz-growth' },
      { title: 'The Done-With-You Path', body: 'You’re ready to scale. Book a free strategy call and we’ll map out your next 90 days.', buttonText: 'Book my free call', url: '', tag: 'quiz-scale' },
    ] } },
  form: { label: 'Form', fields: [['productId', 'product', null, 'Free product sent on submit (not to applicants marked “not a fit”)'], ['title', T], ['subtitle', T], ['fields', 'formfields'], ['buttonText', T], ['after', 'select', [['message', 'Show a thank-you message'], ['next', 'Go to the next step']]], ['successMessage', T], ['rejectMessage', LONG, null, 'Shown to applicants whose answers mean “not a fit” (set per question in Form fields)'], ['note', T]], defaults: { title: 'Tell us about yourself', subtitle: 'We’ll get back to you within 24 hours.', fields: [{ label: 'Full name', type: 'text', required: true }, { label: 'Email', type: 'email', required: true }, { label: 'WhatsApp number', type: 'tel', required: false }, { label: 'What do you need help with?', type: 'select', options: 'Getting started, Pricing, Something else', required: false }], buttonText: 'Send', after: 'message', successMessage: 'Thank you! We’ll be in touch shortly.', note: '🔒 We never share your details.' } },
  text: { label: 'Text', fields: [['title', T], ['body', LONG]], defaults: { title: 'Heading', body: 'Your copy here.' } },
  countdown: { label: 'Countdown', fields: [['label', T], ['mode', 'select', [['evergreen', 'Each visitor gets their own time — it never restarts'], ['fixed', 'Ends at a fixed date and time'], ['session', 'Counts down to the next live webinar session']]], ['endsAt', 'datetime', null, 'When the offer really ends (your time zone)'], ['minutes', NUM, null, 'Minutes from the visitor’s first visit'], ['endedText', T, null, 'Shown once the time is up'], ['hideEnded', B, null, 'Hide the timer once it ends']], defaults: { label: 'Offer ends in', mode: 'fixed', endsAt: 0, minutes: 15, endedText: 'Offer ended' } },
  optin: { label: 'Opt-in form', fields: [['productId', 'product', null, 'Free product sent on sign-up (lead magnet)'], ['eyebrow', T], ['title', T], ['subtitle', T], ['buttonText', T], ['askPhone', B], ['points', L, ['text']], ['nameLabel', T], ['emailLabel', T], ['phoneLabel', T], ['secureText', T]], defaults: { eyebrow: '100% free', title: 'Get the free guide', subtitle: 'Enter your details to get instant access.', buttonText: 'Send it to me', askPhone: true, points: [] } },
  checkout: { label: 'Checkout', fields: [['productId', 'product', null, 'Delivered to the buyer automatically after a verified payment'], ['productName', T], ['description', T], ['price', NUM], ['mrp', NUM], ['currency', 'select', [['₹', '₹ Indian rupee (Razorpay / Stripe)'], ['$', '$ US dollar (Stripe)'], ['€', '€ Euro (Stripe)'], ['£', '£ British pound (Stripe)'], ['A$', 'A$ Australian dollar (Stripe)'], ['C$', 'C$ Canadian dollar (Stripe)'], ['S$', 'S$ Singapore dollar (Stripe)'], ['AED', 'AED UAE dirham (Stripe)']]], ['bumpEnabled', B], ['bumpTitle', T], ['bumpDescription', T], ['bumpPrice', NUM], ['billing', 'select', [['', 'One-time payment'], ['monthly', 'Membership — billed every month'], ['yearly', 'Membership — billed every year']]], ['planEnabled', B, null, 'Also offer a monthly payment plan (EMI-style instalments)'], ['planCount', NUM, null, 'Number of monthly instalments (2–36)'], ['planPrice', NUM, null, 'Each instalment in ₹'], ['shipping', 'select', [['', 'Nothing to ship (digital / service)'], ['address', 'Ship it — ask for the delivery address']]], ['shippingFee', NUM, null, 'Delivery charge in ₹ (0 = free delivery)'], ['origin', T, null, 'Physical products: country of origin, shown under the product (required for goods sold online in India). Blank = your default in Settings (India)'], ['cod', B, null, 'Offer Cash on Delivery'], ['codFee', NUM, null, 'Extra ₹ for Cash on Delivery (0 = none)'], ['bumpProductId', 'product', null, 'Delivered when the buyer ticks the order bump'], ['buttonText', T], ['step1', T, null, 'Heading above the details'], ['step2', T, null, 'Heading above payment methods'], ['secureText', T], ['summaryTitle', T], ['perks', L, ['text']]], defaults: { productName: 'My Product', description: 'Instant access', price: 499, mrp: 1999, currency: '₹', bumpEnabled: true, bumpTitle: 'Add the bonus pack', bumpDescription: 'Extra templates and checklists.', bumpPrice: 99, buttonText: 'Pay Securely' } },
  offer: { label: 'Upsell / downsell offer', fields: [['productId', 'product', null, 'Delivered when the buyer accepts this offer'], ['progress', T], ['headline', LONG, null, HL], ['description', LONG], ['productName', T], ['emoji', T], ['price', NUM], ['mrp', NUM], ['currency', T], ['bullets', L, ['text']], ['minutes', NUM, null, 'Offer timer — 0 hides it'], ['acceptText', T], ['declineText', T], ['tag', T, null, 'Label on the product card'], ['oneClickText', T]], defaults: { progress: 'Step 2 of 3 · Customise your order', headline: 'Wait! Add the *VIP upgrade* to your order', description: 'One click adds it — no need to re-enter payment details.', productName: 'VIP Upgrade', emoji: '👑', price: 999, mrp: 2999, currency: '₹', bullets: [{ text: 'Personal 1-on-1 support' }, { text: 'Advanced resources' }], minutes: 10, acceptText: 'Yes! Add it to my order', declineText: 'No thanks' } },
  crosssell: { label: 'Cross-sells', fields: [['title', T], ['subtitle', T], ['eyebrow', T], ['items', L, ['emoji', 'name', 'desc', 'price', 'productId']], ['buttonText', T]], defaults: { title: 'Customers also bought', subtitle: 'Add these to your order with one click.', items: [{ emoji: '📚', name: 'Advanced Masterclass', desc: 'Go deeper with expert sessions.', price: 499 }, { emoji: '🧾', name: 'Templates Pack', desc: 'Ready-to-use resources.', price: 299 }], buttonText: 'Add to my order' } },
  pricing: { label: 'Pricing box', fields: [['badge', T], ['title', T], ['mrp', NUM], ['price', NUM], ['currency', T], ['bullets', L, ['text']], ['buttonText', T], ['buttonAction', 'select', BTN_ACTIONS], ['buttonUrl', T, null, 'https://…, WhatsApp (https://wa.me/…), tel:… or mailto:… — or a section id like pricing'], ['buttonNewTab', B, null, 'Open the link in a new tab'], ['note', T], ['priceNote', T, null, 'Line under the price'], ['payMethods', T, null, 'Payment badges, separated by ·']], defaults: { badge: 'Limited-time offer', title: 'Your Product', mrp: 1999, price: 499, currency: '₹', bullets: [{ text: 'Everything included' }], buttonText: 'Enroll Now', note: '🔒 Secure checkout' } },
  navbar: { label: 'Header & menu', fields: [['brand', T], ['logo', T, null, 'Optional: a logo image link, shown before the name'], ['links', L, ['label', 'to'], 'Where each one goes: a page of this funnel by its web name (about, contact — empty = the first page), a section (#faq) or a full link'], ['buttonText', T], ['buttonTo', T, null, 'A page, #section or link']], defaults: { brand: 'Your Brand', links: [{ label: 'Home', to: '' }, { label: 'About', to: 'about' }, { label: 'Services', to: 'services' }, { label: 'Contact', to: 'contact' }], buttonText: 'Get in touch', buttonTo: 'contact' } },
  footer: { label: 'Footer', fields: [['brand', T], ['text', LONG], ['links', L, ['label', 'to'], 'A page of this funnel (about, contact), a section (#faq) or a full link'], ['note', T, null, 'e.g. © 2026 Your Brand']], defaults: { brand: 'Your Brand', text: 'One line about who you help and how.', links: [{ label: 'Home', to: '' }, { label: 'About', to: 'about' }, { label: 'Services', to: 'services' }, { label: 'Contact', to: 'contact' }], note: '' } },
  faq: { label: 'FAQ', fields: [['eyebrow', T], ['title', T], ['items', L, ['q', 'a']]], defaults: { eyebrow: 'FAQ', title: 'Questions? We have answers.', items: [{ q: 'Question?', a: 'Answer.' }] } },
  cta: { label: 'Final call to action', fields: [['headline', T], ['subheadline', T], ['buttonText', T], ['buttonAction', 'select', BTN_ACTIONS], ['buttonUrl', T, null, 'https://…, WhatsApp (https://wa.me/…), tel:… or mailto:… — or a section id like pricing'], ['buttonNewTab', B, null, 'Open the link in a new tab'], ['note', T]], defaults: { headline: 'Ready to start?', subheadline: '', buttonText: 'Get Started', note: '' } },
  booking: { label: 'Booking calendar', fields: [['calendarId', 'calendar', null, 'Which availability to book against (Bookings → Calendars)'], ['eyebrow', T], ['title', T], ['subtitle', T], ['buttonText', T], ['successTitle', T], ['successText', LONG], ['qualifiedOnly', B, null, 'In an application funnel, only applicants who qualified can book']], defaults: { calendarId: '', eyebrow: 'Book your call', title: 'Pick a time that suits you', subtitle: 'Times are shown in India time (IST).', buttonText: 'Confirm my call', successTitle: 'Your call is booked ✅', successText: 'The confirmation and joining link are in your email.', qualifiedOnly: true } },
  thankyou: { label: 'Thank you', fields: [['headline', T], ['body', LONG], ['steps', L, ['text']]], defaults: { headline: 'Thank you! 🎉', body: 'Check your email.', steps: [] } },
  // ---- FOMO blocks (each refreshes every 9–10 seconds) ----
  hellobar: { label: 'FOMO: Hello bar', fields: [['messages', L, ['text']]], defaults: { messages: [{ text: '🔥 Launch offer: flat 75% OFF' }, { text: '🔒 Secure UPI & card payments' }] } },
  // livecount, stock and proof show only real numbers (analytics, the seller's stock, real orders) — see the server's /social
  livecount: { label: 'FOMO: Recent visitors', fields: [['minShow', NUM, null, 'Hidden until at least this many people visited in the last 30 minutes']], defaults: { minShow: 3 } },
  stock: { label: 'FOMO: Seats / stock left', fields: [['label', T, null, '{n} is replaced by the real number left'], ['left', NUM, null, 'How many you really have — goes down by one with each real order. 0 hides the block'], ['total', NUM, null, 'Optional: how many you started with (shows a bar)']], defaults: { label: 'Only {n} left in stock', left: 0, total: 0 } },
  proof: { label: 'FOMO: Recent buyers popup', fields: [['intervalSec', NUM]], defaults: { intervalSec: 9 } },
  exitpopup: { label: 'FOMO: Exit-intent popup', fields: [['title', T], ['body', T], ['code', T], ['buttonText', T]], defaults: { title: 'Wait! Don’t go yet', body: 'Grab an extra 10% OFF on your order.', code: 'STAY10', buttonText: 'Claim my discount' } },
  stickybar: { label: 'Sticky buy bar', fields: [['text', T], ['price', T], ['buttonText', T], ['buttonAction', 'select', BTN_ACTIONS], ['buttonUrl', T, null, 'https://…, WhatsApp (https://wa.me/…), tel:… or mailto:… — or a section id like pricing'], ['buttonNewTab', B, null, 'Open the link in a new tab']], defaults: { text: 'Offer ends soon', price: '₹499', buttonText: 'Buy Now' } },
  whatsapp: { label: 'WhatsApp chat button', fields: [['number', T, null, 'Leave 919999999999 to use the Support WhatsApp from Settings'], ['message', T], ['label', T]], defaults: { number: '919999999999', message: 'Hi! I have a question.', label: 'Chat with us' } },
};

// Every main section has several designs. The first one is the original look (also used when unset).
export const VARIANTS = {
  hero: [['split', 'Split — copy and product card'], ['center', 'Centred — big headline'], ['banner', 'Banner — full colour or photo'], ['editorial', 'Editorial — magazine style'], ['bento', 'Bento — tiles with price, rating & benefits'], ['video', 'Video — centred video sales letter (VSL)'], ['videosplit', 'Video beside the copy, with chapters'], ['cinema', 'Cinema — dark screen for a VSL'], ['event', 'Event ticket — for webinars & events'], ['stage', 'Stage — centred, with an event bar'], ['poster', 'Poster — big date card for webinars']],
  stats: [['strip', 'Strip'], ['cards', 'Tiles'], ['band', 'Colour band']],
  problem: [['cards', 'Cards'], ['list', 'Crossed-out list'], ['split', 'Title beside the list']],
  features: [['cards', 'Cards, 2 columns'], ['grid', 'Icon grid, 3 columns'], ['list', 'Checklist beside the title'], ['zigzag', 'Big numbered rows']],
  steps: [['columns', 'Columns'], ['timeline', 'Timeline'], ['cards', 'Numbered cards']],
  compare: [['columns', 'Two columns'], ['table', 'Table']],
  testimonials: [['cards', 'Cards'], ['spotlight', 'Spotlight — one big quote'], ['wall', 'Wall of love'], ['chat', 'WhatsApp chats']],
  mentor: [['split', 'Photo and bio'], ['story', 'Founder story'], ['card', 'Centred card']],
  bonuses: [['dark', 'Dark band'], ['light', 'Light cards']],
  guarantee: [['box', 'Box with seal'], ['strip', 'Slim strip']],
  pricing: [['card', 'Single card'], ['split', 'What’s included + price']],
  faq: [['accordion', 'Accordion'], ['two', 'Two columns']],
  cta: [['banner', 'Gradient banner'], ['plain', 'Plain and centred']],
};
for (const [type, list] of Object.entries(VARIANTS)) BLOCK_TYPES[type].fields.unshift(['variant', 'select', list, 'Layout of this section']);
const vOf = (type, p) => (VARIANTS[type]?.some(([k]) => k === p.variant) ? p.variant : VARIANTS[type]?.[0][0]);

export const BLOCK_GROUPS = [
  ['Essentials', ['section', 'hero', 'text', 'image', 'gallery', 'video', 'stats', 'cta', 'spacer', 'divider', 'html']],
  ['Website', ['navbar', 'footer']],
  ['Persuasion', ['problem', 'features', 'steps', 'compare', 'testimonials', 'mentor', 'bonuses', 'guarantee', 'faq']],
  ['Sell', ['pricing', 'optin', 'form', 'quiz', 'booking', 'checkout', 'offer', 'crosssell', 'thankyou']],
  ['FOMO & urgency', ['hellobar', 'countdown', 'livecount', 'stock', 'proof', 'exitpopup', 'stickybar', 'whatsapp']],
];
export const BLOCK_ICONS = { navbar: '🧭', footer: '🔚', section: '🧱', image: '🖼️', gallery: '🎞️', spacer: '↕️', divider: '➖', html: '🧩', form: '🗒️', quiz: '🧩', hero: '🦸', text: '📝', video: '🎬', stats: '📊', cta: '📣', problem: '😣', features: '✨', steps: '🪜', compare: '⚖️', testimonials: '💬', mentor: '🧑‍🏫', bonuses: '🎁', guarantee: '🛡️', faq: '❓', pricing: '💰', optin: '📧', checkout: '💳', offer: '⬆️', crosssell: '🛍️', thankyou: '🎉', booking: '📅', hellobar: '📢', countdown: '⏳', livecount: '👀', stock: '📦', proof: '🔔', exitpopup: '🚪', stickybar: '📌', whatsapp: '💚' };

// Text that used to be fixed in the design. Kept as defaults so existing pages look the same,
// but every piece can now be edited or removed (empty string = removed).
export const COPY = {
  hero: { cardTag: 'Bestseller', showCard: true, showTrust: true },
  compare: { tag: 'Recommended' },
  mentor: { badge: '' }, // no "Verified" badge nobody verified
  bonuses: { freeLabel: 'FREE', itemLabel: 'Bonus #', worthLabel: 'Worth' },
  guarantee: { showSeal: true },
  pricing: { priceNote: 'One-time payment · Lifetime value', payMethods: 'UPI · GPay · PhonePe · Paytm · Visa · RuPay · NetBanking' },
  optin: { nameLabel: 'Full name', emailLabel: 'Email', phoneLabel: 'WhatsApp number', secureText: '🔒 Your information is 100% safe. No spam, ever.' },
  checkout: { step1: 'Your details', step2: 'Payment method', secureText: '🔒 256-bit SSL secured · UPI, cards, netbanking & wallets', summaryTitle: 'Order summary', perks: [{ text: 'Instant confirmation by email' }, { text: 'Secure payment — UPI, cards & netbanking' }, { text: 'A receipt for your records' }] }, // no claims the seller may not be able to back up (refund terms, buyer counts)
  offer: { tag: '⚡ One-time offer', oneClickText: '✓ One click — we’ll use the payment details you just entered' },
  crosssell: { eyebrow: 'Recommended for you' },
};
export const withCopy = (type, props = {}) => (COPY[type] ? { ...JSON.parse(JSON.stringify(COPY[type])), ...props } : props);

// ---------- helpers ----------
const rnd = (a, b) => a + Math.random() * (b - a);
const pad = (n) => String(n).padStart(2, '0');
const money = (c, n) => `${c || '₹'}${Number(n || 0).toLocaleString('en-IN')}`;
const rich = (s = '') => String(s).split(/\*(.+?)\*/g).map((x, i) => (i % 2 ? <span className="hl" key={i}>{x}</span> : x));
const initials = (name = '') => name.replace(/^(Dr|Mr|Mrs|Ms|Ar|Pt|CA)\.?\s+/i, '').split(/[\s,]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const avColor = (s = '') => `hsl(${[...s].reduce((h, c) => h + c.charCodeAt(0) * 7, 0) % 360} 65% 52%)`;
const go = (ctx) => () => ctx.live && ctx.onNext();

// Inline-editable text. In the editor (ctx.editable) the text becomes contentEditable;
// on focus *highlight* markers are shown raw so they can be edited, on blur the value is saved.
// The typed text, not the displayed text: innerText would apply CSS (e.g. uppercase buttons) to what we save
const readText = (el) => {
  const c = el.cloneNode(true);
  c.querySelectorAll('br').forEach((n) => n.replaceWith('\n'));
  c.querySelectorAll('div, p').forEach((n) => n.prepend('\n'));
  return c.textContent;
};
const caretToEnd = (el) => { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); };
function E({ ctx, k, v, as: Tag = 'span', className, isRich, multiline, style, num, fmt, keep }) {
  const [n, setN] = useState(0);
  if ((v === '' || v == null) && !keep) return null; // removed
  const content = isRich ? rich(v) : fmt ? fmt(v) : v;
  if (!ctx?.editable) return <Tag className={className} style={style}>{content}</Tag>;
  return (
    <Tag
      key={n}
      data-k={k}
      data-keep={keep ? '1' : undefined}
      className={`${className || ''} ed-text`}
      style={style}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      data-placeholder={`Type ${k}…`}
      onFocus={(e) => { if (isRich || fmt) { e.currentTarget.innerText = v ?? ''; caretToEnd(e.currentTarget); } }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !(multiline && e.shiftKey)) { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === 'Escape') { e.currentTarget.innerText = v || ''; e.currentTarget.blur(); }
      }}
      onPaste={(e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); }}
      onBlur={(e) => {
        const val = readText(e.currentTarget).replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim();
        if (num) {
          // prices: keep digits only; ignore an empty or invalid entry
          const digits = val.replace(/[^\d.]/g, '');
          const nv = Number(digits);
          if (digits !== '' && Number.isFinite(nv) && nv !== Number(v)) ctx.onEdit?.(k, nv);
        } else if (val !== (v || '')) ctx.onEdit?.(k, val);
        setN((x) => x + 1); // remount so React renders the saved value cleanly
      }}
    >{content}</Tag>
  );
}


// Calls fn on a random 9–10 second cadence (the FOMO refresh interval)
function useTick(fn, active = true, minMs = 9000, maxMs = 10000) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    let t;
    const loop = () => { t = setTimeout(() => { ref.current(); loop(); }, rnd(minMs, maxMs)); };
    loop();
    return () => clearTimeout(t);
  }, [active, minMs, maxMs]);
}

// Where a built-in button goes: the next funnel step (default), a link, or a section on this page
const smoothTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
export function buttonLink(action, url, newTab) {
  const u = String(url || '').trim();
  if (action === 'url') { const h = safeHref(u); if (!h) return null; return h.startsWith('#') ? { scroll: cleanAnchor(h.slice(1)) } : { href: h, newTab: !!newTab }; }
  if (action === 'scroll' && u) { const id = cleanAnchor(u.replace(/^#/, '')); return id ? { scroll: id } : null; }
  if (action === 'popup' && u) return { popup: u };
  if (action === 'page') return { page: String(u).trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60) };
  return null;
}
const Btn = ({ children, big, block, onClick, type = 'button', disabled, ctx, k, link }) => {
  const cls = `btn ${big ? 'big' : ''} ${block ? 'block' : ''}`;
  if ((children === '' || children == null) && type !== 'submit') return null;
  if (children === '' || children == null) children = 'Submit';
  if (ctx?.editable && k) return <div className={cls} role="button"><E ctx={ctx} k={k} v={children} /><span className="arr" aria-hidden="true">→</span></div>;
  if (link?.href) {
    return (
      <a className={cls} href={link.href} {...(link.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        onClick={(e) => { if (ctx && !ctx.live) e.preventDefault(); else ctx?.onLinkClick?.(link.href); }}>
        <span>{children}</span><span className="arr" aria-hidden="true">→</span>
      </a>
    );
  }
  if (link?.page != null) {
    return (
      <a className={cls} href={ctx?.pageHref ? ctx.pageHref(link.page) : '#'}
        onClick={(e) => { if (!ctx?.live) return e.preventDefault(); if (ctx.goPage) { e.preventDefault(); ctx.goPage(link.page); } }}>
        <span>{children}</span><span className="arr" aria-hidden="true">→</span>
      </a>
    );
  }
  if (link?.popup) {
    return (
      <button type="button" className={cls} aria-haspopup="dialog" onClick={() => ctx?.live && openPopup(link.popup)}>
        <span>{children}</span><span className="arr" aria-hidden="true">→</span>
      </button>
    );
  }
  if (link?.scroll) {
    return (
      <a className={cls} href={`#${link.scroll}`} onClick={(e) => { e.preventDefault(); smoothTo(link.scroll); }}>
        <span>{children}</span><span className="arr" aria-hidden="true">→</span>
      </a>
    );
  }
  return (
    <button type={type} disabled={disabled} className={cls} onClick={onClick}>
      <span>{children}</span><span className="arr" aria-hidden="true">→</span>
    </button>
  );
};
const Sec = ({ type, className = '', id, children, v }) => (
  <section id={id} className={`sec sec-${type} ${v ? `v-${v}` : ''} ${className}`}><div className="in">{children}</div></section>
);
const Head = ({ eyebrow, title, subtitle, left, ctx }) => (eyebrow || title ? (
  <div className={`sh ${left ? '' : 'c'}`}>
    {eyebrow && <E ctx={ctx} k="eyebrow" v={eyebrow} className="eyebrow" />}
    {title && <E ctx={ctx} k="title" v={title} as="h2" isRich />}
    {subtitle && <E ctx={ctx} k="subtitle" v={subtitle} as="p" className="sub" />}
  </div>
) : null);
const Placeholder = ({ children }) => <div className="fomo-ph">{children}</div>;
// Popups and bars float over the live page; in the editor / previews they're shown in place, as visitors see them
const FloatPreview = ({ label, hint, children }) => (
  <div className="fp"><div className="fp-h"><b>{label}</b><small>{hint}</small></div><div className="fp-body">{children}</div></div>
);
const Avatar = ({ name, size }) => <span className="av" style={{ background: avColor(name), width: size, height: size }}>{initials(name)}</span>;

// ---------- sections ----------
function Hero({ p, ctx }) {
  const link = buttonLink(p.ctaAction, p.ctaUrl, p.ctaNewTab);
  const sec = buttonLink(/^(https?:|mailto:|tel:)/i.test(p.secondaryUrl || '') ? 'url' : 'scroll', p.secondaryUrl || 'how', p.ctaNewTab);
  const v = vOf('hero', p);
  if (['video', 'videosplit', 'cinema'].includes(v)) return <HeroVideo p={p} ctx={ctx} v={v} />;
  if (['event', 'stage', 'poster'].includes(v)) return <HeroEvent p={p} ctx={ctx} v={v} />;
  if (v === 'bento') return <HeroBento p={p} ctx={ctx} />;
  const banner = v === 'banner' && p.image;
  const solo = !((p.image && !banner) || p.showCard !== false || p.chip1 || p.chip2);
  return (
    <section className={`sec sec-hero v-${v}`} style={banner ? { '--hero-img': `url("${String(mediaUrl(p.image)).replace(/"/g, '%22')}")` } : undefined}>
      {banner && <div className="hero-photo" aria-hidden="true" />}
      <div className={`in hero-grid ${solo ? 'solo' : ''}`}>
        <div className="hero-copy">
          {p.badge && <E ctx={ctx} k="badge" v={p.badge} className="badge" />}
          <E ctx={ctx} k="headline" v={p.headline} as="h1" isRich />
          <E ctx={ctx} k="subheadline" v={p.subheadline} as="p" className="lead" multiline />
          <div className="hero-ctas">
            {p.ctaText && <Btn big onClick={go(ctx)} ctx={ctx} k="ctaText" link={link}>{p.ctaText}</Btn>}
            {p.secondaryText && <a className="link-arrow" href={ctx.editable ? undefined : sec?.href || (sec?.scroll ? `#${sec.scroll}` : undefined)} {...(sec?.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})} onClick={(e) => { if (ctx.editable) return; if (!sec?.href) { e.preventDefault(); if (ctx.live && sec?.scroll) smoothTo(sec.scroll); } else if (!ctx.live) e.preventDefault(); }}><E ctx={ctx} k="secondaryText" v={p.secondaryText} /> {sec?.href ? '→' : '↓'}</a>}
          </div>
          {p.showTrust !== false && (p.socialText || p.rating) && (
            <div className="trust" data-rm="showTrust" data-rm-label="rating row">
              <div className="avs">{['Riya S', 'Arjun P', 'Meena K', 'Sahil N', 'Vikas J'].map((n) => <Avatar key={n} name={n} />)}</div>
              <div>
                {p.rating ? <div className="stars">★★★★★ <E ctx={ctx} k="rating" v={p.rating} as="b" num fmt={(v) => `${v}/5`} />{p.reviews && <span className="muted"> · <E ctx={ctx} k="reviews" v={p.reviews} /> reviews</span>}</div> : null}
                <E ctx={ctx} k="socialText" v={p.socialText} as="div" className="muted sm" />
              </div>
            </div>
          )}
        </div>
        {((p.image && !banner) || p.showCard !== false || p.chip1 || p.chip2) && <div className="hero-visual">
          {p.image && !banner ? <Img src={p.image} alt={p.alt || ''} className="hero-img" priority sizes="(max-width: 760px) 100vw, 600px" /> : p.showCard !== false && (
            <div className="hcard" data-rm="showCard" data-rm-label="product card">
              <div className="hc-top"><E ctx={ctx} k="cardEmoji" v={p.cardEmoji} className="hc-emoji" />{p.cardTag && <span className="hc-tag"><i className="dot" /> <E ctx={ctx} k="cardTag" v={p.cardTag} /></span>}</div>
              <E ctx={ctx} k="cardTitle" v={p.cardTitle} as="h3" />
              {p.rating ? <div className="stars sm">★★★★★ <b>{p.rating}</b></div> : null}
              {p.cardPrice && <div className="hc-price"><E ctx={ctx} k="cardPrice" v={p.cardPrice} as="b" />{p.cardMrp && <E ctx={ctx} k="cardMrp" v={p.cardMrp} as="s" />}</div>}
              <ul className="checks">{(p.cardPoints || []).map((x, i) => x.text ? <li key={i} data-item={`cardPoints.${i}`}><E ctx={ctx} k={`cardPoints.${i}.text`} v={x.text} /></li> : null)}</ul>
              <Btn block onClick={go(ctx)} ctx={ctx} k="ctaText" link={link}>{p.ctaText}</Btn>
            </div>
          )}
          {p.chip1 && <E ctx={ctx} k="chip1" v={p.chip1} as="div" className="chip c1" />}
          {p.chip2 && <E ctx={ctx} k="chip2" v={p.chip2} as="div" className="chip c2" />}
        </div>}
      </div>
    </section>
  );
}

// The rating row under a hero's button (avatars, stars, social line)
const Trust = ({ p, ctx, stars = true }) => (p.showTrust !== false && (p.socialText || p.rating) ? (
  <div className="trust" data-rm="showTrust" data-rm-label="rating row">
    <div className="avs">{['Riya S', 'Arjun P', 'Meena K', 'Sahil N', 'Vikas J'].map((n) => <Avatar key={n} name={n} />)}</div>
    <div>
      {stars && p.rating ? <div className="stars">★★★★★ <E ctx={ctx} k="rating" v={p.rating} as="b" num fmt={(x) => `${x}/5`} />{p.reviews && <span className="muted"> · <E ctx={ctx} k="reviews" v={p.reviews} /> reviews</span>}</div> : null}
      <E ctx={ctx} k="socialText" v={p.socialText} as="div" className="muted sm" />
    </div>
  </div>
) : null);
// "01:10 · Why most brands stall" → ['01:10', 'Why most brands stall']
const chapter = (t) => { const m = String(t || '').match(/^(\d{1,2}:\d{2})\s*[·|—-]\s*(.+)$/); return m ? [m[1], m[2]] : ['', String(t || '')]; };
const secsOf = (t) => { const [m, s] = String(t || '').split(':').map(Number); return (m || 0) * 60 + (s || 0); };

// The video, or a poster frame with a play button until a video link is added
function VslPlayer({ p, ctx }) {
  if (p.videoUrl) return <div className="vsl-frame"><VideoEmbed url={p.videoUrl} /></div>;
  const total = secsOf(p.videoLength);
  const marks = (p.cardPoints || []).map((x) => chapter(x.text)[0]).filter(Boolean);
  return (
    <div className="vsl-frame">
      <div className="vsl-cover" role="img" aria-label={p.videoNote || 'Video'}>
        <span className="vsl-sound" aria-hidden="true">🔊 Tap to play with sound</span>
        <span className="vsl-play" aria-hidden="true"><i /></span>
        {p.videoNote && <E ctx={ctx} k="videoNote" v={p.videoNote} className="vsl-note" />}
        <div className="vsl-bar" aria-hidden="true">
          <span className="vsl-time">0:00 / {p.videoLength || '—'}</span>
          <span className="vsl-track"><i />{total > 0 && marks.map((m) => <b key={m} style={{ left: `${Math.min(98, (secsOf(m) / total) * 100)}%` }} />)}</span>
        </div>
        {ctx.editable && <em className="m-add">🎬 Add your video link in the section settings</em>}
      </div>
    </div>
  );
}

// Video sales letter: centred, beside the copy, or a dark cinema screen
function HeroVideo({ p, ctx, v }) {
  const link = buttonLink(p.ctaAction, p.ctaUrl, p.ctaNewTab);
  const cta = p.ctaText && <Btn big onClick={go(ctx)} ctx={ctx} k="ctaText" link={link}>{p.ctaText}</Btn>;
  const chapters = (p.cardPoints || []).some((x) => x.text) && (
    <ol className="vsl-chapters">{(p.cardPoints || []).map((x, i) => { const [t, title] = chapter(x.text); return x.text ? <li key={i} data-item={`cardPoints.${i}`}>{t && <time>{t}</time>}{ctx.editable ? <E ctx={ctx} k={`cardPoints.${i}.text`} v={x.text} /> : <span>{title}</span>}</li> : null; })}</ol>
  );
  if (v === 'videosplit') return (
    <section className="sec sec-hero v-videosplit">
      <div className="in hero-grid">
        <div className="hero-copy">
          {p.badge && <E ctx={ctx} k="badge" v={p.badge} className="badge" />}
          <E ctx={ctx} k="headline" v={p.headline} as="h1" isRich />
          <E ctx={ctx} k="subheadline" v={p.subheadline} as="p" className="lead" multiline />
          <div className="hero-ctas">{cta}</div>
          <Trust p={p} ctx={ctx} />
        </div>
        <div className="hero-visual">
          <VslPlayer p={p} ctx={ctx} />
          {chapters && <div className="vsl-inside"><small>Inside the video</small>{chapters}</div>}
          {p.chip1 && <E ctx={ctx} k="chip1" v={p.chip1} as="div" className="chip c1" />}
        </div>
      </div>
    </section>
  );
  return (
    <section className={`sec sec-hero v-${v}`}>
      <div className="in vsl">
        {p.badge && <E ctx={ctx} k="badge" v={p.badge} className="badge" />}
        <E ctx={ctx} k="headline" v={p.headline} as="h1" isRich />
        <E ctx={ctx} k="subheadline" v={p.subheadline} as="p" className="lead" multiline />
        <VslPlayer p={p} ctx={ctx} />
        <div className="vsl-foot">
          <div className="hero-ctas">{cta}</div>
          {v === 'cinema' ? chapters : <Trust p={p} ctx={ctx} />}
        </div>
        {v === 'cinema' && <Trust p={p} ctx={ctx} />}
      </div>
    </section>
  );
}

// Webinar / event: a ticket beside the copy, a centred stage with an event bar, or a poster
function HeroEvent({ p: raw, ctx, v }) {
  const next = !ctx.editable && ctx.webinar?.sessions?.[0];
  const vz = useViewerTz();
  const off = vz || ctx.webinar?.timezone || (ctx.webinar?.tzOffset ?? 330);
  const p = next ? { ...raw, eventDate: fmtDay(next, off), eventTime: `${fmtTime(next, off)} ${zoneLabel(off, next)}` } : raw;
  const link = buttonLink(p.ctaAction, p.ctaUrl, p.ctaNewTab);
  const meta = [['When', 'eventDate'], ['Time', 'eventTime'], ['Format', 'eventLength']].filter(([, k]) => p[k]);
  const host = p.hostName && (
    <div className="ev-host"><Avatar name={p.hostName} /><div><E ctx={ctx} k="hostName" v={p.hostName} as="b" />{p.hostRole && <E ctx={ctx} k="hostRole" v={p.hostRole} as="small" />}</div></div>
  );
  const copy = (
    <>
      {p.badge && <E ctx={ctx} k="badge" v={p.badge} className="badge" />}
      <E ctx={ctx} k="headline" v={p.headline} as="h1" isRich />
      <E ctx={ctx} k="subheadline" v={p.subheadline} as="p" className="lead" multiline />
    </>
  );
  if (v === 'stage') return (
    <section className="sec sec-hero v-stage">
      <div className="in">
        <div className="stage-copy">{copy}</div>
        <div className="ev-bar">
          {meta.map(([label, k]) => <div key={k} className="ev-cell"><small>{label}</small><E ctx={ctx} k={k} v={p[k]} as="b" /></div>)}
          {host && <div className="ev-cell ev-cell-host">{host}</div>}
          <div className="ev-go"><Btn big onClick={go(ctx)} ctx={ctx} k="ctaText" link={link}>{p.ctaText}</Btn></div>
        </div>
        <div className="stage-foot">
          {p.chip1 && <E ctx={ctx} k="chip1" v={p.chip1} as="div" className="ev-seats" />}
          <Trust p={p} ctx={ctx} stars={false} />
        </div>
      </div>
    </section>
  );
  if (v === 'poster') return (
    <section className="sec sec-hero v-poster">
      <div className="in hero-grid">
        <div className="hero-copy">
          {copy}
          <div className="hero-ctas"><Btn big onClick={go(ctx)} ctx={ctx} k="ctaText" link={link}>{p.ctaText}</Btn>{p.chip1 && <E ctx={ctx} k="chip1" v={p.chip1} as="div" className="ev-seats" />}</div>
          <Trust p={p} ctx={ctx} stars={false} />
        </div>
        <div className="poster">
          <div className="po-top"><span className="po-live"><i className="dot" /> {p.cardTag || 'LIVE'}</span>{p.cardPrice && <E ctx={ctx} k="cardPrice" v={p.cardPrice} className="po-price" />}</div>
          <div className="po-when">{p.eventDate && <E ctx={ctx} k="eventDate" v={p.eventDate} as="b" />}{p.eventTime && <E ctx={ctx} k="eventTime" v={p.eventTime} as="span" />}</div>
          <E ctx={ctx} k="cardTitle" v={p.cardTitle} as="h3" />
          {p.eventLength && <E ctx={ctx} k="eventLength" v={p.eventLength} as="div" className="po-len" />}
          {host}
          <span className="po-word" aria-hidden="true">LIVE</span>
        </div>
      </div>
    </section>
  );
  return (
    <section className="sec sec-hero v-event">
      <div className="in hero-grid">
        <div className="hero-copy">
          {copy}
          <Trust p={p} ctx={ctx} stars={false} />
        </div>
        <div className="ticket">
          <div className="tk-top">
            <span className="tk-live"><i className="dot" /> {p.cardTag || 'LIVE'}</span>
            {p.cardPrice && <E ctx={ctx} k="cardPrice" v={p.cardPrice} className="tk-price" />}
          </div>
          <E ctx={ctx} k="cardTitle" v={p.cardTitle} as="h3" />
          <div className="tk-when">
            {meta.map(([label, k]) => <div key={k}><small>{label}</small><E ctx={ctx} k={k} v={p[k]} as="b" /></div>)}
          </div>
          <ul className="checks">{(p.cardPoints || []).map((x, i) => x.text ? <li key={i} data-item={`cardPoints.${i}`}><E ctx={ctx} k={`cardPoints.${i}.text`} v={x.text} /></li> : null)}</ul>
          <div className="tk-cut" aria-hidden="true" />
          {host}
          <Btn block onClick={go(ctx)} ctx={ctx} k="ctaText" link={link}>{p.ctaText}</Btn>
          {p.chip1 && <E ctx={ctx} k="chip1" v={p.chip1} as="div" className="tk-seats" />}
        </div>
      </div>
    </section>
  );
}

// Bento: the promise in a big tile, with price, rating, proof and benefits in smaller tiles around it
function HeroBento({ p, ctx }) {
  const link = buttonLink(p.ctaAction, p.ctaUrl, p.ctaNewTab);
  return (
    <section className="sec sec-hero v-bento">
      <div className="in bento">
        <div className="bt bt-main">
          {p.badge && <E ctx={ctx} k="badge" v={p.badge} className="badge" />}
          <E ctx={ctx} k="headline" v={p.headline} as="h1" isRich />
          <E ctx={ctx} k="subheadline" v={p.subheadline} as="p" className="lead" multiline />
          <div className="hero-ctas"><Btn big onClick={go(ctx)} ctx={ctx} k="ctaText" link={link}>{p.ctaText}</Btn></div>
        </div>
        <div className="bt bt-buy">
          <E ctx={ctx} k="cardEmoji" v={p.cardEmoji} className="hc-emoji" />
          <div><E ctx={ctx} k="cardTitle" v={p.cardTitle} as="h3" />{p.cardPrice && <div className="hc-price"><E ctx={ctx} k="cardPrice" v={p.cardPrice} as="b" />{p.cardMrp && <E ctx={ctx} k="cardMrp" v={p.cardMrp} as="s" />}</div>}</div>
        </div>
        {p.rating ? <div className="bt bt-rate"><b><E ctx={ctx} k="rating" v={p.rating} num /></b><span className="stars">★★★★★</span>{p.reviews && <small><E ctx={ctx} k="reviews" v={p.reviews} /> reviews</small>}</div> : null}
        <div className="bt bt-proof"><div className="avs">{['Riya S', 'Arjun P', 'Meena K', 'Sahil N'].map((n) => <Avatar key={n} name={n} />)}</div>{p.socialText && <E ctx={ctx} k="socialText" v={p.socialText} as="small" />}</div>
        <div className="bt bt-pts">
          <ul className="checks">{(p.cardPoints || []).map((x, i) => x.text ? <li key={i} data-item={`cardPoints.${i}`}><E ctx={ctx} k={`cardPoints.${i}.text`} v={x.text} /></li> : null)}</ul>
          {(p.chip1 || p.chip2) && <div className="bt-chips">{p.chip1 && <E ctx={ctx} k="chip1" v={p.chip1} as="span" />}{p.chip2 && <E ctx={ctx} k="chip2" v={p.chip2} as="span" />}</div>}
        </div>
      </div>
    </section>
  );
}

const Stats = ({ p, ctx }) => (
  <Sec type="stats" v={vOf('stats', p)}><div className="stats-grid">{(p.items || []).map((i, k) => <div key={k} data-item={`items.${k}`}><E ctx={ctx} k={`items.${k}.value`} v={i.value} as="b" /><E ctx={ctx} k={`items.${k}.label`} v={i.label} /></div>)}</div></Sec>
);

const Problem = ({ p, ctx }) => (
  <Sec type="problem" className="alt" v={vOf('problem', p)}>
    <Head eyebrow={p.eyebrow} title={p.title} subtitle={p.subtitle} ctx={ctx} left={vOf('problem', p) === 'split'} />
    <div className="pain-grid">{(p.items || []).map((x, i) => <div className="pc pain" key={i} data-item={`items.${i}`}><span className="x">✕</span><E ctx={ctx} k={`items.${i}.text`} v={x.text} as="p" /></div>)}</div>
    {p.closing && <E ctx={ctx} k="closing" v={p.closing} as="p" className="closing" />}
  </Sec>
);

const Features = ({ p, ctx }) => (
  <Sec type="features" v={vOf('features', p)}>
    <Head eyebrow={p.eyebrow} title={p.title} subtitle={p.subtitle} ctx={ctx} left={vOf('features', p) === 'list'} />
    <div className="feat-grid">
      {(p.items || []).map((i, k) => (
        <div className="pc feat" key={k} data-item={`items.${k}`}>
          <span className="fnum" aria-hidden="true">{pad(k + 1)}</span>
          <E ctx={ctx} k={`items.${k}.icon`} v={i.icon || '✓'} className="ic" />
          <div><E ctx={ctx} k={`items.${k}.title`} v={i.title} as="h3" /><E ctx={ctx} k={`items.${k}.text`} v={i.text} as="p" /></div>
        </div>
      ))}
    </div>
  </Sec>
);

const Steps = ({ p, ctx }) => (
  <Sec type="steps" id="how" v={vOf('steps', p)}>
    <Head eyebrow={p.eyebrow} title={p.title} ctx={ctx} />
    <div className="steps" style={{ '--n': (p.items || []).length || 1 }}>
      {(p.items || []).map((s, i) => <div className="step" key={i} data-item={`items.${i}`}><span className="num">{i + 1}</span><E ctx={ctx} k={`items.${i}.title`} v={s.title} as="h3" /><E ctx={ctx} k={`items.${i}.text`} v={s.text} as="p" /></div>)}
    </div>
  </Sec>
);

const Compare = ({ p, ctx }) => (
  <Sec type="compare" className="alt" v={vOf('compare', p)}>
    <Head eyebrow={p.eyebrow} title={p.title} ctx={ctx} />
    {vOf('compare', p) === 'table' ? (
      <div className="pc cmp-table">
        <div className="ct-row ct-head"><span /><E ctx={ctx} k="leftTitle" v={p.leftTitle} as="b" /><span className="ct-us">{p.tag && <E ctx={ctx} k="tag" v={p.tag} className="cmp-tag" />}<E ctx={ctx} k="rightTitle" v={p.rightTitle} as="b" /></span></div>
        {(p.rows || []).map((r, i) => (
          <div className="ct-row" key={i} data-item={`rows.${i}`}><span className="ct-n">{pad(i + 1)}</span><span className="ct-bad">✕ <E ctx={ctx} k={`rows.${i}.left`} v={r.left} /></span><span className="ct-good">✓ <E ctx={ctx} k={`rows.${i}.right`} v={r.right} /></span></div>
        ))}
      </div>
    ) : <div className="cmp">
      <div className="pc cmp-col bad"><E ctx={ctx} k="leftTitle" v={p.leftTitle} as="h3" /><ul>{(p.rows || []).map((r, i) => <li key={i} data-item={`rows.${i}`}><span className="cmp-ic">✕</span><E ctx={ctx} k={`rows.${i}.left`} v={r.left} /></li>)}</ul></div>
      <div className="pc cmp-col good">{p.tag && <E ctx={ctx} k="tag" v={p.tag} className="cmp-tag" />}<E ctx={ctx} k="rightTitle" v={p.rightTitle} as="h3" /><ul>{(p.rows || []).map((r, i) => <li key={i} data-item={`rows.${i}`}><span className="cmp-ic">✓</span><E ctx={ctx} k={`rows.${i}.right`} v={r.right} /></li>)}</ul></div>
    </div>}
  </Sec>
);

const Testimonials = ({ p, ctx }) => (
  <Sec type="testimonials" v={vOf('testimonials', p)}>
    <Head eyebrow={p.eyebrow} title={p.title} ctx={ctx} />
    <div className="tgrid3">
      {(p.items || []).map((t, i) => (
        <figure className="pc quote" key={i} data-item={`items.${i}`}>
          <div className="stars">★★★★★</div>
          <blockquote>“<E ctx={ctx} k={`items.${i}.quote`} v={t.quote} multiline />”</blockquote>
          <figcaption><Avatar name={t.name} /><div><E ctx={ctx} k={`items.${i}.name`} v={t.name} as="b" />{t.tag && <small>✔ <E ctx={ctx} k={`items.${i}.tag`} v={t.tag} /></small>}</div></figcaption>
          <span className="wa-time" aria-hidden="true">{pad(9 + ((i * 3) % 12))}:{pad((i * 17 + 4) % 60)} ✓✓</span>
        </figure>
      ))}
    </div>
  </Sec>
);

// ---------- images: optional CDN host + phone-sized copies ----------
// Uploads optimised in the editor are saved as name.v.webp (≤1920px) with a name.v-800.webp copy for phones.
const cdnBase = () => String((typeof window !== 'undefined' ? window.__FF_CDN__ : globalThis.__FF_CDN__) || '').replace(/\/$/, '');
export const mediaUrl = (u) => (typeof u === 'string' && u.startsWith('/uploads/') && cdnBase() ? cdnBase() + u : u);
const smallCopy = (u) => (typeof u === 'string' && /^\/uploads\/[^?#]+\.v\.webp$/.test(u) ? u.replace(/\.v\.webp$/, '.v-800.webp') : null);
export function Img({ src, alt = '', priority = false, sizes = '(max-width: 760px) 100vw, 960px', ...rest }) {
  const sm = smallCopy(src);
  return (
    <img src={mediaUrl(src)} srcSet={sm ? `${mediaUrl(sm)} 800w, ${mediaUrl(src)} 1920w` : undefined} sizes={sm ? sizes : undefined}
      alt={alt} loading={priority ? 'eager' : 'lazy'} decoding="async" fetchpriority={priority ? 'high' : undefined} {...rest} />
  );
}

const Mentor = ({ p, ctx }) => (
  <Sec type="mentor" className="alt" v={vOf('mentor', p)}>
    <div className="mentor">
      <div className="m-photo">
        {p.image ? <Img src={p.image} alt={p.name} sizes="(max-width: 760px) 90vw, 420px" /> : (
          <div className="m-card">
            <span className="m-ini">{initials(p.name)}</span>
            <b>{p.name}</b>
            {p.role && <small>{p.role}</small>}
            {ctx.editable && <em className="m-add">📷 Add a photo in the section settings</em>}
          </div>
        )}
        {p.badge && <E ctx={ctx} k="badge" v={p.badge} className="m-badge" />}
      </div>
      <div>
        {p.eyebrow && <E ctx={ctx} k="eyebrow" v={p.eyebrow} className="eyebrow" />}
        <E ctx={ctx} k="name" v={p.name} as="h2" />
        <E ctx={ctx} k="role" v={p.role} as="div" className="m-role" />
        <E ctx={ctx} k="bio" v={p.bio} as="p" className="m-bio" multiline />
        <div className="m-pts">{(p.points || []).map((x, i) => <E key={i} ctx={ctx} k={`points.${i}.text`} v={x.text} />)}</div>
      </div>
    </div>
  </Sec>
);

const Bonuses = ({ p, ctx }) => (
  <Sec type="bonuses" v={vOf('bonuses', p)}>
    <Head eyebrow={p.eyebrow} title={p.title} ctx={ctx} />
    <div className="bonus-grid">
      {(p.items || []).map((b, i) => (
        <div className="bonus" key={i} data-item={`items.${i}`}>
          {p.freeLabel && <span className="free">{p.freeLabel}</span>}
          <E ctx={ctx} k={`items.${i}.icon`} v={b.icon} className="bic" />
          {p.itemLabel && <small>{p.itemLabel}{/#\s*$/.test(p.itemLabel) ? i + 1 : ''}</small>}
          <E ctx={ctx} k={`items.${i}.title`} v={b.title} as="h3" />
          {b.value && <div className="worth">{p.worthLabel} <E ctx={ctx} k={`items.${i}.value`} v={b.value} as="s" /></div>}
        </div>
      ))}
    </div>
    {p.totalText && <E ctx={ctx} k="totalText" v={p.totalText} as="p" className="btotal" />}
  </Sec>
);

const Guarantee = ({ p, ctx }) => (
  <Sec type="guarantee" v={vOf('guarantee', p)}>
    <div className="pc gbox">
      {p.showSeal !== false && <div className="seal" data-rm="showSeal" data-rm-label="seal"><div>{Number(p.days) > 0 ? <><b>{p.days}</b><small>DAY</small><span>MONEY-BACK</span></> : <><b>100%</b><span>FREE · NO RISK</span></>}</div></div>}
      <div><E ctx={ctx} k="title" v={p.title} as="h2" /><E ctx={ctx} k="body" v={p.body} as="p" multiline /></div>
    </div>
  </Sec>
);

// Only real deadlines (fake urgency is a dark pattern under India's e-commerce rules): a fixed date the seller
// sets, the next live webinar session, or a per-visitor window that is saved and never restarts once it ends
const cdMode = (p) => p.mode || (Number(p.endsAt) > 0 ? 'fixed' : 'evergreen');
function Countdown({ p, ctx }) {
  const mode = cdMode(p), mins = Number(p.minutes) || 15;
  const key = `ff_cd_${typeof location === 'undefined' ? '' : location.pathname}_${mins * 60}`;
  const target = () => {
    // the editor and template previews show how it looks (days: a template's "N days after it's created")
    if (mode === 'fixed') return Number(p.endsAt) || (!ctx.live && Number(p.days) > 0 ? Date.now() + p.days * 864e5 : 0);
    if (mode === 'session') return Number(ctx.webinar?.sessions?.[0] || ctx.delivery?.webinar?.start) || (!ctx.live ? Date.now() + 2 * 864e5 : 0);
    if (!ctx.live || typeof window === 'undefined') return Date.now() + mins * 60000;
    try {
      let end = Number(localStorage.getItem(key));
      if (!end) { end = Date.now() + mins * 60000; localStorage.setItem(key, end); }
      return end;
    } catch { return Date.now() + mins * 60000; }
  };
  const [end, setEnd] = useState(target);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { setEnd(target()); }, [mode, p.endsAt, mins, ctx.webinar, ctx.delivery]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!end) return ctx.editable ? <Sec type="countdown"><p className="cd-label">⏳ {mode === 'session' ? 'Counts down to the next session of the webinar on this page' : 'Set the date and time the offer really ends in the panel'}</p></Sec> : null;
  const left = Math.max(0, Math.round((end - now) / 1000));
  if (!left) {
    if (p.hideEnded && !ctx.editable) return null;
    return <Sec type="countdown"><p className="cd-label">⏳ <E ctx={ctx} k="endedText" v={p.endedText || tr(ctx.lang, 'Offer ended')} /></p></Sec>;
  }
  const d = Math.floor(left / 86400);
  const parts = [...(d ? [[d, 'Days']] : []), [Math.floor((left % 86400) / 3600), 'Hours'], [Math.floor((left % 3600) / 60), 'Minutes'], [left % 60, 'Seconds']];
  return (
    <Sec type="countdown">
      {p.label && <p className="cd-label">⏳ <E ctx={ctx} k="label" v={p.label} /></p>}
      <div className="tiles">{parts.map(([v, l]) => <div className="tile" key={l}><b>{pad(v)}</b><small>{tr(ctx.lang, l)}</small></div>)}</div>
    </Sec>
  );
}

// ---------- website: header menu and footer ----------
// to: a page of this funnel by its web name ("" = the first page), a #section, or a full link
const pageSlug = (s) => String(s || '').trim().toLowerCase().replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9-]/g, '').slice(0, 60);
export function linkTarget(to) {
  const t = String(to ?? '').trim();
  if (/^(https?:|mailto:|tel:)/i.test(t)) { const h = safeHref(t); return h ? { href: h, newTab: /^https?:/i.test(h) } : null; }
  if (t.startsWith('#')) { const id = cleanAnchor(t.slice(1)); return id ? { scroll: id } : null; }
  return { page: pageSlug(t) };
}
function NavLink({ to, ctx, className = '', children, onGo }) {
  const l = linkTarget(to);
  if (!l) return <span className={className}>{children}</span>;
  if (l.scroll) return <a className={className} href={`#${l.scroll}`} onClick={(e) => { e.preventDefault(); onGo?.(); if (ctx.live) smoothTo(l.scroll); }}>{children}</a>;
  if (l.href) return <a className={className} href={l.href} {...(l.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})} onClick={(e) => { if (!ctx.live) e.preventDefault(); }}>{children}</a>;
  const here = l.page ? ctx.stepSlug === l.page : ctx.stepIndex === 0;
  return (
    <a className={`${className}${here ? ' on' : ''}`} aria-current={here ? 'page' : undefined} href={ctx.pageHref ? ctx.pageHref(l.page) : '#'}
      onClick={(e) => { if (!ctx.live) return e.preventDefault(); if (ctx.goPage) { e.preventDefault(); onGo?.(); ctx.goPage(l.page); } }}>{children}</a>
  );
}
function Navbar({ p, ctx }) {
  const [open, setOpen] = useState(false);
  const links = (p.links || []).map((l, i) => ({ ...l, i })).filter((l) => l.label || ctx.editable);
  const logo = safeHref(p.logo);
  return (
    <header className={`navbar ${ctx.live ? 'live' : ''} ${open ? 'open' : ''}`}>
      <div className="in nav-in">
        <NavLink to="" ctx={ctx} className="nav-brand">{logo && <img src={logo} alt="" />}<E ctx={ctx} k="brand" v={p.brand} /></NavLink>
        {links.length > 0 && <button type="button" className="nav-burger" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}><span /><span /><span /></button>}
        <nav className="nav-links" aria-label="Main">
          {links.map((l) => <NavLink key={l.i} to={l.to} ctx={ctx} onGo={() => setOpen(false)}><E ctx={ctx} k={`links.${l.i}.label`} v={l.label} keep={ctx.editable} /></NavLink>)}
          {(p.buttonText || ctx.editable) && <NavLink to={p.buttonTo} ctx={ctx} className="nav-cta" onGo={() => setOpen(false)}><E ctx={ctx} k="buttonText" v={p.buttonText} /></NavLink>}
        </nav>
      </div>
    </header>
  );
}
function Footer({ p, ctx }) {
  const links = (p.links || []).map((l, i) => ({ ...l, i })).filter((l) => l.label || ctx.editable);
  return (
    <footer className="sitefoot">
      <div className="in">
        <div className="sf-top">
          <div className="sf-about"><E ctx={ctx} k="brand" v={p.brand} as="b" /><E ctx={ctx} k="text" v={p.text} as="p" multiline /></div>
          {links.length > 0 && <nav className="sf-links" aria-label="Footer">{links.map((l) => <NavLink key={l.i} to={l.to} ctx={ctx}><E ctx={ctx} k={`links.${l.i}.label`} v={l.label} keep={ctx.editable} /></NavLink>)}</nav>}
        </div>
        <E ctx={ctx} k="note" v={p.note} as="small" className="sf-note" />
      </div>
    </footer>
  );
}

function HelloBar({ p, ctx }) {
  const msgs = (p.messages || []).filter((m) => m.text);
  const [i, setI] = useState(0);
  useTick(() => setI((x) => x + 1), ctx.live && msgs.length > 1);
  if (ctx.editable) { const j = (p.messages || []).findIndex((m) => m.text); return <div className="hellobar">{j >= 0 ? <E ctx={ctx} k={`messages.${j}.text`} v={p.messages[j].text} /> : <span>Add a message in the panel</span>}{msgs.length > 1 && <small className="hb-more"> +{msgs.length - 1} more · rotates every 9–10s</small>}</div>; }
  return <div className={`hellobar ${ctx.live ? 'live' : ''}`}><span key={i}>{msgs[i % (msgs.length || 1)]?.text}</span></div>;
}

// Real visitors to this step in the last 30 minutes (from the page's analytics); hidden while it's quiet
function LiveCount({ p, ctx }) {
  const n = Number(ctx.social?.viewers) || 0;
  const text = (v) => tr(ctx.lang, '{n} people viewed this page in the last 30 minutes', { n: v });
  if (!ctx.live) return <div className="livecount"><span className="lc-pill"><i className="dot" /> {text('N')}</span></div>;
  if (n < Math.max(1, Number(p.minShow) || 3)) return null;
  return <div className="livecount"><span className="lc-pill"><i className="dot" /> {text(n)}</span></div>;
}

// The seller's real stock: the number they entered, less the real orders since they entered it (from the server)
function Stock({ p, ctx }) {
  const set = Number(p.left) > 0;
  const left = Math.max(0, ctx.social?.stock?.[ctx.blockId] ?? Math.round(Number(p.left) || 0));
  if (!set) return ctx.editable ? <Sec type="stock"><div className="pc stockbox"><div className="stock-top"><b>⚡ Enter how many you really have in the panel — until then this is hidden</b></div></div></Sec> : null;
  const total = Number(p.total) || 0;
  const pct = total > left ? Math.round(100 - (left / total) * 100) : 0;
  return (
    <Sec type="stock">
      <div className="pc stockbox">
        <div className="stock-top"><b>⚡ {left ? <E ctx={ctx} k="label" v={p.label} fmt={(v) => String(v || '').replace('{n}', left)} /> : tr(ctx.lang, 'Sold out')}</b>{pct > 0 && <span className="stock-pct">{pct}% claimed</span>}</div>
        {pct > 0 && <div className="track"><div style={{ width: `${pct}%` }} /></div>}
      </div>
    </Sec>
  );
}

const agoText = (lang, at) => {
  const m = Math.max(1, Math.round((Date.now() - at) / 60000));
  if (m < 60) return tr(lang, m > 1 ? '{n} mins ago' : '{n} min ago', { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return tr(lang, h > 1 ? '{n} hours ago' : '{n} hour ago', { n: h });
  const d = Math.round(h / 24);
  return tr(lang, d > 1 ? '{n} days ago' : '{n} day ago', { n: d });
};
// Real recent buyers of this funnel (first name, city, when) — nothing at all until someone has bought
function Proof({ p, ctx }) {
  const items = ctx.social?.orders || [];
  const [toast, setToast] = useState(null);
  const sec = Math.max(9, Number(p.intervalSec) || 9);
  useEffect(() => {
    if (!ctx.live || !items.length) return;
    let t, h, i = 0;
    const show = () => {
      setToast(items[i++ % items.length]);
      h = setTimeout(() => setToast(null), 5000);
      t = setTimeout(show, rnd(sec * 1000, sec * 1000 + 1000));
    };
    t = setTimeout(show, 3000);
    return () => { clearTimeout(t); clearTimeout(h); };
  }, [ctx.live, items.length, sec]);
  if (!ctx.live) {
    return (
      <FloatPreview label="🔔 Recent buyers popup" hint={`Bottom-left corner · shows your real recent orders (first name and city), one every ${sec}–${sec + 1}s · hidden until you have an order`}>
        <div className="toast static"><Avatar name="Priya" size={42} /><div><b>Priya</b> from Pune<br />{tr(ctx.lang, 'bought')}<small>2 mins ago</small></div></div>
      </FloatPreview>
    );
  }
  return toast ? (
    <div className="toast">
      <Avatar name={toast.name} size={42} />
      <div><b>{toast.name}</b>{toast.city && <> {tr(ctx.lang, 'from')} {toast.city}</>}<br /><span>{tr(ctx.lang, 'bought')}</span><small>{agoText(ctx.lang, toast.at)}</small></div>
    </div>
  ) : null;
}

function ExitPopup({ p, ctx }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!ctx.live || sessionStorage.getItem('ff_exit')) return;
    const fire = () => { if (!sessionStorage.getItem('ff_exit')) { sessionStorage.setItem('ff_exit', '1'); setOpen(true); } };
    const onLeave = (e) => { if (e.clientY <= 0) fire(); };
    document.addEventListener('mouseleave', onLeave);
    // Touch devices have no mouse to leave with, so fall back to a timer there
    const t = window.matchMedia('(pointer: coarse)').matches ? setTimeout(fire, 40000) : null;
    return () => { document.removeEventListener('mouseleave', onLeave); clearTimeout(t); };
  }, [ctx.live]);
  if (!ctx.live) {
    return (
      <FloatPreview label="🚪 Exit-intent popup" hint="Shown once when a visitor is about to leave (after 40 seconds on phones)">
        <div className="modal static">
          <div className="m-emoji">🎁</div>
          <E ctx={ctx} k="title" v={p.title} as="h2" /><E ctx={ctx} k="body" v={p.body} as="p" />
          <E ctx={ctx} k="code" v={p.code} as="div" className="code" />
          <Btn big block ctx={ctx} k="buttonText">{p.buttonText}</Btn>
          <span className="decline">{tr(ctx.lang, 'No thanks')}</span>
        </div>
      </FloatPreview>
    );
  }
  if (!open) return null;
  return (
    <div className="overlay" onClick={() => setOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="mx" onClick={() => setOpen(false)}>×</button>
        <div className="m-emoji">🎁</div>
        <h2>{p.title}</h2><p>{p.body}</p>
        <div className="code">{p.code}</div>
        <Btn big block onClick={() => { setOpen(false); ctx.onClaim?.(p.code); ctx.onNext(); }}>{p.buttonText}</Btn>
        <a className="decline" href="#" onClick={(e) => { e.preventDefault(); setOpen(false); }}>{tr(ctx.lang, 'No thanks')}</a>
      </div>
    </div>
  );
}

function StickyBar({ p, ctx }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!ctx.live) return;
    const f = () => setShow(window.scrollY > 700);
    window.addEventListener('scroll', f);
    return () => window.removeEventListener('scroll', f);
  }, [ctx.live]);
  if (!ctx.live) {
    return (
      <FloatPreview label="📌 Sticky buy bar" hint="Slides up at the bottom once the visitor scrolls past the first screen">
        <div className="stickybar on static"><span><E ctx={ctx} k="text" v={p.text} /> <E ctx={ctx} k="price" v={p.price} as="b" /></span><Btn ctx={ctx} k="buttonText">{p.buttonText}</Btn></div>
      </FloatPreview>
    );
  }
  return <div className={`stickybar ${show ? 'on' : ''}`}><span>{p.text} <b>{p.price}</b></span><Btn onClick={ctx.onNext} ctx={ctx} link={buttonLink(p.buttonAction, p.buttonUrl, p.buttonNewTab)}>{p.buttonText}</Btn></div>;
}

function WhatsApp({ p, ctx }) {
  if (!ctx.live) {
    return (
      <FloatPreview label="💬 WhatsApp chat button" hint={`Bottom-right corner · opens a chat with ${!p.number || p.number === '919999999999' ? 'your Support WhatsApp from Settings (hidden if it isn’t set)' : `+${p.number}`}`}>
        <span className="wa static"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z" /></svg><E ctx={ctx} k="label" v={p.label} /></span>
      </FloatPreview>
    );
  }
  return (
    <a className="wa" target="_blank" rel="noreferrer" href={`https://wa.me/${p.number}?text=${encodeURIComponent(p.message || '')}`}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-3.3-.8-2.8-1.1-4.5-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8 0-1.4.7-2 1-2.3.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.4.6-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1.1c.2-.3.4-.2.7-.1l1.900.9c.3.1.5.2.5.3.1.2.1.7-.1 1.1z" /></svg>
      <span>{p.label}</span>
    </a>
  );
}

// Prices on funnels include GST (the invoice splits it out), so rupee prices say so (Legal Metrology / e-commerce rules)
const inr = (c) => !c || /^(₹|rs\.?|inr)$/i.test(String(c).trim());
const TaxNote = ({ c, ctx }) => (inr(c) ? <p className="muted sm tax-note" style={{ fontSize: 12, margin: '2px 0 0' }}>{tr(ctx.lang, 'Inclusive of all taxes')}</p> : null);

function Pricing({ p, ctx }) {
  const off = p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0;
  const v = vOf('pricing', p);
  if (v === 'split') {
    return (
      <Sec type="pricing" id="pricing" v="split">
        <div className="psplit">
          <div className="ps-inc">
            {p.badge && <E ctx={ctx} k="badge" v={p.badge} as="div" className="eyebrow" />}
            {p.title && <E ctx={ctx} k="title" v={p.title} as="h2" />}
            <ul className="checks">{(p.bullets || []).map((b, i) => b.text ? <li key={i} data-item={`bullets.${i}`} className={b.text.startsWith('BONUS') ? 'bonus-li' : ''}><E ctx={ctx} k={`bullets.${i}.text`} v={b.text} /></li> : null)}</ul>
          </div>
          <div className="pc ps-buy">
            <div className="pprice">
              {(off > 0 || ctx.editable) && <E ctx={ctx} k="mrp" v={p.mrp} as="s" num fmt={(v2) => money(p.currency, v2)} />}
              <E ctx={ctx} k="price" v={p.price} as="b" num fmt={(v2) => money(p.currency, v2)} />
            </div>
            {off > 0 && <span className="off">You save {off}%</span>}
            <TaxNote c={p.currency} ctx={ctx} />
            {p.priceNote && <E ctx={ctx} k="priceNote" v={p.priceNote} as="p" className="muted sm" />}
            <Btn big block onClick={go(ctx)} ctx={ctx} k="buttonText" link={buttonLink(p.buttonAction, p.buttonUrl, p.buttonNewTab)}>{p.buttonText}</Btn>
            {p.payMethods && (ctx.editable ? <E ctx={ctx} k="payMethods" v={p.payMethods} as="div" className="pay pay-ed" /> : <div className="pay">{String(p.payMethods).split(/\s*[·,|]\s*/).filter(Boolean).map((m) => <span key={m}>{m}</span>)}</div>)}
            {p.note && <E ctx={ctx} k="note" v={p.note} as="p" className="pnote" />}
          </div>
        </div>
      </Sec>
    );
  }
  return (
    <Sec type="pricing" id="pricing">
      <div className="pbox">
        {p.badge && <E ctx={ctx} k="badge" v={p.badge} as="div" className="ribbon" />}
        {p.title && <E ctx={ctx} k="title" v={p.title} as="h3" className="ptitle" />}
        <div className="pprice">
          {(off > 0 || ctx.editable) && <E ctx={ctx} k="mrp" v={p.mrp} as="s" num fmt={(v) => money(p.currency, v)} />}
          <E ctx={ctx} k="price" v={p.price} as="b" num fmt={(v) => money(p.currency, v)} />
          {off > 0 && <span className="off">Save {off}%</span>}
        </div>
        <TaxNote c={p.currency} ctx={ctx} />
        {p.priceNote && <E ctx={ctx} k="priceNote" v={p.priceNote} as="p" className="muted sm" />}
        <ul className="checks">{(p.bullets || []).map((b, i) => b.text ? <li key={i} data-item={`bullets.${i}`} className={b.text.startsWith('BONUS') ? 'bonus-li' : ''}><E ctx={ctx} k={`bullets.${i}.text`} v={b.text} /></li> : null)}</ul>
        <Btn big block onClick={go(ctx)} ctx={ctx} k="buttonText" link={buttonLink(p.buttonAction, p.buttonUrl, p.buttonNewTab)}>{p.buttonText}</Btn>
        {p.payMethods && (ctx.editable ? <E ctx={ctx} k="payMethods" v={p.payMethods} as="div" className="pay pay-ed" /> : <div className="pay">{String(p.payMethods).split(/\s*[·,|]\s*/).filter(Boolean).map((m) => <span key={m}>{m}</span>)}</div>)}
        {p.note && <E ctx={ctx} k="note" v={p.note} as="p" className="pnote" />}
      </div>
    </Sec>
  );
}

const sessionLabel = (t, zone = 330) => fmtWhenShort(t, zone);
const sessionZone = (vz, w) => vz || w?.timezone || (w?.tzOffset ?? 330);
// the registrant's seat, in their own time zone (the host's until the browser reports it)
function SeatTime({ w }) { const vz = useViewerTz(); return sessionLabel(w.start, sessionZone(vz, w)); }
// the consent notice (DPDP) under forms — a required tick box when the seller asks for one
function Consent({ ctx, checked, onChange }) {
  const pv = ctx.privacy;
  if (!pv || ctx.editable) return null;
  const text = <>{pv.line} <a href={pv.policy} target="_blank" rel="noreferrer">{tr(ctx.lang, 'Privacy Policy')}</a></>;
  return pv.checkbox ? <label className="fconsent"><input type="checkbox" required checked={!!checked} onChange={(e) => onChange(e.target.checked)} /> <span>{text}</span></label> : <p className="fconsent">{text}</p>;
}
const consentOf = (ctx, agree) => (ctx.privacy ? { consent: ctx.privacy.checkbox ? !!agree : true } : {});

function OptinForm({ p, ctx }) {
  const vz = useViewerTz();
  const [f, setF] = useState({ name: '', email: '', phone: '' });
  const [agree, setAgree] = useState(false);
  const [err, setErr] = useState('');
  const sessions = ctx.webinar?.sessions || [];
  const [session, setSession] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const pts = (p.points || []).filter((x) => x.text);
  return (
    <Sec type="optin" id={ctx.inPopup ? undefined : 'optin'} className="alt">
      <div className={pts.length ? 'optin-grid' : 'optin-solo'}>
        {pts.length > 0 && (
          <div>
            {p.eyebrow && <E ctx={ctx} k="eyebrow" v={p.eyebrow} className="eyebrow" />}
            <E ctx={ctx} k="title" v={p.title} as="h2" />
            <E ctx={ctx} k="subtitle" v={p.subtitle} as="p" className="sub" />
            <ul className="checks">{(p.points || []).map((x, i) => x.text ? <li key={i} data-item={`points.${i}`}><E ctx={ctx} k={`points.${i}.text`} v={x.text} /></li> : null)}</ul>
          </div>
        )}
        <form className="pc formcard" onSubmit={async (e) => { e.preventDefault(); if (!ctx.live) return; setBusy(true); setErr(''); try { await ctx.onOptin({ ...f, ...(session ? { session: Number(session) } : {}), ...consentOf(ctx, agree) }); } catch (x) { setErr(x.message); } setBusy(false); }}>
          {!pts.length && <><E ctx={ctx} k="title" v={p.title} as="h2" /><E ctx={ctx} k="subtitle" v={p.subtitle} as="p" className="sub" /></>}
          <E ctx={ctx} k="nameLabel" v={p.nameLabel} as="label" keep /><input aria-label={p.nameLabel || tr(ctx.lang, 'Full name')} placeholder={tr(ctx.lang, 'e.g. Priya Sharma')} value={f.name} onChange={set('name')} />
          <E ctx={ctx} k="emailLabel" v={p.emailLabel} as="label" keep /><input type="email" required aria-label={p.emailLabel || tr(ctx.lang, 'Email')} placeholder="you@example.com" value={f.email} onChange={set('email')} />
          {p.askPhone && <><E ctx={ctx} k="phoneLabel" v={p.phoneLabel} as="label" keep /><input type="tel" placeholder="+91 98765 43210" value={f.phone} onChange={set('phone')} /></>}
          {sessions.length > 1 && <><label>{tr(ctx.lang, 'Choose your session')}</label><select className="sess-pick" value={session || sessions[0]} onChange={(e) => setSession(e.target.value)}>{sessions.map((s) => <option key={s} value={s}>{sessionLabel(s, sessionZone(vz, ctx.webinar))}</option>)}</select></>}
          {sessions.length === 1 && <p className="sess-one">📅 {sessionLabel(sessions[0], sessionZone(vz, ctx.webinar))}</p>}
          <Consent ctx={ctx} checked={agree} onChange={setAgree} />
          {err && <p className="c-err" role="alert">{err}</p>}
          <Btn big block type="submit" disabled={busy} ctx={ctx} k="buttonText">{busy ? tr(ctx.lang, 'Please wait…') : p.buttonText}</Btn>
          {p.secureText && <E ctx={ctx} k="secureText" v={p.secureText} as="p" className="secure" />}
        </form>
      </div>
    </Sec>
  );
}

const IN_STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'];
// the button shows the live total (bump, coupon, shipping) — a price typed into the label would be shown twice
const payLabel = (t) => String(t || '').replace(/\s*[—–·:|-]?\s*(?:[₹$€£]|A\$|C\$|S\$|AED|Rs\.?|INR|USD)\s?[\d,]+(?:\.\d+)?\s*$/i, '').trim();
function Checkout({ p, ctx }) {
  // details the visitor already gave on an earlier step (opt-in, form) are filled in
  const [f, setF] = useState(() => ({ name: ctx.prefill?.name || '', email: ctx.prefill?.email || '', phone: ctx.prefill?.phone || '' }));
  const [bump, setBump] = useState(false);
  const [pm, setPm] = useState('UPI');
  const [busy, setBusy] = useState(false);
  const [showCoupon, setShowCoupon] = useState(false);
  const [code, setCode] = useState('');
  const [coupon, setCoupon] = useState(null);
  const [cErr, setCErr] = useState('');
  // physical products: delivery address, and online payment or Cash on Delivery
  const ships = p.shipping === 'address';
  const [addr, setAddr] = useState({ line1: '', line2: '', city: '', state: '', pincode: '' });
  const [method, setMethod] = useState('online');
  // the seller's PIN code rules, checked as soon as 6 digits are typed: { valid, deliverable, cod, state, message }
  const [pin, setPin] = useState(null);
  const [stateGuess, setStateGuess] = useState(false);
  useEffect(() => {
    if (!ships || !ctx.live || !ctx.onPincode || !/^[1-9][0-9]{5}$/.test(addr.pincode)) { setPin(null); return; }
    let on = true;
    ctx.onPincode(addr.pincode).then((r) => {
      if (!on || !r || r.error) return;
      setPin(r);
      if (r.state && !addr.state) { setAddr((a) => (a.state ? a : { ...a, state: r.state })); setStateGuess(true); }
      if (!r.cod) setMethod('online');
    });
    return () => { on = false; };
  }, [addr.pincode]);
  const noCodHere = !!pin && pin.valid && !pin.cod;
  const shipFee = ships ? Number(p.shippingFee) || 0 : 0, codFee = p.cod && method === 'cod' ? Number(p.codFee) || 0 : 0;
  // business buyers can ask for a GST invoice with their GSTIN (when the seller issues GST invoices)
  const [biz, setBiz] = useState(false);
  const [gst, setGst] = useState({ company: '', gstin: '' });
  const price = Number(p.price) || 0, bp = Number(p.bumpPrice) || 0, mrp = Number(p.mrp) || 0;
  // same rule as the server: never more than the price, never negative
  const discount = coupon ? Math.max(0, Math.min(price, coupon.type === 'percent' ? Math.round((price * Math.min(100, coupon.value)) / 100) : Math.round(coupon.value))) : 0;
  const [payErr, setPayErr] = useState('');
  // memberships bill every month / year; a payment plan splits the price into monthly instalments
  const per = p.billing === 'monthly' ? 'month' : p.billing === 'yearly' ? 'year' : '';
  const canPlan = !per && p.planEnabled && Number(p.planCount) >= 2 && Number(p.planPrice) > 0;
  const [payPlan, setPayPlan] = useState(false);
  // Stripe card payments: the card is kept only when the buyer ticks this (RBI card-on-file consent)
  const [saveCard, setSaveCard] = useState(false);
  const instal = canPlan && payPlan;
  const today = instal ? Number(p.planPrice) : per ? price : price - discount; // no coupons on memberships (as on the server)
  const total = today + (bump && p.bumpEnabled ? bp : 0) + shipFee + (instal ? 0 : codFee);
  const canSave = ctx.stripe && !instal && !per && !(p.cod && method === 'cod');
  // RBI: an automatic debit above ₹15,000 needs the buyer's approval each time
  const afa = inr(p.currency) && (instal ? Number(p.planPrice) : per ? price : 0) > 15000;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  // A code claimed from the exit popup is applied automatically
  useEffect(() => {
    const pending = ctx.live && ctx.getPendingCoupon?.();
    if (!pending) return;
    setCode(pending); setShowCoupon(true);
    ctx.onCoupon?.(pending).then((r) => { if (r?.valid) setCoupon(r); });
  }, [ctx.live]);
  // Capture the email as soon as it's typed so abandoned checkouts can be followed up
  const onEmailBlur = () => { if (ctx.live && (/\S+@\S+\.\S+/.test(f.email) || String(f.phone || '').replace(/\D/g, '').length >= 10)) ctx.onAbandon?.(f); };
  const apply = async () => {
    if (!ctx.live || !code) return;
    setCErr('');
    const r = await ctx.onCoupon?.(code, f.email);
    if (r?.valid) setCoupon(r); else { setCoupon(null); setCErr(r?.reason || r?.error || 'That code isn’t valid'); }
  };
  return (
    <Sec type="checkout">
      <div className="co-grid">
        <form className="pc co-form" onSubmit={async (e) => { e.preventDefault(); if (!ctx.live) return; setBusy(true); setPayErr(''); const r = await safely(() => ctx.onCheckout({ ...f, total, withBump: bump, coupon: per ? undefined : coupon?.code, ...(biz && (gst.gstin || gst.company) ? { gst } : {}), ...(ships ? { address: addr } : {}), ...(p.cod && !instal && !per ? { method } : {}), ...(instal ? { plan: 'installments' } : {}), ...(canSave && saveCard ? { saveCard: true } : {}) })); if (r?.error) { setPayErr(r.error); if (r.error.includes('remove it')) { setCoupon(null); setCErr(r.error); } } setBusy(false); }}>
          <div className="co-step"><span className="co-n">1</span> <E ctx={ctx} k="step1" v={p.step1} keep /></div>
          {ctx.testCheckout && !ctx.editable && <p className="co-test">{tr(ctx.lang, 'Test checkout — no payment will be taken. The seller hasn’t connected online payments yet.')}</p>}
          <input aria-label={tr(ctx.lang, 'Full name')} placeholder={tr(ctx.lang, 'Full name')} required value={f.name} onChange={set('name')} />
          <div className="two"><input type="email" aria-label={tr(ctx.lang, 'Email')} placeholder={tr(ctx.lang, 'Email')} required value={f.email} onChange={set('email')} onBlur={onEmailBlur} /><input type="tel" aria-label={tr(ctx.lang, 'WhatsApp number')} placeholder={tr(ctx.lang, 'WhatsApp number')} required={!!ctx.waRequired && !ctx.editable} value={f.phone} onChange={set('phone')} onBlur={onEmailBlur} /></div>
          <p className="co-save" style={{ fontSize: 12, opacity: 0.65, margin: '2px 0 6px' }}>{tr(ctx.lang, 'We save these details so we can help you finish your order.')}</p>
          {ctx.gstInvoices && !ctx.editable && (biz ? (
            <div className="co-gst">
              <input aria-label={tr(ctx.lang, 'Business name')} placeholder={tr(ctx.lang, 'Business name')} value={gst.company} onChange={(e) => setGst({ ...gst, company: e.target.value })} />
              <input aria-label={tr(ctx.lang, 'GSTIN (15 characters)')} placeholder={tr(ctx.lang, 'GSTIN (15 characters)')} value={gst.gstin} maxLength={15} pattern="[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][1-9A-Za-z][Zz][0-9A-Za-z]" title="15 characters, like 27ABCDE1234F1Z5" onChange={(e) => setGst({ ...gst, gstin: e.target.value.toUpperCase() })} />
            </div>
          ) : <a className="coupon-link co-gst-l" href="#" onClick={(e) => { e.preventDefault(); setBiz(true); }}>{tr(ctx.lang, 'Buying for a business? Add your GSTIN')}</a>)}
          {ships && (
            <div className="co-addr">
              <input required aria-label={tr(ctx.lang, 'House / flat, street')} placeholder={tr(ctx.lang, 'House / flat, street')} value={addr.line1} onChange={(e) => setAddr({ ...addr, line1: e.target.value })} />
              <input aria-label={tr(ctx.lang, 'Area, landmark (optional)')} placeholder={tr(ctx.lang, 'Area, landmark (optional)')} value={addr.line2} onChange={(e) => setAddr({ ...addr, line2: e.target.value })} />
              <div className="three"><input required aria-label={tr(ctx.lang, 'City')} placeholder={tr(ctx.lang, 'City')} value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} />
                <select value={addr.state} onChange={(e) => { setStateGuess(false); setAddr({ ...addr, state: e.target.value }); }}><option value="">{tr(ctx.lang, 'State')}</option>{IN_STATES.map((s) => <option key={s}>{s}</option>)}</select>
                <input required inputMode="numeric" pattern="[1-9][0-9]{5}" maxLength={6} aria-label={tr(ctx.lang, 'PIN code')} placeholder={tr(ctx.lang, 'PIN code')} value={addr.pincode} onChange={(e) => setAddr({ ...addr, pincode: e.target.value.replace(/\D/g, '') })} /></div>
              {pin && !pin.valid && <p className="co-pin-msg bad" role="alert">{tr(ctx.lang, pin.message)}</p>}
              {pin && pin.valid && !pin.deliverable && <p className="co-pin-msg bad" role="alert">{tr(ctx.lang, 'We don’t deliver to this PIN code yet')}</p>}
              {pin && pin.deliverable && !pin.cod && p.cod && <p className="co-pin-msg warn">{tr(ctx.lang, 'Cash on Delivery isn’t available here — please pay online')}</p>}
              {stateGuess && addr.state && <p className="co-pin-msg hint">{tr(ctx.lang, 'State suggested from the PIN code — change it if it’s wrong')}</p>}
            </div>
          )}
          <div className="co-step"><span className="co-n">2</span> <E ctx={ctx} k="step2" v={p.step2} keep /></div>
          {canPlan && (
            <div className="paym two-way co-plan">
              <label className={`pm ${!payPlan ? 'on' : ''}`}><input type="radio" name="plan" checked={!payPlan} onChange={() => setPayPlan(false)} /><b>{tr(ctx.lang, 'Pay in full')}</b><small>{money(p.currency, price - discount)}{discount ? '' : ` · ${tr(ctx.lang, 'best value')}`}</small></label>
              <label className={`pm ${payPlan ? 'on' : ''}`}><input type="radio" name="plan" checked={payPlan} onChange={() => { setPayPlan(true); setCoupon(null); setMethod('online'); }} /><b>{tr(ctx.lang, '{n} monthly payments', { n: Number(p.planCount) })}</b><small>{tr(ctx.lang, '{amount}/month · auto-debit', { amount: money(p.currency, Number(p.planPrice)) })}</small></label>
            </div>
          )}
          {p.cod && !instal && !per ? (
            <div className="paym two-way">
              <label className={`pm ${method === 'online' ? 'on' : ''}`}><input type="radio" name="pm" checked={method === 'online'} onChange={() => setMethod('online')} /><b>{tr(ctx.lang, 'Pay online')}</b><small>{tr(ctx.lang, 'UPI · cards · netbanking')}</small></label>
              <label className={`pm ${method === 'cod' ? 'on' : ''} ${noCodHere ? 'off' : ''}`}><input type="radio" name="pm" checked={method === 'cod'} disabled={noCodHere} onChange={() => setMethod('cod')} /><b>{tr(ctx.lang, 'Cash on Delivery')}</b><small>{Number(p.codFee) > 0 ? `+${money(p.currency, Number(p.codFee))}` : tr(ctx.lang, 'Pay when it arrives')}</small></label>
            </div>
          ) : (
            <div className="paym">{(p.currency && p.currency !== '₹' ? ['Card', 'Apple Pay', 'Google Pay'] : ['UPI', 'Card', 'NetBanking', 'Wallet']).map((m) => (
              <label key={m} className={`pm ${pm === m ? 'on' : ''}`}><input type="radio" name="pm" checked={pm === m} onChange={() => setPm(m)} />{m}</label>
            ))}</div>
          )}
          {p.bumpEnabled && (
            <label className={`bump ${bump ? 'on' : ''}`}>
              <input type="checkbox" checked={bump} onChange={(e) => setBump(e.target.checked)} />
              <span><b>{tr(ctx.lang, '👉 Yes!')} <E ctx={ctx} k="bumpTitle" v={p.bumpTitle} keep /> — just {money(p.currency, bp)}</b><br /><E ctx={ctx} k="bumpDescription" v={p.bumpDescription} /></span>
            </label>
          )}
          {canSave && !ctx.editable && <label className="co-savecard" style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, margin: '4px 0' }}><input type="checkbox" checked={saveCard} onChange={(e) => setSaveCard(e.target.checked)} />{tr(ctx.lang, 'Save my card for faster checkout next time')}</label>}
          {payErr && <p className="c-err" role="alert">{payErr}</p>}
          {ctx.editable ? <Btn big block ctx={ctx} k="buttonText">{p.buttonText || 'Pay Securely'}</Btn> : <Btn big block type="submit" disabled={busy || (!!pin && pin.valid && !pin.deliverable)}>{busy ? tr(ctx.lang, 'Processing…') : method === 'cod' && p.cod && !instal && !per ? tr(ctx.lang, 'Place order · pay {amount} on delivery', { amount: money(p.currency, total) }) : per ? tr(ctx.lang, 'Subscribe · {amount}/{per}', { amount: money(p.currency, today), per: tr(ctx.lang, per) }) : `${payLabel(p.buttonText) || tr(ctx.lang, 'Pay Securely')} · ${money(p.currency, total)}${instal ? tr(ctx.lang, ' today') : ''}`}</Btn>}
          {p.secureText && <E ctx={ctx} k="secureText" v={p.secureText} as="p" className="secure" />}
          {ctx.privacy && !ctx.editable && <p className="fconsent">{tr(ctx.lang, 'By paying you agree to the')} <a href={ctx.privacy.terms} target="_blank" rel="noreferrer">{tr(ctx.lang, 'Terms')}</a>, <a href={ctx.privacy.terms.replace(/terms$/, 'refund')} target="_blank" rel="noreferrer">{tr(ctx.lang, 'Refund Policy')}</a> {tr(ctx.lang, 'and')} <a href={ctx.privacy.policy} target="_blank" rel="noreferrer">{tr(ctx.lang, 'Privacy Policy')}</a>.</p>}
        </form>
        <aside className="pc co-sum">
          {p.summaryTitle && <E ctx={ctx} k="summaryTitle" v={p.summaryTitle} as="h4" />}
          <div className="line"><span><E ctx={ctx} k="productName" v={p.productName} keep /><E ctx={ctx} k="description" v={p.description} as="small" />{ships && <small className="co-origin">{tr(ctx.lang, 'Country of origin')}: {p.origin || ctx.seller?.origin || 'India'}</small>}</span><b>{instal ? <>{money(p.currency, Number(p.planPrice))}<small>/month × {Number(p.planCount)}</small></> : <>{money(p.currency, price)}{per && <small>/{per}</small>}</>}</b></div>
          {bump && p.bumpEnabled && <div className="line"><span>{p.bumpTitle}</span><b>{money(p.currency, bp)}</b></div>}
          {coupon && <div className="line disc"><span>🎁 Coupon {coupon.code} applied</span><b>−{money(p.currency, discount)}</b></div>}
          {ships && <div className="line"><span>{tr(ctx.lang, 'Delivery')}</span><b>{shipFee ? money(p.currency, shipFee) : tr(ctx.lang, 'FREE')}</b></div>}
          {codFee > 0 && <div className="line"><span>{tr(ctx.lang, 'Cash on Delivery fee')}</span><b>{money(p.currency, codFee)}</b></div>}
          <div className="line total"><span>{tr(ctx.lang, instal || per ? 'Due today' : 'Total')}</span><b>{money(p.currency, total)}</b></div>
          <TaxNote c={p.currency} ctx={ctx} />
          {instal && <p className="co-plan-note">Then {money(p.currency, Number(p.planPrice))} on the same date each month for {Number(p.planCount) - 1} more month{Number(p.planCount) > 2 ? 's' : ''} — {money(p.currency, Number(p.planPrice) * Number(p.planCount))} in all. Charged automatically to your card or UPI AutoPay.</p>}
          {afa && <p className="co-plan-note co-afa">{tr(ctx.lang, 'Each charge above ₹15,000 needs your approval in your bank app (RBI rule).')}</p>}
          {per && <p className="co-plan-note">{tr(ctx.lang, 'Renews every {per} until you cancel — cancel any time from your library link.', { per: tr(ctx.lang, per) })}</p>}
          {mrp > price && <div className="save">🎉 You save {money(p.currency, mrp - price + discount)} today</div>}
          {instal || per ? null : showCoupon ? (
            <div className="coupon">
              <input aria-label={tr(ctx.lang, 'Coupon code')} placeholder={tr(ctx.lang, 'Coupon code')} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
              <button type="button" onClick={apply}>{tr(ctx.lang, 'Apply')}</button>
            </div>
          ) : <a className="coupon-link" href="#" onClick={(e) => { e.preventDefault(); setShowCoupon(true); }}>{tr(ctx.lang, 'Have a coupon code?')}</a>}
          {cErr && <small className="c-err">{cErr}</small>}
          {(p.perks || []).some((x) => x.text) && <ul className="checks sm">{p.perks.map((x, i) => x.text ? <li key={i} data-item={`perks.${i}`}><E ctx={ctx} k={`perks.${i}.text`} v={x.text} /></li> : null)}</ul>}
        </aside>
      </div>
    </Sec>
  );
}

// ---------- booking calendar (the "book your call" step) ----------
const tzLabel = (z, t) => zoneLabel(z, t);
// editor / template preview: a believable week of slots (nothing is booked)
function sampleSlots() {
  const out = [];
  const base = new Date(); base.setUTCHours(0, 0, 0, 0);
  for (let d = 1; d <= 10; d++) for (const h of [4.5, 5.5, 7.5, 8.5, 10.5]) if (d % 7 !== 0) out.push(base.getTime() + d * 864e5 + h * 3600e3);
  return out;
}
function Booking({ p, ctx }) {
  const [cal, setCal] = useState(null);
  const [slots, setSlots] = useState(null);
  const [day, setDay] = useState(null);
  const [pick, setPick] = useState(null);
  const [form, setForm] = useState(() => ({ name: ctx.prefill?.name || '', email: ctx.prefill?.email || '', phone: ctx.prefill?.phone || '', notes: '' }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);
  const [len, setLen] = useState(null);
  const [want, setWant] = useState(null); // a length the visitor picked
  const [answers, setAnswers] = useState({});
  // slots are shown in the visitor's own time zone (the host's zone until the page is running in their browser)
  const vz = useViewerTz();
  const hostZone = cal?.timezone || (cal?.tzOffset ?? 330);
  const off = vz || hostZone;
  const otherZone = vz && cal?.timezone && zoneLabel(vz) !== zoneLabel(cal.timezone);
  useEffect(() => {
    let on = true;
    if (!ctx.onSlots || !ctx.live) { setCal({ name: 'Strategy call', duration: 30, tzOffset: 330 }); setSlots(sampleSlots()); return; }
    ctx.onSlots(want).then((r) => { if (!on) return; if (r.error) { setErr(r.error); setSlots([]); } else { setCal(r.calendar); setSlots(r.slots); if (r.duration) setLen(r.duration); } }).catch(() => on && setErr('Couldn’t load the calendar — please refresh'));
    return () => { on = false; };
  }, [ctx.live, want]);
  // the call's price for the chosen length
  const priced = cal && len && cal.prices ? { ...cal, price: cal.prices[len] ?? cal.price } : cal;
  const days = useMemo(() => [...new Set((slots || []).map((s) => dayKey(s, off)))], [slots, off]);
  useEffect(() => { if (days.length && !days.includes(day)) setDay(days[0]); }, [days]);
  const daySlots = (slots || []).filter((s) => dayKey(s, off) === day);
  const submit = async (e) => {
    e.preventDefault();
    if (!ctx.live || !pick) return;
    setBusy(true); setErr('');
    const r = await safely(() => ctx.onBook({ ...form, start: pick, duration: len, answers }));
    setBusy(false);
    if (r?.error) { setErr(r.error); if (r.taken) { setPick(null); const again = await ctx.onSlots(len); if (!again.error) setSlots(again.slots); } return; }
    setDone(r);
  };
  if (done) {
    const g = new URLSearchParams({ action: 'TEMPLATE', text: cal?.name || 'Call', dates: `${new Date(done.start).toISOString().replace(/[-:]|\.\d{3}/g, '')}/${new Date(done.end).toISOString().replace(/[-:]|\.\d{3}/g, '')}`, details: done.meetingLink ? `Join: ${done.meetingLink}` : '' });
    return (
      <Sec type="booking" id="booking">
        <div className="pc bk-card bk-done">
          <div className="tick">✓</div>
          <E ctx={ctx} k="successTitle" v={p.successTitle || tr(ctx.lang, 'Your call is booked ✅')} as="h2" keep />
          <p className="bk-when"><b>{fmtDay(done.start, off)}</b> · {fmtTime(done.start, off)} {tzLabel(off)}</p>
          <E ctx={ctx} k="successText" v={p.successText} as="p" className="sub" multiline />
          <div className="bk-acts">
            {done.meetingLink && <a className="btn" href={done.meetingLink} target="_blank" rel="noreferrer"><span>{tr(ctx.lang, 'Joining link')}</span><span className="arr" aria-hidden="true">→</span></a>}
            <a className="link-arrow" href={`https://calendar.google.com/calendar/render?${g}`} target="_blank" rel="noreferrer">{tr(ctx.lang, 'Add to Google Calendar ↗')}</a>
            {done.manage && <a className="link-arrow" href={done.manage}>{tr(ctx.lang, 'Reschedule or cancel')}</a>}
          </div>
        </div>
      </Sec>
    );
  }
  return (
    <Sec type="booking" id="booking">
      <Head eyebrow={p.eyebrow} title={p.title} subtitle={p.subtitle} ctx={ctx} />
      <div className="pc bk-card">
        <div className="bk-head"><b>{cal?.name || 'Call'}</b>{priced?.price > 0 && <span className="bk-price">{callPrice(priced)}</span>}<span>⏱ {len || cal?.duration || 30} min</span>{cal?.location && <span>📍 {cal.location}</span>}<span title={otherZone ? `The host is in ${zoneCity(cal.timezone)} (${zoneLabel(cal.timezone)})` : undefined}>🌏 {vz ? `Your time · ${tzLabel(off)}` : tzLabel(off)}</span></div>
        {cal?.durations?.length > 1 && <div className="bk-lens" role="radiogroup" aria-label="Call length">{cal.durations.map((m) => <button type="button" key={m} role="radio" aria-checked={m === len} className={m === len ? 'on' : ''} onClick={() => { if (m !== len) { setPick(null); setSlots(null); setLen(m); setWant(m); } }}>{m} min</button>)}</div>}
        {!slots ? <div className="bk-load">{tr(ctx.lang, 'Loading available times…')}</div> : !slots.length ? <p className="bk-empty">{err || tr(ctx.lang, 'No times are free right now — please check back soon or message us on WhatsApp.')}</p> : (
          <>
            <div className="bk-days" role="tablist">{days.slice(0, 21).map((d) => { const t = slots.find((s) => dayKey(s, off) === d); return <button type="button" key={d} role="tab" aria-selected={d === day} className={d === day ? 'on' : ''} onClick={() => { setDay(d); setPick(null); }}>{fmtDay(t, off).split(' ').map((x, i) => <span key={i}>{x}</span>)}</button>; })}</div>
            <div className="bk-slots">{daySlots.map((s) => <button type="button" key={s} className={s === pick ? 'on' : ''} onClick={() => setPick(s)}>{fmtTime(s, off)}</button>)}</div>
            {pick && (
              <form className="bk-form" onSubmit={submit}>
                <p className="bk-picked">📅 <b>{fmtDay(pick, off)}</b> at <b>{fmtTime(pick, off)}</b> {tzLabel(off)}</p>
                <div className="two"><input required aria-label={tr(ctx.lang, 'Full name')} placeholder={tr(ctx.lang, 'Full name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /><input required type="email" aria-label={tr(ctx.lang, 'Email')} placeholder={tr(ctx.lang, 'Email')} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                <input type="tel" aria-label={tr(ctx.lang, 'WhatsApp number')} placeholder={tr(ctx.lang, 'WhatsApp number')} required={!!cal?.waRequired} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                {(cal?.questions || []).map((q) => q.type === 'select'
                  ? <select key={q.id} required={q.required} value={answers[q.id] || ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}><option value="">{q.label}{q.required ? ' *' : ''}</option>{(q.options || []).map((o) => <option key={o}>{o}</option>)}</select>
                  : q.type === 'long' ? <textarea key={q.id} rows={2} required={q.required} placeholder={`${q.label}${q.required ? ' *' : ''}`} value={answers[q.id] || ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
                  : <input key={q.id} type={q.type === 'phone' ? 'tel' : 'text'} required={q.required} placeholder={`${q.label}${q.required ? ' *' : ''}`} value={answers[q.id] || ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />)}
                <textarea rows={2} placeholder={tr(ctx.lang, 'Anything we should know before the call? (optional)')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                {err && <p className="c-err" role="alert">{err}</p>}
                {ctx.editable ? <Btn big block ctx={ctx} k="buttonText">{p.buttonText || 'Confirm my call'}</Btn> : <Btn big block type="submit" disabled={busy}>{busy ? tr(ctx.lang, 'Booking…') : priced?.price > 0 ? tr(ctx.lang, 'Pay {amount} & confirm', { amount: callPrice(priced) }) : p.buttonText || tr(ctx.lang, 'Confirm my call')}</Btn>}
                {cal?.price > 0 && <p className="bk-policy">{cal.refundHours ? `Full refund if you cancel at least ${cal.refundHours >= 48 && cal.refundHours % 24 === 0 ? `${cal.refundHours / 24} days` : `${cal.refundHours} hours`} before the call.` : 'Full refund if you cancel any time before the call.'} Rescheduling is free.</p>}
              </form>
            )}
          </>
        )}
      </div>
    </Sec>
  );
}

// One-click upsell / downsell page
function Offer({ p, ctx }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ended, setEnded] = useState(false);
  const off = p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0;
  return (
    <Sec type="offer">
      {p.progress && (
        <div className="progress"><div className="pg-bar"><div /></div><E ctx={ctx} k="progress" v={p.progress} /></div>
      )}
      <div className="offer-grid">
        <div className="pc offer-visual">
          {p.tag && <E ctx={ctx} k="tag" v={p.tag} className="ov-tag" />}
          <E ctx={ctx} k="emoji" v={p.emoji ?? '🎁'} as="div" className="ov-emoji" />
          <E ctx={ctx} k="productName" v={p.productName} as="h3" />
          <div className="pprice">{(off > 0 || ctx.editable) && <E ctx={ctx} k="mrp" v={p.mrp} as="s" num fmt={(v) => money(p.currency, v)} />}<E ctx={ctx} k="price" v={p.price} as="b" num fmt={(v) => money(p.currency, v)} /></div>
          {off > 0 && <span className="off">Save {off}% — only on this page</span>}
        </div>
        <div className="offer-copy">
          <E ctx={ctx} k="headline" v={p.headline} as="h1" isRich />
          <E ctx={ctx} k="description" v={p.description} as="p" className="lead" multiline />
          <ul className="checks">{(p.bullets || []).map((b, i) => b.text ? <li key={i} data-item={`bullets.${i}`}><E ctx={ctx} k={`bullets.${i}.text`} v={b.text} /></li> : null)}</ul>
          {p.minutes ? <OfferTimer minutes={p.minutes} live={ctx.live} onEnd={setEnded} /> : null}
          {err && <p className="c-err" role="alert">{err}</p>}
          <Btn big block disabled={busy || ended} ctx={ctx} k="acceptText" onClick={async () => { if (!ctx.live || ended) return; setBusy(true); setErr(''); const r = await safely(() => ctx.onAccept()); if (r?.error) setErr(r.error); setBusy(false); }}>{busy ? 'Adding…' : p.acceptText}</Btn>
          {p.oneClickText && <E ctx={ctx} k="oneClickText" v={p.oneClickText} as="p" className="oneclick" />}
          <a className="decline" href="#" onClick={(e) => { e.preventDefault(); if (ctx.live) ctx.onDecline(); }}><E ctx={ctx} k="declineText" v={p.declineText} /></a>
        </div>
      </div>
    </Sec>
  );
}

// The offer timer is real: saved per visitor (a reload doesn't restart it) and the offer ends with it
function OfferTimer({ minutes, live, onEnd }) {
  const end = useMemo(() => {
    const fresh = Date.now() + minutes * 60000;
    if (!live || typeof window === 'undefined') return fresh;
    const key = `ff_ot_${location.pathname}_${minutes}`;
    try { const e = Number(localStorage.getItem(key)); if (e) return e; localStorage.setItem(key, fresh); } catch {}
    return fresh;
  }, [minutes, live]);
  const [left, setLeft] = useState(() => Math.max(0, Math.round((end - Date.now()) / 1000)));
  useEffect(() => { const tick = () => setLeft(Math.max(0, Math.round((end - Date.now()) / 1000))); tick(); const t = setInterval(tick, 1000); return () => clearInterval(t); }, [end]);
  useEffect(() => { if (live) onEnd?.(!left); }, [left, live]);
  if (!left) return <div className="otimer">⏳ This offer has ended</div>;
  return <div className="otimer">⏳ This offer expires in <b>{pad(Math.floor(left / 60))}:{pad(left % 60)}</b></div>;
}

function CrossSell({ p, ctx }) {
  const [added, setAdded] = useState({});
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState('');
  const add = async (i) => {
    if (!ctx.live || added[i]) return;
    setBusy(i); setErr('');
    const r = await ctx.onCrossSell?.(ctx.blockId, i);
    if (r?.error) setErr(r.error); else setAdded({ ...added, [i]: true });
    setBusy(null);
  };
  return (
    <Sec type="crosssell" className="alt">
      <div className="sh c">{p.eyebrow && <E ctx={ctx} k="eyebrow" v={p.eyebrow} className="eyebrow" />}<E ctx={ctx} k="title" v={p.title} as="h2" isRich />{p.subtitle && <E ctx={ctx} k="subtitle" v={p.subtitle} as="p" className="sub" />}</div>
      {err && <p className="c-err center" role="alert">{err}</p>}
      <div className="xs-grid">
        {(p.items || []).map((it, i) => (
          <div className={`pc xs ${added[i] ? 'added' : ''}`} key={i} data-item={`items.${i}`}>
            <E ctx={ctx} k={`items.${i}.emoji`} v={it.emoji ?? '🎁'} className="xs-emoji" />
            <E ctx={ctx} k={`items.${i}.name`} v={it.name} as="h3" />
            <E ctx={ctx} k={`items.${i}.desc`} v={it.desc} as="p" />
            <div className="xs-foot">
              <E ctx={ctx} k={`items.${i}.price`} v={it.price} as="b" num fmt={(v) => money('₹', v)} />
              <button className="btn" onClick={() => add(i)} disabled={busy === i || added[i]}>{added[i] ? '✓ Added' : busy === i ? 'Adding…' : p.buttonText || 'Add'}</button>
            </div>
          </div>
        ))}
      </div>
    </Sec>
  );
}

function embed(url) {
  const m = /(?:youtu\.be\/|v=)([\w-]{11})/.exec(url || '');
  return m ? `https://www.youtube.com/embed/${m[1]}` : url;
}
function VideoEmbed({ url }) {
  const v = videoSource(url);
  if (!v) return <div className="video ph">Unsupported video link</div>;
  if (v.kind === 'video') return <video className="video" src={v.src} controls playsInline preload="metadata" />;
  return <iframe className="video" src={v.src} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen title="video" loading="lazy" />;
}

// ---------- media, layout helpers, custom code, forms ----------
// Turn a share link from common video hosts into something playable
export function videoSource(url = '') {
  const u = String(url).trim();
  let m;
  if ((m = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/.exec(u))) return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${m[1]}?rel=0` };
  if ((m = /vimeo\.com\/(?:video\/)?(\d+)/.exec(u))) return { kind: 'iframe', src: `https://player.vimeo.com/video/${m[1]}` };
  if ((m = /loom\.com\/(?:share|embed)\/([\w-]+)/.exec(u))) return { kind: 'iframe', src: `https://www.loom.com/embed/${m[1]}` };
  if ((m = /drive\.google\.com\/(?:file\/d\/|open\?id=)([\w-]+)/.exec(u))) return { kind: 'iframe', src: `https://drive.google.com/file/d/${m[1]}/preview` };
  if (/^https?:\/\/.+\.(mp4|webm|ogg)(\?.*)?$/i.test(u) || /^\/uploads\/.+\.(mp4|webm)$/i.test(u)) return { kind: 'video', src: u };
  if (/^https:\/\//.test(u)) return { kind: 'iframe', src: u };
  return null;
}

function ImageBlock({ p, ctx }) {
  if (!p.src) return ctx.editable ? <Sec type="image"><div className="el-img-ph">🖼️ <span>Add an image — select this section and upload it in the panel</span></div></Sec> : null;
  const img = <Img className={`${p.rounded ? 'rounded' : ''} ${p.shadow ? 'shadow' : ''}`} src={p.src} alt={p.alt || ''} />;
  return (
    <Sec type="image" className={`iw-${p.width || 'normal'}`}>
      <figure className="img-fig">
        {p.link && safeHref(p.link) && !ctx.editable ? <a href={safeHref(p.link)}>{img}</a> : img}
        {(p.caption || ctx.editable) && <E ctx={ctx} k="caption" v={p.caption} as="figcaption" keep />}
      </figure>
    </Sec>
  );
}

function Gallery({ p, ctx }) {
  const items = (p.items || []).filter((i) => i.src);
  const [open, setOpen] = useState(null);
  useEffect(() => {
    if (open == null) return;
    const k = (e) => { if (e.key === 'Escape') setOpen(null); if (e.key === 'ArrowRight') setOpen((i) => (i + 1) % items.length); if (e.key === 'ArrowLeft') setOpen((i) => (i - 1 + items.length) % items.length); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, items.length]);
  return (
    <Sec type="gallery">
      <Head eyebrow={p.eyebrow} title={p.title} ctx={ctx} />
      {!items.length && ctx.editable ? <div className="el-img-ph">🖼️ <span>Add gallery images in the panel</span></div> : (
        <div className="gal" style={{ '--gcols': Number(p.columns) || 3 }}>
          {items.map((it, i) => (
            <figure key={i} className="gal-item" data-item={`items.${(p.items || []).indexOf(it)}`} onClick={() => ctx.live && setOpen(i)}>
              <Img src={it.src} alt={it.alt || it.caption || ''} sizes="(max-width: 760px) 50vw, 320px" />
              {it.caption && <figcaption>{it.caption}</figcaption>}
            </figure>
          ))}
        </div>
      )}
      {open != null && items[open] && (
        <div className="lightbox" onClick={() => setOpen(null)}>
          <button className="lb-x" aria-label="Close">×</button>
          {items.length > 1 && <button className="lb-nav prev" aria-label="Previous" onClick={(e) => { e.stopPropagation(); setOpen((open - 1 + items.length) % items.length); }}>‹</button>}
          <figure onClick={(e) => e.stopPropagation()}><img src={mediaUrl(items[open].src)} alt={items[open].alt || items[open].caption || ''} />{items[open].caption && <figcaption>{items[open].caption}</figcaption>}</figure>
          {items.length > 1 && <button className="lb-nav next" aria-label="Next" onClick={(e) => { e.stopPropagation(); setOpen((open + 1) % items.length); }}>›</button>}
        </div>
      )}
    </Sec>
  );
}

// Custom HTML runs in a sandboxed iframe WITHOUT same-origin access, so embedded code can never
// read the app's cookies, storage or logins. It reports its height so it sizes itself.
const EMBED_SIZER = '<script>(function(){function s(){parent.postMessage({ffEmbedH:Math.ceil(document.documentElement.scrollHeight)},"*")}if(window.ResizeObserver)new ResizeObserver(s).observe(document.documentElement);addEventListener("load",s);setTimeout(s,50);setTimeout(s,1000)})()</' + 'script>';
function HtmlEmbed({ p, ctx }) {
  const ref = useRef();
  const [h, setH] = useState(Number(p.height) || 120);
  const doc = p.code?.trim() ? `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"><style>html,body{margin:0;font-family:system-ui,sans-serif}img,iframe,video{max-width:100%}</style></head><body>${p.code}${EMBED_SIZER}</body></html>` : '';
  // the editor and dashboard previews run under the dashboard's strict policy, which a srcdoc frame inherits (no
  // inline scripts): there the frame loads a sandboxed shell with the live pages' embed policy and we post the HTML in
  const framed = !ctx.live || !!ctx.editable;
  useEffect(() => {
    if (Number(p.height)) setH(Number(p.height));
    const onMsg = (e) => {
      if (e.source !== ref.current?.contentWindow) return;
      if (framed && e.data?.ffEmbedReady) e.source.postMessage({ ffEmbedDoc: doc }, '*');
      else if (!Number(p.height) && typeof e.data?.ffEmbedH === 'number') setH(Math.min(4000, Math.max(20, e.data.ffEmbedH)));
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [p.height, doc, framed]);
  if (!doc) return ctx.editable ? <Sec type="embed"><div className="el-img-ph">🧩 <span>Paste HTML or an embed code (Calendly, Typeform, Google Maps…) in the panel</span></div></Sec> : null;
  return (
    <Sec type="embed" className={p.fullWidth ? 'embed-full' : ''}>
      <iframe ref={ref} key={framed ? doc : 'doc'} className="embed-frame" title={p.title || 'Embedded content'} {...(framed ? { src: '/api/embed-frame' } : { srcDoc: doc })} style={{ height: h }} loading="lazy"
        sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation" />
    </Sec>
  );
}

export const FORM_FIELD_TYPES = [['text', 'Short text'], ['email', 'Email'], ['tel', 'Phone / WhatsApp'], ['number', 'Number'], ['textarea', 'Long answer'], ['select', 'Dropdown'], ['checkbox', 'Checkbox'], ['date', 'Date']];
function FormBlock({ p, ctx }) {
  const fields = p.fields || [];
  const [agree, setAgree] = useState(false);
  const [vals, setVals] = useState({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [err, setErr] = useState('');
  const set = (i, v) => setVals({ ...vals, [i]: v });
  const list = (s) => String(s || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const submit = async (e) => {
    e.preventDefault();
    if (!ctx.live) return;
    setErr(''); setBusy(true);
    const answers = {};
    let email = '', phone = '', name = '';
    fields.forEach((fd, i) => {
      const v = vals[i] ?? (fd.type === 'checkbox' ? false : '');
      answers[fd.label || `Field ${i + 1}`] = v;
      if (fd.type === 'email' && !email) email = v;
      if (fd.type === 'tel' && !phone) phone = v;
      if (!name && /name/i.test(fd.label || '') && fd.type === 'text') name = v;
    });
    // qualification: an answer listed under "not a fit" for its question
    const hasRules = fields.some((fd) => list(fd.reject).length);
    const qualified = !fields.some((fd, i) => list(fd.reject).includes(String(vals[i] ?? '').trim().toLowerCase()));
    try {
      await ctx.onForm?.({ email, phone, name, fields: answers, ...(hasRules ? { qualified } : {}), ...consentOf(ctx, agree) });
      if (hasRules && !qualified) setRejected(true);
      else if (p.after === 'next') ctx.onFormNext?.(); else setDone(true);
    } catch (x) { setErr(x.message || 'Something went wrong — please try again.'); }
    setBusy(false);
  };
  return (
    <Sec type="form" id={ctx.editable || ctx.inPopup ? undefined : 'form'} className="alt">
      <form className="pc formcard form-b" onSubmit={submit}>
        {p.title && <E ctx={ctx} k="title" v={p.title} as="h2" />}
        {p.subtitle && <E ctx={ctx} k="subtitle" v={p.subtitle} as="p" className="sub" />}
        {rejected ? <div className="form-done reject"><E ctx={ctx} k="rejectMessage" v={p.rejectMessage || 'Thank you for applying. Based on your answers this isn’t the right fit just yet — we’ve noted your details and will reach out if that changes.'} keep multiline /></div>
          : done ? <div className="form-done">✅ <E ctx={ctx} k="successMessage" v={p.successMessage || tr(ctx.lang, 'Thank you! We’ll be in touch shortly.')} keep /></div> : (
          <>
            {fields.map((fd, i) => {
              const id = `ff-${ctx.popupId ? `${ctx.popupId}-` : ''}${i}`; // a form in a pop-up never shares ids with the page's
              const common = { id, required: !!fd.required, value: vals[i] ?? '', onChange: (e) => set(i, e.target.value) };
              if (fd.type === 'checkbox') return <label key={i} className="fcheck"><input type="checkbox" required={!!fd.required} checked={!!vals[i]} onChange={(e) => set(i, e.target.checked)} /> <span>{fd.label}{fd.required && ' *'}</span></label>;
              return (
                <div key={i} className="ffield">
                  <label htmlFor={id}>{fd.label}{fd.required && <span className="req"> *</span>}</label>
                  {fd.type === 'textarea' ? <textarea rows={4} placeholder={fd.placeholder || ''} {...common} />
                    : fd.type === 'select' ? <select {...common}><option value="">{tr(ctx.lang, 'Choose…')}</option>{String(fd.options || '').split(',').map((o) => o.trim()).filter(Boolean).map((o) => <option key={o}>{o}</option>)}</select>
                      : <input type={fd.type || 'text'} placeholder={fd.placeholder || ''} {...common} />}
                </div>
              );
            })}
            {err && <p className="c-err">{err}</p>}
            <Consent ctx={ctx} checked={agree} onChange={setAgree} />
            <Btn big block type="submit" disabled={busy}>{busy ? tr(ctx.lang, 'Sending…') : p.buttonText || tr(ctx.lang, 'Submit')}</Btn>
            {p.note && <p className="secure">{p.note}</p>}
          </>
        )}
      </form>
    </Sec>
  );
}

// ---------- quiz funnel: questions → contact form → a result with its own offer ----------
// The result is worked out on the server from the saved quiz (index.js → quiz.js) and comes back with the sign-up.
function QuizBlock({ p, ctx, block }) {
  const qs = p.questions || [], outs = p.outcomes || [];
  const intro = !!(p.startText || '').trim();
  const [stage, setStage] = useState(intro ? 'intro' : 'q');
  const [i, setI] = useState(0);
  const [picks, setPicks] = useState([]);
  const [v, setV] = useState({ name: ctx.prefill?.name || '', email: ctx.prefill?.email || '', phone: ctx.prefill?.phone || '' });
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);
  const started = useRef(false), moving = useRef(false);
  const ev = (type, question) => { if (ctx.live && !ctx.preview) ctx.onQuizEvent?.(block?.id, type, question); };
  const begin = () => { if (!started.current) { started.current = true; ev('quiz_start'); } };
  const cur = qs[i];
  const chosen = picks[i] || [];
  const nextQ = (list = picks) => {
    ev('quiz_answer', i);
    setPicks(list);
    if (i + 1 < qs.length) setI(i + 1); else setStage('gate');
  };
  const pick = (n) => {
    begin();
    const list = [...picks];
    if (cur.multi) { list[i] = chosen.includes(n) ? chosen.filter((x) => x !== n) : [...chosen, n]; setPicks(list); return; }
    if (moving.current) return; // one tap per question: the next one shows in a moment
    moving.current = true;
    list[i] = [n];
    setPicks(list);
    setTimeout(() => { moving.current = false; nextQ(list); }, 180);
  };
  const ask = p.contact || 'email';
  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!ctx.live) { setResult({ index: 0, ...(outs[0] || {}) }); setStage('result'); return; } // the editor previews the first result
    setBusy(true);
    try {
      const r = await ctx.onForm?.({ name: v.name, email: ask === 'phone' ? '' : v.email, phone: ask === 'email' ? '' : v.phone, quiz: { blockId: block?.id, picks }, ...consentOf(ctx, agree) });
      setResult(r?.quiz || { index: 0, ...(outs[0] || {}) });
      setStage('result');
    } catch (x) { setErr(x.message || 'Something went wrong — please try again.'); }
    setBusy(false);
  };
  if (!qs.length || !outs.length) return ctx.editable ? <Sec type="quiz"><div className="pc quiz-card"><p className="sub">Add questions and results to this quiz in the panel on the right.</p></div></Sec> : null;
  const pct = stage === 'q' ? Math.round((i / qs.length) * 100) : 100;
  const pics = cur && (cur.answers || []).some((a) => a.image);
  return (
    <Sec type="quiz" id={ctx.editable ? undefined : 'quiz'}>
      <div className="pc quiz-card">
        {(stage === 'q' || stage === 'gate') && <div className="quiz-prog"><span style={{ width: `${pct}%` }} /></div>}
        {stage === 'intro' && <div className="quiz-intro">
          {p.image && <img className="quiz-hero" src={p.image} alt="" loading="lazy" />}
          <E ctx={ctx} k="title" v={p.title} as="h2" isRich />
          {p.subtitle && <E ctx={ctx} k="subtitle" v={p.subtitle} as="p" className="sub" />}
          <Btn big ctx={ctx} k="startText" onClick={() => { begin(); setStage('q'); }}>{p.startText}</Btn>
          {p.note && <p className="secure">{p.note}</p>}
        </div>}
        {stage === 'q' && cur && <div className="quiz-q" key={i}>
          <small className="quiz-n">{tr(ctx.lang, 'Question')} {i + 1} / {qs.length}</small>
          <h3>{cur.q}</h3>
          {cur.multi && <p className="sub">{tr(ctx.lang, 'Pick all that apply')}</p>}
          <div className={`quiz-as ${pics ? 'pics' : ''}`}>
            {(cur.answers || []).map((a, n) => (
              <button type="button" key={n} className={`quiz-a ${chosen.includes(n) ? 'on' : ''}`} onClick={() => pick(n)}>
                {a.image && <img src={a.image} alt="" loading="lazy" />}
                <span>{a.text}</span>
              </button>
            ))}
          </div>
          <div className="quiz-nav">
            {(i > 0 || intro) ? <button type="button" className="link-btn" onClick={() => (i > 0 ? setI(i - 1) : setStage('intro'))}>← {tr(ctx.lang, 'Back')}</button> : <span />}
            {cur.multi && <Btn disabled={!chosen.length} onClick={() => nextQ()}>{tr(ctx.lang, 'Next')}</Btn>}
          </div>
        </div>}
        {stage === 'gate' && <form className="quiz-gate" onSubmit={submit}>
          <h3>{p.gateTitle || tr(ctx.lang, 'Your result is ready!')}</h3>
          {p.gateText && <p className="sub">{p.gateText}</p>}
          {p.askName !== false && <input required placeholder={tr(ctx.lang, 'Your name')} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoComplete="name" />}
          {ask !== 'phone' && <input required type="email" placeholder={tr(ctx.lang, 'Your email')} value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} autoComplete="email" />}
          {ask !== 'email' && <input required type="tel" placeholder={tr(ctx.lang, 'WhatsApp number')} value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} autoComplete="tel" />}
          {err && <p className="c-err">{err}</p>}
          <Consent ctx={ctx} checked={agree} onChange={setAgree} />
          <Btn big block type="submit" disabled={busy}>{busy ? tr(ctx.lang, 'Sending…') : p.buttonText || tr(ctx.lang, 'Show my result')}</Btn>
          <button type="button" className="link-btn" onClick={() => { setStage('q'); setI(qs.length - 1); }}>← {tr(ctx.lang, 'Back')}</button>
        </form>}
        {stage === 'result' && result && <div className="quiz-result">
          {result.image && <img className="quiz-hero" src={result.image} alt="" loading="lazy" />}
          <small className="quiz-n">{tr(ctx.lang, 'Your result')}{result.score != null ? ` · ${result.score}` : ''}</small>
          <h2>{result.title}</h2>
          {result.body && <p className="sub quiz-body">{result.body}</p>}
          {result.buttonText && (result.url ? <Btn big ctx={ctx} link={{ href: result.url }}>{result.buttonText}</Btn> : <Btn big onClick={() => ctx.onFormNext?.()}>{result.buttonText}</Btn>)}
        </div>}
      </div>
    </Sec>
  );
}

// ---------- custom sections: columns of individual elements ----------
export const LAYOUTS = [['1', 'One column'], ['1-1', 'Two equal columns'], ['2-1', 'Wide + narrow'], ['1-2', 'Narrow + wide'], ['1-1-1', 'Three columns'], ['1-1-1-1', 'Four columns']];
const LAYOUT_COLS = { 1: ['1fr'], '1-1': ['1fr', '1fr'], '2-1': ['2fr', '1fr'], '1-2': ['1fr', '2fr'], '1-1-1': ['1fr', '1fr', '1fr'], '1-1-1-1': ['1fr', '1fr', '1fr', '1fr'] };
export const colCount = (layout) => (LAYOUT_COLS[layout] || ['1fr']).length;
const ALIGN = [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']];
const newId = () => Math.random().toString(36).slice(2, 10);

export const ELEMENT_TYPES = {
  heading: { label: 'Heading', icon: '🔤', fields: [['text', 'long', null, HL], ['level', 'select', [['h1', 'Large (H1)'], ['h2', 'Medium (H2)'], ['h3', 'Small (H3)']]], ['align', 'select', ALIGN]], defaults: { text: 'Your *headline* goes here', level: 'h2', align: 'left' } },
  text: { label: 'Text', icon: '📝', fields: [['text', 'long'], ['size', 'select', [['sm', 'Small'], ['md', 'Normal'], ['lg', 'Large']]], ['align', 'select', ALIGN]], defaults: { text: 'Write a sentence or two that makes your visitor want to keep reading.', size: 'md', align: 'left' } },
  button: { label: 'Button', icon: '🔘', fields: [['label', 'text'], ['action', 'select', BTN_ACTIONS], ['url', 'text', null, 'https://…, #section-id, tel:… or mailto:…'], ['variant', 'select', [['primary', 'Filled'], ['outline', 'Outline']]], ['align', 'select', ALIGN], ['full', 'bool']], defaults: { label: 'Get Started', action: 'next', url: '', variant: 'primary', align: 'left', full: false } },
  image: { label: 'Image', icon: '🖼️', fields: [['src', 'text'], ['alt', 'text', null, 'Describe the image — helps SEO and screen readers'], ['link', 'text', null, 'Optional: make the image a link'], ['rounded', 'bool'], ['shadow', 'bool']], defaults: { src: '', alt: '', link: '', rounded: true, shadow: true } },
  list: { label: 'Bullet list', icon: '✅', fields: [['items', 'list', ['text']], ['icon', 'select', [['check', '✓ Checkmarks'], ['dot', '• Dots'], ['num', '1. Numbers']]]], defaults: { items: [{ text: 'First benefit' }, { text: 'Second benefit' }, { text: 'Third benefit' }], icon: 'check' } },
  price: { label: 'Price', icon: '💰', fields: [['price', 'number'], ['mrp', 'number'], ['currency', 'text'], ['note', 'text']], defaults: { price: 499, mrp: 1999, currency: '₹', note: 'One-time payment · instant access' } },
  video: { label: 'Video', icon: '🎬', fields: [['url', 'text', null, 'YouTube, Vimeo, Loom, Google Drive or an .mp4 link']], defaults: { url: '' } },
  spacer: { label: 'Spacer', icon: '↕️', fields: [['height', 'number', null, 'Height in pixels']], defaults: { height: 32 } },
  divider: { label: 'Divider', icon: '➖', fields: [['style', 'select', [['line', 'Solid line'], ['dashed', 'Dashed'], ['dots', 'Dots']]]], defaults: { style: 'line' } },
};
export const newElement = (type, over = {}) => ({ id: newId(), type, props: { ...JSON.parse(JSON.stringify(ELEMENT_TYPES[type].defaults)), ...over } });

// New ids for a copied block (sections contain nested element ids)
export function freshIds(block) {
  const b = JSON.parse(JSON.stringify(block));
  b.id = newId();
  if (b.type === 'section') b.props.columns = (b.props.columns || []).map((c) => ({ id: newId(), elements: (c.elements || []).map((e) => ({ ...e, id: newId() })) }));
  return b;
}
// Changing the layout keeps every element: extra columns are added empty, removed columns move into the last one
export function applyLayout(props, layout) {
  const n = colCount(layout);
  const cols = [...(props.columns || [])];
  while (cols.length < n) cols.push({ id: newId(), elements: [] });
  if (cols.length > n) { const extra = cols.splice(n).flatMap((c) => c.elements); cols[n - 1] = { ...cols[n - 1], elements: [...cols[n - 1].elements, ...extra] }; }
  return { ...props, layout, columns: cols };
}
export const defaultSection = () => ({
  layout: '1-1', valign: 'center', gap: 'md',
  columns: [
    { id: newId(), elements: [newElement('heading'), newElement('text'), newElement('button')] },
    { id: newId(), elements: [newElement('image')] },
  ],
});

// Only allow safe link targets (no javascript: URLs)
export const safeHref = (u = '') => (/^(https?:|mailto:|tel:|#|\/(?![\/\\]))/i.test(String(u).trim()) ? String(u).trim() : '');

function ElementContent({ el, ctx }) {
  const p = el.props || {};
  switch (el.type) {
    case 'heading': {
      const Tag = ['h1', 'h2', 'h3'].includes(p.level) ? p.level : 'h2';
      return <E ctx={ctx} k="text" v={p.text} as={Tag} isRich keep className={`el-h al-${p.align || 'left'}`} />;
    }
    case 'text':
      return <E ctx={ctx} k="text" v={p.text} as="p" multiline keep className={`el-t sz-${p.size || 'md'} al-${p.align || 'left'}`} />;
    case 'button': {
      const cls = `btn ${p.variant === 'outline' ? 'outline' : ''} ${p.full ? 'block' : ''}`;
      const label = <E ctx={ctx} k="label" v={p.label} />;
      let inner;
      if (ctx.editable) inner = <div className={cls} role="button"><span>{label}</span><span className="arr" aria-hidden="true">→</span></div>;
      else if (p.action === 'url' && safeHref(p.url)) inner = <a className={cls} href={safeHref(p.url)} {...(/^https?:/.test(p.url) ? { target: '_blank', rel: 'noopener' } : {})}><span>{p.label}</span><span className="arr" aria-hidden="true">→</span></a>;
      else if (p.action === 'popup' && p.url) inner = <button type="button" className={cls} aria-haspopup="dialog" onClick={() => ctx.live && openPopup(p.url)}><span>{p.label}</span><span className="arr" aria-hidden="true">→</span></button>;
      else if (p.action === 'scroll' && p.url) inner = <a className={cls} href={`#${cleanAnchor(String(p.url).replace(/^#/, ''))}`} onClick={(e) => { e.preventDefault(); smoothTo(cleanAnchor(String(p.url).replace(/^#/, ''))); }}><span>{p.label}</span><span className="arr" aria-hidden="true">→</span></a>;
      else inner = <button type="button" className={cls} onClick={() => ctx.live && ctx.onNext?.()}><span>{p.label}</span><span className="arr" aria-hidden="true">→</span></button>;
      return <div className={`el-btn al-${p.align || 'left'}`}>{inner}</div>;
    }
    case 'image': {
      if (!p.src) return ctx.editable ? <div className="el-img-ph">🖼️ <span>Add an image — select this and upload in the panel</span></div> : null;
      const img = <Img className={`el-img ${p.rounded ? 'rounded' : ''} ${p.shadow ? 'shadow' : ''}`} src={p.src} alt={p.alt || ''} />;
      return p.link && safeHref(p.link) && !ctx.editable ? <a href={safeHref(p.link)}>{img}</a> : img;
    }
    case 'list': {
      const Tag = p.icon === 'num' ? 'ol' : 'ul';
      return <Tag className={`el-list ic-${p.icon || 'check'}`}>{(p.items || []).map((it, i) => <li key={i} data-item={`items.${i}`}><E ctx={ctx} k={`items.${i}.text`} v={it.text} keep /></li>)}</Tag>;
    }
    case 'price': {
      const off = p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0;
      return <div className="el-price">{off > 0 && <s>{money(p.currency, p.mrp)}</s>}<b>{money(p.currency, p.price)}</b>{off > 0 && <span className="off">Save {off}%</span>}{p.note && <small>{p.note}</small>}</div>;
    }
    case 'video':
      return p.url ? <VideoEmbed url={p.url} /> : ctx.editable ? <div className="video ph">🎬 Add a video link in the panel</div> : null;
    case 'spacer':
      return <div className="el-spacer" style={{ height: Math.max(4, Math.min(400, Number(p.height) || 32)) }} />;
    case 'divider':
      return <hr className={`el-hr ${p.style || 'line'}`} />;
    default:
      return null;
  }
}

function ElementView({ el, ctx, blockId, col }) {
  if (!ctx.editable) return <div className="el"><ElementContent el={el} ctx={ctx} /></div>;
  const ectx = { ...ctx, onEdit: (k, v) => ctx.onEditEl?.(blockId, el.id, k, v) };
  const sel = ctx.selEl === el.id;
  return (
    <div className={`el ${sel ? 'el-sel' : ''}`} data-el={el.id}
      onClick={(e) => { e.stopPropagation(); ctx.onSelectEl?.(blockId, el.id); }}>
      <div className="el-tools" onClick={(e) => e.stopPropagation()}>
        <span className="el-handle" title="Drag to move" onPointerDown={(e) => ctx.onDragStart?.(e, { kind: 'move-el', blockId, col, elId: el.id }, ELEMENT_TYPES[el.type]?.label)}><GripVertical size={13} /></span>
        <span className="el-name">{ELEMENT_TYPES[el.type]?.label}</span>
        <button title="Duplicate" aria-label="Duplicate" onClick={() => ctx.onElAction?.('dup', blockId, el.id)}><CopyIcon size={12} /></button>
        <button title="Delete" aria-label="Delete" onClick={() => ctx.onElAction?.('del', blockId, el.id)}><Trash2 size={12} /></button>
      </div>
      <ElementContent el={el} ctx={ectx} />
    </div>
  );
}

function CustomSection({ p, ctx, block }) {
  const tpl = LAYOUT_COLS[p.layout] || LAYOUT_COLS[1];
  const drop = ctx.dropAt;
  return (
    <Sec type="custom">
      <div className={`cgrid va-${p.valign || 'top'} gap-${p.gap || 'md'}`} style={{ '--cols': tpl.join(' ') }}>
        {tpl.map((_, ci) => {
          const col = p.columns?.[ci] || { elements: [] };
          const here = drop && drop.zone === 'col' && drop.block === block.id && drop.col === ci;
          return (
            <div className={`ccol ${here ? 'over' : ''}`} key={col.id || ci} {...(ctx.editable ? { 'data-drop': 'col', 'data-block': block.id, 'data-col': ci } : {})}>
              {col.elements.map((el, ei) => (
                <div className="el-slot" key={el.id}>
                  {here && drop.index === ei && <div className="drop-line el-line" />}
                  <ElementView el={el} ctx={ctx} blockId={block.id} col={ci} />
                </div>
              ))}
              {here && drop.index === col.elements.length && <div className="drop-line el-line" />}
              {ctx.editable && !col.elements.length && <div className="ccol-empty">Drop elements here</div>}
            </div>
          );
        })}
      </div>
    </Sec>
  );
}

// Per-section design overrides (props._style), applied around any block
export const STYLE_DEFAULTS = { bg: '', bgImage: '', overlay: 40, textColor: '', padTop: '', padBottom: '', width: '', align: '', hideMobile: false, hideDesktop: false, anchor: '' };
const cleanAnchor = (a) => String(a || '').toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(0, 40);
const cssUrl = (u) => `url("${String(mediaUrl(u)).replace(/["\\\n\r]/g, '')}")`;
export function Block({ block, ctx }) {
  const content = renderBlock(block, ctx);
  const st = block.props?._style;
  if (!st) return content;
  const cls = ['sx'];
  const vars = {};
  if (st.bg) { cls.push('has-bg'); vars['--sx-bg'] = st.bg; }
  if (st.bgImage) { cls.push('has-bgimg'); vars['--sx-img'] = cssUrl(st.bgImage); vars['--sx-ov'] = Math.min(0.9, Math.max(0, Number(st.overlay ?? 40) / 100)); }
  if (st.textColor) { cls.push('has-ink'); vars['--sx-ink'] = st.textColor; }
  if (st.padTop) cls.push(`pt-${st.padTop}`);
  if (st.padBottom) cls.push(`pb-${st.padBottom}`);
  if (st.width) cls.push(`w-${st.width}`);
  if (st.align) cls.push(`al-${st.align}`);
  if (st.hideMobile) cls.push('hide-m');
  if (st.hideDesktop) cls.push('hide-d');
  if (cls.length === 1 && !st.anchor) return content;
  return <div className={cls.join(' ')} style={vars} id={cleanAnchor(st.anchor) || undefined}>{content}</div>;
}

function renderBlock(block, ctx) {
  const p = withCopy(block.type, block.props || {});
  switch (block.type) {
    case 'section': return <CustomSection p={p} ctx={ctx} block={block} />;
    case 'image': return <ImageBlock p={p} ctx={ctx} />;
    case 'gallery': return <Gallery p={p} ctx={ctx} />;
    case 'spacer': return <div className="blk-spacer" style={{ height: Math.max(4, Math.min(400, Number(p.height) || 48)) }} />;
    case 'divider': return <Sec type="divider"><hr className={`el-hr ${p.style || 'line'}`} /></Sec>;
    case 'html': return <HtmlEmbed p={p} ctx={ctx} />;
    case 'form': return <FormBlock p={p} ctx={ctx} />;
    case 'quiz': return <QuizBlock p={p} ctx={ctx} block={block} />;
    case 'hero': return <Hero p={p} ctx={ctx} />;
    case 'stats': return <Stats p={p} ctx={ctx} />;
    case 'problem': return <Problem p={p} ctx={ctx} />;
    case 'features': return <Features p={p} ctx={ctx} />;
    case 'steps': return <Steps p={p} ctx={ctx} />;
    case 'compare': return <Compare p={p} ctx={ctx} />;
    case 'testimonials': return <Testimonials p={p} ctx={ctx} />;
    case 'mentor': return <Mentor p={p} ctx={ctx} />;
    case 'bonuses': return <Bonuses p={p} ctx={ctx} />;
    case 'guarantee': return <Guarantee p={p} ctx={ctx} />;
    case 'video':
      return <Sec type="video">{p.url ? <VideoEmbed url={p.url} /> : <div className="video ph">Add a video link (YouTube, Vimeo, Loom, Google Drive or .mp4)</div>}</Sec>;
    case 'text':
      return <Sec type="text"><div className="narrow"><E ctx={ctx} k="title" v={p.title} as="h2" isRich /><E ctx={ctx} k="body" v={p.body} as="p" multiline style={{ whiteSpace: 'pre-wrap' }} /></div></Sec>;
    case 'countdown': return <Countdown p={p} ctx={ctx} />;
    case 'optin': return <OptinForm p={p} ctx={ctx} />;
    case 'checkout': return <Checkout p={p} ctx={ctx} />;
    case 'offer': return <Offer p={p} ctx={ctx} />;
    case 'crosssell': return <CrossSell p={p} ctx={{ ...ctx, blockId: block.id }} />;
    case 'booking': return <Booking p={p} ctx={{ ...ctx, onSlots: ctx.onSlots && ((d) => ctx.onSlots(block.id, d)), onBook: ctx.onBook && ((d) => ctx.onBook(block.id, d)) }} />;
    case 'faq':
      return (
        <Sec type="faq" className="alt" v={vOf('faq', p)}>
          <Head eyebrow={p.eyebrow} title={p.title} ctx={ctx} />
          <div className="faq">{(p.items || []).map((i, k) => (ctx.editable
            ? <div key={k} className="faq-ed" data-item={`items.${k}`}><E ctx={ctx} k={`items.${k}.q`} v={i.q} as="div" className="faq-q" /><E ctx={ctx} k={`items.${k}.a`} v={i.a} as="p" multiline /></div>
            : i.q ? <details key={k} open={k === 0}><summary>{i.q}</summary>{i.a && <p>{i.a}</p>}</details> : null))}</div>
        </Sec>
      );
    case 'cta':
      return (
        <Sec type="cta" v={vOf('cta', p)}>
          <E ctx={ctx} k="headline" v={p.headline} as="h2" isRich />
          {p.subheadline && <E ctx={ctx} k="subheadline" v={p.subheadline} as="p" className="sub" />}
          <Btn big onClick={go(ctx)} ctx={ctx} k="buttonText" link={buttonLink(p.buttonAction, p.buttonUrl, p.buttonNewTab)}>{p.buttonText}</Btn>
          {p.note && <E ctx={ctx} k="note" v={p.note} as="p" className="cta-note" />}
        </Sec>
      );
    case 'thankyou':
      return (
        <Sec type="thankyou">
          <div className="ty">
            <div className="tick">✓</div>
            <E ctx={ctx} k="headline" v={p.headline} as="h1" isRich />
            <E ctx={ctx} k="body" v={p.body} as="p" className="lead" multiline />
            {ctx.delivery?.webinar && (
              <div className="pc ty-seat">
                <small>Your seat</small>
                <b><SeatTime w={ctx.delivery.webinar} /></b>
                <span className="muted">{ctx.delivery.webinar.name}</span>
                {ctx.delivery.webinar.join && <div className="row center"><a className="btn" href={ctx.delivery.webinar.join}><span>Open my joining page</span><span className="arr" aria-hidden="true">→</span></a><a className="link-arrow" href={`${ctx.delivery.webinar.join.replace('/webinar/', '/api/webinar-reg/').replace('?t=', '/ics?t=')}`}>Add to calendar</a></div>}
                <small className="muted">Your personal joining link is also in your email.</small>
              </div>
            )}
            {(ctx.delivery?.access || ctx.delivery?.invoice) && (
              <div className="ty-access">
                {ctx.delivery.access && <a className="btn big" href={ctx.delivery.access}><span>Open your purchase</span><span className="arr" aria-hidden="true">→</span></a>}
                {ctx.delivery.invoice && <a className="link-arrow" href={ctx.delivery.invoice} target="_blank" rel="noreferrer">Download your invoice ↗</a>}
                {ctx.delivery.access && <small className="muted">We’ve also emailed you a link to your library.</small>}
              </div>
            )}
            {(p.steps || []).length > 0 && (
              <div className="ty-steps">{p.steps.map((s, i) => <div className="pc" key={i} data-item={`steps.${i}`}><span className="num">{i + 1}</span><E ctx={ctx} k={`steps.${i}.text`} v={s.text} /></div>)}</div>
            )}
          </div>
        </Sec>
      );
    case 'pricing': return <Pricing p={p} ctx={ctx} />;
    case 'hellobar': return <HelloBar p={p} ctx={ctx} />;
    case 'navbar': return <Navbar p={p} ctx={ctx} />;
    case 'footer': return <Footer p={p} ctx={ctx} />;
    case 'livecount': return <LiveCount p={p} ctx={ctx} />;
    case 'stock': return <Stock p={p} ctx={{ ...ctx, blockId: block.id }} />;
    case 'proof': return <Proof p={p} ctx={ctx} />;
    case 'exitpopup': return <ExitPopup p={p} ctx={ctx} />;
    case 'stickybar': return <StickyBar p={p} ctx={ctx} />;
    case 'whatsapp': return <WhatsApp p={p} ctx={ctx} />;
    default: return <Sec type="unknown">Unknown block: {block.type}</Sec>;
  }
}

// ---------- pop-ups: up to 3 per step, each a mini page made of the usual blocks ----------
// (the server keeps the same limits and block list — see cleanPopups in server/index.js)
export const POPUP_SIZES = [['center', 'Box in the centre'], ['corner', 'Slide-in, bottom corner'], ['full', 'Full screen'], ['bar', 'Bar at the top']];
export const POPUP_TRIGGERS = [['exit', 'When the visitor is about to leave'], ['delay', 'After some seconds'], ['scroll', 'After scrolling part of the page'], ['click', 'Only when a button opens it'], ['load', 'As soon as the page opens']];
export const POPUP_FREQ = [['session', 'Once per visit'], ['visitor', 'Once per visitor, ever'], ['always', 'Every time the page opens']];
export const POPUP_BLOCKS = ['section', 'text', 'image', 'video', 'countdown', 'optin', 'form', 'cta', 'spacer', 'divider', 'guarantee', 'testimonials'];
export const POPUP_MAX = 3, POPUP_MAX_BLOCKS = 20;
// any button set to "Open a pop-up" calls this; the page's PopupHost listens
export const openPopup = (id) => window.dispatchEvent(new CustomEvent('ff:popup', { detail: String(id) }));
const MODAL = ['center', 'full']; // these block the page (focus trapped); a corner card or top bar doesn't
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

// One pop-up on screen. Esc, the × and (for boxes) a click on the backdrop all close it — closing never costs the visitor anything
export function PopupView({ popup, ctx, onClose }) {
  const ref = useRef(null);
  const size = POPUP_SIZES.some(([k]) => k === popup.size) ? popup.size : 'center';
  const modal = MODAL.includes(size);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const back = document.activeElement, box = ref.current;
    const overflow = document.body.style.overflow;
    if (modal) { document.body.style.overflow = 'hidden'; box?.focus(); }
    const key = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== 'Tab' || !modal || !box) return;
      const list = [...box.querySelectorAll(FOCUSABLE)].filter((n) => n.getClientRects().length);
      if (!list.length) { e.preventDefault(); return; }
      const first = list[0], last = list[list.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === box)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !box.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); if (modal) { document.body.style.overflow = overflow; back?.focus?.(); } };
  }, [modal]);
  const box = (
    <div ref={ref} className={`pop pop-${size}`} role="dialog" aria-modal={modal ? 'true' : undefined} aria-label={popup.name || 'Pop-up'} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="pop-x" aria-label={tr(ctx.lang, 'Close')} title={tr(ctx.lang, 'Close')} onClick={onClose}>×</button>
      <div className="pop-body">{(popup.blocks || []).map((b) => <Block key={b.id} block={b} ctx={ctx} />)}</div>
    </div>
  );
  return modal ? <div className="pop-overlay" onClick={onClose}>{box}</div> : box;
}

// Arms each pop-up's trigger on the live page. Client-only (never in the server HTML), waits while the cookie
// banner is up, never stacks two pop-ups, and stops showing them once this visitor has signed up
const popKey = (p) => `ff_pop_${p.id}`;
function PopupHost({ popups, ctx }) {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(null);
  const [thanks, setThanks] = useState('');
  const openRef = useRef(null);
  const shown = useRef({});
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  openRef.current = open;
  useEffect(() => { setReady(true); }, []);
  useEffect(() => { setOpen(null); shown.current = {}; }, [popups]);
  useEffect(() => { if (!thanks) return; const t = setTimeout(() => setThanks(''), 7000); return () => clearTimeout(t); }, [thanks]);
  const seen = (p) => {
    const c = ctxRef.current;
    if (c.preview) return false; // preview shows them every time
    try {
      if (c.leadKey && localStorage.getItem(c.leadKey)) return true; // already signed up
      if (p.frequency === 'visitor') return !!localStorage.getItem(popKey(p));
      if (p.frequency !== 'always') return !!sessionStorage.getItem(popKey(p));
    } catch {}
    return false;
  };
  const show = (p, clicked) => {
    if (!clicked && (openRef.current || shown.current[p.id] || seen(p))) return;
    shown.current[p.id] = true;
    try { if (p.frequency === 'visitor') localStorage.setItem(popKey(p), '1'); else if (p.frequency !== 'always') sessionStorage.setItem(popKey(p), '1'); } catch {}
    openRef.current = p.id;
    setThanks(''); setOpen(p.id);
    ctxRef.current.onPopupEvent?.('popup_view', p.id);
  };
  // a button set to "Open a pop-up": always opens, the visitor asked for it
  useEffect(() => {
    if (!ready) return;
    const on = (e) => { const p = popups.find((x) => x.id === e.detail); if (p) show(p, true); };
    window.addEventListener('ff:popup', on);
    return () => window.removeEventListener('ff:popup', on);
  }, [ready, popups]);
  useEffect(() => {
    if (!ready || ctx.holdPopups) return;
    const auto = popups.filter((p) => p.trigger?.type !== 'click');
    const timers = [];
    const val = (p, d) => (Number.isFinite(Number(p.trigger?.value)) && p.trigger?.value !== '' ? Number(p.trigger.value) : d);
    for (const p of auto) {
      if (p.trigger?.type === 'load') timers.push(setTimeout(() => show(p), 500));
      if (p.trigger?.type === 'delay') timers.push(setTimeout(() => show(p), Math.max(0, val(p, 10)) * 1000));
    }
    const scrolls = auto.filter((p) => p.trigger?.type === 'scroll');
    const exits = auto.filter((p) => !p.trigger?.type || p.trigger.type === 'exit');
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    let prevY = window.scrollY, prevT = Date.now(), maxY = prevY, up = null;
    const onScroll = () => {
      const y = window.scrollY, now = Date.now();
      const room = document.documentElement.scrollHeight - window.innerHeight;
      const pct = room > 0 ? (y / room) * 100 : 100;
      for (const p of scrolls) if (pct >= Math.min(100, Math.max(0, val(p, 50)))) show(p);
      maxY = Math.max(maxY, y);
      // phones have no mouse to leave with: a fast flick back up after reading a while counts as leaving
      if (coarse && exits.length) {
        if (y >= prevY) up = null;
        else { up ||= { y: prevY, t: prevT }; const dist = up.y - y; if (maxY > 600 && dist > 150 && dist / Math.max(1, now - up.t) > 1.2) exits.forEach((p) => show(p)); }
      }
      prevY = y; prevT = now;
    };
    const onLeave = (e) => { if (e.clientY <= 0) exits.forEach((p) => show(p)); };
    if (scrolls.length || (coarse && exits.length)) window.addEventListener('scroll', onScroll, { passive: true });
    if (exits.length) document.addEventListener('mouseleave', onLeave);
    return () => { timers.forEach(clearTimeout); window.removeEventListener('scroll', onScroll); document.removeEventListener('mouseleave', onLeave); };
  }, [ready, popups, ctx.holdPopups]);
  if (!ready) return null;
  const cur = popups.find((p) => p.id === open);
  const close = () => setOpen(null);
  // forms inside a pop-up submit exactly like the page's; then the pop-up closes with a thank-you, or moves on
  const pctx = cur && {
    ...ctx, inPopup: true, popupId: cur.id,
    onNext: () => { close(); ctx.onNext?.(); },
    onOptin: async (data) => {
      await ctx.onOptin(data, { popup: cur.id, next: cur.after === 'next' });
      if (cur.after !== 'next') { close(); setThanks(cur.thanks || tr(ctx.lang, 'Thank you! Check your inbox.')); }
    },
    onForm: (data) => ctx.onForm(data, { popup: cur.id }),
    onFormNext: () => { close(); ctx.onFormNext?.(); },
  };
  return (
    <>
      {cur && <PopupView key={cur.id} popup={cur} ctx={pctx} onClose={close} />}
      {thanks && <div className="pop-thanks" role="status"><span>✅ {thanks}</span><button type="button" aria-label={tr(ctx.lang, 'Close')} onClick={() => setThanks('')}>×</button></div>}
    </>
  );
}

// The seller's legal name, address and policies on every live page (Consumer Protection (E-Commerce) Rules 2020).
// Always shown — sellers can't remove it — but kept small.
function SellerFooter({ s, lang }) {
  const links = [['terms', 'Terms'], ['privacy', 'Privacy Policy'], ['refund', 'Refund Policy'], ['contact', 'Contact']].filter(([k]) => s[k]);
  return (
    <footer className="seller-foot" style={{ padding: '22px 16px 28px', textAlign: 'center', fontSize: 12, lineHeight: 1.6, opacity: 0.7 }}>
      {s.name && <div><b>{s.name}</b>{s.address && <> · {s.address}</>}</div>}
      <div>{links.map(([k, l], i) => <span key={k}>{i > 0 && ' · '}<a href={s[k]} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>{tr(lang, l)}</a></span>)}</div>
    </footer>
  );
}

export const RADIUS = { sharp: ['2px', '2px', '2px'], soft: ['14px', '10px', '10px'], round: ['24px', '16px', '14px'], pill: ['24px', '999px', '14px'] };
export const TEXT_SIZES = { sm: '15.5px', md: '17px', lg: '18.5px' };
const TEXT_SCALE = { sm: 0.94, md: 1.06, lg: 1.14 };
// popups: this step's pop-ups (live pages); popupPreview + onClosePreview: one pop-up shown as-is, without its trigger (editor)
// A card's page preview (Templates, Funnels, Dashboard): drawn — and its fonts loaded — only once the card is
// near the screen, so a grid of 100+ cards doesn't build 100+ pages up front
export function PagePreview({ block, theme }) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (seen || !ref.current) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: '400px 0px' });
    io.observe(ref.current.parentElement || ref.current); // the scaled preview box is 0 tall until drawn; its frame isn't
    return () => io.disconnect();
  }, [seen]);
  return <div className="thumb-in" ref={ref} style={seen ? undefined : { background: theme?.bg || 'var(--c-line-2)' }}>{seen && <Page blocks={[block]} theme={theme} ctx={{ live: false }} />}</div>;
}

export function Page({ blocks, theme, ctx, popups, popupPreview, onClosePreview }) {
  const style = theme?.style || 'aurora';
  const hf = FONT_CHOICES[theme?.headingFont], bf = FONT_CHOICES[theme?.bodyFont], rad = RADIUS[theme?.radius];
  useEffect(() => { ensureFonts(theme || style); }, [style, theme?.headingFont, theme?.bodyFont]);
  const vars = { '--primary': theme?.primary || '#6366f1', '--secondary': theme?.secondary || theme?.primary || '#ec4899' };
  // site-wide overrides on top of the chosen style
  if (hf) vars['--hf'] = hf.stack;
  if (bf) vars['--bf'] = bf.stack;
  if (rad) { vars['--radius'] = rad[0]; vars['--btnr'] = rad[1]; vars['--inr'] = rad[2]; }
  if (TEXT_SIZES[theme?.textSize]) vars.fontSize = TEXT_SIZES[theme.textSize];
  // body text in every section scales with the chosen size (section styles multiply their sizes by --ts)
  if (TEXT_SCALE[theme?.textSize]) vars['--ts'] = TEXT_SCALE[theme.textSize];
  return (
    <div className={`page s-${style}`} style={vars}>
      {blocks.map((b) => <Block key={b.id} block={b} ctx={ctx} />)}
      {ctx?.seller && ctx.live && !ctx.editable && <SellerFooter s={ctx.seller} lang={ctx.lang} />}
      {popups?.length > 0 && ctx?.live && !ctx.editable && <PopupHost popups={popups} ctx={ctx} />}
      {popupPreview && <PopupView popup={popupPreview} ctx={{ ...ctx, inPopup: true, popupId: popupPreview.id }} onClose={onClosePreview || (() => {})} />}
    </div>
  );
}
