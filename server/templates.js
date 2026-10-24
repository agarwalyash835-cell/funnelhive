import { uid } from './db.js';
import { CAT, X, LOOK, GENERIC_QUOTES, LADDER, shiftHue } from './template-kit.js';
import { VSL } from './templates-vsl.js';
import { WEBINARS } from './templates-webinar.js';
import { QUIZZES, buildQuiz } from './templates-quiz.js';
import { buildVsl, buildWebinar } from './template-funnels.js';
import { websiteSteps, WEBSITE_TEMPLATES } from './website.js';

const CITIES = ['Mumbai', 'Delhi', 'Bengaluru', 'Pune', 'Hyderabad', 'Chennai', 'Kolkata', 'Jaipur', 'Ahmedabad', 'Lucknow', 'Indore', 'Chandigarh', 'Surat', 'Nagpur', 'Kochi', 'Bhopal', 'Patna', 'Coimbatore'];
const NAMES = ['Rahul S.', 'Priya M.', 'Ankit P.', 'Sneha R.', 'Vikram J.', 'Anjali K.', 'Rohit D.', 'Neha G.', 'Arjun V.', 'Pooja T.', 'Karan B.', 'Divya N.', 'Aman C.', 'Kavya L.', 'Imran Q.', 'Simran K.', 'Suresh R.', 'Meera I.'];

