// Cinematography: the "treatment" a director of photography writes with the script, so every still is a planned,
// filmable frame instead of a loose description.
//   look   one per video (and a brand's look book, memory.js brand.look, reused across its videos): palette, mood,
//          lighting setup, lens and film look
//   cam    one per shot: size (wide → macro), angle, lens, light, composition, blocking, camera move
// Rules applied here, in code, whatever the writer sent (free — nothing is made yet):
//   - no two shots of the same size back to back (a wide after a wide reads as one long shot)
//   - the first frame is striking: close or macro, or the camera moves (a static wide never opens a Reel)
// filmPrompt / movePrompt expand a shot's prompts from the treatment, so every still in a video shares one look.
export const SIZES = ['wide', 'full', 'medium', 'close', 'macro'];
export const ANGLES = ['eye level', 'low', 'high', 'overhead', 'dutch', 'over the shoulder', 'pov'];
export const MOVES = ['static', 'push in', 'pull out', 'pan', 'tilt', 'dolly', 'tracking', 'orbit', 'handheld', 'crane'];
// the frames that stop a thumb: tight on a face, a hand or the product
export const STRIKING = ['close', 'macro'];
const SIZE_WORDS = { wide: 'wide establishing shot', full: 'full shot, head to toe', medium: 'medium shot, waist up', close: 'close-up', macro: 'extreme close-up macro detail' };
// a lens for each size when the writer gave none (what a DoP would reach for on a 35mm-format camera)
const LENS_FOR = { wide: '24mm', full: '35mm', medium: '50mm', close: '85mm', macro: '100mm macro' };
const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const pick = (v, list) => { const s = clip(v, 40).toLowerCase(); return list.find((x) => s === x) || list.find((x) => s.includes(x)) || ''; };
const sizeOf = (v) => { const s = clip(v, 40).toLowerCase(); if (/macro|extreme close|ecu|detail/.test(s)) return 'macro'; if (/close|cu\b|tight/.test(s)) return 'close'; if (/medium|mid|waist|mcu|ms\b/.test(s)) return 'medium'; if (/full|head to toe/.test(s)) return 'full'; if (/wide|establish|long|ws\b/.test(s)) return 'wide'; return ''; };

// the video's look, cleaned (the look book uses the same shape)
export function cleanLook(l) {
  if (!l || typeof l !== 'object') return null;
  const palette = [].concat(l.palette ?? []).map((x) => clip(x, 30)).filter(Boolean).slice(0, 4);
  const out = { palette, mood: clip(l.mood, 80), lighting: clip(l.lighting, 120), lens: clip(l.lens, 60), film: clip(l.film, 80) };
  return palette.length || out.mood || out.lighting || out.lens || out.film ? out : null;
}
// one shot's camera plan, cleaned; null when the writer gave none
export function cleanCam(c) {
  if (!c || typeof c !== 'object') return null;
  const size = sizeOf(c.size);
  const out = { size, angle: pick(c.angle, ANGLES) || clip(c.angle, 30), lens: clip(c.lens, 30), light: clip(c.light, 120), composition: clip(c.composition, 140), blocking: clip(c.blocking, 160), move: pick(c.move, MOVES) || clip(c.move, 40) };
  return Object.values(out).some(Boolean) ? out : null;
}

// the rules above, applied to the shots' camera plans (in place on copies) → { shots, changes: [plain words] }
export function enforceTreatment(shots) {
  const out = shots.map((s) => ({ ...s, ...(s.cam ? { cam: { ...s.cam } } : {}) }));
  const changes = [];
  if (!out.some((s) => s.cam)) return { shots: out, changes };
  out.forEach((s, i) => { if (!s.cam) s.cam = { size: '', angle: '', lens: '', light: '', composition: '', blocking: '', move: '' }; if (!s.cam.size) s.cam.size = SIZES[(i * 2 + 2) % SIZES.length]; });
  // open on a striking frame
  const c0 = out[0].cam;
  if (!STRIKING.includes(c0.size) && (!c0.move || c0.move === 'static')) { c0.move = 'push in'; changes.push('The opening shot now pushes in, so the first frame moves'); }
  // no two sizes alike back to back: the second becomes the nearest size that differs from both neighbours
  for (let i = 1; i < out.length; i++) {
    const c = out[i].cam;
    if (c.size !== out[i - 1].cam.size) continue;
    const next = out[i + 1]?.cam?.size;
    const k = SIZES.indexOf(c.size);
    const alt = [k + 2, k - 2, k + 1, k - 1, k + 3, k - 3].map((j) => SIZES[j]).find((x) => x && x !== c.size && x !== next);
    changes.push(`Shot ${i + 1}: ${c.size} after a ${c.size} — now a ${alt}`);
    c.size = alt;
    if (c.lens && /mm/.test(c.lens)) c.lens = LENS_FOR[alt];
  }
  return { shots: out, changes };
}

// the still's prompt, as sent to the picture model: what the writer described, then the frame (size, angle, lens,
// light, composition, blocking) and the video's look — the same look on every still keeps the video consistent
export function filmPrompt(shot, look, part = 'image') {
  const base = String(shot?.[part] || shot?.image || '').trim();
  const c = shot?.cam, l = look || null;
  if (!c && !l) return base;
  const frame = c ? [SIZE_WORDS[c.size] || '', c.angle ? `${c.angle} angle` : '', `${c.lens || LENS_FOR[c.size] || '35mm'} lens`, c.light, c.composition, part === 'image' ? c.blocking : ''].filter(Boolean).join(', ') : '';
  const feel = l ? [l.lighting, l.palette?.length ? `colour palette ${l.palette.join(', ')}` : '', l.mood ? `${l.mood} mood` : '', l.film || 'cinematic, natural skin tones, shallow depth of field'].filter(Boolean).join('; ') : '';
  return [base, frame && `Frame: ${frame}.`, feel && `Look: ${feel}.`].filter(Boolean).join('\n').slice(0, 1500);
}
// the clip's movement prompt: the camera move first (video models follow it best that way), then the action
export function movePrompt(shot) {
  const m = shot?.cam?.move, act = String(shot?.motion || shot?.image || '').trim();
  if (!m || act.toLowerCase().includes(m.toLowerCase())) return act;
  return `Camera: ${m === 'static' ? 'locked off, no camera move' : `slow ${m}`}. ${act}`.slice(0, 600);
}

// the treatment as sellers see it
export const treatmentOf = (script) => (script?.look || script?.shots?.some((s) => s.cam) ? { look: script.look || null, shots: (script.shots || []).map((s) => s.cam || null) } : null);
// the look book prompt block (memory.js): the brand's look, so every video of theirs shares it
export const lookPrompt = (l) => (l ? `Their look book (keep every video in this look): ${[l.palette?.length ? `palette ${l.palette.join(', ')}` : '', l.mood && `mood ${l.mood}`, l.lighting && `lighting ${l.lighting}`, l.lens && `lenses ${l.lens}`, l.film && `film look ${l.film}`].filter(Boolean).join(' · ')}` : '');
