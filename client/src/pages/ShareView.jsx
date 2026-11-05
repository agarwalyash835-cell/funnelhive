// The client's side of a Studio share link (server studio/share.js): watch the Reel, clip, image or design and, if the
// link allows it, download it. No account. Shown in the brand of the kit it was made with, never the platform's.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import '../share-view.css';

const day = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

export default function ShareView() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    fetch(`/api/view/${encodeURIComponent(token)}`).then(async (r) => { const x = await r.json().catch(() => ({})); if (!live) return; if (r.ok) setD(x); else setErr(x); }).catch(() => live && setErr({ error: 'This link couldn’t be opened — check your connection and try again' }));
    return () => { live = false; };
  }, [token]);
  // the tab never shows the platform's name: the item and its brand, or a plain word while loading or once it's ended
  useEffect(() => { document.title = d ? `${d.title}${d.brand?.name ? ` · ${d.brand.name}` : ''}` : err ? 'Link ended' : 'Preview'; }, [d, err]);
  // keep the page out of search results and don't hand the link on to other sites
  useEffect(() => {
    const add = (name, content) => { const m = document.createElement('meta'); m.name = name; m.content = content; document.head.appendChild(m); return m; };
    const tags = [add('robots', 'noindex, nofollow'), add('referrer', 'no-referrer')];
    return () => tags.forEach((m) => m.remove());
  }, []);

  if (err) return (
    <main className="shv shv-gone">
      <h1>{err.expired ? 'This link has ended' : 'Link not found'}</h1>
      <p>{err.error}. Ask whoever sent it for a new one.</p>
    </main>
  );
  if (!d) return <main className="shv"><div className="shv-wait" aria-label="Loading" /></main>;
  const f = d.files[n] || d.files[0];
  const src = (i, dl) => `/api/view/${encodeURIComponent(token)}/file/${i}${dl ? '?dl=1' : ''}`;
  return (
    <main className="shv">
      <header className="shv-brand">
        {d.brand.logo && <img src={d.brand.logo} alt={d.brand.name || 'Logo'} />}
        {d.brand.name && <b>{d.brand.name}</b>}
      </header>
      <section className="shv-body">
        <div className="shv-media">
          {d.updating || !f ? <p className="shv-note">This is being updated — open the link again in a few minutes.</p>
            : f.type === 'video' ? <video key={f.n} src={src(f.n)} poster={d.poster || undefined} controls playsInline preload="metadata" controlsList={d.download ? undefined : 'nodownload'} />
              : <img key={f.n} src={src(f.n)} alt={d.title} />}
        </div>
        <aside className="shv-side">
          <span className="shv-kicker">{{ reel: 'Video', clip: 'Video', image: 'Image', design: 'Design' }[d.kind] || 'Preview'}</span>
          <h1>{d.title}</h1>
          {d.files.length > 1 && <nav className="shv-pick" aria-label={d.kind === 'design' ? 'Slides' : 'Sizes'}>{d.files.map((x) => <button key={x.n} type="button" className={x.n === f?.n ? 'on' : ''} aria-pressed={x.n === f?.n} onClick={() => setN(x.n)}>{x.label}</button>)}</nav>}
          {d.download && f && <div className="shv-dl">
            <a className="shv-btn" href={src(f.n, true)} download={f.name}>Download{d.files.length > 1 ? ` ${f.label}` : ''}</a>
            {d.files.length > 1 && <span className="shv-all">{d.files.filter((x) => x.n !== f.n).map((x) => <a key={x.n} href={src(x.n, true)} download={x.name}>{x.label}</a>)}</span>}
          </div>}
          <small className="shv-exp">This link works until {day(d.expiresAt)}.</small>
        </aside>
      </section>
    </main>
  );
}