// [id, category, product, color, price, mrp, headline, subheadline, features[], quotes[], faqs[], emoji badge]
const N = [
  ['upsc', 'Education', 'UPSC Foundation Batch 2027', '#1d4ed8', 4999, 19999, 'Crack UPSC in your first attempt with mentors who cleared it', 'Daily answer writing, weekly tests and a personal mentor — in Hindi & English.', ['Complete GS + CSAT coverage|Structured 12-month plan, no confusion', 'Daily answer-writing practice|Evaluated by ex-civil servants', 'Weekly mock tests|All-India rank & analysis', 'Personal mentor|1-on-1 doubt calls every week'], ['Aditi S., Delhi|Mentor feedback on my answers lifted my score by 40 marks.', 'Rohan K., Lucknow|The weekly tests kept me honest. Cleared Prelims!'], ['Is it in Hindi?|Yes — live classes in Hindi and English, notes in both.', 'Can I watch recordings?|Yes, all classes are recorded and available lifetime.'], '🏆 India\'s trusted UPSC mentors'],
  ['neet', 'Education', 'NEET 2027 Crash Course', '#dc2626', 2999, 11999, 'Score 600+ in NEET — the 90-day plan toppers actually follow', 'High-yield NCERT revision, 5,000+ MCQs and daily doubt solving.', ['NCERT line-by-line revision|Biology, Physics & Chemistry', '5,000+ practice MCQs|Chapter-wise and full-length', 'Daily live doubt sessions|Ask anything, get answers fast', 'Rank predictor tests|Know exactly where you stand'], ['Ananya P., Kota|Biology went from 280 to 330 in 6 weeks.', 'Mohit R., Patna|Doubt sessions saved me — worth every rupee.'], ['Is it for droppers too?|Yes, built for both 12th students and droppers.', 'Do I get study material?|Yes — PDFs and test series included.'], '🩺 For serious NEET aspirants'],
  ['jee', 'Education', 'JEE Main + Advanced Mastery', '#7c3aed', 3499, 14999, 'Top IIT rank starts with the right strategy — not more hours', 'Concept-first video lessons, PYQs and adaptive tests by IITian faculty.', ['IITian faculty|Concepts explained from first principles', '10 years of PYQs solved|Pattern-wise strategy', 'Adaptive test series|Weak topics auto-identified', 'Doubt app access|Answers within 30 minutes'], ['Siddharth J., Hyderabad|Physics finally clicked. 98.6 percentile!', 'Kavya N., Chennai|PYQ strategy was a game changer.'], ['Which class is this for?|Class 11, 12 and droppers.', 'English or Hindi?|Both — choose your medium.'], '🚀 IITian-led learning'],
  ['spokenenglish', 'Education', 'Spoken English in 30 Days', '#0ea5e9', 699, 2999, 'Speak fluent English confidently — even if you are shy today', 'Live practice with a coach, daily speaking tasks and Hindi-to-English support.', ['Live speaking practice|Small batches of 10 learners', 'Hindi explanations|Learn without fear of mistakes', 'Interview & office English|Real-life situations', 'Certificate on completion|Share on LinkedIn'], ['Ramesh T., Jaipur|I gave my first English presentation at work!', 'Pooja V., Indore|Group practice removed my hesitation.'], ['I am a total beginner. Is that okay?|Absolutely, we start from basics.', 'How long are classes?|45 minutes daily, live on Zoom.'], '🗣 Trusted by 1 lakh+ learners'],
  ['ca', 'Education', 'CA Foundation Complete Prep', '#0f766e', 3999, 12999, 'Clear CA Foundation in the first attempt with AIR rank holders', 'Chapter-wise lectures, ICAI-pattern tests and revision marathons.', ['Full syllabus lectures|Accounts, Law, Maths & Economics', 'ICAI-pattern mock papers|Real exam experience', 'Revision marathon|Last-30-day rapid revision', 'Printed notes shipped|Delivered across India'], ['Harsh G., Surat|Accounts finally made sense.', 'Nidhi A., Mumbai|Cleared with 68% — thank you team!'], ['Will I get printed books?|Yes, shipped free anywhere in India.', 'Is a doubt group available?|Yes, a private Telegram group.'], '📚 AIR rank holder faculty'],
  ['coding', 'Education', 'Full-Stack Developer Bootcamp', '#2563eb', 7999, 29999, 'Become a job-ready developer in 6 months — Hindi + English', 'Build 8 real projects, get a resume review and placement support.', ['8 real-world projects|Portfolio recruiters notice', 'Mentor code reviews|Learn industry practices', 'Placement support|Mock interviews & referrals', 'EMI available|Starting ₹1,333/month'], ['Aakash L., Bengaluru|Got my first dev job at 8 LPA.', 'Shreya D., Pune|Projects made my resume stand out.'], ['Do I need coding experience?|No — we start from zero.', 'Is placement guaranteed?|We provide full support; results depend on effort.'], '💻 4.8★ by 10,000+ learners'],
  ['excel', 'Education', 'Excel & Power BI Masterclass', '#16a34a', 599, 2499, 'Master Excel & Power BI and get a salary hike this year', 'Formulas, dashboards and automation taught with real office examples.', ['Formulas to Pivot Tables|Beginner to advanced', 'Power BI dashboards|Impress your manager', 'Real office datasets|Learn by doing', 'Completion certificate|Add to your resume'], ['Deepak M., Nagpur|Automated my weekly report — saves 5 hours!', 'Swati R., Kolkata|Got promoted after learning dashboards.'], ['Which Excel version?|Works with Excel 2016 and above.', 'Is lifetime access included?|Yes.'], '📊 Skills employers pay for'],
  ['kidsabacus', 'Education', 'Abacus & Vedic Maths for Kids', '#f59e0b', 899, 3999, 'Make your child a maths genius — and finish homework 3× faster', 'Fun live classes for ages 6–14 with games, certificates and parent reports.', ['Live fun classes|Max 8 kids per batch', 'Mental maths in 30 days|Speed and accuracy', 'Progress reports|Monthly parent updates', 'Rewards & certificates|Keeps kids motivated'], ['Mrs. Sharma, Delhi|My son now loves maths!', 'Mr. Reddy, Hyderabad|Visible improvement in 3 weeks.'], ['What age is this for?|Ages 6 to 14.', 'Is there a demo class?|Yes, first demo class is free.'], '🧒 Loved by 20,000+ parents'],
  ['govtexam', 'Education', 'SSC / Banking Exam Test Series', '#be123c', 399, 1999, 'Crack SSC & Bank exams — 100 mock tests with all-India ranking', 'Latest pattern mocks, video solutions and daily current affairs in Hindi/English.', ['100 full-length mocks|Latest exam pattern', 'Video solutions|Short-cut tricks included', 'All-India rank|Compare with 1 lakh+ aspirants', 'Daily current affairs|PDF + quiz'], ['Pankaj Y., Bhopal|Cleared SSC CGL Tier 1!', 'Rekha S., Patna|Mocks were exactly like the real exam.'], ['Is it available on mobile?|Yes, on app and web.', 'Validity?|12 months from purchase.'], '🎯 Selection-focused prep'],
  ['yoga', 'Health & Fitness', '21-Day Yoga Reset', '#059669', 499, 1999, 'Lose belly fat & stress in 21 days — just 30 minutes of yoga a day', 'Live Hindi/English classes with certified trainers. Beginner friendly, from home.', ['Daily live classes|Replays included', 'Weight-loss poses|Targeted belly & back fat', 'Pranayama for stress|Better sleep, calmer mind', 'Simple Indian diet plan|No fancy ingredients'], ['Sunita B., Jaipur|Lost 4 kg and my back pain is gone.', 'Manoj K., Pune|Sleep improved in the first week.'], ['I have never done yoga. Is that okay?|Yes, beginner-friendly with modifications.', 'What do I need?|Just a mat and 30 minutes.'], '🧘 Certified yoga trainers'],
  ['weightloss', 'Health & Fitness', '12-Week Fat Loss Programme', '#ea580c', 1499, 5999, 'Lose 8–10 kg in 12 weeks — eating the Indian food you love', 'Personal diet charts, home workouts and weekly coach check-ins.', ['Custom Indian diet plan|Roti, dal, sabzi — no starving', 'Home workouts|No gym needed', 'Weekly coach check-ins|WhatsApp support', 'Community challenges|Stay accountable'], ['Rina T., Mumbai|Lost 9 kg without giving up roti!', 'Gaurav S., Delhi|Down 3 pant sizes. Unreal.'], ['Is it vegetarian friendly?|Yes — veg, non-veg and Jain options.', 'Any side effects?|No supplements, only food and exercise.'], '🔥 12,000+ transformations'],
  ['diabetes', 'Health & Fitness', 'Diabetes Reversal Lifestyle Plan', '#0891b2', 1999, 7999, 'Bring your sugar levels under control — naturally, with food & routine', 'Doctor-designed meal plans, walking routines and monthly sugar tracking.', ['Doctor-designed diet|Indian meals, low-GI swaps', 'Daily routine plan|Simple, sustainable habits', 'Sugar tracker|Know your progress', 'Doctor Q&A session|Monthly live call'], ['Mr. Iyer, Chennai|HbA1c came down from 8.2 to 6.4.', 'Mrs. Gupta, Lucknow|Medicines reduced under my doctor.'], ['Should I stop my medicines?|No — continue as advised by your doctor.', 'Is it for Type 1 as well?|Primarily Type 2 and pre-diabetes.'], '🩺 Doctor-led programme'],
  ['gym', 'Health & Fitness', 'Local Gym 3-Month Membership', '#111827', 2999, 7999, 'Get fit this summer — join the best gym in your city at 60% OFF', 'Modern equipment, trainers, steam room and free diet consultation.', ['Premium equipment|Cardio, strength & functional zone', 'Certified trainers|Personal guidance', 'Free diet consult|Meal plan included', 'Flexible timings|5 AM to 11 PM'], ['Kunal M., Surat|Best gym in the area, great trainers.', 'Isha P., Ahmedabad|Clean, friendly, motivating.'], ['Can I get a free trial?|Yes, 1-day free pass available.', 'Is parking available?|Yes, free parking.'], '💪 Limited founding memberships'],
  ['ayurveda', 'Health & Fitness', 'Ayurvedic Immunity & Digestion Kit', '#65a30d', 799, 1999, 'Boost immunity & fix digestion with 100% Ayurvedic herbs', 'Doctor-formulated, GMP certified and made from traditional recipes.', ['100% natural herbs|No chemicals or preservatives', 'Ayurvedic doctor formulated|Backed by tradition', 'Visible results in 30 days|Gentle and safe', 'Free consultation|Chat with our vaidya'], ['Kamla D., Indore|Digestion improved in 2 weeks.', 'Suresh V., Kochi|Fewer colds this season.'], ['Any side effects?|Natural herbs; consult a doctor if pregnant.', 'COD available?|Yes, Cash on Delivery across India.'], '🌿 Ayush-certified'],
  ['pcod', 'Health & Fitness', 'PCOD/PCOS Healing Programme', '#db2777', 1799, 6999, 'Balance your hormones & regularise periods — naturally', 'Diet, yoga and lifestyle plan by a women\'s health specialist.', ['Hormone-balancing diet|Indian-kitchen friendly', 'PCOS yoga routine|20 minutes a day', 'Specialist consultation|Weekly group Q&A', 'Private women-only group|Safe, supportive'], ['Neha K., Pune|Cycle became regular in 3 months.', 'Aarti S., Bengaluru|Lost weight and gained energy.'], ['Is it safe?|Lifestyle guidance; consult your gynaecologist too.', 'Is the group private?|Yes, women-only.'], '🌸 By women\'s health experts'],
  ['skincare', 'Beauty & Wellness', 'Vitamin C Glow Skincare Combo', '#f97316', 899, 2499, 'Get naturally glowing skin in 14 days — dermatologist tested', 'Vitamin C serum + face wash + sunscreen made for Indian skin & climate.', ['Brightens dull skin|Visible glow in 14 days', 'Suits Indian skin|Tested for humid climates', 'No parabens or sulphates|Safe and gentle', '30-day money-back|No questions asked'], ['Aisha K., Hyderabad|My dark spots faded noticeably!', 'Tanvi J., Mumbai|Lightweight and non-sticky.'], ['Is it suitable for oily skin?|Yes, non-comedogenic.', 'How long is delivery?|3–6 days across India.'], '✨ Dermatologist tested'],
  ['haircare', 'Beauty & Wellness', 'Onion & Bhringraj Hair Growth Kit', '#7c2d12', 699, 1799, 'Stop hair fall in 30 days — Ayurvedic oil + shampoo kit', 'Cold-pressed onion & bhringraj formula to reduce hair fall and boost growth.', ['Reduces hair fall|Visible results in 4 weeks', 'Natural ingredients|Free of mineral oil', 'Boosts thickness|Nourishes roots', 'Cash on Delivery|Pay when it arrives'], ['Madhuri P., Nagpur|Hair fall reduced by half.', 'Rahul G., Delhi|Even my beard grew thicker!'], ['Is it for men and women?|Yes, unisex.', 'How to use?|Massage 3 times a week; instructions inside.'], '💇 50,000+ happy customers'],
  ['salon', 'Beauty & Wellness', 'Bridal Makeup & Salon Packages', '#be185d', 14999, 34999, 'Look stunning on your big day — bridal packages at 55% OFF', 'HD & airbrush makeup, hair styling and pre-bridal care by top artists.', ['HD & airbrush makeup|Long-lasting & camera ready', 'Pre-bridal care|Facial, spa, waxing', 'Trial session included|See your look first', 'Home service available|We come to you'], ['Ritika M., Jaipur|Everyone asked who did my makeup!', 'Shruti V., Surat|Perfect for my wedding.'], ['Do you travel for destination weddings?|Yes, travel charges apply.', 'How early should I book?|1–2 months in advance.'], '👰 Booked by 2,000+ brides'],
  ['mehendi', 'Beauty & Wellness', 'Bridal Mehendi Artist Booking', '#15803d', 2999, 6999, 'Beautiful bridal mehendi that stays dark for 10+ days', 'Natural henna cones, custom designs, home visits across the city.', ['Natural henna only|No chemicals', 'Custom bridal designs|Portraits, Rajasthani, Arabic', 'Family packages|Special rates for groups', 'Home visits|Anywhere in the city'], ['Pallavi S., Jaipur|The colour was unbelievably dark.', 'Fatima Q., Lucknow|Delicate and detailed work.'], ['Do you do group bookings?|Yes, with discounts.', 'How long does bridal mehendi take?|3–4 hours.'], '🌿 Natural henna artists'],
  ['spa', 'Beauty & Wellness', 'Couple Spa & Wellness Day', '#0d9488', 2499, 6999, 'Relax & recharge — a 90-minute spa experience at 65% OFF', 'Aromatherapy massage, steam and refreshments in a calm luxury setting.', ['90-min therapy|Deep tissue or aroma', 'Private couple suite|Quiet and comfortable', 'Steam & sauna|Included', 'Free welcome drink|Herbal tea'], ['Alok & Rima, Mumbai|Perfect anniversary gift!', 'Neeraj T., Delhi|Best massage in town.'], ['Is it safe and hygienic?|Yes, sanitised after every session.', 'Can I gift this?|Yes, gift vouchers available.'], '🧖 Limited slots daily'],
  ['pickle', 'Food & Ecommerce', 'Homemade Pickles Combo (4 jars)', '#b45309', 599, 999, 'Authentic homemade achar made like nani used to — delivered in 3 days', 'Mango, lemon, mixed veg and garlic pickles. No preservatives. Cold-pressed mustard oil.', ['No preservatives|Traditional sun-dried recipe', 'Cold-pressed oil|Pure and aromatic', 'Fresh small batches|Packed on order', 'COD available|Pay on delivery'], ['Mrs. Kapoor, Chandigarh|Tastes exactly like my mother-in-law\'s!', 'Anil V., Nagpur|Bought for the 3rd time.'], ['How long do they last?|6+ months unopened, 3 months after opening.', 'Delivery time?|3–6 working days.'], '🥭 Homemade with love'],
  ['organic', 'Food & Ecommerce', 'Organic Groceries Monthly Box', '#4d7c0f', 1299, 2199, 'Fresh farm-direct organic groceries delivered to your door', 'Pesticide-free fruits, vegetables, pulses and millets from certified Indian farms.', ['Farm-direct sourcing|Harvested within 24 hours', 'Certified organic|Lab tested', 'Free delivery|Above ₹999', 'Flexible subscription|Skip or pause anytime'], ['Divya M., Bengaluru|Veggies stay fresh for days.', 'Sandeep R., Hyderabad|Kids love the taste.'], ['Which cities do you deliver to?|Major metros; check pincode at checkout.', 'Can I customise the box?|Yes, swap any item.'], '🌾 Farm to table'],
  ['dryfruits', 'Food & Ecommerce', 'Premium Dry Fruits Gift Box', '#a16207', 999, 1999, 'Gift health this festive season — premium dry fruits, beautifully packed', 'Kashmiri almonds, cashews, pistachios and anjeer in a gift-ready box.', ['Premium grade|Handpicked & fresh', 'Festive gift packaging|Free greeting card', 'Bulk orders for corporates|Custom logo available', 'Pan-India delivery|Tracked shipping'], ['Mr. Bansal, Delhi|Perfect Diwali gift for my team.', 'Aarti K., Mumbai|Fresh and well packed.'], ['Can I send directly to a gift recipient?|Yes, add address and message.', 'Bulk discount?|Yes, 20+ boxes.'], '🎁 Festive bestseller'],
  ['sweets', 'Food & Ecommerce', 'Authentic Mithai Gift Hamper', '#e11d48', 799, 1299, 'Bring home the taste of tradition — fresh mithai delivered nationwide', 'Kaju katli, soan papdi and laddoos made in pure ghee. Ideal for festivals & weddings.', ['Pure ghee sweets|Handmade daily', 'Long shelf life|Sealed freshness', 'Festive gifting|Premium boxes', 'Same-day dispatch|Before 2 PM'], ['Sheetal P., Pune|Tasted like fresh from the shop.', 'Vivek M., Jaipur|Arrived on time for Rakhi.'], ['How long does mithai stay fresh?|10–15 days depending on type.', 'Do you ship pan-India?|Yes, in insulated packaging.'], '🍬 Since 1985'],
  ['tea', 'Food & Ecommerce', 'Assam & Darjeeling Tea Sampler', '#166534', 549, 999, 'Taste the freshest estate teas straight from the gardens', 'Hand-picked Assam CTC, Darjeeling first flush and masala chai blend.', ['Estate fresh|Direct from gardens', 'Strong & aromatic|Rich in flavour', 'Resealable packs|Keep freshness', 'Gift ready|Beautiful tins'], ['Mr. Das, Kolkata|Chai like the old days.', 'Priyanka L., Delhi|The masala blend is a hit.'], ['Is it loose leaf?|Yes, loose leaf plus tea-bags options.', 'How much tea is in each pack?|100g each, 5 packs.'], '🍵 Garden fresh'],
  ['ethnicwear', 'Food & Ecommerce', 'Festive Kurti & Saree Collection', '#a21caf', 799, 2499, 'Look gorgeous this festive season — kurtis & sarees from ₹799', 'Cotton, silk and designer pieces. Free size exchange and COD across India.', ['New festive collection|Trending designs', 'Free size exchange|Hassle free', 'Quality fabric|Soft and durable', 'Cash on Delivery|Pay at your doorstep'], ['Reema G., Surat|The fabric is so soft!', 'Preeti K., Jaipur|Fits perfectly, great colours.'], ['Can I return it?|Yes, 7-day easy returns.', 'Is COD available?|Yes, across India.'], '👗 Direct from manufacturers'],
  ['jewellery', 'Food & Ecommerce', 'Artificial Jewellery Combo Sets', '#b91c1c', 699, 1999, 'Stunning jewellery sets at factory prices — anti-tarnish, skin safe', 'Temple, kundan and oxidised sets perfect for weddings and festive wear.', ['Anti-tarnish finish|Long lasting shine', 'Skin friendly|No allergies', 'Gift box packaging|Ready to give', '7-day returns|No questions'], ['Ishita M., Mumbai|Looks just like real gold!', 'Madhu S., Chennai|Gifted it to my sister — she loved it.'], ['Will it turn black?|Anti-tarnish coating; keep dry and away from perfume.', 'Is COD available?|Yes.'], '💎 Trending in India'],
  ['stocks', 'Finance & Business', 'Stock Market Mastery Course', '#1e40af', 1999, 9999, 'Learn to trade & invest smartly — from zero to confident in 30 days', 'NSE/BSE basics, technical analysis, risk management and portfolio building.', ['Beginner friendly|Start from scratch', 'Live market sessions|Learn with real trades', 'Risk management|Protect your capital', 'Lifetime community|Daily market views'], ['Varun K., Mumbai|Understood candlesticks finally.', 'Pallavi N., Pune|Stopped random tips and built a plan.'], ['Is this financial advice?|No, this is educational. Markets carry risk.', 'Minimum capital needed?|You can start with as little as ₹5,000.'], '📈 SEBI-aware education'],
  ['mutualfunds', 'Finance & Business', 'Mutual Funds & SIP Workshop', '#0f766e', 299, 1499, 'Build ₹1 crore with smart SIPs — free expert workshop for Indians', 'Learn how SIPs work, how to pick funds and plan taxes — in simple Hindi/English.', ['SIP planning|Goal-based roadmap', 'Fund selection basics|Avoid common mistakes', 'Tax saving (ELSS)|Section 80C explained', 'Q&A with expert|Live questions'], ['Ravi P., Bengaluru|Started my first SIP after this.', 'Seema T., Chennai|Clear and jargon free.'], ['Is this advice to buy specific funds?|No, educational only.', 'Will there be a recording?|Yes, for 30 days.'], '💰 Mutual funds are subject to market risk'],
  ['gst', 'Finance & Business', 'GST & Tax Filing Made Simple', '#4338ca', 999, 3999, 'File GST & ITR yourself and save ₹10,000+ every year', 'Step-by-step practical course for small business owners and freelancers.', ['GST registration to filing|Hands-on demos', 'ITR for freelancers|Avoid notices', 'Excel templates|Ready to use', 'CA support group|Ask your doubts'], ['Neelam B., Surat|Saved my CA fees!', 'Asif M., Hyderabad|Easy to follow.'], ['Is it updated for this year?|Yes, updated as per latest rules.', 'Is it useful for freelancers?|Absolutely.'], '🧾 By practising CAs'],
  ['startup', 'Finance & Business', 'Start Your Business Bootcamp', '#c2410c', 2499, 9999, 'From idea to first ₹1 lakh sales — a practical startup bootcamp', 'Validate your idea, register your company, get your first 100 customers.', ['Idea validation|Test before investing', 'MSME & GST registration|Step-by-step', 'Marketing on a budget|WhatsApp, Instagram, Google', 'Founder community|Network & mentors'], ['Rakesh J., Indore|Launched my brand in 3 weeks.', 'Anita V., Kochi|Got my first 50 customers.'], ['Is it for part-time founders?|Yes, evenings and weekends.', 'Do I need capital?|No, we start lean.'], '🚀 Built for Indian founders'],
  ['dropship', 'Finance & Business', 'Ecommerce & Dropshipping India', '#0369a1', 1499, 7999, 'Start your online store and sell across India — no inventory', 'Shopify, Meesho and Amazon seller basics with product research and ads.', ['Product research|Winning products', 'Store setup|Done-with-you', 'Facebook & Instagram ads|Low budget', 'Supplier list India|Verified vendors'], ['Harpreet S., Chandigarh|Got my first ₹50k month.', 'Sneha D., Pune|Clear step-by-step guidance.'], ['Do I need to invest in stock?|No, supplier ships to customers.', 'Is it for beginners?|Yes.'], '🛒 Real seller case studies'],
  ['affiliate', 'Finance & Business', 'Earn Online: Freelancing & Affiliate', '#9333ea', 799, 3999, 'Earn ₹30,000+/month online from home — a proven roadmap', 'Learn high-demand freelance skills, Fiverr/Upwork setup and affiliate marketing.', ['3 income methods|Pick what suits you', 'Profile & proposals|Land first client fast', 'Affiliate marketing|Promote and earn', 'Community support|Weekly Q&A'], ['Komal R., Jaipur|My first ₹12,000 client in 3 weeks.', 'Mahesh T., Indore|Working from home now.'], ['Do I need a laptop?|Yes, or a decent smartphone to start.', 'Are earnings guaranteed?|No; results depend on your effort.'], '🏠 Work from home'],
  ['insurance', 'Finance & Business', 'Term & Health Insurance Planning', '#0e7490', 0, 0, 'Protect your family — compare 20+ insurers in 2 minutes, free', 'Get the right term & health cover with a free expert consultation. No spam.', ['Compare 20+ insurers|Best premium for you', 'Free expert advice|No obligation', 'Claim support|We help when needed', 'Tax saving|Sections 80C & 80D'], ['Mr. Menon, Kochi|Got a better premium than my agent.', 'Mrs. Rao, Hyderabad|Easy, transparent.'], ['Is the consultation free?|Yes.', 'Will I get spam calls?|No, one call only.'], '🛡 IRDAI-registered partners'],
  ['loan', 'Finance & Business', 'Instant Personal / Business Loan Help', '#15803d', 0, 0, 'Get a loan approved in 24 hours — minimum paperwork', 'We compare banks & NBFCs to get you the lowest interest rate.', ['Approval in 24 hours|Quick disbursal', 'Lowest interest rates|Compare 15+ lenders', 'Minimal documents|Aadhaar + PAN', 'No hidden charges|Transparent pricing'], ['Imran S., Lucknow|Got funds in 2 days for my shop.', 'Rekha P., Pune|No runaround.'], ['Is there any fee?|No fee to check eligibility.', 'Do I need a high CIBIL?|650+ preferred; options exist for lower.'], '🏦 Trusted lender network'],
  ['realestate', 'Real Estate & Local', 'Premium 2 & 3 BHK Apartments', '#0f172a', 0, 0, 'Own your dream home — 2 & 3 BHK from ₹65 lakh onwards', 'RERA approved, near metro & schools. Limited units at launch price. Book a free site visit.', ['RERA approved|Safe & legal', 'Near metro & schools|Prime location', 'Clubhouse & pool|World-class amenities', 'Easy home loans|Bank tie-ups'], ['Mr. Joshi, Pune|Transparent process, great location.', 'Mrs. Nair, Kochi|Site visit was smooth.'], ['What is the possession date?|Dec 2027 (RERA registered).', 'Can I get a loan?|Yes, with 10+ partner banks.'], '🏠 Launch price ends soon'],
  ['plots', 'Real Estate & Local', 'DTCP Approved Residential Plots', '#854d0e', 0, 0, 'Invest in land — plots near the new highway from ₹9 lakh', 'Clear title, 100% legal, instant registration. Limited plots available.', ['Clear title|100% legal', 'Appreciating location|Near upcoming highway', 'Instant registration|Easy paperwork', 'Free site visit|Pickup included'], ['Mr. Kulkarni, Nagpur|Plot value up 30% in 2 years.', 'Mrs. Das, Kolkata|Seamless registration.'], ['Is it DTCP approved?|Yes, fully approved.', 'Can I pay in instalments?|Yes, flexible plans.'], '📍 Only few plots left'],
  ['interior', 'Real Estate & Local', 'Home Interior Design Package', '#78350f', 0, 0, 'Beautiful home interiors in 45 days — starting ₹1.99 lakh', 'Modular kitchen, wardrobes and full-home design with a 10-year warranty.', ['Free 3D design|Visualise before you pay', '45-day delivery|On-time guarantee', '10-year warranty|Peace of mind', 'Transparent pricing|No hidden costs'], ['Rohini P., Bengaluru|Delivered exactly as promised.', 'Amit S., Delhi|Beautiful and on budget.'], ['Do you do renovations?|Yes, new and old homes.', 'How to book a consultation?|Fill the form — free.'], '🛋 Free 3D design'],
  ['coaching', 'Real Estate & Local', 'Local Tuition & Coaching Centre Admission', '#1d4ed8', 999, 2999, 'Admissions open — small batches, expert teachers, proven results', 'Classes 6–12, board exam focus, weekly tests and parent meetings.', ['Small batches|Personal attention', 'Experienced teachers|10+ years', 'Weekly tests|Track progress', 'Parent updates|Regular reports'], ['Mrs. Verma, Lucknow|My daughter\'s marks improved a lot.', 'Mr. Singh, Chandigarh|Teachers are caring.'], ['What are class timings?|Evening and weekend batches.', 'Is a demo class available?|Yes, free demo.'], '🎓 Limited seats per batch'],
  ['clinic', 'Real Estate & Local', 'Dental Care Clinic — Smile Makeover', '#0ea5e9', 499, 1500, 'Healthy, beautiful smile — dental check-up & cleaning at just ₹499', 'Painless treatments, modern equipment and experienced dentists.', ['Painless treatment|Modern technology', 'Experienced dentists|10+ years', 'Hygiene first|Sterilised tools', 'EMI on treatments|Easy payments'], ['Mr. Patel, Ahmedabad|Painless root canal!', 'Anjali S., Indore|Friendly staff, clean clinic.'], ['Is the check-up really ₹499?|Yes, includes cleaning and consultation.', 'Can I book a weekend slot?|Yes.'], '🦷 Book today'],
  ['cardriving', 'Real Estate & Local', 'Learn Car Driving in 15 Days', '#ea580c', 3499, 6999, 'Learn driving with confidence — free licence assistance included', 'Women trainers available. Dual-control cars and city & highway practice.', ['Dual-control cars|Safe learning', 'Women trainers|On request', 'Free licence help|DL assistance', 'Pick-up & drop|Door-to-door'], ['Neeta K., Surat|Fear of driving gone.', 'Rahul B., Delhi|Instructor was patient.'], ['Do you provide the car?|Yes, our training cars.', 'How long are sessions?|45 minutes daily.'], '🚗 Licence assistance'],
  ['astrology', 'Events & Spiritual', 'Vedic Astrology Consultation', '#7c2d12', 499, 2100, 'Know your future — personalised kundli reading by expert astrologers', 'Career, marriage, health & finance guidance in 30 minutes, in Hindi/English.', ['Kundli analysis|Detailed report', 'Career & marriage|Clear guidance', 'Remedies suggested|Simple and practical', 'Recorded session|Replay anytime'], ['Mrs. Pandey, Varanasi|Accurate and reassuring.', 'Nitin S., Pune|Helped with my career choice.'], ['Is it confidential?|Yes.', 'Will I get a report?|Yes, a PDF kundli report.'], '🔮 Verified astrologers'],
  ['meditation', 'Events & Spiritual', 'Meditation & Mindfulness Retreat (Online)', '#6d28d9', 299, 1499, 'Find calm in 7 days — guided meditation for stress & anxiety', 'Daily live sessions with a certified teacher. Sleep better and focus better.', ['Daily guided sessions|Live + recorded', 'Stress & anxiety relief|Practical techniques', 'Better sleep|Simple night routine', 'Certificate|On completion'], ['Sangeeta M., Mumbai|My sleep improved in days.', 'Prakash R., Bengaluru|Calmer at work.'], ['Do I need experience?|No.', 'How long are sessions?|30 minutes.'], '🕉 7-day challenge'],
  ['wedding', 'Events & Spiritual', 'Wedding Photography & Videography', '#9d174d', 49999, 99999, 'Capture your big day beautifully — cinematic wedding packages', 'Candid photos, drone shots and cinematic films with same-week teasers.', ['Candid photography|Natural moments', 'Cinematic film|Highlight reel', 'Drone coverage|Aerial views', 'Album included|Premium print'], ['Aarav & Ishita, Jaipur|Our film made everyone cry!', 'Kunal & Pooja, Delhi|Stunning photos.'], ['Do you travel?|Yes, across India.', 'How soon do we get photos?|Teasers in 7 days.'], '📸 Limited dates available'],
  ['webinar', 'Events & Spiritual', 'Free Masterclass: Grow Your Business Online', '#2563eb', 0, 0, 'FREE live masterclass: get 100 customers online in 30 days', '90-minute live session. Learn WhatsApp, Instagram and Google growth tactics for Indian businesses.', ['Live 90-min session|Hindi/English', 'Step-by-step plan|Copy & apply', 'Live Q&A|Ask your questions', 'Free bonus checklist|For attendees'], ['Raj M., Surat|Got 40 leads the next week.', 'Meena S., Pune|Practical and clear.'], ['Is it really free?|Yes, 100% free to attend.', 'Will there be a recording?|For registered attendees only.'], '🎤 Next batch starts tonight'],
  ['kirtan', 'Events & Spiritual', 'Bhagavad Gita Online Course', '#c2410c', 199, 999, 'Understand Bhagavad Gita for modern life — in simple Hindi', 'Chapter-wise learning with a scholar, daily shlokas and group satsang.', ['Chapter-wise teaching|Simple explanation', 'Daily shlokas|Pronunciation guide', 'Live satsang|Weekly', 'E-book & audio|Included'], ['Mrs. Tiwari, Bhopal|Peace of mind.', 'Mr. Rao, Hyderabad|Easy to understand.'], ['Is it in Hindi?|Yes, with English notes.', 'Any age limit?|No.'], '📖 Ancient wisdom'],
  ['digitalmarketing', 'Services & Tech', 'Digital Marketing Agency Services', '#e11d48', 9999, 24999, 'Get 3× more leads from Google & Instagram — in 60 days', 'SEO, Meta ads and WhatsApp marketing for Indian SMEs. Pay only for results-driven plans.', ['Lead generation|Targeted audience', 'Meta & Google ads|Low CPA', 'WhatsApp automation|Instant follow-up', 'Monthly reports|Transparent'], ['Mr. Agarwal, Surat|Leads doubled in 2 months.', 'Mrs. Shah, Ahmedabad|Professional team.'], ['What is the minimum ad budget?|₹15,000/month recommended.', 'Do you work with small shops?|Yes.'], '📣 50+ Indian brands served'],
  ['website', 'Services & Tech', 'Professional Website in 7 Days', '#0369a1', 4999, 14999, 'Get your business website live in 7 days — mobile-friendly & SEO-ready', 'Includes domain, hosting, WhatsApp button, Google Maps and 1 year support.', ['Delivered in 7 days|On-time promise', 'Domain + hosting|Included year 1', 'WhatsApp & Maps|Customers can reach you', 'SEO ready|Get found on Google'], ['Mr. Khan, Lucknow|Got enquiries in the first week.', 'Mrs. Menon, Kochi|Beautiful design.'], ['Can I edit it myself?|Yes, easy dashboard.', 'Is there any hidden fee?|No.'], '🌐 Made in India'],
  ['appdev', 'Services & Tech', 'Mobile App Development for Startups', '#4f46e5', 49999, 149999, 'Launch your app in 45 days — MVP packages for startups', 'Android + iOS, clean UI, admin panel and 3 months free maintenance.', ['Android & iOS|Single codebase', '45-day MVP|Fast launch', 'Admin panel|Manage easily', '3 months support|Free'], ['Founders of FreshKart, Pune|Launched on time!', 'Ravi, Bengaluru|Great communication.'], ['Do you sign an NDA?|Yes.', 'Can I see sample work?|Yes, on the call.'], '📱 50+ apps delivered'],
  ['solar', 'Services & Tech', 'Rooftop Solar Installation', '#f59e0b', 0, 0, 'Cut your electricity bill by 90% — rooftop solar with ₹78,000 subsidy', 'Government subsidy support, 25-year panel warranty and free site survey.', ['Up to ₹78,000 subsidy|PM Surya Ghar', '25-year panel warranty|Long term savings', 'Free site survey|At your home', 'Easy EMI|Low interest'], ['Mr. Choudhary, Jaipur|Bill dropped from ₹6,000 to ₹400.', 'Mrs. Patil, Pune|Installation in 3 days.'], ['What is the payback period?|Typically 3–4 years.', 'Do I get the subsidy?|Yes, we handle the paperwork.'], '☀️ Subsidy support'],
  ['cleaning', 'Services & Tech', 'Deep Home Cleaning Service', '#0891b2', 1499, 3499, 'A spotless home in 4 hours — trained cleaners, eco-friendly products', 'Kitchen, bathroom and full-home deep clean. Same-day slots available.', ['Trained professionals|Background verified', 'Eco-friendly products|Safe for kids & pets', 'Same-day service|Book now', 'Satisfaction guarantee|Free re-clean'], ['Mrs. Reddy, Hyderabad|Kitchen looked brand new!', 'Mr. Jain, Indore|Very professional.'], ['How long does it take?|3–5 hours for a 2 BHK.', 'Is it safe?|Yes, trained and verified staff.'], '🧼 Verified cleaners'],
  ['pestcontrol', 'Services & Tech', 'Pest Control & Sanitisation', '#b91c1c', 799, 2499, 'Say goodbye to cockroaches, termites & mosquitoes — 6 months warranty', 'Odourless, child & pet safe treatment by certified technicians.', ['Odourless treatment|Safe for family', '6-month warranty|Free re-service', 'Certified technicians|Experienced', 'Same-day service|Book today'], ['Mr. Naik, Nagpur|No cockroaches since!', 'Mrs. Das, Kolkata|Safe and quick.'], ['Is it safe for kids?|Yes, child and pet safe.', 'How long does it take?|1–2 hours.'], '🐜 6-month warranty'],
  ['tutoring', 'Services & Tech', 'Online Tuition for Class 6–12', '#16a34a', 599, 2499, 'Improve marks by 20% with live one-on-one online tuition', 'Expert teachers, flexible timings and weekly performance reports.', ['1-on-1 live classes|Personal attention', 'Flexible timings|Choose your slot', 'Weekly reports|Parents informed', 'Recorded sessions|Revise anytime'], ['Mrs. Kaur, Chandigarh|My son\'s maths improved a lot.', 'Mr. Bose, Kolkata|Convenient and effective.'], ['Is a demo class available?|Yes, free.', 'Which boards do you cover?|CBSE, ICSE, State boards.'], '📖 Free demo class'],
];

