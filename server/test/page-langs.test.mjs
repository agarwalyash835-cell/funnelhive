// AI-built pages in ten Indian languages, English mixed with one ("en+ta": bilingual headlines), and Hinglish
// (page-langs.js): the AI is told to write that way, the page gets theme.lang and fonts that draw the script, the
// live (server-rendered) page carries the right <html lang>, fonts and built-in words, and Hive AI's create_funnel
// takes the same choice. The client's language list, fonts and dictionaries are checked against the server's.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, register } from './helpers.mjs';
import { INDIC_LANGS, PAGE_LANG_CODES, pageLang, langInstruction, langTheme, htmlLang } from '../page-langs.js';
import { getTemplate, similarTemplates } from '../templates.js';
import { FONT_NAMES, SCRIPT_FONT_NAMES } from '../page-styles.js';
import { INDIC, LANGS, LANG_GROUPS, themeForLang, tr } from '../../client/src/i18n.js';
import { FONT_CHOICES, fontHrefFor } from '../../client/src/fonts.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const built = fs.existsSync(path.join(here, '../../client/dist-ssr/entry-server.js'));

// ---------- the language table ----------
test('every language code, and the names people (or Hive AI) actually send', () => {
  assert.equal(PAGE_LANG_CODES.length, 1 + 10 + 10 + 1);
  for (const k of ['mr', 'gu', 'bn', 'ta', 'te', 'kn', 'ml', 'pa', 'or']) assert.ok(INDIC_LANGS[k], k);
  const cases = { ta: 'ta', Tamil: 'ta', 'தமிழ்': 'ta', 'en+ta': 'en+ta', 'ta+en': 'en+ta', 'English + Tamil': 'en+ta', 'Tamil and English': 'en+ta', 'english & bengali': 'en+bn', Bangla: 'bn', Oriya: 'or', Odia: 'or', Hinglish: 'hinglish', 'hi-Latn': 'hinglish', 'Roman Hindi': 'hinglish', en: 'en', '': 'en', undefined: 'en', klingon: 'en', 'ta+mr': 'en', 'en+en': 'en' };
  for (const [v, want] of Object.entries(cases)) assert.equal(pageLang(v === 'undefined' ? undefined : v), want, v);
  assert.deepEqual([htmlLang('en+ta'), htmlLang('mr'), htmlLang('hinglish'), htmlLang('nope')], ['ta', 'mr', 'hi-Latn', 'en']);
});

test('the AI is told the language and script for each choice', () => {
  assert.equal(langInstruction('en'), '');
  for (const [k, L] of Object.entries(INDIC_LANGS)) {
    const one = langInstruction(k);
    assert.match(one, new RegExp(`Write every word of the page copy in ${L.name} \\(${L.script} script, ${L.native}\\)`), k);
    assert.match(one, /never .* written in English letters/, `${k}: no Roman transliteration`);
    assert.match(one, /Keep brand names, prices, numbers/);
    const mix = langInstruction(`en+${k}`);
    assert.match(mix, new RegExp(`bilingually in English and ${L.name} \\(${L.script} script, ${L.native}\\)`), `en+${k}`);
    assert.match(mix, /every headline and key line carries both languages/);
    assert.match(mix, new RegExp(`Write ${L.name} only in ${L.name} script`));
  }
  const hl = langInstruction('hinglish');
  assert.match(hl, /Hinglish/);
  assert.match(hl, /ONLY in English \(Roman\) letters/);
  assert.match(hl, /Never use Devanagari/);
});

test('each language gets fonts that draw its script; Hindi keeps a Devanagari font the AI chose', () => {
  assert.deepEqual(langTheme('ta', { style: 'luxe', headingFont: 'Playfair Display' }), { style: 'luxe', lang: 'ta', headingFont: 'Mukta Malar', bodyFont: 'Hind Madurai' });
  assert.deepEqual(langTheme('en+kn', {}), { lang: 'en+kn', headingFont: 'Baloo Tamma 2', bodyFont: 'Noto Sans Kannada' });
  assert.deepEqual(langTheme('hi', { headingFont: 'Poppins', bodyFont: 'Lora' }), { lang: 'hi', headingFont: 'Poppins', bodyFont: 'Hind' });
  assert.deepEqual(langTheme('hinglish', { headingFont: 'Sora' }), { lang: 'hinglish', headingFont: 'Sora' }, 'Hinglish is Latin: the style’s fonts stay');
  assert.deepEqual(langTheme('en', { style: 'bold' }), { style: 'bold' });
});

