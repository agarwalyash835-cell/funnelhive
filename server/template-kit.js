// Content + look for the template library: per-category section copy, per-niche pains/expert, and visual style.

// [visual style, accent colour override]
export const LOOK = {
  upsc: ['clean'], neet: ['clean'], jee: ['midnight', '#8b5cf6'], spokenenglish: ['aurora'], ca: ['clean'], coding: ['midnight', '#3b82f6'], excel: ['clean'], kidsabacus: ['fresh', '#f97316'], govtexam: ['bold', '#e11d48'],
  yoga: ['aurora'], weightloss: ['bold', '#f97316'], diabetes: ['clean'], gym: ['bold', '#ef4444'], ayurveda: ['fresh'], pcod: ['aurora'],
  skincare: ['aurora', '#f97316'], haircare: ['fresh', '#9a3412'], salon: ['luxe', '#9f1239'], mehendi: ['luxe', '#3f6212'], spa: ['luxe', '#0f766e'],
  pickle: ['fresh', '#c2410c'], organic: ['fresh'], dryfruits: ['luxe', '#92400e'], sweets: ['luxe', '#be123c'], tea: ['luxe', '#166534'], ethnicwear: ['luxe', '#86198f'], jewellery: ['luxe', '#a16207'],
  stocks: ['midnight', '#22c55e'], mutualfunds: ['midnight', '#14b8a6'], gst: ['clean'], startup: ['bold', '#f97316'], dropship: ['midnight', '#38bdf8'], affiliate: ['midnight', '#a855f7'], insurance: ['clean'], loan: ['clean'],
  realestate: ['luxe', '#a16207'], plots: ['luxe', '#854d0e'], interior: ['luxe', '#78350f'], coaching: ['clean'], clinic: ['aurora'], cardriving: ['bold', '#ea580c'],
  astrology: ['midnight', '#f59e0b'], meditation: ['aurora', '#7c3aed'], wedding: ['luxe', '#9d174d'], webinar: ['bold', '#2563eb'], kirtan: ['luxe', '#c2410c'],
  digitalmarketing: ['bold', '#e11d48'], website: ['midnight', '#06b6d4'], appdev: ['midnight', '#6366f1'], solar: ['fresh', '#d97706'], cleaning: ['fresh'], pestcontrol: ['bold', '#16a34a'], tutoring: ['clean'],
};

