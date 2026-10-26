// WhatsApp chatbot and AI agent starting points for each CRM industry kit (crmkits.js). wainbox.js turns each
// entry into three chatbots — a welcome menu, a lead qualifier and a booking flow — and an AI agent preset.
// [Brackets] mark what only the seller knows: a chatbot can't go live until they're filled in.
//   menu:    three answers for the welcome menu: [row title (≤24), the answer]
//   book:    [what a booking is called, the short form for a button (≤13), the question for the day]
//   qualify: [buttons question, 3 buttons (≤20)], [list question, up to 6 options (≤24)], [open question, variable], tag
//   agent:   name, role, knowledge outline, FAQs [q, a], when to hand over
//   keys:    words that start the lead qualifier
export const INDUSTRY = {
  general: {
    keys: ['course', 'program', 'details', 'join'],
    menu: [['About the program', 'Here’s what you get in [program name]: [3–4 key outcomes]. It runs for [duration], fully online.'], ['Price & offers', 'The program is [₹ price]. [Current offer, e.g. ₹500 off till Sunday]. Pay in [EMI / full].'], ['Success stories', 'Here’s what our students say: [testimonial or link to results].']],
    book: ['Discovery call', 'a call', 'Which day works for a quick 15-minute call?'],
    qualify: [['What best describes you?', ['Just starting', 'Some experience', 'Already earning']], ['What’s your main goal?', ['Learn the skill', 'Start earning', 'Grow my business', 'Change careers']], ['What’s holding you back right now?', 'challenge'], 'qualified'],
    agent: { name: 'Asha', role: 'program advisor', knowledge: 'Program: [name]\nWho it’s for: [audience]\nWhat they get: [modules, live calls, community, certificate]\nDuration: [weeks]\nPrice: [₹] — EMI: [yes/no]\nRefund policy: [policy]\nNext batch starts: [date]\nJoin link: [funnel link]', faqs: [['Is it live or recorded?', '[Live sessions on … plus recordings for life]'], ['Do I get a certificate?', '[Yes, after completing …]'], ['Is there EMI?', '[Yes, … months via …]'], ['What if I miss a session?', '[Recordings are available within 24 hours]'], ['Refund?', '[Our refund policy]']], handoff: 'Group or corporate enrolments, fee waivers, and anyone who has paid but can’t access the program.' },
  },
  realestate: {
    keys: ['flat', 'property', 'bhk', 'price', 'project'],
    menu: [['Projects & locations', 'Our projects: [project 1 — location, BHK options], [project 2 — …]. All RERA registered: [RERA no.]'], ['Prices & floor plans', '[1 BHK from ₹… · 2 BHK from ₹… · 3 BHK from ₹…]. Floor plans & brochure: [link]'], ['Home loan help', 'We have tie-ups with [banks] — up to [x]% loan, and our team handles the paperwork.']],
    book: ['Site visit', 'a site visit', 'Which day would you like to visit the site?'],
    qualify: [['Are you looking to…', ['Buy to live', 'Invest', 'Rent']], ['What’s your budget?', ['Under ₹50 lakh', '₹50 lakh – 1 crore', '₹1 – 2 crore', 'Above ₹2 crore']], ['Which configuration and location do you prefer? (e.g. 2 BHK, Wakad)', 'need'], 'property-lead'],
    agent: { name: 'Riya', role: 'property advisor', knowledge: 'Projects: [name — location — BHK — starting price — possession date]\nRERA: [numbers]\nAmenities: [list]\nPayment plans: [construction-linked / subvention]\nHome loans: [banks]\nSite office: [address, timings]\nBrochure: [link]', faqs: [['Is it RERA approved?', '[Yes — RERA no. …]'], ['When is possession?', '[Month year]'], ['Any offer this month?', '[Offer or “ask our team”]'], ['Can I get a home loan?', '[Yes, with …]'], ['Is parking included?', '[Details]']], handoff: 'Price negotiation, unit-specific availability, booking amount and anything legal or about documents.' },
  },
  clinic: {
    keys: ['appointment', 'doctor', 'consult', 'treatment'],
    menu: [['Doctors & timings', '[Dr. name — speciality — OPD days and time]. Emergency: [number].'], ['Treatments & fees', 'Consultation fee: [₹]. Treatments we offer: [list]. Packages: [details].'], ['Clinic location', 'We’re at [address] — [Google Maps link]. Parking: [details].']],
    book: ['Appointment', 'appointment', 'Which day would you like the appointment?'],
    qualify: [['Who is the appointment for?', ['Myself', 'Family member', 'Child']], ['What do you need help with?', ['General check-up', 'A specific concern', 'Follow-up visit', 'Second opinion', 'A procedure']], ['Briefly, what are the symptoms or concern?', 'concern'], 'patient-enquiry'],
    agent: { name: 'Meera', role: 'clinic front desk', knowledge: 'Clinic: [name, address, Maps link]\nDoctors: [name — speciality — days/time]\nConsultation fee: [₹]\nServices: [list]\nInsurance / cashless: [panels]\nEmergency number: [number]', faqs: [['What are the OPD timings?', '[Days and times]'], ['What is the consultation fee?', '[₹]'], ['Do you accept insurance?', '[Details]'], ['Is a prior appointment needed?', '[Walk-ins / appointment only]'], ['Do you do home visits?', '[Yes/no, charges]']], handoff: 'Any medical question, symptoms, reports or emergencies — never give medical advice; and every appointment needs confirming by the team.' },
  },
  consultant: {
    keys: ['services', 'proposal', 'quote', 'pricing'],
    menu: [['Services', 'We help [type of clients] with [services]. Recent work: [client / result].'], ['How we work', '1) Discovery call 2) Proposal in [x] days 3) [Kick-off / delivery]. Typical engagement: [duration].'], ['Pricing', 'Projects usually range from [₹ … to ₹ …] depending on scope. Retainers from [₹ …/month].']],
    book: ['Discovery call', 'a call', 'Which day suits you for a 30-minute discovery call?'],
    qualify: [['What’s your company size?', ['Just me', '2–50 people', '50+ people']], ['What do you need help with?', ['[Service 1]', '[Service 2]', '[Service 3]', 'Not sure yet']], ['What’s your company name and website?', 'company'], 'b2b-lead'],
    agent: { name: 'Arjun', role: 'business development associate', knowledge: 'Company: [name] — [one line]\nServices: [list with what each includes]\nIdeal clients: [industries, size]\nPricing: [ranges]\nCase studies: [links]\nProcess: [steps]', faqs: [['Do you work with startups?', '[Answer]'], ['How long does a project take?', '[Typical timeline]'], ['Can you share case studies?', '[Link]'], ['Do you offer retainers?', '[Details]'], ['Where are you based?', '[City]']], handoff: 'Custom quotes, contracts, NDAs and anyone ready to sign or asking for a proposal.' },
  },
  education: {
    keys: ['course', 'admission', 'batch', 'fees', 'demo'],
    menu: [['Courses & batches', 'Courses: [course — class/exam — batch timings]. New batch starts [date].'], ['Fees & scholarships', 'Fees: [₹ per course/year]. Instalments: [plan]. Scholarship test: [details].'], ['Results & faculty', 'Our results: [toppers / selections]. Faculty: [highlights].']],
    book: ['Demo class', 'a demo class', 'Which day would you like to attend a free demo class?'],
    qualify: [['Who is the course for?', ['Myself', 'My child', 'Someone else']], ['Which class / exam?', ['[Class 9–10]', '[Class 11–12]', '[JEE / NEET]', '[Other course]']], ['Which mode suits you — online, offline, or both? And your city?', 'mode'], 'admission-enquiry'],
    agent: { name: 'Neha', role: 'admissions counsellor', knowledge: 'Institute: [name, centres]\nCourses: [course — eligibility — duration — fees]\nBatches: [timings, start dates]\nModes: [online/offline]\nScholarships: [details]\nResults: [highlights]\nDemo class: free, [days]', faqs: [['Is there a free demo class?', '[Yes — …]'], ['What are the batch timings?', '[Timings]'], ['Can fees be paid in instalments?', '[Plan]'], ['Do you provide study material?', '[Details]'], ['Is there a scholarship?', '[Test / criteria]']], handoff: 'Fee discounts, admission confirmation, refunds and transfers between batches.' },
  },
  fitness: {
    keys: ['membership', 'trial', 'gym', 'salon', 'price'],
    menu: [['Plans & prices', 'Memberships: [monthly ₹ · quarterly ₹ · yearly ₹]. Personal training: [₹]. Services menu: [link].'], ['Timings & location', 'Open [days, hours] at [address] — [Maps link].'], ['Classes & trainers', 'Classes: [yoga, Zumba, HIIT… with times]. Certified trainers: [details].']],
    book: ['Free trial', 'a free trial', 'Which day would you like your free trial session?'],
    qualify: [['What’s your main goal?', ['Lose weight', 'Build strength', 'Stay fit']], ['Which plan interests you?', ['Monthly', 'Quarterly', 'Yearly', 'Personal training', 'Just exploring']], ['Any health condition or injury we should know about?', 'health'], 'membership-lead'],
    agent: { name: 'Kavya', role: 'membership advisor', knowledge: 'Studio: [name, address, timings]\nPlans: [plan — price — what’s included]\nClasses: [schedule]\nTrainers: [details]\nTrial: [free / ₹]\nOffers: [current offer]', faqs: [['Is there a free trial?', '[Details]'], ['Do you have women-only batches?', '[Details]'], ['Can I freeze my membership?', '[Policy]'], ['Is parking available?', '[Details]'], ['Do you offer diet plans?', '[Details]']], handoff: 'Custom packages, discounts beyond the posted offer, membership freezes and refunds.' },
  },
  finance: {
    keys: ['loan', 'insurance', 'invest', 'sip', 'policy'],
    menu: [['Our services', 'We help with [home/personal/business loans, insurance, mutual funds]. [Registration: ARN / IRDAI no.]'], ['Documents needed', 'For a [loan] you’ll usually need: [PAN, Aadhaar, salary slips, bank statements…].'], ['Rates & charges', 'Current rates start from [x]% p.a. Our fee: [none / ₹ …]. Rates depend on your profile.']],
    book: ['Consultation', 'a consult', 'Which day suits you for a free consultation call?'],
    qualify: [['What are you looking for?', ['A loan', 'Insurance', 'Investments']], ['What’s your monthly income?', ['Under ₹30,000', '₹30,000 – 75,000', '₹75,000 – 1.5 lakh', 'Above ₹1.5 lakh']], ['How much do you need (or want to invest), and in which city?', 'need'], 'finance-lead'],
    agent: { name: 'Vikram', role: 'financial advisor’s assistant', knowledge: 'Firm: [name, registration numbers]\nProducts: [loans / insurance / investments we offer]\nPartners: [banks, insurers, AMCs]\nDocuments: [lists per product]\nFees: [details]\nOffice: [address]', faqs: [['What documents do I need for a home loan?', '[List]'], ['How long does approval take?', '[Typical time]'], ['Do you charge a fee?', '[Details]'], ['Can I get a loan with a low CIBIL score?', '[Honest answer]'], ['Which insurance is best for me?', 'That depends on your needs — our advisor will suggest options on a quick call.']], handoff: 'Never recommend a specific product or promise returns or approval — hand over anything about a specific investment, eligibility or a customer’s documents.' },
  },
  interior: {
    keys: ['interior', 'design', 'kitchen', 'quote', 'renovation'],
    menu: [['Our work', 'See our recent homes: [portfolio link]. We do [modular kitchens, wardrobes, full home interiors].'], ['Packages & pricing', '[2 BHK from ₹… · 3 BHK from ₹…]. Design fee: [₹ or % / adjusted in project].'], ['Process & timeline', '1) Site measurement 2) Design & 3D 3) Execution in [x] weeks. [Warranty: x years].']],
    book: ['Site measurement', 'a site visit', 'Which day can our designer visit for measurements?'],
    qualify: [['What do you need?', ['Full home', 'Kitchen / wardrobes', 'Renovation']], ['What type of home?', ['1 BHK', '2 BHK', '3 BHK', 'Villa / bungalow', 'Office / shop']], ['Your budget range and the site location?', 'budget'], 'interior-lead'],
    agent: { name: 'Isha', role: 'design consultant', knowledge: 'Studio: [name, city, experience]\nServices: [list]\nPackages: [package — price — what’s included]\nMaterials & brands: [list]\nTimeline: [weeks]\nWarranty: [years]\nPortfolio: [link]', faqs: [['Do you provide 3D designs?', '[Yes — …]'], ['How long does a 2 BHK take?', '[Weeks]'], ['Is there a warranty?', '[Details]'], ['Can I pay in stages?', '[Payment schedule]'], ['Do you work outside the city?', '[Areas]']], handoff: 'Exact quotes, design changes, payments and any issue with an ongoing project.' },
  },
  events: {
    keys: ['wedding', 'event', 'package', 'shoot', 'date'],
    menu: [['Packages', '[Package 1 — ₹ — what’s included], [Package 2 — …]. Portfolio: [link].'], ['Check a date', 'Tell us your event date and city, and we’ll check availability right away.'], ['Our work', 'Recent weddings & events: [Instagram / portfolio link].']],
    book: ['Planning call', 'a call', 'Which day suits you for a planning call?'],
    qualify: [['What’s the occasion?', ['Wedding', 'Pre-wedding', 'Other event']], ['How many guests?', ['Under 100', '100 – 300', '300 – 700', '700+']], ['What’s the date and city of the event?', 'date'], 'event-lead'],
    agent: { name: 'Tara', role: 'event coordinator', knowledge: 'Business: [name, city]\nServices: [planning / décor / photography / video]\nPackages: [name — ₹ — includes]\nTravel: [cities, travel charges]\nBooking: [advance %]\nPortfolio: [link]', faqs: [['Are you available on my date?', 'Let me check — please share the date and city.'], ['What is the advance to book?', '[x]%'], ['Do you travel for destination weddings?', '[Details]'], ['When do we get the photos?', '[Delivery time]'], ['Can packages be customised?', '[Yes — …]']], handoff: 'Date confirmations, custom quotes, advance payments and changes to a booked event.' },
  },
  travel: {
    keys: ['trip', 'tour', 'package', 'holiday', 'visa'],
    menu: [['Popular packages', '[Destination — nights — ₹ per person], [Destination — …]. All packages: [link].'], ['Visa & tickets', 'We handle [visas for …, flights, hotels]. Visa fees and processing time: [details].'], ['Group & honeymoon trips', '[Fixed departures on …] · [Honeymoon specials from ₹…].']],
    book: ['Trip planning call', 'a call', 'Which day suits you for a quick trip-planning call?'],
    qualify: [['What kind of trip?', ['Family', 'Honeymoon', 'Friends / group']], ['Where would you like to go?', ['Within India', 'South-East Asia', 'Dubai / Middle East', 'Europe', 'Not decided']], ['When are you travelling, and how many people?', 'dates'], 'trip-lead'],
    agent: { name: 'Zoya', role: 'travel consultant', knowledge: 'Agency: [name, city, IATA / registration]\nPackages: [destination — nights — price — inclusions]\nVisa services: [countries, fees, time]\nPayment: [advance, EMI]\nCancellation: [policy]', faqs: [['Is the price per person?', '[Yes — on twin sharing]'], ['What’s included?', '[Flights, hotels, transfers, sightseeing…]'], ['Can you customise the itinerary?', '[Yes]'], ['Is there EMI?', '[Details]'], ['What’s the cancellation policy?', '[Policy]']], handoff: 'Final quotes, bookings, payments, visa documents and changes to a booked trip.' },
  },
  auto: {
    keys: ['car', 'bike', 'test drive', 'price', 'emi'],
    menu: [['Models & prices', '[Model — variants — ex-showroom ₹], [Model — …]. Brochure: [link].'], ['Finance & exchange', 'Easy EMI from [₹ …/month] with [banks]. Exchange bonus up to [₹ …].'], ['Offers this month', '[Cash discount · corporate offer · accessories] — valid till [date].']],
    book: ['Test drive', 'a test drive', 'Which day would you like your test drive?'],
    qualify: [['Which model interests you?', ['[Model 1]', '[Model 2]', 'Not sure yet']], ['When are you planning to buy?', ['This week', 'This month', 'In 1–3 months', 'Just researching']], ['Would you like to exchange your current vehicle? Which one?', 'exchange'], 'vehicle-lead'],
    agent: { name: 'Rohan', role: 'sales consultant', knowledge: 'Dealership: [name, address, timings]\nModels: [model — variants — prices — fuel]\nFinance: [banks, rates]\nExchange: [details]\nOffers: [current]\nService centre: [address]', faqs: [['What is the on-road price?', '[Our team will share the exact on-road price for your city]'], ['What’s the waiting period?', '[Weeks per model]'], ['Do you take exchange?', '[Yes — …]'], ['Can I get a home test drive?', '[Details]'], ['What colours are available?', '[Colours]']], handoff: 'On-road quotes, discounts, bookings and anything about a delivery or service.' },
  },
  professional: {
    keys: ['gst', 'itr', 'legal', 'tax', 'registration'],
    menu: [['Services & fees', '[ITR filing — ₹ · GST registration — ₹ · company registration — ₹ · …]'], ['Documents needed', 'For [ITR]: [PAN, Form 16, bank statements…]. For [GST]: [list].'], ['Deadlines', 'Coming up: [ITR — 31 July · GST returns — 11th/20th monthly · …].']],
    book: ['Consultation', 'a consult', 'Which day suits you for a consultation?'],
    qualify: [['Is this for…', ['Me (individual)', 'My business', 'My company']], ['What do you need?', ['Tax filing', 'GST', 'Registration', 'Legal matter', 'Audit / compliance']], ['Briefly describe what you need help with', 'matter'], 'client-enquiry'],
    agent: { name: 'Priya', role: 'client desk', knowledge: 'Firm: [name, city, partners]\nServices: [service — fee]\nDocuments: [per service]\nTurnaround: [days]\nOffice: [address, hours]', faqs: [['How much for ITR filing?', '[₹]'], ['How long does GST registration take?', '[Days]'], ['Can you do it online?', '[Yes — …]'], ['What documents are needed?', '[List]'], ['Do you handle notices?', '[Details]']], handoff: 'Never give tax or legal advice on a specific case — hand over anything about notices, disputes, or a client’s own filing.' },
  },
  recruitment: {
    keys: ['job', 'hiring', 'vacancy', 'resume', 'candidate'],
    menu: [['Open jobs', 'Current openings: [role — location — experience — CTC]. All jobs: [link].'], ['For employers', 'We hire for [roles / industries] in [cities]. Fee: [x% of CTC / per hire].'], ['How it works', 'Share your resume → screening call → interviews with the company → offer. We never charge candidates.']],
    book: ['Screening call', 'a call', 'Which day suits you for a short screening call?'],
    qualify: [['Are you…', ['Looking for a job', 'Hiring people']], ['Experience?', ['Fresher', '1–3 years', '3–7 years', '7+ years']], ['Which role and city? (You can also send your resume here)', 'role'], 'recruitment-lead'],
    agent: { name: 'Anika', role: 'recruitment coordinator', knowledge: 'Agency: [name, cities]\nOpen roles: [role — location — experience — CTC]\nIndustries: [list]\nFor employers: [fee, replacement guarantee]\nCandidates are never charged.', faqs: [['Do you charge candidates?', 'Never — our services are free for candidates.'], ['Which cities do you hire in?', '[Cities]'], ['How do I apply?', 'Send your resume here and the role you want.'], ['How long does hiring take?', '[Typical time]'], ['What’s your fee for employers?', '[Fee]']], handoff: 'Employer fee negotiations, offer letters and interview scheduling with a company.' },
  },
  homeservices: {
    keys: ['solar', 'repair', 'service', 'installation', 'quote'],
    menu: [['Services & prices', '[Service — starting price], [Service — …]. Free inspection in [areas].'], ['Areas we cover', 'We serve [areas / pin codes]. Visits [days, times].'], ['Warranty & AMC', '[Warranty on parts/labour]. AMC: [₹ per year, what’s included].']],
    book: ['Site survey', 'a site visit', 'Which day can our technician visit?'],
    qualify: [['What do you need?', ['New installation', 'Repair / service', 'AMC']], ['Property type?', ['Apartment', 'Independent house', 'Shop / office', 'Factory']], ['Your area / pin code and a short description of the job?', 'job'], 'service-lead'],
    agent: { name: 'Sameer', role: 'service desk', knowledge: 'Business: [name, areas]\nServices: [service — price]\nVisit charges: [₹]\nWarranty: [details]\nAMC: [plans]\nSubsidies (solar): [details]', faqs: [['Is the inspection free?', '[Details]'], ['How soon can you come?', '[Same day / next day]'], ['Do you give a warranty?', '[Details]'], ['Do you cover my area?', 'Please share your pin code and I’ll check.'], ['What payment modes?', '[UPI, cash, card]']], handoff: 'Final quotes after inspection, complaints about a job, and payments.' },
  },
  hospitality: {
    keys: ['room', 'booking', 'table', 'menu', 'stay'],
    menu: [['Rooms & rates', '[Room type — ₹ per night — what’s included]. Check-in [time], check-out [time].'], ['Menu & dining', 'Our menu: [link]. Restaurant open [hours]. Table booking: just reply here.'], ['Location & directions', '[Address] — [Maps link]. [Distance from station / airport].']],
    book: ['Booking', 'a booking', 'For which date would you like to book?'],
    qualify: [['What would you like to book?', ['A room', 'A table', 'An event / party']], ['How many guests?', ['1–2', '3–5', '6–15', '15+']], ['Your dates (and any special request)?', 'dates'], 'booking-enquiry'],
    agent: { name: 'Ira', role: 'guest relations', knowledge: 'Property: [name, address, Maps link]\nRooms: [type — rate — inclusions]\nRestaurant: [cuisine, hours, menu link]\nPolicies: [check-in/out, ID, pets, cancellation]\nEvents: [capacity, packages]', faqs: [['Is breakfast included?', '[Details]'], ['What are check-in and check-out times?', '[Times]'], ['Do you allow pets?', '[Policy]'], ['Is parking available?', '[Details]'], ['What’s the cancellation policy?', '[Policy]']], handoff: 'Confirming availability and bookings, group rates, payments and complaints.' },
  },
  store: {
    keys: ['order', 'price', 'cod', 'delivery', 'stock'],
    menu: [['Shop & offers', 'Shop our bestsellers: [store link]. Offer: [code / discount].'], ['Delivery & COD', 'We deliver across [India] in [x–y] days. COD: [available / ₹ charge]. Free shipping above [₹].'], ['Returns & exchange', '[x]-day easy returns: [how to request].']],
    book: ['Order help', 'help', 'Which day suits you for a call from our team?'],
    qualify: [['How can we help?', ['Buy a product', 'Track my order', 'Return / exchange']], ['What are you shopping for?', ['[Category 1]', '[Category 2]', '[Category 3]', 'Gift', 'Something else']], ['Your order number (if you have one) or the product name?', 'order'], 'shopper'],
    agent: { name: 'Diya', role: 'store assistant', knowledge: 'Store: [name, website]\nBestsellers: [product — price — link]\nShipping: [areas, days, charges]\nCOD: [details]\nReturns: [policy]\nOffers: [codes]', faqs: [['Is COD available?', '[Details]'], ['How long does delivery take?', '[Days]'], ['How do I return a product?', '[Steps]'], ['Do you have a discount code?', '[Code]'], ['Is this in stock?', 'Please send the product name — I’ll check.']], handoff: 'Order tracking problems, refunds, damaged products and bulk / wholesale orders.' },
  },
  abroad: {
    keys: ['study abroad', 'visa', 'ielts', 'university', 'admission'],
    menu: [['Countries & universities', 'We help with [UK, Canada, Australia, USA, Germany…] — [x]+ partner universities.'], ['IELTS / PTE coaching', '[Batches, fees, mock tests].'], ['Costs & scholarships', 'Typical costs: [tuition + living per country]. Scholarships: [details].']],
    book: ['Counselling session', 'counselling', 'Which day suits you for a free counselling session?'],
    qualify: [['Which country?', ['UK / Ireland', 'Canada', 'Other']], ['What do you want to study?', ['Bachelor’s', 'Master’s', 'Diploma', 'PhD', 'Not sure']], ['Your last qualification, score, and English test (if any)?', 'profile'], 'abroad-lead'],
    agent: { name: 'Sana', role: 'study-abroad counsellor', knowledge: 'Company: [name, branches]\nCountries: [list]\nServices: [counselling, applications, SOP, visa, loans]\nFees: [details]\nIELTS/PTE: [coaching details]\nSuccess: [numbers]', faqs: [['Is counselling free?', '[Details]'], ['What IELTS score do I need?', 'It depends on the course and university — usually [range].'], ['Can you help with an education loan?', '[Details]'], ['How long does the visa take?', '[Typical time per country]'], ['What are your charges?', '[Fees]']], handoff: 'Profile evaluation, visa refusals, application status and fees.' },
  },
  wellness: {
    keys: ['session', 'therapy', 'diet', 'consult', 'healing'],
    menu: [['Programs', '[Program — duration — ₹], [Program — …]. Online and in-person.'], ['How it works', '1) Free discovery call 2) Personal plan 3) [Weekly sessions / check-ins].'], ['Results', 'What clients say: [testimonials / before-after with consent].']],
    book: ['Consultation', 'a consult', 'Which day suits you for a consultation?'],
    qualify: [['What would you like help with?', ['Weight / diet', 'Stress / sleep', 'Something else']], ['Preferred format?', ['Online', 'In person', 'Either']], ['Tell us a little about your goal', 'goal'], 'wellness-lead'],
    agent: { name: 'Anya', role: 'wellness coordinator', knowledge: 'Practice: [name, practitioner, credentials]\nPrograms: [name — duration — price]\nFormats: [online / in-person, address]\nPolicies: [rescheduling, refunds]', faqs: [['Are sessions online?', '[Details]'], ['How many sessions will I need?', 'It varies — the first consultation gives you a plan.'], ['What does it cost?', '[Prices]'], ['Is it confidential?', 'Yes, always.'], ['Can I reschedule?', '[Policy]']], handoff: 'Any health or mental-health question, medication, or someone in distress — hand over immediately and be kind.' },
  },
  saas: {
    keys: ['demo', 'pricing', 'trial', 'features', 'integration'],
    menu: [['What it does', '[Product] helps [audience] [main outcome]. Key features: [3–4].'], ['Pricing & plans', '[Plan — ₹/month — limits]. Free trial: [days]. See all: [pricing link].'], ['Integrations', 'Works with [tools]. API & webhooks: [docs link].']],
    book: ['Product demo', 'a demo', 'Which day suits you for a live demo?'],
    qualify: [['Team size?', ['Just me', '2–20', '20+']], ['What are you using today?', ['Excel / sheets', '[Competitor A]', '[Competitor B]', 'Nothing yet']], ['What’s the main problem you want to solve?', 'problem'], 'saas-lead'],
    agent: { name: 'Kiara', role: 'product specialist', knowledge: 'Product: [name — one line]\nFeatures: [list]\nPlans: [plan — price — limits]\nTrial: [days, card needed?]\nIntegrations: [list]\nSecurity: [data location, compliance]\nSupport: [hours, channels]', faqs: [['Is there a free trial?', '[Details]'], ['Can I import my data?', '[Details]'], ['Is my data safe?', '[Details]'], ['Do you offer annual discounts?', '[Details]'], ['Is there a mobile app?', '[Details]']], handoff: 'Custom pricing, enterprise needs, security questionnaires and billing issues.' },
  },
  ngo: {
    keys: ['donate', 'volunteer', '80g', 'cause', 'help'],
    menu: [['Our work', 'We [mission] in [areas]. Impact so far: [numbers].'], ['Donate', 'Donate securely: [link]. All donations get [80G] tax benefit. Monthly giving: [link].'], ['Volunteer', 'Volunteer with us: [roles, time needed, sign-up link].']],
    book: ['Call with our team', 'a call', 'Which day suits you for a call with our team?'],
    qualify: [['How would you like to help?', ['Donate', 'Volunteer', 'Partner / CSR']], ['Which cause matters most to you?', ['[Cause 1]', '[Cause 2]', '[Cause 3]', 'Wherever it’s needed']], ['Anything you’d like us to know?', 'note'], 'supporter'],
    agent: { name: 'Asha', role: 'supporter care', knowledge: 'Organisation: [name, registration, 80G / 12A / FCRA]\nMission: [one line]\nPrograms: [list]\nImpact: [numbers]\nDonate: [link, UPI]\nVolunteer: [roles, link]', faqs: [['Is my donation tax-exempt?', '[Yes — 80G …]'], ['How do I get my receipt?', '[Details]'], ['Can I donate monthly?', '[Link]'], ['Can I visit a project?', '[Details]'], ['Do you accept foreign donations?', '[FCRA details]']], handoff: 'CSR partnerships, large gifts, receipt problems and media enquiries.' },
  },
};
// the CRM kits also include these (crmkits.js names): any kit without an entry uses "general"
export const industryOf = (id) => INDUSTRY[id] || INDUSTRY.general;
