// Campaign templates: online stores, travel, hotels & restaurants, recruitment, NGOs — format in ../campaigntpl.js
const STOP = 'Reply STOP to opt out';
const fn = { key: 'first_name', example: 'Neha' };

export default {
  // ───────────────────────── Online stores / D2C brands ─────────────────────────
  store: [
    {
      id: 'store-festive-sale', name: 'Diwali / festive sale', goal: 'Drive orders during the festive sale', when: '7–10 days before Diwali, Navratri or Raksha Bandhan',
      audience: { type: 'all' },
      email: {
        subject: '{{first_name}}, our festive sale is live',
        body: 'Hi {{first_name}},\n\nThe festive season is here, and so is the one sale we plan for all year.\n\nFrom now till [sale end date], everything on {{business}} is [discount] off. Gifts for family, something new for the puja, a little treat for yourself, it is all in one place.\n\nA few honest tips so you get the best of it:\n\nOrder early. Couriers get busy in the last week before Diwali, and we want your parcel to reach you before the festival, not after.\n\nUse code [code] at checkout. The discount applies on top of prices you already see.\n\nBuying gifts? Add a note at checkout and we will pack it so it is ready to hand over.\n\nShop the sale here: [link]\n\nWishing you and your family a bright and happy festive season.\n\nWarm wishes,\n{{business}}',
      },
      whatsapp: {
        name: 'store_festive_sale', category: 'MARKETING',
        body: 'Hi {{1}} 🪔 Our festive sale is live!\n\nGet {{2}} off on everything with code {{3}} at checkout.\n\nOrder early so your parcel reaches you before the festival. Shop now: {{4}}\n\nHappy festivities from all of us!',
        vars: [fn, { fill: 'Discount', example: '20%' }, { fill: 'Discount code', example: 'DIWALI20' }, { fill: 'Shop link', example: 'shop.example.in/sale' }],
        footer: STOP,
      },
      call: {
        goal: 'Tell past buyers about the festive sale and get them to order',
        opening: 'Namaste {{customer_name}}, main {{business_name}} se bol rahi hoon. Aapne pehle humse shopping ki thi, isliye aapko humare festive sale ke baare mein batana tha.',
        script: [
          'Is festive season mein humari poori range par {{discount}} off chal raha hai, sale {{sale_end_date}} tak hai.',
          'Bahut log abhi se Diwali gifts order kar rahe hain taaki parcel time par pahunch jaaye.',
          'Main aapko WhatsApp par sale ka link aur code bhej deti hoon, aap aaram se dekh lijiye.',
          'Agar kisi product ke baare mein sawaal ho, toh main abhi bata sakti hoon.',
        ],
        questions: ['Kya aap is baar kisi ke liye gift dekh rahe hain, ya apne liye?', 'Aapko pichli baar wala product kaisa laga tha?', 'Kya main link WhatsApp par bhej doon?'],
        objections: [
          { said: 'I am not shopping right now', reply: 'Bilkul theek hai. Main sirf link bhej deti hoon, sale {{sale_end_date}} tak hai, jab mann ho tab dekh lijiye.' },
          { said: 'Delivery late ho jaati hai', reply: 'Isiliye hum abhi bata rahe hain. Jaldi order karenge toh festival se pehle delivery ka sabse achha chance hai.' },
          { said: 'Online se sasta mil jaata hai', reply: 'Samajh sakti hoon. Humari sale price aur code dono milake dekhiye, aur humare yahan return bhi aasaan hai.' },
        ],
        closing: 'Dhanyavaad {{customer_name}}! Link aur code WhatsApp par bhej rahi hoon. Aapko aur aapke parivaar ko festive season ki shubhkamnayein.',
        outcomes: ['interested', 'ordered', 'send_link', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'discount', 'sale_end_date'],
      },
    },
    {
      id: 'store-abandoned-cart', name: 'Abandoned cart nudge', goal: 'Bring shoppers back to complete their order', when: '2–24 hours after a cart is left unpaid',
      audience: { type: 'leads', tags: ['abandoned-cart'] },
      email: {
        subject: 'You left something in your cart, {{first_name}}',
        body: 'Hi {{first_name}},\n\nYou were picking out something on {{business}} and did not get to finish. No problem, we saved your cart for you.\n\nComplete your order here: [link]\n\nIf something stopped you, tell us. Most people pause for one of three reasons:\n\nDelivery time. We ship within [dispatch time] and you get a tracking link on WhatsApp.\n\nSize or fit. Reply to this email and we will help you choose. Exchanges are easy if it does not fit.\n\nPayment. You can pay by UPI, card, or cash on delivery, whatever is comfortable for you.\n\nIf you just got busy, your cart is right where you left it. Stock does move though, so if you liked it, it is worth finishing today.\n\nAny question at all, just hit reply. A real person reads every message.\n\nThank you,\n{{business}}',
      },
      whatsapp: {
        name: 'store_cart_reminder', category: 'MARKETING',
        body: 'Hi {{1}}, you left something in your cart at {{2}} 🛒\n\nWe have saved it for you. Finish your order here: {{3}}\n\nUPI, card and cash on delivery are all available. Any question about size or delivery? Just reply here.',
        vars: [fn, { fill: 'Store name', example: 'Kalaa Handloom' }, { fill: 'Cart link', example: 'shop.example.in/cart' }],
        footer: STOP,
      },
      call: {
        goal: 'Help the shopper finish their order',
        opening: 'Hello {{customer_name}}, I am calling from {{business_name}}. You had added {{product_name}} to your cart on our website, so I just wanted to check if I can help you complete the order.',
        script: [
          'Sometimes people stop because of a small doubt, like size, delivery or payment.',
          'We ship within a couple of days and you get tracking on WhatsApp.',
          'You can pay by UPI, card, or cash on delivery.',
          'I can send you the cart link on WhatsApp right now so you can finish in one minute.',
        ],
        questions: ['Was there anything that stopped you from placing the order?', 'Do you have any question about size or quality?', 'Would you prefer cash on delivery or online payment?'],
        objections: [
          { said: 'I was just browsing', reply: 'Of course. I will send the link so it is saved for you. Stock does move, so if you liked it, you will know where to find it.' },
          { said: 'Shipping charge is too much', reply: 'I understand. Let me check if your order qualifies for free shipping. Adding one small item sometimes makes it free.' },
          { said: 'I am not sure about the size', reply: 'No worries, tell me your usual size and I will guide you. And if it does not fit, exchange is easy.' },
        ],
        closing: 'Thank you {{customer_name}}. I have sent the link on WhatsApp. Have a great day!',
        outcomes: ['ordered', 'send_link', 'interested', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'product_name'],
      },
    },
    {
      id: 'store-cod-confirm', name: 'COD order confirmation', goal: 'Confirm cash-on-delivery orders before shipping', when: 'Right after a cash-on-delivery order is placed',
      audience: { type: 'customers', tags: ['cod'] },
      email: {
        subject: 'Please confirm your cash-on-delivery order',
        body: 'Hi {{first_name}},\n\nThank you for ordering from {{business}}. Your order [order number] is ready to be packed.\n\nSince you chose cash on delivery, we just need a quick confirmation before we ship it. This makes sure the parcel goes to the right address and you are home to receive it.\n\nPlease check these details:\n\nOrder amount: [order amount], payable in cash or UPI to the delivery partner.\n\nDelivery address: as entered at checkout. If anything needs changing, reply to this email with the correct address and pin code.\n\nConfirm your order here: [link]\n\nOnce confirmed, we will dispatch it and send you a tracking link on WhatsApp.\n\nIf you did not place this order, or want to cancel, just reply and we will cancel it right away.\n\nThank you,\n{{business}}',
      },
      whatsapp: {
        name: 'store_cod_confirm', category: 'UTILITY',
        body: 'Hi {{1}}, thank you for your order {{2}} with cash on delivery.\n\nAmount payable at delivery: {{3}}\n\nPlease reply YES to confirm so we can dispatch it, or NO to cancel. To change the address, reply with the new address and pin code.',
        vars: [fn, { fill: 'Order number', example: '#1042' }, { fill: 'Order amount', example: '₹1,299' }],
      },
      call: {
        goal: 'Confirm the COD order and the delivery address',
        opening: 'Namaste {{customer_name}}, main {{business_name}} se bol raha hoon. Aapne humare yahan cash on delivery order kiya hai, bas use confirm karna tha.',
        script: [
          'Aapka order number {{order_number}} hai, aur delivery par {{order_amount}} dena hoga, cash ya UPI se.',
          'Main aapka address padh deta hoon, aap bata dijiye sahi hai ya nahi.',
          'Confirm hote hi hum parcel dispatch kar denge aur tracking link WhatsApp par aa jaayega.',
        ],
        questions: ['Kya order aapne hi place kiya hai?', 'Kya hum isi address aur pin code par bhej dein?', 'Delivery ke time ghar par koi parcel le sakega?'],
        objections: [
          { said: 'Maine yeh order nahi kiya', reply: 'Theek hai, koi baat nahi. Main abhi yeh order cancel kar deta hoon, aapko kuch nahi dena hoga.' },
          { said: 'Kya main online pay kar sakta hoon?', reply: 'Haan bilkul. Main aapko payment link WhatsApp par bhej deta hoon, aur delivery par UPI se bhi de sakte hain.' },
          { said: 'Address badalna hai', reply: 'Zaroor. Naya address aur pin code bata dijiye, main abhi update kar deta hoon.' },
        ],
        closing: 'Dhanyavaad {{customer_name}}, aapka order confirm ho gaya hai. Tracking link jaldi WhatsApp par aayega.',
        outcomes: ['confirmed_order', 'address_changed', 'cancelled_order', 'callback', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'order_number', 'order_amount'],
      },
    },
    {
      id: 'store-reorder-reminder', name: 'Reorder reminder', goal: 'Get repeat orders for consumable products', when: 'When a customer’s last pack is likely to run out',
      audience: { type: 'customers', tags: ['repeat-product'] },
      email: {
        subject: '{{first_name}}, time to restock?',
        body: 'Hi {{first_name}},\n\nIt has been a few weeks since your last order of [product] from {{business}}. If you have been using it regularly, you are probably close to the last bit.\n\nWe wanted to remind you before it runs out, so there is no gap.\n\nReordering takes less than a minute: [link]\n\nYour previous details are saved, so you only need to confirm and pay. Delivery usually takes [delivery time].\n\nIf you would like to try a bigger pack or a different variant this time, just reply and we will suggest what suits you best. Many of our regular customers switch to the larger size because it works out cheaper per use.\n\nAnd if something about the product did not work for you, we would really like to know. Reply and tell us honestly.\n\nThank you for being a regular,\n{{business}}',
      },
      whatsapp: {
        name: 'store_reorder_reminder', category: 'MARKETING',
        body: 'Hi {{1}}, your {{2}} from us might be running low by now.\n\nReorder in one tap and get it delivered without a gap: {{3}}\n\nWant a bigger pack or a different variant this time? Just reply here and we will help.',
        vars: [fn, { fill: 'Product', example: 'cold-pressed coconut oil' }, { fill: 'Reorder link', example: 'shop.example.in/reorder' }],
        footer: STOP,
      },
      call: {
        goal: 'Get the customer to reorder before they run out',
        opening: 'Hello {{customer_name}}, main {{business_name}} se bol rahi hoon. Aapne kuch hafte pehle humse {{product_name}} liya tha, toh socha check kar loon.',
        script: [
          'Aksar is time tak pack khatam hone wala hota hai.',
          'Aap chahein toh main abhi wahi order dobara laga sakti hoon, same address par.',
          'Bade pack mein per use thoda sasta padta hai, agar aap regular use karte hain.',
        ],
        questions: ['Product aapko kaisa laga?', 'Kya abhi stock khatam hone wala hai?', 'Same pack chahiye ya bada pack try karenge?'],
        objections: [
          { said: 'Abhi bacha hua hai', reply: 'Achhi baat hai. Main aapko reorder link WhatsApp par bhej deti hoon, jab zaroorat ho ek tap mein order ho jaayega.' },
          { said: 'Mujhe result nahi mila', reply: 'Batane ke liye shukriya. Kya aap bata sakte hain kya problem hui? Main aapko sahi product suggest kar sakti hoon ya team se baat karwa sakti hoon.' },
        ],
        closing: 'Thank you {{customer_name}}. Main details WhatsApp par bhej rahi hoon. Aapka din achha ho!',
        outcomes: ['reordered', 'send_link', 'callback', 'unhappy_customer', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'product_name'],
      },
    },
    {
      id: 'store-new-collection', name: 'New collection launch', goal: 'Get past buyers to shop the new collection', when: 'On launch day of a new collection or season drop',
      audience: { type: 'customers' },
      email: {
        subject: 'Just in: our [collection name] collection',
        body: 'Hi {{first_name}},\n\nYou have shopped with {{business}} before, so we wanted you to see this first.\n\nOur new [collection name] collection is live today.\n\nWe worked on it for months. The pieces are made in small quantities, which means popular sizes and colours tend to go quickly. That is not a sales line, it is just how small batches work.\n\nWhat you will find:\n\nNew designs you have not seen from us before.\n\nThe same quality and finishing you already know.\n\nEasy exchange if the size or colour is not right.\n\nSee the full collection here: [link]\n\nIf you want help choosing, reply with what you are looking for and the occasion, and we will send you a few picks that suit you.\n\nWe hope you love it as much as we do.\n\nWarmly,\n{{business}}',
      },
      whatsapp: {
        name: 'store_new_collection', category: 'MARKETING',
        body: 'Hi {{1}} ✨ Our new {{2}} collection is live today!\n\nMade in small batches, so popular sizes go quickly. Take a look: {{3}}\n\nWant help choosing? Reply with the occasion and we will send you a few picks.',
        vars: [fn, { fill: 'Collection name', example: 'Monsoon Cotton' }, { fill: 'Collection link', example: 'shop.example.in/new' }],
        footer: STOP,
      },
      call: {
        goal: 'Tell loyal buyers about the new collection',
        opening: 'Hi {{customer_name}}, I am calling from {{business_name}}. You have shopped with us before, so we wanted to tell you personally about our new {{collection_name}} collection.',
        script: [
          'It launched today and it is made in small batches.',
          'There are new designs along with the quality you already know from us.',
          'I can send you the collection link on WhatsApp so you can browse at your own pace.',
        ],
        questions: ['What did you buy from us last time, and how did you like it?', 'Are you shopping for any occasion coming up?', 'Shall I share the link on WhatsApp?'],
        objections: [
          { said: 'I just bought something recently', reply: 'That is lovely. No pressure at all, I will just share the link so you can see the new designs whenever you like.' },
          { said: 'It is too expensive', reply: 'I understand. There are pieces across price points in this collection. Tell me your budget and I will pick a few for you.' },
        ],
        closing: 'Thank you {{customer_name}}, the link is on its way. Happy shopping!',
        outcomes: ['interested', 'send_link', 'ordered', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'collection_name'],
      },
    },
    {
      id: 'store-review-request', name: 'Review request after delivery', goal: 'Collect honest reviews from happy customers', when: '3–5 days after the order is delivered',
      audience: { type: 'customers', tags: ['delivered'] },
      email: {
        subject: 'How is your order, {{first_name}}?',
        body: 'Hi {{first_name}},\n\nYour order from {{business}} reached you a few days ago. We hope you are enjoying it.\n\nCould you spare one minute to tell us how it is? Your review helps in two ways.\n\nIt helps other shoppers decide. Most people read reviews before they buy from a small brand like ours.\n\nIt helps us improve. We read every single review, the good ones and the not-so-good ones.\n\nLeave your review here: [link]\n\nA line or two is enough. A photo of the product in use is even better, if you are comfortable sharing one.\n\nAnd if something was not right, please do not keep it to yourself. Reply to this email and we will make it right first.\n\nThank you for supporting a small business,\n{{business}}',
      },
      whatsapp: {
        name: 'store_review_request', category: 'MARKETING',
        body: 'Hi {{1}}, we hope you are enjoying your order from {{2}} 😊\n\nCould you take one minute to share a review? It really helps a small brand like ours: {{3}}\n\nIf anything was not right, reply here and we will fix it first.',
        vars: [fn, { fill: 'Store name', example: 'Kalaa Handloom' }, { fill: 'Review link', example: 'shop.example.in/review' }],
        footer: STOP,
      },
      call: {
        goal: 'Get feedback and request a review from satisfied customers',
        opening: 'Namaste {{customer_name}}, main {{business_name}} se bol rahi hoon. Aapka order kuch din pehle deliver hua tha, bas yeh poochna tha ki sab theek hai na?',
        script: [
          'Hum ek chhota brand hain, aur har customer ka feedback humare liye bahut maayne rakhta hai.',
          'Agar aapko product pasand aaya, toh kya aap ek chhota sa review de sakte hain?',
          'Main review ka link WhatsApp par bhej deti hoon, ek minute lagega.',
        ],
        questions: ['Product aapko kaisa laga, 1 se 5 mein kitna denge?', 'Packaging aur delivery theek thi?', 'Kya main review link WhatsApp par bhej doon?'],
        objections: [
          { said: 'Mere paas time nahi hai', reply: 'Bilkul samajh sakti hoon. Link bhej deti hoon, jab free hon tab ek line likh dijiye, bas.' },
          { said: 'Product mein problem hai', reply: 'Mujhe sun kar dukh hua. Pehle aapki problem solve karte hain. Kya hua, bata dijiye, main abhi team ko bhejti hoon.' },
        ],
        closing: 'Bahut shukriya {{customer_name}}, aapka feedback humare liye bahut keemti hai.',
        outcomes: ['happy_will_review', 'send_link', 'complaint', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name'],
      },
    },
    {
      id: 'store-winback-90', name: 'Win-back: no order in 90 days', goal: 'Bring back customers who stopped buying', when: '90 days after the last order',
      audience: { type: 'customers', tags: ['inactive-90'] },
      email: {
        subject: 'We miss you at {{business}}, {{first_name}}',
        body: 'Hi {{first_name}},\n\nIt has been a while since your last order with {{business}}, and we noticed.\n\nMaybe life got busy. Maybe something about your last order was not quite right. Either way, we would love to have you back.\n\nHere is what has changed since you last shopped:\n\nNew products and designs have been added.\n\nWe have made delivery faster to most pin codes.\n\nAs a thank-you for coming back, here is [discount] off your next order with code [code]. It is valid till [expiry date].\n\nShop here: [link]\n\nIf something went wrong last time, just reply and tell us. We would rather hear it and fix it than lose you quietly. Every message reaches a real person on our team.\n\nHope to see you again soon,\n{{business}}',
      },
      whatsapp: {
        name: 'store_winback_90', category: 'MARKETING',
        body: 'Hi {{1}}, it has been a while! We miss you at our store.\n\nHere is {{2}} off your next order with code {{3}} as a welcome back.\n\nSee what is new: {{4}}\n\nIf anything was not right last time, just reply and tell us.',
        vars: [fn, { fill: 'Discount', example: '15%' }, { fill: 'Discount code', example: 'COMEBACK15' }, { fill: 'Shop link', example: 'shop.example.in' }],
        footer: STOP,
      },
      call: {
        goal: 'Understand why the customer stopped and bring them back',
        opening: 'Hello {{customer_name}}, main {{business_name}} se bol raha hoon. Aapne kaafi time se humse order nahi kiya, toh socha ek baar baat kar loon.',
        script: [
          'Sabse pehle, kya pichla order theek tha? Aapka honest feedback chahiye.',
          'Is beech humne kaafi naye products add kiye hain aur delivery bhi fast ki hai.',
          'Wapas aane ke liye aapke liye {{discount}} off ka code hai.',
          'Main code aur link WhatsApp par bhej deta hoon.',
        ],
        questions: ['Pichla experience kaisa tha?', 'Kya koi reason tha ki aapne dobara order nahi kiya?', 'Kya main code WhatsApp par bhej doon?'],
        objections: [
          { said: 'Delivery bahut late aayi thi', reply: 'Maafi chahta hoon. Ab humne courier partner badla hai aur zyada pin codes par delivery fast hai. Ek baar phir try kijiye.' },
          { said: 'Mujhe ab zaroorat nahi', reply: 'Koi baat nahi, samajh gaya. Kya main aapko sirf festive offers ke time update bhej sakta hoon?' },
        ],
        closing: 'Shukriya {{customer_name}}, code WhatsApp par bhej raha hoon. Umeed hai jaldi milenge.',
        outcomes: ['interested', 'send_code', 'ordered', 'complaint', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'discount'],
      },
    },
  ],

  // ───────────────────────── Travel agencies / tour operators ─────────────────────────
  travel: [
    {
      id: 'travel-new-enquiry', name: 'New trip enquiry follow-up', goal: 'Turn a trip enquiry into a planning call', when: 'Within an hour of a new trip enquiry',
      audience: { type: 'leads', tags: ['enquiry'] },
      email: {
        subject: 'Your [destination] trip, {{first_name}}',
        body: 'Hi {{first_name}},\n\nThank you for asking {{business}} about a trip to [destination]. Lovely choice.\n\nTo plan something that actually fits you, and not a copy-paste package, we need a few details:\n\nWhen would you like to travel, and for how many nights?\n\nHow many people, and are there kids or elders in the group?\n\nWhat kind of trip is it, relaxed, adventure, family, honeymoon?\n\nA rough budget per person helps us suggest the right hotels.\n\nJust reply to this email with these, or book a 15-minute call with our travel planner here: [link]\n\nWithin a day of hearing from you, we will send you a day-by-day itinerary with a clear price, including what is covered and what is not. No hidden costs later.\n\nLooking forward to planning this with you,\n{{business}}',
      },
      whatsapp: {
        name: 'travel_new_enquiry', category: 'MARKETING',
        body: 'Hi {{1}}, thank you for your enquiry about {{2}} ✈️\n\nTo send you a day-by-day plan with a clear price, please share:\n• Travel dates\n• Number of people (and kids)\n• Rough budget per person\n\nOr book a quick call with our planner: {{3}}\n\nWe usually reply with an itinerary within a day.',
        vars: [fn, { fill: 'Destination', example: 'Kashmir' }, { fill: 'Booking link', example: 'cal.example.in/plan' }],
        footer: STOP,
      },
      call: {
        goal: 'Understand the trip needs and book a planning call',
        opening: 'Namaste {{customer_name}}, main {{business_name}} se bol rahi hoon. Aapne {{destination}} trip ke liye enquiry ki thi, uske baare mein baat karni thi.',
        script: [
          'Main kuch chhote sawaal poochungi taaki hum aapke liye sahi itinerary bana sakein.',
          'Hum day-by-day plan bhejte hain, saaf price ke saath, kya included hai aur kya nahi.',
          'Aapki details lekar ek din mein plan WhatsApp par bhej denge.',
        ],
        questions: ['Aap kab travel karna chahte hain, aur kitni raatein?', 'Kitne log jaa rahe hain, bachche ya bade-buzurg bhi hain?', 'Per person budget roughly kitna socha hai?', 'Trip relaxed chahiye ya sightseeing aur adventure wala?'],
        objections: [
          { said: 'Main abhi bas rates dekh raha hoon', reply: 'Bilkul theek hai. Isiliye hum free itinerary aur price bhejte hain, aap compare kar lijiye, koi commitment nahi.' },
          { said: 'Online package sasta milta hai', reply: 'Ho sakta hai. Hum hotel ki location aur inclusions saaf likhte hain, toh aap seedha compare kar sakenge. Trip ke beech koi dikkat ho toh hum ek call par hote hain.' },
          { said: 'Dates abhi fix nahi hain', reply: 'Koi baat nahi. Roughly mahina bata dijiye, us hisaab se plan aur price bhej dete hain.' },
        ],
        closing: 'Thank you {{customer_name}}. Ek din mein aapka itinerary WhatsApp par aa jaayega.',
        outcomes: ['qualified', 'call_booked', 'send_itinerary', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'destination'],
      },
    },
    {
      id: 'travel-summer-holidays', name: 'Summer holiday packages', goal: 'Get families to book summer vacation trips early', when: 'February–March, before school summer holidays',
      audience: { type: 'all' },
      email: {
        subject: 'Plan the kids’ summer holiday early, {{first_name}}',
        body: 'Hi {{first_name}},\n\nSchools close for summer in a few weeks, and every family in India seems to plan the same trip at the same time. That is when flights get costly and good hotels fill up.\n\nThe simple fix is to book early.\n\nThis season, {{business}} has family packages to [destinations], starting from [package price] per person. Each one is planned for travelling with children:\n\nHotels with family rooms and space to rest.\n\nSightseeing that does not mean ten hours in a car.\n\nA local contact you can call any time during the trip.\n\nSee the summer packages here: [link]\n\nTell us your dates and how many people are travelling, and we will send a plan with a clear price, including what is and is not covered.\n\nHere is to a relaxed summer,\n{{business}}',
      },
      whatsapp: {
        name: 'travel_summer_packages', category: 'MARKETING',
        body: 'Hi {{1}} ☀️ Planning the kids’ summer holiday?\n\nOur family packages to {{2}} start from {{3}} per person, with family rooms and easy-paced sightseeing.\n\nBook early before flights and hotels fill up. See packages: {{4}}\n\nReply with your dates and we will send a plan.',
        vars: [fn, { fill: 'Destinations', example: 'Manali, Ooty and Darjeeling' }, { fill: 'Starting price', example: '₹18,500' }, { fill: 'Packages link', example: 'example.in/summer' }],
        footer: STOP,
      },
      call: {
        goal: 'Book families for summer holiday packages',
        opening: 'Hello {{customer_name}}, main {{business_name}} se bol raha hoon. Summer vacation aa rahi hai, toh socha aapse family trip ke baare mein baat kar loon.',
        script: [
          'Is baar humare paas {{destinations}} ke family packages hain.',
          'Hotels family rooms wale hain aur sightseeing aaram se, bachchon ke hisaab se.',
          'Jaldi book karne se flights aur achhe hotels dono mil jaate hain.',
        ],
        questions: ['Bachchon ki chhuttiyan kab se hain?', 'Kitne log jaayenge?', 'Pahaad pasand hai ya beach?', 'Budget per person kitna socha hai?'],
        objections: [
          { said: 'Abhi bahut jaldi hai', reply: 'Samajh sakta hoon. Par May-June mein flights aur hotels mehnge ho jaate hain. Abhi sirf plan aur price le lijiye, decide baad mein kar lena.' },
          { said: 'Hum khud plan kar lete hain', reply: 'Zaroor. Agar chahein toh hum sirf hotel aur transport ka quote bhej dein, compare karne ke liye.' },
        ],
        closing: 'Shukriya {{customer_name}}. Packages ki details WhatsApp par bhej raha hoon.',
        outcomes: ['interested', 'send_packages', 'call_booked', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'destinations'],
      },
    },
    {
      id: 'travel-festive-long-weekend', name: 'Festive & long-weekend getaways', goal: 'Sell short trips for Diwali, Christmas and long weekends', when: '4–6 weeks before a long weekend or the Diwali/Christmas break',
      audience: { type: 'all' },
      email: {
        subject: 'A long weekend is coming, {{first_name}}',
        body: 'Hi {{first_name}},\n\nThe [holiday] long weekend is coming up, and it is the easiest time to take a break without using much leave.\n\n{{business}} has put together short getaways for exactly this: 2 to 4 nights, close enough that you do not spend the holiday travelling.\n\nThis time we have trips to [destinations], from [package price] per person, with stay, breakfast and local transfers included.\n\nWhy book now and not next week? Long weekends are when everyone travels. Good rooms at good prices go first, and we would rather you get them.\n\nSee the getaways here: [link]\n\nTravelling as a couple, with friends, or with family? Reply and tell us, and we will suggest the one that fits.\n\nHappy holidays,\n{{business}}',
      },
      whatsapp: {
        name: 'travel_long_weekend', category: 'MARKETING',
        body: 'Hi {{1}}, a long weekend is coming up! 🧳\n\nShort getaways to {{2}} with stay, breakfast and transfers, from {{3}} per person.\n\nRooms go fast on holiday weekends. See trips here: {{4}}\n\nReply with how many are travelling and we will suggest the best fit.',
        vars: [fn, { fill: 'Destinations', example: 'Udaipur, Coorg and Goa' }, { fill: 'Starting price', example: '₹9,999' }, { fill: 'Trips link', example: 'example.in/weekend' }],
        footer: STOP,
      },
      call: {
        goal: 'Book a short getaway for the upcoming holiday',
        opening: 'Hi {{customer_name}}, I am calling from {{business_name}}. With the {{holiday_name}} long weekend coming, I wanted to tell you about our short getaways.',
        script: [
          'These are 2 to 4 night trips, close by, so you do not waste the holiday on the road.',
          'Stay, breakfast and local transfers are included.',
          'Rooms book out fast on long weekends, so I can hold options for you once you share details.',
        ],
        questions: ['Are you planning to travel this long weekend?', 'Who would be travelling with you?', 'Do you prefer hills, beach or a heritage city?'],
        objections: [
          { said: 'Prices are higher on long weekends', reply: 'You are right, they are. That is why booking now helps, before the remaining rooms get even costlier.' },
          { said: 'I will decide at the last minute', reply: 'Sure. I will send you the options on WhatsApp so you have them ready. Just know that the better rooms do go first.' },
        ],
        closing: 'Thank you {{customer_name}}, I am sending the options on WhatsApp now.',
        outcomes: ['interested', 'booked', 'send_options', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'holiday_name'],
      },
    },
    {
      id: 'travel-quote-followup', name: 'Itinerary quote follow-up', goal: 'Convert sent quotes into confirmed bookings', when: '2–3 days after sending an itinerary and quote',
      audience: { type: 'leads', tags: ['quote-sent'] },
      email: {
        subject: 'Any questions on your [destination] plan?',
        body: 'Hi {{first_name}},\n\nA few days ago we sent you the itinerary for your [destination] trip. I wanted to check if you had a chance to look at it.\n\nMost people have at least one question at this stage, and that is completely normal. Common ones are:\n\nCan we change the hotel to something closer, or more budget friendly?\n\nCan we add a night or drop one place?\n\nWhat exactly happens if our plans change?\n\nWe can change almost anything in the plan. Just reply and tell us what you would like different.\n\nIf the plan looks good, you can confirm it with a booking amount of [advance amount] here: [link]\n\nHotel prices for your dates can change, so the sooner we confirm, the more likely we hold the price we quoted.\n\nHappy to help either way,\n{{business}}',
      },
      whatsapp: {
        name: 'travel_quote_followup', category: 'MARKETING',
        body: 'Hi {{1}}, did you get a chance to look at your {{2}} itinerary?\n\nWe can change hotels, nights or places, just tell us what you would like different.\n\nIf it looks good, you can confirm here: {{3}}\n\nHotel rates for your dates can change, so do let us know soon.',
        vars: [fn, { fill: 'Destination', example: 'Kerala' }, { fill: 'Booking link', example: 'example.in/confirm' }],
        footer: STOP,
      },
      call: {
        goal: 'Answer questions on the quote and get the booking confirmed',
        opening: 'Namaste {{customer_name}}, main {{business_name}} se bol rahi hoon. Humne aapko {{destination}} ka itinerary bheja tha, bas poochna tha ki aapne dekha?',
        script: [
          'Hum plan mein lagbhag sab kuch badal sakte hain, hotel, raatein ya jagah.',
          'Agar plan theek hai, toh booking amount dekar confirm kar sakte hain.',
          'Hotel ke rates dates ke paas badal sakte hain, isliye jaldi confirm karna better hai.',
        ],
        questions: ['Plan mein kuch badalna chahenge?', 'Price aapke budget mein hai?', 'Kya hum booking confirm kar dein?'],
        objections: [
          { said: 'Price zyada lag raha hai', reply: 'Samajh sakti hoon. Hum hotel category badal kar ya ek raat kam karke price kam kar sakte hain. Kya aisa option bhejoon?' },
          { said: 'Family se baat karni hai', reply: 'Zaroor. Kab tak baat ho jaayegi? Main us din call kar lungi, aur tab tak koi sawaal ho toh WhatsApp kar dijiye.' },
          { said: 'Plans change ho gaye toh?', reply: 'Achha sawaal hai. Cancellation aur date change ki policy main aapko likhit mein bhej deti hoon, taaki sab saaf rahe.' },
        ],
        closing: 'Thank you {{customer_name}}. Main updated details WhatsApp par bhej rahi hoon.',
        outcomes: ['booked', 'revise_quote', 'callback', 'thinking', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'destination'],
      },
    },
    {
      id: 'travel-booking-confirm', name: 'Booking confirmation', goal: 'Confirm the booking and share next steps', when: 'Right after the booking amount is received',
      audience: { type: 'customers', tags: ['booked'] },
      email: {
        subject: 'Your [destination] trip is confirmed',
        body: 'Hi {{first_name}},\n\nThank you for booking with {{business}}. Your trip to [destination] is confirmed for [travel dates].\n\nHere is what happens next:\n\nWithin 48 hours, you will receive hotel confirmations and your final day-by-day itinerary.\n\nThe balance amount is due before departure, as per the payment schedule in your booking.\n\nAbout a week before you leave, we will send a packing checklist and the contact number of your local driver or guide.\n\nYour booking details and documents are here: [link]\n\nPlease check that the traveller names match your ID cards exactly. Airlines and hotels can refuse a booking if the name does not match. If anything needs correcting, reply to this email.\n\nIf you have any question at all before the trip, we are a message away.\n\nHappy travels,\n{{business}}',
      },
      whatsapp: {
        name: 'travel_booking_confirm', category: 'UTILITY',
        body: 'Hi {{1}}, your trip to {{2}} is confirmed for {{3}}.\n\nYou will receive hotel confirmations and the final itinerary within 48 hours. Please check that traveller names match your ID cards and reply here if anything needs correcting.\n\nBooking details: {{4}}\n\nThank you for booking with us.',
        vars: [fn, { fill: 'Destination', example: 'Andaman' }, { fill: 'Travel dates', example: '12–17 Dec' }, { fill: 'Booking link', example: 'example.in/b/2231' }],
      },
      call: {
        goal: 'Confirm the booking details and traveller names',
        opening: 'Namaste {{customer_name}}, main {{business_name}} se bol raha hoon. Aapki {{destination}} trip confirm ho gayi hai, bas kuch details verify karni thi.',
        script: [
          'Aapki travel dates {{travel_dates}} hain.',
          '48 ghante mein hotel confirmation aur final itinerary aapko mil jaayega.',
          'Bas traveller names ID card ke hisaab se ek baar confirm kar lete hain.',
        ],
        questions: ['Kya sabhi travellers ke naam ID card ke hisaab se sahi hain?', 'Koi special request hai, jaise diet ya room preference?', 'Pickup kis time aur kahan se chahiye?'],
        objections: [
          { said: 'Dates change karni hain', reply: 'Main abhi check karke batata hoon kya possible hai aur kya charge lagega. Sab likhit mein bhejunga.' },
          { said: 'Balance payment kab karna hai?', reply: 'Payment schedule aapke booking document mein hai. Main abhi WhatsApp par bhi bhej deta hoon.' },
        ],
        closing: 'Shukriya {{customer_name}}. Aapki trip ki saari details WhatsApp par aa jaayengi. Happy journey!',
        outcomes: ['details_confirmed', 'change_requested', 'callback', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'destination', 'travel_dates'],
      },
    },
    {
      id: 'travel-pre-trip-checklist', name: 'Pre-trip checklist', goal: 'Prepare travellers so the trip goes smoothly', when: '5–7 days before departure',
      audience: { type: 'customers', tags: ['booked'] },
      email: {
        subject: 'Your [destination] trip checklist, {{first_name}}',
        body: 'Hi {{first_name}},\n\nYour trip to [destination] is just a few days away. Here is a short checklist so nothing is missed.\n\nDocuments: original ID for every traveller (Aadhaar, passport or driving licence), flight or train tickets, and our booking voucher. Keep photos on your phone too.\n\nMoney: some cash for small shops and tips, plus UPI or a card. Network can be weak in hill areas.\n\nClothes: check the weather a day before. Carry a light jacket even in summer if you are going to the hills.\n\nMedicines: your regular ones, plus something for travel sickness, especially with kids.\n\nYour driver or guide will be [guide name and number]. They will contact you a day before.\n\nFinal itinerary and vouchers: [link]\n\nWe are reachable throughout your trip on this number.\n\nHave a wonderful journey,\n{{business}}',
      },
      whatsapp: {
        name: 'travel_trip_checklist', category: 'UTILITY',
        body: 'Hi {{1}}, your trip to {{2}} is just a few days away!\n\nQuick checklist:\n• Original ID for every traveller\n• Tickets and our booking voucher\n• Some cash, plus UPI or card\n• Regular medicines\n\nYour driver or guide will be {{3}} and will call you a day before.\n\nWe are reachable here throughout your trip.',
        vars: [fn, { fill: 'Destination', example: 'Sikkim' }, { fill: 'Guide name and number', example: 'Pemba, 98xxxxxx21' }],
      },
      call: {
        goal: 'Make sure the traveller is ready and answer last questions',
        opening: 'Hello {{customer_name}}, main {{business_name}} se bol rahi hoon. Aapki {{destination}} trip kuch hi din mein hai, toh ek chhota sa checklist share karna tha.',
        script: [
          'Har traveller ka original ID card saath rakhiye, aur tickets aur voucher bhi.',
          'Thoda cash rakhiye, pahaadon mein network kabhi kabhi kamzor hota hai.',
          'Aapka driver ya guide aapko trip se ek din pehle call karega.',
        ],
        questions: ['Kya aapko final itinerary aur vouchers mil gaye?', 'Aapki arrival time kya hai, taaki pickup set kar sakein?', 'Koi aakhri sawaal hai trip ke baare mein?'],
        objections: [
          { said: 'Voucher abhi tak nahi mila', reply: 'Maafi chahti hoon. Main abhi WhatsApp par dobara bhej deti hoon aur confirm karti hoon.' },
          { said: 'Mausam kharab hua toh?', reply: 'Achha sawaal hai. Aisi situation mein hum local team ke saath plan adjust karte hain, aur aapko pehle se batayenge.' },
        ],
        closing: 'Thank you {{customer_name}}. Aapki yatra mangalmay ho!',
        outcomes: ['ready_to_travel', 'needs_documents', 'pickup_updated', 'callback', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'destination'],
      },
    },
    {
      id: 'travel-post-trip-referral', name: 'Post-trip review & referral', goal: 'Get reviews and referrals from happy travellers', when: '3–5 days after the traveller returns',
      audience: { type: 'customers', tags: ['travelled'] },
      email: {
        subject: 'Welcome back, {{first_name}}! How was [destination]?',
        body: 'Hi {{first_name}},\n\nWelcome back from [destination]. We hope the trip gave you some good memories and a proper break.\n\nWe would really like to hear how it went. The good parts, and anything that could have been better. Every bit of feedback goes straight to the team that planned your trip.\n\nIf you enjoyed it, a short review here would mean a lot to us: [review link]\n\nAnd one small request. Most of our travellers come to us because a friend or relative recommended us. If you know someone planning a holiday, please share our number with them. We will take the same care of them that we took of you.\n\nWhenever you are ready for the next trip, just reply to this email. We already know what you like.\n\nThank you for travelling with us,\n{{business}}',
      },
      whatsapp: {
        name: 'travel_post_trip', category: 'MARKETING',
        body: 'Hi {{1}}, welcome back from {{2}}! 🌄 We hope you had a lovely time.\n\nIf you enjoyed it, a short review would mean a lot to us: {{3}}\n\nKnow someone planning a holiday? Please share our number, we will take the same care of them.',
        vars: [fn, { fill: 'Destination', example: 'Rajasthan' }, { fill: 'Review link', example: 'g.page/example/review' }],
        footer: STOP,
      },
      call: {
        goal: 'Collect trip feedback, a review and referrals',
        opening: 'Namaste {{customer_name}}, main {{business_name}} se bol raha hoon. Aap {{destination}} se wapas aa gaye, umeed hai trip achhi rahi?',
        script: [
          'Hum har traveller se feedback lete hain taaki agli trips aur behtar bana sakein.',
          'Agar aapko trip pasand aayi, toh ek chhota review humare liye bahut madadgaar hoga.',
          'Aur agar koi dost ya rishtedaar holiday plan kar raha ho, toh humara number share kar dijiye.',
        ],
        questions: ['Trip ka sabse achha part kya laga?', 'Kuch aisa tha jo behtar ho sakta tha?', 'Kya koi jaanne wala trip plan kar raha hai?'],
        objections: [
          { said: 'Hotel achha nahi tha', reply: 'Batane ke liye shukriya, yeh humare liye zaroori hai. Main yeh team aur hotel dono ko bataunga, aur aage se dhyan rakhenge.' },
          { said: 'Review likhne ka time nahi', reply: 'Koi baat nahi. Link WhatsApp par bhej deta hoon, ek line bhi kaafi hai.' },
        ],
        closing: 'Bahut shukriya {{customer_name}}. Agli trip ke liye hum yahin hain.',
        outcomes: ['happy_will_review', 'referral_given', 'complaint', 'next_trip_interest', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'destination'],
      },
    },
  ],

  // ───────────────────────── Hotels, homestays & restaurants ─────────────────────────
  hospitality: [
    {
      id: 'hotel-weekend-offer', name: 'Weekend getaway offer', goal: 'Fill rooms on upcoming weekends', when: 'Monday or Tuesday before a slow weekend',
      audience: { type: 'all' },
      email: {
        subject: 'A quiet weekend away, {{first_name}}?',
        body: 'Hi {{first_name}},\n\nIf the week has been long, here is a simple idea: spend this weekend with us at {{business}}.\n\nOur weekend stay package includes:\n\nYour room for [nights], with breakfast for two.\n\nLate checkout on Sunday, subject to availability, so you are not rushing.\n\n[special inclusion], our small extra for weekend guests.\n\nAll this for [package price] for two, taxes included.\n\nWeekends are when our rooms go first, so if you are thinking about it, it is better to book a little early.\n\nBook your stay here: [link]\n\nOr just reply to this email or call us, and we will hold a room for you. Tell us if it is a special occasion, or if you need an extra bed for a child, and we will have it ready when you arrive.\n\nWe would love to host you,\n{{business}}',
      },
      whatsapp: {
        name: 'hotel_weekend_offer', category: 'MARKETING',
        body: 'Hi {{1}}, need a weekend break? 🌿\n\nStay with us this weekend: room with breakfast for two and late checkout on Sunday, for {{2}} including taxes.\n\nWeekend rooms go first. Book here: {{3}}\n\nOr just reply and we will hold a room for you.',
        vars: [fn, { fill: 'Package price', example: '₹6,999' }, { fill: 'Booking link', example: 'example.in/book' }],
        footer: STOP,
      },
      call: {
        goal: 'Book a weekend stay',
        opening: 'Namaste {{customer_name}}, main {{business_name}} se bol rahi hoon. Aap pehle humare yahan aa chuke hain, isliye is weekend ke special stay package ke baare mein batana tha.',
        script: [
          'Package mein room, do logon ka breakfast aur Sunday ko late checkout hai.',
          'Iski price {{package_price}} hai, taxes ke saath.',
          'Weekend par rooms jaldi bhar jaate hain, aap chahein toh main abhi ek room hold kar sakti hoon.',
        ],
        questions: ['Kya aap is weekend free hain?', 'Kitne log aayenge?', 'Kya main aapke liye room hold kar doon?'],
        objections: [
          { said: 'Is weekend nahi ho paayega', reply: 'Koi baat nahi. Agle weekend ke liye bhi yeh package hai. Kya main details WhatsApp par bhej doon?' },
          { said: 'Thoda mehnga hai', reply: 'Samajh sakti hoon. Isme breakfast aur late checkout shaamil hain. Weekday par aayenge toh rate aur kam hai, woh bhi bata sakti hoon.' },
        ],
        closing: 'Dhanyavaad {{customer_name}}! Details WhatsApp par bhej rahi hoon. Aapka intezaar rahega.',
        outcomes: ['booked', 'room_held', 'send_details', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'package_price'],
      },
    },
    {
      id: 'hotel-reservation-confirm', name: 'Reservation confirmation', goal: 'Confirm the booking and reduce no-shows', when: 'Right after a room or table is booked',
      audience: { type: 'customers', tags: ['booked'] },
      email: {
        subject: 'Your reservation at {{business}} is confirmed',
        body: 'Hi {{first_name}},\n\nThank you for choosing {{business}}. Your reservation is confirmed.\n\nDate: [date and time]\n\nGuests: [number of guests]\n\nBooking reference: [booking reference]\n\nA few things that make your visit easier:\n\nCheck-in for rooms is from the time mentioned in your booking. Please carry a valid photo ID for every adult.\n\nFor table reservations, we hold your table for 15 minutes after the booking time. If you are running late, just call us.\n\nIf you are celebrating something, a birthday or an anniversary, tell us when you reply. We like to make it a little special.\n\nNeed to change or cancel? Simply reply to this email or call us. Letting us know early helps us offer the slot to another guest who is waiting.\n\nSee you soon,\n{{business}}',
      },
      whatsapp: {
        name: 'hotel_reservation_confirm', category: 'UTILITY',
        body: 'Hi {{1}}, your reservation is confirmed ✅\n\nDate and time: {{2}}\nGuests: {{3}}\n\nPlease carry a valid photo ID for room bookings. Tables are held for 15 minutes after the booking time.\n\nTo change or cancel, just reply here.',
        vars: [fn, { fill: 'Date and time', example: 'Sat 14 Dec, 8:00 pm' }, { fill: 'Number of guests', example: '4' }],
      },
      call: {
        goal: 'Confirm the reservation and capture special requests',
        opening: 'Hello {{customer_name}}, main {{business_name}} se bol raha hoon. Aapki reservation {{booking_date}} ke liye confirm karne ke liye call kiya hai.',
        script: [
          'Aapki booking {{guests}} logon ke liye hai.',
          'Room booking ke liye sabhi adults ka photo ID saath laaiyega.',
          'Agar koi khaas mauka hai, jaise birthday ya anniversary, toh bata dijiye.',
        ],
        questions: ['Kya date aur time sahi hai?', 'Kitne log aayenge?', 'Koi khaas mauka ya request hai?'],
        objections: [
          { said: 'Plan cancel karna hai', reply: 'Koi baat nahi. Kya main kisi aur date par shift kar doon? Nahi toh main cancel kar deta hoon.' },
          { said: 'Thoda late ho sakte hain', reply: 'Bilkul theek hai. Aane se pehle ek call kar dijiye, hum aapki booking hold rakhenge.' },
        ],
        closing: 'Shukriya {{customer_name}}. Hum aapka intezaar karenge!',
        outcomes: ['confirmed', 'rescheduled', 'cancelled', 'special_request', 'callback', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'booking_date', 'guests'],
      },
    },
    {
      id: 'hotel-festive-dining', name: 'Festive dinner / special menu', goal: 'Fill tables for a festive or special-occasion menu', when: '1–2 weeks before Diwali, Eid, Christmas, New Year or Valentine’s Day',
      audience: { type: 'all' },
      email: {
        subject: 'Our [festival] special menu is here',
        body: 'Hi {{first_name}},\n\nFestivals are best celebrated around a table, with the people you love. This [festival], let {{business}} do the cooking.\n\nOur chef has prepared a special menu just for the season: [menu highlights].\n\nIt is available through the festive week, for [price per person].\n\nWhy reserve early? Festive evenings are our busiest nights. Walk-ins often have to wait, and the best tables go to those who book ahead.\n\nReserve your table here: [link]\n\nPlanning something bigger, a family get-together or an office dinner? Reply to this email and we will help with a group menu and seating. Tell us about any Jain, vegan or no-onion-garlic needs when you book, and the kitchen will plan for it.\n\nWishing you a happy and delicious festival,\n{{business}}',
      },
      whatsapp: {
        name: 'hotel_festive_menu', category: 'MARKETING',
        body: 'Hi {{1}} 🎉 Celebrate {{2}} with us!\n\nOur chef’s festive menu is on, for {{3}} per person.\n\nFestive evenings fill up fast. Reserve your table here: {{4}}\n\nPlanning a family or office dinner? Reply and we will set up a group menu.',
        vars: [fn, { fill: 'Festival', example: 'Diwali' }, { fill: 'Price per person', example: '₹1,499' }, { fill: 'Reservation link', example: 'example.in/reserve' }],
        footer: STOP,
      },
      call: {
        goal: 'Book tables for the festive menu',
        opening: 'Hi {{customer_name}}, I am calling from {{business_name}}. You have dined with us before, so I wanted to invite you for our {{festival}} special menu.',
        script: [
          'Our chef has made a special menu just for the festive season.',
          'Festive evenings are our busiest, so tables are best booked in advance.',
          'We also do group menus for family get-togethers and office dinners.',
        ],
        questions: ['Would you like to celebrate with us this festival?', 'Which date and how many people?', 'Any dietary needs, like Jain or vegan food?'],
        objections: [
          { said: 'We celebrate at home', reply: 'That is lovely. We also take takeaway orders from the festive menu, would you like me to share it?' },
          { said: 'It sounds expensive', reply: 'I understand. The menu is a full meal, and for groups we can suggest options that fit your budget.' },
        ],
        closing: 'Thank you {{customer_name}}. I will send the menu and booking details on WhatsApp.',
        outcomes: ['table_booked', 'group_enquiry', 'send_menu', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'festival'],
      },
    },
    {
      id: 'hotel-repeat-visit', name: 'Repeat visit invite', goal: 'Bring past guests back for another visit', when: '30–60 days after a guest’s last stay or meal',
      audience: { type: 'customers' },
      email: {
        subject: 'Come back soon, {{first_name}}',
        body: 'Hi {{first_name}},\n\nIt has been a few weeks since you were with us at {{business}}, and we hope you remember the visit as fondly as we do.\n\nWe would love to welcome you back.\n\nAs a returning guest, you get [returning guest offer] on your next visit. Just mention code [code] when you book, or show this email when you arrive.\n\nSince your last visit, we have [what is new], so there is something new to try.\n\nBook your next visit here: [link]\n\nIf there was anything we could have done better last time, please reply and tell us. We read every message and it genuinely helps. Our regular guests are the reason we are still here, and we never take that for granted.\n\nUntil next time,\n{{business}}',
      },
      whatsapp: {
        name: 'hotel_repeat_visit', category: 'MARKETING',
        body: 'Hi {{1}}, we loved having you with us and hope to see you again! 😊\n\nAs a returning guest, you get {{2}} on your next visit. Just mention code {{3}} when you book.\n\nBook here: {{4}}\n\nSee you soon!',
        vars: [fn, { fill: 'Returning guest offer', example: '15% off' }, { fill: 'Code', example: 'WELCOMEBACK' }, { fill: 'Booking link', example: 'example.in/book' }],
        footer: STOP,
      },
      call: {
        goal: 'Invite a past guest back with a returning-guest offer',
        opening: 'Namaste {{customer_name}}, main {{business_name}} se bol rahi hoon. Aap kuch hafte pehle humare yahan aaye the, umeed hai aapko achha laga.',
        script: [
          'Humare returning guests ke liye ek chhota sa offer hai, {{offer}}.',
          'Is beech kuch naya bhi add hua hai, aap aayenge toh zaroor try kijiye.',
          'Main details WhatsApp par bhej deti hoon.',
        ],
        questions: ['Pichli visit kaisi rahi?', 'Kya kuch behtar ho sakta tha?', 'Agli baar kab aane ka plan hai?'],
        objections: [
          { said: 'Abhi koi plan nahi hai', reply: 'Koi baat nahi. Offer kuch hafton tak valid hai, details bhej deti hoon jab mann ho.' },
          { said: 'Pichli baar service slow thi', reply: 'Maafi chahti hoon aur batane ke liye shukriya. Main yeh manager tak pahunchaungi. Ek baar aur mauka dijiye.' },
        ],
        closing: 'Thank you {{customer_name}}! Aapka intezaar rahega.',
        outcomes: ['booked', 'interested', 'send_offer', 'complaint', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'offer'],
      },
    },
    {
      id: 'hotel-celebration-packages', name: 'Birthday & anniversary packages', goal: 'Book celebrations for birthdays and anniversaries', when: '2–3 weeks before a guest’s birthday or anniversary',
      audience: { type: 'customers', tags: ['has-date'] },
      email: {
        subject: 'Let us host your special day, {{first_name}}',
        body: 'Hi {{first_name}},\n\nA special day is coming up, and we would love to be part of it.\n\nAt {{business}}, we put together small celebrations that feel personal, without you having to plan every detail.\n\nOur celebration package includes [package inclusions], for [package price].\n\nYou tell us what the day means to you, and we take care of the decor, the cake and the little surprises. You just show up and enjoy.\n\nCelebrations need a bit of preparation on our side, so we suggest booking at least [days] in advance.\n\nSee the package and book here: [link]\n\nOr reply to this email with your date and number of guests, and we will call you to plan it together.\n\nWith warm wishes,\n{{business}}',
      },
      whatsapp: {
        name: 'hotel_celebration_package', category: 'MARKETING',
        body: 'Hi {{1}} 🎂 Have a birthday or anniversary coming up?\n\nLet us host it! Our celebration package includes decor, a cake and a few surprises, for {{2}}.\n\nSee details and book: {{3}}\n\nOr reply with your date and we will call you to plan it.',
        vars: [fn, { fill: 'Package price', example: '₹4,999' }, { fill: 'Booking link', example: 'example.in/celebrate' }],
        footer: STOP,
      },
      call: {
        goal: 'Plan and book a birthday or anniversary celebration',
        opening: 'Hello {{customer_name}}, main {{business_name}} se bol raha hoon. Humein laga aapka koi khaas din aane wala hai, toh socha celebration ke liye baat kar loon.',
        script: [
          'Humare celebration package mein decor, cake aur kuch chhote surprises hote hain.',
          'Aap bas bata dijiye kya pasand hai, baaki sab hum sambhal lenge.',
          'Thodi tayyari lagti hai, isliye kuch din pehle booking achhi rehti hai.',
        ],
        questions: ['Kiska special din hai, aur kab?', 'Kitne log honge?', 'Koi theme ya pasand ho toh bataiye?'],
        objections: [
          { said: 'Hum ghar par hi manayenge', reply: 'Bahut achha. Agar chahein toh hum cake aur khaana ghar par bhi bhej sakte hain.' },
          { said: 'Budget kam hai', reply: 'Koi baat nahi. Bataiye budget kitna hai, hum usi mein ek simple aur pyara setup bana denge.' },
        ],
        closing: 'Shukriya {{customer_name}}. Main package details WhatsApp par bhej raha hoon.',
        outcomes: ['booked', 'interested', 'send_details', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name'],
      },
    },
    {
      id: 'hotel-review-request', name: 'Post-stay review request', goal: 'Get Google and travel-site reviews from happy guests', when: '1–2 days after checkout or a dine-in visit',
      audience: { type: 'customers' },
      email: {
        subject: 'Thank you for visiting {{business}}, {{first_name}}',
        body: 'Hi {{first_name}},\n\nThank you for spending time with us at {{business}}. We hope you left happy.\n\nCould we ask you a small favour? If you enjoyed your visit, please leave us a short review here: [review link]\n\nFor a place like ours, reviews matter more than any ad. They are how new guests decide whether to trust us. Even one honest line helps.\n\nIf anything was not up to the mark, we would much rather hear it from you directly. Just reply to this email and our manager will personally look into it.\n\nIt takes less than a minute. Mention the dish you liked or the room you stayed in, and it will help the next guest choose.\n\nWe hope to welcome you again soon.\n\nWith thanks,\n{{business}}',
      },
      whatsapp: {
        name: 'hotel_review_request', category: 'MARKETING',
        body: 'Hi {{1}}, thank you for visiting us! We hope you had a lovely time 🙏\n\nIf you enjoyed it, a short review would mean a lot: {{2}}\n\nIf anything was not right, please reply here and our manager will look into it personally.',
        vars: [fn, { fill: 'Review link', example: 'g.page/example/review' }],
        footer: STOP,
      },
      call: {
        goal: 'Take feedback and ask happy guests for a review',
        opening: 'Namaste {{customer_name}}, main {{business_name}} se bol rahi hoon. Aap haal hi mein humare yahan aaye the, bas aapka feedback lena tha.',
        script: [
          'Aapka experience humare liye bahut maayne rakhta hai.',
          'Agar aapko achha laga ho, toh Google par ek chhota review bahut madad karega.',
          'Main link WhatsApp par bhej deti hoon.',
        ],
        questions: ['Aapka experience kaisa raha, 1 se 5 mein?', 'Sabse achha kya laga?', 'Kya kuch behtar ho sakta tha?'],
        objections: [
          { said: 'Room saaf nahi tha', reply: 'Mujhe sach mein afsos hai. Main yeh abhi manager ko bata rahi hoon, aur woh aapse khud baat karenge.' },
          { said: 'Review likhna nahi aata', reply: 'Koi baat nahi, bas stars de dijiye aur ek line, jaise khaana achha tha. Link bhej deti hoon.' },
        ],
        closing: 'Bahut shukriya {{customer_name}}. Phir milenge!',
        outcomes: ['happy_will_review', 'send_link', 'complaint', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name'],
      },
    },
    {
      id: 'hotel-monsoon-offer', name: 'Off-season / monsoon offer', goal: 'Fill rooms and tables in the slow season', when: 'Start of the monsoon or off-season months',
      audience: { type: 'all' },
      email: {
        subject: 'Monsoon at {{business}}, {{first_name}}',
        body: 'Hi {{first_name}},\n\nThe monsoon changes everything here. The air is cooler, everything turns green, and it is far quieter than peak season.\n\nIt is honestly one of our favourite times of the year, and we would love for you to see it.\n\nOur monsoon offer: [offer details], valid from [dates].\n\nWhat a monsoon stay with us looks like:\n\nHot chai and pakode while it pours outside.\n\nNo crowds, no rush, plenty of rest.\n\nRates lower than peak season, for the same rooms and service.\n\nSee the offer and book here: [link]\n\nIf you are worried about travelling in the rain, reply and ask us about road conditions. We will always tell you honestly, and if the weather turns bad close to your dates, we will help you shift them.\n\nWarmly,\n{{business}}',
      },
      whatsapp: {
        name: 'hotel_monsoon_offer', category: 'MARKETING',
        body: 'Hi {{1}} 🌧️ Monsoon is a beautiful time to visit us: green views, cool air and no crowds.\n\nOur monsoon offer: {{2}}\n\nSee details and book: {{3}}\n\nWorried about the roads? Reply and we will tell you honestly how it is.',
        vars: [fn, { fill: 'Offer details', example: '3 nights for the price of 2' }, { fill: 'Booking link', example: 'example.in/monsoon' }],
        footer: STOP,
      },
      call: {
        goal: 'Book stays or meals during the off-season',
        opening: 'Hello {{customer_name}}, main {{business_name}} se bol raha hoon. Monsoon aa gaya hai, aur is mausam ke liye humare paas ek khaas offer hai.',
        script: [
          'Is time yahan sab hara-bhara hai aur bheed bilkul nahi hoti.',
          'Humara monsoon offer hai {{offer}}.',
          'Rates peak season se kam hain, rooms aur service wahi.',
        ],
        questions: ['Kya aap is monsoon kahin jaane ka soch rahe hain?', 'Kitne log aayenge?', 'Kaunsi dates aapke liye theek rahengi?'],
        objections: [
          { said: 'Baarish mein travel safe nahi', reply: 'Achha sawaal hai. Hum aapko jaane se pehle road condition ki sahi jaankari denge, aur zaroorat ho toh dates badal denge.' },
          { said: 'Baarish mein karne ko kuch nahi', reply: 'Asal mein yahi maza hai, aaram, chai aur nazara. Hum kuch indoor activities bhi rakhte hain.' },
        ],
        closing: 'Shukriya {{customer_name}}, offer ki details WhatsApp par bhej raha hoon.',
        outcomes: ['booked', 'interested', 'send_offer', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'offer'],
      },
    },
  ],

  // ───────────────────────── Staffing / recruitment agencies ─────────────────────────
  recruitment: [
    {
      id: 'hire-job-opening-alert', name: 'New job opening alert', goal: 'Get matching candidates to apply for a new role', when: 'As soon as a new position opens',
      audience: { type: 'leads', tags: ['candidate'] },
      email: {
        subject: 'New opening: [job title] in [location]',
        body: 'Hi {{first_name}},\n\nWe have a new opening that matches your profile, and we thought of you first.\n\nRole: [job title]\n\nLocation: [location]\n\nSalary range: [salary range]\n\nThe company is hiring now and wants to close the position quickly, so shortlisted candidates will be called for interviews within the next few days.\n\nIf you are interested, simply reply to this email with your updated CV, your current salary, expected salary and notice period.\n\nOr apply directly here: [link]\n\nEven if this role is not right for you, reply and tell us what you are looking for. We will keep you in mind for better-fit openings. We never share your CV with any company without asking you first.\n\nBest of luck,\n{{business}}',
      },
      whatsapp: {
        name: 'hire_job_opening', category: 'MARKETING',
        body: 'Hi {{1}}, we have a new opening that matches your profile 💼\n\nRole: {{2}}\nLocation: {{3}}\n\nInterested? Reply with your updated CV, current and expected salary, and notice period. Or apply here: {{4}}\n\nNot the right fit? Reply and tell us what you are looking for.',
        vars: [fn, { fill: 'Job title', example: 'Sales Executive' }, { fill: 'Location', example: 'Pune' }, { fill: 'Apply link', example: 'example.in/jobs/221' }],
        footer: STOP,
      },
      call: {
        goal: 'Check the candidate’s interest and screen them for the role',
        opening: 'Hello {{customer_name}}, main {{business_name}} se bol rahi hoon. Humare paas ek {{job_title}} ki opening hai jo aapke profile se match karti hai.',
        script: [
          'Job {{job_location}} mein hai, aur company jaldi hiring karna chahti hai.',
          'Main kuch basic sawaal poochungi, phir agar match hua toh aapka CV aage bhejenge.',
          'Shortlist hone par interview kuch hi dinon mein hoga.',
        ],
        questions: ['Kya aap abhi job change karne ke liye open hain?', 'Aapki current aur expected salary kya hai?', 'Notice period kitna hai?', 'Kya aap {{job_location}} mein kaam kar sakte hain?'],
        objections: [
          { said: 'Main abhi khush hoon apni job mein', reply: 'Bahut achhi baat hai. Kya main aapka profile future ke liye rakh loon? Achhi opening aayegi toh pehle aapko bataungi.' },
          { said: 'Salary kam hai', reply: 'Samajh sakti hoon. Aapki expected salary bata dijiye, main client se baat karke dekhti hoon kitna flexible hain.' },
          { said: 'Location door hai', reply: 'Theek hai. Aap kis area mein kaam karna chahenge? Main wahan ki openings aapko bhejungi.' },
        ],
        closing: 'Thank you {{customer_name}}. Apna updated CV WhatsApp par bhej dijiye, main aage process karti hoon.',
        outcomes: ['interested', 'send_cv', 'not_looking', 'salary_mismatch', 'callback', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'job_title', 'job_location'],
      },
    },
    {
      id: 'hire-interview-confirm', name: 'Interview schedule confirmation', goal: 'Confirm interview slots and cut no-shows', when: 'Once an interview is scheduled, and again a day before',
      audience: { type: 'leads', tags: ['interview-scheduled'] },
      email: {
        subject: 'Your interview for [job title] is scheduled',
        body: 'Hi {{first_name}},\n\nGood news. You have been shortlisted, and your interview is scheduled.\n\nRole: [job title]\n\nDate and time: [interview date and time]\n\nVenue or link: [venue or meeting link]\n\nA few tips that genuinely help:\n\nKeep two copies of your CV and a photo ID ready.\n\nRead about the company and the role for 15 minutes before the interview.\n\nFor in-person interviews, reach 15 minutes early. For video calls, test your internet and camera beforehand.\n\nBe ready to talk about your current role, your achievements, and why you want to move.\n\nPlease reply to this email to confirm you will attend. If the time does not work, tell us and we will try to reschedule.\n\nAll the best,\n{{business}}',
      },
      whatsapp: {
        name: 'hire_interview_confirm', category: 'UTILITY',
        body: 'Hi {{1}}, your interview is scheduled.\n\nRole: {{2}}\nDate and time: {{3}}\nVenue or link: {{4}}\n\nPlease carry your CV and a photo ID. Reply YES to confirm you will attend, or reply if you need to reschedule.',
        vars: [fn, { fill: 'Job title', example: 'Accountant' }, { fill: 'Interview date and time', example: 'Tue 10 Dec, 11:00 am' }, { fill: 'Venue or meeting link', example: 'Andheri East office' }],
      },
      call: {
        goal: 'Confirm the candidate will attend the interview',
        opening: 'Namaste {{customer_name}}, main {{business_name}} se bol raha hoon. Aapka {{job_title}} ke liye interview schedule hua hai, use confirm karne ke liye call kiya hai.',
        script: [
          'Interview {{interview_time}} par hai.',
          'Apna CV aur photo ID saath rakhiye, aur 15 minute pehle pahunchiye.',
          'Video interview hai toh internet aur camera pehle check kar lijiye.',
        ],
        questions: ['Kya aap is time par interview de payenge?', 'Kya aapko venue ya link mil gaya hai?', 'Koi sawaal hai role ke baare mein?'],
        objections: [
          { said: 'Is time par office hai', reply: 'Samajh sakta hoon. Aap kaunsa time de sakte hain? Main company se reschedule ki baat karta hoon.' },
          { said: 'Mujhe dusra offer mil gaya', reply: 'Badhai ho! Kya aap bata sakte hain kitna offer hai? Ho sakta hai yeh company better kar sake, nahi toh hum aapko best of luck kahenge.' },
        ],
        closing: 'Thank you {{customer_name}}. Interview ke liye all the best!',
        outcomes: ['confirmed', 'reschedule', 'dropped_out', 'callback', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'job_title', 'interview_time'],
      },
    },
    {
      id: 'hire-joining-followup', name: 'Offer & joining follow-up', goal: 'Make sure selected candidates actually join', when: 'After the offer letter, and 3 days before the joining date',
      audience: { type: 'leads', tags: ['offered'] },
      email: {
        subject: 'Congratulations, {{first_name}}! Next steps before joining',
        body: 'Hi {{first_name}},\n\nCongratulations on your offer for [job title]. You worked hard for this, and we are really happy for you.\n\nYour joining date is [joining date]. Between now and then, here is what to keep ready:\n\nSigned offer letter, sent back to the company.\n\nResignation accepted and relieving letter from your current employer, if applicable.\n\nDocuments for joining: ID proof, address proof, educational certificates, last three salary slips and a passport-size photo.\n\nIf anything is holding you up, a notice period issue, a counter-offer, or a question about the role, please tell us early. We can often sort these out with the company if we know in time.\n\nJust reply to this email or call us any time.\n\nWishing you a great start,\n{{business}}',
      },
      whatsapp: {
        name: 'hire_joining_followup', category: 'UTILITY',
        body: 'Hi {{1}}, congratulations again on your offer! Your joining date is {{2}}.\n\nPlease keep ready: signed offer letter, relieving letter, ID and address proof, certificates, last 3 salary slips and a photo.\n\nAny issue with notice period or the offer? Reply here early so we can help.',
        vars: [fn, { fill: 'Joining date', example: '2 January' }],
      },
      call: {
        goal: 'Confirm the candidate is on track to join',
        opening: 'Hello {{customer_name}}, main {{business_name}} se bol rahi hoon. Aapke offer ke liye bahut badhai! Joining se pehle bas ek baar check karna tha.',
        script: [
          'Aapki joining date {{joining_date}} hai.',
          'Kya aapne apna resignation de diya hai aur notice period clear hai?',
          'Joining documents tayyar rakhiye, list main WhatsApp par bhej deti hoon.',
        ],
        questions: ['Kya aapne offer letter sign karke bhej diya?', 'Resignation accept ho gaya?', 'Kya joining date par koi problem hai?'],
        objections: [
          { said: 'Current company counter offer de rahi hai', reply: 'Yeh common hai. Ek baar socho ki aapne change kyun chaha tha. Agar koi baat hai toh batao, main nayi company se baat kar sakti hoon.' },
          { said: 'Notice period lamba hai', reply: 'Samajh gayi. Main company se baat karti hoon ki joining date thodi aage ho sake. Aap apne manager se buyout ka bhi pooch sakte hain.' },
        ],
        closing: 'Thank you {{customer_name}}. Nayi job ke liye all the best!',
        outcomes: ['joining_confirmed', 'date_change', 'counter_offer', 'dropped_out', 'callback', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'joining_date'],
      },
    },
    {
      id: 'hire-client-hiring-needs', name: 'Hiring needs check-in (clients)', goal: 'Win new hiring mandates from companies', when: 'Start of each quarter, or after a client’s last role closes',
      audience: { type: 'leads', tags: ['client'] },
      email: {
        subject: 'Hiring plans for this quarter, {{first_name}}?',
        body: 'Hi {{first_name}},\n\nA quick note from {{business}}. Many companies plan their hiring at the start of the quarter, so I wanted to check if you have any open roles coming up.\n\nWe help businesses like yours fill roles in [role types] without your team spending weeks on screening.\n\nHow we work:\n\nYou share the role and budget. We send only screened, interested candidates who fit the salary range.\n\nWe coordinate interviews and follow up until the candidate joins.\n\nOur fee is [fee terms], payable only after the candidate joins.\n\nIf you have even one open position right now, reply with the job description and we will share the first profiles within [turnaround time].\n\nOr pick a time for a short call here: [link]\n\nBest regards,\n{{business}}',
      },
      whatsapp: {
        name: 'hire_client_needs', category: 'MARKETING',
        body: 'Hi {{1}}, any open positions this quarter?\n\nWe help companies hire for {{2}} with screened candidates who fit your budget. You pay only after the candidate joins.\n\nShare a job description and we will send the first profiles quickly. Or book a call: {{3}}\n\nLooking forward to helping.',
        vars: [fn, { fill: 'Role types', example: 'sales, accounts and operations' }, { fill: 'Booking link', example: 'cal.example.in/hire' }],
        footer: STOP,
      },
      call: {
        goal: 'Find open roles at the client and get a job description',
        opening: 'Hello {{customer_name}}, I am calling from {{business_name}}. We are a recruitment agency, and I wanted to check if your company has any hiring planned this quarter.',
        script: [
          'We help companies fill roles with screened candidates who match the budget.',
          'We handle interview coordination and follow up until the candidate joins.',
          'Our fee is charged only after the candidate joins, so there is no risk to you.',
        ],
        questions: ['Do you have any open positions right now?', 'Which roles are hardest for you to fill?', 'How many people are you planning to hire this quarter?', 'Who handles hiring decisions on your side?'],
        objections: [
          { said: 'We hire on our own through job portals', reply: 'Many of our clients did too. We help when portals bring too many unsuitable CVs. Even one tough role is a good way to try us.' },
          { said: 'Your fee is too high', reply: 'I understand. Our fee is only on joining, and we replace the candidate if they leave early, as per our terms. Happy to discuss what works for you.' },
          { said: 'No hiring right now', reply: 'Thank you for telling me. May I check back next quarter, or whenever a role opens up?' },
        ],
        closing: 'Thank you {{customer_name}}. I will send our details on email and WhatsApp.',
        outcomes: ['mandate_received', 'meeting_booked', 'future_need', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name'],
      },
    },
    {
      id: 'hire-candidate-shortlist', name: 'Shortlist shared with client', goal: 'Get the client to review profiles and set interviews', when: 'When candidate profiles are sent to a client',
      audience: { type: 'customers', tags: ['client'] },
      email: {
        subject: 'Profiles for your [job title] opening',
        body: 'Hi {{first_name}},\n\nAs promised, here are the shortlisted candidates for your [job title] opening.\n\nEach candidate has been spoken to by our team. They are interested in the role, within your salary range, and available to join within the notice period you mentioned.\n\nView the profiles here: [link]\n\nFor each candidate we have noted their current salary, expected salary, notice period and why they want to move.\n\nTo keep good candidates interested, it helps to share feedback within two to three working days. Candidates who are actively looking often get other offers.\n\nJust reply with the names you would like to interview and a few time slots. We will coordinate everything with the candidates. If none of them fit, tell us what was missing and we will send a fresh set of profiles.\n\nThank you,\n{{business}}',
      },
      whatsapp: {
        name: 'hire_shortlist_shared', category: 'UTILITY',
        body: 'Hi {{1}}, the shortlisted profiles for your {{2}} opening are ready.\n\nView them here: {{3}}\n\nAll candidates are screened and within your salary range. Please reply with the names you would like to interview and a few time slots.',
        vars: [fn, { fill: 'Job title', example: 'Store Manager' }, { fill: 'Profiles link', example: 'example.in/shortlist/88' }],
      },
      call: {
        goal: 'Get feedback on the shortlist and fix interview slots',
        opening: 'Hello {{customer_name}}, I am calling from {{business_name}} about the profiles we shared for your {{job_title}} opening.',
        script: [
          'All candidates are screened, interested and within your budget.',
          'Good candidates get other offers quickly, so quick feedback helps us keep them interested.',
          'If you share time slots, we will arrange all the interviews.',
        ],
        questions: ['Did you get a chance to look at the profiles?', 'Which candidates would you like to meet?', 'Which days and times work for interviews?'],
        objections: [
          { said: 'None of them are suitable', reply: 'Thank you for telling me. Could you share what was missing? It will help me send better matches this week.' },
          { said: 'I have not had time to review', reply: 'Completely understand. Shall I call back tomorrow, or would a short summary of the top two candidates help?' },
        ],
        closing: 'Thank you {{customer_name}}. I will coordinate with the candidates and confirm the slots.',
        outcomes: ['interviews_scheduled', 'feedback_given', 'need_more_profiles', 'callback', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'job_title'],
      },
    },
    {
      id: 'hire-walkin-drive', name: 'Walk-in / campus hiring drive', goal: 'Get candidates to attend a walk-in or campus drive', when: '5–7 days before a walk-in or campus drive',
      audience: { type: 'leads', tags: ['candidate'] },
      email: {
        subject: 'Walk-in interviews on [drive date]',
        body: 'Hi {{first_name}},\n\nWe are holding walk-in interviews, and you are invited.\n\nRoles: [roles]\n\nDate and time: [drive date]\n\nVenue: [venue]\n\nWalk-ins are the quickest way to get hired. You meet the company directly, and many candidates leave with a decision on the same day.\n\nWhat to bring:\n\nTwo copies of your updated CV.\n\nA photo ID and copies of your educational certificates.\n\nYour last salary slip, if you are currently working.\n\nPlease reply to this email to register, so we can plan the day and reduce your waiting time. Freshers are welcome for some roles.\n\nIf you have a friend who is looking for a job, feel free to bring them along. Dress neatly, come with a positive attitude, and be ready to talk about yourself in a few simple lines.\n\nSee you there,\n{{business}}',
      },
      whatsapp: {
        name: 'hire_walkin_drive', category: 'MARKETING',
        body: 'Hi {{1}}, you are invited to our walk-in interviews! 📋\n\nRoles: {{2}}\nWhen: {{3}}\n\nBring 2 copies of your CV, a photo ID and certificates. Reply YES to register so we can cut your waiting time.\n\nFriends looking for a job are welcome too.',
        vars: [fn, { fill: 'Roles', example: 'Customer Support, Telesales' }, { fill: 'Date, time and venue', example: 'Sat 7 Dec, 10 am, Sector 18 Noida' }],
        footer: STOP,
      },
      call: {
        goal: 'Register candidates for the walk-in drive',
        opening: 'Namaste {{customer_name}}, main {{business_name}} se bol raha hoon. Humari walk-in interview drive {{drive_date}} ko hai, aur aapko invite karna tha.',
        script: [
          'Isme {{roles}} ke liye hiring ho rahi hai.',
          'Company seedha interview leti hai, kai logon ka decision usi din ho jaata hai.',
          'Apna CV, photo ID aur certificates saath laaiyega.',
        ],
        questions: ['Kya aap abhi job dhoondh rahe hain?', 'Kya aap {{drive_date}} ko aa payenge?', 'Aapki last qualification aur experience kya hai?'],
        objections: [
          { said: 'Venue door hai', reply: 'Samajh sakta hoon. Par ek din mein decision mil sakta hai, toh aana worth hai. Main exact location WhatsApp par bhej deta hoon.' },
          { said: 'Main fresher hoon', reply: 'Koi baat nahi, kuch roles freshers ke liye bhi hain. Aap zaroor aaiye.' },
        ],
        closing: 'Thank you {{customer_name}}. Venue details WhatsApp par bhej raha hoon. All the best!',
        outcomes: ['registered', 'interested', 'cannot_attend', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'drive_date', 'roles'],
      },
    },
    {
      id: 'hire-candidate-reengage', name: 'Re-engage past candidates', goal: 'Refresh old candidate profiles for current openings', when: 'Every 3–6 months for candidates not placed',
      audience: { type: 'leads', tags: ['candidate', 'inactive'] },
      email: {
        subject: 'Are you open to new opportunities, {{first_name}}?',
        body: 'Hi {{first_name}},\n\nIt has been a while since we last spoke about your career. A lot can change in a few months, so I wanted to check in.\n\nAre you currently looking for a change, or open to hearing about good roles?\n\nRight now we are hiring for roles in [role types] across [locations].\n\nIf you are interested, please reply with:\n\nYour updated CV.\n\nYour current role and salary.\n\nThe kind of role and salary you are looking for next.\n\nYour notice period.\n\nIt takes two minutes, and it means we can match you to the right opening as soon as it comes up, instead of after it is filled.\n\nIf you have already found a great job, congratulations, and just reply to let us know.\n\nBest wishes,\n{{business}}',
      },
      whatsapp: {
        name: 'hire_candidate_reengage', category: 'MARKETING',
        body: 'Hi {{1}}, are you open to new job opportunities?\n\nWe are hiring for {{2}} roles right now.\n\nIf interested, reply with your updated CV, current salary, expected salary and notice period. We will match you to the right opening.\n\nAlready settled in a new job? Just reply and let us know.',
        vars: [fn, { fill: 'Role types', example: 'sales and marketing' }],
        footer: STOP,
      },
      call: {
        goal: 'Update the candidate’s profile and interest',
        opening: 'Hello {{customer_name}}, main {{business_name}} se bol rahi hoon. Kuch mahine pehle humne aapke career ke baare mein baat ki thi, bas update lena tha.',
        script: [
          'Abhi humare paas kaafi nayi openings hain.',
          'Agar aap change ke liye open hain, toh main aapka profile update kar leti hoon.',
          'Sahi opening aate hi aapko sabse pehle call karungi.',
        ],
        questions: ['Kya aap abhi job change ke liye open hain?', 'Aapka current role aur salary kya hai?', 'Aap aage kis tarah ka role dhoondh rahe hain?'],
        objections: [
          { said: 'Mujhe job mil gayi', reply: 'Bahut badhai! Main aapka profile update kar deti hoon. Future mein kabhi zaroorat ho toh yaad kijiyega.' },
          { said: 'Pichli baar kuch nahi hua', reply: 'Samajh sakti hoon, aur maafi chahti hoon. Is baar aapki exact zaroorat note karke sirf sahi match hi bhejungi.' },
        ],
        closing: 'Thank you {{customer_name}}. Apna updated CV WhatsApp par bhej dijiye.',
        outcomes: ['open_to_change', 'send_cv', 'placed_elsewhere', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name'],
      },
    },
  ],

  // ───────────────────────── NGOs ─────────────────────────
  ngo: [
    {
      id: 'ngo-monthly-giving', name: 'Monthly giving appeal', goal: 'Turn one-time donors into monthly donors', when: '2–4 weeks after a first donation',
      audience: { type: 'customers', tags: ['donor'] },
      email: {
        subject: 'A small monthly gift, a lasting change',
        body: 'Hi {{first_name}},\n\nThank you again for supporting {{business}}. Your gift has already made a difference.\n\nToday I want to ask you something that matters a lot to our work: would you consider giving every month?\n\nHere is why monthly giving helps so much. The children, families and communities we work with need support all year, not only when donations come in. A steady monthly gift lets us plan ahead, keep programmes running, and say yes when someone needs help.\n\nEven [monthly amount] a month can [what the amount provides].\n\nYou can start, pause or stop any time, no questions asked. Your donation is [80G eligible], and you will get a receipt for every gift.\n\nStart your monthly gift here: [link]\n\nWith gratitude,\n{{business}}',
      },
      whatsapp: {
        name: 'ngo_monthly_giving', category: 'MARKETING',
        body: 'Hi {{1}}, thank you for supporting our work 🙏\n\nWould you consider giving every month? Just {{2}} a month can {{3}}, all year round.\n\nYou can pause or stop any time. Start here: {{4}}\n\nThank you for standing with us.',
        vars: [fn, { fill: 'Monthly amount', example: '₹500' }, { fill: 'What it provides', example: 'keep a child in school' }, { fill: 'Donation link', example: 'example.org/monthly' }],
        footer: STOP,
      },
      call: {
        goal: 'Invite a donor to become a monthly giver',
        opening: 'Namaste {{customer_name}}, main {{business_name}} se bol rahi hoon. Aapne humein haal hi mein daan diya tha, uske liye dil se shukriya kehna tha.',
        script: [
          'Aapki madad se humara kaam aage badh raha hai.',
          'Hum logon ko monthly giving ke baare mein bata rahe hain, kyunki isse hum saal bhar plan kar paate hain.',
          'Sirf {{monthly_amount}} mahine ka bhi bahut fark laata hai.',
          'Aap jab chahein ise pause ya band kar sakte hain.',
        ],
        questions: ['Kya aap humare kaam ke baare mein aur jaanna chahenge?', 'Kya monthly giving aapke liye sahi rahega?', 'Kitni raashi aapke liye aaraam se ho sakti hai?'],
        objections: [
          { said: 'Har mahine commit nahi kar sakta', reply: 'Bilkul samajh sakti hoon. Aap kam raashi se shuru kar sakte hain, aur kabhi bhi rok sakte hain.' },
          { said: 'Kaise pata paise sahi jagah jaa rahe hain?', reply: 'Yeh bahut sahi sawaal hai. Hum har donor ko regular impact update aur receipt bhejte hain. Main aapko humari pichli report bhi bhej deti hoon.' },
        ],
        closing: 'Bahut dhanyavaad {{customer_name}}. Main link WhatsApp par bhej rahi hoon. Aapka saath humare liye bahut keemti hai.',
        outcomes: ['monthly_donor', 'interested', 'send_link', 'one_time_only', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'monthly_amount'],
      },
    },
    {
      id: 'ngo-festival-giving', name: 'Festival giving (Daan Utsav / Diwali)', goal: 'Raise festival-season donations', when: 'Late September to Diwali (Daan Utsav, 2–8 October)',
      audience: { type: 'all' },
      email: {
        subject: 'This festive season, share the light',
        body: 'Hi {{first_name}},\n\nFestivals in India have always been about sharing. A plate of sweets for the neighbour, new clothes for someone who could not buy them, a diya for every home.\n\nThis festive season, {{business}} is inviting you to share with those who need it most.\n\nWe are raising funds for [cause]. Your gift of [suggested amount] can make this festival brighter for a family that has very little.\n\nEvery rupee goes towards the work, and you will get a receipt and an update on what your gift made possible. Donations are [80G eligible].\n\nGive here: [link]\n\nIf you cannot give right now, forwarding this to one friend helps just as much.\n\nWishing you and your family a joyful festival,\n{{business}}',
      },
      whatsapp: {
        name: 'ngo_festival_giving', category: 'MARKETING',
        body: 'Hi {{1}} 🪔 This festive season, share the joy with someone who needs it.\n\nWe are raising funds for {{2}}. Your gift can make this festival brighter for a family.\n\nGive here: {{3}}\n\nCannot give right now? Forwarding this to a friend helps too. Happy festivities!',
        vars: [fn, { fill: 'Cause', example: 'school kits for 500 children' }, { fill: 'Donation link', example: 'example.org/give' }],
        footer: STOP,
      },
      call: {
        goal: 'Raise a festival-season donation',
        opening: 'Namaste {{customer_name}}, main {{business_name}} se bol raha hoon. Tyohaar ke is mausam mein hum aapse ek chhoti si baat karna chahte the.',
        script: [
          'Is festival hum {{cause}} ke liye funds jutaa rahe hain.',
          'Tyohaar baantne ka hi naam hai, aur aapka chhota sa daan kisi parivaar ki khushi badha sakta hai.',
          'Har daan ki receipt aur update aapko milega.',
        ],
        questions: ['Kya aap is cause ke baare mein sunna chahenge?', 'Kya aap is tyohaar humare saath judna chahenge?', 'Kya main donation link WhatsApp par bhej doon?'],
        objections: [
          { said: 'Main pehle se kahin aur daan karta hoon', reply: 'Yeh toh bahut achhi baat hai. Hum sirf aapko yeh cause batana chahte the. Link bhej deta hoon, agar mann ho toh.' },
          { said: 'Abhi kharche zyada hain', reply: 'Bilkul samajh sakta hoon, tyohaar mein kharche hote hain. Aap sirf message aage share kar dein, woh bhi bahut madad hai.' },
        ],
        closing: 'Dhanyavaad {{customer_name}}. Aapko aur aapke parivaar ko tyohaar ki shubhkamnayein.',
        outcomes: ['donated', 'pledged', 'send_link', 'will_share', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'cause'],
      },
    },
    {
      id: 'ngo-donation-receipt', name: 'Donation thank-you & receipt', goal: 'Thank donors and deliver their receipt', when: 'Within 24 hours of a donation',
      audience: { type: 'customers', tags: ['donor'] },
      email: {
        subject: 'Thank you for your donation, {{first_name}}',
        body: 'Hi {{first_name}},\n\nThank you for your donation of [amount] to {{business}}. We received it, and we are truly grateful.\n\nYour receipt is ready here: [receipt link]\n\nPlease keep it for your records. Your donation is [80G eligible], and the receipt includes the details you need when filing your income tax return.\n\nPlease check that your name and PAN on the receipt are correct. If anything needs fixing, just reply to this email and we will send a corrected receipt.\n\nOver the coming months, we will send you short updates on the work your gift supports, so you can see where it went.\n\nIf you have any question about your donation, reply any time. A member of our team, not a machine, will get back to you.\n\nWith heartfelt thanks,\n{{business}}',
      },
      whatsapp: {
        name: 'ngo_donation_receipt', category: 'UTILITY',
        body: 'Hi {{1}}, thank you for your donation of {{2}}. We have received it 🙏\n\nYour receipt is here: {{3}}\n\nPlease check that your name and PAN are correct. If anything needs fixing, just reply here and we will send a corrected receipt.',
        vars: [fn, { fill: 'Donation amount', example: '₹2,000' }, { fill: 'Receipt link', example: 'example.org/r/5521' }],
      },
      call: {
        goal: 'Thank the donor and confirm receipt details',
        opening: 'Namaste {{customer_name}}, main {{business_name}} se bol rahi hoon. Aapke daan ke liye dil se dhanyavaad kehne ke liye call kiya hai.',
        script: [
          'Humein aapka {{donation_amount}} ka daan mil gaya hai.',
          'Aapki receipt email aur WhatsApp par bhej di gayi hai.',
          'Bas ek baar receipt par naam aur PAN confirm kar lete hain.',
        ],
        questions: ['Kya aapko receipt mil gayi?', 'Kya receipt par aapka naam aur PAN sahi hai?', 'Kya aap humare kaam ke updates paana chahenge?'],
        objections: [
          { said: 'Receipt nahi mili', reply: 'Maafi chahti hoon. Main abhi aapka email confirm karke dobara bhej deti hoon.' },
          { said: 'PAN galat hai', reply: 'Koi baat nahi. Sahi PAN bata dijiye, main corrected receipt bhej dungi.' },
        ],
        closing: 'Ek baar phir dhanyavaad {{customer_name}}. Aapka saath humare liye bahut maayne rakhta hai.',
        outcomes: ['receipt_confirmed', 'receipt_resend', 'details_corrected', 'callback', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'donation_amount'],
      },
    },
    {
      id: 'ngo-impact-update', name: 'Impact update for donors', goal: 'Show donors what their money achieved', when: 'Every quarter, or when a project milestone is reached',
      audience: { type: 'customers', tags: ['donor'] },
      email: {
        subject: 'What your support made possible, {{first_name}}',
        body: 'Hi {{first_name}},\n\nYou gave to {{business}}, so you deserve to know what happened next. This is not an appeal, just an update.\n\nOver the last few months, with help from donors like you, we [what was achieved].\n\nOne story stays with me. [short beneficiary story].\n\nThis is what your support looks like on the ground. Not just numbers, but real people whose lives are a little easier.\n\nThere is more to do. In the coming months, we are focusing on [next goal].\n\nYou can see photos and the full update here: [link]\n\nIf you would like to visit us and see the work yourself, reply to this email. Our doors are always open to donors.\n\nThank you for being part of this,\n{{business}}',
      },
      whatsapp: {
        name: 'ngo_impact_update', category: 'MARKETING',
        body: 'Hi {{1}}, here is what your support made possible 💛\n\nWith help from donors like you, we {{2}}.\n\nSee photos and the full update: {{3}}\n\nWould you like to visit and see the work yourself? Just reply here. Thank you for being part of this.',
        vars: [fn, { fill: 'What was achieved', example: 'opened two new learning centres' }, { fill: 'Update link', example: 'example.org/update' }],
        footer: STOP,
      },
      call: {
        goal: 'Share the impact with donors and deepen the relationship',
        opening: 'Namaste {{customer_name}}, main {{business_name}} se bol raha hoon. Aaj koi appeal nahi hai, bas aapko batana tha ki aapke daan se kya hua.',
        script: [
          'Pichle kuch mahinon mein aap jaise donors ki madad se humne {{achievement}}.',
          'Zameen par iska matlab hai asli logon ki zindagi mein badlaav.',
          'Hum aapko photos aur poori update WhatsApp par bhej rahe hain.',
          'Agar aap kabhi aakar kaam dekhna chahein, toh humein bahut khushi hogi.',
        ],
        questions: ['Kya aap humari updates paate rehna chahenge?', 'Kya aap kabhi humare project par aana chahenge?', 'Kya aap kisi khaas kaam ke baare mein aur jaanna chahte hain?'],
        objections: [
          { said: 'Main abhi aur daan nahi kar sakta', reply: 'Bilkul, yeh call daan ke liye nahi hai. Bas aapko batana tha ki aapka daan kaam aaya.' },
          { said: 'Mujhe calls nahi chahiye', reply: 'Samajh gaya, maafi chahta hoon. Main aapko sirf WhatsApp ya email updates bhejne ke liye note kar leta hoon.' },
        ],
        closing: 'Bahut dhanyavaad {{customer_name}}. Aapke bina yeh mumkin nahi tha.',
        outcomes: ['engaged', 'wants_visit', 'interested_in_giving', 'updates_only', 'callback', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'achievement'],
      },
    },
    {
      id: 'ngo-volunteer-call', name: 'Volunteer call', goal: 'Sign up volunteers for an upcoming drive or programme', when: '2–3 weeks before a volunteering drive or event',
      audience: { type: 'all' },
      email: {
        subject: 'Can you give us a few hours, {{first_name}}?',
        body: 'Hi {{first_name}},\n\nNot every way of helping needs money. Sometimes the most valuable thing you can give is your time.\n\n{{business}} is looking for volunteers for [volunteer activity] on [date and venue].\n\nYou do not need any special skills. If you can be kind, patient and show up on time, you are exactly who we need. We will brief you on the day, and you will work alongside our team.\n\nIt is also a lovely thing to do with friends, family or colleagues. Many companies count it towards their CSR volunteering hours.\n\nSign up here: [link]\n\nPlease register in advance so we can plan the work and arrange refreshments for everyone.\n\nIf you cannot make it this time, reply and tell us what kind of volunteering interests you. We will reach out when something fits.\n\nWith thanks,\n{{business}}',
      },
      whatsapp: {
        name: 'ngo_volunteer_call', category: 'MARKETING',
        body: 'Hi {{1}}, can you give us a few hours? 🤝\n\nWe need volunteers for {{2}} on {{3}}. No special skills needed, we will brief you on the day.\n\nSign up here: {{4}}\n\nBring friends or colleagues along too!',
        vars: [fn, { fill: 'Volunteer activity', example: 'a beach clean-up' }, { fill: 'Date and venue', example: 'Sun 15 Dec, Juhu beach' }, { fill: 'Sign-up link', example: 'example.org/volunteer' }],
        footer: STOP,
      },
      call: {
        goal: 'Sign up the person as a volunteer',
        opening: 'Hello {{customer_name}}, main {{business_name}} se bol rahi hoon. Hum ek volunteering drive kar rahe hain aur aapko invite karna chahte the.',
        script: [
          'Drive {{activity}} ke liye hai, {{drive_date}} ko.',
          'Koi special skill nahi chahiye, hum us din sab samjha denge.',
          'Aap dost, family ya colleagues ko bhi saath la sakte hain.',
        ],
        questions: ['Kya aap {{drive_date}} ko kuch ghante de sakte hain?', 'Kya aap kisi ko saath laana chahenge?', 'Aapko kis tarah ki volunteering pasand hai?'],
        objections: [
          { said: 'Us din busy hoon', reply: 'Koi baat nahi. Hum aisi drives regularly karte hain. Kya main aapko agli baar ke liye note kar loon?' },
          { said: 'Mujhe kya karna hoga, pata nahi', reply: 'Bilkul chinta mat kijiye. Humari team us din poora brief karegi aur aap unke saath kaam karenge.' },
        ],
        closing: 'Thank you {{customer_name}}! Sign-up link aur details WhatsApp par bhej rahi hoon.',
        outcomes: ['signed_up', 'interested', 'future_volunteer', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'activity', 'drive_date'],
      },
    },
    {
      id: 'ngo-lapsed-donor', name: 'Lapsed donor win-back', goal: 'Re-engage donors who stopped giving', when: '12 months after a donor’s last gift',
      audience: { type: 'customers', tags: ['donor', 'lapsed'] },
      email: {
        subject: 'We have not forgotten you, {{first_name}}',
        body: 'Hi {{first_name}},\n\nIt has been about a year since your last gift to {{business}}. I wanted to write, not to ask straight away, but to say thank you. Your support then is part of what we are able to do today.\n\nSince then, [what changed since their last gift].\n\nI also want to ask you honestly: is there a reason you stopped? Maybe life got busy, maybe money was tight, or maybe we did not keep you informed well enough. If it was us, please tell us. We genuinely want to do better.\n\nIf you feel ready to support us again, any amount helps. Donations are [80G eligible].\n\nGive here: [link]\n\nAnd if you would just like to hear from us now and then, reply and say so. That is enough.\n\nWith gratitude,\n{{business}}',
      },
      whatsapp: {
        name: 'ngo_lapsed_donor', category: 'MARKETING',
        body: 'Hi {{1}}, it has been a while! Thank you for supporting us before 🙏\n\nSince then, {{2}}. Your past gift is part of that.\n\nIf you feel ready to support us again, any amount helps: {{3}}\n\nOr just reply to tell us how we can keep you better informed.',
        vars: [fn, { fill: 'What changed', example: 'we started a new clinic in two villages' }, { fill: 'Donation link', example: 'example.org/give' }],
        footer: STOP,
      },
      call: {
        goal: 'Reconnect with a lapsed donor and invite them to give again',
        opening: 'Namaste {{customer_name}}, main {{business_name}} se bol raha hoon. Aapne pehle humein support kiya tha, uske liye shukriya kehna tha.',
        script: [
          'Aapke pichle daan ke baad humara kaam aage badha hai.',
          'Hum jaanna chahte the ki aap kaise hain, aur humse koi kami toh nahi rahi.',
          'Agar aap phir se judna chahein, toh koi bhi raashi madad karti hai.',
        ],
        questions: ['Kya aap humare haal ke kaam ke baare mein jaanna chahenge?', 'Kya koi wajah thi ki aapne daan rok diya?', 'Kya aap phir se humse judna chahenge?'],
        objections: [
          { said: 'Mujhe koi update nahi mila', reply: 'Aap bilkul sahi keh rahe hain, yeh humari galti hai. Ab se hum aapko regular updates bhejenge.' },
          { said: 'Paise ki tangi hai', reply: 'Bilkul samajh sakta hoon. Koi dabaav nahi hai. Kya hum aapko sirf updates bhejte rahein?' },
        ],
        closing: 'Dhanyavaad {{customer_name}}. Aapka saath humare liye hamesha keemti rahega.',
        outcomes: ['donated', 'pledged', 'updates_only', 'feedback_given', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name'],
      },
    },
    {
      id: 'ngo-year-end-tax', name: 'Year-end tax-saving giving', goal: 'Raise donations before the 31 March tax deadline', when: 'January to March, before the financial year ends',
      audience: { type: 'all' },
      email: {
        subject: 'Before 31 March: give and save tax, {{first_name}}',
        body: 'Hi {{first_name}},\n\nThe financial year ends on 31 March, and many people are now looking at their tax-saving options.\n\nHere is one that does good too. Donations to {{business}} are [80G eligible], which means part of your gift may be deductible when you file your income tax return. Your tax advisor can tell you exactly what applies to you.\n\nYour gift will support [cause], and you will get a proper receipt with all the details you need.\n\nA few things to keep in mind:\n\nGive before 31 March so the donation counts in this financial year.\n\nShare your correct PAN when donating, so it is on your receipt.\n\nPay by UPI, card or bank transfer. Cash donations above a small limit are not eligible.\n\nDonate here: [link]\n\nThank you for choosing to give,\n{{business}}',
      },
      whatsapp: {
        name: 'ngo_year_end_tax', category: 'MARKETING',
        body: 'Hi {{1}}, the financial year ends on 31 March 📅\n\nYour donation to support {{2}} can also help you save tax, as we are {{3}}.\n\nGive before 31 March and share your PAN to get a proper receipt: {{4}}\n\nThank you for giving!',
        vars: [fn, { fill: 'Cause', example: 'girls’ education' }, { fill: 'Tax status', example: '80G registered' }, { fill: 'Donation link', example: 'example.org/give' }],
        footer: STOP,
      },
      call: {
        goal: 'Raise year-end donations before 31 March',
        opening: 'Namaste {{customer_name}}, main {{business_name}} se bol rahi hoon. Financial year 31 March ko khatam ho raha hai, isliye aapse ek chhoti baat karni thi.',
        script: [
          'Bahut log is time tax-saving options dekhte hain.',
          'Humein diya gaya daan {{cause}} ke kaam mein lagega, aur aapko poori receipt milegi.',
          'Tax benefit kitna milega, yeh aapke CA bata payenge.',
          'Daan 31 March se pehle aur PAN ke saath karna zaroori hai.',
        ],
        questions: ['Kya aapne is saal ki tax planning kar li hai?', 'Kya aap {{cause}} ke kaam ke baare mein jaanna chahenge?', 'Kya main donation link WhatsApp par bhej doon?'],
        objections: [
          { said: 'Mera tax already plan ho chuka hai', reply: 'Achhi baat hai. Phir bhi agar aap is cause ko support karna chahein, toh link bhej deti hoon.' },
          { said: 'Kya sach mein tax bachega?', reply: 'Receipt mein saari details hoti hain. Aapko kitna benefit milega, yeh aapki tax situation par depend karta hai, isliye CA se ek baar confirm kar lijiye.' },
        ],
        closing: 'Dhanyavaad {{customer_name}}. Link aur details WhatsApp par bhej rahi hoon.',
        outcomes: ['donated', 'pledged', 'send_link', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'cause'],
      },
    },
  ],
};