const pairs = (arr, a, b) => arr.map((s) => { const [x, y] = s.split('|'); return { [a]: x, [b]: y }; });
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const inr = (n) => '₹' + Number(n).toLocaleString('en-IN');
// Highlight the payoff half of a headline: "X — *Y*", otherwise the last 3 words
const accentHeadline = (h) => {
  const [head, tail] = h.split(' — ');
  if (tail && tail.split(' ').length <= 5) return `${head} — *${tail}*`;
  const words = (tail || head).split(' ');
  const hl = `${words.slice(0, -4).join(' ')} *${words.slice(-4).join(' ')}*`;
  return tail ? `${head} — ${hl}` : hl;
};
// What the hero card shows for niches sold via consultation instead of checkout
const LEAD_PRICE = { realestate: '₹65L+', plots: '₹9L+', interior: '₹1.99L+', insurance: 'Free quote', loan: '₹0 fees', solar: '₹78K off', webinar: 'FREE' };
const isBrand = (name) => /Team|Studio|Labs|Developers|Realty|India$|Home$|Control$/.test(name);

// ---------- page plans ----------
// Each kind of business gets its own landing page: which sections, in what order, with which layout,
// what they're called, and how much urgency. Within a kind, the hero and a few layouts rotate so two
// templates of the same kind still look different.
const KIND = {
  upsc: 'course', neet: 'course', jee: 'course', spokenenglish: 'course', ca: 'course', coding: 'course', excel: 'course', govtexam: 'course',
  stocks: 'money', mutualfunds: 'money', gst: 'money', startup: 'money', dropship: 'money', affiliate: 'money',
  yoga: 'transform', weightloss: 'transform', diabetes: 'transform', gym: 'transform', pcod: 'transform', meditation: 'transform',
  ayurveda: 'product', skincare: 'product', haircare: 'product', pickle: 'product', organic: 'product', dryfruits: 'product', sweets: 'product', tea: 'product', ethnicwear: 'product', jewellery: 'product',
  salon: 'booking', mehendi: 'booking', spa: 'booking', clinic: 'booking', cardriving: 'booking', cleaning: 'booking', pestcontrol: 'booking', wedding: 'booking',
  realestate: 'property', plots: 'property', interior: 'property', insurance: 'advice', loan: 'advice', solar: 'advice',
  digitalmarketing: 'agency', website: 'agency', appdev: 'agency',
  webinar: 'event',
  astrology: 'spiritual', kirtan: 'spiritual',
  kidsabacus: 'kids', tutoring: 'kids', coaching: 'kids',
};
const FOOD = new Set(['pickle', 'organic', 'dryfruits', 'sweets', 'tea']);
const FASHION = new Set(['ethnicwear', 'jewellery']);
// [section, layout] in page order; '*' marks where the price box / form goes. No made-up urgency (India's dark-pattern
// rules): countdowns only where there's a real time (a live session), no stock or viewer counts the seller didn't give
const PLANS = {
  course: ['hellobar', ['hero', ['split', 'editorial', 'center']], ['stats', ['strip', 'cards']], ['problem', ['split', 'list']], ['features', ['zigzag', 'cards', 'grid']], ['mentor', ['story', 'split']], ['steps', ['timeline', 'cards']], ['compare', ['table', 'columns']], ['testimonials', ['cards', 'wall', 'spotlight']], ['bonuses', ['dark', 'light']], '*', ['guarantee', ['box', 'strip']], ['faq', ['accordion', 'two']], ['cta', ['banner', 'plain']]],
  money: ['hellobar', ['hero', ['editorial', 'center', 'split']], ['stats', ['band', 'strip']], ['problem', ['list', 'split']], ['features', ['grid', 'zigzag']], ['compare', ['table', 'columns']], ['mentor', ['card', 'story']], ['testimonials', ['spotlight', 'cards']], ['steps', ['cards', 'timeline']], ['bonuses', ['light', 'dark']], '*', ['guarantee', ['strip', 'box']], ['faq', ['two', 'accordion']], ['cta', ['plain', 'banner']]],
  transform: ['hellobar', ['hero', ['split', 'center', 'banner']], ['problem', ['cards', 'list']], ['steps', ['cards', 'timeline']], ['features', ['list', 'grid']], ['testimonials', ['wall', 'spotlight']], ['stats', ['band', 'cards']], ['mentor', ['split', 'story']], ['bonuses', ['dark', 'light']], '*', ['guarantee', ['box', 'strip']], ['faq', ['accordion', 'two']], ['cta', ['banner', 'plain']]],
  product: ['hellobar', ['hero', ['center', 'banner', 'split']], ['stats', ['cards', 'strip']], ['problem', ['list', 'cards']], ['features', ['grid', 'zigzag', 'cards']], ['mentor', ['story', 'card']], ['testimonials', ['chat', 'wall']], ['steps', ['columns', 'timeline']], '*', ['guarantee', ['strip', 'box']], ['faq', ['two', 'accordion']], ['cta', ['plain', 'banner']]],
  booking: ['hellobar', ['hero', ['banner', 'center', 'split']], ['stats', ['band', 'cards']], ['features', ['list', 'grid', 'cards']], ['steps', ['timeline', 'columns']], ['testimonials', ['spotlight', 'chat', 'wall']], ['mentor', ['card', 'split']], '*', ['guarantee', ['strip', 'box']], ['faq', ['two', 'accordion']], ['cta', ['plain', 'banner']]],
  property: [['hero', ['banner', 'editorial']], ['stats', ['cards', 'band']], ['features', ['zigzag', 'grid']], ['compare', ['table', 'columns']], ['mentor', ['card', 'story']], ['testimonials', ['spotlight', 'cards']], ['steps', ['timeline', 'cards']], '*', ['faq', ['two', 'accordion']], ['cta', ['plain', 'banner']]],
  advice: ['hellobar', ['hero', ['center', 'split', 'banner']], ['stats', ['strip', 'band']], ['problem', ['split', 'cards']], ['features', ['grid', 'list']], ['steps', ['cards', 'timeline']], ['compare', ['columns', 'table']], ['testimonials', ['cards', 'spotlight']], ['mentor', ['card', 'split']], '*', ['faq', ['accordion', 'two']], ['cta', ['banner', 'plain']]],
  agency: [['hero', ['editorial', 'split']], ['stats', ['strip', 'band']], ['problem', ['split', 'list']], ['features', ['grid', 'zigzag']], ['steps', ['cards', 'timeline']], ['testimonials', ['cards', 'spotlight']], ['compare', ['columns', 'table']], ['mentor', ['card', 'story']], '*', ['guarantee', ['strip', 'box']], ['faq', ['accordion', 'two']], ['cta', ['banner', 'plain']]],
  event: ['hellobar', ['hero', 'center'], 'countdown', ['features', 'list'], ['mentor', 'split'], ['bonuses', 'light'], ['testimonials', 'wall'], '*', ['faq', 'accordion'], ['cta', 'banner']],
  spiritual: [['hero', ['center', 'split']], ['features', ['grid', 'list']], ['mentor', ['story', 'split']], ['steps', ['timeline', 'columns']], ['testimonials', ['chat', 'spotlight']], '*', ['guarantee', ['box', 'strip']], ['faq', ['accordion', 'two']], ['cta', ['banner', 'plain']]],
  kids: ['hellobar', ['hero', ['split', 'center']], ['problem', ['cards', 'list']], ['features', ['grid', 'cards']], ['steps', ['columns', 'cards']], ['testimonials', ['chat', 'wall']], ['mentor', ['card', 'split']], ['compare', ['columns', 'table']], '*', ['guarantee', ['box', 'strip']], ['faq', ['two', 'accordion']], ['cta', ['banner', 'plain']]],
};
// some templates tell their story in a different order: proof before the method, the expert before the offer
const REORDER = [['testimonials', 'mentor'], ['steps', 'features'], ['compare', 'testimonials']];
// floating extras per kind (all pages keep WhatsApp; the calmer kinds skip the loud ones)
const EXTRAS = {
  course: ['proof', 'exitpopup', 'stickybar', 'whatsapp'], money: ['proof', 'exitpopup', 'stickybar', 'whatsapp'], transform: ['proof', 'exitpopup', 'stickybar', 'whatsapp'],
  product: ['proof', 'exitpopup', 'stickybar', 'whatsapp'], booking: ['exitpopup', 'stickybar', 'whatsapp'], property: ['exitpopup', 'stickybar', 'whatsapp'],
  advice: ['exitpopup', 'stickybar', 'whatsapp'], agency: ['exitpopup', 'whatsapp'], event: ['stickybar', 'whatsapp'], spiritual: ['proof', 'exitpopup', 'stickybar', 'whatsapp'],
  kids: ['exitpopup', 'stickybar', 'whatsapp'],
};
// how each kind talks about its sections
const COPY_BY_KIND = (k, x) => ({
  course: {
    problem: ['The honest truth', 'Why most aspirants stay stuck', 'It isn’t effort. It’s the method.'],
    features: ['Inside the programme', `What you get with ${x.short}`, 'Everything is planned for you — just show up and follow it.'],
    steps: ['Your roadmap', 'From day one to exam day'], compare: ['Why this works', 'Self-study vs. learning with us'],
    testimonials: ['Results', `${x.whoCap} who cleared it with us`], mentor: 'Your mentor', bonuses: ['Included free', 'Enrol today and get these bonuses'], faq: ['Questions', 'Everything aspirants ask us'],
  },
  money: {
    problem: ['Sound familiar?', 'Where most people go wrong', ''],
    features: ['The toolkit', 'Everything you need to start — and keep going', `${x.short} gives you the system, not just tips.`],
    steps: ['Your plan', 'Four steps, done for you'], compare: ['The difference', 'Guesswork vs. a proven system'],
    testimonials: ['In their words', `What our ${x.who} say`], mentor: 'Who’s teaching you', bonuses: ['Bonus resources', 'Yours free when you join today'], faq: ['FAQ', 'Before you join'],
  },
  transform: {
    problem: ['If this is you…', 'You’ve tried everything. Here’s why it didn’t stick.', ''],
    features: ['The plan', 'Built around your real life', `Every part of ${x.short} fits an Indian routine — food, family and work included.`],
    steps: ['The method', `How ${x.short} works`], compare: ['Why it’s different', 'Quick fixes vs. a real plan'],
    testimonials: ['Transformations', 'Real people. Real change.'], mentor: 'Your coach', bonuses: ['Free with the programme', 'Extras that make it easier'], faq: ['Questions', 'Before you start'],
  },
  product: {
    problem: [FOOD.has(x.id) ? 'Why we started' : 'Sound familiar?', FOOD.has(x.id) ? 'What you get in the market today' : 'You’ve tried everything else', ''],
    features: ['Why you’ll love it', FOOD.has(x.id) ? 'Made the way it should be' : FASHION.has(x.id) ? 'Crafted to be noticed' : `Why ${x.short} works`, ''],
    steps: ['How it works', FOOD.has(x.id) ? 'From our kitchen to your table' : 'From our hands to your doorstep'], compare: ['Compare', 'The difference is in the details'],
    testimonials: ['On WhatsApp', 'Messages from our customers'], mentor: 'Our story', bonuses: ['Free with your order', 'A little extra in every box'], faq: ['Good to know', 'Shipping, payment and returns'],
  },
  booking: {
    problem: ['Sound familiar?', 'You deserve better than this', ''],
    features: ['What’s included', 'Everything, done properly', ''],
    steps: ['Booking', 'Booked in under 2 minutes'], compare: ['Why us', 'What makes us different'],
    testimonials: ['Reviews', 'Our clients say it best'], mentor: 'Meet the expert', bonuses: ['Included', 'Complimentary with every booking'], faq: ['Questions', 'Before you book'],
  },
  property: {
    problem: ['Sound familiar?', 'Why buyers hesitate', ''],
    features: ['Why here', 'Reasons buyers choose this project', ''],
    steps: ['The process', 'From first call to keys in hand'], compare: ['Compare', 'Why it beats the alternatives'],
    testimonials: ['Owners speak', 'Families who already made the move'], mentor: 'About the developer', bonuses: ['On booking', 'Booking benefits'], faq: ['FAQ', 'Questions buyers ask'],
  },
  advice: {
    problem: ['The problem', 'Why it feels so complicated', ''],
    features: ['How we help', 'Expert help, without the jargon', ''],
    steps: ['The process', 'Simple, transparent, fast'], compare: ['Why us', 'Doing it alone vs. with an expert'],
    testimonials: ['Client stories', 'People we’ve helped'], mentor: 'Who you’ll talk to', bonuses: ['Free', 'Included with your consultation'], faq: ['FAQ', 'Common questions'],
  },
  agency: {
    problem: ['The problem', 'Why most businesses stay invisible online', ''],
    features: ['What we do', 'Services that move the numbers', ''],
    steps: ['How we work', 'A clear process, start to finish'], compare: ['Why us', 'Freelancer vs. agency vs. us'],
    testimonials: ['Client results', 'What our clients say'], mentor: 'Who we are', bonuses: ['Included', 'Extras at no cost'], faq: ['FAQ', 'Working with us'],
  },
  event: {
    problem: ['Sound familiar?', 'Why this session matters', ''],
    features: ['In this free session', 'What you’ll learn', 'Live, practical, and built for Indian businesses.'],
    steps: ['How it works', 'Join in three steps'], compare: ['Why attend', 'Before vs. after the session'],
    testimonials: ['From past sessions', 'What attendees said'], mentor: 'Your host', bonuses: ['Attend live and get', 'Free for live attendees'], faq: ['FAQ', 'About the session'],
  },
  spiritual: {
    problem: ['Sound familiar?', 'When life feels stuck', ''],
    features: ['What you receive', 'Guidance rooted in tradition', ''],
    steps: ['The process', 'How your session works'], compare: ['Why us', 'Generic advice vs. personal guidance'],
    testimonials: ['Blessings shared', 'Messages from seekers'], mentor: 'Your guide', bonuses: ['With your booking', 'Included as our blessing'], faq: ['Questions', 'Before your session'],
  },
  kids: {
    problem: ['Parents tell us', 'Does this sound like your child?', ''],
    features: ['Why parents choose us', 'Learning your child looks forward to', ''],
    steps: ['How classes work', 'Simple for parents, fun for kids'], compare: ['The difference', 'Regular tuition vs. our classes'],
    testimonials: ['From parents', 'What parents are telling us'], mentor: 'Who teaches your child', bonuses: ['Free with enrolment', 'Extras for your child'], faq: ['For parents', 'Questions parents ask'],
  },
})[k];
// Every template has its own style + hero design, so no two cards in the gallery look alike
const LOOK_OF = {
  upsc: 'clean/split', neet: 'aurora/bento', jee: 'tech/split', spokenenglish: 'fresh/center', ca: 'editorial/editorial', coding: 'tech/bento', excel: 'swiss/split', kidsabacus: 'playful/split', govtexam: 'bold/editorial',
  yoga: 'organic/split', weightloss: 'bold/split', diabetes: 'clean/center', gym: 'noir/banner', ayurveda: 'organic/banner', pcod: 'pastel/split',
  skincare: 'pastel/bento', haircare: 'fresh/bento', salon: 'luxe/banner', mehendi: 'royal/split', spa: 'studio/center',
  pickle: 'organic/center', organic: 'fresh/split', dryfruits: 'luxe/bento', sweets: 'royal/banner', tea: 'organic/editorial', ethnicwear: 'royal/center', jewellery: 'luxe/split',
  stocks: 'midnight/split', mutualfunds: 'glass/center', gst: 'swiss/editorial', startup: 'studio/editorial', dropship: 'tech/editorial', affiliate: 'midnight/center', insurance: 'clean/banner', loan: 'aurora/split',
  realestate: 'luxe/center', plots: 'studio/banner', interior: 'editorial/split', coaching: 'fresh/banner', clinic: 'aurora/center', cardriving: 'playful/center',
  astrology: 'royal/editorial', meditation: 'pastel/center', wedding: 'editorial/center', webinar: 'bold/bento', kirtan: 'organic/bento',
  digitalmarketing: 'bold/banner', website: 'tech/center', appdev: 'midnight/bento', solar: 'fresh/editorial', cleaning: 'studio/split', pestcontrol: 'swiss/banner', tutoring: 'playful/bento',
};
const STYLE_OF = Object.fromEntries(Object.entries(LOOK_OF).map(([id, l]) => [id, l.split('/')[0]]));
const HERO_OF = Object.fromEntries(Object.entries(LOOK_OF).map(([id, l]) => [id, l.split('/')[1]]));
const shortName = (p) => (p.length > 26 ? p.split(/ [—–-] | for | & /)[0] : p);

