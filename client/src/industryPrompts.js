// The dashboard's Hive AI box, per industry (the CRM industry, or the one picked on the dashboard — dashkit.js):
//   chips    — four ready prompts under the box
//   examples — what the box's placeholder cycles through ("e.g. …")
// Ids match crmkits.js / dashkit.js; anything unknown falls back to 'general'.
export const INDUSTRY_PROMPTS = {
  general: {
    chips: ['Webinar funnel for a yoga teacher training', 'Paid 1:1 strategy call with booking', 'Online course launch with an upsell', 'Free guide that grows my email list'],
    examples: ['Online yoga classes for working women, ₹499', 'Stock market course for beginners', 'Public speaking coaching for teens', 'Weight-loss coaching for new mothers', 'Instagram growth masterclass for creators', 'Spoken English course in Hindi'],
  },
  realestate: {
    chips: ['Site visit booking for a new 2 & 3 BHK project', 'Free price list and floor plan download', 'Plot sale landing page with EMI details', 'NRI investor webinar for a launch'],
    examples: ['2 & 3 BHK flats in Wakad, Pune from ₹68 lakh', 'Gated villa plots near Mysuru Road, Bengaluru', 'Commercial shops on Sohna Road, Gurugram', 'Ready-to-move 1 BHK near Thane station', 'Farmhouse plots 40 minutes from Hyderabad', 'Resale flats in Navi Mumbai — free site visit'],
  },
  clinic: {
    chips: ['Book a consultation with online payment', 'Free dental check-up camp sign-up', 'Treatment package page with EMI', 'Health check-up packages with home sample pickup'],
    examples: ['Teeth whitening offer at my Andheri dental clinic', 'IVF consultation at a fertility centre in Jaipur', 'Full body check-up package with home collection', 'Physiotherapy for back pain in Kochi', 'Hair transplant consultation in Delhi', 'Child vaccination booking at a paediatric clinic'],
  },
  consultant: {
    chips: ['Book a free 30-minute strategy call', 'Case study download to capture B2B leads', 'Workshop for small business owners', 'Paid audit with a proposal call'],
    examples: ['Performance marketing agency for D2C brands', 'GST and compliance consulting for startups', 'Lean manufacturing consulting for MSMEs', 'Website design agency for clinics', 'HR policy consulting for growing teams', 'LinkedIn lead generation for B2B founders'],
  },
  education: {
    chips: ['Free demo class registration', 'Scholarship test sign-up with fee offer', 'Admission enquiry page for a new batch', 'Webinar for parents on exam strategy'],
    examples: ['NEET coaching in Kota with a free demo class', 'JEE crash course for droppers', 'UPSC foundation batch with mentorship', 'Class 10 maths tuition in Lucknow', 'IELTS coaching, weekend batches in Pune', 'Abacus classes for kids aged 5–12'],
  },
  fitness: {
    chips: ['Free trial class booking', 'Membership offer with online payment', '21-day transformation challenge', 'Salon package booking for a wedding season'],
    examples: ['Gym membership offer in Indiranagar, ₹1,999/month', 'Bridal makeup and hair package in Jaipur', 'Zumba classes for women, evening batch', 'Unisex salon — first haircut 50% off', 'CrossFit 6-week fat loss programme', 'Ayurvedic spa and massage packages in Goa'],
  },
  finance: {
    chips: ['Free financial health check call', 'Term insurance quote request', 'Home loan eligibility check', 'Retirement planning webinar'],
    examples: ['Mutual fund SIP advice for salaried families', 'Term insurance for young parents', 'Home loan with the best bank rates in Chennai', 'Tax-saving investments before March', 'Health insurance for senior citizens', 'Business loans for small shop owners'],
  },
  interior: {
    chips: ['Free design consultation booking', 'Modular kitchen quote request', 'Portfolio page with a site-visit form', '2 BHK interior package with price'],
    examples: ['Modular kitchens in Hyderabad from ₹1.5 lakh', 'Full 3 BHK interiors in 45 days, Bengaluru', 'Office interior design for startups', 'Wardrobe and false ceiling packages in Pune', 'Vastu-friendly home interiors in Ahmedabad', 'Architect for independent houses in Coimbatore'],
  },
  events: {
    chips: ['Wedding package enquiry with date check', 'Portfolio page with a booking call', 'Destination wedding planning webinar', 'Birthday and corporate event quote form'],
    examples: ['Candid wedding photography in Udaipur', 'Destination weddings in Goa and Jaipur', 'Mehendi and sangeet décor packages', 'Corporate offsite planning in Lonavala', 'Kids birthday party planner in Mumbai', 'Pre-wedding shoot packages in Rishikesh'],
  },
  travel: {
    chips: ['Tour package page with booking', 'Group trip sign-up with a deposit', 'Honeymoon package enquiry', 'Free itinerary consultation call'],
    examples: ['6-day Kashmir tour package from Delhi', 'Bali honeymoon package for couples', 'Char Dham yatra group tour', 'Weekend treks from Bengaluru', 'Dubai family holiday with visa help', 'Kerala backwaters and Munnar tour'],
  },
  auto: {
    chips: ['Test drive booking', 'Exchange offer with a valuation form', 'Easy EMI finance enquiry', 'Service booking with a free check-up'],
    examples: ['Test drive for a new SUV in Pune', 'Used cars with warranty in Delhi NCR', 'Electric scooter launch offer in Bengaluru', 'Bike service and free check-up camp', 'Exchange old car for a new hatchback', 'Commercial vehicle finance for fleet owners'],
  },
  professional: {
    chips: ['Book a consultation with a fee', 'GST registration service page', 'Free tax filing checklist download', 'Company registration package'],
    examples: ['ITR filing for salaried employees, ₹999', 'Private limited company registration in 7 days', 'Trademark registration for small brands', 'Property dispute legal consultation', 'GST returns for small traders monthly', 'Startup legal and compliance package'],
  },
  recruitment: {
    chips: ['Hiring enquiry form for employers', 'Job seeker sign-up with CV upload', 'Bulk hiring proposal call', 'Campus hiring drive registration'],
    examples: ['IT staffing for startups in Bengaluru', 'Blue-collar hiring for warehouses', 'Nurses for hospitals across Kerala', 'Sales team hiring for FMCG brands', 'Overseas jobs in Gulf countries', 'Executive search for CXO roles'],
  },
  homeservices: {
    chips: ['Free site survey booking', 'Rooftop solar savings calculator page', 'Annual maintenance contract offer', 'Quote request with photo upload'],
    examples: ['Rooftop solar installation in Pune with subsidy', 'Water purifier AMC in Chennai', 'Home deep cleaning in Gurugram', 'Pest control for homes and offices', 'AC servicing before summer, ₹499', 'Inverter and battery installation in Lucknow'],
  },
  hospitality: {
    chips: ['Direct room booking with an offer', 'Weekend getaway package', 'Restaurant table booking and menu', 'Banquet hall enquiry for events'],
    examples: ['Homestay in Coorg — direct booking 10% off', 'Boutique hotel in Rishikesh near the ghats', 'Café with a weekend brunch in Bandra', 'Resort weekend package near Lonavala', 'Banquet hall for weddings in Indore', 'Cloud kitchen biryani delivery in Hyderabad'],
  },
  manufacturer: {
    chips: ['Dealer enquiry page with a price list download', 'Request a quotation for bulk orders', 'Become a distributor in your city', 'Product catalogue with a sample request'],
    examples: ['PVC pipes and fittings manufacturer in Rajkot looking for dealers', 'Steel almirahs for offices and hostels, bulk orders', 'Ayurvedic oils — private label manufacturing', 'Corrugated boxes for e-commerce sellers in Delhi NCR', 'Solar water heaters — distributors wanted in Maharashtra', 'Cotton fabric mill — sample swatches for garment exporters'],
  },
  retailer: {
    chips: ['Festival sale page with a store visit booking', 'New arrivals with WhatsApp ordering', 'Exchange offer for old appliances', 'Bridal or wedding shopping appointment'],
    examples: ['Electronics showroom in Indore — Diwali exchange offer', 'Saree shop in Surat with home delivery', 'Furniture store in Pune — sofa sets with free installation', 'Mobile shop with easy EMI in Lucknow', 'Jewellery showroom — wedding collection appointments', 'Kids’ clothing store opening offer in Bhopal'],
  },
  distributor: {
    chips: ['Rate list download for retailers', 'Retailer sign-up with the first-order scheme', 'Bulk order enquiry for institutions', 'Monthly scheme page for dealers'],
    examples: ['FMCG distributor in Nagpur — retailer sign-up with a scheme', 'Cement and steel trader for contractors in Hyderabad', 'Pharma distributor for chemists in Kolkata', 'Electrical goods wholesaler — daily rate list', 'Tiles and sanitaryware dealer for builders', 'Stationery wholesaler for schools and offices'],
  },
  store: {
    chips: ['Product launch page with Cash on Delivery', 'Combo offer with an order bump', 'Festive sale page for Diwali', 'Free sample with shipping fee'],
    examples: ['Homemade mango pickles delivered across India', 'Handloom cotton sarees from Bengal', 'Cold-pressed hair oil with COD', 'Organic millet snacks for kids', 'Silver jewellery for everyday wear', 'Ayurvedic skincare combo for acne'],
  },
  abroad: {
    chips: ['Free counselling session booking', 'IELTS + admission package', 'Country guide download for students', 'Visa assessment for families'],
    examples: ['MS in Germany with low tuition', 'Study MBBS in Russia — admission help', 'Canada PR assessment for families', 'UK masters intake for September', 'Australia student visa guidance', 'IELTS coaching with university shortlisting'],
  },
  wellness: {
    chips: ['Paid consultation booking', 'Free birth chart reading sign-up', 'Healing workshop registration', 'Monthly membership for live sessions'],
    examples: ['Vedic astrology consultation on call, ₹1,100', 'Reiki level 1 workshop this weekend', 'Tarot card reading online', 'Meditation course for anxiety and sleep', 'Numerology report for a new business name', 'Sound healing sessions in Rishikesh'],
  },
  saas: {
    chips: ['Free trial sign-up page', 'Book a product demo', 'Pricing page with annual discount', 'Webinar on a new feature launch'],
    examples: ['Billing and GST invoicing app for shops', 'School management software with a free trial', 'Restaurant POS for cloud kitchens', 'WhatsApp CRM for real estate brokers', 'HRMS and payroll for small teams', 'Clinic appointment software with reminders'],
  },
  ngo: {
    chips: ['Donation page with 80G receipt', 'Monthly giving sign-up', 'Volunteer registration drive', 'Fundraiser for a specific cause'],
    examples: ['Educate a girl child for ₹1,200 a month', 'Meals for stray dogs in Bengaluru', 'Flood relief kits for families in Assam', 'Tree plantation drive in Delhi NCR', 'Free eye surgeries for elderly villagers', 'Skill training for rural women'],
  },
};
export const promptsFor = (id) => INDUSTRY_PROMPTS[id] || INDUSTRY_PROMPTS.general;
