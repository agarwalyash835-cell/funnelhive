// Server-side rendering of live funnel pages (built with `vite build --ssr`, imported by server/index.js).
import { renderToString } from 'react-dom/server';
import { Page } from './blocks';
import { fontHref, fontHrefFor } from './fonts';

const noop = () => {};
const ctx = { live: true, ssr: true, onNext: noop, onOptin: noop, onCheckout: noop, onAccept: noop, onDecline: noop, onCoupon: noop, onAbandon: noop, onCrossSell: noop, onClaim: noop, getPendingCoupon: noop, onForm: noop, onFormNext: noop };

export function renderFunnelPage({ blocks, theme }) {
  return renderToString(<Page blocks={blocks} theme={theme} ctx={ctx} />);
}
export { fontHref, fontHrefFor };
