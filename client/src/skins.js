// The dashboard's skins: each is FunnelHive's own design (colours, type, corners, layout), set as
// <html data-skin="…"> and styled in skins.css. A person's own pick wins, else their agency's default for its
// clients (/api/me skin), else Classic. This browser keeps the last one so the page paints in it before /me loads.
// Ids must match server/skins.js SKIN_IDS.
//   layout: 'side' (the menu down the left), 'top' (tabs across the top, wide screens), 'rail' (icons only)
//   dock:   a floating quick-action bar at the bottom (search, new funnel, bookings, Hive)
//   sw:     the swatch colours for the picker [background, surface, accent, ink]; thumb: the picker's drawing if not the layout
export const SKINS = {
  classic: { name: 'Classic', blurb: 'Warm neutrals with a honey accent — the FunnelHive default.', layout: 'side', sw: ['#f6f5f2', '#ffffff', '#f5a524', '#1c1917'] },
  softwash: { name: 'Soft Wash', blurb: 'A calm peach-to-sage wash, tabs across the top and a floating action bar.', layout: 'top', dock: true, sw: ['#f3ece4', '#fffdfa', '#e2643c', '#1f1d1a'] },
  midnight: { name: 'Midnight', blurb: 'A deep-navy frame around a bright, cool workspace — bold and focused.', layout: 'side', thumb: 'frame', sw: ['#f4f6fb', '#ffffff', '#3b6cf6', '#0d111c'] },
  warm: { name: 'Warm Studio', blurb: 'Cream paper, terracotta, serif headings and flat outlined cards.', layout: 'side', sw: ['#f7f1e8', '#fffaf3', '#b4532a', '#2b211b'] },
  graphite: { name: 'Graphite Rail', blurb: 'Cool slate, a dark icon-only rail and a compact, sharp layout — more on screen.', layout: 'rail', sw: ['#eef1f4', '#ffffff', '#0f766e', '#111827'] },
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
