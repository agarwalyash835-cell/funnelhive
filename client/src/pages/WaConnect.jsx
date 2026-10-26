// "Connect with Facebook": a seller connects their own WhatsApp number through Meta Embedded Signup — either the
// number they already use in the WhatsApp Business app (it keeps working there) or a new number. Shown only when
// the owner has set up the Meta app (server: meta-signup.js). The Facebook SDK loads only on click.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { toast } from '../ui';

// the SDK, once per page
let sdk = null;
function loadSdk(appId, version) {
  if (!sdk) {
    sdk = new Promise((resolve, reject) => {
      window.fbAsyncInit = () => { window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version }); resolve(window.FB); };
      const s = document.createElement('script');
      s.src = 'https://connect.facebook.net/en_US/sdk.js';
      s.async = true; s.defer = true; s.crossOrigin = 'anonymous';
      s.onerror = () => { sdk = null; reject(new Error('Couldn’t load Facebook — check your internet connection or ad blocker and try again')); };
      document.body.appendChild(s);
    });
  }
  return sdk;
}
// FB.login's extras: v5 offers the WhatsApp Business app path by default (opted out for a new number);
// v4 is set by the configuration; v3 asks for it with featureType
function extrasFor(version, keepApp) {
  if (version === 'v3') return { setup: {}, featureType: keepApp ? 'whatsapp_business_app_onboarding' : '', sessionInfoVersion: '3' };
  if (version === 'v4') return { setup: {} };
  return { setup: {}, version, ...(keepApp ? {} : { features: [{ name: 'whatsapp_business_app_onboarding', enabled: false }] }) };
}
const LIMITS = [
  'Keep using WhatsApp on your phone at least once every 14 days, or the connection stops.',
  'Messages you send from the app show in the FunnelHive inbox too.',
  'In the app: broadcast lists become read-only, and disappearing messages, view-once and live location are turned off for chats.',
  'Group chats, calls, and the app’s labels, quick replies and greeting/away messages don’t come across to FunnelHive.',
  'Linked devices (WhatsApp Web, desktop) are logged out once — link them again afterwards. WhatsApp for Windows isn’t supported.',
  'Messages from FunnelHive are charged by WhatsApp like any API message; messages from the app stay free.',
];

