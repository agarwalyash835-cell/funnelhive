// Campaign templates: education, study abroad, coaches, consultants, SaaS — format in ../campaigntpl.js
const STOP = 'Reply STOP to opt out';

const education = [
  {
    id: 'education-new-enquiry', name: 'New enquiry follow-up', goal: 'Book a free demo class', when: 'Within an hour of a new enquiry',
    audience: { type: 'leads' },
    email: {
      subject: '{{first_name}}, your free demo class at {{business}}',
      body: 'Hi {{first_name}},\n\nThank you for asking about our [course name] batch. Choosing the right coaching is a big decision, and you should not have to decide it from a brochure.\n\nSo here is a simple suggestion: sit in one real class first. Free, no commitment.\n\nIn the demo class you will:\n- Learn one full topic the way we teach it every day\n- Meet the faculty and ask them anything\n- See how we handle doubts, tests and study material\n- Get your questions on fees, timings and batch size answered honestly\n\nParents are welcome to come along. Many of them say this one class told them more than ten phone calls.\n\nPick a time that suits you here: [link]\n\nIf you would rather talk first, just reply to this email with a good time to call. We will call you, not the other way round.\n\nWarm regards,\nTeam {{business}}',
    },
    whatsapp: {
      name: 'edu_new_enquiry', category: 'MARKETING',
      body: 'Hi {{1}}, thank you for your enquiry about our {{2}} course! 🎓\n\nBefore you decide, come and attend one free demo class. Meet the faculty, see how we teach and clear your doubts on fees and timings.\n\nReply YES and we will share this week’s demo slots.',
      vars: [{ key: 'first_name', example: 'Riya' }, { fill: 'Course name', example: 'NEET 2027' }], footer: STOP,
    },
    call: {
      goal: 'Book a free demo class',
      opening: 'Namaste {{customer_name}}, I am calling from {{business_name}}. You had enquired about our coaching recently, so I wanted to help you with the details. Is this a good time for two minutes?',
      script: [
        'Thank you! I just want to understand what you are preparing for, so I can suggest the right batch.',
        'We run a free demo class every week. You attend one real class, meet the teacher and see the study material yourself.',
        'There is no fee and no pressure. Most students and parents decide only after the demo, and that is exactly how it should be.',
        'Shall I book a demo slot for you this week? Weekday evening or weekend morning, which works better?',
      ],
      questions: ['Which exam or course are you preparing for?', 'Which class or year are you in right now?', 'Do you prefer offline classes at the centre or online?', 'When are you hoping to start?'],
      objections: [
        { said: 'Fees are too high', reply: 'I understand, fees matter. We also have instalment options. First attend the free demo and see if the teaching is worth it for you, then we can talk about the fee plan that fits.' },
        { said: 'I need to ask my parents', reply: 'Of course, that is the right thing to do. Parents are welcome at the demo class too. Shall I book a slot when both of you can come?' },
        { said: 'Just send the details on WhatsApp', reply: 'Sure, I will send the course details and demo timings on WhatsApp right after this call. Can I also block a tentative demo slot so you do not miss this week’s class?' },
      ],
      closing: 'Done! I have noted your demo slot and will send the details and location on WhatsApp. See you at the class. Thank you, {{customer_name}}!',
      outcomes: ['booked_demo', 'interested', 'callback', 'not_interested', 'wrong_number'],
      variables: ['customer_name', 'business_name'],
    },
  },
  {
    id: 'education-demo-reminder', name: 'Demo class reminder', goal: 'Make sure the student turns up for the demo', when: 'A day before and on the morning of the demo class',
    audience: { type: 'leads', tags: ['demo-booked'] },
    email: {
      subject: 'Reminder: your demo class at {{business}} on [demo date]',
      body: 'Hi {{first_name}},\n\nThis is a quick reminder about the free demo class you booked with us.\n\nDate and time: [demo date and time]\nPlace: [centre address or online class link]\n\nA few things that will help:\n- Please come 10 minutes early so we can settle you in before the class starts\n- Bring a notebook and a pen; we will give you the class notes\n- Parents are welcome to join and meet the faculty after the class\n- Keep your questions ready about the syllabus, tests and timings\n\nThe class runs for about [duration]. After it, our counsellor will be available if you want to talk about batches or fees. There is no obligation at all.\n\nIf the time no longer suits you, just reply to this email and we will move your demo to another day.\n\nSee you soon,\nTeam {{business}}',
    },
    whatsapp: {
      name: 'edu_demo_reminder', category: 'UTILITY',
      body: 'Hi {{1}}, this is a reminder of your demo class on {{2}}.\n\nVenue: {{3}}\n\nPlease arrive 10 minutes early and bring a notebook. If you need to change the time, reply to this message.',
      vars: [{ key: 'first_name', example: 'Aarav' }, { fill: 'Demo class date and time', example: 'Sat, 12 Oct at 11 am' }, { fill: 'Centre address or class link', example: '2nd floor, Sector 18 Market, Noida' }],
    },
    call: {
      goal: 'Confirm the student will attend the demo class',
      opening: 'Hello {{customer_name}}, this is {{business_name}}. I am calling about your demo class on {{demo_date}}. Just two minutes?',
      script: [
        'I wanted to confirm that you are still coming for the demo class.',
        'Please reach 10 minutes early and bring a notebook. Parents are welcome too.',
        'If the time does not suit you now, I can move it to another day right away.',
      ],
      questions: ['Will you be able to attend at the booked time?', 'Will a parent be coming along with you?', 'Do you need the location or online link again?'],
      objections: [
        { said: 'I have school or college at that time', reply: 'No problem at all. We have a weekend slot as well. Shall I move your demo to Saturday or Sunday?' },
        { said: 'I am not sure I want to join', reply: 'That is completely fine. The demo is only to help you decide. There is no fee and no commitment, so you lose nothing by attending.' },
      ],
      closing: 'Perfect, your demo is confirmed. I will send the details on WhatsApp once more. See you then, {{customer_name}}!',
      outcomes: ['confirmed', 'rescheduled', 'cancelled', 'callback', 'wrong_number'],
      variables: ['customer_name', 'business_name', 'demo_date'],
    },
  },
  {
    id: 'education-missed-demo', name: 'Missed demo win-back', goal: 'Rebook students who missed their demo class', when: 'The day after a booked demo class was missed',
    audience: { type: 'leads', tags: ['demo-missed'] },
    email: {
      subject: 'We missed you at the demo class, {{first_name}}',
      body: 'Hi {{first_name}},\n\nWe kept a seat for you at yesterday’s demo class, but it looks like you could not make it. No worries at all. Exams, school, travel, traffic; we understand how packed a student’s day is.\n\nThe good news is that your free demo is still open. You can choose another slot this week, at the centre or online, whichever is easier.\n\nOne honest request: do attend one class before you decide on any coaching, ours or anyone else’s. Brochures and toppers’ photos all look the same. A real class shows you how the teacher explains, how doubts are handled and whether the pace suits you.\n\nPick a new slot here: [link]\n\nOr simply reply with a day and time, and we will fix it for you.\n\nWarm regards,\nTeam {{business}}',
    },
    whatsapp: {
      name: 'edu_missed_demo', category: 'MARKETING',
      body: 'Hi {{1}}, we missed you at the demo class! No problem, your free demo is still open. 😊\n\nWe have new slots for {{2}} this week, at the centre or online. Reply with a day that suits you and we will book it.',
      vars: [{ key: 'first_name', example: 'Sneha' }, { fill: 'Course name', example: 'JEE Main 2027' }], footer: STOP,
    },
    call: {
      goal: 'Rebook the missed demo class',
      opening: 'Namaste {{customer_name}}, I am calling from {{business_name}}. You had booked a demo class with us but could not come. Is everything okay?',
      script: [
        'That is completely fine, it happens. I just wanted to make sure you do not miss the chance to try a class.',
        'Your free demo is still available. We have slots on weekdays and weekends, and online too.',
        'Shall I book a new slot for you right now so it is fixed?',
      ],
      questions: ['What stopped you from coming last time, timing or something else?', 'Which day and time would be easier this week?', 'Would an online demo be more convenient?'],
      objections: [
        { said: 'I have joined another coaching', reply: 'Good that you have started! If you ever want a second opinion or a test series, we are here. Can I share our test series details on WhatsApp?' },
        { said: 'The centre is too far from my home', reply: 'I understand. We also run live online classes with the same faculty. Would you like to try the online demo instead?' },
        { said: 'I will come later', reply: 'Sure. Batches fill up close to the start date, so shall I hold a slot for this weekend? You can always change it.' },
      ],
      closing: 'Great, your new demo slot is booked. I will send the details on WhatsApp. See you there, {{customer_name}}!',
      outcomes: ['booked_demo', 'callback', 'joined_elsewhere', 'not_interested', 'wrong_number'],
      variables: ['customer_name', 'business_name'],
    },
  },
  {
    id: 'education-last-seats', name: 'New batch: last seats', goal: 'Fill the remaining seats in a starting batch', when: '7–10 days before a new batch starts',
    audience: { type: 'leads' },
    email: {
      subject: 'The [course name] batch starts on [batch start date]',
      body: 'Hi {{first_name}},\n\nOur new [course name] batch starts on [batch start date], and admissions for it close once the seats are full.\n\nWe keep our batches small on purpose. A teacher who knows every student by name notices when someone is stuck, and that is where marks are won or lost.\n\nHere is what you get in this batch:\n- Regular classes with experienced faculty\n- Weekly tests with a detailed performance report\n- Daily doubt-clearing support\n- Printed study material and a full test series\n- Monthly parent-teacher updates\n\nIf you have been thinking about joining, this is the right time. Starting with the batch means you do not have to catch up on missed chapters later.\n\nReserve your seat here: [link]\n\nHave a question about fees or timings? Reply to this email and our counsellor will call you.\n\nAll the best,\nTeam {{business}}',
    },
    whatsapp: {
      name: 'edu_last_seats', category: 'MARKETING',
      body: 'Hi {{1}}, our new {{2}} batch starts on {{3}} and only a few seats are left. 📚\n\nSmall batch, weekly tests, daily doubt support and full study material.\n\nReply SEAT to reserve your place or to ask about fees and timings.',
      vars: [{ key: 'first_name', example: 'Karan' }, { fill: 'Course name', example: 'UPSC Foundation' }, { fill: 'Batch start date', example: '4 November' }], footer: STOP,
    },
    call: {
      goal: 'Get the student to reserve a seat in the new batch',
      opening: 'Namaste {{customer_name}}, this is {{business_name}}. Our new batch is starting soon and I wanted to check if you would like a seat before it fills up.',
      script: [
        'The batch starts on {{batch_date}}. We keep batches small so every student gets personal attention.',
        'You get regular classes, weekly tests with reports, daily doubt sessions and full study material.',
        'Joining from the first day helps a lot; you do not have to catch up on chapters later.',
        'Shall I reserve a seat for you? You can complete the admission at the centre or online.',
      ],
      questions: ['Are you still planning to start coaching this term?', 'Would you prefer the morning or evening batch?', 'Is there anything stopping you from joining right now?'],
      objections: [
        { said: 'Fees are too high', reply: 'I understand. We have an instalment plan, so you do not have to pay the full fee at once. Shall I share the instalment details?' },
        { said: 'I need to ask my parents', reply: 'Absolutely. Would it help if our counsellor speaks to your parents directly? I can arrange a call at a time convenient for them.' },
        { said: 'I will join the next batch', reply: 'That is possible, but the next batch starts much later and you would lose those weeks of preparation. Can I at least hold a seat for two days while you decide?' },
      ],
      closing: 'Thank you! I have noted your seat request and will send the admission details on WhatsApp. Welcome to {{business_name}}!',
      outcomes: ['seat_reserved', 'interested', 'callback', 'not_interested', 'wrong_number'],
      variables: ['customer_name', 'business_name', 'batch_date'],
    },
  },
  {
    id: 'education-fee-instalment', name: 'Fee instalment reminder', goal: 'Collect the next fee instalment on time', when: '5 days before and on the instalment due date',
    audience: { type: 'customers', tags: ['fee-due'] },
    email: {
      subject: 'Fee instalment due on [due date], {{first_name}}',
      body: 'Hi {{first_name}},\n\nThis is a friendly reminder that the next fee instalment for your course at {{business}} is due soon.\n\nAmount due: [amount]\nDue date: [due date]\n\nYou can pay online using this link: [payment link]\n\nYou can also pay by UPI, card or cash at the centre office between 10 am and 6 pm. Please keep your student ID or registered phone number handy so we can match the payment quickly.\n\nOnce the payment is received, we will send you the receipt on email and WhatsApp.\n\nIf you have already paid, thank you, and please ignore this message. If you are facing any difficulty with the payment or need a few extra days, just reply to this email. We would much rather talk it through with you than let it affect your studies.\n\nThank you,\nAccounts Team, {{business}}',
    },
    whatsapp: {
      name: 'edu_fee_instalment', category: 'UTILITY',
      body: 'Hi {{1}}, your fee instalment of {{2}} is due on {{3}}.\n\nYou can pay online here: {{4}} or by UPI or cash at the centre office.\n\nIf you have already paid, please ignore this message. Reply here if you need any help.',
      vars: [{ key: 'first_name', example: 'Pooja' }, { fill: 'Instalment amount', example: '₹12,500' }, { fill: 'Due date', example: '10 November' }, { fill: 'Payment link', example: 'https://rzp.io/l/abc123' }],
    },
    call: {
      goal: 'Remind about the fee instalment and get a payment date',
      opening: 'Hello {{customer_name}}, this is {{business_name}} accounts team. I am calling about the fee instalment due on {{due_date}}. Is this a good time?',
      script: [
        'This is just a reminder that your next instalment is due soon.',
        'You can pay through the link we sent on WhatsApp, by UPI, or at the centre office.',
        'Could you tell me when you will be able to make the payment, so I can update our records?',
      ],
      questions: ['Have you already made this payment?', 'On which date can you complete the payment?', 'Would you like the payment link sent again?'],
      objections: [
        { said: 'I already paid', reply: 'Thank you! Could you share the transaction ID or a screenshot on WhatsApp? I will match it and send your receipt.' },
        { said: 'I need a few more days', reply: 'I understand. Please tell me a date that works for you and I will note it, so you do not get repeated reminders.' },
        { said: 'My parents handle the fees', reply: 'No problem. Could you share a good time to call them, or shall I send the details on WhatsApp for them?' },
      ],
      closing: 'Thank you, {{customer_name}}. I have noted it and will send the payment details on WhatsApp. Have a good day!',
      outcomes: ['paid', 'promised_date', 'callback', 'dispute', 'wrong_number'],
      variables: ['customer_name', 'business_name', 'due_date'],
    },
  },
  {
    id: 'education-results-toppers', name: 'Results and toppers push', goal: 'Turn result-day pride into new admissions', when: 'Within a week of exam results',
    audience: { type: 'all' },
    email: {
      subject: 'Our students’ [exam name] results are out',
      body: 'Hi {{first_name}},\n\nThe [exam name] results are out, and we are very proud of our students at {{business}}.\n\n[Result highlight, e.g. names of toppers and their scores, or how many students cleared]\n\nBehind every result is a very ordinary routine done well: attending classes, taking every weekly test, and not leaving doubts for later. Our toppers were not born toppers. Most of them started exactly where you are today, unsure and a little worried.\n\nIf you are preparing for the next attempt, this is the best time to start. The students who begin early get the full syllabus done with enough time for revision and mock tests.\n\nCome and meet our faculty, see the toppers’ study plans and attend a free demo class.\n\nBook your visit here: [link]\n\nCongratulations to every student who gave it their best.\n\nTeam {{business}}',
    },
    whatsapp: {
      name: 'edu_results_toppers', category: 'MARKETING',
      body: 'Hi {{1}}, our students have done us proud in {{2}}! 🏆\n\nWant to start your preparation the same way? Come for a free demo class, meet the faculty and see the study plan our toppers followed.\n\nReply DEMO to book a slot.',
      vars: [{ key: 'first_name', example: 'Rohan' }, { fill: 'Exam and year', example: 'NEET 2026' }], footer: STOP,
    },
    call: {
      goal: 'Invite the lead for a demo class after results',
      opening: 'Namaste {{customer_name}}, this is {{business_name}}. Our students’ results have just come out and we are calling a few students who had enquired with us earlier.',
      script: [
        'Many of our students did very well this year, and most of them started preparing early.',
        'We have started admissions for the next batch and are inviting students for a free demo class.',
        'You can meet the faculty, see the study plan our toppers followed and ask all your questions.',
        'Would you like to book a demo slot this week?',
      ],
      questions: ['Are you appearing for the exam next year?', 'Have you started any coaching yet?', 'Do you prefer offline or online classes?'],
      objections: [
        { said: 'Every coaching shows toppers', reply: 'You are right, and you should not decide on toppers alone. That is why we suggest one free demo class. Judge us on the teaching, not the posters.' },
        { said: 'Fees are too high', reply: 'I understand. We have instalment options and also a scholarship test. Shall I share the details on WhatsApp?' },
        { said: 'Send me the details on WhatsApp', reply: 'Sure, I will send them right away. Can I also block a demo slot for you this weekend so you can see a class yourself?' },
      ],
      closing: 'Thank you, {{customer_name}}. I will send the details on WhatsApp. All the best for your preparation!',
      outcomes: ['booked_demo', 'interested', 'callback', 'not_interested', 'wrong_number'],
      variables: ['customer_name', 'business_name'],
    },
  },
  {
    id: 'education-new-session-offer', name: 'New session early-bird admission', goal: 'Get early admissions for the new academic session', when: 'Diwali to January, before the new session batches',
    audience: { type: 'all' },
    email: {
      subject: '{{first_name}}, early-bird admissions for the new session are open',
      body: 'Hi {{first_name}},\n\nThis festive season, we have opened early admissions for our new session batches at {{business}}.\n\nWhy start early? Because the students who do well are rarely the ones who studied the hardest in the last three months. They are the ones who started on time, revised calmly and walked into the exam hall without panic.\n\nStudents who take admission before [offer end date] get our early-bird benefit: [early-bird offer, e.g. fee discount or free test series].\n\nWhat stays the same for every student:\n- Experienced faculty and small batches\n- Weekly tests with clear performance reports\n- Doubt support every day\n- Regular updates for parents\n\nCome and visit the centre with your parents, or book a free demo class first: [link]\n\nWishing you and your family a very happy festive season.\n\nTeam {{business}}',
    },
    whatsapp: {
      name: 'edu_new_session_offer', category: 'MARKETING',
      body: 'Hi {{1}}, happy festive season from all of us! 🪔\n\nEarly-bird admissions for our new session batches are now open. Join before {{2}} and get {{3}} with your admission.\n\nReply YES to book a free demo class or a visit to the centre.',
      vars: [{ key: 'first_name', example: 'Ananya' }, { fill: 'Offer end date', example: '15 November' }, { fill: 'Early-bird benefit', example: 'a free full test series' }], footer: STOP,
    },
    call: {
      goal: 'Book a centre visit or demo for the new session',
      opening: 'Namaste {{customer_name}}, festive greetings from {{business_name}}! I am calling because early-bird admissions for our new session have opened.',
      script: [
        'Students who start early finish the syllabus on time and get enough time for revision and mock tests.',
        'If you take admission before the early-bird date, you also get our early-bird benefit.',
        'The best first step is a free demo class or a visit to the centre with your parents.',
        'Shall I book a visit for you this week?',
      ],
      questions: ['Which class will you be in next session?', 'Which exam or subjects do you want coaching for?', 'When can you and your parents visit the centre?'],
      objections: [
        { said: 'It is too early to start', reply: 'Many students feel that, but starting early is what lowers the pressure later. You can attend the demo now and decide calmly.' },
        { said: 'I need to ask my parents', reply: 'Of course. Shall I book a visit when your parents can also come? Our counsellor will answer all their questions.' },
        { said: 'Fees are too high', reply: 'I understand. The early-bird benefit and instalment plan make it easier. Can I send you the fee details on WhatsApp?' },
      ],
      closing: 'Wonderful, I have noted it and will send the details on WhatsApp. Happy festive season, {{customer_name}}!',
      outcomes: ['booked_visit', 'booked_demo', 'interested', 'callback', 'not_interested'],
      variables: ['customer_name', 'business_name'],
    },
  },
];

