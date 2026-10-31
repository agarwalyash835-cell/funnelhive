// Which address this page is on (server tiers.js): the server's page carries
//   <meta name="ff-tier" content="super|agency|app" data-super="https://super…" data-app="https://app…">
// super: only the admin panel and its sign-in. On the app and agency addresses the admin panel isn't there once
// the platform has a super address (data-super). No meta (vite dev server): the app, as before.
const meta = typeof document !== 'undefined' ? document.querySelector('meta[name="ff-tier"]') : null;
export const tier = meta?.getAttribute('content') || 'app';
export const isSuper = tier === 'super';
export const superUrl = meta?.getAttribute('data-super') || '';
export const appUrl = meta?.getAttribute('data-app') || '';