export default function WaConnect({ onChange }) {
  const [s, setS] = useState(null);
  const [mode, setMode] = useState('app');
  const [history, setHistory] = useState(false);
  const [busy, setBusy] = useState('');
  const session = useRef({});
  const load = () => api('/channels/whatsapp/signup').then(setS).catch(() => setS({ available: false }));
  useEffect(() => { load(); }, []);
  // the popup tells us which account and number were shared
  useEffect(() => {
    const on = (e) => {
      if (!/(^|\.)facebook\.com$/.test((() => { try { return new URL(e.origin).hostname; } catch { return ''; } })())) return;
      let d; try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
      if (d?.type !== 'WA_EMBEDDED_SIGNUP') return;
      if (String(d.event).startsWith('FINISH')) session.current = { wabaId: d.data?.waba_id || '', phoneNumberId: d.data?.phone_number_id || '', coexistence: d.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' || undefined };
      else if (d.event === 'CANCEL' || d.event === 'ERROR') session.current = { cancelled: d.data?.error_message || true };
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, []);
  if (!s?.available) return null;
  const c = s.connected;

  const connect = async () => {
    setBusy('connect'); session.current = {};
    try {
      const FB = await loadSdk(s.appId, s.graphVersion);
      const keepApp = mode === 'app';
      FB.login((r) => {
        const code = r?.authResponse?.code;
        // the session message can arrive just after the login callback
        setTimeout(async () => {
          const info = session.current;
          if (!code || !info.wabaId) { setBusy(''); if (code || info.cancelled) toast(typeof info.cancelled === 'string' ? info.cancelled : 'Connecting was cancelled'); return; }
          try {
            const x = await api('/channels/whatsapp/signup', 'POST', { code, wabaId: info.wabaId, phoneNumberId: info.phoneNumberId, coexistence: info.coexistence ?? keepApp, importHistory: keepApp && history });
            setS({ ...s, connected: x.connected }); toast('WhatsApp connected'); onChange?.();
          } catch (e) { toast(e.message); }
          setBusy('');
        }, 600);
      }, { config_id: s.configId, response_type: 'code', override_default_response_type: true, extras: extrasFor(s.esVersion, keepApp) });
    } catch (e) { toast(e.message); setBusy(''); }
  };
  // the SDK starts loading as the pointer reaches the button, so the popup opens straight from the click (browsers block late popups)
  const warm = () => { loadSdk(s.appId, s.graphVersion).catch(() => {}); };
  const importChats = async () => {
    setBusy('history');
    try { const x = await api('/channels/whatsapp/signup/history', 'POST', {}); setS({ ...s, connected: x.connected }); toast('Importing your chats — they’ll appear in the inbox shortly'); } catch (e) { toast(e.message); }
    setBusy('');
  };
  const h = c?.history;

  return (
    <div className="wacx-card">
      {c ? (
        <>
          <p><b>{c.inUse ? 'Connected with Facebook' : 'Connected with Facebook (not in use)'}</b> · +{c.display}{c.name ? ` · ${c.name}` : ''}{c.coexistence ? ' · also on the WhatsApp Business app' : ''}</p>
          {c.coexistence && h && <p className="hint">{h.state === 'declined' ? 'Chat history wasn’t shared (it was turned off in the WhatsApp app).' : h.state === 'done' ? `Old chats imported: ${h.imported.toLocaleString('en-IN')} messages.` : `Importing your old chats… ${h.progress}%`}</p>}
          {c.canImportHistory && <div className="row"><button className="btn ghost" disabled={!!busy} onClick={importChats}>{busy === 'history' ? 'Starting…' : 'Import my last 6 months of chats'}</button><span className="hint">Only possible in the first 24 hours. Imported chats never get automatic replies.</span></div>}
          {!c.inUse && <p className="hint warn">Messages go through another WhatsApp connection right now.</p>}
          <button className="link-btn" disabled={!!busy} onClick={connect}>Connect a different number</button>
        </>
      ) : (
        <>
          <p><b>Connect WhatsApp in one step</b> — log in with Facebook and pick your number. No codes or tokens to copy.</p>
          <div className="wacx-choices" role="radiogroup">
            <label className={mode === 'app' ? 'on' : ''}><input type="radio" name="wacx" checked={mode === 'app'} onChange={() => setMode('app')} /><span><b>Use my existing WhatsApp Business app number</b><small>Keep using the app on your phone — FunnelHive works on the same number.</small></span></label>
            <label className={mode === 'new' ? 'on' : ''}><input type="radio" name="wacx" checked={mode === 'new'} onChange={() => setMode('new')} /><span><b>Use a new number</b><small>A number not on WhatsApp yet. You’ll get a code by SMS or call.</small></span></label>
          </div>
          {mode === 'app' && (
            <>
              <label className="tog"><input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} /><span />Import my last 6 months of chats</label>
              <details className="wacx-limits"><summary>What changes in the WhatsApp Business app</summary><ul>{LIMITS.map((x) => <li key={x}>{x}</li>)}</ul></details>
            </>
          )}
          <div className="row"><button className="btn primary wacx-fb" disabled={!!busy} onClick={connect} onPointerEnter={warm} onFocus={warm} onTouchStart={warm}>{busy === 'connect' ? 'Waiting for Facebook…' : 'Connect with Facebook'}</button></div>
        </>
      )}
      <style>{`.wacx-card{border:1px solid var(--line,#e5e7eb);border-radius:10px;padding:12px 14px;margin-bottom:12px}.wacx-card p{margin:0 0 8px}.wacx-choices{display:grid;gap:8px;margin:8px 0}.wacx-choices label{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--line,#e5e7eb);border-radius:8px;padding:10px;cursor:pointer}.wacx-choices label.on{border-color:var(--brand,#1877f2)}.wacx-choices input{margin-top:3px;width:auto;flex:none}.wacx-choices small{display:block;opacity:.75;font-weight:400}.wacx-limits{margin:6px 0 10px;font-size:13px}.wacx-limits ul{margin:6px 0 0;padding-left:18px}.btn.primary.wacx-fb{background:#1877f2;border-color:#1877f2;color:#fff}`}</style>
    </div>
  );
}
