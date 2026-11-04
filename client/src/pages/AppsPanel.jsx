// Settings → Apps & ads: the seller connects their own Meta Ads (and Google Ads, when offered) through Composio's
// hosted page — logins and tokens are typed there, never here — and Hive AI can then work in those accounts.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Panel, Icon, toast, confirmDialog } from '../ui';

export function AppsPanel() {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState('');
  const load = () => api('/integrations').then(setD).catch(() => setD({ ready: false, apps: [], connections: [] }));
  useEffect(() => {
    load();
    // back from Composio's connect page
    const p = new URLSearchParams(location.search).get('connected');
    if (p) { toast('Connected — Hive AI can now work in that account'); history.replaceState(null, '', `${location.pathname}#apps`); }
    if (location.hash === '#apps') setTimeout(() => document.getElementById('apps')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
  }, []);
  if (!d || !d.ready) return null; // switched off until the platform owner adds a Composio key
  const connect = async (app) => { setBusy(app); try { const r = await api(`/integrations/${app}/connect`, 'POST'); location.href = r.url; } catch (e) { toast(e.message); setBusy(''); } };
  const remove = async (c) => {
    if (!await confirmDialog({ title: `Disconnect ${c.name}?`, text: 'Hive AI will no longer see or change anything in it. Your ads keep running.', confirm: 'Disconnect', danger: true })) return;
    try { await api(`/integrations/connections/${c.id}`, 'DELETE'); toast(`${c.name} disconnected`); load(); } catch (e) { toast(e.message); }
  };
  return (
    <div id="apps">
      <Panel title="Apps & ads">
        <p className="muted sm">Connect your own ad accounts and Hive AI can read results, build campaigns from your funnels and suggest fixes. New campaigns are always created paused, and nothing that changes or spends money happens without your OK.</p>
        <div className="apps-grid">
          {d.apps.map((a) => {
            const conns = d.connections.filter((c) => c.app === a.app);
            const live = conns.find((c) => c.status === 'ACTIVE');
            return (
              <div key={a.app} className={`app-card ${live ? 'on' : ''}`}>
                <div className="app-h"><span className={`app-logo ${a.app}`}>{a.app === 'metaads' ? 'f' : 'G'}</span><div><b>{a.name}</b><small>{a.what}</small></div></div>
                {live ? <div className="app-st"><span className="pill ok">Connected</span><button className="link-btn danger-t" onClick={() => remove(live)}>Disconnect</button></div>
                  : <button className="btn primary sm" disabled={busy === a.app} onClick={() => connect(a.app)}>{busy === a.app ? 'Opening…' : `Connect ${a.name}`}</button>}
                {live && a.app === 'metaads' && <MetaSetup />}
                {live && a.app === 'googleads' && <GoogleSetup />}
                {a.app === 'googleads' && !live && <details className="app-help"><summary>No Google Ads account yet?</summary>
                  <ol>
                    <li>Open <a href="https://ads.google.com" target="_blank" rel="noreferrer">ads.google.com</a> and sign in with the Google account you’ll use for ads.</li>
                    <li>Choose <b>Switch to Expert Mode</b> → <b>Create an account without a campaign</b>, set India and ₹, and add your payment card. Google bills ad spend to you directly.</li>
                    <li>Come back and press <b>Connect Google Ads</b> above, signing in with that same Google account.</li>
                  </ol></details>}
                {!live && conns.some((c) => c.status !== 'ACTIVE') && <small className="muted">A connection was started but not finished — connect again.</small>}
                {a.app === 'metaads' && !live && <details className="app-help"><summary>How to get a Meta access token</summary>
                  <ol>
                    <li>Open <b>business.facebook.com → Settings → Users → System users</b> and add one (role: Admin).</li>
                    <li>Click <b>Assign assets</b> → your ad account → <b>Manage campaigns</b>.</li>
                    <li>Click <b>Generate new token</b>, tick <code>ads_management</code> and <code>ads_read</code>, and copy it.</li>
                    <li>Press <b>Connect Meta Ads</b> above and paste it on the page that opens.</li>
                  </ol></details>}
              </div>
            );
          })}
        </div>
        {d.error && <p className="hint warn">{d.error}</p>}
        <p className="hint">Then just ask Hive AI, e.g. “How did my Meta ads do this week?” or “Create a ₹500/day campaign for my webinar funnel”.</p>
      </Panel>
    </div>
  );
}

// after connecting Google Ads: pick the ad account Hive works in (and any others whose spend should sync too)
function GoogleSetup() {
  const [g, setG] = useState(null);
  const [v, setV] = useState({ account: '', accounts: [] });
  const [busy, setBusy] = useState(false);
  const load = () => api('/integrations/google').then((x) => {
    setG(x);
    const main = x.selected?.account || (x.accounts.length === 1 ? x.accounts[0].id : '');
    setV({ account: main, accounts: (x.selected?.accounts || []).filter((id) => id !== main) });
  }).catch((e) => setG({ error: e.message, accounts: [] }));
  useEffect(() => { load(); }, []);
  if (!g) return <div className="skeleton sm" />;
  const save = async () => {
    setBusy(true);
    try { const r = await api('/integrations/google', 'PUT', v); setG({ ...g, selected: r.selected }); toast('Saved — Hive works in this account, and its spend syncs daily'); } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const sel = g.selected;
  const done = sel && sel.account === v.account && (sel.accounts || []).filter((id) => id !== v.account).sort().join() === [...v.accounts].sort().join();
  const label = (a) => `${a.name || 'Account'} · ${a.id.replace(/^(\d{3})(\d{3})(\d+)$/, '$1-$2-$3')}${a.currency ? ` · ${a.currency}` : ''}${a.manager ? ' (via manager)' : ''}`;
  const others = g.accounts.filter((a) => a.id !== v.account);
  return (
    <div className="meta-setup">
      {g.error && <p className="hint warn">{/developer[ _-]?token/i.test(g.error) ? 'Google Ads isn’t fully set up on our side yet (developer token) — we’re on it. Your connection is saved.' : g.error}</p>}
      {!g.error && !g.accounts.length && <small className="muted">No ad accounts found for this Google login — create one at ads.google.com, then reload.</small>}
      {g.accounts.length > 0 && <label>Ad account<select value={v.account} onChange={(e) => setV({ account: e.target.value, accounts: v.accounts.filter((id) => id !== e.target.value) })}>
        <option value="">Choose…</option>{g.accounts.map((a) => <option key={a.id} value={a.id}>{label(a)}</option>)}</select></label>}
      {v.account && others.length > 0 && <div className="meta-more"><small className="muted">Other ad accounts — their spend syncs daily too</small>
        {others.map((a) => <label key={a.id} className="tog"><input type="checkbox" checked={v.accounts.includes(a.id)} onChange={(e) => setV({ ...v, accounts: e.target.checked ? [...v.accounts, a.id] : v.accounts.filter((id) => id !== a.id) })} /><span />{label(a)}</label>)}</div>}
      {g.accounts.length > 0 && <button className="btn primary sm" disabled={busy || !v.account || done} onClick={save}>{busy ? 'Saving…' : done ? 'Saved' : 'Use this account'}</button>}
      {sel && <small className="muted">Hive works in {sel.accountName || sel.account}; spend syncs daily{sel.accounts?.length > 1 ? ` from ${sel.accounts.length} accounts` : ''}{sel.syncedAt ? ` (last ${new Date(sel.syncedAt).toLocaleDateString('en-IN')})` : ''}.</small>}
      {sel?.error && <small className="warn-t">{sel.error}</small>}
    </div>
  );
}

// after connecting Meta: pick the ad account and pixel once — that turns on the pixel on your pages, server-side
// conversions (and the “Send to Meta” automation step) and the daily ad-spend pull, with no other tokens
function MetaSetup() {
  const [m, setM] = useState(null);
  const [v, setV] = useState({ account: '', pixel: '', accounts: [] });
  const [busy, setBusy] = useState(false);
  const load = (account) => api(`/integrations/meta${account ? `?account=${account}` : ''}`).then((x) => {
    setM(x);
    const main = x.account || x.selected?.account || '';
    // the other ad accounts (more brands) stay ticked when the main one changes
    setV((y) => ({ account: main, pixel: x.selected?.account === x.account ? x.selected?.pixel || '' : x.pixels.length === 1 ? x.pixels[0].id : '', accounts: (account ? y.accounts : x.selected?.accounts || []).filter((id) => id !== main) }));
  }).catch((e) => setM({ error: e.message, accounts: [], pixels: [] }));
  useEffect(() => { load(); }, []);
  if (!m) return <div className="skeleton sm" />;
  const save = async () => {
    setBusy(true);
    try { const r = await api('/integrations/meta', 'PUT', v); setM({ ...m, selected: r.selected }); toast(r.pixelOnPages ? 'Saved — pixel, conversions and ad spend now run through Meta' : 'Saved'); } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const sel = m.selected;
  const done = sel && sel.account === v.account && (sel.pixel || '') === v.pixel && (sel.accounts || []).filter((id) => id !== v.account).sort().join() === [...v.accounts].sort().join();
  const others = m.accounts.filter((a) => a.id !== v.account);
  return (
    <div className="meta-setup">
      {m.error && <p className="hint warn">{m.error}</p>}
      <label>Ad account<select value={v.account} onChange={(e) => { setV({ ...v, account: e.target.value, pixel: '' }); if (e.target.value) load(e.target.value); }}>
        <option value="">Choose…</option>{m.accounts.map((a) => <option key={a.id} value={a.id}>{a.name || a.id} · {a.id}</option>)}</select></label>
      {v.account && <label>Pixel (dataset)<select value={v.pixel} onChange={(e) => setV({ ...v, pixel: e.target.value })}>
        <option value="">None — ad spend only</option>{(m.pixels || []).map((p) => <option key={p.id} value={p.id}>{p.name || p.id} · {p.id}</option>)}</select></label>}
      {v.account && !m.pixels?.length && !m.error && <small className="muted">No pixel on this ad account yet — create one in Events Manager, then reload.</small>}
      {v.account && others.length > 0 && <div className="meta-more"><small className="muted">Other brands’ ad accounts — their spend syncs daily too, and their pixels can be picked for a funnel (editor → Tracking for this funnel)</small>
        {others.map((a) => <label key={a.id} className="tog"><input type="checkbox" checked={v.accounts.includes(a.id)} onChange={(e) => setV({ ...v, accounts: e.target.checked ? [...v.accounts, a.id] : v.accounts.filter((id) => id !== a.id) })} /><span />{a.name || a.id} · {a.id}</label>)}</div>}
      <button className="btn primary sm" disabled={busy || !v.account || done} onClick={save}>{busy ? 'Saving…' : done ? 'Saved' : 'Use these'}</button>
      {sel?.pixel && <small className="muted">Pixel {sel.pixelName || sel.pixel} is on your pages, leads and sales go to Meta server-side, and spend syncs daily{sel.accounts?.length > 1 ? ` from ${sel.accounts.length} ad accounts` : ''}{sel.syncedAt ? ` (last ${new Date(sel.syncedAt).toLocaleDateString('en-IN')})` : ''}.</small>}
      {sel?.error && <small className="warn-t">{sel.error}</small>}
    </div>
  );
}
