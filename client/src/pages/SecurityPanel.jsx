import { useState } from 'react';
import { api, setToken } from '../api';
import { Panel, Icon, toast } from '../ui';

export default function SecurityPanel({ me, onChange }) {
  const [pw, setPw] = useState({ current: '', password: '' });
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const changePw = async (e) => {
    e.preventDefault(); setErr('');
    try { const r = await api('/auth/change-password', 'POST', pw); setToken(r.token); setPw({ current: '', password: '' }); toast('Password changed — other devices were signed out'); } catch (x) { setErr(x.message); }
  };
  const start2fa = async () => { setErr(''); setSetup(await api('/auth/2fa/setup', 'POST')); };
  const enable = async () => { setErr(''); try { await api('/auth/2fa/enable', 'POST', { code }); setSetup(null); setCode(''); toast('2-step verification is on'); onChange(); } catch (x) { setErr(x.message); } };
  const disable = async () => { setErr(''); try { await api('/auth/2fa/disable', 'POST', { code }); setCode(''); toast('2-step verification turned off'); onChange(); } catch (x) { setErr(x.message); } };

  return (
    <Panel title="Security" actions={<span className={`pill ${me?.twoFactor ? 'ok' : 'warn'}`}>{me?.twoFactor ? '2-step on' : '2-step off'}</span>}>
      <form className="form2" onSubmit={changePw}>
        <label>Current password<input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></label>
        <label>New password<input type="password" minLength={6} autoComplete="new-password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} /></label>
        <button className="btn ghost" disabled={!pw.current || pw.password.length < 6}>Change password</button>
      </form>
      <div className="tfa">
        <b>2-step verification</b>
        <p className="muted sm">Protect your account with a code from Google Authenticator, Authy or Microsoft Authenticator.</p>
        {me?.twoFactor ? (
          <div className="row"><input className="code-in" inputMode="numeric" placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} /><button className="btn ghost danger" onClick={disable} disabled={code.length < 6}>Turn off</button></div>
        ) : setup ? (
          <div className="tfa-setup">
            <ol>
              <li>Open your authenticator app and choose <b>Enter a setup key</b>.</li>
              <li>Account: <code>{me?.email}</code> · Key: <code className="key">{setup.secret.match(/.{1,4}/g).join(' ')}</code> <button className="icon-btn xs" title="Copy key" onClick={() => { navigator.clipboard?.writeText(setup.secret); toast('Key copied'); }}><Icon name="copy" size={12} /></button></li>
              <li>Enter the 6-digit code it shows:</li>
            </ol>
            <div className="row"><input className="code-in" inputMode="numeric" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} /><button className="btn primary" onClick={enable} disabled={code.length < 6}>Turn on</button></div>
          </div>
        ) : <button className="btn ghost" onClick={start2fa}><Icon name="check" size={15} /> Set up 2-step verification</button>}
      </div>
      {err && <div className="err">{err}</div>}
    </Panel>
  );
}
