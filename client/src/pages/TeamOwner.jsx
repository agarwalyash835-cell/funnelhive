// Settings → Team → "Make owner": hand the account to a team member (server team.js). The account and its data stay;
// the logins swap, the old owner stays on the team as an Admin, and everyone is signed out.
import { useState } from 'react';
import { api, setToken } from '../api';
import { Modal, toast } from '../ui';

export function Owner({ m, needCode, onClose }) {
  const [v, setV] = useState({ password: '', code: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const r = await api('/team/transfer', 'POST', { memberId: m.id, password: v.password, code: v.code || undefined, confirm: v.confirm.trim().toUpperCase() });
      if (r.twoFactorRequired) { toast('Enter the 6-digit code from your authenticator app'); setBusy(false); return; }
      toast('Done — sign in again with your own email to work on the team');
      setToken(null);
      location.href = '/login?mode=login';
      return;
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  return (
    <Modal title={`Make ${m.name || m.email} the owner?`} onClose={onClose} width={520}>
      <div className="m-body">
        <ul className="muted sm">
          <li><b>{m.email}</b> becomes the owner: this account, its plan and billing are theirs. They sign in with their usual email and password.</li>
          <li>You stay on the team as an <b>Admin</b> and sign in with your usual email and password.</li>
          <li>Everyone is signed out once. You can’t undo this yourself — only the new owner can hand it back.</li>
        </ul>
        <label>Your password<input type="password" autoComplete="current-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} /></label>
        {needCode && <label>2-step code<input inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} /></label>}
        <label>Type <b>TRANSFER</b> to confirm<input value={v.confirm} onChange={(e) => setV({ ...v, confirm: e.target.value })} /></label>
        <div className="m-foot"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn danger" disabled={busy || !v.password || v.confirm.trim().toUpperCase() !== 'TRANSFER' || (needCode && v.code.length < 6)} onClick={go}>{busy ? 'Handing over…' : 'Make them the owner'}</button></div>
      </div>
    </Modal>
  );
}
