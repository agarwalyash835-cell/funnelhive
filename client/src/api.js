const tok = () => localStorage.getItem('ff_token');

export async function api(path, method = 'GET', body) {
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
  return data;
}

export const setToken = (t) => localStorage.setItem('ff_token', t);
export const logout = () => { localStorage.removeItem('ff_token'); localStorage.removeItem('ff_admin_token'); location.href = '/login'; };
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
