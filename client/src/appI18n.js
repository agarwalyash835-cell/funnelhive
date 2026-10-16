// The dashboard's own language (English / हिन्दी) — separate from a funnel's language (i18n.js), which is about
// what buyers see. The English text is the key: t('Save') → 'सेव करें' in Hindi; a phrase missing from the
// dictionary simply stays in English, so nothing ever shows blank. t('{n} orders', { n: 4 }) fills in values.
// Kept per person: settings.uiLang on the server, plus localStorage so the right language shows from the first paint.
import { createElement, Fragment } from 'react';

const KEY = 'ff_lang';
// the dashboard is English-only for now (funnel pages still come in several languages — see i18n.js);
// t() stays in place so a translation can be added later without touching every screen again
const DICT = {};
export const UI_LANGS = [['en', 'English']];

const read = () => 'en';
let lang = typeof window === 'undefined' ? 'en' : read();
export const uiLang = () => lang;

export function t(s, vars) {
  if (s == null) return s;
  let out = (lang !== 'en' && DICT[lang]?.[s]) || s;
  if (vars) out = String(out).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return out;
}

// tx('Hello {name}, welcome', { name: <b>Priya</b> }) → an array of text and elements, for sentences with bold parts
// (Hindi puts words in a different order, so the whole sentence is one phrase)
export function tx(s, nodes = {}) {
  const parts = String(t(s)).split(/\{(\w+)\}/g);
  return parts.map((p, i) => createElement(Fragment, { key: i }, i % 2 ? (p in nodes ? nodes[p] : `{${p}}`) : p));
}

// Devanagari font: only downloaded when the dashboard is in Hindi
const FONT_ID = 'ff-deva-font';
function ensureDevanagari() {
  if (typeof document === 'undefined' || document.getElementById(FONT_ID)) return;
  const l = document.createElement('link');
  l.id = FONT_ID; l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap';
  document.head.appendChild(l);
}
// <html lang> and the font — called by the app shell (never on buyer pages, which follow the funnel's language)
export function applyUiLang() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  document.documentElement.classList.toggle('ui-hi', lang === 'hi');
  if (lang === 'hi') ensureDevanagari();
}

// Switch language: everything re-renders (main.jsx listens for ff:lang). Returns true if it changed.
export function setUiLang(next) {
  next = 'en';
  try { localStorage.setItem(KEY, next); } catch {}
  if (next === lang) return false;
  lang = next;
  applyUiLang();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('ff:lang'));
  return true;
}
