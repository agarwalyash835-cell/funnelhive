// "Share with client" (server studio/share.js): a temporary link to a finished Reel, image, clip or design that
// anyone can open without an account — to watch it and, if allowed, download it. Links expire (1, 3, 7 or 30 days)
// and can be switched off at any time. The link itself is shown only once, when it's made.
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Modal, Icon, toast, confirmDialog } from '../../ui';

const DAYS = [[1, '1 day'], [3, '3 days'], [7, '7 days'], [30, '30 days']];
const when = (t) => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export function ShareLinks({ id, title, onClose }) {
  const [list, setList] = useState(null);
  const [days, setDays] = useState(7);
  const [download, setDownload] = useState(true);
  const [made, setMade] = useState(null); // { url, share } — just created
  const [busy, setBusy] = useState(false);
  const load = () => api(`/studio/assets/${id}/shares`).then((x) => setList(x.shares)).catch((e) => toast(e.message));
  useEffect(() => { load(); }, [id]);
  const create = async () => {
    setBusy(true);
    try { const r = await api(`/studio/assets/${id}/shares`, 'POST', { days, download }); setMade(r); copy(r.url); load(); } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const copy = (url) => { navigator.clipboard?.writeText(url).then(() => toast('Link copied'), () => {}); };
  const off = async (s) => {
    if (!(await confirmDialog({ title: 'Switch this link off?', text: 'Anyone who has it will see that the link is switched off. You can make a new one any time.', confirm: 'Switch off', danger: true }))) return;
    try { await api(`/studio/shares/${s.id}`, 'DELETE'); if (made?.share.id === s.id) setMade(null); load(); toast('Link switched off'); } catch (e) { toast(e.message); }
  };
  const wa = made ? `https://wa.me/?text=${encodeURIComponent(`${title ? `${title}: ` : ''}${made.url}`)}` : '';
  const live = (list || []).filter((s) => s.live), old = (list || []).filter((s) => !s.live);
  return (
    <Modal title="Share with your client" onClose={onClose} width={560}>
      <div className="sxsh">
        <p className="sx-hint">A private link to watch {download ? 'and download ' : ''}it — no account needed. It shows your brand kit’s name and logo, never ours, and the latest version if you edit it after sharing.</p>
        {made ? (
          <section className="sxsh-made" aria-label="Your new link">
            <b>Link ready · works until {when(made.share.expiresAt)}</b>
            <div className="row"><input readOnly value={made.url} onFocus={(e) => e.target.select()} aria-label="Client link" /><button type="button" className="btn primary sm" onClick={() => copy(made.url)}><Icon name="copy" size={13} /> Copy</button></div>
            <div className="row">
              <a className="btn ghost sm" href={wa} target="_blank" rel="noreferrer"><Icon name="send" size={13} /> Send on WhatsApp</a>
              <a className="btn ghost sm" href={made.url} target="_blank" rel="noreferrer"><Icon name="eye" size={13} /> Open as your client sees it</a>
              <button type="button" className="btn ghost sm" onClick={() => setMade(null)}>Make another</button>
            </div>
            <small className="muted">Copy it now — for safety the link can’t be shown again. You can always switch it off below.</small>
          </section>
        ) : (
          <section className="sxsh-new" aria-label="New link">
            <div className="sxsh-row"><span>Works for</span><div className="sx-modes" role="group" aria-label="How long the link works">{DAYS.map(([n, l]) => <button key={n} type="button" className={days === n ? 'on' : ''} aria-pressed={days === n} onClick={() => setDays(n)}>{l}</button>)}</div></div>
            <label className="sxi-toggle"><input type="checkbox" checked={download} onChange={(e) => setDownload(e.target.checked)} /><span><b>Allow download</b><small>Off: your client can watch it but not save the file</small></span></label>
            <button type="button" className="btn primary" disabled={busy} onClick={create}><Icon name="link" size={14} /> {busy ? 'Making…' : 'Make the link'}</button>
          </section>
        )}
        {live.length > 0 && <section className="sxsh-list" aria-label="Live links">
          <h4>Live links</h4>
          {live.map((s) => <div key={s.id} className="sxsh-item"><span className="grow"><b>Until {when(s.expiresAt)}</b><small>{s.download ? 'Watch and download' : 'Watch only'} · {s.views ? `opened ${s.views} time${s.views === 1 ? '' : 's'}, last ${when(s.lastViewAt)}` : 'not opened yet'}{s.by ? ` · by ${s.by}` : ''}</small></span><button type="button" className="btn ghost sm" onClick={() => off(s)}>Switch off</button></div>)}
        </section>}
        {old.length > 0 && <details className="sxsh-list"><summary>{old.length} expired or switched off</summary>{old.map((s) => <div key={s.id} className="sxsh-item muted"><span className="grow"><small>Made {when(s.at)} · {s.revokedAt ? `switched off ${when(s.revokedAt)}` : `expired ${when(s.expiresAt)}`} · opened {s.views || 0}×</small></span></div>)}</details>}
      </div>
    </Modal>
  );
}
export default ShareLinks;