// ---------- the client matches ----------
test('the language picker offers every language, mixed option and Hinglish — the same codes as the server', () => {
  assert.deepEqual(LANGS.map(([k]) => k).sort(), [...PAGE_LANG_CODES].sort());
  assert.deepEqual(LANG_GROUPS.map(([g]) => g), ['One language', 'Mixed with English']);
  assert.ok(LANGS.find(([k]) => k === 'en+ta')[1].includes('தமிழ்'));
  assert.match(LANGS.find(([k]) => k === 'hinglish')[1], /Hindi in English letters/);
  for (const [k, , name, heading, body] of INDIC) {
    assert.deepEqual([name, heading, body], [INDIC_LANGS[k].name, INDIC_LANGS[k].heading, INDIC_LANGS[k].body], `${k}: client and server agree`);
    for (const f of [heading, body]) assert.ok(FONT_CHOICES[f] && [...FONT_NAMES, ...SCRIPT_FONT_NAMES].includes(f), `${f} is a font the page can load`);
    const t = themeForLang({ style: 'luxe' }, `en+${k}`);
    assert.deepEqual(t, { ...langTheme(`en+${k}`, { style: 'luxe' }) }, `${k}: the editor's language switch sets the same theme`);
    const href = fontHrefFor(t);
    for (const f of [heading, body]) assert.ok(href.includes(`family=${f.replace(/ /g, '+')}:`), `${k}: ${f} is loaded`);
  }
  assert.equal(themeForLang({ lang: 'ta', headingFont: 'Mukta Malar' }, 'en').lang, undefined, 'back to English clears theme.lang');
});

test('built-in words in each language (a mixed page uses the regional words, Hinglish stays English); English fallback', () => {
  const days = { hi: 'दिन', mr: 'दिवस', gu: 'દિવસ', bn: 'দিন', ta: 'நாட்கள்', te: 'రోజులు', kn: 'ದಿನಗಳು', ml: 'ദിവസം', pa: 'ਦਿਨ', or: 'ଦିନ' };
  for (const [k, w] of Object.entries(days)) {
    assert.equal(tr(k, 'Days'), w, k);
    assert.equal(tr(`en+${k}`, 'Days'), w, `en+${k}`);
    assert.notEqual(tr(k, 'Ends in'), 'Ends in', `${k}: sticky bar timer`);
    assert.notEqual(tr(k, 'Pay Securely'), 'Pay Securely', `${k}: checkout`);
    assert.equal(tr(k, 'Pay {amount} & confirm', { amount: '₹1,499' }).includes('₹1,499'), true, `${k}: amounts filled in`);
    assert.equal(tr(k, 'A phrase nobody translated'), 'A phrase nobody translated');
  }
  assert.equal(tr('hinglish', 'Days'), 'Days');
  assert.equal(tr('en', 'Days'), 'Days');
  assert.equal(tr(undefined, 'Days'), 'Days');
});

test('translations keep their {placeholders}; the common form words are translated in every language', () => {
  const src = ['blocks.jsx', 'pages/Public.jsx'].map((f) => fs.readFileSync(path.join(here, '../../client/src', f), 'utf8')).join('\n');
  const used = new Set([...src.matchAll(/tr\([^,()]*lang[^,()]*,\s*'([^']+)'/g)].map((m) => m[1]));
  // words picked by variable (countdown tiles, "{n} mins ago", subscription period)
  for (const w of ['Days', 'Hours', 'Minutes', 'Seconds', 'month', 'year', '{n} mins ago', '{n} min ago', '{n} hours ago', '{n} hour ago', '{n} days ago', '{n} day ago', 'Due today', 'Total']) used.add(w);
  const sample = ['Full name', 'Email', 'Submit', 'Close', 'Inclusive of all taxes', 'Thank you! We’ll be in touch shortly.'];
  for (const k of Object.keys(INDIC_LANGS)) for (const s of sample) assert.notEqual(tr(k, s), s, `${k}: ${s}`);
  // every {placeholder} in a phrase the page uses survives translation
  for (const k of Object.keys(INDIC_LANGS)) {
    for (const s of used) {
      const out = tr(k, s);
      for (const ph of s.match(/\{\w+\}/g) || []) assert.ok(out.includes(ph), `${k}: “${s}” keeps ${ph}`);
    }
  }
});

// ---------- end to end: the AI draft, the live page, Hive AI ----------
let srv, api, model;
const prompts = [];
before(async () => {
  const draft = JSON.stringify(getTemplate(similarTemplates('Home bakery in Chennai selling custom birthday cakes, ₹899', 1)[0].id));
  model = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => { b += d; });
    req.on('end', () => {
      const j = JSON.parse(b || '{}');
      const funnel = /funnel strategist and copywriter/.test(JSON.stringify(j));
      if (funnel) prompts.push(JSON.stringify(j));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: funnel ? draft : JSON.stringify({ ready: true }) }] }] }));
    });
  });
  await new Promise((r) => model.listen(0, '127.0.0.1', r));
  srv = await startServer({ KIE_API_KEY: 'kie_test', KIE_BASE_URL: `http://127.0.0.1:${model.address().port}`, AI_REPAIR_PASSES: '0' });
  api = srv.api;
});
after(async () => { await srv.stop(); model.close(); });

