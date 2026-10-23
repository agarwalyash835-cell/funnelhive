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
