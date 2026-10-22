// The seller's school: the members area link, courses at a glance, the community (spaces, posting as the school,
// moderation), questions from lessons, students and the school's settings.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, fmtDate } from '../api';
import { Layout, Panel, Icon, Empty, Modal, toast, ago, confirmDialog, promptDialog, loadFailed } from '../ui';

const TABS = [['overview', 'Overview'], ['community', 'Community'], ['questions', 'Questions'], ['students', 'Students'], ['settings', 'Settings']];
const ACCESS = { open: 'Anyone who joins', buyers: 'Anyone who bought something', products: 'Buyers of chosen products' };
const copy = (t) => navigator.clipboard?.writeText(t).then(() => toast('Link copied'), () => promptDialog({ title: 'Copy the link', value: t, readOnly: true, confirm: 'Done', cancel: null }));

export default function School() {
  const [tab, setTab] = useState(() => new URLSearchParams(location.search).get('tab') || 'overview');
  const [d, setD] = useState(null);
  const load = () => api('/school').then(setD).catch(loadFailed);
  useEffect(() => { load(); }, []);
  const pick = (k) => { setTab(k); history.replaceState(null, '', `/school${k === 'overview' ? '' : `?tab=${k}`}`); };
  return (
    <Layout title="School" subtitle="Your members area: courses, community and students in one place"
      actions={d && <><button className="btn ghost" onClick={() => copy(d.url)}><Icon name="link" size={15} /> Copy link</button><a className="btn primary" href={d.url} target="_blank" rel="noreferrer"><Icon name="external" size={15} /> Open members area</a></>}>
      <div className="seg sc-tabs" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => pick(k)}>{l}</button>)}</div>
      {!d ? <div className="skeleton" /> : tab === 'overview' ? <Overview d={d} pick={pick} />
        : tab === 'community' ? <CommunityAdmin d={d} reload={load} />
          : tab === 'questions' ? <Questions />
            : tab === 'students' ? <Students />
              : <SettingsTab d={d} reload={load} />}
    </Layout>
  );
}

