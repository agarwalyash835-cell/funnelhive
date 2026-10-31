// Settings → Business & legal → Data requests: buyers' DPDP requests (server data-requests.js). Each one was confirmed
// from the person's email and has a 30-day deadline. The seller downloads the person's data, erases it, or answers,
// then closes the request with a note the person gets by email.
import { useEffect, useState } from 'react';
import { api, fmtDate } from '../api';
import { Panel, Icon, Modal, toast, confirmDialog } from '../ui';

// the person's data as a JSON file (the same export as the contact panel's download button)
async function download(key) {
  const r = await fetch(`/api/contacts/${encodeURIComponent(key)}/export`, { headers: { Authorization: `Bearer ${localStorage.getItem('ff_token')}` } });
  if (!r.ok) return toast((await r.json().catch(() => ({}))).error || 'Download failed');
  const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = `data-${key.replace(/[^a-z0-9@._+-]/gi, '_').slice(0, 80)}.json`; a.click();
}
const STATUS = { open: ['Open', 'warn'], done: ['Done', 'ok'], declined: ['Declined', ''] };

export function DataRequests({ pages }) {
  const [d, setD] = useState(null);
  const [close, setClose] = useState(null); // { r, status, reply }
  const load = () => api('/privacy/requests').then(setD).catch(() => setD(false));
  useEffect(() => { load(); }, []);
  if (d === false) return null;
  const erase = async (r) => {
    if (!(await confirmDialog({ title: `Erase ${r.email}’s data?`, text: 'Their contact, messages, sign-ups, bookings and files are deleted. Orders and invoices stay for tax records, with their name and details removed. This can’t be undone.', confirm: 'Erase', danger: true }))) return;
    try { await api(`/privacy/requests/${r.id}/erase`, 'POST'); toast('Their data is erased — now close the request'); load(); } catch (e) { toast(e.message); }
  };
  const finish = async () => {
    try { await api(`/privacy/requests/${close.r.id}`, 'PUT', { status: close.status, reply: close.reply }); toast(`Closed — ${close.r.email} has been emailed`); setClose(null); load(); } catch (e) { toast(e.message); }
  };
  const left = (r) => { const days = Math.ceil((r.dueAt - Date.now()) / 86400000); return days < 0 ? <span className="pill bad">{-days} day{days === -1 ? '' : 's'} overdue</span> : <small className="muted">reply within {days} day{days === 1 ? '' : 's'}</small>; };
  return (
    <Panel pad={false} title="Data requests" actions={pages && <a className="btn ghost sm" href={`${pages}/data-request`} target="_blank" rel="noreferrer"><Icon name="external" size={13} /> Request form</a>}>
      {!d ? <div className="skeleton" /> : !d.requests.length ? (
        <p className="muted sm" style={{ padding: 16 }}>When a buyer asks to see, correct or erase their data, or withdraws consent, from the form on your Privacy Policy, it shows up here. You have 30 days to reply.</p>
      ) : (
        <div className="tbl-wrap"><table className="tbl compact">
          <thead><tr><th>Person</th><th>Request</th><th>Status</th><th /></tr></thead>
          <tbody>{d.requests.map((r) => (
            <tr key={r.id}>
              <td><b>{r.name || r.email}</b><small className="sub-t">{r.name ? r.email : ''}{r.phone ? ` · ${r.phone}` : ''} · {fmtDate(r.confirmedAt)}</small>{r.note && <small className="sub-t">“{r.note}”</small>}</td>
              <td>{r.kindLabel}{r.kind === 'withdraw' && <small className="sub-t">Done automatically: no more marketing email or WhatsApp</small>}{r.erased && <small className="sub-t">Data erased</small>}</td>
              <td><span className={`pill ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span>{r.status === 'open' && <div>{left(r)}</div>}{r.reply && r.status !== 'open' && <small className="sub-t">{r.reply}</small>}</td>
              <td className="r">{r.status === 'open' && <div className="row end">
                {['access', 'correct'].includes(r.kind) && <a className="btn ghost sm" href={`/contacts/${encodeURIComponent(r.contactKey)}`}>Open contact</a>}
                {r.kind === 'access' && <button className="btn ghost sm" title="Their data as a file to send them" onClick={() => download(r.contactKey)}>Download data</button>}
                {r.kind === 'erase' && !r.erased && <button className="btn danger sm" onClick={() => erase(r)}>Erase data</button>}
                <button className="btn primary sm" disabled={r.kind === 'erase' && !r.erased} onClick={() => setClose({ r, status: 'done', reply: '' })}>Close</button>
              </div>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {close && (
        <Modal title={`Close ${close.r.email}’s request`} onClose={() => setClose(null)} width={520}>
          <div className="m-body">
            <div className="seg sm"><button className={close.status === 'done' ? 'on' : ''} onClick={() => setClose({ ...close, status: 'done' })}>Done</button><button className={close.status === 'declined' ? 'on' : ''} onClick={() => setClose({ ...close, status: 'declined' })}>Decline</button></div>
            <label>Note to {close.r.email} {close.status === 'declined' ? <small className="muted">· required: why you can’t do it</small> : <small className="muted">· optional</small>}<textarea rows={4} maxLength={2000} value={close.reply} onChange={(e) => setClose({ ...close, reply: e.target.value })} placeholder={close.r.kind === 'access' ? 'Your data is attached / here is what we hold…' : close.r.kind === 'correct' ? 'We’ve updated your phone number…' : ''} /></label>
            <p className="hint">They get this by email. Keep a copy of anything you sent them separately (for example their data file).</p>
            <div className="m-foot"><button className="btn ghost" onClick={() => setClose(null)}>Cancel</button><button className="btn primary" disabled={close.status === 'declined' && !close.reply.trim()} onClick={finish}>Close and email them</button></div>
          </div>
        </Modal>
      )}
    </Panel>
  );
}
