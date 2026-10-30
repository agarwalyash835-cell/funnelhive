// The storefront's own labels in English and Hindi (the buyer picks; the seller's content stays as written).
// label(lang, key, vars) → text; a missing Hindi label falls back to English.
const en = {
  search: 'Search', searchPh: 'Search products', cart: 'Cart', bag: 'Bag', addToCart: 'Add to cart', addToBag: 'Add to bag', add: 'Add', soldOut: 'Sold out',
  onlyLeft: 'Only {n} left', viewCart: 'View cart', items: '{n} items', item: '1 item', all: 'All', shopNow: 'Shop now', shopAll: 'Shop all', categories: 'Shop by category',
  newArrivals: 'New arrivals', justDropped: 'Just dropped', bestsellers: 'Bestsellers', trending: 'Trending now', allProducts: 'All products', allStyles: 'All styles',
  sortFeatured: 'Featured', sortLow: 'Price: low to high', sortHigh: 'Price: high to low', sortName: 'Name', noProducts: 'No products found.', off: '{n}% off',
  inclTax: 'Inclusive of all taxes', instant: 'Instant download', checkPin: 'Check delivery', pinPh: 'Enter PIN code', check: 'Check', deliversTo: 'Delivers to {s}',
  delivers: 'Delivery available', codYes: 'Cash on Delivery available', codNo: 'Pay online for this PIN code', sizes: 'Sizes', sizeNote: 'Available sizes — mention yours on WhatsApp if unsure',
  highlights: 'Highlights', specs: 'Key specs', benefits: 'Key ingredients & benefits', description: 'Description', youMayLike: 'You may also like',
  routine: 'Build your routine', routineSub: 'The three steps that work best together', addRoutine: 'Add all {n} · {p}', completeLook: 'Complete the look',
  compare: 'Compare', compareSub: 'Side by side — pick what suits you', lookbook: 'The lookbook', look: 'Look {n}', offers: 'Offers for you', copy: 'Copy', copied: 'Copied',
  trustTitle: 'Why shop with us', cod: 'Cash on Delivery', codSub: 'Pay when it arrives', upi: 'UPI & cards', upiSub: 'GPay, PhonePe, Paytm, cards', secure: 'Secure checkout',
  secureSub: 'Encrypted payments', support: 'WhatsApp support', supportSub: 'Talk to a real person', chat: 'Chat on WhatsApp', askWa: 'Hi! I have a question about {p}',
  about: 'About us', help: 'Help', shop: 'Shop', refund: 'Refunds', shipping: 'Shipping', terms: 'Terms', privacy: 'Privacy', contact: 'Contact',
  freeAbove: 'Free delivery above {p}', freeDelivery: 'Free delivery', fastDelivery: 'Fast delivery', returns7: '7-day returns', exchange: 'Easy exchange', warranty: 'Brand warranty',
  emi: 'No-cost EMI', authentic: '100% genuine', crueltyFree: 'Cruelty-free', fresh: 'Farm fresh', handmade: 'Handmade',
  preview: 'Preview — this store isn’t open yet, so nothing can be bought.', demo: 'This is a demo store made with FunnelHive — nothing here is for sale.',
  demoCta: 'Start your own store', demoCheckout: 'Checkout is switched off in this demo. Your own store takes UPI, cards and COD.', reviews: '{n} ratings',
  draft: 'Draft — not shown to buyers until you review it', back: 'Back to shop', newDrop: 'New drop', madeWith: 'Store by FunnelHive', menu: 'Menu', home: 'Home',
  inCart: 'In cart', added: 'Added to {c}', deliveryTo: 'Deliver to', perUnit: 'per {u}', emiFrom: 'EMI from {p}/mo',
  // toys, sports, hardware, crafts, D2C brand
  allToys: 'All toys', allGear: 'All gear', allMaterials: 'All materials', allCrafts: 'All crafts', shopRange: 'Shop the range', builtFor: 'Built for Indian conditions',
  shopByAge: 'Shop by age', shopByCraft: 'Shop by craft', ageChip: '{a} yrs', nProducts: '{n} products', popularTags: 'Popular picks',
  bis: 'BIS certified', giftWrap: 'Free gift wrap', heatReady: 'Made for 40 °C+ heat', monsoonReady: 'Monsoon-ready', gstInvoice: 'GST invoice', bulkRates: 'Bulk & contractor rates', handloom: 'Handloom mark', subscribe: 'Subscribe & save',
  giftNote: 'Gift wrap with a handwritten note is free — tell us the message at checkout or on WhatsApp.', safetyNote: 'Safety tested and BIS certified, with non-toxic paints and no small loose parts for under-3s.',
  sizeGuide: 'Size guide: between two sizes? Pick the larger one, or tell us your usual size on WhatsApp and we’ll help.', bulkNote: 'Buying for a site? Contractors and bulk buyers get special rates — ask for a quote.',
  handloomNote: 'Handloom: woven by hand on a loom, so small irregularities are the mark of the maker, not a flaw.', handmadeNote: 'Handmade in small batches — colours and patterns vary a little from piece to piece.',
  subscribeNote: 'Subscribe & save — get it every month at a lower price. Message us on WhatsApp to set it up; pause any time.',
  bulkTitle: 'Bulk & contractor orders', bulkCta: 'Request a quote on WhatsApp', bulkAsk: 'Hi! I need a bulk quote for: ', bulkQuote: 'Bulk quote', demoWa: 'In your own store this opens WhatsApp with the buyer’s list.',
  madeBy: 'Made by {m}', makers: 'Meet the makers', makersSub: 'Every piece carries the name of the hands that made it', seeWork: 'See their work', handloomSeal: 'Handloom', bisMark: 'BIS',
  benefitsTitle: 'Why you’ll love it', howItWorks: 'How it works', versusTitle: '{s} vs the regular kind', ours: 'Ours', regular: 'Regular', reviewsTitle: 'What customers say', seeDetails: 'See details', specSheet: 'Specifications',
};
const hi = {
  search: 'खोजें', searchPh: 'प्रोडक्ट खोजें', cart: 'कार्ट', bag: 'बैग', addToCart: 'कार्ट में डालें', addToBag: 'बैग में डालें', add: 'जोड़ें', soldOut: 'स्टॉक ख़त्म',
  onlyLeft: 'सिर्फ़ {n} बचे', viewCart: 'कार्ट देखें', items: '{n} आइटम', item: '1 आइटम', all: 'सभी', shopNow: 'अभी ख़रीदें', shopAll: 'सब देखें', categories: 'कैटेगरी',
  newArrivals: 'नया आया', justDropped: 'अभी-अभी आया', bestsellers: 'सबसे ज़्यादा बिकने वाले', trending: 'ट्रेंडिंग', allProducts: 'सभी प्रोडक्ट', allStyles: 'सभी स्टाइल',
  sortFeatured: 'ख़ास', sortLow: 'कीमत: कम से ज़्यादा', sortHigh: 'कीमत: ज़्यादा से कम', sortName: 'नाम', noProducts: 'कोई प्रोडक्ट नहीं मिला।', off: '{n}% छूट',
  inclTax: 'सभी टैक्स शामिल', instant: 'तुरंत डाउनलोड', checkPin: 'डिलीवरी चेक करें', pinPh: 'पिन कोड डालें', check: 'चेक करें', deliversTo: '{s} में डिलीवरी',
  delivers: 'डिलीवरी उपलब्ध', codYes: 'कैश ऑन डिलीवरी उपलब्ध', codNo: 'इस पिन कोड पर ऑनलाइन भुगतान करें', sizes: 'साइज़', sizeNote: 'उपलब्ध साइज़ — शक हो तो WhatsApp पर पूछें',
  highlights: 'ख़ास बातें', specs: 'मुख्य स्पेसिफ़िकेशन', benefits: 'मुख्य सामग्री और फ़ायदे', description: 'विवरण', youMayLike: 'ये भी पसंद आ सकते हैं',
  routine: 'अपना रूटीन बनाएँ', routineSub: 'तीन स्टेप जो साथ में सबसे अच्छा काम करते हैं', addRoutine: 'सभी {n} जोड़ें · {p}', completeLook: 'पूरा लुक',
  compare: 'तुलना करें', compareSub: 'साथ-साथ देखें — जो सही लगे चुनें', lookbook: 'लुकबुक', look: 'लुक {n}', offers: 'आपके लिए ऑफ़र', copy: 'कॉपी', copied: 'कॉपी हो गया',
  trustTitle: 'हमसे क्यों ख़रीदें', cod: 'कैश ऑन डिलीवरी', codSub: 'सामान मिलने पर भुगतान', upi: 'UPI और कार्ड', upiSub: 'GPay, PhonePe, Paytm, कार्ड', secure: 'सुरक्षित चेकआउट',
  secureSub: 'एन्क्रिप्टेड भुगतान', support: 'WhatsApp सहायता', supportSub: 'असली इंसान से बात करें', chat: 'WhatsApp पर बात करें', askWa: 'नमस्ते! मुझे {p} के बारे में पूछना है',
  about: 'हमारे बारे में', help: 'मदद', shop: 'दुकान', refund: 'रिफ़ंड', shipping: 'शिपिंग', terms: 'शर्तें', privacy: 'प्राइवेसी', contact: 'संपर्क',
  freeAbove: '{p} से ऊपर मुफ़्त डिलीवरी', freeDelivery: 'मुफ़्त डिलीवरी', fastDelivery: 'तेज़ डिलीवरी', returns7: '7 दिन में वापसी', exchange: 'आसान एक्सचेंज', warranty: 'ब्रांड वारंटी',
  emi: 'बिना ब्याज EMI', authentic: '100% असली', crueltyFree: 'क्रूरता-मुक्त', fresh: 'ताज़ा', handmade: 'हाथ से बना',
  preview: 'प्रीव्यू — यह स्टोर अभी खुला नहीं है, इसलिए कुछ ख़रीदा नहीं जा सकता।', demo: 'यह FunnelHive से बना डेमो स्टोर है — यहाँ कुछ बिक्री के लिए नहीं है।',
  demoCta: 'अपना स्टोर शुरू करें', demoCheckout: 'इस डेमो में चेकआउट बंद है। आपका अपना स्टोर UPI, कार्ड और COD लेता है।', reviews: '{n} रेटिंग',
  draft: 'ड्राफ़्ट — रिव्यू करने तक ख़रीदारों को नहीं दिखेगा', back: 'दुकान पर वापस', newDrop: 'नया', madeWith: 'FunnelHive पर बना स्टोर', menu: 'मेन्यू', home: 'होम',
  inCart: 'कार्ट में', added: '{c} में जोड़ा गया', deliveryTo: 'डिलीवरी', perUnit: 'प्रति {u}', emiFrom: '{p}/माह से EMI',
  allToys: 'सभी खिलौने', allGear: 'सारा सामान', allMaterials: 'सारा माल', allCrafts: 'सभी हस्तशिल्प', shopRange: 'पूरी रेंज देखें', builtFor: 'भारतीय मौसम के लिए बना',
  shopByAge: 'उम्र के हिसाब से', shopByCraft: 'कला के हिसाब से', ageChip: '{a} साल', nProducts: '{n} प्रोडक्ट', popularTags: 'लोकप्रिय',
  bis: 'BIS प्रमाणित', giftWrap: 'मुफ़्त गिफ़्ट रैप', heatReady: '40 °C+ गर्मी के लिए', monsoonReady: 'मानसून के लिए तैयार', gstInvoice: 'GST बिल', bulkRates: 'थोक और ठेकेदार रेट', handloom: 'हैंडलूम मार्क', subscribe: 'सब्सक्राइब करें, बचाएँ',
  giftNote: 'हाथ से लिखे नोट के साथ गिफ़्ट रैप मुफ़्त है — चेकआउट या WhatsApp पर संदेश बताएँ।', safetyNote: 'सुरक्षा जाँचा हुआ और BIS प्रमाणित, बिना ज़हरीले रंग, 3 साल से छोटे बच्चों के लिए कोई ढीला छोटा हिस्सा नहीं।',
  sizeGuide: 'साइज़ गाइड: दो साइज़ के बीच हों तो बड़ा चुनें, या WhatsApp पर अपना साइज़ बताएँ — हम मदद करेंगे।', bulkNote: 'साइट के लिए ख़रीद रहे हैं? ठेकेदारों और थोक ख़रीदारों को ख़ास रेट — कोटेशन माँगें।',
  handloomNote: 'हैंडलूम: करघे पर हाथ से बुना हुआ, इसलिए छोटे-मोटे फ़र्क़ कारीगर की पहचान हैं, कमी नहीं।', handmadeNote: 'छोटे बैच में हाथ से बना — हर पीस के रंग और डिज़ाइन में थोड़ा फ़र्क़ होता है।',
  subscribeNote: 'सब्सक्राइब करें और बचाएँ — हर महीने कम दाम पर पाएँ। WhatsApp पर मैसेज करें; कभी भी रोकें।',
  bulkTitle: 'थोक और ठेकेदार ऑर्डर', bulkCta: 'WhatsApp पर कोटेशन माँगें', bulkAsk: 'नमस्ते! मुझे इनका थोक रेट चाहिए: ', bulkQuote: 'थोक रेट', demoWa: 'आपके अपने स्टोर में यह ख़रीदार की लिस्ट के साथ WhatsApp खोलता है।',
  madeBy: '{m} द्वारा बना', makers: 'कारीगरों से मिलें', makersSub: 'हर पीस पर उसे बनाने वाले हाथों का नाम', seeWork: 'इनका काम देखें', handloomSeal: 'हैंडलूम', bisMark: 'BIS',
  benefitsTitle: 'आपको क्यों पसंद आएगा', howItWorks: 'कैसे काम करता है', versusTitle: '{s} बनाम आम प्रोडक्ट', ours: 'हमारा', regular: 'आम', reviewsTitle: 'ग्राहक क्या कहते हैं', seeDetails: 'पूरी जानकारी', specSheet: 'स्पेसिफ़िकेशन',
};
export const LABELS = { en, hi };
export const LANGS = [['en', 'EN'], ['hi', 'हिं']];
export function label(lang, key, vars) {
  let s = (LABELS[lang] || en)[key] ?? en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}
