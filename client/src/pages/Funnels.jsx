import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Layout, Icon, Empty, CreateFunnel, inr, num, toast , Modal , pagesOrigin } from '../ui';
import { Page } from '../blocks';

const STEP_IC = { landing: '🏠', optin: '📝', sales: '💡', checkout: '💳', upsell: '⬆️', downsell: '⬇️', thankyou: '🎉' };

export default function Funnels() {
  const nav = useNavigate();
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const [create, setCreate] = useState(false);
  const [me, setMe] = useState(null);
  const load = () => api('/funnels').then(setList);
  useEffect(() => { load(); api('/me').then(setMe); }, []);
  const [moveF, setMoveF] = useState(null);
  const share = async (f) => { try { const r = await api(`/funnels/${f.id}/share`, 'POST', {}); navigator.clipboard?.writeText(r.url); toast('Share link copied — anyone with it can import a copy'); } catch (e) { toast(e.message); } };
  const exportF = async (f) => { const r = await fetch(`/api/funnels/${f.id}/export`, { headers: { Authorization: `Bearer ${localStorage.getItem('ff_token')}` } }); if (!r.ok) return toast('Export failed'); const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = `${f.slug}.funnelhive.json`; a.click(); };
  const importF = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => { try { const snap = JSON.parse(await inp.files[0].text()); const r = await api('/funnels/import', 'POST', { snapshot: snap }); toast(`Imported “${r.name}”`); load(); } catch (e) { toast(e.message || 'That file isn’t a FunnelHive funnel'); } };
    inp.click();
  };
  const dup = async (id) => { await api(`/funnels/${id}/duplicate`, 'POST'); toast('Funnel duplicated'); load(); };
  const del = async (f) => { if (confirm(`Delete “${f.name}” and all its data? This cannot be undone.`)) { await api(`/funnels/${f.id}`, 'DELETE'); toast('Funnel deleted'); load(); } };
  const copyLink = (f) => { navigator.clipboard?.writeText(`${pagesOrigin()}/f/${f.slug}`); toast('Live link copied'); };
  const shown = (list || []).filter((f) => f.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <Layout title="Funnels" subtitle="Build, publish and optimise your sales funnels." actions={<>
      <div className="search"><Icon name="search" size={16} /><input placeholder="Search funnels…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <button className="btn ghost" onClick={importF} title="Import a .funnelhive.json file"><Icon name="download" size={16} /> Import</button>
      <button className="btn primary" onClick={() => setCreate(true)}><Icon name="plus" /> New funnel</button>
    </>}>
      {moveF && <CopyTo f={moveF} onClose={() => setMoveF(null)} />}
      {create && <CreateFunnel onClose={() => setCreate(false)} aiEnabled={me?.aiEnabled} />}
      {!list ? <div className="skeleton" /> : !list.length ? (
        <Empty icon="funnel" title="No funnels yet" text="Create one with AI in under a minute, or start from one of 100+ proven templates.">
          <div className="row center"><button className="btn primary" onClick={() => setCreate(true)}><Icon name="wand" /> Build with AI</button><Link className="btn ghost" to="/templates">Browse templates</Link></div>
        </Empty>
      ) : (
        <div className="fgrid">
          {shown.map((f) => (
            <article className="fcard" key={f.id}>
              <Link to={`/funnels/${f.id}`} className="fthumb">
                {f.hero ? <div className="thumb-in"><Page blocks={[f.hero]} theme={f.theme} ctx={{ live: false }} /></div> : <div className="fthumb-ph"><Icon name="layout" size={30} /></div>}
                <span className={`pill float ${f.published ? 'ok' : ''}`}>{f.published ? '● Live' : 'Draft'}</span>
              </Link>
              <div className="fbody">
                <h3><Link to={`/funnels/${f.id}`}>{f.name}</Link></h3>
                <div className="chain">{f.steps.map((s, i) => <span key={s.id} title={s.name}>{STEP_IC[s.type] || '📄'}{i < f.steps.length - 1 && <i>›</i>}</span>)}<small>{f.steps.length} steps</small></div>
                <div className="fstats">
                  <div><b>{num(f.stats.visitors)}</b><small>visitors</small></div>
                  <div><b>{num(f.stats.orders)}</b><small>orders</small></div>
                  <div><b>{f.stats.conversion}%</b><small>conv.</small></div>
                  <div><b>{inr(f.stats.revenue)}</b><small>30d revenue</small></div>
                </div>
                <div className="factions">
                  <button className="btn primary sm" onClick={() => nav(`/funnels/${f.id}`)}><Icon name="edit" size={15} /> Edit</button>
                  <Link className="icon-btn" title="Analytics" to={`/funnels/${f.id}/analytics`}><Icon name="chart" size={16} /></Link>
                  <Link className="icon-btn" title="Preview" to={`/f/${f.slug}?preview=1&pv=${f.previewKey || ''}`}><Icon name="eye" size={16} /></Link>
                  {f.published && <button className="icon-btn" title="Copy live link" onClick={() => copyLink(f)}><Icon name="link" size={16} /></button>}
                  <button className="icon-btn" title="Duplicate" onClick={() => dup(f.id)}><Icon name="copy" size={16} /></button>
                  <button className="icon-btn" title="Copy to a client account" onClick={() => setMoveF(f)}><Icon name="layers" size={16} /></button>
                  <button className="icon-btn" title="Share as a link (others import a copy)" onClick={() => share(f)}><Icon name="send" size={16} /></button>
                  <button className="icon-btn" title="Export as a file" onClick={() => exportF(f)}><Icon name="download" size={16} /></button>
                  <button className="icon-btn danger" title="Delete" onClick={() => del(f)}><Icon name="trash" size={16} /></button>
                </div>
              </div>
            </article>
          ))}
          <button className="fcard new" onClick={() => setCreate(true)}><Icon name="plus" size={28} /><b>New funnel</b><small>AI, template or blank</small></button>
        </div>
      )}
    </Layout>
  );
}

