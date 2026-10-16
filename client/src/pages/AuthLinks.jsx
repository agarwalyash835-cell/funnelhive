import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, setToken, loggedIn } from '../api';
import { AuthShell } from './Auth';

export function Verify() {
  const [qs] = useSearchParams();
  const [state, setState] = useState('working');
  const [err, setErr] = useState('');
  useEffect(() => {
    api('/auth/verify', 'POST', { token: qs.get('token') }).then((r) => setState(r.already ? 'already' : 'ok')).catch((e) => { setErr(e.message); setState('fail'); });
  }, []);
  return (
    <AuthShell>
      <form onSubmit={(e) => e.preventDefault()}>
        <h2>{state === 'ok' ? 'Email verified' : state === 'already' ? 'Already verified ✓' : state === 'fail' ? 'Link not valid' : 'Verifying…'}</h2>
        {state === 'ok' && <p className="muted">Thanks for confirming your email address.</p>}
        {state === 'already' && <p className="muted">Your email address is already confirmed — nothing more to do.</p>}
        {state === 'fail' && <div className="err">{err}</div>}
        <Link className="btn primary lg block" to={loggedIn() ? '/' : '/login'}>{loggedIn() ? 'Go to dashboard' : 'Log in'}</Link>
      </form>
    </AuthShell>
  );
}

export function Reset() {
  const [qs] = useSearchParams();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [needCode, setNeedCode] = useState(false);
  const [code, setCode] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (pw !== pw2) return setErr('The two passwords don’t match');
    setBusy(true); setErr('');
    try {
      const r = await api('/auth/reset', 'POST', { token: qs.get('token'), password: pw, ...(needCode ? { code } : {}) });
      if (r.twoFactorRequired) { setNeedCode(true); setBusy(false); return; } // 2-step login is on: the code is needed too
      setToken(r.token);
      location.href = '/';
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <AuthShell>
      <form onSubmit={submit}>
        <h2>Choose a new password</h2>
        <p className="muted">You’ll be logged in, and signed out on every other device.</p>
        <label>New password<input type="password" required minLength={8} autoComplete="new-password" placeholder="At least 8 characters" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <label>Confirm new password<input type="password" required minLength={8} autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
        {needCode && <label>2-step code from your authenticator app<input inputMode="numeric" autoComplete="one-time-code" required autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} /></label>}
        {err && <div className="err">{err}</div>}
        <button className="btn primary lg block" disabled={busy}>{busy ? <span className="spin" /> : 'Save new password'}</button>
        <p className="switch"><Link to="/login">← Back to log in</Link></p>
      </form>
    </AuthShell>
  );
}