// [pain1|pain2|pain3, expertName|role|bio]
export const X = {
  upsc: ['Studying 10 hours a day but scores aren\'t improving|Confused by endless books, notes and Telegram PDFs|No one evaluates your answers or tells you what\'s wrong', 'Arvind Mishra (IAS, retd.)|Chief Mentor · 22 years in civil services|Has mentored 300+ successful candidates, with a sharp focus on answer-writing and interview strategy.'],
  neet: ['The Biology syllabus feels endless and you keep forgetting|Mock scores stuck below 500 despite hard work|Doubts pile up with no one to ask', 'Dr. Ritu Saxena|Head of Biology · AIIMS alumna|Has taught 40,000+ NEET aspirants with a high-yield, NCERT-first method.'],
  jee: ['You can solve examples but freeze on new problems|Physics and Maths feel memorised, not understood|No clarity on what to practise in limited time', 'Ankur Bansal|IIT Bombay alumnus · Physics faculty|13 years teaching JEE — 900+ students in the top 5,000 ranks.'],
  spokenenglish: ['You know the answer but can\'t say it in English|Hesitation and fear of mistakes in meetings and interviews|Grammar books haven\'t made you fluent', 'Shalini Kapoor|Communication coach · Cambridge CELTA|Has helped 1 lakh+ Indians speak confidently at work and in interviews.'],
  ca: ['The syllabus is huge and time is short|Accounts and Law concepts just don\'t stick|You don\'t know how ICAI really evaluates', 'CA Nikhil Jain|AIR 7 · CA Final|Has trained 25,000+ CA students with a concept-first, exam-oriented approach.'],
  coding: ['Watched hundreds of tutorials but can\'t build anything|Your resume has no real projects|Interviews feel impossible without guidance', 'Rohit Verma|Ex-Senior Engineer, Flipkart|Has hired 100+ developers and now trains freshers to be job-ready.'],
  excel: ['Simple reports take you hours|You copy-paste data manually every week|Your manager wants dashboards you can\'t make', 'Neha Agarwal|Microsoft Certified Trainer|Has trained 60,000+ professionals from 500+ Indian companies.'],
  kidsabacus: ['Your child is scared of maths|Homework takes hours and ends in tears|Marks don\'t reflect your child\'s real potential', 'Mrs. Lata Menon|Abacus master trainer · 18 years|Has taught 20,000+ children across India and abroad.'],
  govtexam: ['You study hard but run out of time in the exam|No idea where you stand among lakhs of aspirants|Old-pattern test series don\'t match the real exam', 'Vivek Sharma|Ex-SBI PO · Exam strategist|Has guided 50,000+ aspirants to selections in SSC and banking exams.'],
  yoga: ['Belly fat won\'t go no matter what you try|Stress, poor sleep and back pain every day|No time or motivation for the gym', 'Acharya Kavita Rao|Yoga Alliance E-RYT 500|Has taught yoga to 30,000+ students, from Rishikesh to Bengaluru.'],
  weightloss: ['Crash diets work for a week, then the weight comes back|You don\'t want to give up roti, rice and family meals|Gym memberships wasted, motivation gone', 'Coach Arjun Mehta|Certified nutritionist · ACE trainer|Has coached 12,000+ Indians through sustainable fat loss.'],
  diabetes: ['Sugar levels keep fluctuating despite medicines|Confused about what you can and can\'t eat|Worried about long-term complications', 'Dr. S. Raghavan|MD, Diabetologist · 25 years|Has helped 8,000+ patients bring their sugar under control through lifestyle.'],
  gym: ['You keep promising to start "from Monday"|Crowded gyms with no real guidance|Home workouts tried, motivation lost', 'Vikram Singh|Head Trainer · K11 certified|Has trained 3,000+ members, including state-level athletes.'],
  ayurveda: ['Frequent acidity, bloating and gas|You catch every cold and flu going around|Tired of chemical medicines and side effects', 'Dr. Meera Iyer|BAMS · Ayurvedic physician|Formulated from 20 years of clinical experience in digestion and immunity.'],
  pcod: ['Irregular periods and unexplained weight gain|Acne, hair fall and mood swings|Told to "just lose weight" with no real plan', 'Dr. Aparna Desai|Women\'s health specialist|Has guided 10,000+ women to manage PCOS naturally.'],
  skincare: ['Dull, tired-looking skin even after sleep|Dark spots and tanning that won\'t fade|Products that feel heavy in Indian humidity', 'Dr. Kavya Nair|Dermatologist · MD Skin|Co-developed the formula for Indian skin types and climates.'],
  haircare: ['Hair on your pillow, comb and bathroom floor|A thinning hairline and visible scalp|Expensive treatments with no results', 'Dr. Rohan Shetty|Trichologist|Formulated with traditional Ayurvedic oils and modern hair science.'],
  salon: ['Worried your makeup won\'t last through the ceremonies|Fear of looking cakey or "different" in photos|Too many artists, no idea whom to trust', 'Simran Kaur|Celebrity bridal artist|Has styled 2,000+ brides across India over 12 years.'],
  mehendi: ['Mehendi that fades in two days|Artists who rush intricate bridal designs|Chemical cones that cause allergies', 'Farah Khan|Bridal mehendi artist|Has created bridal designs for 1,500+ weddings.'],
  spa: ['Constant stress and body pain from long work hours|No time to truly relax and reset|Spas that are overpriced or unhygienic', 'Ananya Bose|Wellness Director · Kerala-trained therapist|Leads a team of 20 certified therapists.'],
  pickle: ['Store-bought pickles full of preservatives|Missing the taste of real homemade achar|Pickles that taste oily and artificial', 'Kamla Devi|Founder · home chef from Rajasthan|Started with her family recipes — now loved in 18,000+ homes.'],
  organic: ['Worried about pesticides in your family\'s food|Vegetables that spoil within a day|No time for the mandi every week', 'Rajesh Patil|Founder · works with 400+ farmers|Brings certified organic produce straight from Indian farms.'],
  dryfruits: ['Gifts that end up forgotten in a cupboard|Low-grade dry fruits passed off as premium|Last-minute festive gifting stress', 'Sanjay Gupta|Founder · 3rd-generation dry fruit merchant|Sources directly from Kashmir, Kerala and the finest orchards.'],
  sweets: ['Mithai made with vanaspati, not pure ghee|Stale boxes from local shops|Can\'t send fresh sweets to family in other cities', 'Ramesh Agarwal|Master halwai · since 1985|Makes every batch in pure desi ghee using family recipes.'],
  tea: ['Supermarket tea that tastes like dust|Never tasted real garden-fresh chai|The same boring tea every single day', 'Bikash Das|Tea taster · Assam|Has tasted and graded estate teas for 20 years.'],
  ethnicwear: ['Clothes that look nothing like the photos|Wrong sizes and painful returns|Paying boutique prices for festive wear', 'Rekha Shah|Founder · Surat textile family|Works directly with weavers to cut out the middlemen.'],
  jewellery: ['Jewellery that turns black after one use|Skin rashes from cheap metals|Real gold is too expensive for every occasion', 'Pooja Malhotra|Designer · 10 years in fashion jewellery|Creates temple, kundan and oxidised collections for modern Indian women.'],
  stocks: ['Losing money on random tips from Telegram|Charts and indicators look confusing|No clear plan for investing your savings', 'Abhishek Rao|Market educator · 15 years trading|Has taught 40,000+ beginners to trade and invest responsibly.'],
  mutualfunds: ['Your savings sit idle in a savings account|Too many funds, no idea which to choose|Unsure how much you need for retirement or kids\' education', 'Sneha Kulkarni|Certified Financial Planner (CFP)|Has helped 20,000+ families plan goal-based investing.'],
  gst: ['Paying a CA for simple filings every month|Late fees and notices because of small mistakes|GST rules feel confusing and keep changing', 'CA Pranav Shah|Practising CA · 14 years|Has filed returns for 2,000+ small businesses and freelancers.'],
  startup: ['A great idea, but no idea where to start|Afraid of wasting savings on the wrong thing|Registration, GST and compliance feel overwhelming', 'Kunal Bhatia|2× founder · angel investor|Has mentored 500+ first-time founders across India.'],
  dropship: ['You want a business but can\'t afford inventory|Confused about which products actually sell|Ads burning money with no sales', 'Harsh Vardhan|Ecommerce operator · ₹10 Cr+ in sales|Runs 6 profitable stores and teaches what works in India.'],
  affiliate: ['Your salary isn\'t enough and expenses keep rising|Every "earn online" video feels like a scam|No idea which skill to learn first', 'Ritika Sen|Top-rated freelancer on Upwork|Has earned ₹1 Cr+ online and taught 15,000+ students.'],
  insurance: ['Confused by policies full of jargon|Worried your family isn\'t properly protected|Agents push whatever earns them commission', 'Amit Joshi|Insurance advisor · 15 years|Has helped 25,000+ families pick the right cover.'],
  loan: ['Banks keep rejecting your application|Endless paperwork and branch visits|Hidden charges that show up later', 'Rahul Khanna|Loan specialist · ex-banker|Has helped 30,000+ customers get funds quickly and fairly.'],
  realestate: ['Rent keeps rising every single year|Worried about builder delays and legal issues|Hard to find a good location within budget', 'Shree Developers|RERA-registered builder · 20 years|Has delivered 4,500+ homes on time across 18 projects.'],
  plots: ['Bank FDs barely beat inflation|Scared of fraud and unclear land titles|Prices near the new highway are rising fast', 'Green Acres Realty|Land developer · 15 years|Has sold 6,000+ legally verified plots.'],
  interior: ['Contractors who delay and overcharge|Your home doesn\'t reflect your style|Worried about poor-quality materials', 'Ar. Nisha Kapoor|Principal designer|Has designed 1,800+ homes across India.'],
  coaching: ['Your child gets lost in big, crowded batches|Marks aren\'t improving despite tuition|No regular updates on your child\'s progress', 'Mr. R. K. Sharma|Founder · 20 years teaching|Has guided 10,000+ students to top board results.'],
  clinic: ['Toothache and sensitivity you keep ignoring|Fear of painful dental treatment|Clinics that upsell unnecessary procedures', 'Dr. Aditi Rao|BDS, MDS · 12 years|Has treated 15,000+ patients with painless, modern dentistry.'],
  cardriving: ['Scared to drive in city traffic|Family members who aren\'t patient teachers|No idea how to get your driving licence', 'Manjeet Singh|Certified instructor · 15 years|Has taught 8,000+ learners to drive confidently.'],
  astrology: ['Repeated obstacles in career or marriage|Anxious about important life decisions|Generic horoscopes that don\'t apply to you', 'Pt. Shivanand Shastri|Vedic astrologer · 25 years|Has guided 50,000+ people with personalised readings.'],
  meditation: ['Your mind never stops racing|Anxiety and stress ruin your sleep|You tried meditation apps but quit', 'Swami Anand Prem|Meditation teacher · 18 years|Has taught mindfulness to 40,000+ people worldwide.'],
  wedding: ['Photographers who miss the important moments|Stiff, posed photos that don\'t feel like you|Waiting months for your wedding album', 'Studio Kahani|Wedding filmmakers|Have captured 900+ weddings across India and abroad.'],
  webinar: ['Your business depends only on word of mouth|You post on Instagram but get no customers|Ads feel expensive and confusing', 'Aman Gupta|Growth coach · 12 years|Has helped 5,000+ Indian businesses grow online.'],
  kirtan: ['You want to read the Gita but find it difficult|Looking for peace amid daily stress|Translations feel dry and distant', 'Acharya Gopal Das|Sanskrit scholar|Has taught the Gita to 20,000+ seekers in simple language.'],
  digitalmarketing: ['Spending on ads with no real leads|Competitors rank above you on Google|No time to manage marketing yourself', 'GrowthLab Team|Performance marketing agency|Has managed ₹25 Cr+ in ad spend for 50+ Indian brands.'],
  website: ['Customers can\'t find your business online|An old website that breaks on mobile|Agencies quoting lakhs and months', 'PixelCraft Studio|Web design team|Has launched 1,200+ business websites across India.'],
  appdev: ['A great app idea but no tech team|Agencies that miss every deadline|A budget too limited for a big build', 'CodeNest Labs|Product studio|Has shipped 50+ apps for Indian startups.'],
  solar: ['Electricity bills going up every year|Frequent power cuts in summer|Confused about the subsidy process', 'SunPower India|MNRE-empanelled installer|Has installed 5,000+ rooftop systems.'],
  cleaning: ['No time to deep clean your home|Stubborn grease, stains and bathroom scale|Unverified workers you can\'t trust', 'SparkleHome|Professional cleaning team|Has cleaned 40,000+ homes across 12 cities.'],
  pestcontrol: ['Cockroaches in the kitchen at night|Termites damaging your furniture|Strong chemical smells from other services', 'SafeGuard Pest Control|Government-licensed experts|Has treated 60,000+ homes and offices.'],
  tutoring: ['Your child is falling behind in class|Big coaching batches with no attention|Long travel to tuition every day', 'Ms. Priya Nambiar|Academic head · M.Sc, B.Ed|Leads a team of 200+ verified teachers.'],
};

