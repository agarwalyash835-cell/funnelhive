// The buyer's library: everything they bought (or got free) from one seller — downloads, links and courses.
import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { videoSource } from '../blocks';

const bytes = (n) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n || 0} B`);
const day = (t) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const linkify = (text) => String(text || '').split(/(https?:\/\/[^\s]+)/g).map((part, i) => (/^https?:\/\//.test(part) ? <a key={i} href={part} target="_blank" rel="noreferrer">{part}</a> : part));

export default function Library() {
  const { token } = useParams();
  const [qs] = useSearchParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null);
  const load = () => fetch(`/api/access/${encodeURIComponent(token)}`).then(async (r) => { const x = await r.json(); if (r.ok) setD(x); else setErr(x.error || 'This link isn’t valid.'); }).catch(() => setErr('Couldn’t load your library — check your connection.'));
  useEffect(() => { if (token) load(); }, [token]);
  useEffect(() => { document.title = d?.seller?.name ? `Your library · ${d.seller.name}` : 'Your library'; }, [d]);
  useEffect(() => { if (d && !open && d.products.length === 1 && d.products[0].status === 'active') setOpen(d.products[0].productId); }, [d]);
  const accent = d?.theme?.primary || '#6366f1';

  if (!token) return <Recover seller={qs.get('s')} />;
  if (err) return <div className="lib" style={{ '--acc': accent }}><div className="lib-msg"><div className="lib-ic">🔒</div><h1>Link not valid</h1><p>{err}</p><p className="lib-mute">Your library link is in the email you received after buying. If you can’t find it, ask the seller to send it again.</p></div></div>;
  if (!d) return <div className="lib"><div className="lib-load" /></div>;
  const product = d.products.find((p) => p.productId === open);
  return (
    <div className="lib" style={{ '--acc': accent }}>
      <header className="lib-h">
        <div className="lib-brand"><span className="lib-logo">{(d.seller.name || 'L')[0]}</span><b>{d.seller.name}</b></div>
        <div className="lib-who">{d.email}{d.scope === 'receipt' && <small>this purchase</small>}</div>
      </header>
      {product ? <ProductView token={token} p={product} onBack={d.products.length > 1 ? () => setOpen(null) : null} onChange={load} /> : (
        <main className="lib-main">
          <h1>{d.name ? `Welcome back, ${d.name.split(' ')[0]}` : 'Your library'}</h1>
          <p className="lib-mute">{d.products.length} item{d.products.length === 1 ? '' : 's'} from {d.seller.name}{d.scope === 'receipt' ? ' in this purchase. Your full library link is in your email.' : '.'}</p>
          <div className="lib-grid">
            {d.products.map((p) => {
              const done = p.lessons?.filter((l) => l.done).length || 0, total = p.lessons?.length || 0;
              return (
                <button key={p.productId} className={`lib-card ${p.status !== 'active' ? 'off' : ''}`} onClick={() => p.status === 'active' && setOpen(p.productId)}>
                  <div className="lib-cover" style={p.cover ? { backgroundImage: `url("${p.cover}")` } : undefined}>{!p.cover && <span>{p.kind === 'course' ? '▶' : p.kind === 'link' ? '🔗' : '⬇'}</span>}</div>
                  <div className="lib-cb">
                    <small className="lib-kind">{p.kind === 'course' ? 'Course' : p.kind === 'link' ? 'Resource' : 'Download'}</small>
                    <h3>{p.name}</h3>
                    {p.status !== 'active' ? <p className="lib-ended">{p.status === 'refunded' ? 'Refunded' : p.status === 'expired' ? `Access ended ${day(p.expiresAt)}` : 'Access removed'}</p>
                      : total ? <div className="lib-prog"><div><i style={{ width: `${(done / total) * 100}%` }} /></div><small>{done}/{total} lessons</small></div>
                      : <p className="lib-mute sm">{p.description || `${p.files?.length || 0} file${p.files?.length === 1 ? '' : 's'}${p.links?.length ? ` · ${p.links.length} link${p.links.length > 1 ? 's' : ''}` : ''}`}</p>}
                  </div>
                </button>
              );
            })}
          </div>
          {d.plans?.length > 0 && <Plans token={token} plans={d.plans} onChange={load} />}
        </main>
      )}
      <footer className="lib-f">{d.seller.whatsapp && <a href={`https://wa.me/${d.seller.whatsapp.replace(/\D/g, '').replace(/^(\d{10})$/, '91$1')}`} target="_blank" rel="noreferrer">Need help? WhatsApp {d.seller.name}</a>}<span>Keep this link private — it opens your purchases.</span></footer>
    </div>
  );
}

