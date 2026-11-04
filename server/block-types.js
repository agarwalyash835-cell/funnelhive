// Every section type the page renderer and the editor know (client/src/blocks.jsx BLOCK_TYPES; test/block-types.test.mjs
// keeps the two in sync). Anything the AI writes is checked against this, so a made-up type never reaches a page as
// "Unknown block" with nothing to edit.
export const BLOCK_TYPE_NAMES = new Set([
  'section', 'hero', 'stats', 'problem', 'features', 'steps', 'compare', 'testimonials', 'mentor', 'bonuses', 'guarantee',
  'video', 'image', 'gallery', 'spacer', 'divider', 'html', 'quiz', 'form', 'text', 'countdown', 'optin', 'checkout', 'offer',
  'crosssell', 'pricing', 'navbar', 'footer', 'faq', 'cta', 'booking', 'thankyou', 'hellobar', 'livecount', 'stock', 'proof',
  'exitpopup', 'stickybar', 'whatsapp',
]);

export const isBlockType = (t) => BLOCK_TYPE_NAMES.has(String(t || ''));

// keeps the sections with a real type and a props object; → { blocks, dropped: [type…] }
export function knownBlocks(blocks) {
  const out = [], dropped = [];
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (b && isBlockType(b.type) && (b.props == null || (typeof b.props === 'object' && !Array.isArray(b.props)))) out.push(b);
    else dropped.push(String(b?.type || 'unknown').slice(0, 40));
  }
  return { blocks: out, dropped };
}
