// Campaign templates: real estate, interiors, home services & solar, auto dealers, events — format in ../campaigntpl.js
const STOP = 'Reply STOP to opt out';

export default {
  // ───────────────────────────── Real estate: builders & brokers ─────────────────────────────
  realestate: [
    {
      id: 'realestate-portal-lead', name: 'Portal lead follow-up', goal: 'Book a site visit',
      when: 'Within 15 minutes of a 99acres / MagicBricks / Housing.com enquiry',
      audience: { type: 'leads', tags: ['99acres', 'magicbricks', 'housing'] },
      email: {
        subject: '{{first_name}}, the details of [project name] you asked about',
        body: 'Hi {{first_name}},\n\nThank you for your enquiry about [project name]. I know you are probably looking at five other projects right now, so I will keep this short and useful.\n\nHere is what most buyers want to know first: the exact location, the carpet area of each unit, the all-inclusive price and the possession date. I have put all of it, with the floor plans and the RERA registration ([RERA number]), on one page for you: [link]\n\nBut honestly, photos and brochures only tell half the story. The light in the bedroom, the view from the balcony, the road to the nearest school and metro, the quality of the sample flat — you can judge these only by standing there.\n\nSo here is my suggestion: come for a 45-minute site visit this weekend. Bring your family. We will walk you through the sample flat, the amenities and the construction progress, and answer every question about price and payment plans. No pressure to book anything.\n\nJust reply to this email with a day and time that suits you, and I will confirm your slot.\n\nWarm regards,\n{{business}}',
      },
      whatsapp: {
        name: 're_portal_lead', category: 'MARKETING',
        body: 'Hi {{1}}, thank you for your enquiry about {{2}}! 🏠\n\nFloor plans, price list and RERA details are ready to share. But nothing beats seeing the sample flat and the location yourself.\n\nWould you like to visit the site this weekend? Reply with a day that suits you and we will keep a slot for your family.',
        vars: [{ key: 'first_name', example: 'Rohit' }, { fill: 'Project name', example: 'Skyline Heights, Wakad' }],
        footer: STOP,
      },
      call: {
        goal: 'Book a site visit',
        opening: 'Namaste {{customer_name}}, main {{business_name}} se baat kar rahi hoon. You had enquired about {{project_name}} on a property portal — is this a good time for two minutes?',
        script: [
          'Thank you for your interest. I just want to understand what you are looking for, so I share only the right options.',
          '{{project_name}} is RERA registered, and I can send the floor plans and the price list on WhatsApp right after this call.',
          'Most families decide only after seeing the sample flat and the location, so we arrange site visits on weekdays and weekends with a dedicated person to show you around.',
          'The visit takes about 45 minutes and there is no obligation to book.',
        ],
        questions: [
          'Are you looking for a 2 BHK or a 3 BHK?',
          'What budget range are you considering, roughly?',
          'Is this for your own use or as an investment?',
          'By when are you planning to buy — in the next three months, or later?',
        ],
        objections: [
          { said: 'Just browsing for now', reply: 'Bilkul, that is how everyone starts. A site visit is actually the fastest way to compare — even if you do not choose us, you will know what to look for in other projects. Shall I keep a slot for Sunday morning?' },
          { said: 'Price is too high', reply: 'I understand. Let me share the all-inclusive price for the exact unit you like and the payment plan options — many buyers find the monthly outgo is easier than they expected. The visit will also show you why the pricing is what it is.' },
          { said: 'I will discuss with my family first', reply: 'Of course, this is a family decision. Why not bring them along for the visit? Everyone can see the flat together and ask their questions directly. Which day works for all of you?' },
        ],
        closing: 'Wonderful, I have noted your site visit. You will get the location pin and a confirmation on WhatsApp shortly. Thank you, {{customer_name}}, see you at the site!',
        outcomes: ['booked_visit', 'interested', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'project_name'],
      },
    },
    {
      id: 'realestate-visit-reminder', name: 'Site visit reminder', goal: 'Make sure the booked site visit happens',
      when: 'The day before a booked site visit',
      audience: { type: 'leads', tags: ['site-visit-booked'] },
      email: {
        subject: 'Your site visit to [project name] is confirmed, {{first_name}}',
        body: 'Hi {{first_name}},\n\nThis is a quick reminder of your site visit to [project name] on [visit date and time].\n\nSite address: [site address]\n\nWhen you reach the gate, just mention your name at the sales lounge and our team will take it from there. The visit usually takes 45 minutes to an hour, which includes the sample flat, the amenities and a look at the construction.\n\nA few things that may help:\n\nBring the family members who will be part of the decision, so everyone sees the home together.\n\nKeep a list of questions handy — about carpet area, parking, maintenance, possession, loans. No question is too small.\n\nIf you would like to check loan eligibility on the spot, carry a recent salary slip or ITR. It is optional.\n\nIf your plans change, simply reply to this email and we will move the visit to a time that suits you.\n\nSee you soon,\n{{business}}',
      },
      whatsapp: {
        name: 're_site_visit_reminder', category: 'UTILITY',
        body: 'Hi {{1}}, this is a reminder of your site visit on {{2}}.\n\nAddress: {{3}}. Please share your name at the sales lounge when you arrive.\n\nIf you need to change the time, just reply to this message.',
        vars: [{ key: 'first_name', example: 'Rohit' }, { fill: 'Site visit date and time', example: 'Sun, 14 Oct at 11 am' }, { fill: 'Site address', example: 'Skyline Heights, near Wakad Bridge, Pune' }],
      },
      call: {
        goal: 'Confirm the booked site visit',
        opening: 'Hello {{customer_name}}, this is {{business_name}}. I am calling to confirm your site visit for {{visit_time}}.',
        script: [
          'We have kept a slot for you and someone from our team will be waiting at the sales lounge.',
          'I will send the location pin on WhatsApp so you can navigate directly.',
          'If you are coming with family, let me know how many people, so we arrange seating and refreshments.',
        ],
        questions: [
          'Is the time still convenient for you?',
          'How many people will be coming along?',
          'Would you like us to arrange a home loan executive during the visit?',
        ],
        objections: [
          { said: 'Something came up, I cannot come', reply: 'No problem at all. Shall we move it to the same time on another day this week, or would the weekend be easier?' },
          { said: 'I have already seen enough online', reply: 'Online gives you the plans, but the sample flat, the light and the neighbourhood you can judge only in person. It is just 45 minutes — shall I keep the slot?' },
        ],
        closing: 'Perfect, your visit is confirmed. The location pin is coming on WhatsApp. See you there, {{customer_name}}!',
        outcomes: ['confirmed', 'rescheduled', 'cancelled', 'callback', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'visit_time'],
      },
    },
    {
      id: 'realestate-post-visit', name: 'Post site visit follow-up', goal: 'Move a visitor to booking',
      when: 'The evening after a site visit',
      audience: { type: 'leads', tags: ['site-visited'] },
      email: {
        subject: '{{first_name}}, thank you for visiting [project name]',
        body: 'Hi {{first_name}},\n\nThank you for taking the time to visit [project name] today. I hope the family liked what they saw.\n\nAfter a visit, most buyers have two or three questions that come up on the drive home — about the exact unit, the final price, or the payment schedule. That is completely normal, and I would rather you ask them now than wonder later.\n\nTo make your decision easier, I have put together the cost sheet for the unit you liked, the payment plan and the RERA details ([RERA number]) here: [link]\n\nA small note: good units on preferred floors and facings are usually the first to go. I am not saying this to rush you — just so that, if you liked a particular flat, you can ask me to hold it while you decide.\n\nReply to this email or call me directly, and I will answer every question honestly. If you would like a second visit with other family members, I will arrange that too.\n\nWarm regards,\n{{business}}',
      },
      whatsapp: {
        name: 're_post_visit_followup', category: 'MARKETING',
        body: 'Hi {{1}}, thank you for visiting {{2}} today! 🙏\n\nI hope the family liked the home. If any questions came up on the way back — price, floor, payment plan, possession — just ask me here.\n\nI can also share the cost sheet for the unit you liked. Shall I send it?',
        vars: [{ key: 'first_name', example: 'Rohit' }, { fill: 'Project name', example: 'Skyline Heights' }],
        footer: STOP,
      },
      call: {
        goal: 'Get feedback on the visit and move to booking',
        opening: 'Namaste {{customer_name}}, {{business_name}} se bol raha hoon. Thank you for visiting {{project_name}}. How did you and your family find it?',
        script: [
          'I wanted to personally check if all your questions were answered.',
          'If you liked a particular unit, I can share its exact cost sheet and the payment plan on WhatsApp today.',
          'If you want, we can hold that unit for a short time while your family decides, so you do not lose it.',
        ],
        questions: [
          'Which unit or floor did you like the most?',
          'Is the price in line with your budget, or should we look at other options?',
          'Is anyone else in the family who should see the flat before you decide?',
          'Will you be taking a home loan?',
        ],
        objections: [
          { said: 'We are still comparing other projects', reply: 'That is the right thing to do. Can I share a simple comparison — carpet area, all-inclusive price, possession date and RERA status? It makes the decision very clear.' },
          { said: 'Price is a bit high for us', reply: 'Let me check what flexibility we have on the payment plan or a different floor in the same tower. Would a lower EMI or a staggered plan help?' },
          { said: 'We will discuss at home and get back', reply: 'Of course. Shall I call you back on Saturday after your family has talked it over? Meanwhile I will send the cost sheet so you have everything in front of you.' },
        ],
        closing: 'Thank you, {{customer_name}}. I am sending the cost sheet now and will call you as agreed. Please message me anytime.',
        outcomes: ['ready_to_book', 'interested', 'second_visit', 'callback', 'not_interested'],
        variables: ['customer_name', 'business_name', 'project_name'],
      },
    },
    {
      id: 'realestate-new-launch', name: 'New launch / pre-launch EOI', goal: 'Collect expressions of interest before launch',
      when: '2–3 weeks before a new project or tower launch',
      audience: { type: 'all', tags: ['investor', 'site-visited'] },
      email: {
        subject: '{{first_name}}, early access to [project name] before public launch',
        body: 'Hi {{first_name}},\n\nWe are launching [project name], and before it opens to the public we are giving our past enquirers and customers the first look.\n\nWhy early access matters: at launch, you get the widest choice of floors, facings and views. Once the public launch begins, the best units tend to go first.\n\nThe project is registered under RERA ([RERA number]). Full location details, configurations and launch pricing are on this page: [link]\n\nHow the Expression of Interest (EOI) works: you register your interest with a fully refundable amount. That gives you priority in unit selection on launch day. If you change your mind, the amount is refunded as per the terms on the page.\n\nThere is no obligation to buy. It simply puts you at the front of the queue.\n\nIf you would like a walkthrough of the plans before deciding, reply to this email and our team will call you at a time you choose.\n\nWarm regards,\n{{business}}',
      },
      whatsapp: {
        name: 're_new_launch_eoi', category: 'MARKETING',
        body: 'Hi {{1}}, we are launching {{2}} soon, and you get early access before the public launch. ✨\n\nRegistering your interest (EOI) gives you priority in choosing your floor and facing on launch day. The EOI amount is refundable as per terms.\n\nWould you like the plans and launch details? Reply YES and we will share them.',
        vars: [{ key: 'first_name', example: 'Neha' }, { fill: 'Project name', example: 'Green Vista, Sector 150' }],
        footer: STOP,
      },
      call: {
        goal: 'Register an Expression of Interest for the launch',
        opening: 'Hello {{customer_name}}, main {{business_name}} se call kar rahi hoon. You had shown interest in our projects earlier, so I wanted to tell you first about our new launch, {{project_name}}.',
        script: [
          'Before the public launch, we are giving existing contacts priority access.',
          'With a refundable Expression of Interest, you get priority when units are allotted on launch day — so better choice of floor and view.',
          'The project is RERA registered, and I can share the plans and launch price on WhatsApp.',
          'If you would like, our team can walk you through the plans on a video call or at our office.',
        ],
        questions: [
          'Are you looking for a home for yourself or as an investment?',
          'Which configuration interests you — 2, 3 or 4 BHK?',
          'What budget are you comfortable with?',
        ],
        objections: [
          { said: 'Under-construction is risky', reply: 'That is a fair concern. The project is RERA registered, so the timelines and money flow are tracked. I can also show you our past projects and their delivery record.' },
          { said: 'I will wait for the launch price', reply: 'Sure. The EOI does not lock you in — it only gives you priority to choose. If the price does not suit you, the amount is refunded as per terms.' },
          { said: 'Not looking right now', reply: 'No problem at all. Can I just send you the plans on WhatsApp, so you have them if your plans change?' },
        ],
        closing: 'Thank you, {{customer_name}}. I am sending the details on WhatsApp now. Our team will help you complete the EOI whenever you are ready.',
        outcomes: ['eoi_interested', 'send_details', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'project_name'],
      },
    },
    {
      id: 'realestate-festive-offer', name: 'Festive booking offer', goal: 'Get bookings on an auspicious festival',
      when: '10 days before Navratri, Dhanteras/Diwali, Gudi Padwa or Akshaya Tritiya',
      audience: { type: 'leads', tags: ['site-visited', 'interested'] },
      email: {
        subject: '{{first_name}}, book your home this [festival name]',
        body: 'Hi {{first_name}},\n\nFor many families, buying a home on an auspicious day is a tradition — the start of something new, blessed by the season.\n\nThis [festival name], we have a special offer for homes booked at [project name]: [festive offer]. It is valid only for bookings made between now and the festival.\n\nIf you have already visited the project, this is a good moment to finalise. If you have not, we are open every day, including the festival weekend, and our team will be there to show you around.\n\nThe project is RERA registered ([RERA number]), and our home loan partners can help you check eligibility on the same day.\n\nWould you like us to hold a unit for you, or arrange a visit with your family? Just reply to this email, and we will take care of the rest.\n\nWishing you and your family a very happy festive season.\n\nWarm regards,\n{{business}}',
      },
      whatsapp: {
        name: 're_festive_booking_offer', category: 'MARKETING',
        body: 'Hi {{1}}, this festive season, bring home happiness! 🪔\n\nBook your home at {{2}} before the festival and get {{3}}.\n\nOur site is open all week, including the festival weekend. Would you like to visit with your family or hold a unit? Just reply here.',
        vars: [{ key: 'first_name', example: 'Amit' }, { fill: 'Project name', example: 'Skyline Heights' }, { fill: 'Festive offer', example: 'free modular kitchen and zero floor-rise charges' }],
        footer: STOP,
      },
      call: {
        goal: 'Convert a warm lead with the festive offer',
        opening: 'Namaste {{customer_name}}, {{business_name}} se baat kar raha hoon. Festival ki advance shubhkamnayein! I am calling about a festive offer at {{project_name}}.',
        script: [
          'Many families like to book their home on an auspicious day, so we have a special offer this season: {{festive_offer}}.',
          'The offer is valid only for bookings made before the festival.',
          'If you liked a unit during your visit, I can hold it for you today while you complete the paperwork.',
        ],
        questions: [
          'Did you and your family like any particular unit?',
          'Would you like to book on the festival day itself, or before?',
          'Shall I arrange our home loan partner to check your eligibility?',
        ],
        objections: [
          { said: 'Price is still high', reply: 'I understand. With the festive offer, the effective cost is lower than before. Let me send you the revised cost sheet so you can compare.' },
          { said: 'Will discuss with family', reply: 'Of course. Why not visit together this weekend? The offer is still valid and everyone can see the home before deciding.' },
          { said: 'We will buy after the festival', reply: 'That is fine, but the offer ends with the festival. If you hold the unit now, you keep the benefit and can complete the booking calmly.' },
        ],
        closing: 'Thank you, {{customer_name}}. I am sending the offer details on WhatsApp. Happy festivities to your family!',
        outcomes: ['ready_to_book', 'booked_visit', 'interested', 'callback', 'not_interested'],
        variables: ['customer_name', 'business_name', 'project_name', 'festive_offer'],
      },
    },
    {
      id: 'realestate-last-units', name: 'Price revision / last units alert', goal: 'Close fence-sitters before a price change',
      when: 'One week before a price revision or when few units remain',
      audience: { type: 'leads', tags: ['site-visited', 'interested'] },
      email: {
        subject: '{{first_name}}, prices at [project name] change on [revision date]',
        body: 'Hi {{first_name}},\n\nI wanted to let you know before it happens: prices at [project name] are being revised on [revision date].\n\nYou had shown interest in the project, so I did not want you to find out after the change. Any booking made before that date stays at the current price.\n\nThis is not a sales trick — prices in under-construction projects are usually revised as construction moves ahead, and this is one of those stages. You can check the project status on RERA ([RERA number]).\n\nIf you were already close to deciding, this is the right time to act. If you still have questions about the unit, payment plan or loan, I would be happy to answer them today.\n\nTwo simple options:\n\n1. Reply to this email and I will call you to discuss.\n2. Visit the site once more with family before the revision date.\n\nWarm regards,\n{{business}}',
      },
      whatsapp: {
        name: 're_last_units_alert', category: 'MARKETING',
        body: 'Hi {{1}}, a quick heads-up: prices at {{2}} are being revised from {{3}}.\n\nBookings made before that date stay at the current price. If you were planning to decide, this is a good time.\n\nWould you like the current cost sheet or a quick call? Just reply here.',
        vars: [{ key: 'first_name', example: 'Priya' }, { fill: 'Project name', example: 'Skyline Heights' }, { fill: 'Revision date', example: '1 November' }],
        footer: STOP,
      },
      call: {
        goal: 'Get a booking before the price revision',
        opening: 'Hello {{customer_name}}, this is {{business_name}}. I am calling with an important update about {{project_name}}.',
        script: [
          'Prices are being revised from {{revision_date}}, and I wanted you to know before it happens.',
          'If you book before that date, you keep the current price.',
          'I can send you the latest cost sheet and help hold a unit today.',
        ],
        questions: [
          'Are you still considering the unit you liked?',
          'Is your home loan approval in progress?',
          'Would you like to visit once more before the revision date?',
        ],
        objections: [
          { said: 'Is this just a sales pressure tactic?', reply: 'I understand the doubt. The revision is linked to construction progress, and you can verify the project status on RERA. I am only telling you early so you can decide on your own terms.' },
          { said: 'I need more time', reply: 'Of course. If you hold the unit now with a small token as per our policy, you keep the current price while you finish your discussions.' },
        ],
        closing: 'Thank you, {{customer_name}}. I am sending the cost sheet now. Please call me if anything is unclear.',
        outcomes: ['ready_to_book', 'interested', 'booked_visit', 'callback', 'not_interested'],
        variables: ['customer_name', 'business_name', 'project_name', 'revision_date'],
      },
    },
    {
      id: 'realestate-home-loan', name: 'Home loan & payment plan explainer', goal: 'Remove the money worry and book a loan check',
      when: 'For leads who stall on budget, 3–5 days after a visit',
      audience: { type: 'leads', tags: ['budget-concern'] },
      email: {
        subject: '{{first_name}}, what your home at [project name] costs per month',
        body: 'Hi {{first_name}},\n\nThe biggest question in buying a home is not the total price — it is "what will I actually pay every month, and can I manage it?"\n\nSo let me make it simple.\n\nFor a home at [project name], you pay a booking amount, and the rest is linked to construction stages or covered by a home loan. Most buyers take a loan for a large part of the cost, and the EMI starts only on the amount disbursed.\n\nWe work with several leading banks and housing finance companies. They can check your eligibility in one sitting, with basic documents like salary slips or ITR, PAN and Aadhaar.\n\nIf you are a first-time buyer, you may also be eligible for tax benefits on principal and interest under the current rules — your CA can confirm what applies to you.\n\nI have put the payment plan and a sample EMI table here: [link]\n\nWould you like a free eligibility check with our loan partner? Reply to this email and we will set it up.\n\nWarm regards,\n{{business}}',
      },
      whatsapp: {
        name: 're_home_loan_plan', category: 'MARKETING',
        body: 'Hi {{1}}, wondering what your home at {{2}} would cost per month? 🏡\n\nOur loan partners can check your eligibility in one sitting, and we can show you the payment plan and a sample EMI.\n\nWould you like a free loan eligibility check? Reply YES and we will set it up.',
        vars: [{ key: 'first_name', example: 'Sandeep' }, { fill: 'Project name', example: 'Skyline Heights' }],
        footer: STOP,
      },
      call: {
        goal: 'Book a free home loan eligibility check',
        opening: 'Namaste {{customer_name}}, main {{business_name}} se bol rahi hoon. After your visit to {{project_name}}, I wanted to help you with the budget and loan side.',
        script: [
          'Many buyers like the home but are unsure about the monthly outgo, so we help with that first.',
          'Our partner banks can check your loan eligibility in one sitting, with basic documents.',
          'I can also share the payment plan so you see exactly when each amount is due.',
        ],
        questions: [
          'Are you salaried or self-employed?',
          'Roughly what monthly EMI would be comfortable for you?',
          'Is there any co-applicant, like your spouse or a parent?',
          'How much can you arrange for the down payment?',
        ],
        objections: [
          { said: 'Interest rates are too high right now', reply: 'Rates do move, and most home loans are floating, so your EMI can come down when rates fall. The eligibility check is free — it will at least tell you where you stand.' },
          { said: 'I already have a bank', reply: 'That is great. You can absolutely use your own bank. Our partners are just an option if you want to compare offers.' },
          { said: 'Will decide later', reply: 'Sure. An eligibility check does not commit you to anything — it simply makes your decision easier when you are ready.' },
        ],
        closing: 'Thank you, {{customer_name}}. I will share the payment plan on WhatsApp, and our loan partner will call you at the time we fixed.',
        outcomes: ['loan_check_booked', 'interested', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'project_name'],
      },
    },
  ],

  // ───────────────────────────── Interiors: designers & architects ─────────────────────────────
  interior: [
    {
      id: 'interior-new-enquiry', name: 'New enquiry follow-up', goal: 'Book a free site measurement',
      when: 'Within an hour of a new enquiry',
      audience: { type: 'leads' },
      email: {
        subject: '{{first_name}}, let’s start with your home’s measurements',
        body: 'Hi {{first_name}},\n\nThank you for reaching out to {{business}}. A new interior is a big decision, and you probably have a Pinterest board full of ideas and a list of worries — budget, timelines, quality, and whether it will really look like the pictures.\n\nThe best way to answer all of these is to start with your actual home.\n\nOur designer will visit for a free site measurement, understand how your family lives, and talk through what you have in mind. After that, we prepare a layout and a 3D design, so you can see your rooms before a single rupee is spent on work.\n\nYou can see some of our recent homes here: [portfolio link]\n\nThe visit takes about an hour and there is no charge or commitment.\n\nReply to this email with a convenient day and time, or share your flat’s possession date if it is not ready yet, and we will plan around it.\n\nWarm regards,\n{{business}}',
      },
      whatsapp: {
        name: 'interior_new_enquiry', category: 'MARKETING',
        body: 'Hi {{1}}, thank you for contacting us about your home interiors! 🛋️\n\nOur designer can visit for a free site measurement, understand your needs, and then show you a 3D design before any work begins.\n\nWhich day suits you for the visit? Just reply with a day and time.',
        vars: [{ key: 'first_name', example: 'Kavya' }],
        footer: STOP,
      },
      call: {
        goal: 'Book a free site measurement visit',
        opening: 'Hello {{customer_name}}, main {{business_name}} se baat kar rahi hoon. You had enquired about interiors for your home — is this a good time to talk?',
        script: [
          'Thank you for your interest. I would like to understand your home and your plans, so our designer comes prepared.',
          'We begin with a free site measurement, then share a layout and a 3D design so you see the result before work starts.',
          'There is no charge for the visit and no commitment.',
        ],
        questions: [
          'Is it a 2 BHK, 3 BHK or a villa — and is it a new flat or a renovation?',
          'Which areas do you want done — full home, kitchen, wardrobes, or a few rooms?',
          'When are you planning to move in or start the work?',
          'Have you thought of a budget range?',
        ],
        objections: [
          { said: 'I am just collecting quotes', reply: 'That is sensible. A site measurement actually makes quotes comparable, because everything is based on your real sizes. Shall I book it for this weekend?' },
          { said: 'Interior designers are very expensive', reply: 'We design to your budget, not the other way around. Once we measure, we can show options at different price points so you choose what is right.' },
          { said: 'My flat is not ready yet', reply: 'No problem. Many clients start the design early so work begins the day they get the keys. When is your possession expected?' },
        ],
        closing: 'Wonderful, {{customer_name}}. Your measurement visit is noted and you will get a confirmation on WhatsApp. Thank you!',
        outcomes: ['booked_visit', 'interested', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name'],
      },
    },
    {
      id: 'interior-measurement-reminder', name: 'Site measurement reminder', goal: 'Make sure the measurement visit happens',
      when: 'The day before a booked site measurement',
      audience: { type: 'leads', tags: ['measurement-booked'] },
      email: {
        subject: 'Your site measurement is confirmed for [visit date]',
        body: 'Hi {{first_name}},\n\nThis is a reminder that our designer, [designer name], will visit your home on [visit date and time] for the site measurement.\n\nAddress we have: [site address]\n\nThe visit takes about an hour. To get the most out of it:\n\nPlease make sure the flat is accessible — keys, society gate pass or lift access if needed.\n\nKeep any photos or Pinterest ideas you like handy. They help us understand your taste quickly.\n\nThink about storage needs — how many wardrobes, a study, a puja unit, a utility area. Small details now save changes later.\n\nIf your family members who will use the space can be there, even better.\n\nIf you need to change the time, just reply to this email and we will reschedule.\n\nSee you soon,\n{{business}}',
      },
      whatsapp: {
        name: 'interior_measurement_reminder', category: 'UTILITY',
        body: 'Hi {{1}}, a reminder that our designer will visit on {{2}} for your site measurement.\n\nPlease keep the flat accessible, and any photos of designs you like handy.\n\nNeed to change the time? Just reply to this message.',
        vars: [{ key: 'first_name', example: 'Kavya' }, { fill: 'Visit date and time', example: 'Sat, 20 Oct at 4 pm' }],
      },
      call: {
        goal: 'Confirm the site measurement visit',
        opening: 'Hello {{customer_name}}, this is {{business_name}}. I am calling to confirm the site measurement on {{visit_time}}.',
        script: [
          'Our designer will reach on time and the visit takes about an hour.',
          'Please make sure the flat is accessible — keys or a gate pass if your society needs one.',
          'If you have saved any design photos you like, please keep them handy.',
        ],
        questions: [
          'Is the time still fine for you?',
          'Will you need us to arrange a gate pass or society permission?',
          'Will the other family members be present?',
        ],
        objections: [
          { said: 'I need to postpone', reply: 'No problem. Would the same time tomorrow, or this weekend, work better?' },
          { said: 'Can you just give me a rough quote on the phone?', reply: 'I wish I could, but without exact measurements any figure would be a guess. The visit makes the quote accurate — and it is free.' },
        ],
        closing: 'Thank you, {{customer_name}}. The visit is confirmed. See you then!',
        outcomes: ['confirmed', 'rescheduled', 'cancelled', 'callback', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'visit_time'],
      },
    },
    {
      id: 'interior-design-followup', name: '3D design follow-up', goal: 'Get the design approved and the order signed',
      when: '2–3 days after sharing the 3D design and quote',
      audience: { type: 'leads', tags: ['design-shared'] },
      email: {
        subject: '{{first_name}}, what did you think of your 3D design?',
        body: 'Hi {{first_name}},\n\nIt has been a couple of days since we shared the 3D design and quotation for your home. I wanted to check what you and your family thought.\n\nIn our experience, this is the stage where most questions come up. Maybe a colour does not feel right, the wardrobe needs one more shelf, or the total is a little above what you planned. All of that is normal — and all of it can be adjusted.\n\nHere is what we can do:\n\nChange finishes, colours or layouts and share a revised 3D view.\n\nSuggest material options that bring the cost down without compromising on what matters.\n\nSplit the work into phases if you would like to start with the essential rooms first.\n\nYou can view the design again here: [design link]\n\nReply to this email with your thoughts, or let us know a time for a quick call with your designer. Once you approve, we lock the materials and share the execution timeline.\n\nWarm regards,\n{{business}}',
      },
      whatsapp: {
        name: 'interior_design_followup', category: 'MARKETING',
        body: 'Hi {{1}}, hope you and your family had a chance to look at your 3D design! ✨\n\nIf you want any changes in colours, layout or budget, we can revise it quickly.\n\nShall we set up a short call with your designer? Reply with a time that suits you.',
        vars: [{ key: 'first_name', example: 'Arjun' }],
        footer: STOP,
      },
      call: {
        goal: 'Get feedback on the design and close the order',
        opening: 'Hello {{customer_name}}, {{business_name}} se bol raha hoon. We shared your 3D design a few days ago — I wanted to know how you liked it.',
        script: [
          'Your feedback helps us make it exactly right before work begins.',
          'We can change colours, finishes or layouts, and also suggest options to manage the budget.',
          'Once you approve, we lock the materials and give you a clear timeline for execution.',
        ],
        questions: [
          'What did you like most, and what would you change?',
          'Is the quotation within your budget, or should we look at alternatives?',
          'When would you like the work to start?',
        ],
        objections: [
          { said: 'Another designer quoted lower', reply: 'That can happen. Please compare the material brands, hardware and warranty line by line — we are happy to walk you through ours. If needed, we can also suggest options to bring our cost closer.' },
          { said: 'We will decide after Diwali', reply: 'Sure. Just keep in mind that production and installation take a few weeks. If you approve now, we can plan the timeline around your dates.' },
          { said: 'Need to discuss with family', reply: 'Of course. Would it help if our designer walks your family through the 3D design on a video call?' },
        ],
        closing: 'Thank you, {{customer_name}}. I will share the revised design and the next steps on WhatsApp.',
        outcomes: ['ready_to_order', 'revision_needed', 'interested', 'callback', 'not_interested'],
        variables: ['customer_name', 'business_name'],
      },
    },
    {
      id: 'interior-modular-kitchen', name: 'Modular kitchen offer', goal: 'Book a kitchen design consultation',
      when: 'Anytime; best before festivals and the wedding season',
      audience: { type: 'all' },
      email: {
        subject: '{{first_name}}, a kitchen that works the way you cook',
        body: 'Hi {{first_name}},\n\nThe kitchen is where an Indian home really runs. Morning chai, tiffins, festival cooking for twenty guests — and still, most kitchens have cabinets that do not close, corners nobody can reach and no place for the big kadhai.\n\nA well-planned modular kitchen fixes that. Tall units for groceries, corner carousels, a proper place for the mixer, chimney and RO, and finishes that clean easily after tadka.\n\nThis month, we are offering [kitchen offer] on modular kitchens designed and installed by {{business}}.\n\nHere is how it works:\n\nOur designer visits, measures and understands how you cook.\n\nWe share a 3D design and a clear quote, with brands and warranty listed.\n\nOnce approved, the kitchen is made in our factory and installed in [installation time].\n\nSee some of the kitchens we have done here: [link]\n\nReply to this email to book a free consultation.\n\nWarm regards,\n{{business}}',
      },
      whatsapp: {
        name: 'interior_modular_kitchen_offer', category: 'MARKETING',
        body: 'Hi {{1}}, is your kitchen ready for the festive cooking season? 🍳\n\nThis month we are offering {{2}} on modular kitchens, with a free 3D design and site measurement.\n\nWould you like our designer to visit? Reply with a day that suits you.',
        vars: [{ key: 'first_name', example: 'Meera' }, { fill: 'Kitchen offer', example: 'free chimney and hob' }],
        footer: STOP,
      },
      call: {
        goal: 'Book a modular kitchen consultation',
        opening: 'Namaste {{customer_name}}, main {{business_name}} se baat kar rahi hoon. I am calling about our modular kitchen offer this month.',
        script: [
          'This month we are offering {{kitchen_offer}} on modular kitchens.',
          'Our designer visits, measures and shares a 3D design with a clear quote — free of charge.',
          'The kitchen is made in our factory, so installation at your home is quick and clean.',
        ],
        questions: [
          'Is your kitchen L-shaped, parallel or straight?',
          'Is this for a new flat or a renovation of the existing kitchen?',
          'What bothers you most in your current kitchen — storage, space or upkeep?',
        ],
        objections: [
          { said: 'Modular kitchens are costly', reply: 'They can be built for different budgets. After measuring, we show options in different materials and finishes so you pick what suits you.' },
          { said: 'Will the mess and noise be a problem?', reply: 'Most of the work happens in our factory. At your home it is mainly fitting, which takes only a few days.' },
          { said: 'Not right now', reply: 'Understood. The offer is on for this month — shall I just send you photos of our recent kitchens on WhatsApp?' },
        ],
        closing: 'Thank you, {{customer_name}}. I have noted your visit and you will get a confirmation on WhatsApp.',
        outcomes: ['booked_visit', 'interested', 'send_details', 'callback', 'not_interested'],
        variables: ['customer_name', 'business_name', 'kitchen_offer'],
      },
    },
    {
      id: 'interior-festive-deadline', name: 'Ready before Diwali', goal: 'Get orders signed in time for the festival',
      when: '6–8 weeks before Diwali (or a griha pravesh date)',
      audience: { type: 'leads', tags: ['design-shared', 'interested'] },
      email: {
        subject: '{{first_name}}, want your home ready before Diwali?',
        body: 'Hi {{first_name}},\n\nEvery year, many families tell us the same thing: "We want to celebrate Diwali in the new home." And every year, some of them start just a little too late.\n\nHere is the honest timeline. After the design is approved, materials are ordered, furniture is made in the factory, and then installed at your home. For a typical project, this takes around [execution time].\n\nThat means, to have your home ready for [festival date], the design needs to be approved by [last approval date].\n\nIf you have already seen your 3D design, this is a good time to make any final changes and confirm. If you have not started yet, we can still visit, measure and design quickly — but we can take only a limited number of festival projects so that every home is finished properly.\n\nReply to this email, and your designer will call you to plan the timeline.\n\nWarm regards,\n{{business}}',
      },
      whatsapp: {
        name: 'interior_festive_ready', category: 'MARKETING',
        body: 'Hi {{1}}, planning to celebrate Diwali in your newly done-up home? 🪔\n\nTo finish on time, designs need to be approved by {{2}}. We are taking a limited number of festive projects so each one is done properly.\n\nWould you like your designer to call and plan the timeline? Reply YES.',
        vars: [{ key: 'first_name', example: 'Rahul' }, { fill: 'Last approval date', example: '25 September' }],
        footer: STOP,
      },
      call: {
        goal: 'Confirm the order in time for the festival',
        opening: 'Hello {{customer_name}}, {{business_name}} se bol rahi hoon. I wanted to check if you would like your home ready before Diwali.',
        script: [
          'To finish before the festival, the design needs to be approved by {{approval_date}}.',
          'After approval, production and installation take a few weeks, so the earlier we start, the smoother it goes.',
          'We can make your final changes in the design this week itself.',
        ],
        questions: [
          'Is there any date you want the home ready by — Diwali or a griha pravesh?',
          'Are there pending changes in your design?',
          'Who else in the family needs to approve the design?',
        ],
        objections: [
          { said: 'Can you finish it in less time?', reply: 'We will always try, but rushing affects finishing. If we start this week, we can plan to deliver comfortably before the festival.' },
          { said: 'Budget is a concern', reply: 'We can prioritise the rooms you need for the festival — like the living room and kitchen — and do the rest after.' },
          { said: 'Let me think about it', reply: 'Of course. Just remember the approval date for the festival. Shall I call you on the weekend after you have discussed it?' },
        ],
        closing: 'Thank you, {{customer_name}}. I am sharing the timeline on WhatsApp. Let us make this Diwali special.',
        outcomes: ['ready_to_order', 'interested', 'phased_plan', 'callback', 'not_interested'],
        variables: ['customer_name', 'business_name', 'approval_date'],
      },
    },
    {
      id: 'interior-new-possession', name: 'New flat possession offer', goal: 'Win new homeowners getting their keys',
      when: 'When a nearby project starts giving possession',
      audience: { type: 'leads', tags: ['new-possession'] },
      email: {
        subject: 'Congratulations on your new home at [society name], {{first_name}}',
        body: 'Hi {{first_name}},\n\nCongratulations on getting the keys to your new home! After years of EMIs and waiting, this is a proud moment.\n\nNow comes the fun part — and also the part where many new owners feel a little lost. Which wardrobes? What false ceiling? Where does the TV go? What will all this cost?\n\nWe have already done homes in [society name], so we know the layouts, the sizes and the common challenges in your tower. That saves time and avoids surprises.\n\nFor new owners in your society, we are offering [possession offer].\n\nHere is what you get:\n\nA free site measurement at your flat.\n\nA 3D design of your home before any work begins.\n\nA clear, itemised quote with brands and warranty.\n\nSee homes we have completed in your society: [link]\n\nReply to this email to book your free visit.\n\nWarm regards,\n{{business}}',
      },
      whatsapp: {
        name: 'interior_possession_offer', category: 'MARKETING',
        body: 'Hi {{1}}, congratulations on your new home at {{2}}! 🔑\n\nWe have designed homes in your society already, so we know the layouts well. For new owners we are offering {{3}}, with a free site measurement and 3D design.\n\nWould you like to see homes we have done in your society? Reply YES.',
        vars: [{ key: 'first_name', example: 'Nikhil' }, { fill: 'Society name', example: 'Prestige Lakeside' }, { fill: 'Possession offer', example: '10% off on wardrobes' }],
        footer: STOP,
      },
      call: {
        goal: 'Book a site measurement for a new flat',
        opening: 'Hello {{customer_name}}, main {{business_name}} se baat kar rahi hoon. Congratulations on your new home at {{society_name}}!',
        script: [
          'We have already designed a few homes in your society, so we know the layouts well.',
          'For new owners there, we are offering a free measurement, a 3D design and a special possession offer.',
          'I can also send photos of the homes we finished in your society.',
        ],
        questions: [
          'Have you received possession, or is it expected soon?',
          'Which configuration is it — 2 BHK, 3 BHK?',
          'When are you planning to move in?',
          'Do you want full home interiors or only essentials like kitchen and wardrobes?',
        ],
        objections: [
          { said: 'The builder has given basic fittings', reply: 'That is a good start. We can work around what is already there and focus on storage, kitchen and finishing so you do not waste money.' },
          { said: 'We will move in first and decide later', reply: 'Many families say that, but doing work after moving in means dust and disruption. If we design now, you can move into a finished home.' },
        ],
        closing: 'Thank you, {{customer_name}}. I am sending photos of our work in your society on WhatsApp.',
        outcomes: ['booked_visit', 'interested', 'send_details', 'callback', 'not_interested'],
        variables: ['customer_name', 'business_name', 'society_name'],
      },
    },
    {
      id: 'interior-referral-request', name: 'Handover review & referral', goal: 'Get a Google review and a referral',
      when: '2 weeks after project handover',
      audience: { type: 'customers' },
      email: {
        subject: '{{first_name}}, how is life in your new space?',
        body: 'Hi {{first_name}},\n\nIt has been a couple of weeks since we handed over your home. I hope everything is working well and the family is enjoying the new space.\n\nIf anything needs attention — a hinge, a drawer channel, a shutter alignment — please tell us. It is covered, and we would rather fix it now than have it bother you.\n\nI also have two small requests.\n\nFirst, if you are happy with our work, could you share a quick Google review? It takes a minute and really helps families like yours trust a designer: [review link]\n\nSecond, if a friend, relative or neighbour is planning their interiors, we would be grateful for an introduction. As a thank-you, we offer [referral reward] once their project is confirmed.\n\nThank you for trusting {{business}} with your home. It was a pleasure working with you.\n\nWarm regards,\n{{business}}',
      },
      whatsapp: {
        name: 'interior_referral_request', category: 'MARKETING',
        body: 'Hi {{1}}, hope you are enjoying your new home! 🏡\n\nIf you are happy with our work, a short Google review would mean a lot to us. And if someone you know is planning interiors, we offer {{2}} for every referral that confirms.\n\nIf anything at home needs fixing, just reply here.',
        vars: [{ key: 'first_name', example: 'Sneha' }, { fill: 'Referral reward', example: 'a ₹5,000 gift voucher' }],
        footer: STOP,
      },
      call: {
        goal: 'Check satisfaction and ask for a review and referral',
        opening: 'Namaste {{customer_name}}, main {{business_name}} se bol rahi hoon. It has been two weeks since handover — how is everything at home?',
        script: [
          'I wanted to check if anything needs adjusting — hinges, drawers, shutters. We will send someone right away.',
          'If you are happy with our work, a short Google review would help us a lot. I can send you the link on WhatsApp.',
          'And if any friend or relative is planning interiors, we would love an introduction. We offer a thank-you reward for every confirmed referral.',
        ],
        questions: [
          'Is everything working well — kitchen, wardrobes, lights?',
          'Would you be comfortable leaving us a Google review?',
          'Do you know anyone who is getting a new home or renovating?',
        ],
        objections: [
          { said: 'There is an issue with a shutter', reply: 'I am sorry about that. Let me book a service visit right now — which day suits you?' },
          { said: 'I do not usually write reviews', reply: 'Completely understand. Even two lines or just a star rating helps. I will send the link — no pressure at all.' },
        ],
        closing: 'Thank you so much, {{customer_name}}. It was a pleasure doing your home. I am sending the review link on WhatsApp.',
        outcomes: ['review_agreed', 'referral_shared', 'service_needed', 'callback', 'not_interested'],
        variables: ['customer_name', 'business_name'],
      },
    },
  ],

  // ───────────────────────────── Home services, rooftop solar & installers ─────────────────────────────
  homeservices: [
    {
      id: 'homesvc-solar-enquiry', name: 'Solar enquiry follow-up', goal: 'Book a free site survey',
      when: 'Within an hour of a new solar enquiry',
      audience: { type: 'leads', tags: ['solar'] },
      email: {
        subject: '{{first_name}}, next step for solar on your roof',
        body: 'Hi {{first_name}},\n\nThank you for your interest in rooftop solar with {{business}}.\n\nEvery roof is different — the space, the direction it faces, the shade from trees or the water tank, and your monthly electricity use. That is why we never quote over the phone. We start with a free site survey.\n\nOur engineer will visit, check your roof and your electricity bill, and recommend the right system size for your home. You will get a clear proposal with the cost, the government subsidy you may be eligible for under PM Surya Ghar, and the savings you could expect — up to [savings figure] a month, depending on your usage.\n\nTo make the survey useful, please keep a recent electricity bill handy.\n\nThe visit takes about 30–45 minutes and there is no charge or obligation.\n\nReply to this email with a convenient day and time, and we will confirm your survey.\n\nWarm regards,\n{{business}}',
      },
      whatsapp: {
        name: 'homesvc_solar_enquiry', category: 'MARKETING',
        body: 'Hi {{1}}, thank you for your interest in rooftop solar! ☀️\n\nOur engineer can visit for a free site survey, check your roof and your bill, and suggest the right system size along with the subsidy you may be eligible for.\n\nWhich day suits you? Please keep a recent electricity bill handy.',
        vars: [{ key: 'first_name', example: 'Suresh' }],
        footer: STOP,
      },
      call: {
        goal: 'Book a free solar site survey',
        opening: 'Namaste {{customer_name}}, main {{business_name}} se baat kar raha hoon. Aapne rooftop solar ke baare mein enquiry ki thi — do minute baat kar sakte hain?',
        script: [
          'Thank you for your interest. To suggest the right system, we first do a free site survey.',
          'Our engineer checks your roof, shade and electricity bill, and then gives you a clear proposal with the cost and subsidy details.',
          'The survey takes about 30–45 minutes, and there is no obligation.',
        ],
        questions: [
          'What is your average monthly electricity bill?',
          'Is it an independent house with your own roof, or an apartment?',
          'Roughly how much free roof area do you have?',
          'When would you like to get it installed?',
        ],
        objections: [
          { said: 'Solar is too expensive', reply: 'Under PM Surya Ghar, eligible homes get a central subsidy, and the system can pay back over the years through lower bills. The survey will tell you your exact cost after subsidy.' },
          { said: 'I have heard the subsidy process is complicated', reply: 'We handle the registration and paperwork for you, step by step. You just need to share a few documents.' },
          { said: 'Will think about it', reply: 'Of course. The survey is free and will give you real numbers to think with. Shall I book it for this weekend?' },
        ],
        closing: 'Great, {{customer_name}}. Your survey is booked and you will get a confirmation on WhatsApp. Please keep a recent bill handy.',
        outcomes: ['booked_survey', 'interested', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name'],
      },
    },
    {
      id: 'homesvc-survey-reminder', name: 'Site survey reminder', goal: 'Make sure the booked survey happens',
      when: 'The day before a booked site survey',
      audience: { type: 'leads', tags: ['survey-booked'] },
      email: {
        subject: 'Your site survey is confirmed for [survey date]',
        body: 'Hi {{first_name}},\n\nThis is a reminder that our engineer, [engineer name], will visit your home on [survey date and time] for the site survey.\n\nAddress we have: [site address]\n\nThe visit takes about 30–45 minutes. To help us give you an accurate proposal, please keep these ready:\n\nA recent electricity bill (the last 2–3 months, if possible).\n\nAccess to the roof or terrace — keys to the door, if it is usually locked.\n\nAny questions you have about the subsidy, net metering or maintenance.\n\nIf you live in a society, please let the security know about our visit, or tell us if a gate pass is needed.\n\nIf you need to change the time, just reply to this email and we will reschedule.\n\nThank you,\n{{business}}',
      },
      whatsapp: {
        name: 'homesvc_survey_reminder', category: 'UTILITY',
        body: 'Hi {{1}}, a reminder that our engineer will visit on {{2}} for your site survey.\n\nPlease keep a recent electricity bill handy and the roof accessible.\n\nNeed to change the time? Just reply to this message.',
        vars: [{ key: 'first_name', example: 'Suresh' }, { fill: 'Survey date and time', example: 'Mon, 22 Oct at 10 am' }],
      },
      call: {
        goal: 'Confirm the site survey',
        opening: 'Hello {{customer_name}}, this is {{business_name}}. I am calling to confirm your site survey on {{visit_time}}.',
        script: [
          'Our engineer will reach on time and the survey takes about 30–45 minutes.',
          'Please keep a recent electricity bill handy and the roof accessible.',
          'If your society needs a gate pass, please tell me and we will arrange it.',
        ],
        questions: [
          'Is the time still convenient?',
          'Will someone be home to show the roof?',
          'Do you need us to inform your society security?',
        ],
        objections: [
          { said: 'I need to reschedule', reply: 'No problem. Which day and time would work better for you this week?' },
          { said: 'Can you not just quote from my bill?', reply: 'The bill tells us your usage, but the roof decides the system size and placement. The survey makes the quote accurate — and it is free.' },
        ],
        closing: 'Thank you, {{customer_name}}. Your survey is confirmed. See you then!',
        outcomes: ['confirmed', 'rescheduled', 'cancelled', 'callback', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'visit_time'],
      },
    },
    {
      id: 'homesvc-subsidy-explainer', name: 'Solar subsidy explainer', goal: 'Educate leads on PM Surya Ghar and book a survey',
      when: 'For leads who have not booked a survey, 3–5 days after enquiry',
      audience: { type: 'leads', tags: ['solar'] },
      email: {
        subject: '{{first_name}}, how the solar subsidy works (simply explained)',
        body: 'Hi {{first_name}},\n\nMany homeowners we speak to are interested in solar but unsure about one thing: the subsidy. How much is it, who gets it, and how long does it take?\n\nHere is the simple version.\n\nUnder the PM Surya Ghar Muft Bijli Yojana, eligible residential homes can get a central subsidy on rooftop solar, based on the system size. The current amounts and rules are on the official portal, and we will walk you through what applies to your home.\n\nThe process: you register on the portal, we install the system, the DISCOM inspects and installs a net meter, and the subsidy is credited to your bank account.\n\nWe handle the paperwork and follow-up at every step.\n\nAfter installation, depending on your usage, you could save up to [savings figure] on your electricity bill every month.\n\nWant to know exactly what your home qualifies for? Reply to this email to book a free site survey.\n\nWarm regards,\n{{business}}',
      },
      whatsapp: {
        name: 'homesvc_subsidy_explainer', category: 'MARKETING',
        body: 'Hi {{1}}, did you know eligible homes can get a central subsidy on rooftop solar under PM Surya Ghar? ☀️\n\nWe handle the registration, installation and net metering paperwork for you.\n\nWant to know what your home qualifies for? Reply YES to book a free site survey.',
        vars: [{ key: 'first_name', example: 'Lakshmi' }],
        footer: STOP,
      },
      call: {
        goal: 'Explain the subsidy and book a survey',
        opening: 'Namaste {{customer_name}}, {{business_name}} se bol rahi hoon. You had asked about solar — I wanted to quickly explain how the government subsidy works.',
        script: [
          'Under PM Surya Ghar, eligible homes get a central subsidy on rooftop solar, depending on the system size.',
          'We help you register on the portal, install the system, and coordinate the net meter with the DISCOM.',
          'Once that is done, the subsidy comes directly into your bank account.',
          'A free site survey will tell you the right system size and your cost after subsidy.',
        ],
        questions: [
          'What is your average monthly electricity bill?',
          'Is the electricity connection in your own name?',
          'Do you have a terrace or roof that gets sunlight most of the day?',
        ],
        objections: [
          { said: 'Subsidy takes too long to come', reply: 'Timelines depend on the DISCOM inspection, but we follow up at every step so nothing gets stuck on our side.' },
          { said: 'What if it does not work in monsoon?', reply: 'Generation does dip on cloudy days, but the system still works, and the yearly total is what matters. Our engineer will explain this with your actual roof during the survey.' },
        ],
        closing: 'Thank you, {{customer_name}}. I have booked your survey and will send the details on WhatsApp.',
        outcomes: ['booked_survey', 'interested', 'send_details', 'callback', 'not_interested'],
        variables: ['customer_name', 'business_name'],
      },
    },
    {
      id: 'homesvc-quote-followup', name: 'Quote follow-up', goal: 'Convert a sent quote into an order',
      when: '3 days after sending a quotation',
      audience: { type: 'leads', tags: ['quote-sent'] },
      email: {
        subject: '{{first_name}}, any questions about your quote?',
        body: 'Hi {{first_name}},\n\nA few days ago we shared the proposal for your [system or service] after the site survey. I wanted to check if you had a chance to go through it.\n\nUsually, people have a few questions at this point:\n\nWhich brand of panels and inverter is used, and what is the warranty?\n\nHow long does installation take, and is there any damage to the roof?\n\nWhat happens if something stops working after a few years?\n\nWe are happy to answer each of these in detail. If you have received other quotes, please compare them line by line — panel brand and wattage, inverter type, structure quality, warranty and after-sales service. The cheapest quote is not always the lowest cost over 25 years.\n\nYou can view your proposal again here: [link]\n\nReply to this email or let us know a good time for a call, and we will go through it together.\n\nWarm regards,\n{{business}}',
      },
      whatsapp: {
        name: 'homesvc_quote_followup', category: 'MARKETING',
        body: 'Hi {{1}}, hope you had a chance to look at the proposal we shared. 📄\n\nIf you have questions about brands, warranty, installation or the subsidy, we are happy to explain. If you are comparing quotes, we can help you compare them line by line.\n\nWould a quick call help? Reply with a time that suits you.',
        vars: [{ key: 'first_name', example: 'Ramesh' }],
        footer: STOP,
      },
      call: {
        goal: 'Answer questions and close the order',
        opening: 'Hello {{customer_name}}, {{business_name}} se bol raha hoon. We sent your proposal a few days ago — did you get a chance to see it?',
        script: [
          'I wanted to answer any questions you or your family may have.',
          'If you have other quotes, I can help you compare them on brand, warranty and service — not just price.',
          'Once you confirm, we schedule installation and start the subsidy paperwork.',
        ],
        questions: [
          'Did the system size and cost match what you expected?',
          'Are you comparing with any other quotes?',
          'When would you like the installation done?',
        ],
        objections: [
          { said: 'Another vendor is cheaper', reply: 'Please check the panel brand and wattage, inverter, structure and warranty in both quotes. Small differences there decide how the system performs for 25 years. I can go through both with you.' },
          { said: 'Need to arrange the money', reply: 'We can tell you about solar loan options from banks, and the payment can be split by installation stage.' },
          { said: 'Will do it next year', reply: 'Sure. Just remember every month without solar is a full electricity bill. Shall I call you after a month to check?' },
        ],
        closing: 'Thank you, {{customer_name}}. I will send a summary on WhatsApp and we will take it from there.',
        outcomes: ['ready_to_order', 'interested', 'comparing_quotes', 'callback', 'not_interested'],
        variables: ['customer_name', 'business_name'],
      },
    },
    {
      id: 'homesvc-summer-bills', name: 'Summer bill season push', goal: 'Get survey bookings when bills peak',
      when: 'March–May, when AC season pushes electricity bills up',
      audience: { type: 'all', tags: ['solar'] },
      email: {
        subject: '{{first_name}}, is your summer electricity bill hurting?',
        body: 'Hi {{first_name}},\n\nThe ACs are on, the coolers are running, the fridge is working overtime — and the electricity bill is climbing every month.\n\nSummer is exactly when rooftop solar works hardest. Long, sunny days mean your panels generate the most power just when your home needs it most.\n\nHere is what rooftop solar can do for a typical home:\n\nCut your monthly bill by up to [savings figure], depending on your usage and system size.\n\nQualify for a central subsidy under PM Surya Ghar, if your home is eligible.\n\nRun for 25 years with minimal maintenance.\n\nWe start with a free site survey. Our engineer checks your roof and bill and tells you exactly what system makes sense, what it costs after subsidy and how long it takes to pay back.\n\nInstallations get busy in summer, so if you are considering solar, now is a good time to plan.\n\nReply to this email to book your free survey.\n\nWarm regards,\n{{business}}',
      },
      whatsapp: {
        name: 'homesvc_summer_bills', category: 'MARKETING',
        body: 'Hi {{1}}, summer bills are here! 🌞\n\nRooftop solar generates the most power in exactly these sunny months. You could save up to {{2}} a month, depending on usage, and eligible homes also get a government subsidy.\n\nWant a free site survey? Reply with a day that suits you.',
        vars: [{ key: 'first_name', example: 'Vikram' }, { fill: 'Savings figure', example: '₹3,000' }],
        footer: STOP,
      },
      call: {
        goal: 'Book a survey during peak bill season',
        opening: 'Namaste {{customer_name}}, main {{business_name}} se bol raha hoon. Garmi mein bijli ka bill bahut badh gaya hoga — I am calling about rooftop solar.',
        script: [
          'Summer is when solar generates the most, right when your AC usage is highest.',
          'Eligible homes also get a central subsidy under PM Surya Ghar.',
          'A free site survey will show you the right system size and your cost after subsidy.',
        ],
        questions: [
          'How much is your electricity bill in summer months?',
          'Is it your own house with roof access?',
          'Would you like it installed before next summer, or sooner?',
        ],
        objections: [
          { said: 'Bill is high only in summer', reply: 'That is true for many homes. With net metering, extra units from sunny months are adjusted as per your DISCOM rules, so the benefit is spread across the year.' },
          { said: 'Too busy right now', reply: 'Understood. The survey takes only 30–45 minutes and we can come early morning or on a Sunday. Which suits you?' },
        ],
        closing: 'Thank you, {{customer_name}}. Your survey is booked. Confirmation is coming on WhatsApp.',
        outcomes: ['booked_survey', 'interested', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name'],
      },
    },
    {
      id: 'homesvc-service-due', name: 'Scheduled service reminder', goal: 'Confirm the scheduled service visit',
      when: '2 days before a scheduled service or panel cleaning under AMC',
      audience: { type: 'customers', tags: ['amc'] },
      email: {
        subject: 'Your scheduled service visit on [service date]',
        body: 'Hi {{first_name}},\n\nThis is a reminder that your scheduled service visit under your maintenance plan is due on [service date and time].\n\nOur technician, [technician name], will:\n\nClean and inspect the panels or equipment.\n\nCheck the wiring, connections and earthing.\n\nReview the inverter or system readings and note anything that needs attention.\n\nThe visit usually takes about an hour. Please make sure someone is at home and the roof or installation area is accessible.\n\nYour service address: [site address]\n\nIf you have noticed anything unusual — lower generation, an error on the inverter display, a loose fitting — please tell the technician during the visit.\n\nIf the time does not suit you, reply to this email and we will reschedule.\n\nThank you,\n{{business}}',
      },
      whatsapp: {
        name: 'homesvc_service_due', category: 'UTILITY',
        body: 'Hi {{1}}, your scheduled service visit is due on {{2}}.\n\nOur technician will clean, inspect and check your system. Please keep the installation area accessible.\n\nIf you need another time, just reply to this message.',
        vars: [{ key: 'first_name', example: 'Anita' }, { fill: 'Service date and time', example: 'Thu, 25 Oct at 9 am' }],
      },
      call: {
        goal: 'Confirm the scheduled service visit',
        opening: 'Hello {{customer_name}}, this is {{business_name}}. Your scheduled service visit is due on {{visit_time}} — I am calling to confirm.',
        script: [
          'Our technician will clean and inspect the system and check the connections.',
          'The visit takes about an hour; please keep the area accessible.',
          'If you have noticed any issue, tell me now so the technician comes prepared.',
        ],
        questions: [
          'Is the scheduled time convenient?',
          'Have you noticed any drop in performance or an error on the display?',
          'Will someone be at home during the visit?',
        ],
        objections: [
          { said: 'Everything is working fine, is the visit needed?', reply: 'It is part of your plan and helps catch small issues early — dust and loose connections can reduce output without you noticing.' },
          { said: 'Not available that day', reply: 'No problem. Which other day this week works for you?' },
        ],
        closing: 'Thank you, {{customer_name}}. Your visit is confirmed. Our technician will call before reaching.',
        outcomes: ['confirmed', 'rescheduled', 'issue_reported', 'callback', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'visit_time'],
      },
    },
    {
      id: 'homesvc-amc-renewal', name: 'AMC renewal', goal: 'Renew the annual maintenance contract',
      when: '30 days before an AMC or warranty-service period ends',
      audience: { type: 'customers', tags: ['amc'] },
      email: {
        subject: '{{first_name}}, keep your system running at its best',
        body: 'Hi {{first_name}},\n\nYour annual maintenance plan with {{business}} ends on [AMC end date].\n\nOver the past year, our team has kept your system cleaned, checked and running well. Dust, bird droppings and loose connections can quietly reduce performance, and regular service is the simplest way to avoid that.\n\nRenewing your plan gives you:\n\nScheduled cleaning and inspection visits through the year.\n\nPriority service if something stops working.\n\nA health check with a short report after each visit.\n\nThe renewal price for your plan is [AMC price].\n\nYou can renew in a minute here: [link]\n\nIf you would like to change the number of visits or have any questions, just reply to this email.\n\nThank you for staying with us.\n\nWarm regards,\n{{business}}',
      },
      whatsapp: {
        name: 'homesvc_amc_renewal', category: 'MARKETING',
        body: 'Hi {{1}}, your maintenance plan with us ends on {{2}}. 🔧\n\nRenew to keep getting scheduled cleaning, inspection and priority service, so your system keeps running at its best.\n\nWould you like the renewal link? Reply YES and we will send it.',
        vars: [{ key: 'first_name', example: 'Prakash' }, { fill: 'AMC end date', example: '30 November' }],
        footer: STOP,
      },
      call: {
        goal: 'Renew the AMC',
        opening: 'Namaste {{customer_name}}, {{business_name}} se bol rahi hoon. Your maintenance plan with us ends on {{amc_end_date}}, so I wanted to help you renew it.',
        script: [
          'With the plan, you get scheduled cleaning and inspection visits and priority service.',
          'Regular service catches dust and loose connections before they affect performance.',
          'I can send you the renewal link on WhatsApp right now.',
        ],
        questions: [
          'Has the system been working well this year?',
          'Would you like the same number of visits, or more?',
          'Should I send the renewal link to this number?',
        ],
        objections: [
          { said: 'I can clean the panels myself', reply: 'You can, and many people do between visits. Our technicians also check wiring, earthing and inverter health, which is hard to do yourself.' },
          { said: 'The plan is costly', reply: 'One breakdown call without a plan can cost more than the renewal. I can also check if a plan with fewer visits suits you better.' },
        ],
        closing: 'Thank you, {{customer_name}}. I am sending the renewal link on WhatsApp now.',
        outcomes: ['renewed', 'interested', 'send_link', 'callback', 'not_interested'],
        variables: ['customer_name', 'business_name', 'amc_end_date'],
      },
    },
  ],

  // ───────────────────────────── Auto: car & bike dealerships ─────────────────────────────
  auto: [
    {
      id: 'auto-new-enquiry', name: 'New enquiry follow-up', goal: 'Book a test drive',
      when: 'Within 15 minutes of a website, CarDekho or showroom enquiry',
      audience: { type: 'leads' },
      email: {
        subject: '{{first_name}}, your test drive of the [model name] is one reply away',
        body: 'Hi {{first_name}},\n\nThank you for your enquiry about the [model name] at {{business}}.\n\nBrochures and reviews can tell you the mileage and the features. But how the seat feels, how the car handles on your roads, how much space the back seat really has for your family — that you only know behind the wheel.\n\nSo here is our suggestion: take a test drive. You can come to the showroom, or we can bring the vehicle to your home or office for a doorstep test drive at a time that suits you.\n\nDuring the visit, our team will also share:\n\nThe on-road price for the variant you like.\n\nCurrent offers, exchange value for your old vehicle and finance options.\n\nWaiting period and colour availability.\n\nYou can view the variants and price list here: [link]\n\nJust reply to this email with a day and time, and tell us if you prefer showroom or home.\n\nRegards,\n{{business}}',
      },
      whatsapp: {
        name: 'auto_new_enquiry', category: 'MARKETING',
        body: 'Hi {{1}}, thank you for your enquiry about the {{2}}! 🚗\n\nThe best way to decide is to drive it. Come to the showroom, or we can bring it to your home for a doorstep test drive.\n\nWhich day suits you? Reply with a day and time, and say showroom or home.',
        vars: [{ key: 'first_name', example: 'Karan' }, { fill: 'Model name', example: 'Hyundai Creta' }],
        footer: STOP,
      },
      call: {
        goal: 'Book a test drive',
        opening: 'Namaste {{customer_name}}, main {{business_name}} se baat kar raha hoon. Aapne {{model_name}} ke liye enquiry ki thi — kya abhi do minute baat ho sakti hai?',
        script: [
          'Thank you for your interest. I would love to arrange a test drive so you can feel the car yourself.',
          'We can do it at the showroom or bring the car to your home or office.',
          'I will also share the on-road price, current offers and exchange value for your old vehicle.',
        ],
        questions: [
          'Which variant are you considering — petrol, diesel, CNG or automatic?',
          'Do you have a vehicle to exchange?',
          'Are you planning to buy on finance or full payment?',
          'By when are you planning to buy?',
        ],
        objections: [
          { said: 'Just checking prices', reply: 'Sure, I will send the on-road price on WhatsApp right away. A short test drive will also help you compare with other models — shall I book one for the weekend?' },
          { said: 'On-road price is too high', reply: 'Let me check the current offers, exchange bonus and finance options for you. Often the monthly EMI works out easier than expected.' },
          { said: 'Need to discuss with family', reply: 'Of course. A home test drive is perfect then — the whole family can sit in the car and decide together.' },
        ],
        closing: 'Wonderful, {{customer_name}}. Your test drive is booked and confirmation will come on WhatsApp. Thank you!',
        outcomes: ['booked_test_drive', 'interested', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'model_name'],
      },
    },
    {
      id: 'auto-test-drive-reminder', name: 'Test drive reminder', goal: 'Make sure the booked test drive happens',
      when: 'The day before a booked test drive',
      audience: { type: 'leads', tags: ['test-drive-booked'] },
      email: {
        subject: 'Your test drive of the [model name] is confirmed',
        body: 'Hi {{first_name}},\n\nThis is a reminder of your test drive of the [model name] on [test drive date and time].\n\nLocation: [showroom address or home address]\n\nYour sales advisor, [advisor name], will be there to guide you.\n\nA few things to keep in mind:\n\nPlease carry your original driving licence. It is required for the test drive.\n\nIf family members will use the car, bring them along so they can sit in the back and check the space.\n\nIf you have a vehicle to exchange, bring it or its RC, and we can give you an exchange estimate on the spot.\n\nThe test drive and discussion take about 45 minutes.\n\nIf you need to change the time, just reply to this email and we will reschedule.\n\nSee you soon,\n{{business}}',
      },
      whatsapp: {
        name: 'auto_test_drive_reminder', category: 'UTILITY',
        body: 'Hi {{1}}, a reminder of your test drive of the {{2}} on {{3}}.\n\nPlease carry your original driving licence. If you have a vehicle to exchange, bring its RC as well.\n\nNeed to change the time? Just reply to this message.',
        vars: [{ key: 'first_name', example: 'Karan' }, { fill: 'Model name', example: 'Tata Nexon' }, { fill: 'Date, time and place', example: 'Sat, 13 Oct at 11 am, at our Baner showroom' }],
      },
      call: {
        goal: 'Confirm the booked test drive',
        opening: 'Hello {{customer_name}}, this is {{business_name}}. I am calling to confirm your test drive of the {{model_name}} on {{visit_time}}.',
        script: [
          'The car will be ready and your sales advisor will be waiting.',
          'Please carry your original driving licence.',
          'If you have an old vehicle to exchange, please bring its RC so we can give you an estimate.',
        ],
        questions: [
          'Is the time still convenient?',
          'Would you like the test drive at the showroom or at your home?',
          'Will family members be joining?',
        ],
        objections: [
          { said: 'I cannot make it', reply: 'No problem. Shall I move it to the same time tomorrow, or would the weekend be better?' },
          { said: 'I have already driven it at another dealer', reply: 'Great, then you know the car. Would you still like to visit for the on-road price, offers and exchange value? We may be able to offer a better deal.' },
        ],
        closing: 'Thank you, {{customer_name}}. Your test drive is confirmed. See you then!',
        outcomes: ['confirmed', 'rescheduled', 'cancelled', 'callback', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'model_name', 'visit_time'],
      },
    },
    {
      id: 'auto-test-drive-followup', name: 'Post test drive follow-up', goal: 'Convert a test drive into a booking',
      when: 'The evening after a test drive',
      audience: { type: 'leads', tags: ['test-driven'] },
      email: {
        subject: '{{first_name}}, how did you like the [model name]?',
        body: 'Hi {{first_name}},\n\nThank you for taking the [model name] for a test drive today. I hope you enjoyed it.\n\nAfter a test drive, the questions usually shift from the car to the deal: final on-road price, exchange value, finance, waiting period. Let me make that part easy.\n\nI have put together a personalised quote for the variant you liked, including current offers: [link]\n\nIf you have an old vehicle, we can do a free evaluation and adjust the exchange value against the new one. If you are taking a loan, we can get approvals from multiple banks quickly so you can choose the best EMI.\n\nOne practical point: waiting periods depend on the variant and colour. If you have a preference, booking early helps secure your allotment.\n\nReply to this email with any questions, or tell me a good time for a call.\n\nRegards,\n{{business}}',
      },
      whatsapp: {
        name: 'auto_test_drive_followup', category: 'MARKETING',
        body: 'Hi {{1}}, thank you for test driving the {{2}} today! 🙏\n\nI can share a personalised quote for the variant you liked, with current offers, exchange value and EMI options.\n\nShall I send it here? Just reply YES.',
        vars: [{ key: 'first_name', example: 'Karan' }, { fill: 'Model name', example: 'Maruti Grand Vitara' }],
        footer: STOP,
      },
      call: {
        goal: 'Get feedback and close the booking',
        opening: 'Namaste {{customer_name}}, {{business_name}} se bol raha hoon. Aaj aapne {{model_name}} ki test drive li thi — kaisi lagi?',
        script: [
          'I wanted to share a personalised quote for the variant you liked, with current offers.',
          'If you have an old vehicle, we can include its exchange value in the deal.',
          'We can also arrange loan approvals from multiple banks so you choose the best EMI.',
        ],
        questions: [
          'Which variant and colour did you like?',
          'Will you be exchanging an old vehicle?',
          'Would you prefer finance or full payment?',
          'When would you like to take delivery?',
        ],
        objections: [
          { said: 'Another dealer is giving a bigger discount', reply: 'Please share their offer and I will check with my manager what we can do. Also compare the accessories, insurance and extended warranty included — the total value matters.' },
          { said: 'Waiting period is too long', reply: 'Let me check stock for other colours or variants that are available sooner. Booking early also helps secure your allotment.' },
          { said: 'Will buy during Diwali', reply: 'Many customers do. If you book now, you can lock the current offer and plan delivery for your chosen muhurat.' },
        ],
        closing: 'Thank you, {{customer_name}}. I am sending your quote on WhatsApp now.',
        outcomes: ['ready_to_book', 'interested', 'send_quote', 'callback', 'not_interested'],
        variables: ['customer_name', 'business_name', 'model_name'],
      },
    },
    {
      id: 'auto-festive-offer', name: 'Festive season offer', goal: 'Get bookings for festive delivery',
      when: '2–3 weeks before Navratri, Dhanteras/Diwali or Gudi Padwa',
      audience: { type: 'leads' },
      email: {
        subject: '{{first_name}}, bring home your new [model name] this festive season',
        body: 'Hi {{first_name}},\n\nFor many Indian families, there is no better time to bring home a new vehicle than Navratri, Dhanteras or Diwali. A new car or bike on an auspicious day is a memory the whole family keeps.\n\nThis festive season at {{business}}, we have special offers on the [model name]: [festive offer].\n\nWe can also help you with:\n\nDelivery on your chosen muhurat, if you book in time.\n\nExchange of your old vehicle with an on-the-spot evaluation.\n\nQuick loan approvals with easy EMI options.\n\nFestive demand is high and popular colours and variants get booked first. If you have a preference, booking early is the surest way to get delivery on your date.\n\nSee the festive offers here: [link]\n\nReply to this email to book a test drive or reserve your vehicle.\n\nWishing you and your family a very happy festive season!\n\nRegards,\n{{business}}',
      },
      whatsapp: {
        name: 'auto_festive_offer', category: 'MARKETING',
        body: 'Hi {{1}}, this festive season, bring home your new {{2}}! 🪔\n\nGet {{3}}, plus exchange and easy EMI options. Book early to get delivery on your chosen muhurat.\n\nWould you like a test drive or the offer details? Just reply here.',
        vars: [{ key: 'first_name', example: 'Pooja' }, { fill: 'Model name', example: 'Honda Activa' }, { fill: 'Festive offer', example: 'benefits up to ₹5,000' }],
        footer: STOP,
      },
      call: {
        goal: 'Convert a lead with the festive offer',
        opening: 'Namaste {{customer_name}}, main {{business_name}} se bol rahi hoon. Festival ki shubhkamnayein! I am calling about our festive offers on the {{model_name}}.',
        script: [
          'This festive season, we have {{festive_offer}} on the {{model_name}}.',
          'If you book now, we can plan delivery on your chosen muhurat — Dhanteras, Diwali or any date you like.',
          'We can also evaluate your old vehicle for exchange and arrange quick loan approval.',
        ],
        questions: [
          'Which day would you like to take delivery?',
          'Do you have an old vehicle to exchange?',
          'Would you like to come for a test drive this week?',
        ],
        objections: [
          { said: 'I will wait for a better offer', reply: 'Festive offers are usually the best of the year, and stock of popular variants runs out. Booking now locks your offer and your delivery date.' },
          { said: 'Price is still high', reply: 'With the exchange bonus and a loan, the monthly amount can be quite manageable. Shall I calculate the EMI for you?' },
          { said: 'Will discuss with family', reply: 'Of course. Come with your family for a test drive this weekend — everyone can decide together.' },
        ],
        closing: 'Thank you, {{customer_name}}. I am sending the festive offer details on WhatsApp. Happy festivities!',
        outcomes: ['ready_to_book', 'booked_test_drive', 'interested', 'callback', 'not_interested'],
        variables: ['customer_name', 'business_name', 'model_name', 'festive_offer'],
      },
    },
    {
      id: 'auto-exchange-upgrade', name: 'Exchange & upgrade offer', goal: 'Get old-vehicle owners to upgrade',
      when: 'For customers whose vehicle is 5+ years old',
      audience: { type: 'customers', tags: ['vehicle-5yr+'] },
      email: {
        subject: '{{first_name}}, what is your [old model] worth today?',
        body: 'Hi {{first_name}},\n\nYour [old model] has been with you for a few years now. It has probably done a lot of kilometres, family trips and daily runs.\n\nBut as vehicles get older, servicing gets costlier, resale value drops a little more each year, and new models come with safety and mileage features that older ones simply do not have.\n\nIf you have been thinking about an upgrade, now may be a good time.\n\nAt {{business}}, we offer a free evaluation of your current vehicle, and its value can be adjusted directly against your new one. This month, there is also an exchange bonus of [exchange bonus] on selected models.\n\nThe process is simple:\n\nBring your vehicle for a 20-minute evaluation, or we come to you.\n\nWe give you a written exchange value.\n\nYou choose your new vehicle, and we handle the transfer paperwork.\n\nReply to this email to book your free evaluation.\n\nRegards,\n{{business}}',
      },
      whatsapp: {
        name: 'auto_exchange_upgrade', category: 'MARKETING',
        body: 'Hi {{1}}, thinking of upgrading your vehicle? 🚘\n\nGet a free evaluation of your current vehicle and an exchange bonus of {{2}} on selected new models this month. We handle all the transfer paperwork.\n\nWould you like to know what your vehicle is worth? Reply YES.',
        vars: [{ key: 'first_name', example: 'Manoj' }, { fill: 'Exchange bonus', example: 'up to ₹20,000' }],
        footer: STOP,
      },
      call: {
        goal: 'Book a free exchange evaluation',
        opening: 'Hello {{customer_name}}, {{business_name}} se bol raha hoon. Aapki gaadi ab kuch saal purani ho gayi hai — I am calling about our exchange offer.',
        script: [
          'We are offering a free evaluation of your current vehicle, and its value can go directly towards a new one.',
          'This month, there is also an exchange bonus on selected models.',
          'The evaluation takes about 20 minutes and we handle all the transfer paperwork.',
        ],
        questions: [
          'How many kilometres has your vehicle done?',
          'Which new model or segment are you interested in?',
          'Would you prefer a showroom visit or an evaluation at your home?',
        ],
        objections: [
          { said: 'My vehicle is running fine', reply: 'That is great. The evaluation is free and just tells you its value today — useful to know even if you decide to wait.' },
          { said: 'I will get a better price selling it myself', reply: 'Sometimes, yes. But exchange saves you the hassle of buyers, paperwork and transfer risk, plus you get the exchange bonus. Compare both and decide.' },
        ],
        closing: 'Thank you, {{customer_name}}. Your evaluation is booked and the details will come on WhatsApp.',
        outcomes: ['booked_evaluation', 'interested', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name'],
      },
    },
    {
      id: 'auto-service-due', name: 'Periodic service due', goal: 'Get the due service booked',
      when: '7 days before a vehicle’s periodic service is due',
      audience: { type: 'customers', tags: ['service-due'] },
      email: {
        subject: 'Your [model name] is due for service, {{first_name}}',
        body: 'Hi {{first_name}},\n\nAs per our records, your [model name] ([registration number]) is due for its periodic service on or around [service due date].\n\nRegular servicing keeps your vehicle safe, helps maintain mileage and keeps the manufacturer warranty valid.\n\nThis service typically includes:\n\nEngine oil and filter change, as per the service schedule.\n\nBrake, battery, tyre and suspension check.\n\nA full inspection with a report of anything that needs attention.\n\nBooking in advance means less waiting at the workshop. You can also ask for pick-up and drop from your home or office, where available.\n\nTo book a slot, simply reply to this email with a convenient day and time, or call our service desk.\n\nThank you for choosing {{business}}.\n\nRegards,\n{{business}} Service Team',
      },
      whatsapp: {
        name: 'auto_service_due', category: 'UTILITY',
        body: 'Hi {{1}}, your vehicle {{2}} is due for its periodic service around {{3}}.\n\nTo book a slot, reply with a convenient day and time. Pick-up and drop can be arranged where available.',
        vars: [{ key: 'first_name', example: 'Rajesh' }, { fill: 'Vehicle and registration', example: 'Swift MH12 AB 1234' }, { fill: 'Service due date', example: '28 October' }],
      },
      call: {
        goal: 'Book the periodic service',
        opening: 'Namaste {{customer_name}}, {{business_name}} service desk se bol rahe hain. Your {{model_name}} is due for its periodic service.',
        script: [
          'Regular service keeps the vehicle safe, maintains mileage and keeps your warranty valid.',
          'I can book a slot for you now so there is no waiting at the workshop.',
          'If you like, we can arrange pick-up and drop from your home or office.',
        ],
        questions: [
          'Which day and time suit you this week?',
          'Would you like pick-up and drop?',
          'Have you noticed any issue we should check — noise, brakes, AC?',
        ],
        objections: [
          { said: 'The vehicle has not run much', reply: 'Service is due by time as well as kilometres, because oil and parts age even when the vehicle stands. It also keeps your warranty valid.' },
          { said: 'Local mechanic is cheaper', reply: 'Understood. We use genuine parts and trained technicians, and the service is recorded for warranty. I can share an estimate so you can compare.' },
        ],
        closing: 'Thank you, {{customer_name}}. Your service slot is booked and you will get a confirmation on WhatsApp.',
        outcomes: ['service_booked', 'callback', 'already_serviced', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'model_name'],
      },
    },
    {
      id: 'auto-insurance-renewal', name: 'Insurance renewal', goal: 'Renew motor insurance through the dealership',
      when: '30 days before the vehicle’s insurance expires',
      audience: { type: 'customers', tags: ['insurance-due'] },
      email: {
        subject: '{{first_name}}, your vehicle insurance expires on [expiry date]',
        body: 'Hi {{first_name}},\n\nYour vehicle insurance for [vehicle and registration] expires on [expiry date].\n\nDriving without valid insurance is not allowed by law, and a lapse can also mean losing your No Claim Bonus, which you have built up over the years.\n\nRenewing with {{business}} makes it simple:\n\nWe compare quotes from multiple insurers for your vehicle.\n\nWe help you choose useful add-ons like zero depreciation, engine protection or roadside assistance.\n\nIf you ever need to claim, our service team helps with cashless repairs at our workshop.\n\nYour renewal quote is ready here: [link]\n\nA small tip: renewing a few days before expiry avoids a fresh vehicle inspection and keeps your cover continuous, with no gap even for a day.\n\nReply to this email if you have questions, or if you would like us to compare a different plan.\n\nRegards,\n{{business}}',
      },
      whatsapp: {
        name: 'auto_insurance_renewal', category: 'MARKETING',
        body: 'Hi {{1}}, your vehicle insurance expires on {{2}}. 🛡️\n\nRenew with us and we will compare quotes from multiple insurers, help you pick useful add-ons, and support you with cashless claims at our workshop.\n\nWould you like your renewal quote? Reply YES.',
        vars: [{ key: 'first_name', example: 'Deepak' }, { fill: 'Expiry date', example: '15 November' }],
        footer: STOP,
      },
      call: {
        goal: 'Renew the insurance policy',
        opening: 'Hello {{customer_name}}, {{business_name}} se bol rahi hoon. Your vehicle insurance expires soon, so I am calling to help you renew it on time.',
        script: [
          'Renewing before expiry protects your No Claim Bonus and keeps you covered.',
          'We compare quotes from several insurers and help you choose the right add-ons.',
          'If you ever need a claim, our workshop supports cashless repairs.',
        ],
        questions: [
          'Did you make any claim in the last year?',
          'Would you like zero depreciation or roadside assistance add-ons?',
          'Should I send the quote on WhatsApp to this number?',
        ],
        objections: [
          { said: 'I renew online myself', reply: 'That works too. We can still compare our quote with yours — and our advantage is help with cashless claims at our own workshop.' },
          { said: 'Premium is too high', reply: 'Let me compare other insurers and check which add-ons you really need. Sometimes the right combination lowers the premium.' },
        ],
        closing: 'Thank you, {{customer_name}}. I am sending your renewal quote on WhatsApp now.',
        outcomes: ['renewed', 'send_quote', 'interested', 'callback', 'not_interested'],
        variables: ['customer_name', 'business_name'],
      },
    },
  ],

  // ───────────────────────────── Events: wedding & event planners, photographers ─────────────────────────────
  events: [
    {
      id: 'events-date-enquiry', name: 'Date enquiry follow-up', goal: 'Book a planning call or meeting',
      when: 'Within an hour of a new date or package enquiry',
      audience: { type: 'leads' },
      email: {
        subject: '{{first_name}}, about your [event type] on [event date]',
        body: 'Hi {{first_name}},\n\nThank you for reaching out to {{business}}, and congratulations on the upcoming celebration!\n\nYou must be speaking to many vendors right now, so let me be clear and quick.\n\nFirst, the date. Popular dates in the wedding season get booked early, so I have pencilled in [event date] for you while we talk. It is not a commitment — it simply means we will not give it away without telling you.\n\nSecond, how we work. Every event is different, so we do not send a fixed rate card. We would like to understand your guest count, venue, functions and style, and then share a package that fits your budget.\n\nYou can see some of our recent work here: [portfolio link]\n\nThe next step is a 20-minute call or a meeting at our studio. Reply with a time that suits you, and we will come prepared with ideas.\n\nWarm regards,\n{{business}}',
      },
      whatsapp: {
        name: 'events_date_enquiry', category: 'MARKETING',
        body: 'Hi {{1}}, thank you for your enquiry, and congratulations! 🎉\n\nWe have noted {{2}} for you while we discuss. Every celebration is different, so we would love to understand your plans and share a package that fits your budget.\n\nWhen can we have a 20-minute call? Reply with a time that suits you.',
        vars: [{ key: 'first_name', example: 'Ananya' }, { fill: 'Event date', example: '8 December' }],
        footer: STOP,
      },
      call: {
        goal: 'Book a planning call or studio meeting',
        opening: 'Hello {{customer_name}}, main {{business_name}} se baat kar rahi hoon. Thank you for your enquiry, and congratulations on the celebration!',
        script: [
          'I wanted to understand your plans so we can suggest the right package.',
          'Popular dates fill up early in the season, so we have noted your date while we talk.',
          'The next step is a short meeting at our studio or a video call where we share ideas and a proposal.',
        ],
        questions: [
          'What is the event and the date — and is the date final?',
          'Roughly how many guests are you expecting?',
          'Have you finalised the venue and city?',
          'Which functions do you need us for — mehendi, sangeet, wedding, reception?',
          'Do you have a budget range in mind?',
        ],
        objections: [
          { said: 'Just collecting quotes for now', reply: 'Absolutely, that is the right way. A short meeting will help us give you an accurate package, so you compare properly. Shall I book one this week?' },
          { said: 'Your packages are expensive', reply: 'We can build a package around your budget — by choosing which functions and services matter most. Let us discuss what is important to you.' },
          { said: 'Need to check with family', reply: 'Of course — weddings are family decisions. Can we do the meeting when your family can join, maybe on the weekend?' },
        ],
        closing: 'Thank you, {{customer_name}}. Your meeting is booked and you will get a confirmation on WhatsApp.',
        outcomes: ['booked_meeting', 'interested', 'callback', 'date_unavailable', 'not_interested'],
        variables: ['customer_name', 'business_name'],
      },
    },
    {
      id: 'events-meeting-reminder', name: 'Meeting reminder', goal: 'Make sure the planning meeting happens',
      when: 'The day before a booked planning meeting or call',
      audience: { type: 'leads', tags: ['meeting-booked'] },
      email: {
        subject: 'Your planning meeting on [meeting date] is confirmed',
        body: 'Hi {{first_name}},\n\nThis is a reminder of your planning meeting with {{business}} on [meeting date and time].\n\nWhere: [studio address or video call link]\n\nTo make the most of our time together, it helps if you can share:\n\nThe dates and functions you are planning.\n\nThe venue, if it is decided, and an approximate guest count.\n\nAny photos, colours or themes you love — screenshots from Instagram or Pinterest are perfect.\n\nYour budget range, so we can suggest options that make sense.\n\nIf other family members are involved in decisions, they are welcome to join.\n\nIf the time no longer works for you, just reply to this email and we will find another slot.\n\nLooking forward to meeting you,\n{{business}}',
      },
      whatsapp: {
        name: 'events_meeting_reminder', category: 'UTILITY',
        body: 'Hi {{1}}, a reminder of your planning meeting on {{2}}.\n\nPlease bring your dates, guest count and any photos or themes you like.\n\nNeed to change the time? Just reply to this message.',
        vars: [{ key: 'first_name', example: 'Ananya' }, { fill: 'Meeting date, time and place', example: 'Sat, 13 Oct at 5 pm at our studio' }],
      },
      call: {
        goal: 'Confirm the planning meeting',
        opening: 'Hello {{customer_name}}, this is {{business_name}}. I am calling to confirm your planning meeting on {{visit_time}}.',
        script: [
          'We are looking forward to hearing your plans.',
          'Please bring your dates, guest count and any design ideas or photos you like.',
          'Family members who are part of the decision are welcome to join.',
        ],
        questions: [
          'Is the time still convenient?',
          'Will it be in person or on a video call?',
          'How many people will join from your side?',
        ],
        objections: [
          { said: 'Can you just send the package on WhatsApp?', reply: 'We can share a sample, but your package depends on functions, guests and venue. A short meeting makes it accurate — it takes only 30 minutes.' },
          { said: 'Need to reschedule', reply: 'No problem. Which other day this week would suit you?' },
        ],
        closing: 'Thank you, {{customer_name}}. Your meeting is confirmed. See you soon!',
        outcomes: ['confirmed', 'rescheduled', 'cancelled', 'callback', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'visit_time'],
      },
    },
    {
      id: 'events-proposal-followup', name: 'Proposal follow-up', goal: 'Turn a sent proposal into a confirmed booking',
      when: '2–3 days after sending a package or proposal',
      audience: { type: 'leads', tags: ['proposal-sent'] },
      email: {
        subject: '{{first_name}}, any thoughts on your [event type] proposal?',
        body: 'Hi {{first_name}},\n\nA few days ago we shared the proposal for your [event type]. I wanted to check what you and your family thought.\n\nAt this stage, families usually want to tweak a few things — add or remove a function, change the décor style, adjust the coverage hours, or bring the total closer to their budget. All of that is possible, and we would be happy to revise it.\n\nYou can view the proposal again here: [link]\n\nOne thing to keep in mind: we take a limited number of events on any single date, so that every celebration gets our full team. Your date is currently pencilled in for you, and a confirmed booking with an advance is what secures it.\n\nIf you have questions, reply to this email or tell us a convenient time to talk. We will make it simple.\n\nWarm regards,\n{{business}}',
      },
      whatsapp: {
        name: 'events_proposal_followup', category: 'MARKETING',
        body: 'Hi {{1}}, hope you had a chance to go through your proposal! ✨\n\nIf you want to change functions, décor, coverage or the budget, we can revise it quickly. Your date of {{2}} is pencilled in for you for now.\n\nShall we set up a quick call? Reply with a time that suits you.',
        vars: [{ key: 'first_name', example: 'Riya' }, { fill: 'Event date', example: '14 December' }],
        footer: STOP,
      },
      call: {
        goal: 'Get feedback and confirm the booking',
        opening: 'Namaste {{customer_name}}, {{business_name}} se bol rahi hoon. We shared your proposal a few days ago — what did you and your family think?',
        script: [
          'We can revise any part of it — functions, décor, coverage hours — to fit your plans and budget.',
          'We take limited events on one date, so a booking with an advance secures your date.',
          'I can send the revised proposal and the advance details on WhatsApp today.',
        ],
        questions: [
          'Is there anything you would like to change in the proposal?',
          'Does the total fit your budget?',
          'Who else needs to approve before you confirm?',
        ],
        objections: [
          { said: 'Another vendor quoted less', reply: 'That can happen. Please compare what is included — team size, hours, deliverables, décor quality. I can walk you through ours, and we can also see what we can adjust.' },
          { said: 'We will confirm closer to the date', reply: 'I understand. The only risk is that the date gets booked by someone else in peak season. An advance holds it for you.' },
          { said: 'Family has not decided yet', reply: 'Of course. Can we do a short call with your family this weekend to answer their questions?' },
        ],
        closing: 'Thank you, {{customer_name}}. I will send the revised proposal and next steps on WhatsApp.',
        outcomes: ['ready_to_book', 'revision_needed', 'interested', 'callback', 'not_interested'],
        variables: ['customer_name', 'business_name'],
      },
    },
    {
      id: 'events-advance-due', name: 'Advance / balance payment due', goal: 'Collect the due advance or instalment on time',
      when: '3 days before an advance or instalment is due',
      audience: { type: 'customers', tags: ['booked'] },
      email: {
        subject: 'Payment due for your [event type] on [due date]',
        body: 'Hi {{first_name}},\n\nThank you once again for choosing {{business}} for your [event type].\n\nThis is a reminder that the next payment of [amount due] is due on [due date], as per the schedule in your booking.\n\nYou can pay securely here: [payment link]\n\nOnce the payment is received, we will send you a receipt and move ahead with the next steps — vendor bookings, design finalisation and team scheduling — so that everything is on track for your day.\n\nIf you have already paid, please ignore this message, or reply with the transaction reference so we can update our records.\n\nIf you have any questions about the payment schedule, just reply to this email. We are happy to help.\n\nWarm regards,\n{{business}}',
      },
      whatsapp: {
        name: 'events_advance_due', category: 'UTILITY',
        body: 'Hi {{1}}, this is a reminder that the payment of {{2}} for your booking is due on {{3}}.\n\nYou can pay using the link we shared, and we will send you a receipt. If you have already paid, please reply with the transaction reference.',
        vars: [{ key: 'first_name', example: 'Riya' }, { fill: 'Amount due', example: '₹50,000' }, { fill: 'Due date', example: '20 October' }],
      },
      call: {
        goal: 'Remind about the payment due',
        opening: 'Hello {{customer_name}}, this is {{business_name}}. I am calling about the payment for your booking, due on {{due_date}}.',
        script: [
          'As per your booking schedule, the next payment of {{amount_due}} is due on {{due_date}}.',
          'I can resend the payment link on WhatsApp right now.',
          'Once received, we will send a receipt and move ahead with the next preparations.',
        ],
        questions: [
          'Shall I resend the payment link to this number?',
          'Have you already made the payment?',
          'Would you like any change in the payment mode?',
        ],
        objections: [
          { said: 'I have already paid', reply: 'Thank you! Could you share the transaction reference on WhatsApp? I will update our records and send the receipt.' },
          { said: 'Can I pay a few days later?', reply: 'Let me check with our team and confirm a new date on WhatsApp. We want your preparations to stay on track.' },
        ],
        closing: 'Thank you, {{customer_name}}. I am sending the link and details on WhatsApp now.',
        outcomes: ['will_pay', 'already_paid', 'needs_extension', 'callback', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'due_date', 'amount_due'],
      },
    },
    {
      id: 'events-wedding-season', name: 'Wedding season dates filling', goal: 'Get bookings for peak muhurat dates',
      when: 'Before the Nov–Feb wedding season opens (and before Apr–May)',
      audience: { type: 'leads', tags: ['wedding'] },
      email: {
        subject: '{{first_name}}, wedding season dates are getting booked',
        body: 'Hi {{first_name}},\n\nThe wedding season is around the corner, and the most popular muhurat dates are always the first to go — for venues, decorators, photographers and planners alike.\n\nIf you are planning a wedding or a pre-wedding function in the coming season, this is a good time to lock your team in.\n\nAt {{business}}, we take a limited number of events on each date so that every family gets our full attention. Here is what we offer this season: [season packages].\n\nSee some of our recent celebrations here: [portfolio link]\n\nBooking early also means more time to plan calmly — décor themes, timelines, guest experience — instead of rushing in the last few weeks.\n\nReply to this email with your dates and we will tell you our availability right away. If you are still finalising the date, we can share the season’s popular muhurat dates and help you plan around them.\n\nWarm regards,\n{{business}}',
      },
      whatsapp: {
        name: 'events_wedding_season', category: 'MARKETING',
        body: 'Hi {{1}}, the wedding season is here and popular muhurat dates are filling fast! 💐\n\nWe take a limited number of events per date so every family gets our full team. This season we are offering {{2}}.\n\nShare your dates and we will confirm availability right away.',
        vars: [{ key: 'first_name', example: 'Simran' }, { fill: 'Season packages', example: 'wedding packages starting at ₹1.5 lakh' }],
        footer: STOP,
      },
      call: {
        goal: 'Check dates and book a planning meeting',
        opening: 'Namaste {{customer_name}}, main {{business_name}} se bol raha hoon. Shaadi ka season aa gaya hai — I wanted to check if you have dates planned.',
        script: [
          'Popular muhurat dates in the season get booked early, for venues and vendors alike.',
          'We take a limited number of events per date so every family gets our full team.',
          'If you share your dates, I can tell you our availability right now and hold the date for you.',
        ],
        questions: [
          'Have you finalised the wedding date?',
          'In which city and venue is the wedding?',
          'Which functions are you planning?',
          'Roughly how many guests?',
        ],
        objections: [
          { said: 'Date is not final yet', reply: 'No problem. I can share the popular muhurat dates of the season and our availability, so you can plan around them.' },
          { said: 'We are planning on a small budget', reply: 'We have packages for intimate weddings too. Let us understand what matters most and build around that.' },
          { said: 'We already have a planner', reply: 'Wonderful. If you need any specific service — photography, décor or a function we can help with — please keep us in mind.' },
        ],
        closing: 'Thank you, {{customer_name}}. I will share our availability and packages on WhatsApp.',
        outcomes: ['booked_meeting', 'interested', 'send_details', 'callback', 'not_interested'],
        variables: ['customer_name', 'business_name'],
      },
    },
    {
      id: 'events-prewedding-shoot', name: 'Pre-wedding shoot offer', goal: 'Upsell a pre-wedding shoot to booked couples',
      when: '6–8 weeks before the wedding date',
      audience: { type: 'all', tags: ['wedding'] },
      email: {
        subject: '{{first_name}}, a pre-wedding shoot before the big day?',
        body: 'Hi {{first_name}},\n\nThe wedding day goes by in a blur — rituals, relatives, photos with every aunty. Couples often tell us they barely got a moment to themselves.\n\nA pre-wedding shoot gives you exactly that: a relaxed day, just the two of you, in a location you love. It is also the perfect way to get comfortable in front of the camera before the wedding.\n\nThis season, our pre-wedding shoot package includes [shoot package details].\n\nPopular choices include city landmarks, heritage forts, beaches, hill stations or simply a café that means something to you. We help with the concept, outfits and planning.\n\nThe photos are perfect for your wedding invite, a save-the-date video, or the big screen at the reception.\n\nSee some of our pre-wedding shoots here: [portfolio link]\n\nReply to this email, and we will share location ideas and available dates.\n\nWarm regards,\n{{business}}',
      },
      whatsapp: {
        name: 'events_prewedding_shoot', category: 'MARKETING',
        body: 'Hi {{1}}, planning a pre-wedding shoot before the big day? 📸\n\nA relaxed day for just the two of you, at a location you love, with photos perfect for invites and the reception screen. Our package includes {{2}}.\n\nWant location ideas and available dates? Reply YES.',
        vars: [{ key: 'first_name', example: 'Aditi' }, { fill: 'Shoot package', example: 'a full-day shoot, 2 outfits and a 1-minute teaser' }],
        footer: STOP,
      },
      call: {
        goal: 'Book a pre-wedding shoot',
        opening: 'Hello {{customer_name}}, {{business_name}} se bol rahi hoon. Congratulations on the upcoming wedding! I am calling about our pre-wedding shoot packages.',
        script: [
          'A pre-wedding shoot gives you a relaxed day together before the busy wedding days.',
          'The photos and teaser are perfect for invites, save-the-dates and the reception screen.',
          'We help with the concept, location and outfits, so you just enjoy the day.',
        ],
        questions: [
          'When is your wedding date?',
          'Do you have a location in mind — in the city or a short trip?',
          'Would you like only photos, or also a short video teaser?',
        ],
        objections: [
          { said: 'We do not have time before the wedding', reply: 'The shoot takes just one day, and we can plan it on a weekend that suits you both. Many couples find it a nice break from wedding planning.' },
          { said: 'It is an extra expense', reply: 'I understand. We have a shorter half-day package too. And the photos get used in invites and at the reception, so they serve more than one purpose.' },
        ],
        closing: 'Thank you, {{customer_name}}. I am sending location ideas and package details on WhatsApp.',
        outcomes: ['booked_shoot', 'interested', 'send_details', 'callback', 'not_interested'],
        variables: ['customer_name', 'business_name'],
      },
    },
    {
      id: 'events-review-referral', name: 'Post-event review & referral', goal: 'Get a Google review and referrals after the event',
      when: '1 week after the event or after photo delivery',
      audience: { type: 'customers' },
      email: {
        subject: '{{first_name}}, thank you for letting us be part of your day',
        body: 'Hi {{first_name}},\n\nIt was an honour to be part of your [event type]. Our team still talks about [special moment].\n\nWe hope you and your family are enjoying the memories. If anything is pending from our side — albums, edits, or any final details — please let us know and we will take care of it.\n\nI have two small requests.\n\nFirst, if you were happy with our work, would you share a short Google review? Families planning their own celebrations read these carefully, and your words truly help: [review link]\n\nSecond, if a friend, cousin or colleague is planning a wedding or event, we would be grateful for an introduction. We will take the same care of them as we did of you.\n\nThank you again for trusting {{business}} with such an important day.\n\nWith warm wishes,\n{{business}}',
      },
      whatsapp: {
        name: 'events_review_referral', category: 'MARKETING',
        body: 'Hi {{1}}, thank you for letting us be part of your celebration! 💛\n\nIf you were happy with our work, a short Google review would mean a lot to us. And if someone you know is planning an event, we would love an introduction.\n\nIf anything is pending from our side, just reply here.',
        vars: [{ key: 'first_name', example: 'Neha' }],
        footer: STOP,
      },
      call: {
        goal: 'Thank the client and ask for a review and referral',
        opening: 'Namaste {{customer_name}}, main {{business_name}} se bol rahi hoon. Thank you so much for letting us be part of your celebration!',
        script: [
          'I wanted to check if everything is fine and if anything is pending from our side.',
          'If you were happy with our work, a short Google review would help us a lot. I can send the link on WhatsApp.',
          'And if anyone you know is planning a wedding or event, we would be grateful for an introduction.',
        ],
        questions: [
          'How did you and your family feel about the event?',
          'Is anything pending — albums, edits, final details?',
          'Would you be comfortable leaving a Google review?',
        ],
        objections: [
          { said: 'We are still waiting for the album', reply: 'I am sorry for the wait. Let me check the status right now and update you on WhatsApp with a delivery date.' },
          { said: 'I am not comfortable writing reviews', reply: 'Completely understand. Even a star rating helps. No pressure at all — I will just send the link.' },
        ],
        closing: 'Thank you, {{customer_name}}. Wishing you and your family all the happiness. I am sending the link on WhatsApp.',
        outcomes: ['review_agreed', 'referral_shared', 'issue_reported', 'callback', 'not_interested'],
        variables: ['customer_name', 'business_name'],
      },
    },
  ],
};