const BRIEF = 'Home bakery in Chennai selling custom birthday cakes, ₹899, delivered same day';

test('“English + Tamil”: the AI is asked for bilingual copy, and the live page is in Tamil script with Tamil fonts', async () => {
  const T = (await register(api)).token;
  const n = prompts.length;
  const r = await api('/ai/generate', 'POST', { prompt: BRIEF, lang: 'en+ta' }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  assert.equal(r.data.usedAI, true);
  assert.ok(prompts.slice(n).some((p) => p.includes('bilingually in English and Tamil (Tamil script, தமிழ்)')), 'the bilingual instruction reached the AI');
  assert.deepEqual([r.data.theme.lang, r.data.theme.headingFont, r.data.theme.bodyFont], ['en+ta', 'Mukta Malar', 'Hind Madurai']);
  // the live page
  const f = r.data;
  const steps = structuredClone(f.steps);
  steps[0].blocks.push({ id: 'cdta', type: 'countdown', props: { endsAt: Date.now() + 3 * 864e5 } });
  assert.equal((await api(`/funnels/${f.id}`, 'PUT', { published: true, steps }, T)).status, 200);
  const html = await (await fetch(`${srv.base}/f/${f.slug}`)).text();
  assert.match(html, /<html lang="ta">/);
  if (built) {
    assert.match(html, /fonts\.googleapis\.com\/css2\?[^"]*family=Mukta\+Malar:[^"]*family=Hind\+Madurai:/, 'both Tamil fonts are linked');
    assert.match(html, /நாட்கள்|மணி/, 'the countdown’s words are in Tamil');
  }
});

test('Tamil, Marathi and Hinglish pages; English stays as it was', async () => {
  const T = (await register(api)).token;
  for (const [lang, theme, ask] of [
    ['ta', ['ta', 'Mukta Malar', 'Hind Madurai'], 'Write every word of the page copy in Tamil (Tamil script, தமிழ்)'],
    ['mr', ['mr', 'Mukta', 'Hind'], 'Write every word of the page copy in Marathi (Devanagari script, मराठी)'],
    ['hinglish', ['hinglish', undefined, undefined], 'ONLY in English (Roman) letters'],
  ]) {
    const n = prompts.length;
    const r = (await api('/ai/generate', 'POST', { prompt: BRIEF, lang }, T)).data;
    assert.ok(prompts.slice(n).some((p) => p.includes(ask)), lang);
    assert.deepEqual([r.theme.lang, lang === 'hinglish' ? undefined : r.theme.headingFont, lang === 'hinglish' ? undefined : r.theme.bodyFont], theme, lang);
  }
  const n = prompts.length;
  const en = (await api('/ai/generate', 'POST', { prompt: BRIEF }, T)).data;
  assert.equal(en.theme.lang, undefined);
  assert.ok(prompts.slice(n).every((p) => !/Write every word of the page copy in|bilingually/.test(p)), 'no language instruction for English');
  const html = await (async () => { await api(`/funnels/${en.id}`, 'PUT', { published: true }, T); return (await fetch(`${srv.base}/f/${en.slug}`)).text(); })();
  assert.match(html, /<html lang="en">/);
});

test('Hive AI’s create_funnel takes the page language', async () => {
  const T = (await register(api)).token;
  const tok = (await api('/hive/tokens', 'POST', { name: 'test' }, T)).data.token;
  const list = await (await fetch(`${srv.base}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })).json();
  const schema = list.result.tools.find((t) => t.name === 'create_funnel').inputSchema;
  assert.match(schema.properties.lang.description, /en\+<code>/);
  assert.match(schema.properties.lang.description, /hinglish/);
  const r = await (await fetch(`${srv.base}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'create_funnel', arguments: { brief: BRIEF, answered: true, lang: 'English + Bengali' } } }) })).json();
  const out = JSON.parse(r.result.content[0].text);
  assert.ok(out.id, JSON.stringify(out).slice(0, 300));
  const f = (await api(`/funnels/${out.id}`, 'GET', null, T)).data;
  assert.deepEqual([f.theme.lang, f.theme.headingFont, f.theme.bodyFont], ['en+bn', 'Hind Siliguri', 'Noto Sans Bengali']);
});