const abroad = [
  {
    id: 'abroad-free-counselling', name: 'Free profile evaluation', goal: 'Book a free counselling session', when: 'Within an hour of a new study-abroad enquiry',
    audience: { type: 'leads' },
    email: {
      subject: '{{first_name}}, let’s look at your study-abroad profile together',
      body: 'Hi {{first_name}},\n\nThank you for reaching out to {{business}} about studying abroad.\n\nThe hardest part of this journey is not the application. It is choosing the right country, course and university for your marks, budget and career plan, and doing it before the deadlines close.\n\nThat is why we start every student with a free one-on-one profile evaluation. In about 30 minutes, our counsellor will:\n- Review your academics, test scores and work experience\n- Suggest countries and universities that genuinely fit your profile\n- Give you a realistic estimate of tuition and living costs\n- Explain scholarships, education loans and the intake timelines\n\nThere is no charge and no obligation. You will leave with a clear plan, whether you apply with us or not.\n\nBook your session here: [link]\n\nPlease keep your mark sheets and any test scores handy.\n\nWarm regards,\nTeam {{business}}',
    },
    whatsapp: {
      name: 'abroad_free_counselling', category: 'MARKETING',
      body: 'Hi {{1}}, thank you for your interest in studying in {{2}}! ✈️\n\nBook a free profile evaluation with our counsellor. We will suggest universities that fit your marks and budget, and explain costs, scholarships and intake dates.\n\nReply YES to pick a time.',
      vars: [{ key: 'first_name', example: 'Priya' }, { fill: 'Country', example: 'Canada' }], footer: STOP,
    },
    call: {
      goal: 'Book a free profile evaluation session',
      opening: 'Hello {{customer_name}}, I am calling from {{business_name}}. You had enquired about studying abroad, so I wanted to understand your plans. Do you have two minutes?',
      script: [
        'Thank you. A few quick questions so our counsellor can prepare for you.',
        'We offer a free profile evaluation where our counsellor suggests countries and universities that fit your marks and budget.',
        'You will also get a clear idea of total costs, scholarships, loans and the intake deadlines.',
        'Shall I book your session? We have slots this week in person and on video call.',
      ],
      questions: ['Which country or countries are you considering?', 'Which course and level, bachelor’s or master’s?', 'Have you taken IELTS, PTE, TOEFL or GRE yet?', 'Which intake are you aiming for?'],
      objections: [
        { said: 'It will be too expensive', reply: 'That is a common worry. Costs vary a lot by country and university, and there are scholarships and education loans. The session will give you real numbers for your budget.' },
        { said: 'I need to discuss with my parents', reply: 'Absolutely, parents should be part of this. We can do the session on a video call so they can join from home. Which day suits your family?' },
        { said: 'Send me the details on WhatsApp', reply: 'Sure, I will send them now. But every profile is different, so a 30-minute session will save you a lot of searching. Shall I hold a slot for you?' },
      ],
      closing: 'Your session is booked. I will send the details and a document checklist on WhatsApp. Thank you, {{customer_name}}!',
      outcomes: ['booked_session', 'interested', 'callback', 'not_interested', 'wrong_number'],
      variables: ['customer_name', 'business_name'],
    },
  },
  {
    id: 'abroad-session-reminder', name: 'Counselling session reminder', goal: 'Make sure the student attends the counselling session', when: 'A day before and 2 hours before the session',
    audience: { type: 'leads', tags: ['session-booked'] },
    email: {
      subject: 'Reminder: your counselling session on [session date]',
      body: 'Hi {{first_name}},\n\nThis is a reminder about your profile evaluation session with {{business}}.\n\nDate and time: [session date and time]\nWhere: [office address or video call link]\n\nTo get the most out of the session, please keep these ready:\n- Class 10 and 12 mark sheets, and degree mark sheets if you have them\n- IELTS, PTE, TOEFL, GRE or GMAT scores, if taken\n- Your passport, if you have one\n- Work experience letters, if any\n- A rough idea of your budget\n\nDo not worry if you do not have everything yet. Bring what you have and our counsellor will guide you on the rest.\n\nParents are welcome to join; many families find it helpful to hear about costs and timelines together.\n\nIf you need to change the time, just reply to this email.\n\nSee you soon,\nTeam {{business}}',
    },
    whatsapp: {
      name: 'abroad_session_reminder', category: 'UTILITY',
      body: 'Hi {{1}}, this is a reminder of your counselling session on {{2}}.\n\nJoin here: {{3}}\n\nPlease keep your mark sheets, test scores and passport handy. Reply here if you need to change the time.',
      vars: [{ key: 'first_name', example: 'Harsh' }, { fill: 'Session date and time', example: 'Mon, 14 Oct at 5 pm' }, { fill: 'Office address or video link', example: 'Office 304, FC Road, Pune' }],
    },
    call: {
      goal: 'Confirm attendance at the counselling session',
      opening: 'Hello {{customer_name}}, this is {{business_name}}. I am calling about your counselling session on {{session_date}}. Do you have a minute?',
      script: [
        'I just wanted to confirm that you will be joining the session.',
        'Please keep your mark sheets, test scores and passport ready if you have them.',
        'If the timing does not work now, I can move it for you.',
      ],
      questions: ['Will you be able to join at the booked time?', 'Will your parents be joining as well?', 'Do you need the address or video link again?'],
      objections: [
        { said: 'I do not have all my documents yet', reply: 'That is fine. Bring whatever you have; the counsellor will tell you exactly what is needed and by when.' },
        { said: 'I am busy at that time', reply: 'No problem. Tell me a time that suits you this week and I will reschedule it right now.' },
      ],
      closing: 'Thank you, your session is confirmed. I will resend the details on WhatsApp. Talk soon, {{customer_name}}!',
      outcomes: ['confirmed', 'rescheduled', 'cancelled', 'callback', 'wrong_number'],
      variables: ['customer_name', 'business_name', 'session_date'],
    },
  },
  {
    id: 'abroad-intake-deadline', name: 'Intake deadline alert', goal: 'Get students to start applications before deadlines', when: '6–8 weeks before major application deadlines',
    audience: { type: 'leads' },
    email: {
      subject: '[intake name] deadlines are coming up, {{first_name}}',
      body: 'Hi {{first_name}},\n\nA quick heads-up: application deadlines for the [intake name] intake are coming up at many universities, and the good programmes close first.\n\nA strong application takes more time than most students expect. You will need your transcripts, a statement of purpose, recommendation letters, test scores and, later, financial documents for the visa. Rushing any of these is where most applications get weaker.\n\nIf you start now, you still have time to:\n- Shortlist universities that match your profile and budget\n- Write a statement of purpose that sounds like you, not a template\n- Apply early, which can help with scholarships at some universities\n- Plan your education loan and visa documents calmly\n\nOur counsellors at {{business}} can review where you stand and give you a week-by-week plan.\n\nBook a free session here: [link]\n\nBest wishes,\nTeam {{business}}',
    },
    whatsapp: {
      name: 'abroad_intake_deadline', category: 'MARKETING',
      body: 'Hi {{1}}, application deadlines for the {{2}} intake are coming up at many universities. ⏳\n\nStarting now gives you time for a strong SOP, the right shortlist and your loan and visa paperwork.\n\nReply PLAN and our counsellor will share a week-by-week plan for you.',
      vars: [{ key: 'first_name', example: 'Nikhil' }, { fill: 'Intake name', example: 'September 2027' }], footer: STOP,
    },
    call: {
      goal: 'Book a session to start applications before the deadline',
      opening: 'Hello {{customer_name}}, I am calling from {{business_name}}. Application deadlines for the upcoming intake are getting close, and I wanted to check where you are with your plans.',
      script: [
        'Many good universities close their applications early, and some give scholarships to early applicants.',
        'A good application needs time: shortlisting, SOP, recommendations and documents.',
        'Our counsellor can review your profile and give you a clear week-by-week plan.',
        'Shall I book a session this week so you do not miss the deadlines?',
      ],
      questions: ['Which intake are you planning for?', 'Have you shortlisted any universities yet?', 'Is your English test done or still pending?'],
      objections: [
        { said: 'I will apply for the next intake', reply: 'That is an option, but waiting means losing time and sometimes scholarship chances. Let us at least check if this intake is realistic for you. The session is free.' },
        { said: 'My IELTS is not done yet', reply: 'Many universities let you apply and submit scores later. The counsellor will tell you which ones, and help you plan the test date.' },
        { said: 'I can apply on my own', reply: 'Of course you can. Many students still find a second look at their shortlist and SOP useful. The session costs nothing.' },
      ],
      closing: 'Your session is booked, {{customer_name}}. I will send the details and a document checklist on WhatsApp. Thank you!',
      outcomes: ['booked_session', 'interested', 'callback', 'next_intake', 'not_interested'],
      variables: ['customer_name', 'business_name'],
    },
  },
  {
    id: 'abroad-test-prep-batch', name: 'IELTS / PTE batch enrolment', goal: 'Fill the next IELTS or PTE coaching batch', when: '1–2 weeks before a new test-prep batch starts',
    audience: { type: 'leads' },
    email: {
      subject: 'New [test name] batch starting [batch start date]',
      body: 'Hi {{first_name}},\n\nYour English test score decides more than you might think: which universities you can apply to, whether you get a visa smoothly, and sometimes even scholarship chances.\n\nOur next [test name] batch at {{business}} starts on [batch start date].\n\nWhat the batch covers:\n- All four modules: listening, reading, writing and speaking\n- Regular full-length mock tests in real exam conditions\n- One-on-one feedback on your writing tasks\n- Speaking practice with a trainer, not just recordings\n- Flexible morning, evening and weekend timings\n\nBefore you join, take a free diagnostic test. It shows where you stand today and how much preparation you really need, so you do not spend weeks on what you already know.\n\nBook your free diagnostic test and reserve a seat here: [link]\n\nAll the best,\nTeam {{business}}',
    },
    whatsapp: {
      name: 'abroad_test_prep_batch', category: 'MARKETING',
      body: 'Hi {{1}}, our new {{2}} batch starts on {{3}}! 📝\n\nAll four modules, full mock tests and personal feedback on writing and speaking.\n\nTake a free diagnostic test first to see where you stand. Reply TEST to book it.',
      vars: [{ key: 'first_name', example: 'Simran' }, { fill: 'Test name', example: 'IELTS Academic' }, { fill: 'Batch start date', example: '28 October' }], footer: STOP,
    },
    call: {
      goal: 'Book a free diagnostic test and enrol in the batch',
      opening: 'Hello {{customer_name}}, this is {{business_name}}. I am calling about our new IELTS and PTE batch starting soon. Have you taken your English test yet?',
      script: [
        'Your score affects your university options and your visa, so it is worth preparing properly.',
        'Our batch covers all four modules with mock tests and personal feedback on writing and speaking.',
        'We suggest starting with a free diagnostic test to see where you stand today.',
        'Shall I book the diagnostic test for you this week?',
      ],
      questions: ['Which test are you planning to take, IELTS, PTE or TOEFL?', 'What score do your target universities need?', 'When are you planning to give the exam?', 'Which timing suits you, morning, evening or weekend?'],
      objections: [
        { said: 'I will prepare on my own using YouTube', reply: 'Many students start that way. The diagnostic test is free and will show if self-study is enough, or which module needs a trainer.' },
        { said: 'Fees are too high', reply: 'I understand. We have module-wise and short crash options as well. After the diagnostic, the trainer can suggest only what you actually need.' },
        { said: 'Send me the details on WhatsApp', reply: 'Sure, sending now. Can I also block a diagnostic test slot for you, so you know your level before deciding?' },
      ],
      closing: 'Done! Your diagnostic test is booked. I will send the details on WhatsApp. Best of luck, {{customer_name}}!',
      outcomes: ['booked_test', 'enrolled', 'interested', 'callback', 'not_interested'],
      variables: ['customer_name', 'business_name'],
    },
  },
  {
    id: 'abroad-documents-pending', name: 'Pending documents reminder', goal: 'Collect pending documents for an active application', when: 'When documents are pending for 3+ days',
    audience: { type: 'customers', tags: ['documents-pending'] },
    email: {
      subject: 'Documents pending for your application, {{first_name}}',
      body: 'Hi {{first_name}},\n\nWe are working on your application, and we are waiting for a few documents from you before we can move to the next step.\n\nDocuments pending:\n[list of pending documents]\n\nPlease send them by [due date]. You can upload them here: [upload link], or reply to this email with clear scans or photos.\n\nA few tips so nothing gets rejected:\n- Scan the full page, with all four corners visible\n- Make sure names match your passport exactly\n- Send PDFs where possible, one document per file\n- If a document is in a language other than English, include the translation\n\nIf you are stuck on any document, such as a recommendation letter or a bank statement, reply to this email and your counsellor will guide you. It is always better to ask early than to miss a deadline.\n\nThank you,\nTeam {{business}}',
    },
    whatsapp: {
      name: 'abroad_documents_pending', category: 'UTILITY',
      body: 'Hi {{1}}, we are waiting for a few documents to continue your application: {{2}}.\n\nPlease share them by {{3}} by replying here with clear scans or PDFs.\n\nIf you need help with any document, reply and your counsellor will call you.',
      vars: [{ key: 'first_name', example: 'Aditya' }, { fill: 'Pending documents', example: 'passport copy and 12th mark sheet' }, { fill: 'Due date', example: '20 October' }],
    },
    call: {
      goal: 'Get a date for the pending documents',
      opening: 'Hello {{customer_name}}, this is {{business_name}}. I am calling about a few documents we need to continue your application. Is this a good time?',
      script: [
        'Your application is ready to move forward once we receive the pending documents.',
        'I will send the exact list on WhatsApp after this call.',
        'Could you tell me by when you will be able to share them?',
      ],
      questions: ['Have you been able to collect the pending documents?', 'Is there any document you are finding difficult to arrange?', 'By which date can you send them?'],
      objections: [
        { said: 'My college has not issued the transcript yet', reply: 'That happens often. Please share the request receipt with us; some universities accept it for now. Your counsellor will check.' },
        { said: 'I am waiting for the bank letter', reply: 'Okay. Please share whatever bank statements you have now, and the letter when it comes. I will note the expected date.' },
      ],
      closing: 'Thank you, {{customer_name}}. I have noted the date and will send the list on WhatsApp. We will keep your application moving.',
      outcomes: ['documents_promised', 'documents_sent', 'needs_help', 'callback', 'wrong_number'],
      variables: ['customer_name', 'business_name'],
    },
  },
  {
    id: 'abroad-university-fair', name: 'University fair invitation', goal: 'Get registrations for a university fair or seminar', when: '2 weeks before a university fair, seminar or spot-admission day',
    audience: { type: 'all' },
    email: {
      subject: 'Meet university representatives in person on [event date]',
      body: 'Hi {{first_name}},\n\nYou are invited to our study-abroad fair at {{business}} on [event date].\n\nThis is a chance to talk directly to university representatives and ask the questions that websites never answer properly: what the course is really like, what kind of jobs graduates get, and which scholarships you can actually apply for.\n\nAt the fair you can:\n- Meet representatives from universities in [countries]\n- Get your profile reviewed on the spot\n- Learn about scholarships, education loans and visa steps\n- Ask about part-time work and life as a student there\n\nEntry is free, but registration is required so we can plan your time with the right universities.\n\nRegister here: [link]\n\nBring your mark sheets and test scores if you have them. Parents are very welcome.\n\nSee you there,\nTeam {{business}}',
    },
    whatsapp: {
      name: 'abroad_university_fair', category: 'MARKETING',
      body: 'Hi {{1}}, you are invited to our study-abroad fair on {{2}}! 🌍\n\nMeet university representatives, get your profile reviewed on the spot and ask about scholarships, loans and visas.\n\nVenue: {{3}}\n\nEntry is free. Reply YES to register.',
      vars: [{ key: 'first_name', example: 'Meera' }, { fill: 'Event date and time', example: 'Sun, 17 Nov, 11 am to 5 pm' }, { fill: 'Venue', example: 'Hotel Hyatt, Ahmedabad' }], footer: STOP,
    },
    call: {
      goal: 'Register the lead for the university fair',
      opening: 'Hello {{customer_name}}, I am calling from {{business_name}}. We are hosting a study-abroad fair soon and I wanted to personally invite you.',
      script: [
        'You can meet representatives from several universities directly and ask them your questions.',
        'Our counsellors will also review your profile on the spot.',
        'Entry is free, but we need you to register so we can plan your meetings.',
        'Shall I register you? You can bring your parents along.',
      ],
      questions: ['Which countries are you interested in?', 'Will you be coming alone or with family?', 'Which course are you looking at?'],
      objections: [
        { said: 'I cannot come in person', reply: 'No problem. We can set up a video session with a counsellor instead. Would that help?' },
        { said: 'I have not decided on studying abroad yet', reply: 'The fair is actually perfect for that. You can compare options and costs in one day, without any commitment.' },
      ],
      closing: 'You are registered, {{customer_name}}. I will send the venue and timing on WhatsApp. See you at the fair!',
      outcomes: ['registered', 'interested', 'callback', 'not_interested', 'wrong_number'],
      variables: ['customer_name', 'business_name'],
    },
  },
  {
    id: 'abroad-dormant-lead-revival', name: 'Old enquiry revival', goal: 'Restart conversations with leads who went quiet', when: 'Leads with no reply for 30+ days, before a new intake opens',
    audience: { type: 'leads', tags: ['cold'] },
    email: {
      subject: 'Still thinking about studying abroad, {{first_name}}?',
      body: 'Hi {{first_name}},\n\nA while ago you had asked us about studying abroad. We did not hear back, and that is completely okay. Plans change, exams come up, and sometimes the costs or the paperwork just feel like too much.\n\nIf the dream is still there, here is something that might help. Many students who reached out to us with the same doubts are now studying in [countries]. What they had in common was not perfect marks. It was a clear plan made early.\n\n[Short story of a past student, with their permission]\n\nIf you would like, our counsellor can do a fresh, free review of your profile and tell you honestly what is possible this year: which countries, what it will cost, and what you need to do next.\n\nBook a time here: [link]\n\nAnd if your plans have changed, just reply and let us know. We wish you the very best either way.\n\nTeam {{business}}',
    },
    whatsapp: {
      name: 'abroad_dormant_revival', category: 'MARKETING',
      body: 'Hi {{1}}, you had asked us about studying abroad some time ago. Are you still planning for it? 😊\n\nApplications for the {{2}} intake are opening. Our counsellor can do a fresh, free review of your profile and tell you what is possible this year.\n\nReply YES and we will call you.',
      vars: [{ key: 'first_name', example: 'Varun' }, { fill: 'Intake name', example: 'January 2027' }], footer: STOP,
    },
    call: {
      goal: 'Re-engage an old lead and book a fresh counselling session',
      opening: 'Hello {{customer_name}}, this is {{business_name}}. You had enquired with us about studying abroad some time back. I wanted to check if you are still planning for it.',
      script: [
        'Applications for the next intake are opening, so this is a good time to look at your options again.',
        'Our counsellor can do a fresh, free review of your profile and tell you honestly what is possible.',
        'Shall I book a short session for you?',
      ],
      questions: ['Are you still interested in studying abroad?', 'Has anything changed, like your marks, test scores or budget?', 'Which intake would you consider now?'],
      objections: [
        { said: 'I have dropped the plan', reply: 'I understand. May I ask what made you change your mind? Sometimes it is cost or documents, and there may be a way around it.' },
        { said: 'I am working now', reply: 'That is actually a plus for many master’s programmes. Work experience can strengthen your profile. Want the counsellor to look at it?' },
        { said: 'I will apply through another consultant', reply: 'That is fine. If you ever want a second opinion on your shortlist or SOP, we are happy to help.' },
      ],
      closing: 'Thank you, {{customer_name}}. I will send the details on WhatsApp. Wishing you the very best!',
      outcomes: ['booked_session', 'interested', 'callback', 'plan_dropped', 'not_interested'],
      variables: ['customer_name', 'business_name'],
    },
  },
];