const SALES = N.map(([id, category, product, baseColor, price, mrp, headline, sub, feats, quotes, faqs, badge]) => {
  const c = CAT[category];
  const colorOverride = (LOOK[id] || [])[1];
  const style = STYLE_OF[id] || (LOOK[id] || ['aurora'])[0];
  const color = colorOverride || baseColor;
  const kind = KIND[id] || 'course';
  const [painStr, expertStr] = X[id];
  const [ename, erole, ebio] = expertStr.split('|');
  const isLead = !price;
  const h = hash(id);
  const pick = (opts, salt = 0) => (Array.isArray(opts) ? opts[(h + salt) % opts.length] : opts);
  const disc = mrp > price && mrp ? Math.round((1 - price / mrp) * 100) : 0;
  const stats = pairs(c.stats(h), 'value', 'label');
  const featItems = pairs(feats, 'title', 'text').map((f, i) => ({ icon: c.icons[i % c.icons.length], ...f }));
  const bonusItems = c.bonuses.map((s) => { const [icon, title, value] = s.split('|'); return { icon, title, value: inr(value) }; });
  const bonusTotal = c.bonuses.reduce((a, s) => a + Number(s.split('|')[2]), 0);
  const cta = isLead ? (kind === 'event' ? 'Save My Free Seat' : 'Get My Free Consultation') : kind === 'booking' ? 'Book My Slot' : kind === 'product' ? 'Order Now' : disc ? 'Yes! I Want This Offer' : 'Reserve My Spot';
  const who = c.who;
  const x = { id, short: shortName(product), who, whoCap: who[0].toUpperCase() + who.slice(1) };
  const K = COPY_BY_KIND(kind, x);
  const testimonials = [
    ...pairs(quotes, 'name', 'quote'),
    ...GENERIC_QUOTES.map((q, i) => ({ name: `${NAMES[(h + 7 + i * 4) % NAMES.length]}, ${CITIES[(h + 3 + i * 7) % CITIES.length]}`, quote: q })),
  ]; // sample reviews the seller replaces: never tagged "Verified"
  const faqItems = [
    ...pairs(faqs, 'q', 'a'),
    { q: 'Which payment methods do you accept?', a: 'UPI (GPay, PhonePe, Paytm), debit/credit cards (Visa, Mastercard, RuPay), netbanking and wallets. COD on select products.' },
    { q: isLead ? 'Is there really no charge?' : 'Do you offer a refund?', a: isLead ? 'Yes — the consultation is 100% free with no obligation to buy.' : 'Yes. You are covered by our 7-day no-questions-asked money-back guarantee.' },
    { q: isLead ? 'How soon will you contact me?' : 'How soon do I get access?', a: isLead ? 'Our expert will call you within 24 hours (usually much sooner).' : kind === 'product' ? 'Orders ship within 24 hours; tracking comes on WhatsApp.' : 'Instantly. You get confirmation on email and WhatsApp within a minute of payment.' },
  ];

  // every section this template can use, already written for its kind
  const S = {
    hellobar: { messages: [
      { text: isLead ? (kind === 'event' ? '🎙️ Free live session — seats are limited' : '📞 Free consultations open this week') : kind === 'product' ? `🚚 Free shipping across India · COD available` : kind === 'booking' ? '📅 Weekend slots fill up fast — book early' : `🔥 Flat ${disc}% OFF` },
      { text: kind === 'product' ? `🎁 ${disc}% OFF on your first order` : `✅ ${c.guarantee[0]}` },
      { text: `🎁 Free bonuses worth ${inr(bonusTotal)} with every ${isLead ? 'booking' : 'order'}` },
    ] },
    hero: {
      badge, headline: accentHeadline(headline), subheadline: sub, ctaText: cta, secondaryText: kind === 'product' ? 'See what’s inside' : 'See how it works',
      rating: '', reviews: '', socialText: `Made for ${who} across India`, // no invented rating or review count
      image: '', cardEmoji: badge.split(' ')[0], cardTitle: product, cardPrice: isLead ? LEAD_PRICE[id] || 'FREE' : inr(price), cardMrp: isLead || !mrp ? '' : inr(mrp),
      cardPoints: featItems.slice(0, 3).map((f) => ({ text: f.title })),
      chip1: isLead ? '📅 Pick a time that suits you' : kind === 'product' ? '🚚 Delivery across India' : '⚡ Instant access after payment', chip2: isLead ? '✅ No spam, no obligation' : '🔒 100% secure payment',
    },
    stats: { items: stats },
    problem: { eyebrow: K.problem[0], title: K.problem[1], subtitle: K.problem[2] || `If this sounds like you, you’re not alone.`, items: painStr.split('|').map((text) => ({ text })), closing: `There’s a better way — and ${x.short} was built for exactly this. 👇` },
    features: { eyebrow: K.features[0], title: K.features[1], subtitle: K.features[2] || `${product}, done properly.`, items: featItems },
    steps: { eyebrow: K.steps[0], title: K.steps[1], items: pairs(c.steps, 'title', 'text') },
    compare: { eyebrow: K.compare[0], title: K.compare[1], leftTitle: c.cmp[0], rightTitle: `With ${x.short}`, rows: pairs(c.cmp[1], 'left', 'right') },
    testimonials: { eyebrow: K.testimonials[0], title: K.testimonials[1], items: testimonials },
    mentor: { eyebrow: isBrand(ename) ? (kind === 'property' ? 'About the developer' : 'Who we are') : K.mentor, name: ename, role: erole, bio: ebio, image: '', points: [{ text: '[Add a real credential — years of experience, qualifications]' }] },
    bonuses: { eyebrow: K.bonuses[0], title: K.bonuses[1], items: bonusItems, totalText: `Total value: ${inr(bonusTotal)} — yours free today` },
    // counts down to the webinar's next session (sales pages don't get a countdown: no real deadline)
    countdown: { label: 'The live session starts in', mode: 'session', endedText: 'The session has started' },
    guarantee: { title: c.guarantee[0], body: c.guarantee[1], days: isLead ? 0 : c.guarantee[2] },
    faq: { eyebrow: K.faq[0], title: K.faq[1], items: faqItems },
    cta: { headline: isLead ? (kind === 'event' ? 'Save your free seat — it takes 20 seconds' : 'Your free consultation is one click away') : kind === 'product' ? `Treat yourself — ${disc}% OFF today` : `Don’t miss ${disc}% OFF — start today`, subheadline: `${product}, ready when you are.`, buttonText: cta, note: isLead ? '✅ Free · ✅ No obligation · ✅ Callback within 24 hrs' : '🔒 Secure UPI & card payments · ✅ 7-day money-back guarantee' },
    proof: { intervalSec: 9 }, // real recent orders only
    exitpopup: { title: 'Before you go…', body: isLead ? 'Book now and get a free priority callback within 2 hours.' : 'Complete your order now and get an extra 10% OFF.', code: 'INDIA10', buttonText: isLead ? 'Book free consultation' : 'Claim extra 10% OFF' },
    stickybar: { text: isLead ? (kind === 'event' ? 'Free live session' : 'Free expert consultation') : `${disc}% OFF`, price: isLead ? '₹0' : inr(price), buttonText: isLead ? (kind === 'event' ? 'Save Seat' : 'Book Free') : kind === 'booking' ? 'Book Now' : 'Buy Now' },
    whatsapp: { number: '919999999999', message: `Hi! I want to know more about ${product}.`, label: 'Chat with us' },
  };
  const priceBox = isLead
    ? { type: 'optin', props: { ...(kind === 'event' ? { webinarId: '' } : {}), eyebrow: '100% free · No obligation', title: kind === 'event' ? 'Save your free seat' : 'Book your FREE consultation', subtitle: kind === 'event' ? 'We’ll send the joining link on WhatsApp and email.' : 'Share your details and our expert will call you within 24 hours.', buttonText: cta, askPhone: true, points: featItems.map((f) => ({ text: f.title })) } }
    : { type: 'pricing', props: { variant: ['money', 'product', 'agency'].includes(kind) ? 'split' : 'card', badge: `🔥 ${disc}% OFF — limited time`, title: product, mrp, price, currency: '₹', bullets: [...featItems.map((f) => ({ text: f.title })), ...bonusItems.map((b) => ({ text: `BONUS: ${b.title} (${b.value})` }))], buttonText: cta, note: '🔒 Secure checkout · 7-day money-back guarantee' } };

  const landing = [];
  const plan = [...PLANS[kind]];
  const nameOf = (e) => (Array.isArray(e) ? e[0] : e);
  REORDER.forEach(([p, q], r) => {
    if (((h >> (r + 2)) & 1) === 0) return;
    const i = plan.findIndex((e) => nameOf(e) === p), j = plan.findIndex((e) => nameOf(e) === q);
    if (i >= 0 && j >= 0) [plan[i], plan[j]] = [plan[j], plan[i]];
  });
  plan.forEach((entry, i) => {
    if (entry === '*') return landing.push(priceBox);
    const [type, layout] = Array.isArray(entry) ? entry : [entry];
    if (isLead && ['bonuses', 'stock'].includes(type) && kind !== 'event') return; // nothing to buy yet
    if (kind === 'product' && type === 'problem' && (FOOD.has(id) || FASHION.has(id))) return; // food & fashion lead with the product, not a problem
    landing.push({ type, props: { ...(type === 'hero' && HERO_OF[id] ? { variant: HERO_OF[id] } : layout ? { variant: pick(layout, i * 3 + (h >> 5) + id.length * 7 + (id === 'wedding' ? 2 : 0)) } : {}), ...S[type] } });
  });
  for (const type of EXTRAS[kind]) landing.push({ type, props: S[type] });
  const tone = { course: 'Reserve your seat', money: 'Lock in your price', transform: 'Start your plan', product: 'Complete your order', booking: 'Confirm your booking', kids: 'Confirm your child’s seat', spiritual: 'Confirm your session', agency: 'Start your project' }[kind] || 'Complete your order';
  const checkout = [
    { type: 'hellobar', props: { messages: [{ text: `✅ ${tone}` }, { text: '🔒 100% secure payment · 7-day money-back guarantee' }] } },
    { type: 'checkout', props: { productName: product, description: kind === 'product' ? 'Ships in 24 hours · tracking on WhatsApp' : 'Instant confirmation on email & WhatsApp', price, mrp, currency: '₹', ...(kind === 'product' ? { shipping: 'address', shippingFee: 0, cod: true, codFee: 0 } : {}), bumpEnabled: c.bump[1] > 0, bumpTitle: c.bump[0], bumpDescription: `Add this to your order for just ₹${c.bump[1]}.`, bumpPrice: c.bump[1], buttonText: 'Pay Securely' } },
    { type: 'testimonials', props: { variant: kind === 'product' || kind === 'kids' ? 'chat' : 'cards', eyebrow: 'You are in good company', title: `What ${who} say`, items: testimonials.slice(0, 3) } },
    { type: 'guarantee', props: { variant: 'strip', title: c.guarantee[0], body: c.guarantee[1], days: c.guarantee[2] } },
    { type: 'proof', props: { intervalSec: 9 } },
    { type: 'whatsapp', props: { number: '919999999999', message: 'Hi! I need help with my order.', label: 'Need help?' } },
  ];
  const thanks = [
    { type: 'thankyou', props: { headline: isLead ? (kind === 'event' ? 'You’re in! 🎉' : 'Booking confirmed! 🎉') : 'Order confirmed — thank you! 🎉', body: 'Details have been sent to your email & WhatsApp.', steps: [
      { text: isLead ? (kind === 'event' ? 'Watch WhatsApp for your joining link' : 'Our expert will call you within 24 hours') : kind === 'product' ? 'Your order ships within 24 hours' : 'Check your email & WhatsApp for access details' },
      { text: 'Save our WhatsApp number so you never miss an update' },
      { text: `Join our community of ${who}` },
    ] } },
    { type: 'whatsapp', props: { number: '919999999999', message: 'Hi! I just completed my booking.', label: 'Message us' } },
  ];
  const lad = LADDER[category];
  const r9 = (n) => Math.max(99, Math.round(n / 100) * 100 - 1);
  const offer = (kind2) => {
    const up = kind2 === 'up';
    const [pname, emoji, bullets] = lad[kind2];
    return [
      { type: 'offer', props: {
        progress: up ? 'Step 2 of 3 · Customise your order' : 'Step 2 of 3 · One last chance',
        headline: up ? `Wait! Your order isn't complete — add the *${pname}*` : `No problem — how about the *${pname}* instead?`,
        description: up ? `Customers who add this get results up to 3× faster. One click adds it to your order — no need to re-enter payment details.` : `Get the essentials at a special price, with one click.`,
        productName: pname, emoji, price: r9(price * (up ? 0.8 : 0.35)), mrp: r9(price * (up ? 2 : 0.9)), currency: '₹',
        bullets: bullets.map((text) => ({ text })), minutes: 0,
        acceptText: up ? `Yes! Add ${pname} to my order` : `Yes, add the ${pname}`, declineText: 'No thanks',
      } },
      { type: 'testimonials', props: { variant: up ? 'spotlight' : 'cards', eyebrow: 'Why people add this', title: 'What upgraders say', items: testimonials.slice(2, 5) } },
      { type: 'guarantee', props: { variant: up ? 'box' : 'strip', title: c.guarantee[0], body: 'Your upgrade is covered by the same no-questions-asked guarantee.', days: c.guarantee[2] || 7 } },
    ];
  };
  const crosssell = { type: 'crosssell', props: { title: 'Customers also bought', subtitle: 'Add these to your order with one click — no checkout needed.', buttonText: 'Add to my order', items: lad.cross.map(([emoji, name, desc], i) => ({ emoji, name, desc, price: r9(price * [0.5, 0.25, 0.3][i]) })) } };
  const steps = isLead
    ? [{ name: 'Landing page', type: 'optin', slug: 'start', blocks: landing }, { name: 'Thank you', type: 'thankyou', slug: 'thank-you', blocks: thanks }]
    : [
      { name: 'Landing page', type: 'sales', slug: 'start', blocks: landing },
      { name: 'Checkout', type: 'checkout', slug: 'checkout', blocks: checkout },
      { name: 'Upsell', type: 'upsell', slug: 'upsell', blocks: offer('up') },
      { name: 'Downsell', type: 'downsell', slug: 'downsell', blocks: offer('down') },
      { name: 'Thank you', type: 'thankyou', slug: 'thank-you', blocks: [thanks[0], crosssell, thanks[1]] },
    ];
  const theme = { style, primary: color, secondary: shiftHue(color, ['luxe', 'royal', 'editorial'].includes(style) ? 18 : 38) };
  const hero = landing.find((b) => b.type === 'hero');
  return { id, category, name: product, style, kind, type: isLead ? (kind === 'event' ? 'webinar' : 'lead') : 'sales', headline, steps, theme, hero };
});

