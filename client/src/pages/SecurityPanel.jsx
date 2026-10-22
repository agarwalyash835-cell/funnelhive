import { useEffect, useState } from 'react';
import { api, setToken } from '../api';
import { Panel, Icon, toast, ago } from '../ui';

// the setup as a QR code for Google Authenticator / Authy / Microsoft Authenticator (drawn in the browser — the key never leaves it)
function TfaQr({ url }) {
  const [src, setSrc] = useState('');
  useEffect(() => { let live = true; import('qrcode').then((m) => m.toDataURL(url, { margin: 1, width: 220, errorCorrectionLevel: 'M' })).then((d) => live && setSrc(d)).catch(() => {}); return () => { live = false; }; }, [url]);
  return src ? <img className="tfa-qr" src={src} width="180" height="180" alt="QR code to scan with your authenticator app" /> : <div className="tfa-qr skeleton" />;
}

export default function SecurityPanel({ me, onChange }) {
  const [pw, setPw] = useState({ current: '', password: '' });
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [sessions, setSessions] = useState(null);
  const loadSessions = () => api('/auth/sessions').then((r) => setSessions(r.sessions)).catch(() => setSessions([]));
  useEffect(() => { loadSessions(); if (location.hash === '#security') setTimeout(() => document.getElementById('security')?.scrollIntoView({ behavior: 'smooth' }), 300); }, []);
  const changePw = async (e) => {
    e.preventDefault(); setErr('');
    try { const r = await api('/auth/change-password', 'POST', pw); setToken(r.token); setPw({ current: '', password: '' }); toast('Password changed — other devices were signed out'); loadSessions(); } catch (x) { setErr(x.message); }
  };
  const start2fa = async () => { setErr(''); setSetup(await api('/auth/2fa/setup', 'POST')); };
  // turning 2-step on or off signs out every other device; this one gets a fresh token
  const enable = async () => { setErr(''); try { const r = await api('/auth/2fa/enable', 'POST', { code }); if (r.token) setToken(r.token); setSetup(null); setCode(''); toast('2-step verification is on — other devices were signed out'); onChange(); loadSessions(); } catch (x) { setErr(x.message); } };
  const disable = async () => { setErr(''); try { const r = await api('/auth/2fa/disable', 'POST', { code }); if (r.token) setToken(r.token); setCode(''); toast('2-step verification turned off — other devices were signed out'); onChange(); loadSessions(); } catch (x) { setErr(x.message); } };
  const revoke = async (s) => { try { await api(`/auth/sessions/${s.id}/revoke`, 'POST'); toast('Signed out that device'); loadSessions(); } catch (x) { toast(x.message); } };
  const revokeOthers = async () => { try { const r = await api('/auth/sessions/revoke-others', 'POST'); if (r.token) setToken(r.token); toast('Signed out everywhere else'); loadSessions(); } catch (x) { toast(x.message); } };

  return (
    <div id="security"><Panel title="Security" actions={<span className={`pill ${me?.twoFactor ? 'ok' : 'warn'}`}>{me?.twoFactor ? '2-step on' : '2-step off'}</span>}>
      <form className="form2" onSubmit={changePw}>
        <label>Current password<input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></label>
        <label>New password<input type="password" minLength={8} autoComplete="new-password" placeholder="At least 8 characters" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} /></label>
        <button className="btn ghost" disabled={!pw.current || pw.password.length < 8}>Change password</button>
      </form>
      <div className="tfa">
        <b>2-step verification</b>
        <p className="muted sm">Protect your account with a code from Google Authenticator, Authy or Microsoft Authenticator.</p>
        {me?.twoFactor ? (
          <div className="row"><input className="code-in" inputMode="numeric" placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} /><button className="btn ghost danger" onClick={disable} disabled={code.length < 6}>Turn off</button></div>
        ) : setup ? (
          <div className="tfa-setup">
            <div className="tfa-scan">
              {setup.otpauth && <TfaQr url={setup.otpauth} />}
              <div>
                <b>Scan this with your phone</b>
                <p className="muted sm">In Google Authenticator tap <b>+</b> → <b>Scan a QR code</b>. On this phone? Tap <a href={setup.otpauth}>add to my authenticator app</a>.</p>
              </div>
            </div>
            <details className="tfa-manual"><summary>Can’t scan? Type the key instead</summary>
              <p className="muted sm">Choose <b>Enter a setup key</b>, pick <b>Time based</b>. Account: <code>{me?.email}</code> · Key: <code className="key">{setup.secret.match(/.{1,4}/g).join(' ')}</code> <button className="icon-btn xs" title="Copy key" aria-label="Copy key" onClick={() => { navigator.clipboard?.writeText(setup.secret); toast('Key copied'); }}><Icon name="copy" size={12} /></button></p>
            </details>
            <p className="sm"><b>Then enter the 6-digit code your app shows</b> <span className="muted">(only from this latest QR code — earlier attempts won’t work)</span>:</p>
            <div className="row"><input className="code-in" inputMode="numeric" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} /><button className="btn primary" onClick={enable} disabled={code.length < 6}>Turn on</button></div>
          </div>
        ) : <button className="btn ghost" onClick={start2fa}><Icon name="check" size={15} /> Set up 2-step verification</button>}
      </div>
      <div className="tfa">
        <b>Where you’re signed in</b>
        <p className="muted sm">Devices that are signed in to your account. Sign out any you don’t recognise.</p>
        {sessions == null ? <div className="skeleton" /> : sessions.map((s) => (
          <div key={s.id} className="li">
            <span>{s.support ? 'Support access' : s.device}{s.ip ? <span className="muted sm"> · {s.ip}</span> : null}{s.current && <span className="pill ok" style={{ marginLeft: 6 }}>this device</span>}</span>
            <span className="row"><span className="muted sm">active {ago(s.lastSeenAt)}</span>{!s.current && <button className="btn ghost sm" onClick={() => revoke(s)}>Sign out</button>}</span>
          </div>
        ))}
        {sessions?.some((s) => !s.current) && <button className="btn ghost sm" onClick={revokeOthers}>Sign out everywhere else</button>}
      </div>
      {err && <div className="err">{err}</div>}
    </Panel></div>
  );
}
