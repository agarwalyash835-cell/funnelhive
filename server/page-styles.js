// The page styles and section layouts the renderer supports (client/src/blocks.jsx STYLES / VARIANTS).
// Used by the AI prompts, the quality gate, chat commands and Hive AI.
export const PAGE_STYLES = ['aurora', 'midnight', 'luxe', 'fresh', 'bold', 'clean', 'editorial', 'organic', 'tech', 'playful', 'royal', 'noir', 'glass', 'swiss', 'pastel', 'studio'];

export const STYLE_HINTS = {
  aurora: 'light, soft gradients — courses, wellness, general',
  midnight: 'dark & glowing — trading, tech, premium courses',
  luxe: 'cream & serif — premium products, real estate, interiors',
  fresh: 'soft & friendly — health, home services, organic food',
  bold: 'high contrast, chunky — fitness, sales events, offers',
  clean: 'minimal, trustworthy — exams, clinics, finance, B2B',
  editorial: 'black & white magazine — personal brands, coaches, agencies, photography',
  organic: 'warm paper, earthy serif — homemade food, tea, Ayurveda, handmade',
  tech: 'dark grid, neon, monospace — coding, apps, SaaS, websites, crypto/trading tools',
  playful: 'bright & chunky — kids, snacks, fun products, events',
  royal: 'jewel tones & gold — weddings, jewellery, ethnic wear, spiritual',
  noir: 'black & white, one glowing accent — high-ticket coaching, executives, premium services',
  glass: 'frosted glass on a colour mesh — AI, SaaS, agencies, modern finance',
  swiss: 'grid, oversized type, sharp corners — consulting, careers, finance education',
  pastel: 'soft pastel gradients, rounded — women’s health, parenting, wellness, baking',
  studio: 'warm neutral, modern startup — franchises, D2C, B2B, lifestyle',
};

// section type → layouts (first = default)
export const VARIANTS = {
  hero: ['split', 'center', 'banner', 'editorial', 'bento', 'video', 'videosplit', 'cinema', 'event', 'stage', 'poster', 'bgvideo'],
  stats: ['strip', 'cards', 'band'],
  problem: ['cards', 'list', 'split'],
  features: ['cards', 'grid', 'list', 'zigzag'],
  steps: ['columns', 'timeline', 'cards', 'scroll'],
  compare: ['columns', 'table'],
  testimonials: ['cards', 'spotlight', 'wall', 'chat'],
  mentor: ['split', 'story', 'card'],
  bonuses: ['dark', 'light'],
  guarantee: ['box', 'strip'],
  pricing: ['card', 'split'],
  faq: ['accordion', 'two'],
  cta: ['banner', 'plain'],
};
// site-wide fonts a theme may name (the same list as client/src/fonts.js FONT_CHOICES), corner and text sizes
export const FONT_NAMES = ['Plus Jakarta Sans', 'Inter', 'Poppins', 'Mukta', 'Hind', 'Noto Sans', 'DM Sans', 'Montserrat', 'Outfit', 'Sora', 'Playfair Display', 'Lora'];
// fonts for the other Indian scripts (after FONT_NAMES in FONT_CHOICES): set by the page's language (page-langs.js),
// not offered to the AI's theme choice
export const SCRIPT_FONT_NAMES = ['Mukta Vaani', 'Hind Vadodara', 'Hind Siliguri', 'Noto Sans Bengali', 'Mukta Malar', 'Hind Madurai', 'Hind Guntur', 'Noto Sans Telugu', 'Baloo Tamma 2', 'Noto Sans Kannada', 'Baloo Chettan 2', 'Noto Sans Malayalam', 'Mukta Mahee', 'Noto Sans Gurmukhi', 'Baloo Bhaina 2', 'Noto Sans Oriya'];
export const RADII = ['sharp', 'soft', 'round', 'pill'];
export const TEXT_SIZES = ['sm', 'md', 'lg'];
export const variantsText = () => Object.entries(VARIANTS).map(([t, v]) => `${t}: ${v.join('|')}`).join('; ');