// VSL + application and webinar funnels, written separately (templates-vsl.js, templates-webinar.js)
const FUNNELS = [...VSL.map(buildVsl), ...WEBINARS.map(buildWebinar), ...QUIZZES.map(buildQuiz)].map(({ color, ...t }) => ({
  ...t, theme: { style: t.style, primary: color, secondary: shiftHue(color, ['luxe', 'royal', 'editorial', 'noir'].includes(t.style) ? 18 : 38) }, hero: t.steps[0].blocks.find((b) => b.type === 'hero'),
}));
// business websites: Home, About, Services, Contact with a shared menu (website.js)
const SITES = WEBSITE_TEMPLATES.map((t) => {
  const steps = websiteSteps(t.input);
  return { id: t.id, category: t.category, name: t.name, style: t.style, kind: 'website', type: 'website', headline: t.input.headline, theme: { style: t.style, primary: t.color, secondary: shiftHue(t.color, 38) }, hero: steps[0].blocks.find((b) => b.type === 'hero'), steps };
});
const TEMPLATES = [...SALES, ...FUNNELS, ...SITES];

// Gallery order: each card should look different from the ones beside and above it — another style, hero design,
// colour, funnel type and industry — while sales, VSL and webinar funnels stay evenly mixed down the page.
const DARK = new Set(['midnight', 'tech', 'royal', 'noir', 'glass']);
const hueOf = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx === mn) return 0; const d = mx - mn; const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return h * 60; };
function galleryOrder(list) {
  const look = (t) => ({ t, style: t.style, hero: t.hero.props.variant, type: t.type === 'lead' ? 'sales' : t.type, cat: t.category, dark: DARK.has(t.style) || ['cinema', 'banner'].includes(t.hero.props.variant), hue: hueOf(t.theme.primary) });
  const left = list.map(look);
  const share = {}; for (const x of left) share[x.type] = (share[x.type] || 0) + 1 / left.length;
  const out = [left.splice(left.findIndex((x) => x.t.id === 'v-founders'), 1)[0] || left.shift()];
  const placed = { [out[0].type]: 1 };
  const diff = (a, b, near) => 3 * (a.style !== b.style) + 2 * (a.hero !== b.hero) + 1.2 * (a.type !== b.type) + (a.cat !== b.cat) + (near ? 1.5 * (a.dark !== b.dark) : 0) + Math.min(60, Math.abs(((a.hue - b.hue + 540) % 360) - 180)) / 60;
  while (left.length) {
    let best = 0, top = -Infinity;
    left.forEach((c, i) => {
      let s = 0;
      [1, 0.8, 0.55, 0.35].forEach((w, k) => { const p = out[out.length - 1 - k]; if (p) s += w * diff(c, p, k === 0); });
      s += 6 * (share[c.type] - (placed[c.type] || 0) / out.length);
      if (s > top + 1e-9) { top = s; best = i; }
    });
    const [x] = left.splice(best, 1);
    placed[x.type] = (placed[x.type] || 0) + 1;
    out.push(x);
  }
  return out.map((x) => x.t);
}
let GALLERY = null;

