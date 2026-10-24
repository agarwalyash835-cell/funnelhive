// Partners (white-label reselling) — the three screens:
//   AdminPartners   — super admin: partners and their wholesale terms, wallets, sub-accounts; create accounts
//   PartnerConsole  — the partner (Agency page): plans & credit packs to sell, wallet, sub-accounts' plans
//   ResoldBilling   — a sub-account (Plan & billing): its partner's plans and credit packs, paid to the partner
import { useEffect, useState } from 'react';
import { api, loadRazorpay, fmtDate } from './api';
import { Panel, Icon, Modal, Empty, inr, num, toast, confirmDialog, promptDialog } from './ui';

// Razorpay Checkout for an order the server made; resolves with the verify call's answer (or null if closed)
async function checkout(start, verifyPath, onDone) {
  try { await loadRazorpay(); } catch (e) { toast(e.message); return; }
  const rz = new window.Razorpay({
    key: start.key, order_id: start.order_id, amount: start.amount, currency: start.currency, name: start.name, description: start.description, prefill: start.prefill, retry: { enabled: true },
    handler: async (r) => { try { onDone(await api(verifyPath, 'POST', { payment: start.payment, ...r })); } catch (e) { toast(e.message); } },
  });
  rz.open();
}
const STATUS = { trialing: ['Trial', 'info'], active: ['Active', 'ok'], comped: ['Free', 'ok'], expired: ['Expired', 'bad'] };
const subPill = (s) => { if (!s) return <span className="pill">Covered by you</span>; const st = s.access?.ok ? s.status : 'expired'; const [l, c] = STATUS[st] || [st, '']; return <span className={`pill ${c}`}>{l}</span>; };
const KIND = { topup: 'Top-up', account_fee: 'Account fee', ai_credits: 'AI credits', adjust: 'Adjustment' };

