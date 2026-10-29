// Campaign templates: manufacturers, retail shops / showrooms, traders / distributors / wholesalers — format in ../campaigntpl.js
const STOP = 'Reply STOP to opt out';
const fn = { key: 'first_name', example: 'Rakesh' };

export default {
  // ───────────────────────── Manufacturers / factories ─────────────────────────
  manufacturer: [
    {
      id: 'mfg-new-product-launch', name: 'New product launch to dealers', goal: 'Get dealers to order the new product for their shelves', when: 'When a new product or model is ready to ship',
      audience: { type: 'customers' },
      email: {
        subject: '{{first_name}}, a new product from {{business}} is ready to order',
        body: 'Hi {{first_name}},\n\nWe have a new product ready: [product name]. You asked us for something like this over the last few months, and we wanted you to hear about it first.\n\nWhat it is: [one-line description]\n\nWhy your customers will like it: [main benefit]\n\nDealer price: [dealer price] against an MRP of [MRP], so your margin stays healthy.\n\nMinimum order: [MOQ]. Dispatch starts from [dispatch date].\n\nIf you want to see it before ordering, we can send a sample or our sales person can bring one to your shop. Just reply to this email or call us on [phone].\n\nThe full product sheet with sizes and packing is here: [link]\n\nThank you for growing with us.\n\nRegards,\n{{business}}',
      },
      whatsapp: {
        name: 'mfg_new_product_launch', category: 'MARKETING',
        body: 'Namaste {{1}} 🏭\n\nOur new product {{2}} is ready to dispatch. Dealer price {{3}}, with your usual margin.\n\nWant a sample or the product sheet? See it here: {{4}}\n\nReply YES and our team will call you.',
        vars: [fn, { fill: 'Product name', example: 'Turbo 1 HP pump' }, { fill: 'Dealer price', example: '₹7,350' }, { fill: 'Product sheet link', example: 'example.in/turbo' }],
        footer: STOP,
      },
      call: {
        goal: 'Tell the dealer about the new product and book a first order or a sample',
        opening: 'Namaste {{customer_name}} ji, main {{business_name}} se bol raha hoon. Humne ek naya product launch kiya hai, aapko sabse pehle batana tha.',
        script: [
          'Naya product hai {{product_name}}, aur dealer price {{dealer_price}} hai, MRP ke hisaab se aapka margin achha rahega.',
          'Kai dealers ne isi tarah ke product ke liye pucha tha, isliye humne banaya.',
          'Minimum order chhota rakha hai taaki aap pehle market mein check kar sakein.',
          'Agar aap chahein toh pehle sample bhej dete hain ya humara sales person dikha dega.',
        ],
        questions: ['Aapke customers is tarah ka product maangte hain?', 'Pehle sample chahiye ya seedha order karna chahenge?', 'Kitni quantity se shuru karna theek rahega?'],
        objections: [
          { said: 'Abhi purana stock pada hai', reply: 'Samajh gaya. Toh abhi sirf ek chhota lot ya sample le lijiye, market mein response dekh ke aage badhiye.' },
          { said: 'Margin kam hai', reply: 'Main aapko MRP aur dealer price dono WhatsApp par bhej deta hoon, aap calculate kar lijiye. Volume par slab bhi hai.' },
          { said: 'Naya product, chalega ya nahi pata nahi', reply: 'Bilkul sahi baat hai. Isliye sample bhej dete hain, aap do-chaar customers ko dikha ke dekhiye.' },
        ],
        closing: 'Dhanyavaad {{customer_name}} ji. Product sheet aur rate WhatsApp par bhej raha hoon. Koi bhi sawaal ho toh isi number par call kar lijiye.',
        outcomes: ['order_placed', 'wants_sample', 'send_details', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'product_name', 'dealer_price'],
      },
    },
    {
      id: 'mfg-dealer-scheme', name: 'Dealer scheme / quarterly target', goal: 'Get dealers to plan orders to reach the scheme target', when: 'At the start of a month or quarter when a dealer scheme opens',
      audience: { type: 'customers' },
      email: {
        subject: 'Dealer scheme for [period]: what you can earn, {{first_name}}',
        body: 'Hi {{first_name}},\n\nOur dealer scheme for [period] is now open. Here is how it works, in plain words.\n\nTarget: [target], counted on invoices raised between [start date] and [end date].\n\nWhat you get: [scheme benefit]. It is given as [credit note / free goods] after the period closes.\n\nA few points so there is no confusion later:\n\nOnly paid invoices count, so please keep your payments on time.\n\nYour progress so far is in your account statement, and our sales person can share it any time.\n\nIf you are close to the next slab near the end of the period, we will tell you, so you can decide whether to top up.\n\nScheme details and slabs: [link]\n\nQuestions? Reply to this email or call [phone].\n\nRegards,\n{{business}}',
      },
      whatsapp: {
        name: 'mfg_dealer_scheme', category: 'MARKETING',
        body: 'Namaste {{1}}, our dealer scheme is now open 📈\n\nTarget: {{2}}\nYou get: {{3}}\n\nOnly paid invoices in the scheme period count. Full slabs and terms: {{4}}\n\nReply PLAN and our sales person will help you plan your orders.',
        vars: [fn, { fill: 'Target', example: '₹5 lakh in this quarter' }, { fill: 'Scheme benefit', example: '3% credit note' }, { fill: 'Scheme link', example: 'example.in/scheme' }],
        footer: STOP,
      },
      call: {
        goal: 'Explain the scheme and help the dealer plan orders to reach it',
        opening: 'Namaste {{customer_name}} ji, {{business_name}} se bol rahi hoon. Is baar ka dealer scheme shuru ho gaya hai, uske baare mein do minute baat karni thi.',
        script: [
          'Scheme mein target {{target}} hai, aur poora karne par aapko {{scheme_benefit}} milega.',
          'Sirf scheme period ke paid invoices count hote hain.',
          'Aapki pichli sales dekh ke lagta hai aap aaram se target ke paas pahunch sakte hain.',
          'Main aapke sales person ko bol deti hoon ki aapke saath monthly order plan kar le.',
        ],
        questions: ['Is period mein aapko kitna maal chahiye lagega?', 'Kaunse products zyada chal rahe hain aapke yahan?', 'Kya main aapke sales person se visit fix karwa doon?'],
        objections: [
          { said: 'Target bahut zyada hai', reply: 'Samajh sakti hoon. Neeche wale slab par bhi benefit milta hai, main details bhej deti hoon, aap dekh lijiye.' },
          { said: 'Pichli baar credit note late aaya tha', reply: 'Aapki baat sahi hai, maine note kar liya hai. Is baar period khatam hone ke baad time par dene ki poori koshish hogi.' },
          { said: 'Abhi payment tight hai', reply: 'Koi baat nahi. Order ko period mein baant ke bhi le sakte hain, ek saath lene ki zaroorat nahi.' },
        ],
        closing: 'Dhanyavaad {{customer_name}} ji. Scheme ki details WhatsApp par bhej rahi hoon. Aapka business achha chale!',
        outcomes: ['will_order', 'plan_visit', 'send_details', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'target', 'scheme_benefit'],
      },
    },
    {
      id: 'mfg-price-revision', name: 'Price revision notice', goal: 'Inform dealers of new prices early and honestly', when: '7–15 days before a price change takes effect',
      audience: { type: 'customers' },
      email: {
        subject: 'Price revision from [effective date], {{first_name}}',
        body: 'Hi {{first_name}},\n\nWe want to give you clear notice of a price change, so you can plan.\n\nFrom [effective date], prices on [product range] will change by [change]. The reason is simple: [reason, e.g. raw material cost has gone up over the last three months]. We have held prices as long as we could.\n\nWhat this means for you:\n\nAll orders confirmed with a PO before [effective date] will be billed at the current prices, as long as dispatch happens by [last dispatch date].\n\nThe new price list is attached here: [link]\n\nYour MRP and margins on the new list are worked out the same way as before.\n\nIf you want to place an order at the current price, reply to this email or call [phone] and we will reserve your quantity.\n\nThank you for understanding.\n\nRegards,\n{{business}}',
      },
      whatsapp: {
        name: 'mfg_price_revision', category: 'UTILITY',
        body: 'Namaste {{1}}, this is to inform you that prices on our products will be revised from {{2}}.\n\nOrders with a PO before that date are billed at current prices. The new price list is here: {{3}}\n\nFor any question, please reply to this message.',
        vars: [fn, { fill: 'Effective date', example: '1 December' }, { fill: 'Price list link', example: 'example.in/prices' }],
      },
      call: {
        goal: 'Tell the dealer about the price change and take any order at the current price',
        opening: 'Namaste {{customer_name}} ji, {{business_name}} se bol raha hoon. Ek zaroori jaankari deni thi, {{effective_date}} se humare rates badal rahe hain.',
        script: [
          'Raw material ka kharcha kaafi badh gaya hai, isliye rates revise karne pad rahe hain.',
          '{{effective_date}} se pehle PO dene par purane rate par hi bill hoga.',
          'Naya rate list main aapko WhatsApp par bhej deta hoon.',
          'Agar aapko kuch maal chahiye toh abhi quantity bata dijiye, hum reserve kar dete hain.',
        ],
        questions: ['Aane wale mahine ke liye aapko kitna stock chahiye hoga?', 'Kya abhi purane rate par order lagana chahenge?', 'Naya rate list kis number par bhejoon?'],
        objections: [
          { said: 'Har baar rate badha dete ho', reply: 'Aapki baat samajh raha hoon. Isiliye pehle se bata rahe hain taaki aap purane rate par stock le sakein.' },
          { said: 'Dusri company sasta de rahi hai', reply: 'Ho sakta hai. Humari quality aur service aapne dekhi hai. Main rate list bhejta hoon, aap compare kar lijiye.' },
          { said: 'Abhi order nahi chahiye', reply: 'Koi baat nahi, bas aapko pata hona chahiye tha. Rate list bhej deta hoon, zaroorat ho toh bata dijiye.' },
        ],
        closing: 'Dhanyavaad {{customer_name}} ji. Naya rate list WhatsApp par bhej raha hoon.',
        outcomes: ['order_at_old_rate', 'noted', 'send_price_list', 'callback', 'unhappy', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'effective_date'],
      },
    },
    {
      id: 'mfg-trade-fair-invite', name: 'Trade fair / expo invite', goal: 'Get buyers and dealers to visit your stall', when: '2–3 weeks before a trade fair you are exhibiting at',
      audience: { type: 'all' },
      email: {
        subject: 'Meet us at [fair name], stall [stall number]',
        body: 'Hi {{first_name}},\n\nWe are exhibiting at [fair name] in [city], from [dates], and we would be glad to meet you there.\n\nYou will find us at hall [hall], stall [stall number].\n\nWhat you can see at our stall:\n\nOur full range, including [new products].\n\nLive demos, so you can check the finish and quality in person.\n\nOur team, including people from the factory who can answer technical questions on the spot.\n\nIf you tell us when you plan to visit, we will make sure the right person is free to meet you. Just reply with your preferred day and time.\n\nEntry passes: [pass link]\n\nIf you cannot make it, we are happy to send you the catalogue or arrange a video call instead.\n\nSee you there,\n{{business}}',
      },
      whatsapp: {
        name: 'mfg_trade_fair_invite', category: 'MARKETING',
        body: 'Namaste {{1}}, we are exhibiting at {{2}} 🏢\n\nVisit us at stall {{3}} to see our full range and new products live. Free entry pass: {{4}}\n\nReply with your visit day and we will keep time for you.',
        vars: [fn, { fill: 'Fair name and dates', example: 'IHGF Delhi, 16–20 Oct' }, { fill: 'Stall number', example: 'Hall 5, B-12' }, { fill: 'Pass link', example: 'example.in/pass' }],
        footer: STOP,
      },
      call: {
        goal: 'Invite the buyer to the stall and fix a meeting time',
        opening: 'Namaste {{customer_name}} ji, {{business_name}} se bol rahi hoon. Hum {{fair_name}} mein stall laga rahe hain, aapko invite karna tha.',
        script: [
          'Humara stall {{stall_number}} par hoga.',
          'Wahan poori range aur naye products live dekh sakte hain.',
          'Factory ki technical team bhi wahan hogi, toh aap seedha sawaal pooch sakte hain.',
          'Agar aap din aur time bata dein toh hum aapke liye time rakh lenge.',
        ],
        questions: ['Kya aap fair mein aane ka plan kar rahe hain?', 'Kaunsa din aapke liye theek rahega?', 'Kya aapko free entry pass chahiye?'],
        objections: [
          { said: 'Fair mein bahut bheed hoti hai', reply: 'Isiliye time fix kar lete hain, taaki aapko wait na karna pade.' },
          { said: 'Main nahi aa paunga', reply: 'Koi baat nahi. Main catalogue bhej deti hoon, ya video call par products dikha sakte hain.' },
          { said: 'Abhi kuch kharidna nahi hai', reply: 'Bilkul theek. Bas naye products dekh lijiye, order ki koi zabardasti nahi.' },
        ],
        closing: 'Dhanyavaad {{customer_name}} ji. Pass aur stall ki details WhatsApp par bhej rahi hoon. Milte hain!',
        outcomes: ['will_visit', 'meeting_fixed', 'send_catalogue', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'fair_name', 'stall_number'],
      },
    },
    {
      id: 'mfg-sample-follow-up', name: 'Sample follow-up', goal: 'Turn a sample into a quotation or first order', when: '5–7 days after the sample is delivered',
      audience: { type: 'leads' },
      email: {
        subject: 'How did the samples work for you, {{first_name}}?',
        body: 'Hi {{first_name}},\n\nOur samples of [product] should have reached you by now. We hope you and your team had a chance to check them.\n\nWe would really like your honest feedback, even if something was not right. It helps us either fix it or tell you clearly what we can and cannot do.\n\nA few things buyers usually check:\n\nQuality and finish compared with what you use now.\n\nPacking, and whether it suits your customers.\n\nPrice at your expected quantity.\n\nIf the samples worked for you, we can send a formal quotation with price slabs for your quantity. The sample amount is adjusted against your first order, as agreed.\n\nJust reply to this email, or call us on [phone].\n\nRegards,\n{{business}}',
      },
      whatsapp: {
        name: 'mfg_sample_follow_up', category: 'MARKETING',
        body: 'Namaste {{1}}, hope our samples of {{2}} reached you safely 📦\n\nHow did you find the quality? Any feedback helps us, good or bad.\n\nIf it suits you, reply QUOTE and we will send a quotation for your quantity.',
        vars: [fn, { fill: 'Product', example: 'cotton bath towels' }],
        footer: STOP,
      },
      call: {
        goal: 'Get feedback on the sample and move to a quotation',
        opening: 'Namaste {{customer_name}} ji, {{business_name}} se bol raha hoon. Humne aapko {{product_name}} ke samples bheje the, unka feedback lena tha.',
        script: [
          'Umeed hai samples time par aur sahi condition mein mile.',
          'Quality, finish aur packing ke baare mein aapki raay jaanna chahte hain.',
          'Agar kuch theek nahi laga toh bata dijiye, hum improve kar sakte hain ya clearly bata denge.',
          'Agar pasand aaya toh aapki quantity ke hisaab se quotation bhej dete hain.',
        ],
        questions: ['Samples ki quality kaisi lagi?', 'Aapko monthly kitni quantity chahiye hoti hai?', 'Kya main quotation bhej doon?'],
        objections: [
          { said: 'Abhi check nahi kiya', reply: 'Koi baat nahi. Main teen-chaar din baad phir call kar leta hoon, tab tak aap dekh lijiye.' },
          { said: 'Rate zyada lag raha hai', reply: 'Quantity par slab rate hai. Aap apni quantity bata dijiye, main best rate ke saath quotation bhejta hoon.' },
          { said: 'Quality mein thoda farak hai', reply: 'Batane ke liye shukriya. Kya farak laga, bata dijiye, main factory team se baat karke aapko jawab deta hoon.' },
        ],
        closing: 'Dhanyavaad {{customer_name}} ji. Main aapko WhatsApp par aage ki details bhej raha hoon.',
        outcomes: ['send_quotation', 'liked_sample', 'needs_changes', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'product_name'],
      },
    },
    {
      id: 'mfg-order-dispatched', name: 'Order ready / dispatched', goal: 'Tell the buyer their order has left, with LR and invoice details', when: 'On the day the order is dispatched from the factory',
      audience: { type: 'customers' },
      email: {
        subject: 'Your order [order number] has been dispatched',
        body: 'Hi {{first_name}},\n\nGood news: your order [order number] has been dispatched from our factory today.\n\nDispatch details:\n\nInvoice number: [invoice number]\n\nTransporter: [transporter name]\n\nLR / docket number: [LR number]\n\nExpected delivery: [delivery date]\n\nNumber of cartons: [cartons]\n\nThe invoice and e-way bill are attached here: [link]\n\nWhen the goods arrive, please count the cartons and check for any visible damage before signing the transporter’s copy. If anything is short or damaged, note it on the LR and send us photos within 48 hours so we can sort it out quickly.\n\nThank you for your order.\n\nRegards,\n{{business}}',
      },
      whatsapp: {
        name: 'mfg_order_dispatched', category: 'UTILITY',
        body: 'Hi {{1}}, your order {{2}} has been dispatched today 🚚\n\nTransporter and LR number: {{3}}\nExpected delivery: {{4}}\n\nPlease check the carton count on arrival and send photos within 48 hours if anything is damaged.',
        vars: [fn, { fill: 'Order number', example: 'PO-2291' }, { fill: 'Transporter and LR number', example: 'VRL, LR 558812' }, { fill: 'Expected delivery', example: '14 Nov' }],
      },
      call: {
        goal: 'Confirm dispatch details and make sure the buyer is ready to receive',
        opening: 'Namaste {{customer_name}} ji, {{business_name}} se bol rahi hoon. Aapka order {{order_number}} aaj dispatch ho gaya hai.',
        script: [
          'Maal {{transporter}} se gaya hai, LR number WhatsApp par bhej diya hai.',
          'Expected delivery {{delivery_date}} tak hai.',
          'Maal aane par cartons gin lijiye aur koi damage ho toh LR par likh dijiye.',
          'Invoice aur e-way bill bhi bhej diye hain.',
        ],
        questions: ['Kya delivery address wahi hai jo PO mein tha?', 'Maal receive karne ke liye koi contact number dena hai?', 'Kya invoice ki copy mil gayi?'],
        objections: [
          { said: 'Delivery late ho rahi hai', reply: 'Main transporter se abhi baat karke aapko update deti hoon.' },
          { said: 'Address badalna hai', reply: 'Naya address bata dijiye, main turant transporter ko inform karti hoon.' },
        ],
        closing: 'Dhanyavaad {{customer_name}} ji. Koi bhi dikkat ho toh isi number par bataiye.',
        outcomes: ['confirmed', 'address_change', 'delivery_issue', 'callback', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'order_number', 'transporter', 'delivery_date'],
      },
    },
    {
      id: 'mfg-payment-reminder', name: 'Payment reminder', goal: 'Collect a due or overdue invoice politely', when: 'A few days before the due date, and again after it passes',
      audience: { type: 'customers', tags: ['payment-due'] },
      email: {
        subject: 'Payment reminder: invoice [invoice number]',
        body: 'Hi {{first_name}},\n\nThis is a friendly reminder about the payment for invoice [invoice number], dated [invoice date].\n\nAmount due: [amount]\n\nDue date: [due date]\n\nYou can pay by bank transfer or UPI:\n\nAccount name: [account name]\nAccount number: [account number]\nIFSC: [IFSC]\nUPI: [UPI ID]\n\nIf you have already paid, thank you, and please share the UTR number so we can match it in our books.\n\nIf there is any difference in the amount, a short supply or a pending credit note, just reply and tell us. We will check and sort it out before asking again.\n\nThank you for your business.\n\nRegards,\nAccounts team\n{{business}}',
      },
      whatsapp: {
        name: 'mfg_payment_reminder', category: 'UTILITY',
        body: 'Namaste {{1}}, a reminder that payment for invoice {{2}} of {{3}} is due on {{4}}.\n\nIf you have already paid, please share the UTR number so we can update our records. For any difference in amount, just reply here.',
        vars: [fn, { fill: 'Invoice number', example: 'INV-1187' }, { fill: 'Amount', example: '₹1,84,500' }, { fill: 'Due date', example: '20 Nov' }],
      },
      call: {
        goal: 'Get a payment date for the due invoice',
        opening: 'Namaste {{customer_name}} ji, {{business_name}} ke accounts se bol raha hoon. Invoice {{invoice_number}} ki payment ke baare mein baat karni thi.',
        script: [
          'Invoice {{invoice_number}} ka {{amount}} due hai.',
          'Agar payment ho chuki hai toh UTR number bata dijiye, hum match kar lenge.',
          'Agar amount mein koi farak hai ya credit note baaki hai, toh bata dijiye, hum check kar lete hain.',
          'Bank details WhatsApp par bhej deta hoon.',
        ],
        questions: ['Payment kab tak ho payegi?', 'Kya payment ho chuki hai? UTR mil sakta hai?', 'Kya invoice mein koi dikkat hai?'],
        objections: [
          { said: 'Abhi paise nahi hain', reply: 'Samajh sakta hoon. Kya part payment abhi aur baaki ek date tak kar sakte hain? Bas ek date bata dijiye.' },
          { said: 'Maal mein damage tha', reply: 'Sorry iske liye. Photos bhej dijiye, hum credit note ka process karte hain aur baaki amount clear kar lete hain.' },
          { said: 'Payment kar di hai', reply: 'Shukriya! UTR number bhej dijiye, main abhi accounts mein update karwa deta hoon.' },
        ],
        closing: 'Dhanyavaad {{customer_name}} ji. Maine payment date note kar li hai, details WhatsApp par bhej raha hoon.',
        outcomes: ['payment_promised', 'already_paid', 'part_payment', 'dispute', 'callback', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'invoice_number', 'amount'],
      },
    },
  ],

  // ───────────────────────── Retail shops / showrooms ─────────────────────────
  retailer: [
    {
      id: 'retail-festival-sale', name: 'Festival sale at the store', goal: 'Bring customers to the store during the festival sale', when: '7–10 days before Diwali, Durga Puja, Onam, Eid or Pongal',
      audience: { type: 'all' },
      email: {
        subject: '{{first_name}}, our festival offers are on at {{business}}',
        body: 'Hi {{first_name}},\n\nThe festive season is here, and our store is ready for it.\n\nFrom [start date] to [end date], we have [offer] on [categories]. These are real discounts on our regular prices, and you can see both on every tag in the store.\n\nA few things that make the visit easier:\n\nCome on a weekday morning if you can. The store is calmer and our staff can give you more time.\n\nEMI on cards and exchange of old products are available on many items.\n\nFree home delivery within [delivery area] on purchases above [amount].\n\nWant us to keep something aside for you? Send us a WhatsApp on [phone] with what you are looking for, and we will have options ready when you come.\n\nStore address: [address]\nOpen: [timings]\n\nWishing you and your family a happy festival.\n\n{{business}}',
      },
      whatsapp: {
        name: 'retail_festival_sale', category: 'MARKETING',
        body: 'Hi {{1}} 🪔 Our festival offers are on at the store!\n\n{{2}} till {{3}}. Free home delivery on bigger purchases, EMI on cards and exchange available.\n\nTell us what you are looking for and we will keep options ready for your visit. Store location: {{4}}\n\nSee you soon!',
        vars: [fn, { fill: 'Offer', example: 'Up to 20% off on TVs and ACs' }, { fill: 'Offer end date', example: '3 Nov' }, { fill: 'Map link', example: 'maps.app.goo.gl/abc' }],
        footer: STOP,
      },
      call: {
        goal: 'Tell past customers about the festival offers and invite them to visit',
        opening: 'Namaste {{customer_name}} ji, main {{business_name}} se bol rahi hoon. Aap pehle humare store aaye the, isliye festival offers ke baare mein batana tha.',
        script: [
          'Is festival par {{offer}} chal raha hai, {{end_date}} tak.',
          'EMI aur purane product ka exchange bhi available hai.',
          'Shehar mein badi khareedari par home delivery free hai.',
          'Aap bata dein kya dekh rahe hain, toh hum aapke aane se pehle options ready rakhenge.',
        ],
        questions: ['Is festival par aap kuch naya lene ka soch rahe hain?', 'Aap kis din store aa sakte hain?', 'Kya main offers WhatsApp par bhej doon?'],
        objections: [
          { said: 'Online sasta milta hai', reply: 'Ho sakta hai kuch cheezein. Store par aap product dekh ke le sakte hain, aur installation aur service hum khud karte hain. Ek baar price compare kar lijiye.' },
          { said: 'Abhi budget nahi hai', reply: 'Koi baat nahi. EMI ka option bhi hai, aur bina khareede bhi aap dekhne aa sakte hain.' },
          { said: 'Time nahi milta', reply: 'Samajh sakti hoon. WhatsApp par photos aur price bhej deti hoon, pasand aaye toh ghar par delivery ho jayegi.' },
        ],
        closing: 'Dhanyavaad {{customer_name}} ji. Offers aur store ka location WhatsApp par bhej rahi hoon. Aapko festival ki shubhkamnayein!',
        outcomes: ['will_visit', 'interested', 'send_offers', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'offer', 'end_date'],
      },
    },
    {
      id: 'retail-new-arrivals', name: 'New arrivals in store', goal: 'Get regular customers to come and see the new stock', when: 'When a new collection or new models arrive',
      audience: { type: 'customers' },
      email: {
        subject: 'New in store at {{business}}, {{first_name}}',
        body: 'Hi {{first_name}},\n\nWe have just got new stock in, and since you have shopped with us before, we wanted you to see it first.\n\nWhat is new: [new arrivals]\n\nPrice range: [price range]\n\nNew stock usually has the widest choice of sizes, colours and models in the first couple of weeks, so it is a good time to visit if you have something in mind.\n\nIf you would like to see a few pieces before coming in, reply on WhatsApp at [phone] and we will send photos and prices.\n\nStore address: [address]\nOpen: [timings]\n\nWe look forward to seeing you again.\n\n{{business}}',
      },
      whatsapp: {
        name: 'retail_new_arrivals', category: 'MARKETING',
        body: 'Hi {{1}} ✨ New stock just arrived at our store: {{2}}\n\nThe best choice of sizes and colours is in the first couple of weeks. Want photos and prices first? Just reply here.\n\nSee the new range: {{3}}\n\nHope to see you soon!',
        vars: [fn, { fill: 'New arrivals', example: 'winter jackets and sweaters' }, { fill: 'Catalogue link', example: 'example.in/new' }],
        footer: STOP,
      },
      call: {
        goal: 'Invite a past customer to see the new stock',
        opening: 'Namaste {{customer_name}} ji, {{business_name}} se bol raha hoon. Humare yahan naya stock aaya hai, aapko batana tha.',
        script: [
          'Naya stock hai {{new_arrivals}}.',
          'Shuru ke dino mein sabse zyada choice milti hai.',
          'Aap chahein toh pehle WhatsApp par photos aur price bhej deta hoon.',
          'Aap aayenge toh hum aapke liye options ready rakhenge.',
        ],
        questions: ['Kya aap kuch khaas dhoondh rahe hain?', 'Kya photos WhatsApp par bhejoon?', 'Is hafte kab aa sakte hain?'],
        objections: [
          { said: 'Abhi zaroorat nahi', reply: 'Koi baat nahi. Bas photos bhej deta hoon, jab mann ho tab dekh lijiye.' },
          { said: 'Pichli baar size nahi mila', reply: 'Maafi chahta hoon. Is baar size bata dijiye, main pehle check karke confirm karunga.' },
        ],
        closing: 'Dhanyavaad {{customer_name}} ji. Photos WhatsApp par bhej raha hoon.',
        outcomes: ['will_visit', 'send_photos', 'interested', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'new_arrivals'],
      },
    },
    {
      id: 'retail-birthday-anniversary', name: 'Birthday / anniversary wish', goal: 'Wish customers on their day with a small, genuine offer', when: 'A few days before the customer’s birthday or anniversary',
      audience: { type: 'customers' },
      email: {
        subject: 'Happy [occasion], {{first_name}}!',
        body: 'Hi {{first_name}},\n\nWarm wishes from all of us at {{business}} on your [occasion]! We hope the day is full of good food, family and happiness.\n\nAs a small thank-you for being our customer, here is [offer] on anything you buy from our store this month. Just show this message at the billing counter.\n\nIf you are planning a gift for someone, or a little something for yourself, our team will be happy to help you choose. You can also send us a WhatsApp at [phone] and we will keep options ready.\n\nThe offer is valid till [valid till].\n\nOnce again, many happy returns of the day.\n\nWith best wishes,\n{{business}}',
      },
      whatsapp: {
        name: 'retail_birthday_wish', category: 'MARKETING',
        body: 'Happy birthday {{1}}! 🎂 Warm wishes from all of us.\n\nAs a small thank-you, enjoy {{2}} on your purchase at our store this month. Just show this message at billing, valid till {{3}}.\n\nHave a wonderful day!',
        vars: [fn, { fill: 'Offer', example: '10% off' }, { fill: 'Valid till', example: '30 Nov' }],
        footer: STOP,
      },
      call: {
        goal: 'Wish the customer and tell them about their birthday offer',
        opening: 'Namaste {{customer_name}} ji, {{business_name}} se bol rahi hoon. Aapko janamdin ki dher saari shubhkamnayein!',
        script: [
          'Aap humare purane customer hain, isliye ek chhota sa tohfa hai.',
          'Is mahine store par aapki khareedari par {{offer}} milega.',
          'Bas billing par humara message dikha dijiye.',
          'Agar kisi ke liye gift lena ho toh hum madad kar denge.',
        ],
        questions: ['Kya aap is mahine store aa payenge?', 'Kya kisi ke liye gift dekh rahe hain?'],
        objections: [
          { said: 'Abhi kuch nahi lena', reply: 'Koi baat nahi ji, bas aapko wish karna tha. Offer mahine bhar hai, kabhi bhi aa sakte hain.' },
          { said: 'Phone par offer mat bhejo', reply: 'Bilkul, maine note kar liya hai. Aapko aage aise call nahi aayenge.' },
        ],
        closing: 'Ek baar phir janamdin mubarak ho {{customer_name}} ji. Aapka din bahut achha jaaye!',
        outcomes: ['will_visit', 'wished', 'interested', 'do_not_call', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'offer'],
      },
    },
    {
      id: 'retail-win-back', name: 'Win back lapsed customers', goal: 'Bring back customers who have not visited in months', when: 'When a customer has not bought anything for 6 months or more',
      audience: { type: 'customers', tags: ['inactive-180'] },
      email: {
        subject: 'We have missed you at {{business}}, {{first_name}}',
        body: 'Hi {{first_name}},\n\nIt has been a while since your last visit to our store, and we wanted to check in.\n\nIf something was not right last time, the service, a product or the price, we would genuinely like to know. Just reply to this email. It goes to the owner, and we read every reply.\n\nA lot has changed since your last visit:\n\n[what is new at the store]\n\nTo welcome you back, here is [offer] on your next purchase, valid till [valid till].\n\nStore address: [address]\nOpen: [timings]\n\nWe hope to see you again soon.\n\nWarm regards,\n{{business}}',
      },
      whatsapp: {
        name: 'retail_win_back', category: 'MARKETING',
        body: 'Hi {{1}}, it has been a while since your last visit and we have missed you 🙏\n\nTo welcome you back, enjoy {{2}} on your next purchase, valid till {{3}}.\n\nIf anything was not right last time, please reply and tell us. We would like to fix it.',
        vars: [fn, { fill: 'Offer', example: '₹500 off on ₹3,000+' }, { fill: 'Valid till', example: '15 Dec' }],
        footer: STOP,
      },
      call: {
        goal: 'Find out why the customer stopped coming and invite them back',
        opening: 'Namaste {{customer_name}} ji, {{business_name}} se bol raha hoon. Kaafi samay se aap store nahi aaye, bas haal-chaal poochhna tha.',
        script: [
          'Agar pichli baar kuch theek nahi laga tha toh hum sach mein jaanna chahte hain.',
          'Store mein kaafi naya aaya hai.',
          'Aapke liye {{offer}} ka welcome back offer hai.',
          'Aap bata dein kya dekhna hai, hum ready rakhenge.',
        ],
        questions: ['Pichli baar humare store ka anubhav kaisa raha?', 'Kya aapko kuch chahiye aajkal?', 'Kya offer WhatsApp par bhej doon?'],
        objections: [
          { said: 'Service achhi nahi thi', reply: 'Sorry ji, batane ke liye shukriya. Kya hua tha bata dijiye, main owner tak baat pahunchaunga.' },
          { said: 'Ab dusri dukaan se lete hain', reply: 'Samajh gaya. Kabhi compare karna ho toh humein bhi ek mauka dijiye, offer bhej deta hoon.' },
          { said: 'Shift ho gaye hain', reply: 'Achha. Hum home delivery bhi karte hain, naya area bata dijiye, main check kar leta hoon.' },
        ],
        closing: 'Dhanyavaad {{customer_name}} ji, aapka feedback note kar liya hai. Offer WhatsApp par bhej raha hoon.',
        outcomes: ['will_visit', 'feedback_given', 'send_offer', 'moved_away', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'offer'],
      },
    },
    {
      id: 'retail-exchange-offer', name: 'Exchange offer', goal: 'Get customers to upgrade by exchanging their old product', when: 'When an exchange or upgrade offer is running',
      audience: { type: 'customers' },
      email: {
        subject: 'Exchange your old [product] at {{business}}, {{first_name}}',
        body: 'Hi {{first_name}},\n\nIs your old [product] giving trouble or simply getting old? We are running an exchange offer that makes upgrading easier.\n\nHow it works:\n\nBring your old [product] to the store, or send us a photo on WhatsApp at [phone] for an estimate first.\n\nWe give you an exchange value of [exchange value] depending on the model and condition.\n\nThe value comes straight off the price of your new one. We pick up the old unit when we deliver the new one, so you do not have to carry it.\n\nThe offer is on [brands / models] and runs till [end date].\n\nEMI on cards is also available, so you can spread the balance.\n\nStore address: [address]\n\nRegards,\n{{business}}',
      },
      whatsapp: {
        name: 'retail_exchange_offer', category: 'MARKETING',
        body: 'Hi {{1}}, upgrade your old {{2}} with our exchange offer 🔄\n\nGet up to {{3}} off on a new one, and we pick up the old unit when we deliver. Offer till {{4}}.\n\nSend us a photo of your old product here for a quick estimate.',
        vars: [fn, { fill: 'Product', example: 'washing machine' }, { fill: 'Exchange value', example: '₹5,000' }, { fill: 'Offer end date', example: '30 Nov' }],
        footer: STOP,
      },
      call: {
        goal: 'Tell the customer about the exchange offer and get a photo or visit',
        opening: 'Namaste {{customer_name}} ji, {{business_name}} se bol rahi hoon. Humare yahan abhi exchange offer chal raha hai, aapko batana tha.',
        script: [
          'Purana {{product}} dekar naye par {{exchange_value}} tak ki chhoot mil sakti hai.',
          'Naya deliver karte waqt hum purana utha lete hain.',
          'Pehle WhatsApp par purane product ki photo bhej dijiye, hum estimate bata denge.',
          'EMI ka option bhi hai.',
        ],
        questions: ['Aapka purana product kitna purana hai?', 'Kya aap photo WhatsApp par bhej sakte hain?', 'Store kab aa sakte hain?'],
        objections: [
          { said: 'Purana abhi chal raha hai', reply: 'Achhi baat hai. Bas estimate le lijiye, offer {{end_date}} tak hai, aap aaram se decide kariye.' },
          { said: 'Exchange value kam milti hai', reply: 'Value model aur condition par depend karti hai. Photo bhejiye, main exact bata deti hoon, phir aap decide kariye.' },
        ],
        closing: 'Dhanyavaad {{customer_name}} ji. Offer ki details WhatsApp par bhej rahi hoon.',
        outcomes: ['will_visit', 'send_photo', 'interested', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'product', 'exchange_value', 'end_date'],
      },
    },
    {
      id: 'retail-delivery-update', name: 'Delivery / installation update', goal: 'Confirm the delivery and installation slot for a purchase', when: 'The day before delivery or installation',
      audience: { type: 'customers', tags: ['delivery'] },
      email: {
        subject: 'Your delivery from {{business}} is scheduled for [delivery date]',
        body: 'Hi {{first_name}},\n\nThank you for shopping with us. Your purchase is ready and scheduled for delivery.\n\nItem: [item]\n\nDelivery date: [delivery date]\n\nTime slot: [time slot]\n\nInstallation: [installation details]\n\nA few things that help on the day:\n\nPlease make sure someone is at home to receive the delivery.\n\nKeep the space ready where the item will go, with a power point nearby if it needs one.\n\nCheck the item when it arrives, before signing the delivery slip.\n\nIf the slot does not suit you, reply to this email or call [phone] and we will change it.\n\nThank you,\n{{business}}',
      },
      whatsapp: {
        name: 'retail_delivery_update', category: 'UTILITY',
        body: 'Hi {{1}}, your {{2}} will be delivered on {{3}} 🚚\n\nOur team will call 30 minutes before arriving. Installation: {{4}}\n\nIf this time does not suit you, please reply here to change it.',
        vars: [fn, { fill: 'Item', example: '1.5 ton split AC' }, { fill: 'Delivery date and slot', example: 'Sat 9 Nov, 10 am–1 pm' }, { fill: 'Installation details', example: 'same day by our technician' }],
      },
      call: {
        goal: 'Confirm the delivery slot and the address',
        opening: 'Namaste {{customer_name}} ji, {{business_name}} se bol raha hoon. Aapka {{item}} kal deliver hona hai, bas time confirm karna tha.',
        script: [
          'Delivery {{delivery_date}} ko {{time_slot}} ke beech hogi.',
          'Humara team aane se pehle call karega.',
          'Installation bhi humari team karegi.',
          'Jagah aur power point ready rakhiyega.',
        ],
        questions: ['Kya yeh time aapke liye theek hai?', 'Kya address wahi hai jo bill par hai?', 'Building mein lift hai ya seedhi?'],
        objections: [
          { said: 'Kal ghar par koi nahi hoga', reply: 'Koi baat nahi. Aap jo din aur time bataiye, hum delivery wahi kar denge.' },
          { said: 'Installation alag din chahiye', reply: 'Ho jayega. Aap din bata dijiye, main technician ka slot book kar deta hoon.' },
        ],
        closing: 'Dhanyavaad {{customer_name}} ji. Slot confirm hai, delivery se pehle humara team call karega.',
        outcomes: ['confirmed', 'reschedule', 'address_change', 'callback', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'item', 'delivery_date', 'time_slot'],
      },
    },
    {
      id: 'retail-review-request', name: 'Google review request', goal: 'Get happy customers to leave a Google review', when: '3–7 days after a purchase or delivery',
      audience: { type: 'customers' },
      email: {
        subject: 'How was your experience at {{business}}, {{first_name}}?',
        body: 'Hi {{first_name}},\n\nThank you for shopping with us. We hope you are happy with your purchase.\n\nWe are a local store, and most new customers find us through Google. If you had a good experience, a short review would help other people in the area find us. It takes less than a minute:\n\n[review link]\n\nYou can write about whatever stood out: the staff, the choice, the price, or the delivery.\n\nIf something was not right, please tell us directly by replying to this email or calling [phone]. We would much rather fix it for you.\n\nThank you for your support.\n\nWarm regards,\n{{business}}',
      },
      whatsapp: {
        name: 'retail_review_request', category: 'MARKETING',
        body: 'Hi {{1}}, thank you for shopping with us 🙏\n\nIf you had a good experience, a quick Google review would really help other people nearby find us: {{2}}\n\nIf anything was not right, please reply here and we will sort it out.',
        vars: [fn, { fill: 'Review link', example: 'g.page/r/abc/review' }],
        footer: STOP,
      },
      call: {
        goal: 'Check the customer is happy and ask for a Google review',
        opening: 'Namaste {{customer_name}} ji, {{business_name}} se bol rahi hoon. Aapne haal hi mein humare yahan se khareedari ki thi, bas poochhna tha sab theek hai na?',
        script: [
          'Umeed hai product achha chal raha hai.',
          'Hum local store hain, aur naye log humein Google par dhoondhte hain.',
          'Agar aapko achha laga toh ek chhota sa review bahut madad karega.',
          'Main review ka link WhatsApp par bhej deti hoon.',
        ],
        questions: ['Product aur service kaisi lagi?', 'Kya koi dikkat hai jisme hum madad kar sakein?', 'Kya review link WhatsApp par bhej doon?'],
        objections: [
          { said: 'Review likhna nahi aata', reply: 'Bilkul aasaan hai. Link kholiye, stars dijiye, aur ek line likh dijiye. Bas itna hi.' },
          { said: 'Product mein dikkat hai', reply: 'Sorry ji. Mujhe dikkat bataiye, main abhi service team ko bolti hoon. Review ki koi baat nahi, pehle aapka kaam.' },
        ],
        closing: 'Dhanyavaad {{customer_name}} ji. Aapka saath hamare liye bahut maayne rakhta hai.',
        outcomes: ['will_review', 'reviewed', 'has_issue', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name'],
      },
    },
  ],

  // ───────────────────────── Traders / distributors / wholesalers ─────────────────────────
  distributor: [
    {
      id: 'dist-new-rate-list', name: 'New rate list', goal: 'Share the updated rate list with all accounts', when: 'When the company or you revise rates',
      audience: { type: 'all' },
      email: {
        subject: 'Updated rate list from [effective date], {{first_name}}',
        body: 'Hi {{first_name}},\n\nPlease find our updated rate list, effective from [effective date].\n\nRate list: [link]\n\nWhat has changed:\n\n[main changes]\n\nA few points to note:\n\nOrders booked before [effective date] will be billed at the old rates if delivered by [last delivery date].\n\nMRPs on the new stock are printed by the company; your margin on each item is shown in the list.\n\nSchemes running this month continue as announced.\n\nIf you would like to place an order at the current rates, reply to this email or tell our sales person on the next beat.\n\nThank you for your continued business.\n\nRegards,\n{{business}}',
      },
      whatsapp: {
        name: 'dist_new_rate_list', category: 'UTILITY',
        body: 'Namaste {{1}}, our rate list is updated from {{2}}.\n\nSee the new rates here: {{3}}\n\nOrders booked before that date are billed at the old rates. For any question, please reply to this message.',
        vars: [fn, { fill: 'Effective date', example: '1 December' }, { fill: 'Rate list link', example: 'example.in/rates' }],
      },
      call: {
        goal: 'Tell the account about the new rates and take any order at old rates',
        opening: 'Namaste {{customer_name}} ji, {{business_name}} se bol raha hoon. {{effective_date}} se naya rate list lag raha hai, uske baare mein batana tha.',
        script: [
          'Kuch items ke rate badle hain, poori list WhatsApp par bhej raha hoon.',
          '{{effective_date}} se pehle book kiye order purane rate par hi bill honge.',
          'Is mahine ki schemes waisi hi chalengi.',
          'Abhi order lagana ho toh quantity bata dijiye.',
        ],
        questions: ['Kya purane rate par kuch maal chahiye?', 'Kaunse items aapke yahan sabse zyada chal rahe hain?', 'Rate list kis number par bhejoon?'],
        objections: [
          { said: 'Rate bahut badh gaye', reply: 'Samajh sakta hoon. Rate company se badhe hain, isiliye pehle bata rahe hain taaki aap purane rate par stock le lein.' },
          { said: 'Dusra distributor kam rate de raha hai', reply: 'Ho sakta hai. Humari delivery aur credit bhi dekhiye. Kisi item par farak ho toh bata dijiye, main check karta hoon.' },
        ],
        closing: 'Dhanyavaad {{customer_name}} ji. Rate list WhatsApp par bhej raha hoon.',
        outcomes: ['order_at_old_rate', 'noted', 'send_rate_list', 'callback', 'unhappy', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'effective_date'],
      },
    },
    {
      id: 'dist-monthly-scheme', name: 'Monthly scheme for retailers', goal: 'Get accounts to order under this month’s scheme', when: 'In the first week of the month when a new scheme opens',
      audience: { type: 'customers' },
      email: {
        subject: 'This month’s scheme: [scheme], {{first_name}}',
        body: 'Hi {{first_name}},\n\nThis month’s scheme is now open.\n\nScheme: [scheme]\n\nOn products: [products]\n\nValid on orders till: [end date]\n\nHow you get it: [how the benefit is given, e.g. free goods on the same invoice or credit note at month end]\n\nSo there is no confusion later: the scheme comes from the company and applies only to invoices within the dates above. If the company changes it during the month, we will tell you straight away.\n\nTo book your order, reply to this email, send a WhatsApp to [phone], or tell our sales person on your beat day.\n\nRegards,\n{{business}}',
      },
      whatsapp: {
        name: 'dist_monthly_scheme', category: 'MARKETING',
        body: 'Namaste {{1}} 🎁 This month’s scheme is open: {{2}}\n\nValid on orders till {{3}}. Free goods or discount are shown on your invoice.\n\nReply with your order or tell our sales person on your beat day.',
        vars: [fn, { fill: 'Scheme', example: 'Buy 10 cases get 1 free on biscuits' }, { fill: 'Scheme end date', example: '25 Nov' }],
        footer: STOP,
      },
      call: {
        goal: 'Explain the scheme and book an order',
        opening: 'Namaste {{customer_name}} ji, {{business_name}} se bol rahi hoon. Is mahine ka scheme aa gaya hai, aapko batana tha.',
        script: [
          'Scheme hai {{scheme}}, aur {{end_date}} tak ke order par lagega.',
          'Free goods ya discount seedha bill par dikhega.',
          'Scheme company ka hai, agar badla toh hum turant batayenge.',
          'Aapka order abhi le leti hoon, beat wale din delivery ho jayegi.',
        ],
        questions: ['Is mahine kitne cases chahiye honge?', 'Scheme wale products aapke yahan kaise chal rahe hain?', 'Kya order abhi book kar doon?'],
        objections: [
          { said: 'Itna stock nahi bikta', reply: 'Samajh gayi. Toh jitna bikta hai utna hi lijiye, chhote slab par bhi kuch fayda hai.' },
          { said: 'Pichla credit note abhi tak nahi aaya', reply: 'Maafi chahti hoon. Main accounts se check karke aaj hi aapko update deti hoon.' },
        ],
        closing: 'Dhanyavaad {{customer_name}} ji. Scheme ki details WhatsApp par bhej rahi hoon.',
        outcomes: ['order_booked', 'interested', 'send_details', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'scheme', 'end_date'],
      },
    },
    {
      id: 'dist-new-stock-arrival', name: 'New stock / new product arrival', goal: 'Get accounts to stock a newly arrived product', when: 'When a new product or fresh stock of a short item arrives',
      audience: { type: 'customers' },
      email: {
        subject: 'Now in stock: [product], {{first_name}}',
        body: 'Hi {{first_name}},\n\nWe have received stock of [product], and we wanted to let you know.\n\nPack sizes: [pack sizes]\n\nMRP: [MRP]\n\nYour rate: [rate]\n\nIf this item was short in the market recently, the stock we have is limited, and we will supply in the order requests come in. We will not hold back stock to push the price up, and we will tell you honestly if a quantity is not available.\n\nIf it is a new product, we can give you a small quantity first so you can see how it sells in your area.\n\nTo book, reply to this email, send a WhatsApp to [phone], or tell our sales person on your next beat.\n\nRegards,\n{{business}}',
      },
      whatsapp: {
        name: 'dist_new_stock_arrival', category: 'MARKETING',
        body: 'Namaste {{1}} 📦 Now in stock with us: {{2}}\n\nYour rate: {{3}}\n\nWant a small quantity first to see how it sells? Reply with your order and we will deliver on your beat day.',
        vars: [fn, { fill: 'Product', example: 'Mustard oil 1 L pouch' }, { fill: 'Rate', example: '₹1,480 per case of 10' }],
        footer: STOP,
      },
      call: {
        goal: 'Tell the account about the new stock and take an order',
        opening: 'Namaste {{customer_name}} ji, {{business_name}} se bol raha hoon. {{product_name}} ka stock aa gaya hai, aapko batana tha.',
        script: [
          'Aapka rate {{rate}} hai.',
          'Agar naya product hai toh pehle chhoti quantity le kar dekh sakte hain.',
          'Delivery aapke beat wale din ho jayegi.',
          'Order abhi book kar doon?',
        ],
        questions: ['Kya aapke customers yeh item maang rahe the?', 'Kitne cases bhejoon?', 'Kya aur kuch saath mein chahiye?'],
        objections: [
          { said: 'Naya product, chalega nahi', reply: 'Bilkul sahi soch hai. Ek case le kar dekhiye, nahi chala toh agli baar mat lijiye.' },
          { said: 'Abhi jagah nahi hai dukaan mein', reply: 'Samajh gaya. Toh agle beat par bhej dete hain, main reminder ke liye note kar leta hoon.' },
        ],
        closing: 'Dhanyavaad {{customer_name}} ji. Order note kar liya hai, beat wale din delivery ho jayegi.',
        outcomes: ['order_booked', 'trial_quantity', 'interested', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'product_name', 'rate'],
      },
    },
    {
      id: 'dist-payment-reminder', name: 'Outstanding payment reminder', goal: 'Collect overdue bills politely and get a payment date', when: 'When a bill crosses its credit days',
      audience: { type: 'customers', tags: ['payment-due'] },
      email: {
        subject: 'Outstanding balance on your account: [amount]',
        body: 'Hi {{first_name}},\n\nThis is a friendly reminder about the outstanding balance on your account with us.\n\nTotal outstanding: [amount]\n\nOldest bill: [bill number], dated [bill date]\n\nAccount statement: [link]\n\nYou can pay by UPI to [UPI ID], by bank transfer, or by cheque to our sales person on your beat day.\n\nIf you have already paid, thank you, and please share the UTR or cheque number so we can update your account.\n\nIf any bill has a difference, a pending return or a scheme credit note, please tell us. We will settle that first.\n\nPlease note that new orders may be held once the credit limit is crossed, so clearing the old bills keeps your supply running smoothly.\n\nThank you for your business.\n\nRegards,\nAccounts team\n{{business}}',
      },
      whatsapp: {
        name: 'dist_payment_reminder', category: 'UTILITY',
        body: 'Namaste {{1}}, a reminder that {{2}} is outstanding on your account, oldest bill dated {{3}}.\n\nPlease pay by UPI, bank transfer or cheque on your beat day. If you have already paid, kindly share the UTR or cheque number so we can update your account.',
        vars: [fn, { fill: 'Outstanding amount', example: '₹48,250' }, { fill: 'Oldest bill date', example: '12 Oct' }],
      },
      call: {
        goal: 'Get a payment date for the outstanding balance',
        opening: 'Namaste {{customer_name}} ji, {{business_name}} ke accounts se bol rahi hoon. Aapke account ke baaki payment ke baare mein baat karni thi.',
        script: [
          'Aapke account par {{amount}} baaki hai.',
          'Statement WhatsApp par bhej deti hoon.',
          'Agar kisi bill mein farak hai ya return pending hai toh bataiye, pehle woh settle kar lete hain.',
          'Limit cross hone par naye order ruk sakte hain, isliye bata rahi hoon.',
        ],
        questions: ['Payment kab tak ho sakti hai?', 'Kya kisi bill mein dikkat hai?', 'Cheque beat par denge ya UPI karenge?'],
        objections: [
          { said: 'Market mein paisa atka hai', reply: 'Samajh sakti hoon. Kya abhi kuch part payment ho sakti hai, aur baaki ki ek date bata dijiye?' },
          { said: 'Return ka credit nahi mila', reply: 'Main abhi check karti hoon. Return ka credit dekar baaki amount bata deti hoon.' },
          { said: 'Payment ho chuki hai', reply: 'Shukriya! UTR ya cheque number bata dijiye, main account update karwa deti hoon.' },
        ],
        closing: 'Dhanyavaad {{customer_name}} ji. Payment date note kar li hai, statement WhatsApp par bhej rahi hoon.',
        outcomes: ['payment_promised', 'part_payment', 'already_paid', 'dispute', 'callback', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'amount'],
      },
    },
    {
      id: 'dist-order-dispatched', name: 'Order confirmation / dispatch', goal: 'Confirm the order and when it will reach the account', when: 'When an order is booked or loaded for delivery',
      audience: { type: 'customers' },
      email: {
        subject: 'Order [order number] confirmed: delivery on [delivery date]',
        body: 'Hi {{first_name}},\n\nThank you for your order. Here are the details:\n\nOrder number: [order number]\n\nItems: [items]\n\nBill amount: [amount]\n\nDelivery: [delivery date], on our [beat / vehicle]\n\nThe bill is here: [link]\n\nWhen the goods arrive, please check the cases against the bill before signing. If anything is short or damaged, write it on the delivery copy and send us a photo on WhatsApp at [phone], and we will adjust it on the next beat.\n\nIf you want to add something to this order, reply before [cut-off time] and we will load it on the same trip.\n\nRegards,\n{{business}}',
      },
      whatsapp: {
        name: 'dist_order_dispatched', category: 'UTILITY',
        body: 'Namaste {{1}}, your order {{2}} is confirmed ✅\n\nBill amount: {{3}}\nDelivery: {{4}}\n\nPlease check the cases against the bill before signing. If anything is short or damaged, reply here with a photo.',
        vars: [fn, { fill: 'Order number', example: 'SO-4417' }, { fill: 'Bill amount', example: '₹23,640' }, { fill: 'Delivery date', example: 'Thursday, 14 Nov' }],
      },
      call: {
        goal: 'Confirm the order and delivery day',
        opening: 'Namaste {{customer_name}} ji, {{business_name}} se bol raha hoon. Aapka order {{order_number}} confirm ho gaya hai.',
        script: [
          'Delivery {{delivery_date}} ko hogi.',
          'Bill ki copy WhatsApp par bhej di hai.',
          'Maal aane par cases gin lijiye, kuch kam ho toh delivery copy par likh dijiye.',
          'Kuch aur add karna ho toh abhi bata dijiye, usi gaadi mein aa jayega.',
        ],
        questions: ['Kya kuch aur add karna hai?', 'Delivery ke time dukaan par kaun hoga?'],
        objections: [
          { said: 'Delivery jaldi chahiye', reply: 'Main dispatch team se baat karke dekhta hoon ki pehle wali gaadi mein ho sakta hai ya nahi, aapko batata hoon.' },
          { said: 'Ek item kam karna hai', reply: 'Ho jayega. Item aur quantity bata dijiye, main bill update kar deta hoon.' },
        ],
        closing: 'Dhanyavaad {{customer_name}} ji. Order confirm hai, delivery {{delivery_date}} ko.',
        outcomes: ['confirmed', 'add_items', 'change_order', 'callback', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'order_number', 'delivery_date'],
      },
    },
    {
      id: 'dist-festive-bulk-order', name: 'Festive bulk order booking', goal: 'Get accounts to book festive stock early', when: '3–4 weeks before Diwali, Eid, Pongal or the wedding season',
      audience: { type: 'customers' },
      email: {
        subject: 'Book your festive stock early, {{first_name}}',
        body: 'Hi {{first_name}},\n\nThe festive season is a few weeks away, and demand for [products] goes up every year around this time.\n\nWe are taking advance bookings for festive stock now, so we can plan supply with the company and deliver to you on time.\n\nWhy book early:\n\nYou get the quantity you need, delivered in [weeks] before the festival.\n\nThe current festive scheme applies: [scheme].\n\nWe can split the delivery into two lots so you do not have to block all your money and space at once.\n\nWe will not promise quantities we cannot supply. If the company limits stock, we will tell you right away.\n\nTo book, reply to this email, send a WhatsApp to [phone], or tell our sales person on your beat day.\n\nWishing you a good festive season.\n\nRegards,\n{{business}}',
      },
      whatsapp: {
        name: 'dist_festive_bulk_order', category: 'MARKETING',
        body: 'Namaste {{1}} 🪔 Festive demand is coming up. Book your festive stock now so we can deliver on time.\n\nScheme on festive orders: {{2}}\nLast date to book: {{3}}\n\nWe can split delivery into two lots. Reply with your order and our sales person will confirm.',
        vars: [fn, { fill: 'Festive scheme', example: '2% extra on 50+ cases' }, { fill: 'Booking end date', example: '20 Oct' }],
        footer: STOP,
      },
      call: {
        goal: 'Book the account’s festive stock in advance',
        opening: 'Namaste {{customer_name}} ji, {{business_name}} se bol rahi hoon. Tyohaar aane wale hain, festive stock ki booking ke liye call kiya hai.',
        script: [
          'Har saal is samay {{products}} ki demand badh jaati hai.',
          'Abhi booking karenge toh time par maal pahunch jayega.',
          'Festive order par {{scheme}} mil raha hai.',
          'Delivery do hisson mein bhi kar sakte hain.',
        ],
        questions: ['Pichle saal tyohaar par kitna maal laga tha?', 'Ek baar mein lenge ya do lot mein?', 'Kya booking abhi kar doon?'],
        objections: [
          { said: 'Abhi paisa block nahi karna', reply: 'Samajh sakti hoon. Isliye do lot mein delivery ka option hai, payment bhi usi hisaab se.' },
          { said: 'Baad mein le lenge', reply: 'Theek hai. Bas dhyan rahe ki tyohaar ke paas company stock limit kar deti hai. Main {{end_date}} se pehle ek baar phir call kar loon?' },
        ],
        closing: 'Dhanyavaad {{customer_name}} ji. Booking note kar li hai, details WhatsApp par bhej rahi hoon.',
        outcomes: ['booked', 'split_delivery', 'interested', 'callback', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'products', 'scheme', 'end_date'],
      },
    },
    {
      id: 'dist-reactivate-account', name: 'Reactivate inactive accounts', goal: 'Win back accounts that have stopped ordering', when: 'When an account has not ordered for 60 days or more',
      audience: { type: 'customers', tags: ['inactive-60'] },
      email: {
        subject: 'We have not seen your order in a while, {{first_name}}',
        body: 'Hi {{first_name}},\n\nWe noticed you have not placed an order with us for a while, and we wanted to check in.\n\nIf something went wrong, a late delivery, a short supply, a rate issue or a pending credit note, we would really like to know. Just reply to this email. It reaches the owner directly.\n\nSome things that may be useful to you now:\n\nOur current rate list: [link]\n\nThis month’s scheme: [scheme]\n\nWe now deliver to [area] on [beat day].\n\nIf you would like to restart, even with a small order, reply here or send a WhatsApp to [phone], and our sales person will visit on your beat day.\n\nRegards,\n{{business}}',
      },
      whatsapp: {
        name: 'dist_reactivate_account', category: 'MARKETING',
        body: 'Namaste {{1}}, we have not received your order in a while and wanted to check in 🙏\n\nIf something went wrong with supply, rates or credit, please tell us and we will fix it. This month’s scheme: {{2}}\n\nReply HI and our sales person will visit on your beat day.',
        vars: [fn, { fill: 'Scheme', example: '5% off on your first order back' }],
        footer: STOP,
      },
      call: {
        goal: 'Find out why the account stopped ordering and restart supply',
        opening: 'Namaste {{customer_name}} ji, {{business_name}} se bol raha hoon. Kaafi samay se aapka order nahi aaya, toh haal-chaal poochhna tha.',
        script: [
          'Agar delivery, rate ya credit mein koi dikkat hui ho toh seedha bata dijiye.',
          'Main aapki baat owner tak pahunchaunga.',
          'Is mahine ka scheme hai {{scheme}}.',
          'Chhote order se bhi phir shuru kar sakte hain.',
        ],
        questions: ['Humse order band karne ki koi khaas wajah thi?', 'Aajkal maal kahan se le rahe hain?', 'Kya sales person ko visit ke liye bhejoon?'],
        objections: [
          { said: 'Delivery time par nahi aati thi', reply: 'Maafi chahta hoon. Ab beat fix hai, aur main aapka order khud track karunga. Ek mauka dijiye.' },
          { said: 'Dusra distributor zyada credit deta hai', reply: 'Samajh gaya. Aapka payment record dekh ke main credit limit ke liye baat kar sakta hoon.' },
          { said: 'Dukaan band kar di', reply: 'Achha, bataane ke liye shukriya. Main record update kar deta hoon.' },
        ],
        closing: 'Dhanyavaad {{customer_name}} ji. Aapki baat note kar li hai, details WhatsApp par bhej raha hoon.',
        outcomes: ['will_order', 'visit_requested', 'feedback_given', 'shop_closed', 'not_interested', 'wrong_number'],
        variables: ['customer_name', 'business_name', 'scheme'],
      },
    },
  ],
};
