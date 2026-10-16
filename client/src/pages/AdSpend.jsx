import { useEffect, useState } from 'react';
import { api } from '../api';
import { Panel, toast, ago, confirmDialog } from '../ui';

// Settings → Ad spend: Meta synced daily, Google Ads (and others) by CSV — for ROAS next to every campaign
export function AdSpendPanel() {
  const [d, setD] = useState(null);
  const [v, setV] = useState({ account: '', token: '' });
  const [busy, setBusy] = useState(false);
  const [platform, setPlatform] = useState('google');
  const load = () => api('/adspend').then((x) => { setD(x); setV((y) => ({ ...y, account: x.meta.account })); }).catch(() => setD(false));
  useEffect(() => { load(); }, []);
  if (d === false) return null;
  if (!d) return <Panel title="Ad spend & ROAS"><div className="skeleton sm" /></Panel>;
  const connect = async () => { setBusy(true); try { const r = await api('/adspend/meta', 'PUT', v); toast(`Connected — ${r.rows} days of campaign spend imported`); setV({ ...v, token: '' }); load(); } catch (e) { toast(e.message); } setBusy(false); };
  const upload = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.csv,text/csv';
    inp.onchange = async () => { try { const r = await api('/adspend/csv', 'POST', { platform, csv: await inp.files[0].text() }); toast(`${r.rows} rows of spend imported`); load(); } catch (e) { toast(e.message); } };
    inp.click();
  };
  return (
    <Panel title="Ad spend & ROAS">
      <p className="muted sm">Bring in what your ads cost, and every campaign on the dashboard shows spend, ROAS and cost per lead next to the leads and sales it brought. Campaign names are matched to your <code>utm_campaign</code> tags.</p>
      <div className="rzp">
        <div className="rzp-h"><b>Meta (Facebook & Instagram)</b>{d.meta.connected ? <span className="pill ok">Synced {d.meta.syncedAt ? ago(d.meta.syncedAt) : ''}</span> : <span className="pill">Not connected</span>}</div>
        {d.meta.error && <p className="hint warn-t">{d.meta.error}</p>}
        <div className="form2">
          <label>Ad account ID<input value={v.account} onChange={(e) => setV({ ...v, account: e.target.value })} placeholder="act_1234567890" /></label>
          <label>Access token <small className="muted">· with ads_read</small><input type="password" value={v.token} onChange={(e) => setV({ ...v, token: e.target.value })} placeholder={d.meta.connected ? '•••••••• (saved)' : 'From Business Settings → System users'} autoComplete="new-password" /></label>
        </div>
        <div className="row"><button className="btn primary" disabled={busy || !v.account} onClick={connect}>{busy ? 'Connecting…' : d.meta.connected ? 'Save & sync' : 'Connect'}</button>
          {d.meta.connected && <><button className="btn ghost" onClick={async () => { try { const r = await api('/adspend/meta/sync', 'POST', { days: 30 }); toast(`Synced ${r.rows} rows`); load(); } catch (e) { toast(e.message); } }}>Sync now</button><button className="btn ghost danger" onClick={async () => { if (await confirmDialog({ title: 'Disconnect Meta and remove its spend?', confirm: 'Disconnect', danger: true })) { await api('/adspend/meta', 'PUT', { clear: true }); load(); } }}>Disconnect</button></>}</div>
        <p className="hint">Synced every day (the last 7 days are refreshed, so late-arriving spend is corrected).</p>
      </div>
      <div className="rzp">
        <div className="rzp-h"><b>Google Ads & others (CSV)</b></div>
        <p className="hint">Google Ads → Campaigns → Download → CSV, with the <b>Day</b> segment added. Any file with date, campaign and cost columns works (YouTube, LinkedIn, TikTok…). Uploading a day again replaces it.</p>
        <div className="row"><select value={platform} onChange={(e) => setPlatform(e.target.value)}>{[['google', 'Google Ads'], ['youtube', 'YouTube'], ['linkedin', 'LinkedIn'], ['tiktok', 'TikTok'], ['other', 'Other']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><button className="btn ghost" onClick={upload}>Upload CSV</button></div>
        {d.platforms?.length > 0 && <p className="hint">{d.platforms.map((p) => `${p.p}: ${p.n} rows, up to ${p.d}`).join(' · ')}</p>}
      </div>
    </Panel>
  );
}
