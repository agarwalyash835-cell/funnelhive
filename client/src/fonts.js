// Google Fonts each page style needs — live pages load only the families they actually use.
export const STYLE_FONTS = {
  aurora: 'family=Plus+Jakarta+Sans:wght@400;500;600;700;800',
  midnight: 'family=Sora:wght@400;600;700;800&family=Inter:wght@400;500;600;700',
  luxe: 'family=Playfair+Display:ital,wght@0,500;0,600;0,700;1,500;1,600&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700',
  fresh: 'family=Poppins:wght@400;500;600;700;800',
  bold: 'family=Outfit:wght@400;500;600;700;800;900',
  clean: 'family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700;9..40,800',
  editorial: 'family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700',
  organic: 'family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,500&family=Nunito+Sans:opsz,wght@6..12,400;6..12,600;6..12,700',
  tech: 'family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;700',
  playful: 'family=Baloo+2:wght@600;700;800&family=Nunito:wght@400;600;700;800',
  royal: 'family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500;1,600&family=Mulish:wght@400;500;600;700',
  noir: 'family=Inter+Tight:ital,wght@0,500;0,600;0,700;0,800;1,500&family=Inter:wght@400;500;600',
  glass: 'family=Manrope:wght@400;500;600;700;800',
  swiss: 'family=Archivo:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,500',
  pastel: 'family=DM+Serif+Display:ital@0;1&family=Manrope:wght@400;500;600;700;800',
  studio: 'family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700;12..96,800&family=Instrument+Sans:wght@400;500;600;700',
};
export const fontHref = (style) => `https://fonts.googleapis.com/css2?${STYLE_FONTS[style] || STYLE_FONTS.aurora}&display=swap`;

// Fonts a seller can pick site-wide. Mukta, Hind, Noto Sans and Poppins also cover Devanagari (Hindi/Marathi).
export const FONT_CHOICES = {
  'Plus Jakarta Sans': { q: 'Plus+Jakarta+Sans:wght@400;500;600;700;800', stack: "'Plus Jakarta Sans', sans-serif" },
  Inter: { q: 'Inter:wght@400;500;600;700;800', stack: "'Inter', sans-serif" },
  Poppins: { q: 'Poppins:wght@400;500;600;700;800', stack: "'Poppins', sans-serif", indic: true },
  Mukta: { q: 'Mukta:wght@400;500;600;700;800', stack: "'Mukta', sans-serif", indic: true },
  Hind: { q: 'Hind:wght@400;500;600;700', stack: "'Hind', sans-serif", indic: true },
  'Noto Sans': { q: 'Noto+Sans:wght@400;500;600;700;800', stack: "'Noto Sans', 'Noto Sans Devanagari', sans-serif", indic: true },
  'DM Sans': { q: 'DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700;9..40,800', stack: "'DM Sans', sans-serif" },
  Montserrat: { q: 'Montserrat:wght@400;500;600;700;800', stack: "'Montserrat', sans-serif" },
  Outfit: { q: 'Outfit:wght@400;500;600;700;800;900', stack: "'Outfit', sans-serif" },
  Sora: { q: 'Sora:wght@400;600;700;800', stack: "'Sora', sans-serif" },
  'Playfair Display': { q: 'Playfair+Display:ital,wght@0,500;0,600;0,700;1,500;1,600', stack: "'Playfair Display', Georgia, serif" },
  Lora: { q: 'Lora:ital,wght@0,400;0,600;0,700;1,500', stack: "'Lora', Georgia, serif" },
};

// The stylesheet a funnel needs: its style's fonts plus any site-wide font overrides
export function fontHrefFor(theme = {}) {
  const fams = [STYLE_FONTS[theme.style] || STYLE_FONTS.aurora];
  for (const k of ['headingFont', 'bodyFont']) if (FONT_CHOICES[theme[k]]) fams.push(`family=${FONT_CHOICES[theme[k]].q}`);
  return `https://fonts.googleapis.com/css2?${[...new Set(fams)].join('&')}&display=swap`;
}

// Client-side: add the stylesheet once
export function ensureFonts(themeOrStyle) {
  if (typeof document === 'undefined') return;
  const href = typeof themeOrStyle === 'string' ? fontHref(themeOrStyle) : fontHrefFor(themeOrStyle);
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = href; l.dataset.ffFont = typeof themeOrStyle === 'string' ? themeOrStyle : themeOrStyle?.style || 'aurora';
  document.head.appendChild(l);
}
