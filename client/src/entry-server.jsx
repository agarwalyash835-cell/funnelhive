// Server-side rendering of live funnel pages (built with `vite build --ssr`, imported by server/index.js).
import { renderToString } from 'react-dom/server';
import { Page } from './blocks';
import { fontHref, fontHrefFor } from './fonts';

const noop = () => {};
const ctx = { live: true, ssr: true, onNext: noop, onOptin: noop, onCheckout: noop, onAccept: noop, onDecline: noop, onCoupon: noop, onAbandon: noop, onCrossSell: noop, onClaim: noop, getPendingCoupon: noop, onForm: noop, onFormNext: noop };

// seller + lang: the legal footer (SellerFooter) is in the first HTML, matching what the browser then renders
// pageBase: where this funnel's pages live ('/' on its own domain, '/f/<slug>/' otherwise) — for website menus
export function renderFunnelPage({ blocks, theme, seller = null, lang = 'en', pageBase = '/', stepSlug = '', stepIndex = 0 }) {
  const pageHref = (s) => (s ? `${pageBase}${s}` : pageBase.replace(/\/$/, '') || '/');
  return renderToString(<Page blocks={blocks} theme={theme} ctx={{ ...ctx, seller, lang, pageHref, stepSlug, stepIndex }} />);
}
export { fontHref, fontHrefFor };