export const templateList = () => (GALLERY ||= galleryOrder(TEMPLATES)).map(({ id, category, name, style, kind, type, headline, theme, hero }) => ({ id, category, name, style, kind, type, headline, theme, hero: { id: 'h', ...hero } }));
export const getTemplate = (id) => {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) return null;
  return { id: t.id, name: t.name, theme: t.theme, steps: t.steps.map((s) => ({ id: uid(), ...s, blocks: s.blocks.map((b) => ({ id: uid(), type: b.type, props: structuredClone(b.props) })) })) };
};
export const TEMPLATE_COUNT = TEMPLATES.length;

// The template library as AI reference material. Matching reads each template's whole landing page,
// weighs rare words above common ones ("home", "online") and knows a few related words.
const STOP = new Set('the and for with your you our are this that from into who all any can will have has get more best new top india indian online offline home homemade service services course courses class classes programme program plan pack package kit combo free today now just only'.split(' '));
const RELATED = {
  cake: 'sweets mithai dessert', bakery: 'sweets mithai dessert', baker: 'sweets', cookie: 'sweets', brownie: 'sweets', chocolate: 'sweets mithai', dessert: 'sweets mithai', laddoo: 'sweets mithai',
  saree: 'ethnicwear kurti', kurti: 'ethnicwear', dress: 'ethnicwear', clothing: 'ethnicwear', fashion: 'ethnicwear', boutique: 'ethnicwear', earring: 'jewellery', necklace: 'jewellery',
  trading: 'stocks market', share: 'stocks', crypto: 'stocks', sip: 'mutualfunds', tax: 'gst', itr: 'gst', accounting: 'gst',
  english: 'spokenenglish', ielts: 'spokenenglish', communication: 'spokenenglish', coding: 'coding developer', programming: 'coding developer', python: 'coding', math: 'kidsabacus tutoring', maths: 'kidsabacus tutoring',
  fitness: 'gym weightloss', workout: 'gym weightloss', diet: 'weightloss', sugar: 'diabetes', hair: 'haircare', skin: 'skincare', makeup: 'salon', bridal: 'salon mehendi', parlour: 'salon',
  flat: 'realestate apartment', apartment: 'realestate', villa: 'realestate', plot: 'plots', land: 'plots', interior: 'interior', dentist: 'clinic dental', doctor: 'clinic', hospital: 'clinic',
  photographer: 'wedding photography', photography: 'wedding', marketing: 'digitalmarketing', seo: 'digitalmarketing', ads: 'digitalmarketing', website: 'website', app: 'appdev', solar: 'solar',
  transplant: 'hairtransplant', baldness: 'hairtransplant', ivf: 'ivf fertility', fertility: 'ivf', implant: 'implants dental', franchise: 'franchise', export: 'export', fundraising: 'fundraise', investor: 'fundraise', matchmaking: 'matchmaking', panchakarma: 'panchakarma', crm: 'crm', vastu: 'vastu', thyroid: 'thyroid', anxiety: 'anxiety', parenting: 'parenting', reels: 'reels', instagram: 'reels digitalmarketing',
  cleaning: 'cleaning', pest: 'pestcontrol', driving: 'cardriving', astrology: 'astrology', horoscope: 'astrology', meditation: 'meditation', spiritual: 'meditation kirtan', gita: 'kirtan',
  tea: 'tea', coffee: 'tea', spice: 'organic pickle', pickle: 'pickle', grocery: 'organic', dryfruit: 'dryfruits', nuts: 'dryfruits', webinar: 'webinar masterclass', coaching: 'coaching tutoring',
};
const stem = (w) => (w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const words = (text) => (String(text).toLowerCase().match(/[a-z]{3,}/g) || []).map(stem).filter((w) => !STOP.has(w));
let INDEX = null;
function index() {
  if (INDEX) return INDEX;
  const docs = TEMPLATES.map((t) => {
    const title = new Set(words(`${t.id.replace(/^[vwq]-/, '')} ${t.name} ${t.category}`));
    const body = new Set(words(`${t.headline} ${JSON.stringify(t.steps[0].blocks.map((b) => b.props))}`));
    return { t, title, body };
  });
  // word weights come from the other funnels only: quiz funnels are picked when a quiz is asked for, and shouldn't
  // shift how every other prompt is matched
  const df = {}, base = docs.filter((d) => d.t.type !== 'quiz');
  for (const d of base) for (const w of new Set([...d.title, ...d.body])) df[w] = (df[w] || 0) + 1;
  INDEX = { docs, idf: (w) => Math.log(1 + base.length / (df[w] || base.length)) };
  return INDEX;
}
export function similarTemplates(prompt, k = 2) {
  const { docs, idf } = index();
  const q = words(prompt);
  if (/\bca\b|chartered accountan/i.test(prompt)) q.unshift('ca'); // too short for the word filter, but a template of its own
  if (/\bai\b|artificial intelligence/i.test(prompt)) q.unshift('ai');
  const own = new Set(q);
  const related = [...new Set(q.flatMap((w) => (RELATED[w] || '').split(' ').filter((x) => x && !own.has(x))))];
  const expanded = [...new Set(q), ...related];
  const nq = own.size;
  // words that name a kind of funnel say which pool to pick from, not which niche — no exact-id bonus for them
  const FUNNEL_WORDS = new Set(['webinar', 'masterclass', 'workshop', 'seminar', 'session', 'training', 'vsl', 'application', 'apply', 'call']);
  const score = (d) => expanded.reduce((a, w, i) => {
    const weight = i < nq ? 1 : 0.8; // related words count a little less than the user's own words
    return a + weight * (d.t.id.replace(/^[vwq]-/, '') === w && !FUNNEL_WORDS.has(w) ? 12 + 3 * idf(w) : idf(w) * (d.title.has(w) ? 3 : d.body.has(w) ? 1 : 0));
  }, 0);
  // VSL and webinar funnels only win when the seller describes that kind of funnel ("free masterclass",
  // "apply for a call"); a bakery selling cakes wants a sales page, not the webinar about starting a bakery.
  // A clear ask picks from that kind of funnel only; "consultation" alone just tilts towards it.
  const webinar = /webinar|masterclass|workshop|live (session|class|training)|info session|seminar/i.test(prompt);
  const vsl = !webinar && /\bvsl\b|video sales|\bapply\b|application|qualif|strategy call|discovery call|high[- ]ticket|book a call|book a demo|product demo|live demo/i.test(prompt);
  const leaning = /consultation/i.test(prompt);
  const quiz = /\bquiz (funnel|page)|\b(a|an) (\w+ )?quiz\b|\bquiz to\b|\bassessment funnel|which .{1,30} is right for (me|you)/i.test(prompt);
  const sells = /₹|\brs\.?\s*\d|\bupsell|\bsell\b|\bcourse\b|\bprogramme\b|\bprogram\b/i.test(prompt);
  const fit = (t) => {
    if (t.type === 'quiz') return quiz ? 2 : 0.1;
    if (quiz) return 0.3; // asked for a quiz: a quiz funnel from another niche still beats a sales page
    if (t.type === 'webinar') return webinar ? (t.steps.some((s) => s.type === 'checkout') || !sells ? 1 : 0.4) : vsl ? 0 : 0.2; // selling after the webinar needs the replay + checkout
    if (t.type === 'vsl') return vsl ? 1 : webinar ? 0 : leaning ? 1.6 : 0.2;
    return webinar || vsl ? 0 : 1;
  };
  const ranked = (pool) => pool.map((d) => [score(d) * fit(d.t), d.t]).sort((x, y) => y[0] - x[0]);
  let best = ranked(docs);
  // no niche word matched: any funnel of the kind asked for beats a sales page from the wrong kind
  if ((webinar || vsl) && !(best[0]?.[0] > 0)) best = docs.filter((d) => fit(d.t) >= 1).map((d) => [0, d.t]);
  if (quiz && !(best[0]?.[0] > 0)) best = docs.filter((d) => d.t.type === 'quiz').map((d) => [0, d.t]);
  return best.slice(0, k).map(([, t]) => t);
}
export const allTemplates = () => TEMPLATES;

// Offline "AI": pick the template whose niche best matches the user's description
export function matchTemplate(prompt) {
  const best = similarTemplates(prompt, 1)[0] || TEMPLATES[0];
  return personalize(getTemplate(best.id), best.name, prompt);
}

// ---------- offline personalisation: use the user's own name, price, city and audience ----------
const MORE_CITIES = ['Noida', 'Gurgaon', 'Gurugram', 'Thane', 'Navi Mumbai', 'Vadodara', 'Rajkot', 'Ludhiana', 'Amritsar', 'Kanpur', 'Varanasi', 'Agra', 'Mysuru', 'Mysore', 'Mangaluru', 'Visakhapatnam', 'Vijayawada', 'Madurai', 'Trichy', 'Thiruvananthapuram', 'Goa', 'Dehradun', 'Ranchi', 'Raipur', 'Guwahati', 'Bhubaneswar', 'Jodhpur', 'Udaipur', 'Nashik', 'Aurangabad', 'Hubli', 'Belagavi', 'Jalandhar', 'Meerut', 'Ghaziabad', 'Faridabad', 'Srinagar', 'Jammu', 'Shimla', 'Siliguri', 'Gwalior', 'Jabalpur', 'Kota', 'Ajmer', 'Allahabad', 'Prayagraj', 'Bareilly', 'Aligarh', 'Moradabad', 'Salem', 'Tiruppur', 'Erode', 'Vellore', 'Warangal', 'Guntur', 'Nellore', 'Kolhapur', 'Solapur', 'Sangli', 'Amravati', 'Cuttack', 'Durgapur', 'Asansol', 'Dhanbad', 'Jamshedpur', 'Bokaro', 'Gaya', 'Bhagalpur', 'Muzaffarpur', 'Gorakhpur', 'Jhansi', 'Haridwar', 'Rishikesh', 'Pondicherry', 'Puducherry', 'Kozhikode', 'Thrissur', 'Kollam'];
const ALL_CITIES = [...CITIES, ...MORE_CITIES, 'Bangalore', 'Calcutta', 'Bombay', 'Madras'];
const SMALL = new Set(['for', 'and', 'of', 'in', 'to', 'with', 'the', 'a', 'an', 'on', 'at', 'by', 'from']);
const titleCase = (s) => s.split(/\s+/).map((w, i) => (i && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1))).join(' ');
const nine = (n) => Math.max(49, Math.round(n / 10) * 10 - 1);