function Overview({ d, pick }) {
  const nav = useNavigate();
  const steps = [
    [d.courses.length > 0, 'Create a course', 'Add lessons with videos and notes — or let AI write the whole course.', () => nav('/products')],
    [d.spaces.length > 0, 'Open your community', 'Add spaces like General, Wins and Announcements.', () => pick('community')],
    [!!(d.settings.name || d.settings.logo), 'Brand your school', 'Name, logo, colour and a welcome message.', () => pick('settings')],
    [d.stats.students > 0, 'Invite your first students', 'Buyers get in with their email. Share the link in your emails and WhatsApp.', () => copy(d.url)],
  ];
  const left = steps.filter((s) => !s[0]).length;
  return (
    <>
      <div className="sc-stats">
        {[['Students', d.stats.students], ['Active this week', d.stats.active7], ['Community posts', d.stats.posts], ['Certificates', d.stats.certificates]].map(([l, n]) => <div key={l} className="stat"><small>{l}</small><b>{n.toLocaleString('en-IN')}</b></div>)}
      </div>
      {left > 0 && (
        <Panel title={`Get your school ready · ${steps.length - left}/${steps.length}`}>
          <div className="sc-steps">{steps.map(([done, t, text, go], i) => (
            <button key={i} className={`sc-step ${done ? 'done' : ''}`} onClick={go}><span className="sc-check">{done ? '✓' : i + 1}</span><div><b>{t}</b><small>{text}</small></div><Icon name="chevron" size={16} /></button>
          ))}</div>
        </Panel>
      )}
      <Panel title="Courses" actions={<Link className="btn ghost sm" to="/products"><Icon name="plus" size={14} /> New course</Link>} pad={!d.courses.length}>
        {!d.courses.length ? <Empty icon="box" title="No courses yet" text="A course is a product with lessons. Create a product, then add lessons — or press “Write course with AI” inside it." />
          : <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Course</th><th className="r">Lessons</th><th className="r">Quizzes</th><th>Certificate</th><th className="r">Students</th><th /></tr></thead>
            <tbody>{d.courses.map((c) => <tr key={c.id}><td><b>{c.name}</b></td><td className="r">{c.lessons}</td><td className="r">{c.quizzes}</td><td>{c.certificate ? <span className="pill ok">On</span> : <span className="pill">Off</span>}</td><td className="r">{c.students}</td><td className="r"><Link className="btn ghost sm" to={`/products/${c.id}`}>Edit</Link></td></tr>)}</tbody>
          </table></div>}
      </Panel>
      <Panel title="Your members area">
        <div className="sc-links">{[d.url, ...(d.domainUrls || [])].map((u) => <div key={u} className="sc-link"><code>{u.replace(/^https?:\/\//, '')}</code><button className="btn ghost sm" onClick={() => copy(u)}><Icon name="copy" size={14} /> Copy</button><a className="btn ghost sm" href={u} target="_blank" rel="noreferrer" aria-label="Open"><Icon name="external" size={14} /></a></div>)}</div>
        {!(d.domainUrls || []).length && <p className="hint">Connect your own domain in Settings → Domains and your members area opens there too.</p>}
      </Panel>
      <Panel title="How students get in">
        <ul className="sc-how">
          <li><b>Buyers</b> of any product sign in at your link with their email — we email them a 6-digit code. No passwords.</li>
          <li><b>The library link</b> in their purchase email opens the members area directly.</li>
          <li>{d.settings.openJoin ? <><b>Anyone can join free</b> (open school) — great for a free community that sells your courses.</> : <>Only buyers can sign in. Turn on <b>open sign-up</b> in Settings for a free community.</>}</li>
          <li>Each student can be signed in on up to <b>{d.settings.deviceLimit}</b> devices — it stops one login being shared in a group.</li>
        </ul>
      </Panel>
    </>
  );
}

// ---------- community ----------
function SpaceModal({ space, courses, onClose, onSaved }) {
  const [v, setV] = useState(() => ({ name: '', emoji: '💬', description: '', access: 'buyers', productIds: [], postBy: 'members', ...space }));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await api(space?.id ? `/school/spaces/${space.id}` : '/school/spaces', space?.id ? 'PUT' : 'POST', v); toast(space?.id ? 'Space saved' : 'Space created'); onSaved(); onClose(); } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const [products, setProducts] = useState([]);
  useEffect(() => { api('/products').then((d) => setProducts(d.products || d)).catch(() => {}); }, []);
  return (
    <Modal title={space?.id ? 'Edit space' : 'New space'} onClose={onClose} width={520}>
      <div className="form2">
        <label className="fld" style={{ maxWidth: 90 }}><span>Emoji</span><input value={v.emoji} maxLength={4} onChange={(e) => setV({ ...v, emoji: e.target.value })} /></label>
        <label className="fld"><span>Name</span><input autoFocus value={v.name} maxLength={60} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Wins, Q&A, Announcements" /></label>
        <label className="fld full"><span>Description</span><input value={v.description} maxLength={300} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder="What this space is for" /></label>
        <label className="fld full"><span>Who can see it</span><select value={v.access} onChange={(e) => setV({ ...v, access: e.target.value })}>{Object.entries(ACCESS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        {v.access === 'products' && <div className="fld full"><span>Buyers of</span>{products.length ? <div className="chips">{products.map((p) => { const on = v.productIds.includes(p.id); return <button key={p.id} type="button" className={on ? 'on' : ''} onClick={() => setV({ ...v, productIds: on ? v.productIds.filter((x) => x !== p.id) : [...v.productIds, p.id] })}>{on ? '✓ ' : ''}{p.name}</button>; })}</div> : <small className="muted">Create a product first.</small>}<small className="hint">A paid inner circle: only people who bought one of these see this space.</small></div>}
        <label className="fld full"><span>Unlocks at level</span><select value={v.minLevel || 1} onChange={(e) => setV({ ...v, minLevel: Number(e.target.value) })}><option value={1}>Open from the start</option>{[2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>Level {n}</option>)}</select><small className="hint">An “inner circle” members reach by being helpful — they see it locked until then.</small></label>
        <label className="fld full"><span>Who can post</span><select value={v.postBy} onChange={(e) => setV({ ...v, postBy: e.target.value })}><option value="members">Everyone who can see it</option><option value="admins">Only you and your team (announcements) — members can comment</option></select></label>
      </div>
      <div className="row end"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save} disabled={busy || !v.name.trim()}>{busy ? <span className="spin" /> : space?.id ? 'Save' : 'Create space'}</button></div>
    </Modal>
  );
}
const STARTER = [['👋', 'General', 'Say hello, share what you’re working on', 'open', 'members'], ['🏆', 'Wins', 'Celebrate progress — big or small', 'buyers', 'members'], ['📣', 'Announcements', 'News, live classes and updates from the team', 'buyers', 'admins']];
function CommunityAdmin({ d, reload }) {
  const [sid, setSid] = useState(d.spaces[0]?.id || null);
  const [edit, setEdit] = useState(null);
  const [posts, setPosts] = useState(null);
  const [draft, setDraft] = useState({ title: '', body: '', pinned: false });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);
  const space = d.spaces.find((s) => s.id === sid);
  const load = () => sid && api(`/school/spaces/${sid}/posts`).then(setPosts).catch((e) => toast(e.message));
  useEffect(() => { setPosts(null); load(); }, [sid]);
  useEffect(() => { if (!sid && d.spaces[0]) setSid(d.spaces[0].id); }, [d.spaces.length]);
  const starter = async () => { for (const [emoji, name, description, access, postBy] of STARTER) await api('/school/spaces', 'POST', { emoji, name, description, access, postBy }).catch(() => {}); toast('Three spaces created'); reload(); };
  const post = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await api(`/school/spaces/${sid}/posts`, 'POST', draft); setDraft({ title: '', body: '', pinned: false }); toast('Posted'); load(); reload(); } catch (x) { toast(x.message); }
    setBusy(false);
  };
  const act = async (p, body, msg) => { try { await api(`/school/posts/${p.id}`, 'PUT', body); toast(msg); load(); } catch (e) { toast(e.message); } };
  const del = async (p) => { if (!await confirmDialog({ title: 'Delete this post?', text: 'Its comments and likes go too.', confirm: 'Delete', danger: true })) return; await api(`/school/posts/${p.id}`, 'DELETE').catch((e) => toast(e.message)); load(); reload(); };
  const delSpace = async () => { if (!await confirmDialog({ title: `Delete “${space.name}”?`, text: 'Every post in it is deleted too. This can’t be undone.', confirm: 'Delete space', danger: true })) return; await api(`/school/spaces/${sid}`, 'DELETE'); setSid(null); reload(); };
  if (!d.spaces.length) return (
    <Empty icon="users" title="Start your community" text="Spaces are channels inside your members area. Start with three, or make your own.">
      <div className="row"><button className="btn primary" onClick={starter}>Create General, Wins & Announcements</button><button className="btn ghost" onClick={() => setEdit({})}>Make my own</button></div>
      {edit && <SpaceModal space={edit} onClose={() => setEdit(null)} onSaved={reload} />}
    </Empty>
  );
  return (
    <div className="sc-comm">
      <aside className="sc-spaces">
        {d.spaces.map((s) => <button key={s.id} className={s.id === sid ? 'on' : ''} onClick={() => setSid(s.id)}><span>{s.emoji}</span><b>{s.name}</b><small>{s.minLevel > 1 ? `🔒 L${s.minLevel} · ` : ''}{s.posts}</small></button>)}
        <button className="sc-add" onClick={() => setEdit({})}><Icon name="plus" size={14} /> New space</button>
      </aside>
      <section>
        {space && <div className="sc-space-h"><div><h3>{space.emoji} {space.name}</h3><small className="muted">{ACCESS[space.access]} · {space.postBy === 'admins' ? 'only the team posts' : 'members can post'}</small></div><span className="row"><button className="btn ghost sm" onClick={() => setEdit(space)}><Icon name="edit" size={14} /> Edit</button><button className="btn ghost sm danger" onClick={delSpace}><Icon name="trash" size={14} /></button></span></div>}
        <form className="sc-compose" onSubmit={post}>
          <input value={draft.title} maxLength={200} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Title (optional)" />
          <textarea rows={3} value={draft.body} maxLength={10000} onChange={(e) => setDraft({ ...draft, body: e.target.value })} placeholder="Post as your school — a welcome, a weekly challenge, a live-class link…" />
          <div className="row"><label className="tog" style={{ margin: 0 }}><input type="checkbox" checked={draft.pinned} onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })} /><span /> Pin to the top</label><button className="btn primary" disabled={busy || (!draft.title.trim() && !draft.body.trim())}>{busy ? <span className="spin" /> : 'Post'}</button></div>
        </form>
        {!posts ? <div className="skeleton" /> : !posts.length ? <p className="muted">No posts in this space yet.</p> : (
          <div className="sc-posts">{posts.map((p) => (
            <article key={p.id} className={`sc-post ${p.hidden ? 'hidden' : ''} ${p.pinned ? 'pinned' : ''}`}>
              <header><b>{p.author.name}{p.author.badge && <em className="pill info">{p.author.badge}</em>}</b><small className="muted">{ago(p.at)}{p.pinned && ' · 📌 pinned'}{p.hidden && ' · hidden'}</small></header>
              {p.title && <h4>{p.title}</h4>}
              {p.body && <p>{p.body.length > 400 ? `${p.body.slice(0, 400)}…` : p.body}</p>}
              <footer><span className="muted">👍 {p.likes} · 💬 {p.comments}</span><span className="row">
                <button className="btn ghost sm" onClick={() => setOpen(p.id)}>Comments</button>
                <button className="btn ghost sm" onClick={() => act(p, { pinned: !p.pinned }, p.pinned ? 'Unpinned' : 'Pinned')}>{p.pinned ? 'Unpin' : 'Pin'}</button>
                <button className="btn ghost sm" onClick={() => act(p, { hidden: !p.hidden }, p.hidden ? 'Shown again' : 'Hidden from students')}>{p.hidden ? 'Show' : 'Hide'}</button>
                <button className="btn ghost sm danger" aria-label="Delete post" onClick={() => del(p)}><Icon name="trash" size={14} /></button>
              </span></footer>
            </article>
          ))}</div>
        )}
      </section>
      {edit && <SpaceModal space={edit} onClose={() => setEdit(null)} onSaved={reload} />}
      {open && <PostModal id={open} onClose={() => { setOpen(null); load(); }} />}
    </div>
  );
}
function PostModal({ id, onClose }) {
  const [d, setD] = useState(null);
  const [text, setText] = useState('');
  const load = () => api(`/school/posts/${id}`).then(setD).catch((e) => toast(e.message));
  useEffect(() => { load(); }, [id]);
  const reply = async (e) => { e.preventDefault(); try { await api(`/school/posts/${id}/comments`, 'POST', { body: text }); setText(''); load(); } catch (x) { toast(x.message); } };
  const del = async (c) => { if (!await confirmDialog({ title: 'Delete this comment?', confirm: 'Delete', danger: true })) return; await api(`/school/comments/${c.id}`, 'DELETE'); load(); };
  return (
    <Modal title={d?.post.title || 'Post'} onClose={onClose} width={620}>
      {!d ? <div className="skeleton" /> : <>
        <p className="sc-pbody">{d.post.body}</p>
        <h4 className="sc-h4">{d.comments.length} comment{d.comments.length === 1 ? '' : 's'}</h4>
        <div className="sc-cmts">{d.comments.map((c) => <div key={c.id} className={`sc-cmt ${c.parentId ? 'child' : ''}`}><div><b>{c.author.name}</b> <small className="muted">{ago(c.at)}</small><p>{c.body}</p></div><button className="icon-btn xs danger" aria-label="Delete comment" onClick={() => del(c)}><Icon name="x" size={12} /></button></div>)}</div>
        <form className="sc-compose" onSubmit={reply}><textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply as your school…" maxLength={3000} /><div className="row end"><button className="btn primary" disabled={!text.trim()}>Reply</button></div></form>
      </>}
    </Modal>
  );
}

