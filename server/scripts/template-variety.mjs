// How different the template library is: distinct landing-page structures, styles and layouts in use.
//   node server/scripts/template-variety.mjs
import { allTemplates } from '../templates.js';

const L = allTemplates();
const sig = new Map();
for (const t of L) {
  const k = t.steps[0].blocks.map((b) => b.type + (b.props.variant ? `:${b.props.variant}` : '')).join(',');
  sig.set(k, [...(sig.get(k) || []), t.id]);
}
const count = (f) => L.reduce((m, t) => { const k = f(t); m[k] = (m[k] || 0) + 1; return m; }, {});
console.log(`${L.length} templates · ${sig.size} distinct landing pages (section order + layouts)`);
for (const [, ids] of sig) if (ids.length > 1) console.log('  same page plan:', ids.join(', '));
console.log('styles:', count((t) => t.style));
console.log('hero layouts:', count((t) => t.hero.props.variant));
console.log('page kinds:', count((t) => t.kind));
console.log('sections per landing page:', Math.min(...L.map((t) => t.steps[0].blocks.length)), '–', Math.max(...L.map((t) => t.steps[0].blocks.length)));