export function parsePrompt(prompt) {
  const raw = prompt.replace(/\s+/g, ' ').trim();
  const pm = raw.match(/(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)\s*(k|l|lakh)?/i) || raw.match(/([\d,]+)\s*(k)?\s*(?:rs\.?|rupees|inr|\/-)/i);
  const mult = (u) => (!u ? 1 : /^k$/i.test(u) ? 1000 : 100000);
  const price = pm ? Math.round(Number(pm[1].replace(/,/g, '')) * mult(pm[2])) : null;
  const city = ALL_CITIES.find((c) => new RegExp(`\\b${c}\\b`, 'i').test(raw)) || null;
  // "for working moms" → an audience; "for a call", "for founders starting out — apply" stop at the verb/dash
  const aud = raw.match(/\bfor ((?!a\b|an\b|the\b|a call)[a-z][a-z\s&-]{2,40}?)(?=,|\.|\s[—–-]\s|\bin\b|\bat\b|\bwith\b|\bwho\b|\bthat\b|\bto\b|\bapply|\bstarting|\bselling|\bupsell|₹|\brs\b|$)/i);
  const audience = aud && aud[1].trim().split(/\s+/).length <= 5 ? aud[1].trim().replace(/\s+/g, ' ') : null;
  // the business name is the first clause, before any dash / colon / call to action
  // ("Free masterclass: how to start a home bakery" → the clause after the colon)
  const clauses = raw.split(/\s[—–-]\s|:|;|\bapply\b|\bbook a\b|\bupsell\b|\bselling\b|\bsell my\b/i).map((s) => s.trim()).filter(Boolean);
  const isFunnelWords = (s) => /^(?:a\s+)?(?:free\s+|live\s+|online\s+)*(?:webinar|masterclass|workshop|session|training)s?$/i.test(s);
  let name = (clauses.find((s) => !isFunnelWords(s)) || '')
    .replace(/^how to (?:start|build|grow|launch|run|get|learn|make)\s+/i, '')
    .replace(pm?.[0] || '\u0000', '')
    .replace(/\b(?:i|we)\s+(?:sell|offer|run|teach|provide|make|am|are|do|have|host)\b/gi, '')
    .replace(/^\s*(?:a\s+)?(?:free|live|online)\s+(?:webinar|masterclass|workshop|session)\s*(?:on|about)?\s*/i, '')
    .replace(/\b(?:my|our|a|an)\b/gi, ' ')
    .replace(city ? new RegExp(`\\b(?:in|at|from)\\s+${city}\\b`, 'i') : /\u0000/, '')
    .replace(audience ? aud[0] : '\u0000', '')
    .replace(/\b(?:delivered|available)\s+(?:across|all over|in)\s+india\b/i, '')
    .replace(/[,.!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  let words = name.split(' ').filter(Boolean).slice(0, 6);
  while (words.length && SMALL.has(words.at(-1).toLowerCase())) words.pop(); // no "Candles at" / "Coaching for"
  name = words.length >= 1 && words.join('').length >= 4 ? titleCase(words.join(' ')) : null;
  return { name, price, city, audience };
}

const priceLike = (v) => /^\s*₹\s*\d[\d,]*\s*$/.test(String(v ?? ''));
const inrStr = (n) => '₹' + Number(n).toLocaleString('en-IN');
// replace one exact amount ("₹5,999") in every piece of copy, without touching ₹59,999 or ₹5,9990
const swapAmount = (v, from, to) => (typeof v === 'string' ? v.split(from).reduce((acc, part, i) => (i === 0 ? part : /^,?\d/.test(part) ? `${acc}${from}${part}` : `${acc}${to}${part}`), '') : v);
function swapEverywhere(obj, from, to) {
  if (!from || from === to) return obj;
  if (typeof obj === 'string') return swapAmount(obj, from, to);
  if (Array.isArray(obj)) return obj.map((x) => swapEverywhere(x, from, to));
  if (obj && typeof obj === 'object') return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, swapEverywhere(v, from, to)]));
  return obj;
}