// Stats are the seller's own numbers: templates ship a placeholder, never an invented figure
export const REAL_NUMBER = '[Add your real number]';
export const ownStats = (list) => list.map((x) => `${REAL_NUMBER}|${String(x).split('|').pop()}`); // 'label' or 'value|label'
// Per-category section copy
export const CAT = {
  Education: {
    bump: ['Lifetime access + PDF notes', 199], unit: 'seats', verb: 'enrolled in', who: 'students', icons: ['🎯', '📝', '📊', '👨‍🏫'],
    steps: ['Enroll in 2 minutes|Pay securely via UPI or card and get instant access', 'Learn live with experts|Join live classes or watch recordings anytime', 'Practise & get feedback|Tests, assignments and personal doubt-solving', 'Achieve your goal|Walk into the exam confident and prepared'],
    cmp: ['Studying alone', ['Random YouTube videos & PDFs|A structured, step-by-step plan', 'No one to clear doubts|Daily doubt-solving by experts', 'No idea where you stand|Regular tests with all-India ranking', 'Motivation fades fast|Mentor + community keep you on track', 'Outdated material|Updated for the latest pattern']],
    bonuses: ['📘|Exclusive PDF notes & formula sheets|999', '🎥|Lifetime access to all recordings|1499', '💬|Private doubt-solving community|499'],
    guarantee: ['7-Day Money-Back Guarantee', 'Attend the classes for 7 days. If you don\'t love them, message us and we\'ll refund every rupee — no questions asked.', 7],
    stats: () => ownStats(['students enrolled', 'average rating', 'cities across India', 'see better scores']),
  },
  'Health & Fitness': {
    bump: ['Personal diet chart (PDF)', 149], unit: 'spots', verb: 'joined', who: 'members', icons: ['💪', '🥗', '📅', '🤝'],
    steps: ['Join the programme|Instant access after secure payment', 'Get your personal plan|Diet & routine built for Indian lifestyles', 'Follow with daily support|Live sessions + WhatsApp check-ins', 'See visible results|Track your progress week by week'],
    cmp: ['Doing it alone', ['Crash diets that don\'t last|Sustainable Indian meal plans', 'Random YouTube workouts|Structured, expert-designed routine', 'No accountability|Weekly check-ins with your coach', 'Expensive supplements|Natural, food-first approach', 'Giving up within weeks|A community that keeps you going']],
    bonuses: ['🥗|Healthy Indian recipe e-book|799', '📱|30-day habit tracker|299', '🎧|Guided relaxation audios|499'],
    guarantee: ['100% Satisfaction Guarantee', 'Follow the plan for 7 days. If you\'re not happy with how you feel, we\'ll refund your full payment.', 7],
    stats: () => ownStats(['lives transformed', 'member rating', 'see results in 30 days', 'cities']),
  },
  'Beauty & Wellness': {
    bump: ['Free skincare & care guide', 99], unit: 'units', verb: 'ordered', who: 'customers', icons: ['✨', '🌿', '💧', '💖'],
    steps: ['Order or book in 60 seconds|Secure payment via UPI, card or COD', 'We prepare everything|Expert artists or fresh, quality-checked products', 'Enjoy the experience|Look and feel your absolute best', 'Share your glow|Tell us how it went on WhatsApp'],
    cmp: ['Ordinary options', ['Harsh chemicals|Gentle, skin-safe ingredients', 'Generic, one-size-fits-all|Made for Indian skin & hair', 'Results fade quickly|Long-lasting, visible results', 'Hidden charges|Transparent pricing', 'No support after purchase|Expert guidance on WhatsApp']],
    bonuses: ['🎁|Beauty & care e-guide|299', '💌|Personal consultation call|499', '🛍|Member-only discount on next order|500'],
    guarantee: ['Love It or Your Money Back', 'If you\'re not completely happy, tell us within 7 days for a full refund or a free re-service.', 7],
    stats: () => ownStats(['happy customers', 'average rating', 'reorder or rebook', 'cities served']),
  },
  'Food & Ecommerce': {
    bump: ['Add a premium gift pack', 149], unit: 'units', verb: 'ordered', who: 'customers', icons: ['🌿', '📦', '⭐', '🚚'],
    steps: ['Place your order|Pay via UPI, card or Cash on Delivery', 'Freshly packed for you|Quality-checked and sealed with care', 'Fast delivery|At your doorstep in 3–6 days, anywhere in India', 'Enjoy & reorder|Reorder any time on WhatsApp'],
    cmp: ['Regular market products', ['Preservatives & additives|Natural, honest ingredients', 'Old stock sitting on shelves|Freshly made in small batches', 'Unclear sourcing|Direct from makers & farms', 'No returns|7-day easy returns', 'Plain packaging|Beautiful, gift-ready packing']],
    bonuses: ['🎁|Premium gift wrapping|149', '🚚|Free shipping on this order|99', '🏷|10% OFF coupon for your next order|200'],
    guarantee: ['Taste & Quality Guarantee', 'Not happy with your order? We\'ll replace it or refund you in full within 7 days.', 7],
    stats: () => ownStats(['orders delivered', 'customer rating', 'pincodes served', 'repeat customers']),
  },
  'Finance & Business': {
    bump: ['Ready-to-use templates pack', 299], unit: 'seats', verb: 'registered for', who: 'members', icons: ['📈', '🧠', '🛡️', '💼'],
    steps: ['Register in 2 minutes|Instant confirmation on email & WhatsApp', 'Learn the system|Simple, jargon-free lessons with real examples', 'Apply with support|Live Q&A, templates and checklists', 'Grow with confidence|Join a community of smart Indians'],
    cmp: ['Without a plan', ['Random tips from social media|A proven, structured framework', 'Costly trial and error|Learn from real practitioners', 'Confusing jargon|Simple Hindi/English explanations', 'Alone with your doubts|Live Q&A + community support', 'No accountability|Clear action plan & checklists']],
    bonuses: ['📊|Ready-to-use Excel planner|999', '🎥|Full workshop recordings|1499', '💬|Private community access|999'],
    guarantee: ['Risk-Free 7-Day Guarantee', 'Go through everything for 7 days. If you feel it isn\'t worth it, get a 100% refund.', 7],
    stats: () => ownStats(['members', 'rating', 'live sessions held', 'would recommend']),
  },
  'Real Estate & Local': {
    bump: ['Priority callback + visit', 0], unit: 'slots', verb: 'booked', who: 'families', icons: ['🏆', '📍', '🤝', '🛡️'],
    steps: ['Share your details|Takes less than a minute', 'Get a call from our expert|Within 24 hours, at your convenience', 'Visit or consult in person|Free site visit or consultation', 'Decide with confidence|Transparent pricing, zero pressure'],
    cmp: ['Typical providers', ['Hidden costs and surprises|100% transparent pricing', 'Pushy sales calls|Honest, no-pressure advice', 'Delays and excuses|On-time commitment', 'No after-sales support|Dedicated relationship manager', 'Unverified claims|Verified reviews & credentials']],
    bonuses: ['🚗|Free pickup & drop for your visit|500', '📋|Free expert consultation|1000', '🎁|Exclusive launch-offer benefits|5000'],
    guarantee: ['No-Obligation Promise', 'Your consultation is completely free. No pressure, no spam — just honest, expert advice.', 0],
    stats: () => ownStats(['happy families', 'Google rating', 'years of trust', 'transparent pricing']),
  },
  'Events & Spiritual': {
    bump: ['Recording + e-book bundle', 199], unit: 'seats', verb: 'registered for', who: 'attendees', icons: ['🕉️', '🎤', '📿', '✨'],
    steps: ['Reserve your spot|Instant confirmation on WhatsApp', 'Join live from anywhere|Mobile, laptop or TV', 'Learn & experience|Guided sessions with live Q&A', 'Carry it forward|Recordings and resources included'],
    cmp: ['Ordinary sessions', ['Generic, one-size advice|Personalised guidance', 'Pre-recorded and impersonal|Live and interactive', 'No follow-up|Resources & recordings included', 'Inexperienced hosts|Decades of real experience', 'Rushed sessions|Unhurried, in-depth time']],
    bonuses: ['📖|Exclusive companion e-book|499', '🎧|Session recordings|999', '💬|Community group access|499'],
    guarantee: ['100% Satisfaction Promise', 'If the experience doesn\'t meet your expectations, we\'ll refund you in full.', 7],
    stats: () => ownStats(['attendees', 'rating', 'sessions conducted', 'countries joined']),
  },
  'Services & Tech': {
    bump: ['Priority support (30 days)', 499], unit: 'slots', verb: 'booked', who: 'clients', icons: ['⚡', '🛠️', '📊', '🤝'],
    steps: ['Book in 60 seconds|Choose your slot and pay securely', 'Expert team assigned|Verified, trained professionals', 'Work done right|On time, to the highest standard', 'Ongoing support|We\'re here even after delivery'],
    cmp: ['Typical vendors', ['Missed deadlines|On-time delivery guarantee', 'Unverified workers|Trained & verified professionals', 'Hidden charges|Fixed, transparent pricing', 'No accountability|Written warranty & support', 'Poor communication|Dedicated manager on WhatsApp']],
    bonuses: ['🎁|Free consultation & audit|1999', '🛡|Extended warranty & support|999', '📈|Priority scheduling|499'],
    guarantee: ['Satisfaction Guarantee', 'If you\'re not happy with the work, we\'ll redo it free or refund you — your choice.', 7],
    stats: () => ownStats(['clients served', 'Google rating', 'years experience', 'on-time delivery']),
  },
};

