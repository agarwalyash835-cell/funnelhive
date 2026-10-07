// Two-proportion z-test for A/B results.
const erf = (x) => {
  // Abramowitz & Stegun 7.1.26 (max error 1.5e-7)
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
};
const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

export const MIN_VIEWS = 100;      // per variant before we say anything
export const MIN_CONVERSIONS = 10; // per variant

export function abResult(A, B) {
  const ra = A.views ? A.conversions / A.views : 0;
  const rb = B.views ? B.conversions / B.views : 0;
  const base = { rateA: +(ra * 100).toFixed(2), rateB: +(rb * 100).toFixed(2), uplift: ra ? +(((rb - ra) / ra) * 100).toFixed(1) : null };
  if (A.views < MIN_VIEWS || B.views < MIN_VIEWS || A.conversions + B.conversions < MIN_CONVERSIONS * 2) {
    return { ...base, status: 'collecting', confidence: null, winner: null };
  }
  const p = (A.conversions + B.conversions) / (A.views + B.views);
  const se = Math.sqrt(p * (1 - p) * (1 / A.views + 1 / B.views));
  const z = se ? (rb - ra) / se : 0;
  const pValue = 2 * (1 - normCdf(Math.abs(z)));
  const confidence = +((1 - pValue) * 100).toFixed(1);
  const winner = pValue < 0.05 ? (rb > ra ? 'B' : 'A') : null;
  return { ...base, status: winner ? 'significant' : 'not-significant', confidence, pValue: +pValue.toFixed(4), winner };
}
