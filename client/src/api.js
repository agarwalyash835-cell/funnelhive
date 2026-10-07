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
    const err = new Error(data.error || 'Request failed');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const setToken = (t) => localStorage.setItem('ff_token', t);
export const logout = () => { localStorage.removeItem('ff_token'); location.href = '/login'; };
export const loggedIn = () => !!tok();
