// FunnelHive's own marks for its AI features, drawn to sit with the Lucide line icons (24 grid, round joins,
// currentColor) but without the stock "AI" look — no sparkles, magic wands or robots:
// - HiveGlyph: Hive AI itself — a honeycomb cell with the hive's core
// - ComposeGlyph: "make it for me" actions (auto-design, write, generate) — a drafting nib
// - AssistantGlyph: chatbots and AI agents — a conversation with a cell at its heart
// Each takes the same props as a Lucide icon (size, strokeWidth, className…).
const Svg = ({ size = 24, strokeWidth = 1.75, className = '', children, ...rest }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" {...rest}>{children}</svg>
);

export const HiveGlyph = (p) => (
  <Svg {...p}>
    <path d="M12 2.6 20.2 7.3v9.4L12 21.4 3.8 16.7V7.3Z" />
    <path d="M12 8.4 15.1 10.2v3.6L12 15.6 8.9 13.8v-3.6Z" fill="currentColor" stroke="none" />
  </Svg>
);

export const ComposeGlyph = (p) => (
  <Svg {...p}>
    <path d="M15.2 3.6 20.4 8.8 10.6 18.6 4.2 19.8 5.4 13.4Z" />
    <path d="M5.4 13.4 10.6 18.6" />
    <circle cx="9.1" cy="14.9" r="1.15" fill="currentColor" stroke="none" />
    <path d="M13.6 21h6.6" />
  </Svg>
);

export const AssistantGlyph = (p) => (
  <Svg {...p}>
    <path d="M20.5 11.6c0 4.4-3.8 8-8.5 8a9 9 0 0 1-3.4-.66L3.8 20.3l1.3-4A7.6 7.6 0 0 1 3.5 11.6c0-4.4 3.8-8 8.5-8s8.5 3.6 8.5 8Z" />
    <path d="M12 8.6 14.4 10v2.8L12 14.2 9.6 12.8V10Z" fill="currentColor" stroke="none" />
  </Svg>
);