function FileRow({ f }) {
  return (
    <div className="lib-file">
      <span className="lib-fic">{/^video/.test(f.type) ? '▶' : /pdf/.test(f.type) ? 'PDF' : '⬇'}</span>
      <div><b>{f.name}</b><small>{bytes(f.size)}{f.left != null ? ` · ${f.left} download${f.left === 1 ? '' : 's'} left` : ''}</small></div>
      {f.view && <a className="lib-btn ghost" href={f.view} target="_blank" rel="noreferrer">Open</a>}
      {f.url ? <a className="lib-btn" href={f.url}>Download</a> : <span className="lib-mute sm">Limit reached</span>}
    </div>
  );
}

function ProductView({ token, p, onBack, onChange }) {
  const lessons = p.lessons || [];
  const [cur, setCur] = useState(() => lessons.find((l) => !l.done && !l.locked)?.id || lessons[0]?.id);
  const lesson = lessons.find((l) => l.id === cur);
  const sections = useMemo(() => { const m = []; for (const l of lessons) { const s = m.at(-1); if (s && s.name === l.section) s.items.push(l); else m.push({ name: l.section, items: [l] }); } return m; }, [lessons]);
  const done = lessons.filter((l) => l.done).length;
  const mark = async (l, v) => {
    await fetch(`/api/access/${encodeURIComponent(token)}/progress`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessId: p.accessId, lessonId: l.id, done: v }) });
    await onChange();
    if (v) { const i = lessons.findIndex((x) => x.id === l.id); const n = lessons.slice(i + 1).find((x) => !x.locked); if (n) setCur(n.id); }
  };
  const vs = lesson?.videoUrl ? videoSource(lesson.videoUrl) : null;
  return (
    <main className="lib-main">
      {onBack && <button className="lib-back" onClick={onBack}>← All purchases</button>}
      <div className="lib-ph"><h1>{p.name}</h1>{p.expiresAt && <span className="lib-chip">Access until {day(p.expiresAt)}</span>}</div>
      {p.note && <p className="lib-note">{linkify(p.note)}</p>}
      {lessons.length > 0 && (
        <div className="lib-course">
          <aside className="lib-side">
            <div className="lib-prog big"><div><i style={{ width: `${(done / lessons.length) * 100}%` }} /></div><small>{Math.round((done / lessons.length) * 100)}% complete · {done}/{lessons.length}</small></div>
            {sections.map((s, k) => (
              <div key={k} className="lib-sec">{s.name && <h4>{s.name}</h4>}
                {s.items.map((l) => (
                  <button key={l.id} className={`lib-l ${l.id === cur ? 'on' : ''} ${l.done ? 'done' : ''}`} disabled={l.locked} onClick={() => setCur(l.id)}>
                    <span className="lib-tick">{l.locked ? '🔒' : l.done ? '✓' : ''}</span><span>{l.title}{l.locked && <small>Opens {day(l.opensAt)}</small>}</span>
                  </button>
                ))}
              </div>
            ))}
          </aside>
          <section className="lib-player">
            {lesson && !lesson.locked && <>
              {lesson.video ? <video className="lib-video" src={lesson.video} controls controlsList="nodownload" playsInline preload="metadata" />
                : vs ? (vs.kind === 'video' ? <video className="lib-video" src={vs.src} controls playsInline /> : <iframe className="lib-video" src={vs.src} title={lesson.title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />)
                : null}
              <div className="lib-lh"><h2>{lesson.title}</h2><button className={`lib-btn ${lesson.done ? 'ghost' : ''}`} onClick={() => mark(lesson, !lesson.done)}>{lesson.done ? '✓ Completed' : 'Mark as complete'}</button></div>
              {lesson.body && <div className="lib-body">{linkify(lesson.body)}</div>}
              {lesson.files?.length > 0 && <div className="lib-files"><h4>Downloads</h4>{lesson.files.map((f) => <FileRow key={f.id} f={f} />)}</div>}
            </>}
          </section>
        </div>
      )}
      {(p.files?.length > 0 || p.links?.length > 0) && (
        <div className="lib-files">
          {lessons.length > 0 && <h4>Resources</h4>}
          {p.files.map((f) => <FileRow key={f.id} f={f} />)}
          {p.links.map((l, i) => <div key={i} className="lib-file"><span className="lib-fic">🔗</span><div><b>{l.label}</b><small>{l.url.replace(/^https?:\/\//, '').slice(0, 60)}</small></div><a className="lib-btn" href={l.url} target="_blank" rel="noreferrer">Open</a></div>)}
          {p.downloadLimit > 0 && <p className="lib-mute sm">Each file can be downloaded {p.downloadLimit} time{p.downloadLimit > 1 ? 's' : ''}. Save it somewhere safe.</p>}
        </div>
      )}
    </main>
  );
}

// memberships and payment plans: status, next charge, cancel (memberships end at the close of the paid period)
const PLAN_STATUS = { active: 'Active', authenticated: 'Starting', created: 'Starting', pending: 'Payment due — retrying', halted: 'Paused — payment failed', paused: 'Paused', cancelled: 'Cancelled', completed: 'Paid in full', expired: 'Ended', demo: 'Test' };
function Plans({ token, plans, onChange }) {
  const [busy, setBusy] = useState(null);
  const cancel = async (p) => {
    if (!confirm(`Cancel your ${p.product} membership? You keep access until the end of the period you’ve paid for.`)) return;
    setBusy(p.orderId);
    const r = await fetch(`/api/access/${encodeURIComponent(token)}/plan/${p.orderId}/cancel`, { method: 'POST' }).then((x) => x.json()).catch(() => ({ error: 'Couldn’t reach the server' }));
    setBusy(null);
    if (r.error) alert(r.error); else onChange();
  };
  // a failed payment: off to Razorpay / Stripe to pay it or change the card; we come back with ?fixed=
  const fix = async (p) => {
    setBusy(p.orderId);
    const r = await fetch(`/api/access/${encodeURIComponent(token)}/plan/${p.orderId}/fix`, { method: 'POST' }).then((x) => x.json()).catch(() => ({ error: 'Couldn’t reach the server' }));
    if (r.url) { sessionStorage.setItem('fh-plan-fix', p.orderId); window.location.href = r.url; return; }
    setBusy(null);
    alert(r.error || 'Couldn’t open the payment page');
  };
  // back from paying (Stripe returns with ?fixed=, Razorpay's page leaves us to the back button): read the plan again
  useEffect(() => {
    let id = null;
    try { id = new URLSearchParams(window.location.search).get('fixed') || sessionStorage.getItem('fh-plan-fix'); sessionStorage.removeItem('fh-plan-fix'); } catch {}
    if (!id || !plans.some((p) => p.orderId === id)) return;
    fetch(`/api/access/${encodeURIComponent(token)}/plan/${id}/sync`, { method: 'POST' }).then((x) => x.json()).then((r) => { if (r.status && r.status !== plans.find((p) => p.orderId === id)?.status) onChange(); }).catch(() => {});
  }, []);
  return (
    <section className="lib-plans">
      <h2>Memberships & payment plans</h2>
      {plans.map((p) => (
        <div key={p.orderId} className="lib-plan">
          <div><b>{p.product}</b><small>{p.text}{p.count ? ` · ${Math.min(p.paid, p.count)} of ${p.count} paid` : ''}</small></div>
          <div className="lib-plan-r">
            <span className={`lib-pill s-${p.status}`}>{p.cancelAtEnd && p.status === 'active' ? 'Ends after this period' : PLAN_STATUS[p.status] || p.status}</span>
            {p.nextAt && ['active', 'pending'].includes(p.status) && !p.cancelAtEnd && <small>Next charge {day(p.nextAt)}</small>}
            {['pending', 'halted', 'paused'].includes(p.status) && <button className="lib-btn" disabled={busy === p.orderId} onClick={() => fix(p)}>{p.status === 'pending' ? 'Update payment' : 'Pay now'}</button>}
            {p.type === 'recurring' && ['active', 'pending', 'authenticated'].includes(p.status) && !p.cancelAtEnd && <button className="lib-link" disabled={busy === p.orderId} onClick={() => cancel(p)}>Cancel membership</button>}
          </div>
        </div>
      ))}
    </section>
  );
}

function Recover({ seller }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    await fetch('/api/access-recover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seller, email }) }).catch(() => {});
    setSent(true);
  };
  return (
    <div className="lib"><div className="lib-msg">
      <div className="lib-ic">📚</div>
      <h1>Get your library link</h1>
      {sent ? <p>If <b>{email}</b> has purchases here, we’ve emailed the link to it. Check your inbox (and spam).</p> : seller ? (
        <form className="lib-form" onSubmit={submit}><p>Enter the email you bought with and we’ll send you your link.</p><input type="email" required placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} /><button className="lib-btn">Email me my link</button></form>
      ) : <p>Your library link is in the email you received after buying. If you can’t find it, ask the seller to send it again.</p>}
    </div></div>
  );
}