const general = [
  {
    id: 'general-webinar-invite', name: 'Free webinar invitation', goal: 'Get registrations for a free live webinar or masterclass', when: '7–10 days before a live webinar',
    audience: { type: 'all' },
    email: {
      subject: 'Free live masterclass: [webinar topic]',
      body: 'Hi {{first_name}},\n\nI am hosting a free live masterclass on [webinar topic] on [date and time], and I would love for you to join.\n\nThis is not a recorded video or a long sales pitch. It is a working session where I will show you exactly how I approach this, step by step, with real examples.\n\nIn about 60 minutes, you will learn:\n- The most common mistake people make when they start, and how to avoid it\n- A simple framework you can apply the very next day\n- What actually moves results, and what is just noise\n- Answers to your questions, live\n\nIt is completely free. Seats in the live room are limited by the platform, so please register early to get the joining link.\n\nRegister here: [link]\n\nIf you cannot make it live, register anyway and I will try to share the key takeaways.\n\nSee you there,\n{{business}}',
    },
    whatsapp: {
      name: 'coach_webinar_invite', category: 'MARKETING',
      body: 'Hi {{1}}, I am hosting a free live masterclass on {{2}}! 🎤\n\nDate: {{3}}\n\nA practical session with real examples and live Q&A, not a recorded pitch. Reply YES and I will send you the registration link.',
      vars: [{ key: 'first_name', example: 'Deepak' }, { fill: 'Webinar topic', example: 'growing your Instagram to your first 10,000 followers' }, { fill: 'Date and time', example: 'Sunday, 3 Nov at 7 pm' }], footer: STOP,
    },
    call: {
      goal: 'Register the contact for the free webinar',
      opening: 'Hello {{customer_name}}, I am calling from {{business_name}}. We are hosting a free live masterclass soon and I wanted to invite you personally.',
      script: [
        'It is a practical session of about an hour with real examples, and you can ask your questions live.',
        'It is completely free; you only need to register to get the joining link.',
        'Shall I register you and send the link on WhatsApp?',
      ],
      questions: ['Is this topic something you are working on right now?', 'Which evening works best for you, weekday or weekend?', 'What is the one question you would want answered in the session?'],
      objections: [
        { said: 'I do not have time', reply: 'I understand. It is just one hour, and if you register you will get a reminder before it starts. Shall I add you?' },
        { said: 'These webinars are just sales pitches', reply: 'Fair point, many are. This one is mostly teaching with a practical framework. You can leave any time you feel it is not useful.' },
      ],
      closing: 'You are registered, {{customer_name}}. The link is coming on WhatsApp. See you at the session!',
      outcomes: ['registered', 'interested', 'callback', 'not_interested', 'wrong_number'],
      variables: ['customer_name', 'business_name'],
    },
  },
  {
    id: 'general-webinar-reminder', name: 'Webinar joining reminder', goal: 'Get registered people to show up live', when: 'A day before, and 1 hour before the webinar',
    audience: { type: 'leads', tags: ['webinar-registered'] },
    email: {
      subject: 'Your joining link for [date and time], {{first_name}}',
      body: 'Hi {{first_name}},\n\nThank you for registering for the live session on [webinar topic]. Here are your details.\n\nDate and time: [date and time]\nJoining link: [link]\n\nA few things that will help:\n- Join 5 minutes early so you do not miss the beginning\n- Use a laptop if you can; I will share slides and examples on screen\n- Keep a notebook ready, there will be a short exercise\n- Write down one question you want answered; I will take questions live\n\nThe session runs for about [duration]. Please make sure the Zoom or Google Meet app is installed and updated on your device before you join.\n\nIf you face any trouble joining, reply to this email and our team will help you.\n\nSee you soon,\n{{business}}',
    },
    whatsapp: {
      name: 'coach_webinar_reminder', category: 'UTILITY',
      body: 'Hi {{1}}, this is a reminder of the live session you registered for on {{2}}.\n\nJoining link: {{3}}\n\nPlease join 5 minutes early. Reply here if you have trouble joining.',
      vars: [{ key: 'first_name', example: 'Neha' }, { fill: 'Date and time', example: 'today at 7 pm' }, { fill: 'Joining link', example: 'https://zoom.us/j/123456789' }],
    },
    call: {
      goal: 'Remind the registrant to join the webinar',
      opening: 'Hello {{customer_name}}, this is {{business_name}}. You had registered for our live session at {{webinar_time}}. Just a quick reminder call.',
      script: [
        'The session starts at {{webinar_time}}. The joining link is on your WhatsApp and email.',
        'Please join a few minutes early so you do not miss the start.',
        'Do you have the link, or should I send it again?',
      ],
      questions: ['Will you be able to join live?', 'Do you have the joining link?'],
      objections: [
        { said: 'I may not be able to join', reply: 'No problem. Try to join even for the first half; that is where the main framework is. I will resend the link so it is easy to find.' },
        { said: 'I do not know how to use Zoom', reply: 'It is simple. Just tap the link on your phone and it will open. If you face any issue, reply on WhatsApp and our team will help.' },
      ],
      closing: 'Great, see you in the session, {{customer_name}}. I am sending the link again on WhatsApp.',
      outcomes: ['will_attend', 'cannot_attend', 'link_resent', 'callback', 'wrong_number'],
      variables: ['customer_name', 'business_name', 'webinar_time'],
    },
  },
  {
    id: 'general-webinar-replay', name: 'Missed the webinar: replay', goal: 'Get no-shows to watch the replay and take the offer', when: 'The morning after the webinar, to registrants who did not attend',
    audience: { type: 'leads', tags: ['webinar-no-show'] },
    email: {
      subject: 'You missed it, so here is the replay',
      body: 'Hi {{first_name}},\n\nI noticed you could not make it to yesterday’s live session on [webinar topic]. Life happens, so I have kept the recording ready for you.\n\nWatch the replay here: [replay link]\n\nIf you only have 15 minutes, jump to the middle part where I walk through the framework step by step. That is the part most people wrote back to me about.\n\nAt the end of the session, I also shared details of my [programme name]. It is for people who want to go beyond the basics and get personal guidance while they apply this.\n\nThe replay and the special joining price are available only until [replay end date], after which I take it down.\n\nIf you have a question after watching, just reply to this email. I read every reply myself.\n\nWarmly,\n{{business}}',
    },
    whatsapp: {
      name: 'coach_webinar_replay', category: 'MARKETING',
      body: 'Hi {{1}}, sorry you missed the live session! The replay is ready for you. 🎬\n\nIt stays up only until {{2}}, so do watch it soon. Reply REPLAY and I will send you the link.',
      vars: [{ key: 'first_name', example: 'Amit' }, { fill: 'Replay end date', example: 'Thursday night' }], footer: STOP,
    },
    call: {
      goal: 'Get the no-show to watch the replay and discuss the programme',
      opening: 'Hello {{customer_name}}, this is {{business_name}}. You had registered for our live session but could not join. I wanted to make sure you get the replay.',
      script: [
        'The replay is available for a few days. I will send you the link on WhatsApp.',
        'At the end of the session we also explained our programme for people who want personal guidance.',
        'Would you like a quick call with our team after you watch it, to see if the programme fits you?',
      ],
      questions: ['What made you sign up for the session?', 'What is the biggest challenge you are facing with this right now?', 'Would a short call after the replay be helpful?'],
      objections: [
        { said: 'I will watch it later', reply: 'Sure. Just note the replay is up only for a few days. Shall I set a reminder for you tomorrow evening?' },
        { said: 'The programme is too expensive', reply: 'I understand. Watch the replay first and see if the approach makes sense. Then we can talk about the payment options.' },
      ],
      closing: 'Thank you, {{customer_name}}. The replay link is on its way on WhatsApp. Enjoy the session!',
      outcomes: ['replay_sent', 'interested', 'booked_call', 'callback', 'not_interested'],
      variables: ['customer_name', 'business_name'],
    },
  },
  {
    id: 'general-discovery-call', name: 'Book a clarity call', goal: 'Book a free 1:1 discovery call', when: 'Within a day of a lead downloading a free guide or filling a form',
    audience: { type: 'leads' },
    email: {
      subject: '{{first_name}}, a free 20-minute call to plan your next step',
      body: 'Hi {{first_name}},\n\nThank you for downloading [free resource name]. I hope you have had a chance to go through it.\n\nMost people who read it come back with the same question: “This makes sense, but where do I start in my situation?”\n\nThat is exactly what a clarity call is for. It is a free 20-minute one-on-one call where we will:\n- Understand where you are right now and where you want to be\n- Find the one or two things holding you back\n- Map out a simple next step you can act on this week\n\nThis is not a hard sales call. If I think I can help you further, I will tell you how. If not, you will still leave with a clear plan.\n\nI keep only a few of these slots open each week so I can give each call proper attention.\n\nBook your call here: [link]\n\nTalk soon,\n{{business}}',
    },
    whatsapp: {
      name: 'coach_discovery_call', category: 'MARKETING',
      body: 'Hi {{1}}, thank you for downloading {{2}}! 🙌\n\nIf you would like help applying it to your situation, book a free 20-minute clarity call. We will find what is holding you back and plan your next step.\n\nReply CALL and I will share the available slots.',
      vars: [{ key: 'first_name', example: 'Shruti' }, { fill: 'Free resource name', example: 'the 30-day fitness starter guide' }], footer: STOP,
    },
    call: {
      goal: 'Book a free clarity call',
      opening: 'Hello {{customer_name}}, I am calling from {{business_name}}. You recently downloaded our free guide, and I wanted to check how it is going.',
      script: [
        'Thank you for downloading it. Many people find it useful but are not sure how to apply it to their own situation.',
        'That is why we offer a free 20-minute clarity call to plan your next step.',
        'It is not a sales call. You will leave with a clear plan either way.',
        'Shall I book a slot for you this week?',
      ],
      questions: ['What made you download the guide?', 'What is the biggest challenge you are facing right now?', 'Have you tried anything to solve it so far?', 'Which day and time works for a 20-minute call?'],
      objections: [
        { said: 'I am just exploring right now', reply: 'That is perfectly fine. The call will help you explore with clarity. There is no pressure to buy anything.' },
        { said: 'I cannot afford coaching', reply: 'I understand. The call is free, and you will get a plan you can follow on your own too.' },
        { said: 'Send me details on WhatsApp', reply: 'Sure, I will send them now. Shall I also hold a slot for you, so you do not have to look for it later?' },
      ],
      closing: 'Your clarity call is booked, {{customer_name}}. I will send the details on WhatsApp. Talk soon!',
      outcomes: ['booked_call', 'interested', 'callback', 'not_interested', 'wrong_number'],
      variables: ['customer_name', 'business_name'],
    },
  },
  {
    id: 'general-enrolment-closing', name: 'Enrolment closing', goal: 'Get final enrolments before the programme doors close', when: '48 hours and on the last day before enrolment closes',
    audience: { type: 'leads', tags: ['warm'] },
    email: {
      subject: 'Enrolment for [programme name] closes on [close date]',
      body: 'Hi {{first_name}},\n\nA quick note: enrolment for [programme name] closes on [close date]. After that, the next batch opens only in [next batch month].\n\nI close enrolment because I work closely with every batch. Live calls, feedback on your work, a community that actually talks to each other. That does not work if people keep joining halfway through.\n\nIf you have been thinking about it, here is the honest question to ask yourself: if nothing changes in the next three months, will you be okay with that?\n\nIf the answer is no, this programme is built to help you take action, with support at every step.\n\nYou can see the full details, the curriculum and the payment options, including EMI, here: [link]\n\nIf you have a question that is holding you back, reply to this email. I will answer it personally before the doors close.\n\nWarmly,\n{{business}}',
    },
    whatsapp: {
      name: 'coach_enrolment_closing', category: 'MARKETING',
      body: 'Hi {{1}}, a quick reminder that enrolment for {{2}} closes on {{3}}. ⏰\n\nAfter that, the next batch opens only in a few months. EMI options are available.\n\nGot a question before you decide? Reply here and I will answer it personally.',
      vars: [{ key: 'first_name', example: 'Rahul' }, { fill: 'Programme name', example: 'the 8-week Stock Market Basics programme' }, { fill: 'Close date', example: 'Sunday midnight' }], footer: STOP,
    },
    call: {
      goal: 'Answer last doubts and enrol the lead before doors close',
      opening: 'Hello {{customer_name}}, this is {{business_name}}. Enrolment for our programme closes very soon, and I wanted to check if you have any questions before it does.',
      script: [
        'We close enrolment so we can give proper attention to every batch.',
        'The next batch opens only after a few months.',
        'If there is anything stopping you, let us talk about it now.',
        'Would you like me to send you the enrolment link with the EMI option?',
      ],
      questions: ['What made you interested in the programme?', 'What is the one thing stopping you from joining?', 'Would the EMI option make it easier?'],
      objections: [
        { said: 'It is too expensive', reply: 'I understand. We have EMI options that bring the monthly amount down. Think about what it is costing you to stay where you are for another few months.' },
        { said: 'I do not have time right now', reply: 'Most people in the batch are working too. The lessons are short and recorded, and live calls are in the evening. Most need a few hours a week.' },
        { said: 'I will join the next batch', reply: 'That is possible, but the next batch is a few months away. If you are ready to start now, why wait?' },
      ],
      closing: 'Thank you, {{customer_name}}. I am sending the enrolment link on WhatsApp now. Looking forward to having you in the batch!',
      outcomes: ['enrolled', 'interested', 'callback', 'next_batch', 'not_interested'],
      variables: ['customer_name', 'business_name'],
    },
  },
  {
    id: 'general-emi-payment-due', name: 'Programme EMI due reminder', goal: 'Collect the next programme instalment on time', when: '3 days before and on the instalment due date',
    audience: { type: 'customers', tags: ['emi-due'] },
    email: {
      subject: 'Your next instalment is due on [due date]',
      body: 'Hi {{first_name}},\n\nThis is a reminder that the next instalment for your [programme name] is due soon.\n\nAmount: [amount]\nDue date: [due date]\n\nPay securely here: [payment link]\n\nYou can pay using UPI, debit card, credit card or net banking. You will get a receipt on email as soon as the payment goes through.\n\nPaying on time keeps your access to all live calls, recordings and the community running without interruption.\n\nIf you have already paid, thank you, and please ignore this email.\n\nIf you are facing a difficulty and need a few extra days, please reply to this email before the due date. We are happy to work something out with you. It is much easier to sort this out early than after access is paused.\n\nThank you for being part of the programme,\nTeam {{business}}',
    },
    whatsapp: {
      name: 'coach_emi_payment_due', category: 'UTILITY',
      body: 'Hi {{1}}, your next instalment of {{2}} for the programme is due on {{3}}.\n\nPay here: {{4}} using UPI, card or net banking.\n\nIf you have already paid, please ignore this message. Reply here if you need help.',
      vars: [{ key: 'first_name', example: 'Kavya' }, { fill: 'Instalment amount', example: '₹4,999' }, { fill: 'Due date', example: '5 November' }, { fill: 'Payment link', example: 'https://rzp.io/l/xyz789' }],
    },
    call: {
      goal: 'Remind about the instalment and get a payment date',
      opening: 'Hello {{customer_name}}, this is {{business_name}}. I am calling about your programme instalment due on {{due_date}}. Is this a good time?',
      script: [
        'This is a reminder that your next instalment is due soon.',
        'The payment link is on your WhatsApp and email. You can pay with UPI or card.',
        'Can you tell me when you will be able to pay, so I can note it?',
      ],
      questions: ['Have you already made the payment?', 'On which date can you complete it?', 'Shall I resend the payment link?'],
      objections: [
        { said: 'I already paid', reply: 'Thank you! Please share the transaction ID on WhatsApp and I will confirm it and send the receipt.' },
        { said: 'I am short of money this month', reply: 'I understand. Tell me a date that works and I will note it with the team so your access is not affected.' },
      ],
      closing: 'Thank you, {{customer_name}}. I have noted it and resent the link on WhatsApp. Have a good day!',
      outcomes: ['paid', 'promised_date', 'callback', 'wants_refund', 'wrong_number'],
      variables: ['customer_name', 'business_name', 'due_date'],
    },
  },
  {
    id: 'general-referral-ask', name: 'Client referral request', goal: 'Get happy clients to refer friends', when: 'After a client finishes a programme or reaches a milestone',
    audience: { type: 'customers' },
    email: {
      subject: '{{first_name}}, a small favour?',
      body: 'Hi {{first_name}},\n\nIt has been a real pleasure working with you, and I am genuinely happy with the progress you have made.\n\nAlmost every client I work with came through someone they trust: a friend, a colleague, a family member. That is how this practice has grown, and I am grateful for it.\n\nSo here is a small request. Is there someone in your life who is going through what you were going through when we started? Someone who would benefit from the same support?\n\nIf yes, you can share this link with them: [referral link]\n\nThey get a free clarity call with me, and as a thank you, [referral reward, e.g. a free 1:1 session for you].\n\nNo pressure at all. And if you have a minute, I would love it if you could also reply with a few lines about your experience. It helps others decide.\n\nWith gratitude,\n{{business}}',
    },
    whatsapp: {
      name: 'coach_referral_ask', category: 'MARKETING',
      body: 'Hi {{1}}, it has been wonderful working with you! 🙏\n\nIf a friend or family member could use the same support, I would be glad to help them. They get a free clarity call, and you get {{2}} as a thank you.\n\nReply with their name and I will reach out gently.',
      vars: [{ key: 'first_name', example: 'Anjali' }, { fill: 'Referral reward', example: 'a free 1:1 session' }], footer: STOP,
    },
    call: {
      goal: 'Collect a testimonial and referrals from a happy client',
      opening: 'Hello {{customer_name}}, this is {{business_name}}. I wanted to thank you for being part of the programme and hear how things are going for you.',
      script: [
        'It has been great to see your progress. We would love to hear what made the biggest difference for you.',
        'Most of our clients come through people they trust, like you.',
        'If you know someone who could benefit, we would be happy to offer them a free clarity call.',
        'And as a thank you, you get a reward for every friend who joins.',
      ],
      questions: ['How has the programme helped you so far?', 'Would you be okay with us sharing a few lines from your experience?', 'Is there a friend or colleague who might benefit from this?'],
      objections: [
        { said: 'I do not want to bother my friends', reply: 'Completely understood. We will only reach out once, very gently, and only if they agree. Or you can just share the link yourself.' },
        { said: 'I am not comfortable giving a testimonial', reply: 'That is absolutely fine. We can share it with just your first name, or not at all. Your comfort comes first.' },
      ],
      closing: 'Thank you so much, {{customer_name}}. It means a lot. I will send the referral link on WhatsApp.',
      outcomes: ['referral_given', 'testimonial_given', 'interested', 'callback', 'not_interested'],
      variables: ['customer_name', 'business_name'],
    },
  },
];

