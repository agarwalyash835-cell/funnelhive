// kie.ai market tasks for Studio: every model (images, clips, voice, upscaling) is started with jobs/createTask and
// read back with jobs/recordInfo. The queue (studio/jobs.js) keeps the task id, so a render survives a server restart:
// startTask once, then taskState on each tick. runTask does both in one call (Phase 2's voice code uses it).
// Errors for sellers never name the vendor or the model; the details go to the server log.
const BASE = () => (process.env.KIE_BASE_URL || 'https://api.kie.ai').replace(/\/$/, '');
const KEY = () => process.env.KIE_API_KEY || '';
export const studioReady = () => !!KEY();
const auth = () => ({ Authorization: `Bearer ${KEY()}` });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
import { isOutOfCredit, outOfCredit, PAUSED } from '../kie-credit.js';

export async function startTask({ model, input }) {
  if (!KEY()) throw new Error('Studio isn’t switched on for this server yet');
  const r = await fetch(`${BASE()}/api/v1/jobs/createTask`, { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input }), signal: AbortSignal.timeout(30000) });
  const d = await r.json().catch(() => ({}));
  // kie.ai reports errors as HTTP 200 with a non-200 code
  if (!r.ok || d.code !== 200 || !d.data?.taskId) {
    console.error('studio task refused:', model, d.code, d.msg || `HTTP ${r.status}`);
    if (isOutOfCredit(r.status, d)) { outOfCredit('Studio'); throw Object.assign(new Error(PAUSED), { paused: true }); }
    throw new Error('The AI couldn’t start this — please try again');
  }
  return d.data.taskId;
}
// → { state: waiting|queuing|generating|success|fail, urls, failMsg }
export async function taskState(taskId) {
  const r = await fetch(`${BASE()}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, { headers: auth(), signal: AbortSignal.timeout(20000) }).catch(() => null);
  const d = r ? await r.json().catch(() => ({})) : {};
  const s = d?.data || {};
  let res = {};
  try { res = typeof s.resultJson === 'string' ? JSON.parse(s.resultJson || '{}') : s.resultJson || {}; } catch { /* not JSON yet */ }
  // Veo puts its links elsewhere on some resolutions (docs disagree): take whichever is there
  const urls = [res.resultUrls, res.data?.result_urls, s.info?.resultUrls, s.origin_urls].find((x) => Array.isArray(x) && x.length) || [];
  return { state: s.state || (r ? 'waiting' : 'unknown'), urls: urls.filter((u) => /^https?:\/\//.test(u)), failMsg: s.failMsg || '', lastFrame: res.lastFrameUrl || null };
}
// the contract Phase 2 builds on: start, wait, → { urls, raw }
export async function runTask({ model, input, timeoutMs = 600000, pollMs = 4000 }) {
  const taskId = await startTask({ model, input });
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    await sleep(pollMs);
    const st = await taskState(taskId);
    if (st.state === 'fail') { console.error('studio task failed:', model, st.failMsg); throw new Error('The AI couldn’t make this one'); }
    if (st.state === 'success' && st.urls.length) return { urls: st.urls, raw: st, taskId };
  }
  throw new Error('This is taking too long — please try again');
}

// ---------- the reviewer: a vision model through kie.ai, shown pictures, answering in JSON ----------
// Two documented routes: Gemini's OpenAI-style chat (the model is in the path, e.g. gemini-3-8-flash-openai) and the
// OpenAI Responses route (gpt-… models), which explicitly takes pictures as data URLs. The first that answers wins; when
// none can, the measured checks decide alone (logged, never shown to sellers).
const dataUrl = (b) => `data:${b.type || 'image/jpeg'};base64,${b.buf.toString('base64')}`;
const unfence = (t) => String(t).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
async function askVision(model, prompt, images) {
  const gpt = /^gpt-/.test(model);
  const url = gpt ? `${BASE()}/codex/v1/responses` : `${BASE()}/${model}/v1/chat/completions`;
  const body = gpt
    ? { model, stream: false, reasoning: { effort: 'low' }, input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, ...images.map((b) => ({ type: 'input_image', image_url: dataUrl(b) }))] }] }
    : { stream: false, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...images.map((b) => ({ type: 'image_url', image_url: { url: dataUrl(b) } }))] }] };
  let r, d = {};
  try {
    r = await fetch(url, { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) }); // a stalled reviewer: on to the next one
    d = await r.json().catch(() => ({}));
  } catch (e) { console.error('studio review failed:', model, e.message); return null; }
  if (isOutOfCredit(r.status, d)) { outOfCredit('Studio reviewer'); return null; }
  const text = gpt ? (d.output || []).filter((o) => o.type === 'message').flatMap((o) => o.content || []).map((c) => c.text || '').join('') : d.choices?.[0]?.message?.content || '';
  if (!text) { console.error('studio review failed:', model, d.code ?? r.status, String(d.msg || d.error?.message || '').slice(0, 160)); return null; }
  try { return JSON.parse(unfence(text)); } catch { console.error('studio review: not JSON', model); return null; }
}
export async function reviewWith(models, { prompt, images = [] }) {
  if (!KEY()) return null;
  for (const m of [].concat(models).filter(Boolean)) { const v = await askVision(m, prompt, images); if (v) return v; }
  return null;
}
