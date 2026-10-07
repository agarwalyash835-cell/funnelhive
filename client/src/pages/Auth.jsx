import { useState } from 'react';
import { api, setToken } from '../api';
import { Icon } from '../ui';

const PERKS = ['Hive AI builds your entire funnel from one chat', '53 proven templates for Indian businesses', 'One-click upsells, order bumps & cross-sells', 'Razorpay checkout with UPI, coupons & cart recovery', 'CRM, email + WhatsApp automations, A/B tests'];

export function AuthShell({ children }) {
  return (
    <div className="auth">
      <div className="auth-art">
        <a href="/" className="brand light"><span className="logo"><Icon name="bolt" size={18} /></span>FunnelHive</a>
        <h1>Build funnels that sell — <span>in minutes, not weeks.</span></h1>
        <ul>{PERKS.map((p) => <li key={p}><Icon name="check" size={16} />{p}</li>)}</ul>
        <div className="auth-quote">14-day free trial with every feature. No credit card needed to start.<small>GST invoices · cancel any time</small></div>
      </div>
      <div className="auth-form">{children}</div>
    </div>
  );
}

export default function Auth() {
  const [mode, setMode] = useState(() => (new URLSearchParams(location.search).get('mode') === 'login' ? 'login' : 'register'));
  const [f, setF] = useState({ name: '', email: '', password: '', code: '' });
  const [needCode, setNeedCode] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const go = (m) => { setMode(m); setErr(''); setInfo(''); setNeedCode(false); };

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      if (mode === 'forgot') {
        const r = await api('/auth/forgot', 'POST', { email: f.email });
        setInfo(r.emailConfigured ? 'If an account exists for that email, a reset link is on its way. Check your inbox.' : 'Email sending isn’t configured on this server yet — the reset link was printed in the server console.');
      } else {
        const r = await api(`/auth/${mode}`, 'POST', f);
        if (r.twoFactorRequired) { setNeedCode(true); setBusy(false); return; }
        setToken(r.token);
        location.href = '/';
        return;
      }
    } catch (x) { setErr(x.message); }
    setBusy(false);
  };

  const title = mode === 'forgot' ? 'Reset your password' : needCode ? '2-step verification' : mode === 'login' ? 'Welcome back' : 'Create your free account';
  const sub = mode === 'forgot' ? 'Enter your account email and we’ll send you a reset link.' : needCode ? 'Enter the 6-digit code from your authenticator app.' : mode === 'login' ? 'Log in to manage your funnels.' : '14-day free trial · no credit card needed. Your first funnel is 60 seconds away.';

  return (
    <AuthShell>
      <form onSubmit={submit}>
        <h2>{title}</h2>
        <p className="muted">{sub}</p>
        {needCode ? (
          <label>Authentication code<input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="123 456" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></label>
        ) : (
          <>
            {mode === 'register' && <label>Your name<input placeholder="Priya Sharma" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>}
            <label>Email<input type="email" required autoComplete="email" placeholder="you@business.in" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
            {mode !== 'forgot' && (
              <label><span className="lbl-row">Password{mode === 'login' && <a onClick={() => go('forgot')}>Forgot password?</a>}</span>
                <input type="password" required minLength={6} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="At least 6 characters" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
            )}
          </>
        )}
        {err && <div className="err">{err}</div>}
        {info && <div className="ok-box">{info}</div>}
        <button className="btn primary lg block" disabled={busy}>{busy ? <span className="spin" /> : mode === 'forgot' ? 'Send reset link' : needCode ? 'Verify & log in' : mode === 'login' ? 'Log in' : 'Create account'}</button>
        {mode === 'forgot'
          ? <p className="switch"><a onClick={() => go('login')}>← Back to log in</a></p>
          : <p className="switch">{mode === 'login' ? 'New to FunnelHive?' : 'Already have an account?'} <a onClick={() => go(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Create an account' : 'Log in'}</a></p>}
      </form>
    </AuthShell>
  );
}