// ---------- questions from lessons ----------
function Questions() {
  const [list, setList] = useState(null);
  const [answer, setAnswer] = useState({});
  const [show, setShow] = useState('open');
  const load = () => api('/school/questions').then(setList).catch(loadFailed);
  useEffect(() => { load(); }, []);
  const send = async (q) => { try { await api(`/school/questions/${q.id}/answer`, 'POST', { body: answer[q.id] }); setAnswer({ ...answer, [q.id]: '' }); toast('Answered — the student is notified'); load(); } catch (e) { toast(e.message); } };
  if (!list) return <div className="skeleton" />;
  const shown = list.filter((q) => !q.parentId && (show === 'all' || !q.answered));
  return (
    <>
      <div className="seg sm" style={{ marginBottom: 12 }}>{[['open', `Unanswered (${list.filter((q) => !q.parentId && !q.answered).length})`], ['all', 'All']].map(([k, l]) => <button key={k} className={show === k ? 'on' : ''} onClick={() => setShow(k)}>{l}</button>)}</div>
      {!shown.length ? <Empty icon="check" title={show === 'open' ? 'All caught up' : 'No questions yet'} text="Students ask questions under each lesson. They show up here for you to answer." />
        : <div className="sc-qs">{shown.map((q) => (
          <Panel key={q.id} title={<span><b>{q.author.name}</b> <small className="muted">on “{q.lesson}” · {q.course} · {ago(q.at)}</small></span>}>
            <p className="sc-pbody">{q.body}</p>
            {q.answered ? <span className="pill ok">Answered</span> : (
              <div className="sc-compose"><textarea rows={2} value={answer[q.id] || ''} onChange={(e) => setAnswer({ ...answer, [q.id]: e.target.value })} placeholder="Your answer…" maxLength={3000} /><div className="row end"><button className="btn primary sm" disabled={!answer[q.id]?.trim()} onClick={() => send(q)}>Answer</button></div></div>
            )}
          </Panel>
        ))}</div>}
    </>
  );
}