function personalize(f, templateName, prompt) {
  const { name, price, city, audience } = parsePrompt(prompt);
  let json = JSON.stringify(f);
  if (name && name.toLowerCase() !== templateName.toLowerCase()) json = json.split(templateName).join(name);
  f = JSON.parse(json);
  f.name = name || templateName;
  const blocks = () => f.steps.flatMap((s) => s.blocks);
  const main = blocks().find((b) => b.type === 'checkout') || blocks().find((b) => b.type === 'pricing');
  const oldPrice = Number(main?.props.price || 0), oldMrp = Number(main?.props.mrp || 0);
  if (price && oldPrice) {
    const r = price / oldPrice;
    const newMrp = Math.max(nine(oldMrp * r), price + 1);
    // the amounts written into headlines, sticky bars and calls to action move with the price
    for (const st of f.steps) st.blocks = swapEverywhere(swapEverywhere(swapEverywhere(st.blocks, inrStr(oldPrice), inrStr(price)), inrStr(oldMrp), inrStr(newMrp)), inrStr(oldMrp - oldPrice), inrStr(newMrp - price));
    for (const b of blocks()) {
      const p = b.props;
      if (b.type === 'pricing' || b.type === 'checkout') { p.mrp = newMrp; p.price = price; }
      if (b.type === 'checkout' && p.bumpPrice) { const old = p.bumpPrice; p.bumpPrice = nine(p.bumpPrice * Math.sqrt(r)); if (p.bumpDescription) p.bumpDescription = p.bumpDescription.replace(`₹${old}`, `₹${p.bumpPrice}`).replace(inrStr(old), inrStr(p.bumpPrice)); }
      if (b.type === 'offer') { p.price = nine(p.price * r); p.mrp = Math.max(nine(p.mrp * r), p.price + 1); }
      if (b.type === 'crosssell') p.items = p.items.map((it) => ({ ...it, price: nine(Number(it.price) * r) }));
      if (b.type === 'stickybar' && priceLike(p.price)) p.price = inrStr(price);
      if (b.type === 'hero' && priceLike(p.cardPrice)) { p.cardPrice = inrStr(price); if (priceLike(p.cardMrp)) p.cardMrp = inrStr(newMrp); }
    }
  }
  const hero = blocks().find((b) => b.type === 'hero')?.props;
  // the city goes on a sales page's badge — a webinar's or VSL's badge says what the session / video is
  if (hero && city && ['split', 'center', 'banner', 'editorial', 'bento', undefined].includes(hero.variant)) hero.badge = `📍 Trusted in ${city} & across India`;
  if (hero && audience) hero.subheadline = `${hero.subheadline.replace(/\s*$/, '')} Made for ${audience}.`;
  return f;
}