export const GENERIC_QUOTES = [
  'Honestly the best money I have spent this year. Highly recommended!',
  'Very professional and genuine. The results speak for themselves.',
  'I was sceptical at first, but this exceeded every expectation.',
  'Simple, clear and effective. I\'ve already recommended it to friends.',
];

// Rotate a hex colour's hue to build a harmonious second accent.
export function shiftHue(hex, deg) {
  let [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  h = (h * 360 + deg + 360) % 360;
  const f = (n) => {
    const kk = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round((l - a * Math.max(-1, Math.min(kk - 3, 9 - kk, 1))) * 255).toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
}

// Upsell → downsell → cross-sell ladder per category: [name, emoji, bullets]
export const LADDER = {
  Education: { up: ['Personal Mentorship Pack', '👨‍🏫', ['Weekly 1-on-1 mentor calls', 'Personalised study plan', 'Priority doubt-solving']], down: ['Recorded Mentorship Library', '🎥', ['All mentor session recordings', 'Downloadable notes']], cross: [['📚', 'Previous-year papers bank', 'Every paper, solved step by step'], ['🧠', 'Memory & speed-reading course', 'Retain more in less time'], ['📅', 'Personalised study planner', 'A day-by-day plan made for you']] },
  'Health & Fitness': { up: ['1-on-1 Coaching Upgrade', '🏋️', ['Personal coach for 12 weeks', 'Weekly custom diet changes', 'Daily WhatsApp check-ins']], down: ['Recipe & Workout Vault', '🥗', ['200+ healthy Indian recipes', 'Home workout video library']], cross: [['🧘', 'Guided meditation pack', 'Sleep better, stress less'], ['🥤', 'Healthy smoothie e-book', '50 quick Indian-style recipes'], ['📈', 'Progress tracker access', 'See your results week by week']] },
  'Beauty & Wellness': { up: ['Complete Care Kit Upgrade', '💎', ['Full-size premium products', 'Personal beauty consultation', 'Free express delivery']], down: ['Travel-size Mini Kit', '👜', ['Travel-friendly minis', 'Perfect to try more products']], cross: [['🧴', 'Night repair serum', 'Wake up to glowing skin'], ['🌿', 'Herbal face pack', '100% natural ingredients'], ['💆', 'Scalp massage oil', 'Ayurvedic blend for strong hair']] },
  'Food & Ecommerce': { up: ['Family Pack Upgrade (2×)', '🧺', ['Double quantity at 35% less per unit', 'Free premium gift box', 'Priority dispatch']], down: ['Sampler Add-on', '🥄', ['Try 3 new variants', 'Perfect for gifting']], cross: [['🎁', 'Festive gift wrap', 'Ready to gift, with a card'], ['🍯', 'Organic honey jar', 'Raw, unprocessed, 250g'], ['🌶️', 'Signature masala pack', 'Our bestselling spice blend']] },
  'Finance & Business': { up: ['Done-With-You Implementation', '🤝', ['3 live implementation calls', 'Personal review of your plan', 'Private WhatsApp group']], down: ['Templates & Toolkit Pack', '🧰', ['All templates & calculators', 'Lifetime updates']], cross: [['📊', 'Advanced Excel models', 'Plug in your numbers and go'], ['🎓', 'Certification exam', 'Add a certificate to LinkedIn'], ['📞', '30-min expert call', 'Get your questions answered']] },
  'Real Estate & Local': { up: ['Premium Package Upgrade', '⭐', ['Priority scheduling', 'Extra sessions included', 'Dedicated relationship manager']], down: ['Single Add-on Session', '➕', ['One extra session', 'Use anytime within 3 months']], cross: [['🎁', 'Gift voucher for family', 'Share the benefit'], ['📋', 'Extended follow-up plan', '3 months of follow-ups'], ['⚡', 'Priority booking', 'Skip the queue every time']] },
  'Events & Spiritual': { up: ['VIP Pass Upgrade', '👑', ['Private Q&A access', 'Personal follow-up session', 'All recordings for life']], down: ['Recordings-Only Pass', '🎧', ['All session recordings', 'Companion e-book']], cross: [['📖', 'Companion workbook', 'Go deeper after each session'], ['🕯️', 'Guided practice audios', 'Daily 10-minute practices'], ['🎟️', 'Next event early-bird pass', 'Save 40% on the next one']] },
  'Services & Tech': { up: ['Premium Plan Upgrade', '🚀', ['Everything in Standard', 'Priority support for 90 days', 'Monthly performance review']], down: ['Basic Add-on', '🔧', ['One extra deliverable', 'Use within 60 days']], cross: [['🛡️', 'Annual maintenance plan', 'Peace of mind all year'], ['📈', 'Growth audit', 'Find quick wins in 48 hours'], ['⚡', 'Express delivery', 'Get it done 2× faster']] },
};