const consultant = [
  {
    id: 'consultant-new-enquiry', name: 'New enquiry: book a discovery call', goal: 'Book a discovery call with a new B2B enquiry', when: 'Within an hour of a new enquiry',
    audience: { type: 'leads' },
    email: {
      subject: 'Next step for {{first_name}}: a 30-minute discovery call',
      body: 'Hi {{first_name}},\n\nThank you for reaching out to {{business}}. I have gone through your enquiry and I would like to understand your situation properly before suggesting anything.\n\nThe best way to do that is a short discovery call of about 30 minutes. On the call we will:\n- Understand your business, your current numbers and what you have already tried\n- Identify where the real bottleneck is\n- Tell you honestly whether we are the right fit, and what the work would look like\n\nYou will not get a generic deck or a price list on this call. You will get a clear view of the problem, and some ideas you can use whether we work together or not.\n\nPlease pick a time that suits you here: [calendar link]\n\nIf it helps, feel free to forward this to your partner or team lead, who can join the call too.\n\nBest regards,\n[your name]\n{{business}}',
    },
    whatsapp: {
      name: 'consult_new_enquiry', category: 'MARKETING',
      body: 'Hi {{1}}, thank you for reaching out to us about {{2}}. 🤝\n\nLet’s start with a 30-minute discovery call to understand your business and where the real bottleneck is. No generic pitch.\n\nReply with a convenient day and time and we will block it.',
      vars: [{ key: 'first_name', example: 'Vikram' }, { fill: 'Service enquired about', example: 'performance marketing' }], footer: STOP,
    },
    call: {
      goal: 'Qualify the enquiry and book a discovery call',
      opening: 'Hello {{customer_name}}, I am calling from {{business_name}} regarding the enquiry you sent us. Do you have two minutes?',
      script: [
        'Thank you for reaching out. I just want to understand your requirement a little so the right person speaks with you.',
        'Our next step is usually a 30-minute discovery call with our consultant.',
        'On the call we understand your business and tell you honestly whether we are the right fit.',
        'Shall I book that call for you this week?',
      ],
      questions: ['What does your business do, and roughly what is your team size?', 'What problem are you looking to solve right now?', 'Have you worked with an agency or consultant before?', 'Who else would be part of this decision?'],
      objections: [
        { said: 'What are your charges?', reply: 'It depends on the scope. Some clients start with a small project, others with a monthly retainer. On the discovery call we will give you a clear range.' },
        { said: 'Send me your company profile', reply: 'Sure, I will send it on WhatsApp right away. A profile cannot tell you what we would do for your business though. Shall I also hold a call slot?' },
        { said: 'We had a bad experience with an agency', reply: 'I am sorry to hear that, and it is common. That is why we start with a discovery call and a clear scope, so expectations are set from the first day.' },
      ],
      closing: 'Your discovery call is booked, {{customer_name}}. I will send the invite and our profile on WhatsApp. Thank you!',
      outcomes: ['booked_call', 'interested', 'callback', 'not_a_fit', 'not_interested'],
      variables: ['customer_name', 'business_name'],
    },
  },
  {
    id: 'consultant-meeting-reminder', name: 'Meeting reminder', goal: 'Make sure the prospect joins the scheduled meeting', when: 'A day before and 1 hour before a scheduled meeting',
    audience: { type: 'leads', tags: ['meeting-booked'] },
    email: {
      subject: 'Confirming our call on [meeting date]',
      body: 'Hi {{first_name}},\n\nLooking forward to our call. Here are the details.\n\nDate and time: [meeting date and time]\nJoin here: [meeting link]\n\nTo make the 30 minutes as useful as possible, it would help if you could think about these before the call:\n- Your main goal for the next 3 to 6 months\n- Your current numbers, roughly: leads, sales, or whatever matters most to you\n- What you have already tried, and what did not work\n- Who else should be on the call to make a decision\n\nYou do not need to prepare a presentation. A rough idea is more than enough. If you have any reports or links that would help us understand your business, feel free to reply with them.\n\nIf the time no longer works, just reply to this email and we will find another slot.\n\nSee you on the call,\n[your name]\n{{business}}',
    },
    whatsapp: {
      name: 'consult_meeting_reminder', category: 'UTILITY',
      body: 'Hi {{1}}, this is a reminder of our call on {{2}}.\n\nJoining link: {{3}}\n\nIf you need to change the time, reply to this message and we will reschedule.',
      vars: [{ key: 'first_name', example: 'Sanjay' }, { fill: 'Meeting date and time', example: 'Tue, 15 Oct at 4 pm' }, { fill: 'Meeting link', example: 'https://meet.google.com/abc-defg-hij' }],
    },
    call: {
      goal: 'Confirm the prospect will attend the meeting',
      opening: 'Hello {{customer_name}}, this is {{business_name}}. I am calling to confirm our meeting on {{meeting_time}}. Do you have a moment?',
      script: [
        'I just wanted to confirm that the time still works for you.',
        'If possible, keep your current numbers and goals handy; it makes the call much more useful.',
        'If anyone else should join, please feel free to forward the invite.',
      ],
      questions: ['Does the meeting time still work for you?', 'Will anyone else from your team join?', 'Do you have the meeting link?'],
      objections: [
        { said: 'Something urgent has come up', reply: 'No problem at all. Tell me a time later this week that suits you and I will move the meeting.' },
        { said: 'Can we do it on a phone call instead?', reply: 'Of course. I will note your number and our consultant will call you at the same time.' },
      ],
      closing: 'Perfect, the meeting is confirmed. Talk to you then, {{customer_name}}!',
      outcomes: ['confirmed', 'rescheduled', 'cancelled', 'callback', 'wrong_number'],
      variables: ['customer_name', 'business_name', 'meeting_time'],
    },
  },
  {
    id: 'consultant-proposal-followup', name: 'Proposal follow-up', goal: 'Move a sent proposal to a decision', when: '3–5 days after sending a proposal with no reply',
    audience: { type: 'leads', tags: ['proposal-sent'] },
    email: {
      subject: 'Any questions on the proposal, {{first_name}}?',
      body: 'Hi {{first_name}},\n\nI wanted to follow up on the proposal I sent on [proposal date] for [project name].\n\nI know proposals often get stuck for very practical reasons: a budget that needs approval, a partner who has not seen it yet, or a scope that feels slightly too big or too small. All of these are easy to fix.\n\nA few options, if they help:\n- We can start with a smaller first phase and expand once you see results\n- I can join a quick call with your partner or finance team to answer their questions\n- We can adjust the payment schedule to suit your cash flow\n\nIf the timing is not right, that is completely fine too. Just let me know and I will check in when it makes more sense.\n\nWould a 15-minute call this week help you decide? Pick a time here: [calendar link]\n\nBest regards,\n[your name]\n{{business}}',
    },
    whatsapp: {
      name: 'consult_proposal_followup', category: 'MARKETING',
      body: 'Hi {{1}}, just checking in on the proposal for {{2}}. 📄\n\nIf anything needs changing, like scope, timeline or payment terms, we are happy to adjust. A quick 15-minute call can also help clear any questions.\n\nReply here and we will set it up.',
      vars: [{ key: 'first_name', example: 'Rajesh' }, { fill: 'Project name', example: 'the website and SEO project' }], footer: STOP,
    },
    call: {
      goal: 'Find what is blocking the proposal and get a decision date',
      opening: 'Hello {{customer_name}}, this is {{business_name}}. I am calling about the proposal we shared with you. Did you get a chance to look at it?',
      script: [
        'I wanted to check if you have any questions or if anything needs to change.',
        'We can adjust the scope, start with a smaller first phase, or change the payment schedule.',
        'Would a short call with your partner or team help you decide?',
      ],
      questions: ['Have you had a chance to review the proposal?', 'Is there anything in the scope or pricing that does not fit?', 'Who else needs to approve it?', 'By when are you looking to make a decision?'],
      objections: [
        { said: 'Your price is higher than others', reply: 'That may be true. Could you tell me what the other quote includes? Often the scope is different. We can also start with a smaller phase to fit your budget.' },
        { said: 'We are still discussing internally', reply: 'Of course. Would it help if I join a 15-minute call with your team to answer their questions directly?' },
        { said: 'Let us revisit next quarter', reply: 'That is fine. May I ask what would need to change by then? I will note it and check in at the right time.' },
      ],
      closing: 'Thank you, {{customer_name}}. I have noted it and will send a summary on WhatsApp. Talk soon!',
      outcomes: ['accepted', 'revision_needed', 'decision_pending', 'callback', 'lost'],
      variables: ['customer_name', 'business_name'],
    },
  },
  {
    id: 'consultant-case-study', name: 'Case study nurture', goal: 'Warm up cold leads with a relevant client story', when: 'Leads with no conversation for 2–4 weeks',
    audience: { type: 'leads', tags: ['cold'] },
    email: {
      subject: '{{first_name}}, a client story you may find useful',
      body: 'Hi {{first_name}},\n\nI thought you might find this useful, since you had asked us about something similar.\n\nA while ago, we started working with [client description, e.g. a family-run manufacturer in Ludhiana]. Their problem may sound familiar: enquiries had slowed down, costs were rising, and nobody was sure why.\n\nHere is what we did, in plain terms:\n- First, we looked at where the leads or money were actually leaking, before changing anything\n- Then we fixed the one or two things that mattered most, instead of doing everything at once\n- We reviewed the numbers with the owner every week, so nothing was a black box\n\n[The result, in the client’s words or with real numbers they have approved]\n\nEvery business is different, and I will not promise you the same result. But if this sounds close to what you are facing, a 30-minute call is a good way to find out what would work for you.\n\nBook a time here: [calendar link]\n\nBest regards,\nTeam {{business}}',
    },
    whatsapp: {
      name: 'consult_case_study', category: 'MARKETING',
      body: 'Hi {{1}}, sharing a quick client story that may be useful to you. 📈\n\nWe recently helped a {{2}} business fix {{3}}, step by step and with weekly reviews.\n\nWant to see if something similar could work for you? Reply YES for the full case study.',
      vars: [{ key: 'first_name', example: 'Manish' }, { fill: 'Client industry', example: 'textile' }, { fill: 'Problem solved', example: 'their low enquiry volume from Google' }], footer: STOP,
    },
    call: {
      goal: 'Re-engage a cold lead through a relevant case study',
      opening: 'Hello {{customer_name}}, I am calling from {{business_name}}. You had spoken to us some time back, and we recently worked on a project very similar to your requirement.',
      script: [
        'We helped a business like yours solve a similar problem, step by step.',
        'I thought it might be useful for you to see how we approached it.',
        'Can I send you the case study and set up a short call to discuss your situation?',
      ],
      questions: ['Is the problem you had contacted us about still a priority?', 'What have you tried since we last spoke?', 'Would a short call this week be useful?'],
      objections: [
        { said: 'We have hired someone else', reply: 'That is good to hear. If you ever need a second opinion or extra support, we are happy to help. Can I stay in touch?' },
        { said: 'Budget is tight right now', reply: 'Understood. Many clients start with a small, focused project. Let us at least talk about what is possible within your budget.' },
      ],
      closing: 'Thank you, {{customer_name}}. I am sending the case study on WhatsApp. Talk soon!',
      outcomes: ['booked_call', 'interested', 'callback', 'hired_elsewhere', 'not_interested'],
      variables: ['customer_name', 'business_name'],
    },
  },
  {
    id: 'consultant-invoice-due', name: 'Invoice payment reminder', goal: 'Get the invoice paid on time', when: '3 days before the due date and on the day it falls due',
    audience: { type: 'customers', tags: ['invoice-due'] },
    email: {
      subject: 'Invoice [invoice number] due on [due date]',
      body: 'Hi {{first_name}},\n\nI hope the project is going well on your side.\n\nThis is a gentle reminder that invoice [invoice number] for [amount] is due on [due date]. A copy is attached for your reference.\n\nPayment can be made by bank transfer, UPI or cheque. Our bank details and GSTIN are mentioned on the invoice. If you need the invoice in a different format, a purchase order number added, or the TDS details, just let us know and we will send a revised copy the same day.\n\nOnce the payment is done, please reply with the UTR or transaction reference so our accounts team can match it quickly and send you the receipt.\n\nIf the payment has already been processed, thank you, and please ignore this reminder.\n\nIf there is any issue holding it up, do let me know. I would rather sort it out with you directly.\n\nBest regards,\nAccounts, {{business}}',
    },
    whatsapp: {
      name: 'consult_invoice_due', category: 'UTILITY',
      body: 'Hi {{1}}, this is a reminder that invoice {{2}} for {{3}} is due on {{4}}.\n\nBank details are on the invoice. After paying, please reply with the UTR so we can send the receipt.\n\nIf it is already paid, please ignore this message.',
      vars: [{ key: 'first_name', example: 'Suresh' }, { fill: 'Invoice number', example: 'INV-2026-042' }, { fill: 'Amount', example: '₹59,000' }, { fill: 'Due date', example: '30 October' }],
    },
    call: {
      goal: 'Get a payment date for the due invoice',
      opening: 'Hello {{customer_name}}, this is {{business_name}} accounts. I am calling about invoice {{invoice_number}} which is due soon. Is this a good time?',
      script: [
        'I just wanted to check that you have received the invoice and that everything is in order.',
        'If you need any change, like a PO number or TDS details, we can send a revised copy today.',
        'Could you tell me the expected payment date so I can update our records?',
      ],
      questions: ['Have you received the invoice?', 'Is any change needed on the invoice?', 'When is the payment expected to be released?'],
      objections: [
        { said: 'It is with our accounts team', reply: 'No problem. Could you share the contact of the person handling it? I will follow up with them directly so you do not have to.' },
        { said: 'We have a 45-day payment cycle', reply: 'Understood. I will note the date as per your cycle. Please let us know if anything else is needed for processing.' },
        { said: 'We are not happy with part of the work', reply: 'Thank you for telling me. I will ask the project lead to call you today so we can sort it out first.' },
      ],
      closing: 'Thank you, {{customer_name}}. I have noted the date and will share the details on WhatsApp.',
      outcomes: ['paid', 'promised_date', 'dispute', 'callback', 'wrong_number'],
      variables: ['customer_name', 'business_name', 'invoice_number'],
    },
  },
  {
    id: 'consultant-free-audit', name: 'Free audit offer', goal: 'Book a free audit that leads to a paid engagement', when: 'Any time, best at quarter start or before the financial year-end',
    audience: { type: 'leads' },
    email: {
      subject: 'A free [audit type] audit for your business, {{first_name}}',
      body: 'Hi {{first_name}},\n\nMost businesses we speak to know something is not working. Leads have slowed down, costs have gone up, or growth has flattened. What they do not know is exactly where the problem is.\n\nThis month, we are offering a free [audit type] audit to a limited number of businesses we can give proper time to.\n\nHere is how it works:\n- You share basic access or a few reports, nothing sensitive\n- Our team reviews it properly, not with an automated tool\n- In a 30-minute call, we walk you through what we found: what is working, what is leaking, and the three things we would fix first\n\nYou keep the findings, whether you work with us or not.\n\nWe can only do a few of these each month, because each one takes real time from our senior team.\n\nRequest your audit here: [link]\n\nBest regards,\nTeam {{business}}',
    },
    whatsapp: {
      name: 'consult_free_audit', category: 'MARKETING',
      body: 'Hi {{1}}, we are offering a free {{2}} audit to a few businesses this month. 🔍\n\nOur team reviews it properly and shows you, in a 30-minute call, what is working, what is leaking and what to fix first. You keep the findings either way.\n\nReply AUDIT to request yours.',
      vars: [{ key: 'first_name', example: 'Gaurav' }, { fill: 'Audit type', example: 'Google Ads' }], footer: STOP,
    },
    call: {
      goal: 'Book a free audit',
      opening: 'Hello {{customer_name}}, I am calling from {{business_name}}. We are offering a free audit to a few businesses this month and I wanted to check if you would like one.',
      script: [
        'Our team reviews your current setup properly, not with an automated tool.',
        'Then in a 30-minute call we show you what is working, what is leaking and what to fix first.',
        'You keep the findings whether you work with us or not.',
        'Shall I book your audit?',
      ],
      questions: ['What is the biggest challenge in your business right now?', 'Who manages this work currently, in-house or an agency?', 'Can you share basic access or reports for the review?'],
      objections: [
        { said: 'What is the catch?', reply: 'No catch. Some businesses choose to work with us after seeing the audit, and that is how it works for us. Many just use the findings themselves.' },
        { said: 'I do not want to share access', reply: 'Completely fair. You can share screenshots or exported reports instead, and read-only access where it is needed.' },
        { said: 'Our agency already handles this', reply: 'That is good. A fresh pair of eyes can still be useful, and the findings may help your agency too.' },
      ],
      closing: 'Your audit is booked, {{customer_name}}. I will send the next steps on WhatsApp. Thank you!',
      outcomes: ['booked_audit', 'interested', 'callback', 'not_interested', 'wrong_number'],
      variables: ['customer_name', 'business_name'],
    },
  },
  {
    id: 'consultant-past-client-reengage', name: 'Past client check-in', goal: 'Win repeat work from past clients', when: 'Past clients 3–6 months after a project, or in April for the new financial year',
    audience: { type: 'customers', tags: ['past-client'] },
    email: {
      subject: '{{first_name}}, how are things since we last worked together?',
      body: 'Hi {{first_name}},\n\nIt has been a few months since we wrapped up [project name], and I wanted to check in.\n\nHow have things been? Is the work we did still holding up, and are you seeing the results you hoped for? If something has slipped or changed, I would genuinely like to know.\n\nWith the new financial year planning around the corner, many of our past clients are setting their goals and budgets for the next few quarters. If you are doing the same, I would be happy to have a 20-minute call to:\n- Review how things have gone since the project\n- Look at what has changed in your business and market\n- Suggest what would make sense to focus on next\n\nThere is no agenda beyond that. As a past client, you also get [returning client benefit] if we work together again.\n\nPick a time here: [calendar link]\n\nWarm regards,\n[your name]\n{{business}}',
    },
    whatsapp: {
      name: 'consult_client_reengage', category: 'MARKETING',
      body: 'Hi {{1}}, it has been a while since we worked on {{2}} together. How are things going? 😊\n\nIf you are planning for the coming quarter, we would be happy to do a free 20-minute review call and suggest what to focus on next.\n\nReply YES and we will set it up.',
      vars: [{ key: 'first_name', example: 'Arjun' }, { fill: 'Past project', example: 'your brand identity project' }], footer: STOP,
    },
    call: {
      goal: 'Book a review call with a past client',
      opening: 'Hello {{customer_name}}, this is {{business_name}}. It has been a few months since we worked together, and I wanted to check how things are going.',
      script: [
        'We would love to hear how the project has worked out for you.',
        'Many of our clients are planning for the next quarter now, and we are offering a free 20-minute review call.',
        'We will look at what has changed and suggest what to focus on next.',
        'Shall I set up that call?',
      ],
      questions: ['How have things been since the project ended?', 'Is anything from the project not working as expected?', 'What are your main goals for the next few months?'],
      objections: [
        { said: 'We are handling it in-house now', reply: 'That is great to hear. A quick review might still help your team. And we are always here if you need extra support.' },
        { said: 'Budgets are frozen right now', reply: 'Understood. The review call is free, and it will help you plan for when budgets open up.' },
      ],
      closing: 'Thank you, {{customer_name}}. I will send the call details on WhatsApp. Good to reconnect!',
      outcomes: ['booked_call', 'interested', 'callback', 'issue_reported', 'not_interested'],
      variables: ['customer_name', 'business_name'],
    },
  },
];

