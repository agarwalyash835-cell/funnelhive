// CRM kits: the CRM shaped for a kind of business — its words (Patients, Buyers, Clients), its fields (budget and
// BHK for property, next appointment for a clinic), its pipeline stages, the columns and board cards that matter,
// quick filters and the money field the board totals. Switching kits never deletes data: fields from an earlier
// kit stay on the contacts (and in Custom fields); only what's shown changes. AI can design a kit from a description.
import { T, uid } from './db.js';
import { pipelinesFor, FIELD_TYPES, ensureMeta, ensureContact, logActivity } from './crm.js';
import { fire as fireAutomation } from './automations.js';
import { sellerTz, localYmd } from './tz.js';
import { aiEnabled, aiJson } from './ai.js';

const S = (name, color, flag) => ({ name, color, ...(flag ? { [flag]: true } : {}) });
const sel = (id, label, options) => ({ id, label, type: 'select', options });
const f = (id, label, type = 'text') => ({ id, label, type });

export const KITS = [
  {
    id: 'general', name: 'Coach & creator', icon: '🎯', desc: 'Leads from your funnels, customers from checkouts, lifetime value — the standard FunnelHive CRM.',
    labels: { title: 'Contacts', one: 'contact', customers: 'Customers', leads: 'Leads', value: 'Lifetime value' },
    fields: [], pipeline: null, columns: [], cardFields: [], filters: [], valueField: null, showSales: true,
  },
  {
    id: 'realestate', name: 'Real estate builder / broker', icon: '🏠', desc: 'Budget, BHK, location and site visits — from portal enquiry to booking.',
    labels: { title: 'Leads', one: 'lead', customers: 'Buyers', leads: 'Prospects', value: 'Budget' },
    fields: [
      f('re_budget', 'Budget (₹)', 'money'), sel('re_type', 'Property type', 'Apartment, Villa, Plot, Row house, Commercial shop, Office space'),
      sel('re_bhk', 'BHK', '1 RK, 1 BHK, 2 BHK, 3 BHK, 4 BHK, 5+ BHK'), f('re_location', 'Preferred location'), f('re_project', 'Project / property'),
      sel('re_purpose', 'Purpose', 'Self use, Investment, Rent / lease'), sel('re_timeline', 'Buying in', 'Immediately, 1–3 months, 3–6 months, 6+ months'),
      f('re_visit', 'Site visit', 'date'), sel('re_loan', 'Home loan', 'Needed, Not needed, Pre-approved'),
      sel('re_from', 'Enquiry from', '99acres, MagicBricks, Housing.com, Facebook ads, Google ads, Walk-in, Referral, Channel partner, Website'),
    ],
    pipeline: { name: 'Property sales', stages: [S('New enquiry', '#6366f1'), S('Contacted', '#0ea5e9'), S('Site visit scheduled', '#f59e0b'), S('Site visit done', '#8b5cf6'), S('Negotiation', '#ec4899'), S('Booking done', '#16a34a', 'won'), S('Lost', '#94a3b8', 'lost')] },
    columns: ['re_budget', 're_bhk', 're_location', 're_visit'], cardFields: ['re_budget', 're_bhk', 're_location'], filters: ['re_type', 're_bhk', 're_timeline', 're_from'], valueField: 're_budget', showSales: false,
  },
  {
    id: 'clinic', name: 'Clinic & healthcare', icon: '🩺', desc: 'Patients, concerns, doctors, next appointments and follow-ups.',
    labels: { title: 'Patients', one: 'patient', customers: 'Patients', leads: 'Enquiries', value: 'Treatment value' },
    fields: [
      f('cl_concern', 'Concern / reason for visit'), f('cl_doctor', 'Doctor'), f('cl_next', 'Next appointment', 'date'), f('cl_last', 'Last visit', 'date'),
      f('cl_dob', 'Date of birth', 'date'), sel('cl_gender', 'Gender', 'Female, Male, Other'), f('cl_plan', 'Treatment plan', 'longtext'),
      f('cl_value', 'Treatment value (₹)', 'money'), sel('cl_pay', 'Payment', 'Self pay, Insurance, Corporate'),
      sel('cl_from', 'Found us via', 'Google, Practo, Instagram, Facebook ads, Referral, Walk-in, Website'),
    ],
    pipeline: { name: 'Patient journey', stages: [S('New enquiry', '#6366f1'), S('Appointment booked', '#0ea5e9'), S('Consulted', '#8b5cf6'), S('In treatment', '#f59e0b'), S('Follow-up due', '#ec4899'), S('Treatment completed', '#16a34a', 'won'), S('Not proceeding', '#94a3b8', 'lost')] },
    columns: ['cl_concern', 'cl_next', 'cl_doctor', 'cl_last'], cardFields: ['cl_concern', 'cl_next'], filters: ['cl_gender', 'cl_pay', 'cl_from'], valueField: 'cl_value', showSales: false,
    note: 'Health details are personal data: record only what you need for care, and patients can ask you to erase them.',
  },
  {
    id: 'consultant', name: 'Consultant / agency / B2B', icon: '💼', desc: 'Companies, decision makers, proposals and deal values.',
    labels: { title: 'Clients', one: 'client', customers: 'Clients', leads: 'Prospects', value: 'Deal value' },
    fields: [
      f('co_company', 'Company'), f('co_role', 'Role / designation'), sel('co_industry', 'Industry', 'IT & software, Manufacturing, Retail, Healthcare, Education, Finance, Real estate, Hospitality, Other'),
      sel('co_size', 'Company size', '1–10, 11–50, 51–200, 201–1000, 1000+'), sel('co_service', 'Interested in', 'Strategy, Marketing, Sales, Finance, HR, Technology, Operations'),
      f('co_value', 'Deal value (₹)', 'money'), f('co_proposal', 'Proposal sent', 'date'), f('co_close', 'Expected close', 'date'), f('co_site', 'Website', 'url'),
    ],
    pipeline: { name: 'B2B sales', stages: [S('Lead', '#6366f1'), S('Discovery call', '#0ea5e9'), S('Proposal sent', '#f59e0b'), S('Negotiation', '#ec4899'), S('Won', '#16a34a', 'won'), S('Lost', '#94a3b8', 'lost')] },
    columns: ['co_company', 'co_service', 'co_value', 'co_close'], cardFields: ['co_company', 'co_value'], filters: ['co_industry', 'co_size', 'co_service'], valueField: 'co_value', showSales: false,
  },
  {
    id: 'education', name: 'Coaching institute / admissions', icon: '🎓', desc: 'Enquiries, counselling, demo classes, batches and fees.',
    labels: { title: 'Students', one: 'student', customers: 'Enrolled', leads: 'Enquiries', value: 'Fee' },
    fields: [
      f('ed_student', 'Student name'), sel('ed_course', 'Class / course', 'Class 6–8, Class 9–10, Class 11–12, JEE, NEET, UPSC, CA / CS, Spoken English, Other'),
      f('ed_parent', 'Parent / guardian'), f('ed_demo', 'Demo class', 'date'), f('ed_batch', 'Batch'), sel('ed_mode', 'Mode', 'Offline, Online, Hybrid'),
      f('ed_fee', 'Fee (₹)', 'money'), sel('ed_from', 'Enquiry from', 'Google, Instagram, Facebook ads, JustDial, Referral, Walk-in, School tie-up, Website'),
    ],
    pipeline: { name: 'Admissions', stages: [S('Enquiry', '#6366f1'), S('Counselling done', '#0ea5e9'), S('Demo class', '#f59e0b'), S('Fee discussion', '#ec4899'), S('Admitted', '#16a34a', 'won'), S('Lost', '#94a3b8', 'lost')] },
    columns: ['ed_course', 'ed_demo', 'ed_batch', 'ed_fee'], cardFields: ['ed_course', 'ed_demo'], filters: ['ed_course', 'ed_mode', 'ed_from'], valueField: 'ed_fee', showSales: false,
  },
  {
    id: 'fitness', name: 'Gym, salon & wellness', icon: '💪', desc: 'Trials, memberships, plans and renewals.',
    labels: { title: 'Members', one: 'member', customers: 'Members', leads: 'Enquiries', value: 'Plan value' },
    fields: [
      sel('fi_goal', 'Goal', 'Weight loss, Muscle gain, General fitness, Flexibility, Skin & hair, Relaxation'),
      sel('fi_plan', 'Plan', 'Monthly, Quarterly, Half-yearly, Yearly, Per session'), f('fi_value', 'Plan value (₹)', 'money'),
      f('fi_trial', 'Trial visit', 'date'), f('fi_start', 'Plan start', 'date'), f('fi_renew', 'Renewal due', 'date'), f('fi_trainer', 'Trainer / stylist'),
    ],
    pipeline: { name: 'Memberships', stages: [S('Enquiry', '#6366f1'), S('Trial booked', '#0ea5e9'), S('Trial done', '#f59e0b'), S('Joined', '#16a34a', 'won'), S('Renewal due', '#ec4899'), S('Lost', '#94a3b8', 'lost')] },
    columns: ['fi_goal', 'fi_plan', 'fi_renew', 'fi_trainer'], cardFields: ['fi_plan', 'fi_renew'], filters: ['fi_goal', 'fi_plan'], valueField: 'fi_value', showSales: false,
  },
  {
    id: 'finance', name: 'Financial advisor / insurance / loans', icon: '📈', desc: 'Products, ticket sizes, documents and follow-ups.',
    labels: { title: 'Clients', one: 'client', customers: 'Clients', leads: 'Leads', value: 'Ticket size' },
    fields: [
      sel('fa_product', 'Product', 'Mutual funds / SIP, Life insurance, Health insurance, Home loan, Personal loan, Business loan, Tax filing, Wealth management'),
      f('fa_amount', 'Amount (₹)', 'money'), sel('fa_income', 'Monthly income', 'Under ₹25k, ₹25k–50k, ₹50k–1L, ₹1L–3L, Over ₹3L'), f('fa_age', 'Age', 'number'),
      f('fa_city', 'City'), f('fa_follow', 'Next follow-up', 'date'), sel('fa_docs', 'Documents', 'Pending, Partly received, Complete'),
    ],
    pipeline: { name: 'Advisory pipeline', stages: [S('New lead', '#6366f1'), S('Contacted', '#0ea5e9'), S('Needs analysis', '#8b5cf6'), S('Proposal shared', '#f59e0b'), S('Documents', '#ec4899'), S('Closed', '#16a34a', 'won'), S('Lost', '#94a3b8', 'lost')] },
    columns: ['fa_product', 'fa_amount', 'fa_follow', 'fa_docs'], cardFields: ['fa_product', 'fa_amount'], filters: ['fa_product', 'fa_income', 'fa_docs'], valueField: 'fa_amount', showSales: false,
  },
  {
    id: 'interior', name: 'Interior designer / architect', icon: '🛋️', desc: 'Site measurements, design fee, 3D approvals and execution.',
    labels: { title: 'Projects', one: 'project', customers: 'Clients', leads: 'Enquiries', value: 'Project value' },
    fields: [
      sel('in_scope', 'Scope', 'Full home, Kitchen, Bedroom, Living room, Office, Commercial space, Renovation'), sel('in_home', 'Home type', '1 BHK, 2 BHK, 3 BHK, 4+ BHK, Villa, Office, Shop'),
      f('in_value', 'Project value (₹)', 'money'), f('in_site', 'Site address'), f('in_measure', 'Site measurement', 'date'), f('in_handover', 'Handover by', 'date'),
      sel('in_style', 'Style', 'Modern, Contemporary, Minimal, Traditional, Industrial, Luxury'), sel('in_from', 'Found us via', 'Instagram, Houzz, Google, Referral, Builder tie-up, Website'),
    ],
    pipeline: { name: 'Design projects', stages: [S('Enquiry', '#6366f1'), S('Site visit', '#0ea5e9'), S('Design & quote', '#8b5cf6'), S('3D approval', '#f59e0b'), S('Signed', '#16a34a', 'won'), S('In execution', '#14b8a6'), S('Lost', '#94a3b8', 'lost')] },
    columns: ['in_scope', 'in_value', 'in_measure', 'in_handover'], cardFields: ['in_scope', 'in_value'], filters: ['in_scope', 'in_style', 'in_from'], valueField: 'in_value', showSales: false,
  },
  {
    id: 'events', name: 'Wedding & event planner / photographer', icon: '💍', desc: 'Event dates, venues, packages and advances.',
    labels: { title: 'Events', one: 'event', customers: 'Booked clients', leads: 'Enquiries', value: 'Package value' },
    fields: [
      sel('ev_type', 'Event', 'Wedding, Pre-wedding, Engagement, Birthday, Corporate, Baby shower, Other'), f('ev_date', 'Event date', 'date'), f('ev_venue', 'Venue / city'),
      f('ev_guests', 'Guests', 'number'), sel('ev_pkg', 'Package', 'Basic, Standard, Premium, Custom'), f('ev_value', 'Package value (₹)', 'money'), f('ev_adv', 'Advance paid (₹)', 'money'),
      sel('ev_from', 'Found us via', 'Instagram, WedMeGood, Google, Referral, Venue tie-up, Website'),
    ],
    pipeline: { name: 'Event bookings', stages: [S('Enquiry', '#6366f1'), S('Call / meeting', '#0ea5e9'), S('Quote sent', '#f59e0b'), S('Advance paid', '#16a34a', 'won'), S('Event done', '#14b8a6'), S('Lost', '#94a3b8', 'lost')] },
    columns: ['ev_type', 'ev_date', 'ev_venue', 'ev_value'], cardFields: ['ev_date', 'ev_value'], filters: ['ev_type', 'ev_pkg', 'ev_from'], valueField: 'ev_value', showSales: false,
  },
  {
    id: 'travel', name: 'Travel agency / tour operator', icon: '✈️', desc: 'Destinations, travel dates, travellers and quotes.',
    labels: { title: 'Trips', one: 'trip', customers: 'Travellers', leads: 'Enquiries', value: 'Trip value' },
    fields: [
      f('tr_dest', 'Destination'), sel('tr_kind', 'Trip type', 'Honeymoon, Family, Group tour, Corporate, Pilgrimage, Adventure, Visa only'), f('tr_date', 'Travel date', 'date'),
      f('tr_pax', 'Travellers', 'number'), f('tr_nights', 'Nights', 'number'), f('tr_value', 'Trip value (₹)', 'money'), sel('tr_scope', 'Domestic / international', 'Domestic, International'),
      sel('tr_from', 'Found us via', 'Instagram, Google, Facebook ads, Referral, Walk-in, Website'),
    ],
    pipeline: { name: 'Trip bookings', stages: [S('Enquiry', '#6366f1'), S('Itinerary sent', '#0ea5e9'), S('Negotiation', '#f59e0b'), S('Booked', '#16a34a', 'won'), S('Travelled', '#14b8a6'), S('Lost', '#94a3b8', 'lost')] },
    columns: ['tr_dest', 'tr_date', 'tr_pax', 'tr_value'], cardFields: ['tr_dest', 'tr_date'], filters: ['tr_kind', 'tr_scope', 'tr_from'], valueField: 'tr_value', showSales: false,
  },
  {
    id: 'auto', name: 'Car / bike dealership', icon: '🚗', desc: 'Models, test drives, finance and deliveries.',
    labels: { title: 'Leads', one: 'lead', customers: 'Owners', leads: 'Prospects', value: 'Deal value' },
    fields: [
      f('au_model', 'Model'), f('au_variant', 'Variant / colour'), sel('au_fuel', 'Fuel', 'Petrol, Diesel, CNG, Electric, Hybrid'), f('au_value', 'Deal value (₹)', 'money'),
      f('au_test', 'Test drive', 'date'), sel('au_fin', 'Finance', 'Loan needed, Cash, Pre-approved'), sel('au_exch', 'Exchange', 'Yes, No'), f('au_deliv', 'Delivery date', 'date'),
      sel('au_from', 'Enquiry from', 'Walk-in, CarDekho, CarWale, Facebook ads, Google ads, Referral, Website'),
    ],
    pipeline: { name: 'Vehicle sales', stages: [S('Enquiry', '#6366f1'), S('Test drive', '#0ea5e9'), S('Quotation', '#f59e0b'), S('Finance / docs', '#8b5cf6'), S('Booked', '#16a34a', 'won'), S('Delivered', '#14b8a6'), S('Lost', '#94a3b8', 'lost')] },
    columns: ['au_model', 'au_value', 'au_test', 'au_fin'], cardFields: ['au_model', 'au_value'], filters: ['au_fuel', 'au_fin', 'au_from'], valueField: 'au_value', showSales: false,
  },
  {
    id: 'professional', name: 'CA / lawyer / professional firm', icon: '⚖️', desc: 'Services, matters, fees, deadlines and documents.',
    labels: { title: 'Clients', one: 'client', customers: 'Clients', leads: 'Enquiries', value: 'Fees' },
    fields: [
      sel('pf_service', 'Service', 'GST, Income tax, Audit, Company registration, Accounting, Legal notice, Litigation, Contracts, Trademark, Other'),
      f('pf_matter', 'Matter / reference'), f('pf_fee', 'Fees (₹)', 'money'), f('pf_due', 'Deadline / hearing', 'date'),
      sel('pf_docs', 'Documents', 'Pending, Partly received, Complete'), sel('pf_entity', 'Client type', 'Individual, Proprietorship, Partnership / LLP, Company, Trust / NGO'),
    ],
    pipeline: { name: 'Engagements', stages: [S('Enquiry', '#6366f1'), S('Consultation', '#0ea5e9'), S('Fee quote', '#f59e0b'), S('Engaged', '#16a34a', 'won'), S('In progress', '#8b5cf6'), S('Completed', '#14b8a6'), S('Lost', '#94a3b8', 'lost')] },
    columns: ['pf_service', 'pf_fee', 'pf_due', 'pf_docs'], cardFields: ['pf_service', 'pf_due'], filters: ['pf_service', 'pf_docs', 'pf_entity'], valueField: 'pf_fee', showSales: false,
  },
  {
    id: 'recruitment', name: 'Recruitment / staffing', icon: '🧑‍💼', desc: 'Candidates, roles, CTC, interviews and joining.',
    labels: { title: 'Candidates', one: 'candidate', customers: 'Placed', leads: 'In process', value: 'Expected CTC' },
    fields: [
      f('rc_role', 'Role applied for'), f('rc_company', 'Client company'), f('rc_exp', 'Experience (years)', 'number'), f('rc_ctc', 'Expected CTC (₹)', 'money'),
      sel('rc_notice', 'Notice period', 'Immediate, 15 days, 30 days, 60 days, 90 days'), f('rc_interview', 'Interview', 'date'), f('rc_city', 'City'), f('rc_cv', 'CV link', 'url'),
    ],
    pipeline: { name: 'Hiring', stages: [S('Sourced', '#6366f1'), S('Screened', '#0ea5e9'), S('Interview', '#f59e0b'), S('Offer', '#8b5cf6'), S('Joined', '#16a34a', 'won'), S('Dropped', '#94a3b8', 'lost')] },
    columns: ['rc_role', 'rc_company', 'rc_ctc', 'rc_interview'], cardFields: ['rc_role', 'rc_notice'], filters: ['rc_notice'], valueField: 'rc_ctc', showSales: false,
  },
  {
    id: 'homeservices', name: 'Solar / home services / installer', icon: '🔧', desc: 'Site surveys, quotes, installation and service dates.',
    labels: { title: 'Jobs', one: 'job', customers: 'Customers', leads: 'Enquiries', value: 'Quote value' },
    fields: [
      sel('hs_service', 'Service', 'Solar rooftop, Water purifier, AC, Home automation, Pest control, Painting, Plumbing, Electrical, CCTV, Other'),
      f('hs_address', 'Site address'), f('hs_survey', 'Site survey', 'date'), f('hs_value', 'Quote value (₹)', 'money'), f('hs_install', 'Installation date', 'date'),
      f('hs_amc', 'Next service / AMC', 'date'), sel('hs_prop', 'Property', 'Independent house, Apartment, Society, Shop / office, Factory'),
    ],
    pipeline: { name: 'Installations', stages: [S('Enquiry', '#6366f1'), S('Site survey', '#0ea5e9'), S('Quote sent', '#f59e0b'), S('Order confirmed', '#16a34a', 'won'), S('Installed', '#14b8a6'), S('Lost', '#94a3b8', 'lost')] },
    columns: ['hs_service', 'hs_survey', 'hs_value', 'hs_amc'], cardFields: ['hs_service', 'hs_value'], filters: ['hs_service', 'hs_prop'], valueField: 'hs_value', showSales: false,
  },
  {
    id: 'hospitality', name: 'Hotel / homestay / restaurant', icon: '🏨', desc: 'Check-ins, guests, room or event bookings and repeat visits.',
    labels: { title: 'Guests', one: 'guest', customers: 'Guests', leads: 'Enquiries', value: 'Booking value' },
    fields: [
      sel('ho_kind', 'Booking for', 'Stay, Table, Banquet / party, Corporate event, Catering'), f('ho_in', 'Check-in / date', 'date'), f('ho_out', 'Check-out', 'date'),
      f('ho_pax', 'Guests', 'number'), f('ho_value', 'Booking value (₹)', 'money'), sel('ho_from', 'Booked via', 'Direct / website, Phone, Walk-in, MakeMyTrip, Booking.com, Airbnb, Zomato, Instagram'),
      f('ho_pref', 'Preferences', 'longtext'),
    ],
    pipeline: { name: 'Bookings', stages: [S('Enquiry', '#6366f1'), S('Quote sent', '#0ea5e9'), S('Confirmed', '#16a34a', 'won'), S('Checked in', '#f59e0b'), S('Completed', '#14b8a6'), S('Cancelled', '#94a3b8', 'lost')] },
    columns: ['ho_kind', 'ho_in', 'ho_pax', 'ho_value'], cardFields: ['ho_in', 'ho_value'], filters: ['ho_kind', 'ho_from'], valueField: 'ho_value', showSales: false,
  },
  {
    id: 'store', name: 'D2C brand / online store', icon: '🛍️', desc: 'Orders, COD confirmation, deliveries, repeat buyers and reviews.',
    labels: { title: 'Customers', one: 'customer', customers: 'Buyers', leads: 'Shoppers', value: 'Order value' },
    fields: [
      f('st_product', 'Product interested in'), f('st_city', 'City'), sel('st_pay', 'Payment', 'Prepaid, Cash on delivery'),
      f('st_delivery', 'Expected delivery', 'date'), f('st_reorder', 'Reorder due', 'date'), sel('st_review', 'Review', 'Not asked, Asked, Given'),
      sel('st_from', 'Came from', 'Instagram, Facebook ads, Google, WhatsApp, Influencer, Marketplace, Referral'),
    ],
    pipeline: { name: 'Orders', stages: [S('Interested', '#6366f1'), S('COD to confirm', '#f59e0b'), S('Ordered', '#0ea5e9'), S('Delivered', '#16a34a', 'won'), S('Repeat buyer', '#14b8a6'), S('Returned / RTO', '#94a3b8', 'lost')] },
    columns: ['st_product', 'st_pay', 'st_delivery', 'st_review'], cardFields: ['st_product', 'st_pay'], filters: ['st_pay', 'st_review', 'st_from'], valueField: null, showSales: true,
  },
  {
    id: 'abroad', name: 'Study abroad / immigration', icon: '🎓', desc: 'Countries, courses, test scores, applications and visas.',
    labels: { title: 'Students', one: 'student', customers: 'Enrolled', leads: 'Enquiries', value: 'Service fee' },
    fields: [
      sel('ab_country', 'Country', 'Canada, UK, USA, Australia, Germany, Ireland, New Zealand, Dubai, Other'), f('ab_course', 'Course / visa type'),
      sel('ab_intake', 'Intake', 'Jan, May, Sep, Other'), sel('ab_test', 'English test', 'Not taken, IELTS, PTE, TOEFL, Duolingo'), f('ab_score', 'Test score'),
      f('ab_budget', 'Budget (₹)', 'money'), f('ab_fee', 'Service fee (₹)', 'money'), f('ab_deadline', 'Application deadline', 'date'),
      sel('ab_visa', 'Visa status', 'Not started, Documents, Applied, Approved, Refused'),
    ],
    pipeline: { name: 'Applications', stages: [S('Enquiry', '#6366f1'), S('Counselling', '#0ea5e9'), S('Documents', '#8b5cf6'), S('Applied', '#f59e0b'), S('Offer letter', '#ec4899'), S('Visa approved', '#16a34a', 'won'), S('Dropped', '#94a3b8', 'lost')] },
    columns: ['ab_country', 'ab_intake', 'ab_test', 'ab_deadline'], cardFields: ['ab_country', 'ab_intake'], filters: ['ab_country', 'ab_intake', 'ab_visa'], valueField: 'ab_fee', showSales: false,
  },
  {
    id: 'wellness', name: 'Astrology / healing / wellness', icon: '🔮', desc: 'Consultations, birth details, sessions and packages.',
    labels: { title: 'Clients', one: 'client', customers: 'Clients', leads: 'Enquiries', value: 'Package value' },
    fields: [
      sel('we_service', 'Service', 'Astrology, Numerology, Tarot, Vastu, Reiki, Life coaching, Counselling, Yoga / meditation, Other'),
      f('we_dob', 'Date of birth', 'date'), f('we_tob', 'Time of birth'), f('we_pob', 'Place of birth'), f('we_concern', 'Concern', 'longtext'),
      f('we_session', 'Next session', 'date'), sel('we_package', 'Package', 'Single session, 3 sessions, Monthly, Yearly'), f('we_value', 'Package value (₹)', 'money'),
    ],
    pipeline: { name: 'Consultations', stages: [S('Enquiry', '#6366f1'), S('Consultation booked', '#0ea5e9'), S('Consulted', '#8b5cf6'), S('Package bought', '#16a34a', 'won'), S('Follow-up', '#f59e0b'), S('Not proceeding', '#94a3b8', 'lost')] },
    columns: ['we_service', 'we_session', 'we_package', 'we_value'], cardFields: ['we_service', 'we_session'], filters: ['we_service', 'we_package'], valueField: 'we_value', showSales: false,
  },
  {
    id: 'saas', name: 'SaaS / software', icon: '💻', desc: 'Demos, trials, plans, seats and renewals.',
    labels: { title: 'Accounts', one: 'account', customers: 'Customers', leads: 'Trials & leads', value: 'Annual value' },
    fields: [
      f('sa_company', 'Company'), sel('sa_size', 'Team size', '1–10, 11–50, 51–200, 201–1000, 1000+'), f('sa_demo', 'Demo', 'date'),
      f('sa_trial', 'Trial ends', 'date'), sel('sa_plan', 'Plan', 'Free, Starter, Growth, Pro, Enterprise'), f('sa_seats', 'Seats', 'number'),
      f('sa_value', 'Annual value (₹)', 'money'), f('sa_renew', 'Renewal date', 'date'),
    ],
    pipeline: { name: 'SaaS sales', stages: [S('Lead', '#6366f1'), S('Demo booked', '#0ea5e9'), S('Trial', '#8b5cf6'), S('Proposal', '#f59e0b'), S('Customer', '#16a34a', 'won'), S('Churned / lost', '#94a3b8', 'lost')] },
    columns: ['sa_company', 'sa_plan', 'sa_trial', 'sa_value'], cardFields: ['sa_company', 'sa_plan'], filters: ['sa_size', 'sa_plan'], valueField: 'sa_value', showSales: false,
  },
  {
    id: 'ngo', name: 'NGO / donations', icon: '🤝', desc: 'Donors, causes, recurring gifts, 80G receipts and volunteers.',
    labels: { title: 'Supporters', one: 'supporter', customers: 'Donors', leads: 'Supporters', value: 'Donated' },
    fields: [
      sel('ng_cause', 'Cause', 'Education, Health, Food, Animals, Environment, Disaster relief, General'), f('ng_amount', 'Donated (₹)', 'money'),
      sel('ng_type', 'Giving', 'One-time, Monthly, Yearly'), sel('ng_80g', '80G receipt', 'Not needed, Pending, Sent'),
      f('ng_next', 'Next gift / reminder', 'date'), sel('ng_role', 'Role', 'Donor, Volunteer, Both'),
    ],
    pipeline: { name: 'Donor journey', stages: [S('New supporter', '#6366f1'), S('First gift', '#16a34a', 'won'), S('Monthly donor', '#14b8a6'), S('Lapsed', '#f59e0b'), S('Not interested', '#94a3b8', 'lost')] },
    columns: ['ng_cause', 'ng_amount', 'ng_type', 'ng_80g'], cardFields: ['ng_cause', 'ng_amount'], filters: ['ng_cause', 'ng_type', 'ng_80g'], valueField: 'ng_amount', showSales: true,
  },
];
const kitById = (id) => KITS.find((k) => k.id === id) || null;

