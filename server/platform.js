// Platform-wide settings the owner manages from the admin panel: brand, price, trial, AI credits,
// company details for GST invoices and the Razorpay account that collects subscriptions.
import { T } from './db.js';
import { encrypt, decrypt } from './messaging.js';
import { useStorageSettings } from './storage.js';

export const DEFAULTS = {
  brand: 'FunnelHive',
  plans: { monthly: { amount: 1499 }, yearly: { amount: 14999 }, agency_monthly: { amount: 4999 }, agency_yearly: { amount: 49999 } },
  agency: { maxClients: 25, trialClients: 2 }, // the Agency plan: client accounts it includes (and to try during the trial)
  pricesIncludeGst: true, // the price shown is what the seller pays
  gstRate: 18,
  trialDays: 14,
  aiCredits: { trial: 100, paid: 1500 }, // per calendar month
  graceDays: 7, // a failed renewal keeps the account working this long while Razorpay retries
  pagesOfflineAfterDays: 7, // after an account locks, its live pages stay up this long
  company: { name: '', gstin: '', address: '', state: '', email: '', invoicePrefix: 'FH' },
  razorpay: { keyId: '', secretEnc: '', webhookSecretEnc: '', planIds: {} },
  storage: { endpoint: '', region: '', bucket: '', key: '', secretEnc: '', publicUrl: '' }, // S3-compatible (Wasabi…): backups, uploads, product files
  signupsOpen: true,
  announcement: '',
  googleClientId: '', // "Continue with Google" (OAuth client ID from Google Cloud)
};

const ID = 'settings';
let cache = null, cacheAt = 0;
// Read often (every request that checks access), so kept for a few seconds per process
export function platform() {
  if (cache && Date.now() - cacheAt < 5000) return cache;
  const s = T.platform.get(ID) || {};
  cache = {
    ...DEFAULTS, ...s,
    plans: Object.fromEntries(Object.keys(DEFAULTS.plans).map((k) => [k, { ...DEFAULTS.plans[k], ...s.plans?.[k] }])),
    agency: { ...DEFAULTS.agency, ...s.agency },
    aiCredits: { ...DEFAULTS.aiCredits, ...s.aiCredits },
    company: { ...DEFAULTS.company, ...s.company },
    razorpay: { ...DEFAULTS.razorpay, ...s.razorpay, planIds: { ...s.razorpay?.planIds } },
    storage: { ...DEFAULTS.storage, ...s.storage },
  };
  cacheAt = Date.now();
  return cache;
}
export function savePlatform(fn) {
  const next = T.platform.update(ID, (s) => { fn(s); }) || T.platform.put((() => { const s = { id: ID }; fn(s); return s; })());
  cache = null;
  return next;
}
export const brand = () => platform().brand || DEFAULTS.brand;

// The Razorpay account that collects subscription payments (env vars win over the admin panel)
export function platformRzp() {
  const r = platform().razorpay;
  const keyId = process.env.PLATFORM_RAZORPAY_KEY_ID || r.keyId;
  const secret = process.env.PLATFORM_RAZORPAY_KEY_SECRET || decrypt(r.secretEnc);
  if (!keyId || !secret) return null;
  return { keyId, secret, webhookSecret: process.env.PLATFORM_RAZORPAY_WEBHOOK_SECRET || decrypt(r.webhookSecretEnc), mode: keyId.startsWith('rzp_live_') ? 'live' : 'test' };
}
export { encrypt };

// file storage entered in the admin panel (server env vars win — see storage.js)
useStorageSettings(() => { const s = platform().storage; return s.endpoint && s.bucket && s.key && s.secretEnc ? { ...s, secret: decrypt(s.secretEnc) } : null; });

// Owners are the accounts listed in ADMIN_EMAILS (once their email is verified) or given the admin role
export function isAdmin(u) {
  if (!u) return false;
  if (u.role === 'admin') return true;
  const list = (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(String(u.email).toLowerCase()) && u.emailVerified === true;
}

// GST place of supply: state names and their GST codes
export const STATES = {
  'Andaman and Nicobar Islands': '35', 'Andhra Pradesh': '37', 'Arunachal Pradesh': '12', Assam: '18', Bihar: '10', Chandigarh: '04', Chhattisgarh: '22',
  'Dadra and Nagar Haveli and Daman and Diu': '26', Delhi: '07', Goa: '30', Gujarat: '24', Haryana: '06', 'Himachal Pradesh': '02', 'Jammu and Kashmir': '01',
  Jharkhand: '20', Karnataka: '29', Kerala: '32', Ladakh: '38', Lakshadweep: '31', 'Madhya Pradesh': '23', Maharashtra: '27', Manipur: '14', Meghalaya: '17',
  Mizoram: '15', Nagaland: '13', Odisha: '21', Puducherry: '34', Punjab: '03', Rajasthan: '08', Sikkim: '11', 'Tamil Nadu': '33', Telangana: '36', Tripura: '16',
  'Uttar Pradesh': '09', Uttarakhand: '05', 'West Bengal': '19',
};
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
