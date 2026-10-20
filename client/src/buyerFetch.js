// Requests from buyer-facing pages (funnels, booking pages, quotes).

// never throws: a dropped connection or a server hiccup comes back as { error } so no button stays stuck on "Processing…"
export const buyerPost = (url, body) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => r.json().catch(() => ({})).then((d) => (r.ok ? d : { ...d, error: d.error || 'Something went wrong — please try again', status: r.status, ...(r.status >= 500 ? { retryable: true } : {}) })))
    .catch(() => ({ error: 'Network problem — check your connection and try again', retryable: true }));

// after the money is taken: keep trying to confirm through a brief network drop, and never invite a second payment
export const confirmPaid = async (url, body) => {
  for (let i = 0; i < 5; i++) {
    const r = await buyerPost(url, body);
    if (!r.retryable) return r;
    await new Promise((ok) => setTimeout(ok, 1500 * (i + 1)));
  }
  return { error: 'Your payment went through, but we couldn’t confirm it yet — please don’t pay again. Refresh this page in a minute; your receipt will also reach your email.' };
};
