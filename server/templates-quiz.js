// Quiz funnels: a short quiz → contact details → a personal result that sends each kind of lead to the right next
// step (a call, a course, a product). Answers and results tag the CRM contact (quiz.js), so follow-ups can differ.
// Built into templates by buildQuiz below; copy stays honest — no invented numbers or urgency.
const WA = '919999999999';
const q = (text, ...answers) => ({ q: text, answers: answers.map(([t, outcome, tag]) => ({ text: t, outcome, ...(tag ? { tag } : {}) })) });
const out = (title, body, buttonText, tag) => ({ title, body, buttonText, url: '', tag });

export const QUIZZES = [
  {
    id: 'q-coach', look: { hero: 'editorial', steps: 'columns', faq: 'accordion', badge: '🧭 Free 1-minute quiz' }, category: 'Coaching', name: 'Which Coaching Path Fits You? (Quiz)', style: 'aurora', color: '#7c3aed',
    title: 'Which *coaching path* is right for you?', sub: 'Answer 5 quick questions and get a personal recommendation — free, in under a minute.',
    questions: [
      q('Where are you in your journey?', ['Just exploring', 0], ['Started, but stuck', 1], ['Doing well, want to scale', 2]),
      q('What’s the biggest thing holding you back?', ['Not knowing where to start', 0], ['No clear system', 1], ['Not enough time to do it all', 2]),
      q('How much time can you give each week?', ['1–2 hours', 0], ['3–5 hours', 1], ['I want it done with me', 2]),
      q('How would you like to learn?', ['At my own pace', 0], ['In a group, with support', 1], ['One-on-one', 2]),
      q('What would you invest to solve this in the next 90 days?', ['Under ₹5,000', 0], ['₹5,000 – ₹30,000', 1], ['₹30,000+', 2, 'high-budget']),
    ],
    outcomes: [
      out('The Self-Starter Path', 'You need clarity and a simple first step. Start with our self-paced course — it walks you through the basics in short daily lessons.', 'See the course', 'quiz-self-starter'),
      out('The Group Programme Path', 'You’ve started — now you need a proven system and people to keep you on track. Our group programme is built for exactly this stage.', 'See the programme', 'quiz-group'),
      out('The 1:1 Coaching Path', 'You’re ready to move fast with personal guidance. Book a free strategy call and we’ll map out your next 90 days together.', 'Book my free call', 'quiz-1on1'),
    ],
    next: 'booking', nextTitle: 'Book your free strategy call',
  },
  {
    id: 'q-realestate', look: { hero: 'editorial', steps: 'timeline', faq: 'two', badge: '🏡 Free home-match quiz' }, category: 'Real estate', name: 'Find Your Ideal Home (Quiz)', style: 'luxe', color: '#0f766e',
    title: 'Find the *right home* for your family', sub: '5 questions. Get a shortlist that matches your budget, location and timeline.',
    questions: [
      q('What are you looking for?', ['1–2 BHK apartment', 0], ['3 BHK or larger', 1], ['Villa / independent house', 2]),
      q('What’s your budget?', ['Under ₹60 lakh', 0], ['₹60 lakh – ₹1.5 crore', 1], ['₹1.5 crore+', 2, 'high-budget']),
      q('When do you plan to buy?', ['In the next 3 months', 1, 'hot-lead'], ['3–6 months', 1], ['Just researching', 0]),
      q('Will you need a home loan?', ['Yes', 0, 'needs-loan'], ['Maybe', 0], ['No', 2]),
      q('What matters most?', ['Price', 0], ['Location & schools', 1], ['Space & privacy', 2]),
    ],
    outcomes: [
      out('Smart Starter Homes', 'Well-connected apartments that fit your budget, with loan help from our partner banks. We’ll share a shortlist on WhatsApp.', 'Book a site visit', 'quiz-starter-home'),
      out('Family Upgrade Homes', 'Spacious homes near good schools and offices. Our advisor will shortlist the best 3 for you and plan visits around your time.', 'Book a site visit', 'quiz-family-home'),
      out('Premium Villas', 'Independent homes with space and privacy. Book a private viewing with our senior advisor.', 'Book a private viewing', 'quiz-premium'),
    ],
    next: 'booking', nextTitle: 'Pick a time for your site visit',
  },
  {
    id: 'q-skincare', look: { hero: 'banner', steps: 'cards', faq: 'accordion', badge: '✨ 60-second skin quiz' }, category: 'Beauty & skincare', name: 'Skin Type Quiz', style: 'pastel', color: '#db2777',
    title: 'Discover your *skin type* in 60 seconds', sub: 'Answer 5 questions and get a routine made for your skin.',
    questions: [
      q('How does your skin feel by midday?', ['Tight or flaky', 0], ['Shiny all over', 1], ['Shiny T-zone, dry cheeks', 2]),
      q('How often do you get breakouts?', ['Rarely', 0], ['Often', 1, 'acne'], ['Sometimes', 2]),
      q('How does your skin react to new products?', ['It stings or turns red', 0, 'sensitive'], ['Usually fine', 1], ['Depends on the product', 2]),
      q('What’s your main concern?', ['Dryness & dullness', 0], ['Oil & acne', 1], ['Uneven tone', 2, 'pigmentation']),
      q('How much time do you give your routine?', ['2 minutes', 0], ['5 minutes', 1], ['10+ minutes', 2]),
    ],
    outcomes: [
      out('Dry & Sensitive Skin', 'Your skin needs gentle hydration and a strong barrier. We’ve put together a 3-step calming routine for you.', 'Shop my routine', 'quiz-dry'),
      out('Oily & Acne-Prone Skin', 'You need light, non-comedogenic care that controls oil without stripping. Here’s your clear-skin routine.', 'Shop my routine', 'quiz-oily'),
      out('Combination Skin', 'Balance is everything — hydrate the dry areas, control the T-zone. Here’s your balancing routine.', 'Shop my routine', 'quiz-combination'),
    ],
    next: 'shop', nextTitle: 'Your routine',
  },
  {
    id: 'q-fitness', look: { hero: 'center', steps: 'timeline', faq: 'accordion', badge: '💪 Free plan finder' }, category: 'Fitness', name: 'Find Your Fitness Plan (Quiz)', style: 'bold', color: '#ea580c',
    title: 'Which *fitness plan* will actually work for you?', sub: 'Tell us about your goals and routine — get a plan you can stick to.',
    questions: [
      q('What’s your main goal?', ['Lose weight', 0, 'goal-weight-loss'], ['Build strength', 1], ['Get fit & feel energetic', 2]),
      q('Where do you prefer to work out?', ['At home', 0], ['At the gym', 1], ['Outdoors / anywhere', 2]),
      q('How many days a week can you train?', ['2–3 days', 0], ['4–5 days', 1], ['Every day, a little', 2]),
      q('What usually stops you?', ['No time', 2], ['No motivation', 0], ['Not knowing what to do', 1]),
      q('Would you like a coach to check in on you?', ['Yes, keep me accountable', 1, 'wants-coach'], ['Maybe later', 0], ['No, I’ll go solo', 2]),
    ],
    outcomes: [
      out('Home Fat-Loss Plan', 'Short home workouts plus a simple Indian meal plan — built for steady fat loss without a gym.', 'Start my plan', 'quiz-fat-loss'),
      out('Strength Builder Plan', 'A progressive gym plan with coach check-ins to help you get stronger every week.', 'Talk to a coach', 'quiz-strength'),
      out('Everyday Fitness Plan', '20-minute daily sessions you can do anywhere. Feel more energetic in 2 weeks.', 'Start my plan', 'quiz-everyday'),
    ],
    next: 'booking', nextTitle: 'Book a free consultation',
  },
  {
    id: 'q-loan', look: { hero: 'bento', steps: 'cards', faq: 'two', badge: '🔒 No effect on your credit score' }, category: 'Finance', name: 'Which Loan Is Right for You? (Quiz)', style: 'clean', color: '#1d4ed8',
    title: 'Find the *right loan* in 60 seconds', sub: 'Answer 5 questions — see which option fits you, with no effect on your credit score.',
    questions: [
      q('What do you need the money for?', ['Buying a home', 0, 'home-loan'], ['Business', 1, 'business-loan'], ['Personal needs', 2]),
      q('How much do you need?', ['Under ₹5 lakh', 2], ['₹5 – 50 lakh', 1], ['₹50 lakh+', 0, 'high-value']),
      q('What best describes your income?', ['Salaried', 0], ['Self-employed / business', 1], ['Other', 2]),
      q('How soon do you need it?', ['This week', 2, 'urgent'], ['This month', 1], ['Just comparing', 0]),
      q('How’s your credit history?', ['Good, no missed EMIs', 0], ['A few missed payments', 2], ['Not sure', 1]),
    ],
    outcomes: [
      out('Home Loan', 'A home loan with the lowest rates and longest tenure suits you. Our advisor will compare offers from partner banks for you.', 'Talk to an advisor', 'quiz-home-loan'),
      out('Business Loan', 'A business loan or line of credit fits your needs. We’ll help you with documents and compare lenders.', 'Talk to an advisor', 'quiz-business-loan'),
      out('Personal Loan', 'A quick personal loan is your best option. Check your eligibility with our advisor in one short call.', 'Check my eligibility', 'quiz-personal-loan'),
    ],
    next: 'booking', nextTitle: 'Book a call with an advisor',
  },
];

