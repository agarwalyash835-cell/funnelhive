// The dashboard's skins: each is FunnelHive's own design (colours, type, corners, layout), set as
// <html data-skin="…"> and styled in skins.css. A person's own pick wins, else their agency's default for its
// clients (/api/me skin), else Classic. This browser keeps the last one so the page paints in it before /me loads.
// Ids must match server/skins.js SKIN_IDS.
//   layout: 'side' (the menu down the left), 'top' (tabs across the top, wide screens), 'rail' (icons only),
//           'float' (the menu as a floating card), 'right' (the menu on the right); band: a colour band behind titles
//   dock:   a floating quick-action bar at the bottom (search, new funnel, bookings, Hive)
//   sw:     the swatch colours for the picker [background, surface, accent, ink]; thumb: the picker's drawing if not the layout
export const SKINS = {
  classic: { name: 'Classic', blurb: 'Warm neutrals with a honey accent — the FunnelHive default.', layout: 'side', sw: ['#f6f5f2', '#ffffff', '#f5a524', '#1c1917'] },
  softwash: { name: 'Soft Wash', blurb: 'A calm peach-to-sage wash, tabs across the top and a floating action bar.', layout: 'top', dock: true, sw: ['#f3ece4', '#fffdfa', '#e2643c', '#1f1d1a'] },
  midnight: { name: 'Midnight', blurb: 'A deep-navy frame around a bright, cool workspace — bold and focused.', layout: 'side', thumb: 'frame', sw: ['#f4f6fb', '#ffffff', '#3b6cf6', '#0d111c'] },
  warm: { name: 'Warm Studio', blurb: 'Cream paper, terracotta, serif headings and flat outlined cards.', layout: 'side', sw: ['#f7f1e8', '#fffaf3', '#b4532a', '#2b211b'] },
  graphite: { name: 'Graphite Rail', blurb: 'Cool slate, a dark icon-only rail and a compact, sharp layout — more on screen.', layout: 'rail', sw: ['#eef1f4', '#ffffff', '#0f766e', '#111827'] },
  ocean: { name: 'Ocean Float', blurb: 'Sea-glass teal with the menu as a floating card and soft borderless cards.', layout: 'float', sw: ['#e6f1f2', '#ffffff', '#128b96', '#0b2b30'] },
  forest: { name: 'Forest Ledger', blurb: 'A deep green menu, a green band behind each page title and ledger-ruled tables.', layout: 'side', band: true, thumb: 'darkside', sw: ['#f1f4ee', '#ffffff', '#3d8a4a', '#18301e'] },
  rose: { name: 'Rose Petal', blurb: 'Blush pink, rounded type and pill-shaped everything — friendly and soft.', layout: 'side', sw: ['#fbf1f3', '#ffffff', '#c94471', '#2e1520'] },
  saffron: { name: 'Saffron Bazaar', blurb: 'A deep maroon menu with saffron rules on every card — festive and warm.', layout: 'side', thumb: 'darkside', sw: ['#fbf5ea', '#fffcf6', '#f59e0b', '#4a0f1a'] },
  mono: { name: 'Mono', blurb: 'Strict black and white, monospace headings, hairline borders, no shadows.', layout: 'side', thumb: 'mono', sw: ['#ffffff', '#ffffff', '#0a0a0a', '#0a0a0a'] },
  brutal: { name: 'Bold Block', blurb: 'Neo-brutalist: thick black borders, hard shadows and a loud yellow menu.', layout: 'side', thumb: 'brutal', sw: ['#fff8e1', '#ffffff', '#ffd60a', '#111111'] },
  royal: { name: 'Royal', blurb: 'Navy and gold, serif headings and a wide, stately menu.', layout: 'side', thumb: 'darkside', sw: ['#f5f3ee', '#ffffff', '#d4a520', '#121a38'] },
  paper: { name: 'Paper Calm', blurb: 'Quiet off-white, no borders, big titles and lots of breathing room.', layout: 'side', sw: ['#f8f7f4', '#fdfcfa', '#5e6f56', '#26231f'] },
  sunset: { name: 'Sunset', blurb: 'An orange-to-violet band with tabs across the top — bright and confident.', layout: 'top', band: true, thumb: 'bandtop', sw: ['#f7f4f8', '#ffffff', '#c43d72', '#1f1530'] },
  mirror: { name: 'Mirror', blurb: 'The menu on the right and titles to the right — a fresh, unusual layout in violet-grey.', layout: 'right', sw: ['#f2f2f7', '#ffffff', '#6d55e0', '#18182a'] },
  mint: { name: 'Mint Rail', blurb: 'A light icon-only rail, fresh mint and soft rounded cards.', layout: 'rail', thumb: 'lightrail', sw: ['#eef8f4', '#ffffff', '#13906e', '#0f2a20'] },
  compact: { name: 'Compact Pro', blurb: 'Dense and crisp in blue — the most rows and numbers on one screen.', layout: 'side', sw: ['#f3f5f8', '#ffffff', '#2563eb', '#101828'] },
  editorial: { name: 'Editorial', blurb: 'Like a magazine: serif text, hairline rules and underlined tabs across the top.', layout: 'top', sw: ['#fbfaf7', '#fbfaf7', '#b42323', '#1a1814'] },
  lavender: { name: 'Lavender Cloud', blurb: 'Soft lilac, a floating menu card and generous spacing.', layout: 'float', sw: ['#f3f0fb', '#ffffff', '#6e52dc', '#1e1838'] },
  glass: { name: 'Glass', blurb: 'Frosted, translucent panels over a soft colour field.', layout: 'side', sw: ['#e9e7ff', 'rgba(255,255,255,.6)', '#6d5dfc', '#1b1740'] },
};
export const SKIN_LIST = Object.entries(SKINS).map(([id, s]) => ({ id, ...s }));
const KEY = 'ff_skin';
export const skinOf = (id) => (SKINS[id] ? id : 'classic');
export const currentSkin = () => skinOf(document.documentElement.dataset.skin);
// paint the page in a skin (and remember it in this browser)
export function applySkin(id) {
  const k = skinOf(id);
  const root = document.documentElement;
  root.dataset.skin = k;
  root.classList.toggle('glass', k === 'glass'); // glass.css keys off this class
  try { localStorage.setItem(KEY, k); localStorage.setItem('ff_ui', k === 'glass' ? 'glass' : 'classic'); } catch { /* private mode */ }
  window.dispatchEvent(new Event('ff:skin'));
  return k;
}
// before React draws: the last skin this browser used (the old glass switch counts)
export function bootSkin() {
  let k = 'classic';
  try { k = localStorage.getItem(KEY) || (localStorage.getItem('ff_ui') === 'glass' ? 'glass' : 'classic'); } catch { /* private mode */ }
  document.documentElement.dataset.skin = skinOf(k);
  document.documentElement.classList.toggle('glass', skinOf(k) === 'glass');
}
