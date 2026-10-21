const tok = () => localStorage.getItem('ff_token');

// Sessions slide: a token older than a day is swapped for a fresh one (the server signs idle devices out after 14 days)
const issuedAt = (t) => { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).iat * 1000; } catch { return 0; } };
let refreshing = null;
function refresh() {
  const t = tok();
  if (!t || refreshing || Date.now() - issuedAt(t) < 86400000 || localStorage.getItem('ff_admin_token')) return refreshing;
  refreshing = fetch('/api/auth/refresh', { method: 'POST', headers: { Authorization: 'Bearer ' + t } })
    .then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.token && tok() === t) setToken(d.token); }).catch(() => {}).finally(() => { refreshing = null; });
  return refreshing;
}

// the signed-in account (/me), shared by every screen for a short while; any change you save refreshes it
export const meCache = { data: null, at: 0 };

export async function api(path, method = 'GET', body) {
  await refresh();
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(tok() ? { Authorization: 'Bearer ' + tok() } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && tok()) { localStorage.removeItem('ff_token'); location.href = '/login'; }
    // trial / subscription over, or AI credits used up: the app shell shows the upgrade prompt
    if (res.status === 402) window.dispatchEvent(new CustomEvent('ff:paywall', { detail: data }));
    const err = new Error(data.error || 'Request failed');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  if (method !== 'GET') meCache.at = 0;
  return data;
}

export const setToken = (t) => localStorage.setItem('ff_token', t);
// signs this device's session out on the server too
export const logout = () => {
  const t = tok();
  if (t) fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + t }, keepalive: true }).catch(() => {});
  localStorage.removeItem('ff_token'); localStorage.removeItem('ff_admin_token'); location.href = '/login';
};
export const loggedIn = () => !!tok();

// "Log in as" a seller (admins, for support) and back
export const impersonate = (token) => { localStorage.setItem('ff_admin_token', tok()); setToken(token); location.href = '/'; };
export const stopImpersonating = () => { const t = localStorage.getItem('ff_admin_token'); localStorage.removeItem('ff_admin_token'); if (t) setToken(t); location.href = '/admin'; };

// Razorpay Checkout is loaded only when someone actually pays
export const loadRazorpay = () => (window.Razorpay ? Promise.resolve() : new Promise((resolve, reject) => {
  const sc = document.createElement('script');
  sc.src = 'https://checkout.razorpay.com/v1/checkout.js';
  sc.onload = resolve;
  sc.onerror = () => reject(new Error('Couldn’t open the payment window — please check your internet connection and try again'));
  document.head.appendChild(sc);
}));

export const fmtDate = (t) => (t ? new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
