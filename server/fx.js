// Exchange rates to INR for reports: foreign-currency orders are shown in their own currency and counted in
// revenue at the rate of the day they were placed. Defaults are conservative mid-2026 rates; set FX_RATES
// ("USD:84.1,EUR:91.2") or the platform admin's rates to override.
import { platform } from './platform.js';

const DEFAULTS = { INR: 1, USD: 84, EUR: 91, GBP: 107, AUD: 55, CAD: 61, SGD: 63, AED: 22.9 };
const fromEnv = () => Object.fromEntries(String(process.env.FX_RATES || '').split(',').map((p) => p.split(':')).filter(([k, v]) => /^[A-Z]{3}$/.test(k || '') && Number(v) > 0).map(([k, v]) => [k, Number(v)]));
export const fxRates = () => ({ ...DEFAULTS, ...(platform().fx || {}), ...fromEnv() });
export const fxRate = (iso) => fxRates()[iso] || 1;