const saas = [
  {
    id: 'saas-demo-request', name: 'Demo request follow-up', goal: 'Book a live product demo', when: 'Within an hour of a demo request or pricing-page enquiry',
    audience: { type: 'leads' },
    email: {
      subject: '{{first_name}}, let’s set up your {{business}} demo',
      body: 'Hi {{first_name}},\n\nThank you for your interest in {{business}}.\n\nInstead of sending you a long feature list, we would like to show you the product working on your own use case. A live demo takes about 30 minutes, and you can bring your team along.\n\nOn the demo, we will:\n- Understand how your team works today and where the time goes\n- Show you only the parts of the product that solve your problem\n- Answer questions on pricing, setup time, integrations and data security\n- Tell you honestly if we are not the right fit\n\nMost teams find it useful to bring the person who will use it every day and the person who signs off on the budget.\n\nPick a time that works for you: [demo booking link]\n\nIf you would like to look around first, you can also start a free trial here: [trial link]\n\nBest regards,\nTeam {{business}}',
    },
    whatsapp: {
      name: 'saas_demo_request', category: 'MARKETING',
      body: 'Hi {{1}}, thanks for your interest in our software! 💻\n\nLet us show you how it works for {{2}} in a 30-minute live demo. We will cover only what matters to you, plus pricing and setup.\n\nReply with a convenient day and time and we will book it.',
      vars: [{ key: 'first_name', example: 'Rohit' }, { fill: 'Customer use case', example: 'managing your sales team’s leads' }], footer: STOP,
    },
    call: {
      goal: 'Qualify the lead and book a product demo',
      opening: 'Hello {{customer_name}}, I am calling from {{business_name}}. You had requested a demo of our software. Do you have two minutes?',
      script: [
        'Thank you for your interest. A few quick questions so our product expert can tailor the demo for you.',
        'The demo takes about 30 minutes, and we show the product on your own use case.',
        'You can bring your team, especially the people who will use it daily.',
        'Shall I book a demo slot for you this week?',
      ],
      questions: ['What does your business do, and how big is the team that will use the software?', 'What tool or process are you using today?', 'What is the main problem you want to solve?', 'Who else is involved in choosing the software?'],
      objections: [
        { said: 'What is the price?', reply: 'Our plans depend on the number of users and features. I will share the pricing page on WhatsApp, and on the demo we will help you pick the right plan.' },
        { said: 'We are already using another software', reply: 'Many of our customers moved from other tools. In the demo we can show what is different and how easy it is to move your data over.' },
        { said: 'Just send me a video', reply: 'Sure, I will send a short product video on WhatsApp. A live demo on your own use case is much more useful though. Shall I hold a slot?' },
      ],
      closing: 'Your demo is booked, {{customer_name}}. I will send the invite and a short video on WhatsApp. Thank you!',
      outcomes: ['booked_demo', 'interested', 'callback', 'not_a_fit', 'not_interested'],
      variables: ['customer_name', 'business_name'],
    },
  },
  {
    id: 'saas-demo-reminder', name: 'Product demo reminder', goal: 'Make sure the prospect joins the booked demo', when: 'A day before and 1 hour before the demo',
    audience: { type: 'leads', tags: ['demo-booked'] },
    email: {
      subject: 'Your {{business}} demo is on [demo date]',
      body: 'Hi {{first_name}},\n\nThis is a reminder about your product demo with {{business}}.\n\nDate and time: [demo date and time]\nJoin here: [meeting link]\n\nTo make the demo as useful as possible:\n- Think of two or three tasks your team spends the most time on today\n- Bring the people who will use the software every day, and the person who approves the budget\n- Keep a list of tools you would want us to connect with, such as Tally, WhatsApp or your website\n- Note any questions about data security, setup or pricing\n\nThe demo takes about 30 minutes, including time for your questions. We will share a recording and a summary afterwards so you can pass it on to anyone who could not join.\n\nIf the time no longer works, reply to this email and we will move it.\n\nSee you soon,\nTeam {{business}}',
    },
    whatsapp: {
      name: 'saas_demo_reminder', category: 'UTILITY',
      body: 'Hi {{1}}, this is a reminder of your product demo on {{2}}.\n\nJoining link: {{3}}\n\nIf you need to change the time, reply to this message and we will reschedule.',
      vars: [{ key: 'first_name', example: 'Swati' }, { fill: 'Demo date and time', example: 'Wed, 16 Oct at 3 pm' }, { fill: 'Meeting link', example: 'https://meet.google.com/xyz-abcd-efg' }],
    },
    call: {
      goal: 'Confirm attendance for the product demo',
      opening: 'Hello {{customer_name}}, this is {{business_name}}. I am calling to confirm your product demo at {{demo_time}}. Do you have a moment?',
      script: [
        'I just wanted to make sure the time still works for you.',
        'If possible, bring the team members who will use the software every day.',
        'The joining link is on your email and WhatsApp.',
      ],
      questions: ['Does the demo time still work for you?', 'Who else from your team will join?', 'Is there anything specific you want us to cover?'],
      objections: [
        { said: 'I am busy at that time', reply: 'No problem. Let me know a time later this week and I will reschedule it right now.' },
        { said: 'We have not decided if we need software yet', reply: 'That is exactly what the demo helps with. You will see whether it saves your team time, and there is no commitment.' },
      ],
      closing: 'Great, your demo is confirmed. See you then, {{customer_name}}!',
      outcomes: ['confirmed', 'rescheduled', 'cancelled', 'callback', 'wrong_number'],
      variables: ['customer_name', 'business_name', 'demo_time'],
    },
  },
  {
    id: 'saas-trial-activation', name: 'Trial activation nudge', goal: 'Get trial users to finish setup and see value', when: '2–3 days into a free trial, for users who have not completed setup',
    audience: { type: 'leads', tags: ['trial'] },
    email: {
      subject: '{{first_name}}, one step to get value from your trial',
      body: 'Hi {{first_name}},\n\nThank you for starting your free trial of {{business}}. We noticed you have not finished setting up yet, which is very normal. Most people sign up on a busy day and then real work takes over.\n\nHere is the good news: you only need to do one thing to see if this works for you.\n\n[The one key setup step, e.g. import your contacts or connect your WhatsApp number]\n\nIt takes about [time needed]. Once it is done, you will see [the first visible result for the user].\n\nIf you would like help, our onboarding team can set it up with you on a 15-minute screen-share call, in English or Hindi. Book a slot here: [link]\n\nOr just reply to this email with your question. A real person from our team will answer, usually within a few hours.\n\nYour trial is running, so do make the most of it.\n\nTeam {{business}}',
    },
    whatsapp: {
      name: 'saas_trial_activation', category: 'MARKETING',
      body: 'Hi {{1}}, how is your free trial going? 🙂\n\nTo see real value, just {{2}}. It takes only a few minutes.\n\nWant help? Reply HELP and our team will set it up with you on a quick call, in English or Hindi.',
      vars: [{ key: 'first_name', example: 'Imran' }, { fill: 'Key setup step', example: 'import your customer list from Excel' }], footer: STOP,
    },
    call: {
      goal: 'Help the trial user complete setup',
      opening: 'Hello {{customer_name}}, I am calling from {{business_name}} about your free trial. I wanted to check if you need any help getting started.',
      script: [
        'We noticed the setup is not complete yet, and that is very common.',
        'The most important step takes only a few minutes, and after that you will see how the product works for you.',
        'Our onboarding team can do it with you on a short screen-share call.',
        'Shall I book a 15-minute setup call?',
      ],
      questions: ['What made you sign up for the trial?', 'Did you get stuck anywhere during setup?', 'Who in your team will use the software most?'],
      objections: [
        { said: 'I have not had time', reply: 'Completely understood. That is why we offer a 15-minute setup call; we do most of the work with you. When are you free?' },
        { said: 'It looked complicated', reply: 'Thanks for telling me. Our team will walk you through it step by step, in Hindi or English, whichever you prefer.' },
        { said: 'I am not sure we need it', reply: 'That is fair. Once the basic setup is done you can judge for yourself. If it does not help, you simply do not continue.' },
      ],
      closing: 'Your setup call is booked, {{customer_name}}. I will send the link on WhatsApp. Thank you!',
      outcomes: ['booked_onboarding', 'activated', 'callback', 'not_interested', 'wrong_number'],
      variables: ['customer_name', 'business_name'],
    },
  },
  {
    id: 'saas-trial-ending', name: 'Trial ending: upgrade', goal: 'Convert trial users to a paid plan', when: '3 days before and on the day the free trial ends',
    audience: { type: 'leads', tags: ['trial'] },
    email: {
      subject: 'Your free trial ends on [trial end date]',
      body: 'Hi {{first_name}},\n\nYour free trial of {{business}} ends on [trial end date].\n\nIf the software has been useful for your team, you can continue without losing anything. All your data, settings and contacts stay exactly as they are when you upgrade.\n\nChoose your plan here: [upgrade link]\n\nA few things our customers usually ask at this point:\n- You can pay monthly or yearly, by UPI, card or net banking, with a GST invoice\n- You can add or remove users at any time\n- There is no long lock-in on monthly plans\n\nIf you have not had time to try it properly, just reply to this email. We would rather give you a little more time than have you decide without seeing it work.\n\nAnd if it was not the right fit, we would really value a one-line reply telling us why. It helps us improve.\n\nThank you for trying us,\nTeam {{business}}',
    },
    whatsapp: {
      name: 'saas_trial_ending', category: 'MARKETING',
      body: 'Hi {{1}}, your free trial ends on {{2}}. ⏳\n\nUpgrade to keep all your data and settings exactly as they are. Monthly and yearly plans, GST invoice included.\n\nNeed more time or have a question? Reply here and our team will help.',
      vars: [{ key: 'first_name', example: 'Nisha' }, { fill: 'Trial end date', example: 'Friday, 18 Oct' }], footer: STOP,
    },
    call: {
      goal: 'Convert the trial user to a paid plan',
      opening: 'Hello {{customer_name}}, this is {{business_name}}. Your free trial ends soon, and I wanted to check how your experience has been.',
      script: [
        'If the software has been useful, you can upgrade and keep all your data and settings.',
        'We have monthly and yearly plans, and you get a GST invoice.',
        'I can help you pick the right plan based on your team size.',
        'Would you like me to send the upgrade link?',
      ],
      questions: ['How has your team found the software so far?', 'Which features did you use the most?', 'How many users would need access?', 'Is anything missing that would stop you from continuing?'],
      objections: [
        { said: 'It is too expensive', reply: 'I understand. The yearly plan works out cheaper per month, and we also have a smaller plan with fewer users. Let me suggest the one that fits.' },
        { said: 'I did not get time to use it properly', reply: 'That happens. I can ask the team to extend your trial a little and book a quick setup call so you can really try it.' },
        { said: 'I need to discuss with my partner', reply: 'Of course. Shall I send a short summary of the plans on WhatsApp so you can share it with them?' },
      ],
      closing: 'Thank you, {{customer_name}}. I am sending the details on WhatsApp now. Happy to help anytime.',
      outcomes: ['upgraded', 'trial_extended', 'interested', 'callback', 'not_interested'],
      variables: ['customer_name', 'business_name'],
    },
  },
  {
    id: 'saas-renewal-due', name: 'Subscription renewal reminder', goal: 'Get the subscription renewed without a break', when: '7 days and 1 day before the subscription renews or expires',
    audience: { type: 'customers', tags: ['renewal-due'] },
    email: {
      subject: 'Your {{business}} subscription renews on [renewal date]',
      body: 'Hi {{first_name}},\n\nThis is a reminder that your {{business}} subscription is due for renewal.\n\nPlan: [plan name]\nRenewal date: [renewal date]\nAmount: [amount, including GST]\n\nRenew here: [payment link]\n\nYou can pay by UPI, card or net banking. Your GST invoice will be emailed to you as soon as the payment is done.\n\nIf auto-renewal is on, you do not need to do anything; please just make sure your saved payment method is active.\n\nIf the renewal is not done by the due date, your account moves to read-only mode, and your team will not be able to add or update records until it is renewed. Your data stays safe either way.\n\nNeed to change your plan, add users or update your billing details or GSTIN before renewing? Just reply to this email and our team will help.\n\nThank you for being with us,\nTeam {{business}}',
    },
    whatsapp: {
      name: 'saas_renewal_due', category: 'UTILITY',
      body: 'Hi {{1}}, your subscription is due for renewal on {{2}}. The amount is {{3}} including GST.\n\nRenew here: {{4}} using UPI, card or net banking.\n\nIf you have already renewed, please ignore this message.',
      vars: [{ key: 'first_name', example: 'Prakash' }, { fill: 'Renewal date', example: '1 November' }, { fill: 'Amount', example: '₹11,800' }, { fill: 'Payment link', example: 'https://rzp.io/l/renew42' }],
    },
    call: {
      goal: 'Get the renewal done before the due date',
      opening: 'Hello {{customer_name}}, this is {{business_name}}. I am calling about your subscription renewal due on {{renewal_date}}. Is this a good time?',
      script: [
        'I just wanted to remind you so there is no break in service for your team.',
        'The payment link is on your email and WhatsApp, and you will get a GST invoice right away.',
        'If you want to change your plan or users before renewing, I can help with that now.',
      ],
      questions: ['Are you planning to renew on the same plan?', 'Do you need any change in users or billing details?', 'When can you complete the payment?'],
      objections: [
        { said: 'We are thinking of switching to another tool', reply: 'I am sorry to hear that. May I ask what is not working for you? If it is something we can fix, I would like to try before you decide.' },
        { said: 'The price has gone up', reply: 'I understand. The yearly plan works out cheaper per month, and I can check if a smaller plan fits your current usage.' },
        { said: 'The person who handles payments is not available', reply: 'No problem. Could you share their contact, or shall I send the details on WhatsApp so you can forward them?' },
      ],
      closing: 'Thank you, {{customer_name}}. I have noted it and resent the link on WhatsApp. Have a great day!',
      outcomes: ['renewed', 'promised_date', 'plan_change', 'churn_risk', 'callback'],
      variables: ['customer_name', 'business_name', 'renewal_date'],
    },
  },
  {
    id: 'saas-annual-plan-offer', name: 'Switch to yearly plan offer', goal: 'Move monthly customers to a yearly plan', when: 'Before March year-end budgets, or during a festive offer window',
    audience: { type: 'customers', tags: ['monthly-plan'] },
    email: {
      subject: '{{first_name}}, switch to yearly and save on {{business}}',
      body: 'Hi {{first_name}},\n\nThank you for using {{business}} every month. Since your team clearly relies on it, here is a simple way to spend less on it.\n\nUntil [offer end date], you can switch from your monthly plan to a yearly plan and get [offer, e.g. two months free].\n\nWhy many of our customers prefer yearly:\n- You pay less overall than twelve monthly payments\n- One GST invoice for the year, which your accountant will appreciate\n- No monthly renewal reminders or failed card payments\n- Your price stays locked for the full year\n\nIf you are closing your books for the year, this is also a good time to use the budget you have already planned for software.\n\nSwitch to yearly here: [upgrade link]\n\nYour data, users and settings stay exactly as they are. Nothing changes except your bill.\n\nQuestions? Just reply to this email.\n\nTeam {{business}}',
    },
    whatsapp: {
      name: 'saas_annual_plan_offer', category: 'MARKETING',
      body: 'Hi {{1}}, thank you for being a regular user! 🙏\n\nSwitch from monthly to yearly before {{2}} and get {{3}}. One GST invoice, locked price, no monthly renewals.\n\nReply YEARLY and we will send you the switch link.',
      vars: [{ key: 'first_name', example: 'Sunil' }, { fill: 'Offer end date', example: '31 March' }, { fill: 'Offer', example: '2 months free' }], footer: STOP,
    },
    call: {
      goal: 'Move a monthly customer to a yearly plan',
      opening: 'Hello {{customer_name}}, this is {{business_name}}. Thank you for being a regular customer. I am calling about an offer to switch to our yearly plan.',
      script: [
        'Since your team uses the software every month, the yearly plan will save you money.',
        'You get one GST invoice, a locked price for the year and no monthly renewals.',
        'Your data and settings stay exactly the same.',
        'Shall I send you the link to switch?',
      ],
      questions: ['How is the software working for your team?', 'Do you plan to add more users this year?', 'Who approves software payments in your company?'],
      objections: [
        { said: 'We do not want to pay so much at once', reply: 'Understood. Over the year it costs less than monthly though. If cash flow is the concern, I can check if a split payment is possible.' },
        { said: 'What if we stop using it midway?', reply: 'Fair question. I will share our refund and cancellation terms on WhatsApp so you can decide with full clarity.' },
      ],
      closing: 'Thank you, {{customer_name}}. I am sending the switch link and terms on WhatsApp now.',
      outcomes: ['switched_yearly', 'interested', 'callback', 'not_interested', 'wrong_number'],
      variables: ['customer_name', 'business_name'],
    },
  },
  {
    id: 'saas-churned-winback', name: 'Churned customer win-back', goal: 'Bring back customers who cancelled or did not renew', when: '30–90 days after a subscription lapsed',
    audience: { type: 'customers', tags: ['churned'] },
    email: {
      subject: '{{first_name}}, a lot has changed at {{business}}',
      body: 'Hi {{first_name}},\n\nIt has been a little while since your {{business}} subscription ended. We would genuinely like to know why. Was it the price, a missing feature, or simply that the timing was not right?\n\nWe have been listening to customers like you, and here is what has changed since you left:\n- [New feature or improvement 1]\n- [New feature or improvement 2]\n\nYour old data is still safely stored with us, so if you come back, you start right where you left off. No setup from scratch.\n\nIf you would like to give it another try, you can reactivate your account here: [link]\n\nOr if you would rather see what is new first, reply to this email and we will set up a short walkthrough with your team.\n\nAnd if you have moved on for good, a one-line reply about why would help us a lot.\n\nThank you,\nTeam {{business}}',
    },
    whatsapp: {
      name: 'saas_churned_winback', category: 'MARKETING',
      body: 'Hi {{1}}, we have missed you! A lot has changed since you last used our software, including {{2}}. ✨\n\nYour old data is still safe with us, so you can start right where you left off.\n\nReply YES for a quick walkthrough of what is new.',
      vars: [{ key: 'first_name', example: 'Tarun' }, { fill: 'New feature', example: 'WhatsApp reminders and a new mobile app' }], footer: STOP,
    },
    call: {
      goal: 'Understand why they left and win them back',
      opening: 'Hello {{customer_name}}, I am calling from {{business_name}}. You had used our software earlier, and I wanted to understand your experience. Do you have two minutes?',
      script: [
        'We would really like to know why you stopped, so we can improve.',
        'We have made several changes since then, and some of them may solve the problem you faced.',
        'Your old data is still safe, so you can start right where you left off.',
        'Would you like a short walkthrough of what is new?',
      ],
      questions: ['What made you stop using the software?', 'What are you using instead now?', 'Is that tool solving the problem fully?'],
      objections: [
        { said: 'It was too expensive', reply: 'Thank you for telling me. We now have more plan options, including a smaller one. Let me check what would fit your usage today.' },
        { said: 'We are happy with the new tool', reply: 'That is good to hear. If anything changes, we are here, and your data is still with us. Can I check in after a few months?' },
        { said: 'It did not have the feature we needed', reply: 'Which feature was it? Several have been added recently, and if it is still missing, I will pass your feedback directly to our product team.' },
      ],
      closing: 'Thank you for your honest feedback, {{customer_name}}. I will send the details on WhatsApp.',
      outcomes: ['reactivated', 'booked_demo', 'callback', 'feedback_only', 'not_interested'],
      variables: ['customer_name', 'business_name'],
    },
  },
];

export default { education, abroad, general, consultant, saas };
