// On an agency's own (verified) app domain the server puts its brand in <meta name="ff-agency"> (server/whitelabel.js
// brandedIndex), so the app knows before anything loads: the login page instead of the platform's landing page and
// prices, the agency's legal details, and no admin screens. null on the platform's own domain.
let cached;
export function agencyHost() {
  if (cached !== undefined) return cached;
  try { cached = typeof document === 'undefined' ? null : JSON.parse(document.querySelector('meta[name="ff-agency"]')?.content || 'null'); } catch { cached = null; }
  return cached;
}