export function buildQuiz(t) {
  const quiz = { type: 'quiz', props: { title: 'Let’s find your answer', subtitle: '', startText: '', image: '', scoring: 'outcome', contact: 'both', askName: true, gateTitle: 'Your result is ready!', gateText: 'Where should we send your personalised result?', buttonText: 'Show my result', showScore: false, note: 'Takes under a minute · Free', questions: t.questions, outcomes: t.outcomes } };
  // the hero is the quiz's cover: its button scrolls down to question 1
  const hero = { type: 'hero', props: { variant: t.look.hero, badge: t.look.badge, headline: t.title, subheadline: t.sub, ctaText: 'Start the quiz', ctaAction: 'scroll', ctaUrl: '#quiz', secondaryText: '', image: '', showCard: false, showTrust: false, rating: '', reviews: '', socialText: '' } };
  const page = [
    { type: 'hellobar', props: { messages: [{ text: `✨ ${t.questions.length} questions · personal result · free` }] } },
    hero,
    quiz,
    { type: 'steps', props: { variant: t.look.steps, eyebrow: 'How it works', title: 'Three steps to your answer', items: [{ title: 'Answer', text: `${t.questions.length} quick questions about you.` }, { title: 'Get your result', text: 'A personal recommendation, instantly.' }, { title: 'Take the next step', text: 'Only what fits you — no hard selling.' }] } },
    { type: 'faq', props: { variant: t.look.faq, eyebrow: 'FAQ', title: 'Questions', items: [{ q: 'Is the quiz free?', a: 'Yes — completely free, and it takes under a minute.' }, { q: 'What do you do with my details?', a: 'We use them only to send your result and follow up about it. You can unsubscribe any time.' }] } },
    { type: 'whatsapp', props: { number: WA, message: `Hi! I just took the ${t.name.replace(/ \(Quiz\)$/, '')}.`, label: 'Questions? Chat with us' } },
  ];
  const next = t.next === 'booking'
    ? [
      { type: 'thankyou', props: { headline: `${t.nextTitle} 🎉`, body: 'Pick a slot that suits you — you’ll get the confirmation on email right away.', steps: [] } },
      { type: 'booking', props: { calendarId: '', eyebrow: 'Book', title: t.nextTitle, subtitle: 'Times are shown in your own time zone.', buttonText: 'Confirm', successTitle: 'You’re booked ✅', successText: 'The confirmation and joining details are in your email.' } },
    ]
    : [{ type: 'thankyou', props: { headline: `${t.nextTitle} 🎉`, body: 'We’ve also sent your result to your email. Add your products to this page, or link each result straight to its product.', steps: [] } }];
  return {
    id: t.id, category: t.category, name: t.name, style: t.style, kind: 'quiz', type: 'quiz', headline: t.title.replace(/\*/g, ''), color: t.color,
    hero, steps: [{ name: 'Quiz', type: 'optin', slug: 'quiz', blocks: page }, { name: t.nextTitle, type: 'thankyou', slug: 'next', blocks: next }],
  };
}
