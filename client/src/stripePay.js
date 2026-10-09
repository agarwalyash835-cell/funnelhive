// Stripe's Payment Element in a small dialog — buyers on funnel pages, and sellers paying for their plan abroad.
// Stripe (international cards): the Payment Element in a small dialog on the page
const loadStripe = () => (window.Stripe ? Promise.resolve() : new Promise((resolve, reject) => {
  const sc = document.createElement('script');
  sc.src = 'https://js.stripe.com/v3/';
  sc.onload = resolve;
  sc.onerror = () => reject(new Error('Couldn’t load the card form — please check your internet connection and try again'));
  document.head.appendChild(sc);
}));
export const fmtMoney = (n, iso) => { try { return new Intl.NumberFormat(iso === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: iso || 'INR', maximumFractionDigits: 2, ...(Number.isInteger(Number(n)) ? { minimumFractionDigits: 0 } : {}) }).format(n); } catch { return `${iso} ${n}`; } };
export async function stripeDialog(st, returnUrl) {
  await loadStripe();
  const stripe = window.Stripe(st.publishableKey);
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.setAttribute('style', 'position:fixed;inset:0;z-index:9999;background:rgba(15,15,25,.55);display:grid;place-items:center;padding:16px;font-family:inherit');
    const box = document.createElement('div');
    box.setAttribute('style', 'background:#fff;color:#111;border-radius:16px;width:100%;max-width:440px;max-height:92vh;overflow:auto;padding:22px 20px;box-shadow:0 20px 60px rgba(0,0,0,.35);position:relative');
    const x = document.createElement('button'); x.textContent = '×'; x.setAttribute('aria-label', 'Close'); x.setAttribute('style', 'position:absolute;top:8px;right:12px;border:0;background:none;font-size:26px;cursor:pointer;color:#666');
    const h = document.createElement('h3'); h.textContent = st.name || 'Payment'; h.setAttribute('style', 'margin:0 0 2px;font-size:18px');
    const sub = document.createElement('p'); sub.textContent = `${st.description || ''}${st.amount ? ` · ${fmtMoney(st.amount, st.currency)}` : ''}`; sub.setAttribute('style', 'margin:0 0 16px;color:#555;font-size:14px');
    const el = document.createElement('div');
    const err = document.createElement('p'); err.setAttribute('role', 'alert'); err.setAttribute('style', 'color:#b91c1c;font-size:13.5px;min-height:18px;margin:10px 0 0');
    const pay = document.createElement('button'); pay.textContent = st.button || (st.mode === 'setup' ? 'Save card' : st.amount ? `Pay ${fmtMoney(st.amount, st.currency)}` : 'Pay now');
    pay.setAttribute('style', `margin-top:10px;width:100%;padding:14px;border:0;border-radius:10px;font-size:16px;font-weight:700;color:#fff;cursor:pointer;background:${st.color || '#6366f1'}`);
    const note = document.createElement('small'); note.textContent = '🔒 Secured by Stripe'; note.setAttribute('style', 'display:block;text-align:center;margin-top:10px;color:#777');
    box.append(x, h, sub, el, err, pay, note); wrap.append(box); document.body.append(wrap);
    const elements = stripe.elements({ clientSecret: st.clientSecret, appearance: { theme: 'stripe', variables: { colorPrimary: st.color || '#6366f1', borderRadius: '10px' } } });
    elements.create('payment', { layout: 'tabs' }).mount(el);
    const done = (v) => { wrap.remove(); resolve(v); };
    x.onclick = () => done({ error: 'Payment cancelled — you can try again whenever you’re ready' });
    pay.onclick = async () => {
      pay.disabled = true; pay.style.opacity = '.6'; err.textContent = '';
      const r = await (st.mode === 'setup' ? stripe.confirmSetup : stripe.confirmPayment)({ elements, redirect: 'if_required', confirmParams: { return_url: returnUrl } });
      if (r.error) { err.textContent = r.error.message || 'The payment didn’t go through'; pay.disabled = false; pay.style.opacity = '1'; return; }
      done({ ok: true });
    };
  });
}
