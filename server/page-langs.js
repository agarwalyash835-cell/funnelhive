// The languages an AI-built page can be written in: English, ten Indian languages in their own script, each of those
// mixed with English ("en+ta": bilingual headlines and key lines), and Hinglish (Hindi in English letters).
// theme.lang carries the code; the page's built-in words follow it (client/src/i18n.js — a mixed page uses the
// regional language's words, Hinglish uses English), and each script gets Google fonts that cover it (and Latin, so
// English words, prices and brand names match). The same codes are offered by client/src/i18n.js LANGS.
export const INDIC_LANGS = {
  hi: { name: 'Hindi', native: 'हिन्दी', script: 'Devanagari', heading: 'Mukta', body: 'Hind' },
  mr: { name: 'Marathi', native: 'मराठी', script: 'Devanagari', heading: 'Mukta', body: 'Hind' },
  gu: { name: 'Gujarati', native: 'ગુજરાતી', script: 'Gujarati', heading: 'Mukta Vaani', body: 'Hind Vadodara' },
  bn: { name: 'Bengali', native: 'বাংলা', script: 'Bengali', heading: 'Hind Siliguri', body: 'Noto Sans Bengali' },
  ta: { name: 'Tamil', native: 'தமிழ்', script: 'Tamil', heading: 'Mukta Malar', body: 'Hind Madurai' },
  te: { name: 'Telugu', native: 'తెలుగు', script: 'Telugu', heading: 'Hind Guntur', body: 'Noto Sans Telugu' },
  kn: { name: 'Kannada', native: 'ಕನ್ನಡ', script: 'Kannada', heading: 'Baloo Tamma 2', body: 'Noto Sans Kannada' },
  ml: { name: 'Malayalam', native: 'മലയാളം', script: 'Malayalam', heading: 'Baloo Chettan 2', body: 'Noto Sans Malayalam' },
  pa: { name: 'Punjabi', native: 'ਪੰਜਾਬੀ', script: 'Gurmukhi', heading: 'Mukta Mahee', body: 'Noto Sans Gurmukhi' },
  or: { name: 'Odia', native: 'ଓଡ଼ିଆ', script: 'Odia', heading: 'Baloo Bhaina 2', body: 'Noto Sans Oriya' },
};
const INDIC = Object.keys(INDIC_LANGS);
export const PAGE_LANG_CODES = ['en', ...INDIC, ...INDIC.map((k) => `en+${k}`), 'hinglish'];
// the fonts a seller can already pick that also draw Devanagari (a Hindi/Marathi page may keep the AI's choice)
const DEVANAGARI_OK = ['Mukta', 'Hind', 'Poppins', 'Noto Sans'];

// what a person or Hive AI may send: a code ('ta', 'en+ta', 'ta+en'), a name ('Tamil', 'English + Tamil'),
// 'Hinglish' — anything else is English
export function pageLang(v) {
  const s = String(v ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ').replace(/\s*[+&]\s*|\s+and\s+/g, '+').trim();
  if (!s) return 'en';
  if (/^(hinglish|roman hindi|hindi \(?roman|hi latn|hindi in english)/.test(s)) return 'hinglish';
  const one = (w) => (w === 'en' || w === 'english' ? 'en' : INDIC.find((k) => k === w || INDIC_LANGS[k].name.toLowerCase() === w || INDIC_LANGS[k].native === w || (k === 'or' && w === 'oriya') || (k === 'bn' && w === 'bangla')) || null);
  const parts = s.split('+').map((w) => one(w.trim()));
  if (parts.length === 1) return parts[0] || 'en';
  if (parts.length === 2 && parts.includes('en')) { const r = parts.find((p) => p && p !== 'en'); if (r) return `en+${r}`; }
  return 'en';
}

const keepAsIs = 'Keep brand names, prices, numbers and units as they are; everyday English words Indian buyers use (UPI, COD, EMI, WhatsApp, online, offer) may stay in English.';

// the instruction added to the brief so the AI writes the page in that language ('' for English)
export function langInstruction(code) {
  const lang = pageLang(code);
  if (lang === 'en') return '';
  if (lang === 'hinglish') return 'Write every word of the page copy in Hinglish — conversational Hindi mixed with everyday English, written ONLY in English (Roman) letters, the way people in India text and post (e.g. "Sirf 21 din mein apni skin ko glow do"). Never use Devanagari or any other script. Keep brand names, prices, numbers and units as they are.';
  const mixed = lang.startsWith('en+');
  const L = INDIC_LANGS[mixed ? lang.slice(3) : lang];
  const script = `${L.script} script, ${L.native}`;
  if (!mixed) return `Write every word of the page copy in ${L.name} (${script}) — natural, conversational ${L.name} a buyer in India would use, never English words spelt in ${L.name} letters when a common ${L.name} word exists, and never ${L.name} written in English letters. ${keepAsIs}`;
  return `Write the page bilingually in English and ${L.name} (${script}), the way Indian brands mix the two: every headline and key line carries both languages. Where a field has a subline (hero headline + subheadline, a section title + its subtitle), put one language in each — e.g. a ${L.name} headline with an English subheadline, or an English headline with a ${L.name} line under it; vary which leads from section to section. Short single lines (buttons, badges, short section titles) may read "${L.name} · English" when both fit, otherwise pick one. Body text, bullets, FAQs and testimonials can be in either language, chosen section by section so both appear across the page, but each sentence stays in one language. Write ${L.name} only in ${L.name} script, never in English letters. ${keepAsIs}`;
}

// the theme a page in that language gets: theme.lang, and fonts that draw its script
export function langTheme(code, theme = {}) {
  const lang = pageLang(code);
  if (lang === 'en') return theme;
  if (lang === 'hinglish') return { ...theme, lang };
  const L = INDIC_LANGS[lang.replace(/^en\+/, '')];
  const keep = (f) => L.script === 'Devanagari' && DEVANAGARI_OK.includes(f);
  return { ...theme, lang, headingFont: keep(theme.headingFont) ? theme.headingFont : L.heading, bodyFont: keep(theme.bodyFont) ? theme.bodyFont : L.body };
}

// the <html lang> for a page's language code
export const htmlLang = (code) => { const l = pageLang(code); return l === 'hinglish' ? 'hi-Latn' : l.replace(/^en\+/, ''); };

// one line for Hive AI's tool description
export const LANG_HELP = `en (default) | ${INDIC.map((k) => `${k} (${INDIC_LANGS[k].name})`).join(' | ')} | en+<code> for English mixed with that language (e.g. en+ta = English + Tamil, bilingual headlines) | hinglish (Hindi in English letters)`;