// ---------- a kit from anywhere (AI, the user) is cleaned before it's used ----------
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#f59e0b', '#ec4899', '#8b5cf6', '#16a34a', '#94a3b8'];
export function cleanKit(k) {
  if (!k || typeof k !== 'object') return null;
  const slug = (s) => str(s, 30).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 16);
  const fields = (Array.isArray(k.fields) ? k.fields : []).slice(0, 16).map((x) => {
    const type = FIELD_TYPES.includes(x?.type) ? x.type : 'text';
    const label = str(x?.label, 60);
    return label ? { id: str(x?.id, 20).replace(/[^\w-]/g, '') || `ck_${slug(label)}`, label, type, ...(type === 'select' ? { options: (Array.isArray(x.options) ? x.options.join(', ') : str(x.options, 600)) || 'Option 1, Option 2' } : {}) } : null;
  }).filter(Boolean).filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i);
  const ids = new Set(fields.map((x) => x.id));
  const pick = (list, n, ok = () => true) => (Array.isArray(list) ? list : []).map(String).filter((id) => ids.has(id) && ok(fields.find((x) => x.id === id))).slice(0, n);
  const stages = (Array.isArray(k.pipeline?.stages) ? k.pipeline.stages : []).slice(0, 10).map((s, i) => ({ name: str(s?.name ?? s, 40) || `Stage ${i + 1}`, color: /^#[0-9a-f]{6}$/i.test(s?.color) ? s.color : COLORS[i % COLORS.length], ...(s?.won ? { won: true } : {}), ...(s?.lost ? { lost: true } : {}) }));
  const L = k.labels || {};
  return {
    id: 'custom', name: str(k.name, 60) || 'My CRM', icon: str(k.icon, 4) || '✨', desc: str(k.desc, 200),
    labels: { title: str(L.title, 30) || 'Contacts', one: str(L.one, 30).toLowerCase() || 'contact', customers: str(L.customers, 30) || 'Customers', leads: str(L.leads, 30) || 'Leads', value: str(L.value, 30) || 'Value' },
    fields, pipeline: stages.length >= 2 ? { name: str(k.pipeline?.name, 60) || 'Pipeline', stages } : null,
    columns: pick(k.columns, 5), cardFields: pick(k.cardFields, 3), filters: pick(k.filters, 4, (x) => x.type === 'select'),
    valueField: pick([k.valueField], 1, (x) => x.type === 'money' || x.type === 'number')[0] || null, showSales: !!k.showSales,
  };
}

// ---------- switching ----------
// fields: added when missing (matched by id, then by name — nothing is duplicated or removed); the kit's pipeline:
// reused if one with that name exists, else created; the kit becomes what Contacts shows
export function applyKit(userId, kit) {
  const u = T.users.get(userId);
  const have = u.crmFields || [];
  const fields = [...have], idMap = {};
  for (const x of kit.fields) {
    const ex = have.find((y) => y.id === x.id) || have.find((y) => y.label.toLowerCase() === x.label.toLowerCase());
    if (ex) { idMap[x.id] = ex.id; continue; }
    if (fields.length >= 30) continue;
    fields.push({ ...x }); idMap[x.id] = x.id;
  }
  let pipelineId = null;
  if (kit.pipeline) {
    const pipes = pipelinesFor(userId);
    const same = pipes.find((p) => p.name.toLowerCase() === kit.pipeline.name.toLowerCase());
    if (same) pipelineId = same.id;
    else if (pipes.length < 20) pipelineId = T.pipelines.insert({ id: uid(), userId, name: kit.pipeline.name, stages: kit.pipeline.stages.map((s) => ({ id: uid(), ...s })), at: Date.now() }).id;
  }
  const map = (list) => (list || []).map((id) => idMap[id]).filter(Boolean);
  const current = {
    id: kit.id, name: kit.name, icon: kit.icon, labels: kit.labels, columns: map(kit.columns), cardFields: map(kit.cardFields), filters: map(kit.filters),
    valueField: kit.valueField ? idMap[kit.valueField] || null : null, showSales: !!kit.showSales, pipelineId, ...(kit.note ? { note: kit.note } : {}), at: Date.now(),
  };
  T.users.update(userId, (x) => { x.crmFields = fields; x.settings = { ...x.settings, crmKit: current }; });
  return { current, fields };
}
export const currentKit = (u) => u?.settings?.crmKit || { ...kitById('general'), pipelineId: null };

const KIT_SYSTEM = `You design a CRM for one kind of business (Indian context unless told otherwise). Reply with ONLY JSON:
{"name": "short name of this CRM", "icon": "one emoji", "desc": "one line",
 "labels": {"title": "what the contacts list is called (plural, e.g. Patients)", "one": "one of them (singular, lowercase)", "customers": "those who bought / signed up", "leads": "those who haven't yet", "value": "what the money field means"},
 "fields": [{"id": "short_snake_case", "label": "Field name", "type": "text|longtext|number|money|phone|date|select|url|checkbox", "options": "for select only: Option A, Option B"}],
 "pipeline": {"name": "pipeline name", "stages": [{"name": "Stage"}, ..., {"name": "Won-type stage", "won": true}, {"name": "Lost", "lost": true}]},
 "columns": [field ids to show as list columns, up to 4], "cardFields": [up to 2 field ids on pipeline cards], "filters": [up to 3 SELECT field ids for quick filters], "valueField": "a money field id or null", "showSales": false}
Rules: 6–12 fields that this business really tracks; 5–8 stages in the real order of their sales process; never ask for passwords, card numbers, Aadhaar/PAN or other identity numbers; keep health or financial details minimal.`;

// ---------- ready-made automations for each CRM style ----------
// date: [field, days before (−) / after (+), title, what it's for, message] · stuck: [stage name, days, title]
const KIT_AUTOMATIONS = {
  realestate: { date: ['re_visit', -1, 'Site visit reminder', 'the day before a site visit', 'your site visit is tomorrow ({{f_re_visit}}). Here’s the location and what to bring — reply if you need to reschedule.'], stuck: ['Negotiation', 5, 'Deal stuck in negotiation'] },
  clinic: { date: ['cl_next', -1, 'Appointment reminder', 'the day before an appointment', 'a reminder that your appointment is tomorrow ({{f_cl_next}}). Reply to this email if you need to change the time.'], stuck: ['Consulted', 7, 'Consulted but not started treatment'] },
  consultant: { date: ['co_close', -3, 'Expected close date coming up', '3 days before the expected close date', 'just checking in on the proposal — happy to answer any questions before you decide.'], stuck: ['Proposal sent', 5, 'Proposal waiting too long'] },
  education: { date: ['ed_demo', -1, 'Demo class reminder', 'the day before a demo class', 'your demo class is tomorrow ({{f_ed_demo}}). We’re looking forward to seeing you!'], stuck: ['Fee discussion', 4, 'Admission stuck at fee discussion'] },
  fitness: { date: ['fi_renew', -7, 'Membership renewal reminder', 'a week before a renewal is due', 'your plan renews on {{f_fi_renew}}. Renew this week to keep your progress going.'], stuck: ['Trial done', 3, 'Trial done but not joined'] },
  finance: { date: ['fa_follow', 0, 'Follow-up day', 'on the follow-up date', 'following up as promised — is now a good time to take the next step?'], stuck: ['Proposal shared', 5, 'Proposal not answered'] },
  interior: { date: ['in_measure', -1, 'Site measurement reminder', 'the day before a site measurement', 'our team visits tomorrow ({{f_in_measure}}) to take measurements. Please make sure someone is home.'], stuck: ['3D approval', 5, '3D design waiting for approval'] },
  events: { date: ['ev_date', -7, 'Event week check-in', 'a week before the event', 'your event is a week away ({{f_ev_date}}). Let’s confirm the final details.'], stuck: ['Quote sent', 4, 'Quote not answered'] },
  travel: { date: ['tr_date', -3, 'Trip checklist', '3 days before travel', 'your trip starts on {{f_tr_date}}. Here’s a quick checklist: tickets, ID, hotel vouchers.'], stuck: ['Itinerary sent', 3, 'Itinerary not answered'] },
  auto: { date: ['au_test', -1, 'Test drive reminder', 'the day before a test drive', 'your test drive is tomorrow ({{f_au_test}}). Bring your driving licence.'], stuck: ['Quotation', 4, 'Quotation not answered'] },
  professional: { date: ['pf_due', -2, 'Deadline coming up', '2 days before a deadline or hearing', 'a reminder that the deadline / hearing is on {{f_pf_due}}. Please send any pending documents.'], stuck: ['Fee quote', 5, 'Fee quote not answered'] },
  recruitment: { date: ['rc_interview', -1, 'Interview reminder', 'the day before an interview', 'your interview is tomorrow ({{f_rc_interview}}). All the best — reply if anything changes.'], stuck: ['Offer', 3, 'Offer waiting for a decision'] },
  homeservices: { date: ['hs_amc', -7, 'Service / AMC due', 'a week before the next service', 'your next service is due on {{f_hs_amc}}. Reply to book a convenient slot.'], stuck: ['Quote sent', 4, 'Quote not answered'] },
  hospitality: { date: ['ho_in', -1, 'Arrival reminder', 'the day before check-in', 'we’re looking forward to welcoming you tomorrow ({{f_ho_in}}). Reply with your arrival time.'], stuck: ['Quote sent', 2, 'Booking quote not answered'] },
  store: { date: ['st_reorder', -2, 'Reorder reminder', '2 days before a reorder is due', 'running low? Your reorder is due around {{f_st_reorder}} — reply and we’ll ship it right away.'], stuck: ['COD to confirm', 1, 'COD order not confirmed'] },
  abroad: { date: ['ab_deadline', -7, 'Application deadline coming up', 'a week before an application deadline', 'the application deadline is {{f_ab_deadline}}. Please send any pending documents this week.'], stuck: ['Documents', 5, 'Documents pending too long'] },
  wellness: { date: ['we_session', -1, 'Session reminder', 'the day before a session', 'your session is tomorrow ({{f_we_session}}). Please keep your questions ready.'], stuck: ['Consulted', 4, 'Consulted but no package yet'] },
  saas: { date: ['sa_trial', -3, 'Trial ending soon', '3 days before a trial ends', 'your trial ends on {{f_sa_trial}}. Want a quick call to set things up for your team?'], stuck: ['Proposal', 5, 'Proposal not answered'] },
  ngo: { date: ['ng_next', -1, 'Giving reminder', 'the day before a planned gift', 'thank you for standing with us. Your next gift is planned for {{f_ng_next}} — every rupee helps.'], stuck: ['Lapsed', 30, 'Lapsed donor — win back'] },
};
// the current CRM style's automations, with this seller's own pipeline, stage and field ids (null when it has none)
export function kitAutomations(u) {
  const kit = currentKit(u), spec = KIT_AUTOMATIONS[kit.id];
  if (!spec) return null;
  const fields = u.crmFields || [];
  const pipe = pipelinesFor(u.id).find((x) => x.id === kit.pipelineId);
  const out = [];
  const [fid, offset, title, when, msg] = spec.date;
  const df = fields.find((x) => x.id === fid && x.type === 'date');
  if (df) out.push({
    key: `kit-date-${kit.id}`, title, text: `Emails the ${kit.labels.one} ${when} and reminds you to call — uses “${df.label}”.`,
    a: { name: title, trigger: { type: 'date', fieldId: df.id, offsetDays: offset, time: '10:00', yearly: false }, steps: [
      { type: 'email', subject: `${title} — {{business}}`, body: `Hi {{first_name}},\n\nJust ${msg}\n\n— {{business}}` },
      { type: 'notify', subject: `${title}: {{name}}`, body: `${df.label}: {{f_${df.id}}} — a quick call or WhatsApp helps.` },
    ] },
  });
  const [stageName, days, stuckTitle] = spec.stuck;
  const st = pipe?.stages.find((x) => x.name.toLowerCase() === stageName.toLowerCase());
  if (st) out.push({
    key: `kit-stuck-${kit.id}`, title: stuckTitle, text: `When a ${kit.labels.one} sits in “${st.name}” for ${days} days: a friendly nudge to them, a reminder to you, and a “follow-up” tag.`,
    a: { name: stuckTitle, trigger: { type: 'stuck', pipelineId: pipe.id, stageId: st.id, days }, steps: [
      { type: 'notify', subject: `{{name}} has been in ${st.name} for ${days} days`, body: 'Time for a follow-up call or WhatsApp.' },
      { type: 'email', subject: 'Any questions, {{first_name}}?', body: 'Hi {{first_name}},\n\nJust checking in — is there anything I can help with to move ahead?\n\n— {{business}}' },
      { type: 'tag', tag: 'follow-up', action: 'add' },
    ] },
  });
  return { kit: kit.name, recipes: out };
}

// ---------- bookings, shaped by the CRM style ----------
// what a booking is for this kind of business: its name and length, where it happens, the questions on the form
// (answers saved straight into CRM fields), the date field it fills, and the stages it moves the contact through
const KIT_BOOKING = {
  realestate: { name: 'Site visit', duration: 45, where: 'At the project site — we’ll WhatsApp you the location', date: 're_visit', booked: 'Site visit scheduled', done: 'Site visit done', ask: ['re_type', 're_bhk', 're_location'] },
  clinic: { name: 'Appointment', duration: 20, where: 'At the clinic', date: 'cl_next', booked: 'Appointment booked', done: 'Consulted', ask: ['cl_concern', 'cl_gender'] },
  consultant: { name: 'Discovery call', duration: 30, where: '', booked: 'Discovery call', ask: ['co_company', 'co_size', 'co_service'] },
  education: { name: 'Demo class', duration: 45, where: 'At our centre or online', date: 'ed_demo', booked: 'Demo class', done: 'Fee discussion', ask: ['ed_student', 'ed_course', 'ed_mode'] },
  fitness: { name: 'Trial session', duration: 45, where: 'At the studio', date: 'fi_trial', booked: 'Trial booked', done: 'Trial done', ask: ['fi_goal'] },
  finance: { name: 'Financial consultation', duration: 30, where: '', booked: 'Needs analysis', ask: ['fa_product', 'fa_income', 'fa_city'] },
  interior: { name: 'Site measurement', duration: 60, where: 'At your home or site', date: 'in_measure', booked: 'Site visit', done: 'Design & quote', ask: ['in_scope', 'in_home', 'in_site'] },
  events: { name: 'Event planning call', duration: 30, where: '', booked: 'Call / meeting', ask: ['ev_type', 'ev_venue'] },
  travel: { name: 'Trip planning call', duration: 20, where: '', ask: ['tr_dest', 'tr_kind'] },
  auto: { name: 'Test drive', duration: 30, where: 'At our showroom', date: 'au_test', booked: 'Test drive', done: 'Quotation', ask: ['au_model', 'au_fin', 'au_exch'] },
  professional: { name: 'Consultation', duration: 30, where: '', booked: 'Consultation', done: 'Fee quote', ask: ['pf_service', 'pf_entity'] },
  recruitment: { name: 'Interview', duration: 30, where: '', date: 'rc_interview', booked: 'Interview', ask: ['rc_role', 'rc_notice'] },
  homeservices: { name: 'Site survey', duration: 45, where: 'At your address', date: 'hs_survey', booked: 'Site survey', done: 'Quote sent', ask: ['hs_service', 'hs_prop', 'hs_address'] },
  hospitality: { name: 'Venue visit', duration: 30, where: 'At our property', ask: ['ho_kind'] },
  abroad: { name: 'Counselling session', duration: 30, where: '', booked: 'Counselling', done: 'Documents', ask: ['ab_country', 'ab_intake', 'ab_test'] },
  wellness: { name: 'Consultation', duration: 30, where: '', date: 'we_session', booked: 'Consultation booked', done: 'Consulted', ask: ['we_service', 'we_concern'] },
  saas: { name: 'Product demo', duration: 30, where: '', date: 'sa_demo', booked: 'Demo booked', done: 'Trial', ask: ['sa_company', 'sa_size'] },
};
const QTYPE = { select: 'select', longtext: 'long', phone: 'phone' };
// the current style's booking setup, resolved against this seller's own fields and pipeline (null: a plain call)
export function kitBooking(u) {
  const kit = currentKit(u), spec = KIT_BOOKING[kit?.id];
  if (!spec) return null;
  const fields = u.crmFields || [];
  const pipe = pipelinesFor(u.id).find((x) => x.id === kit.pipelineId);
  const stage = (name) => (name && pipe?.stages.find((x) => x.name.toLowerCase() === name.toLowerCase())) || null;
  const field = (id) => fields.find((f) => f.id === id) || null;
  const booked = stage(spec.booked), done = stage(spec.done), date = field(spec.date);
  return {
    kit: kit.name, kitId: kit.id, name: spec.name, pipelineId: pipe?.id || null, booked: booked && { id: booked.id, name: booked.name }, done: done && { id: done.id, name: done.name },
    dateField: date && { id: date.id, label: date.label },
    preset: {
      name: spec.name, duration: spec.duration, location: spec.where, description: `Book a ${spec.name.toLowerCase()} with us — pick a time that suits you.`,
      questions: spec.ask.map(field).filter(Boolean).map((f, i) => ({ label: f.label.replace(/ \(₹\)$/, ''), type: QTYPE[f.type] || 'text', required: i === 0, fieldId: f.id, ...(f.type === 'select' ? { options: String(f.options || '').split(',').map((o) => o.trim()).filter(Boolean) } : {}) })),
    },
  };
}
// moves the contact forward only (a booking never pulls someone back from Negotiation to Site visit scheduled)
function moveForward(userId, m, pipeId, st, why) {
  const pipe = pipelinesFor(userId).find((x) => x.id === pipeId);
  if (!pipe || !st) return null;
  const at = (id) => pipe.stages.findIndex((x) => x.id === id);
  const cur = m.stages?.[pipe.id];
  if (cur === st.id || (cur && at(cur) > at(st.id))) return null;
  m.stages = { ...m.stages, [pipe.id]: st.id };
  m.stagesAt = { ...m.stagesAt, [pipe.id]: Date.now() };
  m.activities.push({ id: uid(), at: Date.now(), type: 'stage', title: `Moved to ${st.name}`, text: `${pipe.name} · ${why}` });
  return { pipelineId: pipe.id, stageId: st.id };
}
// a booking happened ('booked'), or the seller marked how it went ('completed' / 'no_show'): the CRM follows
export function syncBooking(b, cal, what) {
  try {
    const u = T.users.get(b.userId);
    const who = { email: b.email, phone: b.phone, name: b.name };
    const key = ensureContact(b.userId, who, 'booking');
    if (!u || !key) return;
    const spec = kitBooking(u);
    const m = ensureMeta(b.userId, key);
    let moved = null;
    if (what === 'booked') {
      if (spec?.dateField) m.custom = { ...m.custom, [spec.dateField.id]: localYmd(sellerTz(u), b.start) };
      // answers to questions linked to CRM fields go into those fields
      for (const q of cal.questions || []) {
        const v = b.answers?.[q.label];
        if (q.fieldId && v != null && v !== '' && (u.crmFields || []).some((f) => f.id === q.fieldId)) m.custom = { ...m.custom, [q.fieldId]: v };
      }
      if (spec?.booked) moved = moveForward(b.userId, m, spec.pipelineId, spec.booked, `booked: ${cal.name}`);
    } else if (what === 'completed' && spec?.done) moved = moveForward(b.userId, m, spec.pipelineId, spec.done, `${cal.name} done`);
    else if (what === 'no_show' && !(m.tags || []).includes('no-show')) {
      m.tags = [...(m.tags || []), 'no-show'].slice(0, 20);
      T.crm.put(m);
      fireAutomation(b.userId, 'tag', { key, ...who, tag: 'no-show' });
      return;
    }
    T.crm.put(m);
    if (moved) fireAutomation(b.userId, 'stage', { key, ...who, ...moved });
  } catch (e) { console.error('booking → CRM failed', e.message); }
}

export function registerCrmKits(app, { auth, wrap, rateLimit, isTest, credits }) {
  // the Bookings screen: what bookings do in this CRM style, and a ready calendar for it
  app.get('/api/crm/kit-booking', auth, (req, res) => res.json(kitBooking(T.users.get(req.user.id)) || { kit: null }));
  app.get('/api/crm/kit-automations', auth, (req, res) => res.json(kitAutomations(T.users.get(req.user.id)) || { kit: null, recipes: [] }));
  const view = (u) => ({ current: currentKit(u), kits: KITS });
  app.get('/api/crm/kits', auth, (req, res) => res.json(view(req.user)));
  // switch to a built-in kit ({ id }) or a designed one ({ kit })
  app.post('/api/crm/kit', auth, (req, res) => {
    const kit = req.body?.id ? kitById(String(req.body.id)) : cleanKit(req.body?.kit);
    if (!kit) return res.status(400).json({ error: 'Pick a CRM style' });
    const r = applyKit(req.user.id, kit);
    res.json({ ...r, kits: KITS });
  });
  // AI: a kit designed from a description of the business — returned for a preview, not applied
  app.post('/api/ai/crm-kit', auth, rateLimit({ windowMs: 60000, max: isTest ? 100 : 6, key: (req) => req.user.id }), credits('edit'), wrap(async (req, res) => {
    if (!aiEnabled()) return res.status(503).json({ error: 'AI isn’t switched on for this server yet' });
    const d = str(req.body?.description, 1500);
    if (d.length < 8) return res.status(400).json({ error: 'Describe your business in a sentence or two' });
    let out;
    try { out = await aiJson(KIT_SYSTEM, d); } catch { return res.status(502).json({ error: 'The AI couldn’t design it just now — please try again' }); }
    const kit = cleanKit(out);
    if (!kit?.fields.length) return res.status(502).json({ error: 'The AI returned an empty design — please try again' });
    res.json({ kit });
  }));
}