// ---------------- the partner ----------------
export function PartnerConsole({ onChanged }) {
  const [d, setD] = useState(null);
  const [edit, setEdit] = useState(null);
  const [add, setAdd] = useState(false);
  const [planFor, setPlanFor] = useState(null);
  const load = () => api('/partner').then(setD).catch(() => setD({ enabled: false }));
  useEffect(() => { load(); }, []);
  if (!d || !d.enabled) return null;
  const topUp = async () => {
    const v = await promptDialog({ title: 'Top up your partner wallet', text: 'Your wallet pays for your clients’ accounts and the AI credits they use.', label: 'Amount (₹)', value: '5000', type: 'text' });
    if (!v) return;
    try { const s = await api('/partner/wallet/topup', 'POST', { amount: Number(v) }); checkout(s, '/partner/wallet/verify', () => { toast('Wallet topped up'); load(); }); } catch (e) { toast(e.message); }
  };
  const low = d.balance < (d.terms.perAccount || 0) * Math.max(1, d.clients.length);
  return (
    <div className="pt-console">
      <div className="kpis k4">
        <div className={`kpi ${low ? 'warn' : ''}`}><span className="kpi-l">Partner wallet</span><b className="kpi-v">{inr(d.balance)}</b><div className="kpi-f">{d.canTopUp ? <button className="link-btn" onClick={topUp}>Top up →</button> : <small>Contact us to add funds</small>}</div></div>
        <div className="kpi"><span className="kpi-l">Your sales (30 days)</span><b className="kpi-v">{inr(d.revenue30)}</b><div className="kpi-f"><small>paid to your Razorpay</small></div></div>
        <div className="kpi"><span className="kpi-l">Accounts on your plans</span><b className="kpi-v">{num(d.clients.filter((c) => c.sub).length)}<small> / {num(d.terms.maxAccounts)}</small></b></div>
        <div className="kpi"><span className="kpi-l">Your wholesale cost</span><b className="kpi-v">{inr(d.terms.perAccount)}<small>/account</small></b><div className="kpi-f"><small>+ {inr(d.terms.creditRate)} per 100 AI credits used</small></div></div>
      </div>
      {d.terms.hold && <div className="note-bar warn"><span><b>Your wallet is overdrawn.</b> Top it up — your clients’ accounts pause 7 days after {fmtDate(d.terms.hold)}.</span></div>}
      {!d.payments && <div className="note-bar"><span>Connect <b>your own Razorpay</b> so your clients can pay you for plans and credits.</span><a href="/settings#payments">Connect Razorpay →</a></div>}

      <Panel title="What you sell" actions={<button className="btn primary sm" onClick={() => setEdit(structuredClone(d.resale))}><Icon name="edit" size={14} /> Edit plans & packs</button>}>
        {!d.resale.plans.length ? <Empty icon="tag" title="No plans yet" text="Create the plans your clients subscribe to — your price, your AI credits, your free-trial days. Your margin is the difference from your wholesale cost."><button className="btn primary" onClick={() => setEdit({ plans: [{ name: 'Starter', monthly: 1999, yearly: 19990, credits: 300, trialDays: 7 }], packs: [{ credits: 500, price: 999 }], defaultPlan: '' })}>Create your first plan</button></Empty> : (
          <div className="pt-plans">{d.resale.plans.map((p) => (
            <div key={p.id} className="pt-plan">
              <span className="pt-plan-h"><b>{p.name}</b>{d.resale.defaultPlan === p.id && <small className="pill info">Default for sign-ups</small>}</span>
              <span className="pt-price">{p.monthly > 0 ? <>{inr(p.monthly)}<small>/month</small></> : null}{p.yearly > 0 && <small className="muted"> · {inr(p.yearly)}/year</small>}</span>
              <small className="muted">{num(p.credits)} AI credits a month{p.trialDays ? ` · ${p.trialDays}-day trial` : ''}</small>
              <small className="pt-margin">Your margin ≈ {inr(Math.max(0, p.monthly - d.terms.perAccount - (p.credits * d.terms.creditRate) / 100))}/month at full AI use</small>
            </div>
          ))}
          {d.resale.packs.map((k) => <div key={k.id} className="pt-plan pack"><b>{num(k.credits)} AI credits</b><span className="pt-price">{inr(k.price)}</span><small className="pt-margin">Costs you {inr((k.credits * d.terms.creditRate) / 100)} when used</small></div>)}</div>
        )}
      </Panel>

      <Panel pad={false} title="Your clients’ plans" actions={<button className="btn primary sm" onClick={() => setAdd(true)}><Icon name="plus" size={14} /> New sub-account</button>}>
        {!d.clients.length ? <Empty icon="users" title="No sub-accounts yet" text="Create one here, or share your app domain — anyone who signs up there becomes your sub-account on your default plan." /> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Account</th><th>Plan</th><th>Status</th><th>Renews / ends</th><th className="r">AI credits</th><th /></tr></thead>
            <tbody>{d.clients.map((c) => (
              <tr key={c.id}>
                <td><b>{c.business}</b><small className="sub-t">{c.email || 'not invited yet'}</small></td>
                <td>{c.sub?.plan?.name || '—'}</td>
                <td>{subPill(c.sub)}</td>
                <td>{c.sub?.status === 'trialing' ? fmtDate(c.sub.trialEndsAt) : c.sub?.periodEnd ? fmtDate(c.sub.periodEnd) : '—'}</td>
                <td className="r">{num(c.credits.used)}{c.credits.limit != null ? ` / ${num(c.credits.limit)}` : ''}</td>
                <td className="r nowrap"><button className="btn ghost sm" onClick={() => setPlanFor(c)}>Change plan</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>

      <Panel pad={false} title="Wallet history">
        {!d.ledger.length ? <p className="muted sm" style={{ padding: 16 }}>No wallet activity yet.</p> : (
          <div className="tbl-wrap"><table className="tbl compact"><tbody>{d.ledger.map((l) => <tr key={l.id}><td>{fmtDate(l.at)}</td><td><span className="pill">{KIND[l.kind] || l.kind}</span></td><td>{l.note}</td><td className={`r strong ${l.amount < 0 ? 'bad-t' : 'ok-t'}`}>{l.amount < 0 ? '−' : '+'}{inr(Math.abs(l.amount))}</td></tr>)}</tbody></table></div>
        )}
      </Panel>

      {edit && <ResaleEditor v={edit} terms={d.terms} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {add && <NewSub plans={d.resale.plans} onClose={() => setAdd(false)} onDone={() => { setAdd(false); load(); onChanged?.(); }} />}
      {planFor && <SubPlan c={planFor} plans={d.resale.plans} onClose={() => setPlanFor(null)} onDone={() => { setPlanFor(null); load(); }} />}
    </div>
  );
}

function ResaleEditor({ v: v0, terms, onClose, onSaved }) {
  const [v, setV] = useState(v0);
  const setPlan = (i, p) => setV({ ...v, plans: v.plans.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const setPack = (i, p) => setV({ ...v, packs: v.packs.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const save = async () => { try { await api('/partner/resale', 'PUT', v); toast('Saved'); onSaved(); } catch (e) { toast(e.message); } };
  return (
    <Modal title="Plans & credit packs you sell" onClose={onClose} width={860}>
      <div className="m-body">
        <p className="muted sm">Your wholesale cost: {inr(terms.perAccount)} per active account every 30 days, plus {inr(terms.creditRate)} per 100 AI credits your clients use. Set your own prices on top.</p>
        <h4 className="pt-h4">Plans</h4>
        {v.plans.map((p, i) => (
          <div key={i} className="pt-row">
            <div className="fld"><label>Name</label><input value={p.name} onChange={(e) => setPlan(i, { name: e.target.value })} placeholder="Starter" /></div>
            <div className="fld"><label>₹ / month</label><input type="number" min="0" value={p.monthly} onChange={(e) => setPlan(i, { monthly: e.target.value })} /></div>
            <div className="fld"><label>₹ / year</label><input type="number" min="0" value={p.yearly || ''} onChange={(e) => setPlan(i, { yearly: e.target.value })} placeholder="optional" /></div>
            <div className="fld"><label>AI credits / month</label><input type="number" min="0" value={p.credits} onChange={(e) => setPlan(i, { credits: e.target.value })} /></div>
            <div className="fld"><label>Trial days</label><input type="number" min="0" max="60" value={p.trialDays || 0} onChange={(e) => setPlan(i, { trialDays: e.target.value })} /></div>
            <label className="pt-def" title="New sign-ups on your app domain start on this plan"><input type="radio" checked={(v.defaultPlan || v.plans[0]?.id) === (p.id || `new${i}`)} onChange={() => setV({ ...v, defaultPlan: p.id || `new${i}` })} /> Default</label>
            <button className="btn ghost sm" aria-label="Remove plan" onClick={() => setV({ ...v, plans: v.plans.filter((_, j) => j !== i) })}><Icon name="x" size={14} /></button>
          </div>
        ))}
        {v.plans.length < 8 && <button className="btn ghost sm" onClick={() => setV({ ...v, plans: [...v.plans, { name: '', monthly: 0, yearly: 0, credits: 300, trialDays: 7 }] })}><Icon name="plus" size={14} /> Add plan</button>}
        <h4 className="pt-h4">AI credit packs <small className="muted">· extra credits a client can buy any time</small></h4>
        {v.packs.map((k, i) => (
          <div key={i} className="pt-row pack">
            <div className="fld"><label>Credits</label><input type="number" min="1" value={k.credits} onChange={(e) => setPack(i, { credits: e.target.value })} /></div>
            <div className="fld"><label>Your price (₹)</label><input type="number" min="1" value={k.price} onChange={(e) => setPack(i, { price: e.target.value })} /></div>
            <small className="muted pt-cost">costs you {inr(((Number(k.credits) || 0) * terms.creditRate) / 100)} when used</small>
            <button className="btn ghost sm" aria-label="Remove pack" onClick={() => setV({ ...v, packs: v.packs.filter((_, j) => j !== i) })}><Icon name="x" size={14} /></button>
          </div>
        ))}
        {v.packs.length < 6 && <button className="btn ghost sm" onClick={() => setV({ ...v, packs: [...v.packs, { credits: 500, price: 999 }] })}><Icon name="plus" size={14} /> Add pack</button>}
        <div className="m-foot"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></div>
      </div>
    </Modal>
  );
}

function NewSub({ plans, onClose, onDone }) {
  const [v, setV] = useState({ business: '', name: '', email: '', planId: plans[0]?.id || '', status: 'trialing' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('/partner/accounts', 'POST', v);
      if (r.link) await promptDialog({ title: 'Account ready — send them this link', text: 'Email isn’t set up, so share this set-password link yourself (valid 7 days).', value: r.link, readOnly: true, confirm: 'Done', cancel: null });
      else toast(`Account ready — ${v.email} got a link to set their password`);
      onDone();
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  return (
    <Modal title="New sub-account" onClose={onClose} width={520}>
      <div className="m-body">
        <div className="fld"><label>Business name</label><input value={v.business} onChange={(e) => setV({ ...v, business: e.target.value })} placeholder="Asha Boutique" /></div>
        <div className="fld"><label>Owner’s name</label><input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></div>
        <div className="fld"><label>Owner’s email</label><input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} placeholder="owner@business.in" /></div>
        {plans.length > 0 && <div className="form2">
          <div className="fld"><label>Plan</label><select value={v.planId} onChange={(e) => setV({ ...v, planId: e.target.value })}><option value="">None — covered by you</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name} · {inr(p.monthly)}/month</option>)}</select></div>
          {v.planId && <div className="fld"><label>Start as</label><select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}><option value="trialing">Free trial (they pay you after)</option><option value="active">Paid — 30 days (collected outside the app)</option><option value="comped">Free, no end date</option></select></div>}
        </div>}
        <p className="hint">They get an email with a link to set their password and sign in — on your app domain, in your brand. You can open the account any time from your agency switcher.</p>
        <div className="m-foot"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !v.email || !v.business} onClick={save}>{busy ? 'Creating…' : 'Create account'}</button></div>
      </div>
    </Modal>
  );
}

function SubPlan({ c, plans, onClose, onDone }) {
  const [v, setV] = useState({ planId: c.sub?.planId || plans[0]?.id || '', status: c.sub?.status === 'comped' ? 'comped' : 'active', interval: c.sub?.interval || 'monthly', days: 30 });
  const save = async (body) => { try { await api(`/partner/clients/${c.id}/plan`, 'PUT', body); toast('Plan updated'); onDone(); } catch (e) { toast(e.message); } };
  const credits = async () => { const n = await promptDialog({ title: `Give ${c.business} extra AI credits`, label: 'Credits (negative to remove)', value: '100' }); if (n) { try { await api(`/partner/clients/${c.id}/credits`, 'POST', { credits: Number(n) }); toast('Credits updated'); onDone(); } catch (e) { toast(e.message); } } };
  return (
    <Modal title={`${c.business} — plan`} onClose={onClose} width={520}>
      <div className="m-body">
        <div className="fld"><label>Plan</label><select value={v.planId} onChange={(e) => setV({ ...v, planId: e.target.value })}>{plans.map((p) => <option key={p.id} value={p.id}>{p.name} · {inr(p.monthly)}/month · {num(p.credits)} credits</option>)}</select></div>
        <div className="form2">
          <div className="fld"><label>Status</label><select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}><option value="active">Paid (you collected it)</option><option value="trialing">Free trial</option><option value="comped">Free, no end date</option></select></div>
          {v.status !== 'comped' && <div className="fld"><label>{v.status === 'trialing' ? 'Trial days' : 'Days to add'}</label><input type="number" min="1" max="400" value={v.days} onChange={(e) => setV({ ...v, days: e.target.value })} /></div>}
        </div>
        <p className="hint">Clients can also pay you themselves in Plan & billing — that extends their plan automatically.</p>
        <div className="m-foot">
          {c.sub && <button className="btn ghost danger" onClick={async () => (await confirmDialog({ title: `Take ${c.business} off your plans?`, text: 'They’ll be covered by your own account again, as before.', confirm: 'Remove plan', danger: true })) && save({ planId: null })}>Remove plan</button>}
          <button className="btn ghost" onClick={credits}>Extra credits</button>
          <button className="btn primary" disabled={!v.planId} onClick={() => save(v)}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------- the sub-account ----------------
export function ResoldBilling() {
  const [d, setD] = useState(null);
  const [ivl, setIvl] = useState('monthly');
  const load = () => api('/partner-billing').then(setD).catch(() => setD({ resold: false }));
  useEffect(() => { load(); }, []);
  if (!d) return <div className="skeleton" />;
  if (!d.resold) return null;
  const s = d.sub, a = s?.access;
  const buy = async (body) => { try { const st = await api('/partner-billing/pay', 'POST', body); checkout(st, '/partner-billing/verify', () => { toast('Payment received — thank you!'); load(); }); } catch (e) { toast(e.message); } };
  const hasYear = d.plans.some((p) => p.yearly > 0);
  return (
    <>
      <section className={`bill-status st-${a?.ok ? 'active' : 'expired'}`}>
        <Icon name={a?.ok ? 'check' : 'alert'} size={20} />
        <div><b>{s ? `${s.plan?.name || 'Your'} plan · ${STATUS[a?.ok ? s.status : 'expired']?.[0] || s.status}` : `Covered by ${d.brand}`}</b>
          <small>{!s ? 'Billing is handled by your provider.' : s.status === 'trialing' ? `Free trial until ${fmtDate(s.trialEndsAt)}` : s.periodEnd ? `${a?.ok ? 'Paid until' : 'Ended on'} ${fmtDate(s.periodEnd)}` : s.status === 'comped' ? 'Free — no renewal needed' : ''}{a?.reason ? ` — ${a.reason}` : ''}</small></div>
      </section>
      <div className="kpis k4">
        <div className="kpi"><span className="kpi-l">AI credits this month</span><b className="kpi-v">{num(d.credits.used)}<small>{d.credits.limit != null ? ` / ${num(d.credits.limit)}` : ''}</small></b></div>
        <div className="kpi"><span className="kpi-l">Extra credits</span><b className="kpi-v">{num(s?.extraCredits || 0)}</b><div className="kpi-f"><small>from packs — used after your plan’s credits</small></div></div>
      </div>
      {d.plans.length > 0 && (
        <Panel title="Plans" actions={hasYear && <div className="seg sm"><button className={ivl === 'monthly' ? 'on' : ''} onClick={() => setIvl('monthly')}>Monthly</button><button className={ivl === 'yearly' ? 'on' : ''} onClick={() => setIvl('yearly')}>Yearly</button></div>}>
          <div className="pt-plans">{d.plans.map((p) => {
            const price = ivl === 'yearly' && p.yearly > 0 ? p.yearly : p.monthly, mine = s?.planId === p.id;
            return (
              <div key={p.id} className={`pt-plan buy ${mine ? 'mine' : ''}`}>
                <span className="pt-plan-h"><b>{p.name}</b>{mine && <small className="pill ok">Your plan</small>}</span>
                <span className="pt-price">{inr(price)}<small>/{ivl === 'yearly' && p.yearly > 0 ? 'year' : 'month'}</small></span>
                <small className="muted">{num(p.credits)} AI credits a month</small>
                {p.about && <small className="muted">{p.about}</small>}
                <button className="btn primary sm" disabled={!d.canPay || !(price > 0)} onClick={() => buy({ planId: p.id, interval: ivl === 'yearly' && p.yearly > 0 ? 'yearly' : 'monthly' })}>{mine && a?.ok ? 'Renew' : mine ? 'Renew now' : 'Choose'}</button>
              </div>
            );
          })}</div>
          {!d.canPay && <p className="hint">Online payment isn’t set up yet — contact {d.supportEmail}.</p>}
        </Panel>
      )}
      {d.packs.length > 0 && (
        <Panel title="Need more AI credits?">
          <div className="pt-plans">{d.packs.map((k) => (
            <div key={k.id} className="pt-plan buy"><b>{num(k.credits)} AI credits</b><span className="pt-price">{inr(k.price)}</span><small className="muted">One-time · never expire</small><button className="btn ghost sm" disabled={!d.canPay} onClick={() => buy({ kind: 'pack', packId: k.id })}>Buy</button></div>
          ))}</div>
        </Panel>
      )}
      <p className="hint">Payments go to {d.brand}. Questions about billing? {d.supportEmail}</p>
    </>
  );
}

// ---------------- the super admin ----------------
export function AdminPartners() {
  const [list, setList] = useState(null);
  const [terms, setTerms] = useState(null);
  const [create, setCreate] = useState(null);
  const [tree, setTree] = useState(null);
  const load = () => api('/admin/partners').then(setList).catch((e) => toast(e.message));
  useEffect(() => { load(); }, []);
  const wallet = async (p) => {
    const v = await promptDialog({ title: `Adjust ${p.brand || p.email}’s wallet`, text: `Balance ${inr(p.balance)}. Positive adds funds, negative deducts.`, label: 'Amount (₹)', value: '' });
    if (!v) return;
    const note = await promptDialog({ title: 'Note for the ledger', label: 'Note', value: Number(v) > 0 ? 'Funds added' : 'Deduction' });
    try { await api(`/admin/partners/${p.id}/wallet`, 'POST', { amount: Number(v), note: note || '' }); toast('Wallet updated'); load(); } catch (e) { toast(e.message); }
  };
  const open = async (p) => { try { setTree({ p, list: await api(`/admin/partners/${p.id}/clients`) }); } catch (e) { toast(e.message); } };
  return (
    <>
      <Panel title="Partners (white-label resellers)" pad={false} actions={<div className="row">
        <button className="btn ghost sm" onClick={async () => { try { await api('/admin/partners/bill-now', 'POST', {}); toast('Partner billing run'); load(); } catch (e) { toast(e.message); } }}>Run billing now</button>
        <button className="btn ghost sm" onClick={async () => {
          const email = await promptDialog({ title: 'Make an existing account a partner', label: 'Their account email', value: '' });
          if (!email) return;
          try { const r = await api(`/admin/users?q=${encodeURIComponent(email.trim())}`); const u = r.users.find((x) => x.email === email.trim().toLowerCase()) || r.users[0]; if (!u) return toast('No account with that email'); setTerms({ enabled: false, perAccount: 499, creditRate: 25, maxAccounts: 50, id: u.id, who: u.email }); } catch (e) { toast(e.message); }
        }}>Existing account → partner</button>
        <button className="btn ghost sm" onClick={() => setCreate({ type: 'user' })}><Icon name="plus" size={14} /> End-user account</button>
        <button className="btn primary sm" onClick={() => setCreate({ type: 'partner', perAccount: 499, creditRate: 25, maxAccounts: 50 })}><Icon name="plus" size={14} /> New partner</button>
      </div>}>
        {!list ? <div className="skeleton" /> : !list.length ? <Empty icon="layers" title="No partners yet" text="Create a partner, or switch on reselling for an agency below. Partners sell their own plans to the accounts they create and pay you wholesale from a prepaid wallet." /> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Partner</th><th>Reselling</th><th className="r">Wholesale</th><th className="r">Accounts</th><th className="r">Wallet</th><th /></tr></thead>
            <tbody>{list.map((p) => (
              <tr key={p.id}>
                <td><b>{p.brand || p.name}</b><small className="sub-t">{p.email}</small></td>
                <td>{p.terms.enabled ? <span className="pill ok">On</span> : <span className="pill">Agency only</span>}{p.terms.hold && <span className="pill bad">On hold</span>}</td>
                <td className="r">{p.terms.enabled ? <>{inr(p.terms.perAccount)}/acct<small className="sub-t">{inr(p.terms.creditRate)}/100 credits</small></> : '—'}</td>
                <td className="r">{num(p.active)}<small className="sub-t">{num(p.clients)} total · max {num(p.terms.maxAccounts)}</small></td>
                <td className={`r strong ${p.balance < 0 ? 'bad-t' : ''}`}>{inr(p.balance)}</td>
                <td className="r nowrap">
                  <button className="btn ghost sm" onClick={() => open(p)}>Accounts</button>
                  <button className="btn ghost sm" onClick={() => setTerms({ ...p.terms, id: p.id, who: p.brand || p.email })}>Terms</button>
                  {p.terms.enabled && <button className="btn ghost sm" onClick={() => wallet(p)}>Wallet</button>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      {terms && <PartnerTerms t={terms} onClose={() => setTerms(null)} onDone={() => { setTerms(null); load(); }} />}
      {create && <CreateAccount v0={create} partners={(list || []).filter((p) => p.terms.enabled)} onClose={() => setCreate(null)} onDone={() => { setCreate(null); load(); }} />}
      {tree && (
        <Modal title={`${tree.p.brand || tree.p.email} — accounts`} onClose={() => setTree(null)} width={760}>
          <div className="m-body">{!tree.list.length ? <p className="muted">No accounts yet.</p> : (
            <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th>Account</th><th>Plan</th><th>Status</th><th>Created</th></tr></thead>
              <tbody>{tree.list.map((c) => <tr key={c.id}><td><b>{c.business}</b><small className="sub-t">{c.email || 'not invited'}</small></td><td>{c.sub?.plan?.name || 'Covered by partner'}</td><td>{subPill(c.sub)}</td><td>{fmtDate(c.createdAt)}</td></tr>)}</tbody></table></div>
          )}</div>
        </Modal>
      )}
    </>
  );
}

function PartnerTerms({ t, onClose, onDone }) {
  const [v, setV] = useState(t);
  const save = async (enabled) => { try { await api(`/admin/partners/${t.id}`, 'PUT', { ...v, enabled }); toast(enabled ? 'Partner terms saved' : 'Reselling switched off'); onDone(); } catch (e) { toast(e.message); } };
  return (
    <Modal title={`Wholesale terms — ${t.who}`} onClose={onClose} width={520}>
      <div className="m-body">
        <div className="form2">
          <div className="fld"><label>₹ per active account / 30 days</label><input type="number" min="0" value={v.perAccount} onChange={(e) => setV({ ...v, perAccount: e.target.value })} /></div>
          <div className="fld"><label>₹ per 100 AI credits used</label><input type="number" min="0" value={v.creditRate} onChange={(e) => setV({ ...v, creditRate: e.target.value })} /></div>
          <div className="fld"><label>Max sub-accounts</label><input type="number" min="1" value={v.maxAccounts} onChange={(e) => setV({ ...v, maxAccounts: e.target.value })} /></div>
        </div>
        <p className="hint">Turning reselling on makes the partner’s own workspace free (they pay through the wallet), and lets them sell their own plans and credit packs.</p>
        <div className="m-foot">{t.enabled && <button className="btn ghost danger" onClick={() => save(false)}>Switch reselling off</button>}<button className="btn primary" onClick={() => save(true)}>{t.enabled ? 'Save' : 'Switch reselling on'}</button></div>
      </div>
    </Modal>
  );
}

function CreateAccount({ v0, partners, onClose, onDone }) {
  const [v, setV] = useState({ email: '', name: '', business: '', partnerId: '', comp: false, ...v0 });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('/admin/accounts', 'POST', v);
      if (r.link) await promptDialog({ title: 'Account created — share the sign-in link', text: 'Email isn’t set up, so send this set-password link yourself (valid 7 days).', value: r.link, readOnly: true, confirm: 'Done', cancel: null });
      else toast(`Created — ${v.email} got a link to set their password`);
      onDone();
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const partner = v.type === 'partner';
  return (
    <Modal title={partner ? 'New partner (white-label admin)' : 'New end-user account'} onClose={onClose} width={560}>
      <div className="m-body">
        <div className="form2">
          <div className="fld"><label>Business name</label><input value={v.business} onChange={(e) => setV({ ...v, business: e.target.value })} /></div>
          <div className="fld"><label>Owner’s name</label><input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></div>
        </div>
        <div className="fld"><label>Owner’s email</label><input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></div>
        {partner ? (
          <div className="form2">
            <div className="fld"><label>₹ per account / 30 days</label><input type="number" min="0" value={v.perAccount} onChange={(e) => setV({ ...v, perAccount: e.target.value })} /></div>
            <div className="fld"><label>₹ per 100 AI credits</label><input type="number" min="0" value={v.creditRate} onChange={(e) => setV({ ...v, creditRate: e.target.value })} /></div>
            <div className="fld"><label>Max sub-accounts</label><input type="number" min="1" value={v.maxAccounts} onChange={(e) => setV({ ...v, maxAccounts: e.target.value })} /></div>
          </div>
        ) : (
          <>
            <div className="fld"><label>Belongs to</label><select value={v.partnerId} onChange={(e) => setV({ ...v, partnerId: e.target.value })}><option value="">The platform directly</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.brand || p.email} (partner)</option>)}</select></div>
            {!v.partnerId && <label className="tog"><input type="checkbox" checked={v.comp} onChange={(e) => setV({ ...v, comp: e.target.checked })} /><span />Free account (no trial end)</label>}
          </>
        )}
        <p className="hint">The owner gets an email with a link to set their password.{partner ? ' They can then add white-label branding and their own Razorpay, create plans and sell sub-accounts.' : ''}</p>
        <div className="m-foot"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !v.email} onClick={save}>{busy ? 'Creating…' : 'Create'}</button></div>
      </div>
    </Modal>
  );
}
