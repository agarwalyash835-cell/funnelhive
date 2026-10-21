// The built-in words on funnel pages (form placeholders, checkout, booking, consent) in the funnel's language.
// Everything the seller writes is already in their own words; this covers the rest. Add a language by adding a
// dictionary below — missing phrases fall back to English.
export const LANGS = [['en', 'English'], ['hi', 'हिन्दी (Hindi)']];

const hi = {
  'Full name': 'पूरा नाम', Email: 'ईमेल', 'WhatsApp number': 'व्हाट्सऐप नंबर', 'e.g. Priya Sharma': 'जैसे प्रिया शर्मा',
  'Business name': 'व्यवसाय का नाम', 'GSTIN (15 characters)': 'GSTIN (15 अक्षर)', 'House / flat, street': 'मकान / फ़्लैट, गली',
  'Area, landmark (optional)': 'इलाका, लैंडमार्क (वैकल्पिक)', City: 'शहर', State: 'राज्य', 'PIN code': 'पिन कोड',
  'Coupon code': 'कूपन कोड', Apply: 'लागू करें', 'Have a coupon code?': 'कूपन कोड है?', 'Buying for a business? Add your GSTIN': 'व्यवसाय के लिए खरीद रहे हैं? अपना GSTIN जोड़ें',
  'Pay online': 'ऑनलाइन भुगतान', 'UPI · cards · netbanking': 'UPI · कार्ड · नेटबैंकिंग', 'Cash on Delivery': 'कैश ऑन डिलीवरी', 'Cash on Delivery fee': 'कैश ऑन डिलीवरी शुल्क',
  'Pay when it arrives': 'सामान मिलने पर भुगतान करें', Delivery: 'डिलीवरी', FREE: 'मुफ़्त', Total: 'कुल', 'Due today': 'आज देय', 'Pay in full': 'पूरा भुगतान', 'best value': 'सबसे किफ़ायती',
  '{n} monthly payments': '{n} मासिक किस्तें', '{amount}/month · auto-debit': '{amount}/माह · ऑटो-डेबिट', 'Pay Securely': 'सुरक्षित भुगतान करें', 'Processing…': 'प्रोसेस हो रहा है…',
  'Place order · pay {amount} on delivery': 'ऑर्डर करें · डिलीवरी पर {amount} दें', 'Subscribe · {amount}/{per}': 'सब्सक्राइब करें · {amount}/{per}', month: 'माह', year: 'वर्ष', ' today': ' आज',
  'Renews every {per} until you cancel — cancel any time from your library link.': 'रद्द करने तक हर {per} रिन्यू होता है — अपनी लाइब्रेरी लिंक से कभी भी रद्द करें।',
  'Please wait…': 'कृपया प्रतीक्षा करें…', 'Choose your session': 'अपना सेशन चुनें', 'Loading available times…': 'उपलब्ध समय लोड हो रहे हैं…',
  'Anything we should know before the call? (optional)': 'कॉल से पहले हमें कुछ बताना चाहेंगे? (वैकल्पिक)', 'Confirm my call': 'मेरी कॉल पक्की करें', 'Booking…': 'बुक हो रहा है…',
  'Pay {amount} & confirm': '{amount} दें और पक्का करें', 'Your call is booked ✅': 'आपकी कॉल बुक हो गई ✅', 'Joining link': 'जॉइन लिंक', 'Add to Google Calendar ↗': 'Google Calendar में जोड़ें ↗',
  'Reschedule or cancel': 'समय बदलें या रद्द करें', 'No times are free right now — please check back soon or message us on WhatsApp.': 'अभी कोई समय खाली नहीं है — कृपया बाद में देखें या हमें व्हाट्सऐप करें।',
  'No thanks, I’ll pay full price': 'नहीं, मैं पूरी कीमत दूँगा', Terms: 'नियम और शर्तें', 'Refund Policy': 'रिफ़ंड नीति', 'Privacy Policy': 'गोपनीयता नीति',
  'By paying you agree to the': 'भुगतान करके आप इनसे सहमत हैं:', and: 'और', Submit: 'भेजें', 'Sending…': 'भेजा जा रहा है…', 'Choose…': 'चुनें…',
  'Thank you! We’ll be in touch shortly.': 'धन्यवाद! हम जल्द ही संपर्क करेंगे।', '👉 Yes!': '👉 हाँ!', '⏳ This offer expires in': '⏳ यह ऑफ़र समाप्त होगा',
  'We use cookies to measure our ads and improve this page.': 'हम अपने विज्ञापनों को मापने और इस पेज को बेहतर बनाने के लिए कुकीज़ का उपयोग करते हैं।', Reject: 'अस्वीकार', Accept: 'स्वीकार',
  Hours: 'घंटे', Minutes: 'मिनट', Seconds: 'सेकंड', Days: 'दिन', from: 'से', '{n} mins ago': '{n} मिनट पहले', '{n} min ago': '{n} मिनट पहले', Verified: 'सत्यापित',
  'Payment cancelled — you can try again whenever you’re ready': 'भुगतान रद्द हुआ — जब चाहें दोबारा कोशिश करें', 'Payment could not be completed — please try again': 'भुगतान पूरा नहीं हो सका — कृपया दोबारा कोशिश करें',
};
hi['Cookie settings'] = 'कुकी सेटिंग्स';
const DICT = { hi };

// tr(lang, 'Pay {amount} & confirm', { amount: '₹1,499' })
export function tr(lang, s, vars) {
  let out = (lang && DICT[lang]?.[s]) || s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return out;
}