// copy a funnel (pages, automations, products) into a client account or another account you manage
function CopyTo({ f, onClose }) {
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    Promise.all([api('/agency').catch(() => ({ clients: [] })), api('/team/workspaces').catch(() => ({ teams: [] }))]).then(([a, w]) => {
      const seen = new Set();
      setList([...(a.clients || []).map((c) => ({ id: c.id, name: c.business, why: 'client' })), ...(w.teams || []).filter((t) => ['admin', 'agency'].includes(t.role)).map((t) => ({ id: t.ownerId, name: t.name, why: t.role }))].filter((x) => !seen.has(x.id) && seen.add(x.id)));
    });
  }, []);
  const go = async (t) => { setBusy(t.id); try { const r = await api(`/funnels/${f.id}/copy-to`, 'POST', { accountId: t.id }); toast(`Copied to ${t.name}${r.products ? ` with ${r.products} product${r.products > 1 ? 's' : ''}` : ''}`); onClose(); } catch (e) { toast(e.message); } setBusy(null); };
  return (
    <Modal title={`Copy “${f.name}” to…`} onClose={onClose} width={480}>
      <div className="m-body">
        {!list ? <div className="skeleton sm" /> : !list.length ? <p className="muted">No client accounts yet. Add clients on the <Link to="/agency">Agency</Link> page, or share this funnel as a link.</p> : (
          <div className="cal-list">{list.map((t) => <button key={t.id} disabled={!!busy} onClick={() => go(t)}><b>{t.name}</b><small>{busy === t.id ? 'Copying…' : t.why === 'client' ? 'Client account' : `You’re ${t.why}`}</small></button>)}</div>
        )}
        <p className="hint">The copy is a draft with its own pages, paused automations and copies of the products it sells. Payments, domains and data stay separate.</p>
      </div>
    </Modal>
  );
}
