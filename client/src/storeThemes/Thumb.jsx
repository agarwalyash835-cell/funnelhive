// A small static picture of a theme for Store settings' gallery: its real colours, corners and layout, with its
// demo store's product drawings (tiny cached SVGs).
import { themeVars } from './tokens.js';
import './thumb.css';

export default function ThemeThumb({ theme, accent }) {
  const v = themeVars(theme, accent ? { accent } : {});
  const art = theme.demo ? [1, 2, 3, 4].map((i) => `/api/s/${theme.demo}/art/${theme.id}-0${i}.svg`) : [];
  const hero = theme.layout.hero || 'minimal';
  return (
    <div className={`tt tt-${theme.id}${theme.tokens.dark ? ' dark' : ''}`} style={v} aria-hidden="true">
      <div className="tt-ann" />
      <div className={`tt-hdr h-${theme.layout.header}`}><i /><b /><i /></div>
      <div className={`tt-hero r-${hero}`}>{art[0] && <img src={art[0]} alt="" loading="lazy" width="120" height="120" />}<span><b /><i /><em /></span></div>
      <div className={`tt-grid c-${theme.layout.card}`}>{[1, 2, 3].map((i) => <div key={i}><span>{art[i] ? <img src={art[i]} alt="" loading="lazy" width="60" height="60" /> : null}</span><i /><b /></div>)}</div>
    </div>
  );
}
