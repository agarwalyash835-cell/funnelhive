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

// after connecting Meta: pick the ad account and pixel once — that turns on the pixel on your pages, server-side
// conversions (and the “Send to Meta” automation step) and the daily ad-spend pull, with no other tokens
function MetaSetup() {
  const [m, setM] = useState(null);
  const [v, setV] = useState({ account: '', pixel: '' });
  const [busy, setBusy] = useState(false);
  const load = (account) => api(`/integrations/meta${account ? `?account=${account}` : ''}`).then((x) => {
    setM(x);
    setV({ account: x.account || x.selected?.account || '', pixel: x.selected?.account === x.account ? x.selected?.pixel || '' : x.pixels.length === 1 ? x.pixels[0].id : '' });
  }).catch((e) => setM({ error: e.message, accounts: [], pixels: [] }));
  useEffect(() => { load(); }, []);
  if (!m) return <div className="skeleton sm" />;
  const save = async () => {
    setBusy(true);
    try { const r = await api('/integrations/meta', 'PUT', v); setM({ ...m, selected: r.selected }); toast(r.pixelOnPages ? 'Saved — pixel, conversions and ad spend now run through Meta' : 'Saved'); } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const sel = m.selected;
  const done = sel && sel.account === v.account && (sel.pixel || '') === v.pixel;
  return (
    <div className="meta-setup">
      {m.error && <p className="hint warn">{m.error}</p>}
      <label>Ad account<select value={v.account} onChange={(e) => { setV({ account: e.target.value, pixel: '' }); if (e.target.value) load(e.target.value); }}>
        <option value="">Choose…</option>{m.accounts.map((a) => <option key={a.id} value={a.id}>{a.name || a.id} · {a.id}</option>)}</select></label>
      {v.account && <label>Pixel (dataset)<select value={v.pixel} onChange={(e) => setV({ ...v, pixel: e.target.value })}>
        <option value="">None — ad spend only</option>{(m.pixels || []).map((p) => <option key={p.id} value={p.id}>{p.name || p.id} · {p.id}</option>)}</select></label>}
      {v.account && !m.pixels?.length && !m.error && <small className="muted">No pixel on this ad account yet — create one in Events Manager, then reload.</small>}
      <button className="btn primary sm" disabled={busy || !v.account || done} onClick={save}>{busy ? 'Saving…' : done ? 'Saved' : 'Use these'}</button>
      {sel?.pixel && <small className="muted">Pixel {sel.pixelName || sel.pixel} is on your pages, leads and sales go to Meta server-side, and spend syncs daily{sel.syncedAt ? ` (last ${new Date(sel.syncedAt).toLocaleDateString('en-IN')})` : ''}.</small>}
      {sel?.error && <small className="warn-t">{sel.error}</small>}
    </div>
  );
}
