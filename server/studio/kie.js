// kie.ai market tasks for Studio: every model (images, clips, voice, upscaling) is started with jobs/createTask and
// read back with jobs/recordInfo. The queue (studio/jobs.js) keeps the task id, so a render survives a server restart:
// startTask once, then taskState on each tick. runTask does both in one call (Phase 2's voice code uses it).
// Errors for sellers never name the vendor or the model; the details go to the server log.
const BASE = () => (process.env.KIE_BASE_URL || 'https://api.kie.ai').replace(/\/$/, '');
const KEY = () => process.env.KIE_API_KEY || '';
export const studioReady = () => !!KEY();
const auth = () => ({ Authorization: `Bearer ${KEY()}` });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startTask({ model, input }) {
  if (!KEY()) throw new Error('Studio isn’t switched on for this server yet');
  const r = await fetch(`${BASE()}/api/v1/jobs/createTask`, { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input }), signal: AbortSignal.timeout(30000) });
  const d = await r.json().catch(() => ({}));
  // kie.ai reports errors as HTTP 200 with a non-200 code
  if (!r.ok || d.code !== 200 || !d.data?.taskId) { console.error('studio task refused:', model, d.code, d.msg || `HTTP ${r.status}`); throw new Error(d.code === 402 || /credit|balance/i.test(d.msg || '') ? 'Studio is out of rendering credit — the platform has been told' : 'The AI couldn’t start this — please try again'); }
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

// ---------- the reviewer: a Gemini model through kie.ai, shown pictures, answering in JSON ----------
export async function reviewWith(model, { prompt, images = [] }) {
  if (!KEY()) return null;
  const parts = [{ text: prompt }, ...images.map((b) => ({ inlineData: { mimeType: b.type || 'image/jpeg', data: b.buf.toString('base64') } }))];
  const r = await fetch(`${BASE()}/gemini/v1/models/${model}:streamGenerateContent`, { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ stream: false, contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.1 } }), signal: AbortSignal.timeout(90000) }).catch(() => null);
  const d = r ? await r.json().catch(() => ({})) : {};
  const text = (Array.isArray(d) ? d : [d]).flatMap((c) => c?.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
  if (!text) { console.error('studio review failed:', model, d?.msg || d?.error?.message || (r ? `HTTP ${r.status}` : 'no answer')); return null; }
  try { return JSON.parse(text.replace(/^```(json)?|```$/g, '').trim()); } catch { return null; }
}
