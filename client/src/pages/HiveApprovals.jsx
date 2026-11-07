// Hive's approvals inbox (every action waiting for the seller's OK, across all chats) and the AI activity log
// (what Hive and the teammates ran, and what the seller confirmed or declined). Server: /api/hive/approvals,
// /api/hive/activity; Approve / Decline go through the chat's own confirm route.
import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { api } from '../api';
import { Modal, toast, ago } from '../ui';

const RISK = { read: ['', 'Looks only'], write: ['warn', 'Changes your account'], external: ['bad', 'Reaches customers or other apps'] };
const Risk = ({ risk }) => { const [c, tip] = RISK[risk] || RISK.write; return <span className={`pill ${c} hv-risk`} title={tip}>{risk}</span>; };
const Who = ({ m }) => (m ? <span className="hv-mate-tag" style={{ '--mc': m.color }}>{m.emoji} {m.name}</span> : <span className="hv-mate-tag">Hive</span>);

// "Waiting for your OK": Approve / Decline each; onDecided(threadId) lets the page refresh an open chat
export function ApprovalsDialog({ onClose, onDecided, onOpen }) {
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(null);
  const load = () => api('/hive/approvals').then(setItems).catch((e) => { toast(e.message); setItems([]); });
  useEffect(() => { load(); }, []);
  const decide = async (x, ok) => {
    setBusy(x.id);
    try {
      const r = await api(`/hive/threads/${x.threadId}/confirm`, 'POST', { pendingId: x.id, ok });
      toast(r.cancelled ? 'Declined' : r.ok ? 'Done' : r.summary);
      onDecided?.(x.threadId);
    } catch (e) { toast(e.message); }
    setItems((l) => l.filter((y) => y.id !== x.id));
    setBusy(null);
  };
  return (
    <Modal title={`Waiting for your OK${items?.length ? ` (${items.length})` : ''}`} onClose={onClose} width={680}>
      <div className="m-body">
        {!items ? <div className="skeleton" /> : !items.length ? <p className="muted">Nothing is waiting. When Hive or a teammate wants to send, publish or change something, it shows here.</p> : (
          <ul className="hv-ap">{items.map((x) => (
            <li key={x.id}>
              <div className="hv-ap-t">
                <span><Who m={x.teammate} /><Risk risk={x.risk} /> <small className="muted">{ago(x.at)}</small></span>
                <b>{x.label}</b>
                <button type="button" className="link-btn" onClick={() => { onOpen?.(x.threadId); onClose(); }}>{x.threadTitle || 'Open chat'}</button>
              </div>
              <span className="hv-ok">
                <button className="btn sm primary" disabled={busy === x.id} onClick={() => decide(x, true)}><Check size={13} /> Approve</button>
                <button className="btn sm" disabled={busy === x.id} onClick={() => decide(x, false)}><X size={13} /> Decline</button>
              </span>
            </li>
          ))}</ul>
        )}
      </div>
    </Modal>
  );
}

const BY = { hive: 'Hive', teammate: 'Teammate', schedule: 'Scheduled run', you: 'You' };
// the activity log: newest first, filterable by teammate
export function ActivityDialog({ team, onClose }) {
  const [mate, setMate] = useState('');
  const [rows, setRows] = useState(null);
  useEffect(() => { setRows(null); api(`/hive/activity?limit=200${mate ? `&teammate=${encodeURIComponent(mate)}` : ''}`).then(setRows).catch((e) => { toast(e.message); setRows([]); }); }, [mate]);
  return (
    <Modal title="AI activity" onClose={onClose} width={760}>
      <div className="m-body">
        <div className="hv-act-h">
          <p className="muted sm">Everything Hive and your teammates ran, and what you approved or declined. Kept for 90 days.</p>
          {team.length > 0 && <select value={mate} onChange={(e) => setMate(e.target.value)} aria-label="Teammate"><option value="">Everyone</option>{team.map((m) => <option key={m.id} value={m.id}>{m.emoji} {m.name}</option>)}</select>}
        </div>
        {!rows ? <div className="skeleton" /> : !rows.length ? <p className="muted">Nothing yet.</p> : (
          <div className="tbl-wrap"><table className="tbl compact hv-log">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th /></tr></thead>
            <tbody>{rows.map((a) => (
              <tr key={a.id}>
                <td title={new Date(a.at).toLocaleString()}>{ago(a.at)}</td>
                <td>{a.by === 'you' ? 'You' : a.teammate ? `${a.teammate.emoji} ${a.teammate.name}` : BY[a.by] || 'Hive'}{a.by === 'schedule' && <small className="muted"> · scheduled</small>}</td>
                <td>{a.summary || a.tool.replace(/_/g, ' ')} <Risk risk={a.risk} /></td>
                <td>{a.declined ? <span className="pill">declined</span> : a.ok ? <span className="pill ok">ok</span> : <span className="pill bad">failed</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </Modal>
  );
}