// ---------- students ----------
function Students() {
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const load = () => api('/school/students').then(setList).catch(loadFailed);
  useEffect(() => { load(); }, []);
  const set = async (s, body, msg) => { if (body.banned && !await confirmDialog({ title: `Remove ${s.name || s.email}?`, text: 'They’re signed out everywhere and can’t sign in to your school again until you restore them. Their purchases aren’t refunded.', confirm: 'Remove', danger: true })) return; try { await api(`/school/students/${s.id}`, 'PUT', body); toast(msg); load(); } catch (e) { toast(e.message); } };
  if (!list) return <div className="skeleton" />;
  if (!list.length) return <Empty icon="users" title="No students yet" text="Students appear here the first time they sign in to your members area." />;
  const shown = list.filter((s) => !q || `${s.name} ${s.email}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Panel title={`${list.length} student${list.length === 1 ? '' : 's'}`} actions={<input className="sc-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" />} pad={false}>
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>Student</th><th>Courses</th><th className="r">Level</th><th>Last seen</th><th className="r">Devices</th><th /></tr></thead>
        <tbody>{shown.map((s) => (
          <tr key={s.id} className={s.banned ? 'muted' : ''}>
            <td><b>{s.name || '—'}</b><small className="sub-t">{s.email}</small></td>
            <td>{s.courses.length ? s.courses.map((c) => <div key={c.id} className="sc-prog"><span>{c.name}</span><div className="bar"><i style={{ width: `${(c.done / c.lessons) * 100}%` }} /></div><small>{c.done}/{c.lessons}</small></div>) : <small className="muted">Community only</small>}</td>
            <td className="r">{s.level}<small className="sub-t">{s.points} pts</small></td>
            <td>{s.lastSeenAt ? ago(s.lastSeenAt) : '—'}<small className="sub-t">joined {fmtDate(s.at)}</small></td>
            <td className="r">{s.devices}</td>
            <td className="r nowrap">{s.banned ? <button className="btn ghost sm" onClick={() => set(s, { banned: false }, 'Restored')}>Restore</button> : <>
              {s.devices > 0 && <button className="btn ghost sm" title="Sign out of every device" onClick={() => set(s, { signOut: true }, 'Signed out everywhere')}>Sign out</button>}
              <button className="btn ghost sm danger" onClick={() => set(s, { banned: true }, 'Removed')}>Remove</button></>}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </Panel>
  );
}

// ---------- settings ----------
// an image for the school (logo, cover): upload it, or paste a link
function ImagePick({ label, value, onChange, hint }) {
  const [busy, setBusy] = useState(false);
  const pick = async (file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast('Images must be 5 MB or smaller');
    setBusy(true);
    try {
      const data = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(file); });
      onChange((await api('/uploads', 'POST', { type: file.type, data })).url);
    } catch (e) { toast(e.message || 'Upload failed'); }
    setBusy(false);
  };
  return (
    <div className="fld sc-img"><span>{label}</span>
      <div className="sc-img-row">
        {value ? <img src={value} alt="" /> : <i className="sc-img-empty"><Icon name="palette" size={16} /></i>}
        <label className="btn ghost sm">{busy ? <span className="spin dark" /> : <Icon name="download" size={14} className="flip" />} {value ? 'Replace' : 'Upload'}<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => pick(e.target.files[0])} /></label>
        {value && <button type="button" className="btn ghost sm" onClick={() => onChange('')}>Remove</button>}
      </div>
      {hint && <small className="hint">{hint}</small>}
    </div>
  );
}
function SettingsTab({ d, reload }) {
  const [v, setV] = useState(d.settings);
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { await api('/school/settings', 'PUT', v); toast('School saved'); reload(); } catch (e) { toast(e.message); } setBusy(false); };
  return (
    <>
      <Panel title="Look">
        <div className="form2">
          <label className="fld"><span>School name</span><input value={v.name} maxLength={80} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Your business name" /></label>
          <label className="fld"><span>Brand colour</span><span className="sc-color"><input type="color" value={v.color || '#6366f1'} onChange={(e) => setV({ ...v, color: e.target.value })} /><code>{v.color || '#6366f1'}</code></span></label>
          <label className="fld full"><span>Tagline</span><input value={v.tagline} maxLength={200} onChange={(e) => setV({ ...v, tagline: e.target.value })} placeholder="One line on the sign-in page" /></label>
          <ImagePick label="Logo" value={v.logo} onChange={(logo) => setV({ ...v, logo })} hint="Square works best · shown in the top bar" />
          <ImagePick label="Cover image" value={v.cover} onChange={(cover) => setV({ ...v, cover })} hint="Wide image on the sign-in page" />
          <label className="fld full"><span>Welcome message</span><textarea rows={3} maxLength={2000} value={v.welcome} onChange={(e) => setV({ ...v, welcome: e.target.value })} placeholder="Shown on every student’s home page — e.g. how to get the most out of the course" /></label>
        </div>
      </Panel>
      <Panel title="Access">
        <label className="tog sc-tog"><input type="checkbox" checked={!!v.openJoin} onChange={(e) => setV({ ...v, openJoin: e.target.checked })} /><span /><div><b>Open sign-up</b> — anyone can join free with their email (they see “open” spaces; paid spaces and courses stay locked)</div></label>
        <label className="tog sc-tog"><input type="checkbox" checked={!!v.tutor} disabled={!d.aiEnabled} onChange={(e) => setV({ ...v, tutor: e.target.checked })} /><span /><div><b>AI tutor</b> — students ask questions and get answers from your lessons (1 AI credit each, up to 30 a day per student){!d.aiEnabled && ' · needs AI on this server'}</div></label>
        <label className="fld" style={{ maxWidth: 260, marginTop: 10 }}><span>Devices per student</span><select value={v.deviceLimit} onChange={(e) => setV({ ...v, deviceLimit: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select><small className="hint">Signing in on one more device signs out the oldest — stops a login being shared.</small></label>
      </Panel>
      <Panel title="Levels">
        <p className="hint">Students earn points for likes on their posts and comments, finished lessons (1), passed quizzes (2) and finished courses (10). Name the 9 levels your way.</p>
        <div className="sc-levels">{v.levels.map((n, i) => <label key={i} className="fld"><span>Level {i + 1}</span><input value={n} maxLength={30} onChange={(e) => setV({ ...v, levels: v.levels.map((x, k) => (k === i ? e.target.value : x)) })} /></label>)}</div>
      </Panel>
      <div className="row end"><button className="btn primary" onClick={save} disabled={busy}>{busy ? <span className="spin" /> : 'Save'}</button></div>
    </>
  );
}
