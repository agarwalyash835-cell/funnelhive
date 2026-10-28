import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { promptsFor } from '../industryPrompts';
import { Layout, Panel, Icon, Empty, CreateFunnel, RangePicker, inr, num, ago, toast, useFunnelDraft, BriefQuestions, DesignPicker, DEFAULT_DESIGN, confirmDialog } from '../ui';
import { PagePreview } from '../blocks';
import { AreaChart, Sparkline, HBars } from '../charts';
import { TalkToHive } from '../talk';
import { KitIcon } from '../blockIcons';

const METRICS = [
  ['revenue', 'Revenue', inr],
  ['orders', 'Orders', num],
  ['leads', 'Leads', num],
  ['views', 'Visitors', num],
];
const KIND_LABEL = { main: 'Main offer', bump: 'Order bumps', upsell: 'Upsells', downsell: 'Downsells', crosssell: 'Cross-sells' };

export function Delta({ now, prev }) {
  if (!prev) return now ? <span className="delta up">new</span> : <span className="delta">—</span>;
  const d = ((now - prev) / prev) * 100;
  return <span className={`delta ${d >= 0 ? 'up' : 'down'}`}>{d >= 0 ? '▲' : '▼'} {Math.abs(d).toFixed(1)}%</span>;
}

export function Kpis({ data }) {
  const t = data.totals, p = data.prev;
  const tiles = [
    ['Revenue', inr(t.revenue), t.revenue, p.revenue, 'revenue', 'wallet'],
    ['Orders', num(t.orders), t.orders, p.orders, 'orders', 'cart'],
    ['Leads', num(t.leads), t.leads, p.leads, 'leads', 'users'],
    ['Visitors', num(t.visitors), t.visitors, p.visitors, 'views', 'eye'],
    ['Conversion', `${t.conversion}%`, t.conversion, p.conversion, null, 'chart'],
    ['Avg. order value', inr(t.aov), t.aov, p.aov, null, 'tag'],
  ];
  return (
    <div className="kpis">
      {tiles.map(([label, value, n, prev, key, ic]) => (
        <div className="kpi" key={label}>
          <span className="kpi-l"><span className="kpi-ic"><Icon name={ic} size={14} /></span>{label}</span>
          <b className="kpi-v">{value}</b>
          <div className="kpi-f"><Delta now={n} prev={prev} />{key && <Sparkline data={data.series} yKey={key} />}</div>
        </div>
      ))}
    </div>
  );
}

export function TrendPanel({ data, sales = true }) {
  const list = sales ? METRICS : METRICS.filter(([k]) => k === 'leads' || k === 'views');
  const [metric, setMetric] = useState(list[0][0]);
  const m = list.find((x) => x[0] === metric) || list[0];
  return (
    <Panel title="Performance" actions={<div className="seg sm">{list.map(([k, l]) => <button key={k} className={metric === k ? 'on' : ''} onClick={() => setMetric(k)}>{l}</button>)}</div>}>
      <AreaChart data={data.series} yKey={metric} format={m[2]} label={`${m[1]} per day`} />
    </Panel>
  );
}

export const OfferMix = ({ byKind }) => (
  <HBars format={inr} items={Object.entries(KIND_LABEL).map(([k, label]) => ({ label, value: byKind[k] || 0 }))} />
);

// Revenue by ad campaign (UTM tags), so a seller sees which ad actually sold
export function Campaigns({ rows = [] }) {
  const tagged = rows.filter((r) => r.campaign || r.medium);
  const spend = rows.some((r) => r.spend != null);
  const roasCls = (x) => (x == null ? '' : x >= 2 ? 'ok' : x >= 1 ? 'warn' : 'bad');
  if (!rows.length) return <Empty icon="tag" title="No campaign data yet" text="Add UTM tags to your ad links (utm_source, utm_campaign, utm_content) — every lead and sale is matched to its campaign automatically." />;
  return (
    <div className="tbl-wrap"><table className="tbl compact">
      <thead><tr><th>Source / medium</th><th>Campaign</th><th>Ad / content</th><th className="r">Leads</th><th className="r">Orders</th><th className="r">Revenue</th>{spend && <><th className="r">Ad spend</th><th className="r">ROAS</th><th className="r">Cost / lead</th></>}</tr></thead>
      <tbody>{rows.slice(0, 25).map((r, i) => (
        <tr key={i}><td><span className="src">{r.source}</span>{r.medium && <small className="muted"> / {r.medium}</small>}</td><td className={r.campaign ? 'strong' : 'muted'}>{r.campaign || '(no campaign)'}</td><td className="muted sm">{r.content || '—'}</td>
          <td className="r">{num(r.leads)}</td><td className="r">{num(r.orders)}</td><td className="r strong">{inr(r.revenue)}{r.refunded > 0 && <small className="sub-t">−{inr(r.refunded)} refunded</small>}</td>
          {spend && <><td className="r">{r.spend != null ? inr(r.spend) : '—'}{r.unmatched && <small className="sub-t" title="Spend with no tagged visits — check this campaign’s UTM tags">no UTM match</small>}</td><td className="r">{r.roas != null ? <span className={`pill ${roasCls(r.roas)}`}>{r.roas}×</span> : '—'}</td><td className="r muted">{r.cpl != null ? inr(r.cpl) : '—'}</td></>}</tr>
      ))}</tbody>
    </table>{!tagged.length && <p className="hint pad">None of your traffic is tagged yet. Tag ad links like <code>?utm_source=facebook&amp;utm_medium=paid&amp;utm_campaign=diwali&amp;utm_content=reel-1</code> to see revenue per campaign and per ad.</p>}</div>
  );
}

export const Sources = ({ rows }) => (
  <div className="tbl-wrap"><table className="tbl compact">
    <thead><tr><th>Source</th><th className="r">Visitors</th><th className="r">Orders</th><th className="r">Revenue</th></tr></thead>
    <tbody>{rows.slice(0, 7).map((s) => <tr key={s.source}><td><span className="src">{s.source}</span></td><td className="r">{num(s.views)}</td><td className="r">{num(s.orders)}</td><td className="r">{inr(s.revenue)}</td></tr>)}</tbody>
  </table></div>
);

// industry: the CRM industry (or the one picked on the dashboard) — the ready prompts and the examples follow it
function PromptHero({ name, managedBy, aiEnabled, onSample, seeding, showSample, industry }) {
  const { chips, examples } = promptsFor(industry);
  const [prompt, setPrompt] = useState('');
  const [lang, setLang] = useState('en');
  const [hint, setHint] = useState(0);
  const [design, setDesign] = useState(DEFAULT_DESIGN);
  const [showDesign, setShowDesign] = useState(false);
  const draft = useFunnelDraft();
  const { busy, checking, err, secs, stage, progress, start } = draft;
  // the placeholder cycles through real examples from this industry (back to the first one when the industry changes)
  useEffect(() => { setHint(0); const t = setInterval(() => setHint((h) => (h + 1) % examples.length), 3500); return () => clearInterval(t); }, [examples]);
  const go = (e) => { e?.preventDefault(); if (prompt.trim().length >= 5 && !busy && !checking) start(prompt.trim(), lang, design); };
  const hour = new Date().getHours();
  return (
    <section className="lv-hero">
      <div className="lv-glow" aria-hidden="true" />
      <p className="lv-hi">{hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}{name ? `, ${name}` : ''}</p>
      {managedBy && <p className="lv-managed">You’re managing this account as {managedBy}</p>}
      <h1>What are you selling today?</h1>
      <p className="lv-sub">Describe it in a sentence. Hive AI drafts the whole funnel — sales page, checkout, upsell and thank-you.</p>
      {draft.asking && !busy ? <div className="lv-box lv-ask"><BriefQuestions draft={draft} /></div> : (
      <form className={`lv-box ${busy ? 'busy' : ''}`} onSubmit={go}>
        <textarea rows={2} value={prompt} disabled={busy} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) go(e); }} placeholder={`e.g. ${examples[hint % examples.length]}`} aria-label="Describe what you sell" />
        {busy ? (
          <div className="lv-busy"><span className="spin dark" /><b>{stage}…</b><small>{secs}s</small><div className="gen-progress"><i style={{ width: `${progress}%` }} /></div></div>
        ) : (
          <div className="lv-bar">
            <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Page language"><option value="en">English</option><option value="hi">हिन्दी</option></select>
            <button type="button" className={`lv-chip-link ${showDesign ? 'on' : ''}`} onClick={() => setShowDesign((v) => !v)} aria-expanded={showDesign}><Icon name="palette" size={14} /> Design</button>
            <Link className="lv-chip-link" to="/templates"><Icon name="layout" size={14} /> Templates</Link>
            <button className="lv-send" disabled={prompt.trim().length < 5 || checking} title="Draft my funnel (Enter)" aria-label="Draft my funnel">{checking ? <span className="spin" /> : <Icon name="chevron" size={18} className="up" />}</button>
          </div>
        )}
        {showDesign && !busy && <DesignPicker value={design} onChange={setDesign} />}
      </form>
      )}
      {err && <div className="err lv-err">{err}</div>}
      {!busy && !draft.asking && <div className="lv-chips">{chips.map((x) => <button key={x} type="button" onClick={() => setPrompt(x)}>{x}</button>)}</div>}
      {!aiEnabled && !busy && <p className="lv-note">AI is offline on this server — your description is matched to the closest of our templates.</p>}
      {showSample && !busy && <button className="linkish lv-sample" onClick={onSample} disabled={seeding}>{seeding ? 'Loading sample data…' : 'Or explore with sample data'}</button>}
    </section>
  );
}
// the business at a glance — a glance of the key numbers for the chosen period
function Ring({ pct }) {
  const r = 26, len = 2 * Math.PI * r, v = Math.max(0, Math.min(100, pct || 0));
  return (
    <svg viewBox="0 0 64 64" className="gl-ring" aria-hidden="true">
      <circle cx="32" cy="32" r={r} className="gl-ring-bg" />
      <circle cx="32" cy="32" r={r} className="gl-ring-fg" strokeDasharray={`${(len * v) / 100} ${len}`} />
    </svg>
  );
}
// the numbers the overview already has, for the industry tiles that use them
const BASE = {
  revenue: ['Revenue', (t) => inr(t.revenue), 'revenue', 'revenue'], orders: ['Orders', (t) => num(t.orders), 'orders', 'orders'], leads: ['Leads', (t) => num(t.leads), 'leads', 'leads'],
  visitors: ['Visitors', (t) => num(t.visitors), 'visitors', 'views'], conversion: ['Conversion', (t) => `${t.conversion}%`, 'conversion', null], aov: ['Avg. order value', (t) => inr(t.aov), 'aov', null],
};
// one tile of "Your business at a glance" (a number from the overview or from the industry's own counts)
function GlanceTile({ x, series }) {
  const body = (
    <>
      <span className="gl-l">{x.label}</span>
      {x.ring ? <div className="gl-row"><Ring pct={x.value} /><b className="gl-v">{x.shown}</b></div> : <b className="gl-v">{x.shown ?? num(x.value)}</b>}
      <div className="gl-f">{x.prev != null ? <Delta now={x.value} prev={x.prev} /> : null}{x.spark ? <Sparkline data={series} yKey={x.spark} /> : x.sub && <span className="gl-sub">{x.sub}</span>}</div>
    </>
  );
  return x.link ? <Link className={`gl gl-tap ${x.ring ? 'gl-conv' : ''}`} to={x.link}>{body}</Link> : <div className={`gl ${x.ring ? 'gl-conv' : ''}`}>{body}</div>;
}
// "Your business at a glance" — the tiles that matter in the seller's industry (dashkit.js), with an industry switch
function Bento({ data, funnels, days, setDays, kit, onKit }) {
  const t = data.totals, p = data.prev;
  const live = (funnels || []).filter((f) => f.published).length;
  const best = [...(data.funnels || [])].sort((a, b) => b.revenue - a.revenue)[0];
  const tiles = (kit?.tiles || [{ base: 'revenue' }, { base: 'orders' }, { base: 'leads' }, { base: 'visitors' }, { base: 'conversion' }, { base: 'aov' }]).map((x) => {
    if (!x.base) return x;
    const [label, fmt, key, spark] = BASE[x.base];
    return { id: x.base, label: x.label || label, shown: fmt(t), value: t[key], prev: p[key], spark, ring: x.base === 'conversion', link: x.base === 'orders' || x.base === 'revenue' ? '/orders' : x.base === 'leads' ? '/contacts' : null };
  });
  const [hero, ...rest] = tiles;
  return (
    <section className="lv-section">
      <div className="lv-head">
        <h2>Your business at a glance</h2>
        <span className="row" style={{ gap: 8 }}>
          {kit && <label className="gl-kit" title="Shows the numbers that matter in this industry">
            <KitIcon type={kit.industry.id} size={15} />
            <select value={kit.industry.id} onChange={(e) => onKit(e.target.value)} aria-label="Dashboard industry">{kit.industries.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select>
          </label>}
          <RangePicker value={days} onChange={setDays} />
        </span>
      </div>
      <div className="glance">
        <div className="gl gl-hero">
          <span className="gl-l">{hero.label} · last {days} days</span>
          <b className="gl-big">{hero.shown ?? num(hero.value)}</b>
          <div className="gl-f">{hero.prev != null && <Delta now={hero.value} prev={hero.prev} />}<span className="gl-sub">{hero.spark ? (kit?.sales === false ? `${num(t.visitors)} visitors · ${num(t.leads)} leads` : `${num(t.orders)} orders · ${inr(t.aov)} average`) : hero.sub}</span></div>
          {hero.spark && <div className="gl-chart"><Sparkline data={data.series} yKey={hero.spark} width={520} height={70} /></div>}
          {hero.link && !hero.spark && <Link className="gl-link" to={hero.link}>See them →</Link>}
        </div>
        {rest.map((x) => <GlanceTile key={x.id} x={x} series={data.series} />)}
        <div className="gl gl-honey">
          <span className="gl-l">Live funnels</span>
          <b className="gl-v">{live}<small> / {(funnels || []).length}</small></b>
          <Link className="gl-link" to="/funnels">Manage funnels →</Link>
        </div>
        {kit?.sales !== false && best && best.revenue > 0 && (
          <Link className="gl gl-best" to={`/funnels/${best.id}/analytics`}>
            <span className="gl-l">Best funnel</span>
            <b className="gl-name">{best.name}</b>
            <span className="gl-sub">{inr(best.revenue)} · {best.conversion}% conversion</span>
          </Link>
        )}
      </div>
    </section>
  );
}

// your funnels as preview cards (newest first)
function FunnelCards({ list }) {
  if (!list?.length) return null;
  return (
    <section className="lv-section">
      <div className="lv-head"><h2>Your funnels</h2><Link className="btn ghost sm" to="/funnels">View all</Link></div>
      <div className="lv-grid">
        {list.slice(0, 6).map((f) => (
          <Link key={f.id} to={`/funnels/${f.id}`} className="lv-card">
            <div className="lv-thumb">{f.hero ? <PagePreview block={f.hero} theme={f.theme} /> : <div className="fthumb-ph"><Icon name="layout" size={26} /></div>}</div>
            <div className="lv-meta"><b>{f.name}</b><span><i className={`dot ${f.published ? 'on' : ''}`} />{f.published ? 'Live' : 'Draft'} · edited {ago(f.updatedAt)}</span></div>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default function Dashboard() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [me, setMe] = useState(null);
  const [create, setCreate] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [funnels, setFunnels] = useState(null);
  const [kit, setKit] = useState(null); // the industry's tiles (dashkit.js)
  const load = () => { api(`/dashboard/industry?days=${days}`).then(setKit).catch(() => {}); api(`/analytics/overview?days=${days}`).then(setData); api('/me').then(setMe); api('/funnels').then(setFunnels).catch(() => setFunnels([])); };
  useEffect(() => { load(); }, [days]);
  const removeDemo = async () => {
    if (!await confirmDialog({ title: 'Remove all demo visits, leads and orders?', text: 'Your real data stays untouched.', confirm: 'Remove', danger: true })) return;
    await api('/demo', 'DELETE'); toast('Demo data removed'); load();
  };
  const pickKit = async (id) => { try { await api('/dashboard/industry', 'PUT', { id }); setKit(await api(`/dashboard/industry?days=${days}`)); toast('Dashboard switched'); } catch (e) { toast(e.message); } };
  const sales = kit?.sales !== false;
  const seed = async () => { setSeeding(true); await api('/demo/seed', 'POST'); setSeeding(false); toast('Demo data loaded — explore away!'); load(); };

  const ob = me?.onboarding;
  const checklist = ob && [
    ['Create your first funnel', ob.funnel, () => setCreate(true)],
    ['Publish it', ob.published, '/funnels'],
    ['Connect payments (Razorpay / Stripe)', ob.payments, '/settings'],
    ['Add Meta Pixel or Google Analytics', ob.tracking, '/settings'],
    ['Capture your first lead', ob.lead, '/funnels'],
  ];
  const doneCount = checklist?.filter((c) => c[1]).length || 0;
  const noData = data && !data.funnels.length;

  return (
    <Layout>
      <TalkToHive />
      {create && <CreateFunnel onClose={() => setCreate(false)} aiEnabled={me?.aiEnabled} />}
      <PromptHero name={me?.workspace ? me.workspace.name : me?.name?.split(' ')[0]} managedBy={me?.workspace ? me?.name?.split(' ')[0] : null} aiEnabled={me?.aiEnabled} onSample={seed} seeding={seeding} showSample={!!data && noData} industry={kit?.industry?.id || me?.nav?.industry} />
      {data && !noData && <Bento data={data} funnels={funnels} days={days} setDays={setDays} kit={kit} onKit={pickKit} />}
      <FunnelCards list={funnels} />
      {!data ? <div className="skeleton" /> : noData ? (
        <div className="lv-how">
          <ol className="how">
            <li><b>1</b><div><h4>Describe your offer</h4><p>“{promptsFor(kit?.industry?.id || me?.nav?.industry).examples[0]}”</p></div></li>
            <li><b>2</b><div><h4>Refine it</h4><p>Edit by hand, or ask: “add an upsell”</p></div></li>
            <li><b>3</b><div><h4>Publish</h4><p>On your domain, with checkout and analytics</p></div></li>
          </ol>
        </div>
      ) : (
        <>
          {checklist && doneCount < 5 && (
            <Panel className="onboard" title={`Get set up · ${doneCount}/5 done`} actions={!data.totals.views && <button className="btn ghost sm" onClick={seed} disabled={seeding}>{seeding ? 'Loading…' : 'Load demo data'}</button>}>
              <div className="ob-bar"><div style={{ width: `${doneCount * 20}%` }} /></div>
              <div className="ob-list">
                {checklist.map(([label, done, go]) => (
                  typeof go === 'string'
                    ? <Link key={label} to={go} className={`ob ${done ? 'done' : ''}`}><span className="ob-c">{done && <Icon name="check" size={13} />}</span>{label}</Link>
                    : <button key={label} onClick={go} className={`ob ${done ? 'done' : ''}`}><span className="ob-c">{done && <Icon name="check" size={13} />}</span>{label}</button>
                ))}
              </div>
            </Panel>
          )}
          {me?.hasDemo && (
            <div className="demo-banner"><Icon name="sparkles" size={16} /><span><b>You’re viewing demo data.</b> It’s here so you can explore the dashboards — remove it before you go live.</span><button className="btn ghost sm" onClick={removeDemo}><Icon name="trash" size={14} /> Remove demo data</button></div>
          )}
          <div className="lv-head lv-perf"><h2>Performance</h2></div>
          <div className="grid-2-1">
            <TrendPanel data={data} sales={sales} />
            {sales ? <Panel title="Revenue by offer type"><OfferMix byKind={data.byKind} /><p className="hint">Bumps, upsells & cross-sells lift your average order value.</p></Panel>
              : <Panel title="Where your visitors come from"><HBars format={num} items={(data.sources || []).slice(0, 6).map((x) => ({ label: x.source, value: x.views }))} /><p className="hint">Visitors by traffic source — put more into the ones that bring people in.</p></Panel>}
          </div>
          <div className="grid-2-1">
            <Panel title="Funnel results" actions={<Link className="btn ghost sm" to="/funnels">View all</Link>} pad={false}>
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Funnel</th><th className="r">Visitors</th>{sales ? <><th className="r">Orders</th><th className="r">Conv.</th><th className="r">Revenue</th></> : <><th className="r">Leads</th><th className="r">Lead rate</th></>}<th /></tr></thead>
                <tbody>{data.funnels.slice(0, 6).map((f) => (
                  <tr key={f.id}>
                    <td><Link to={`/funnels/${f.id}`} className="strong">{f.name}</Link> <span className={`pill ${f.published ? 'ok' : ''}`}>{f.published ? 'Live' : 'Draft'}</span></td>
                    <td className="r">{num(f.visitors)}</td>{sales ? <><td className="r">{num(f.orders)}</td><td className="r">{f.conversion}%</td><td className="r strong">{inr(f.revenue)}</td></> : <><td className="r strong">{num(f.leads)}</td><td className="r">{f.visitors ? `${Math.round(((f.leads || 0) / f.visitors) * 1000) / 10}%` : '—'}</td></>}
                    <td className="r"><Link className="icon-btn" to={`/funnels/${f.id}/analytics`} title="Analytics" aria-label="Analytics"><Icon name="chart" size={16} /></Link></td>
                  </tr>
                ))}</tbody>
              </table></div>
            </Panel>
            <Panel title="Traffic sources" pad={false}><div className="tbl-wrap"><Sources rows={data.sources} /></div></Panel>
          </div>
          <Panel title="Ad campaigns" pad={false}><Campaigns rows={data.campaigns} /></Panel>
          {sales && (
          <Panel title="Recent orders" actions={<Link className="btn ghost sm" to="/orders">All orders</Link>} pad={false}>
            {data.recentOrders.length ? (
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Customer</th><th>Funnel</th><th>Items</th><th className="r">Total</th><th className="r">When</th></tr></thead>
                <tbody>{data.recentOrders.map((o) => (
                  <tr key={o.id}><td><b>{o.name || '—'}</b><small className="sub-t">{o.email}</small></td><td>{o.funnel}</td><td className="items">{o.items.map((i, k) => <span key={k} className={`it k-${i.kind}`}>{i.kind === 'main' ? i.name : i.kind}</span>)}</td><td className="r strong">{inr(o.total)}</td><td className="r muted">{ago(o.at)}</td></tr>
                ))}</tbody>
              </table></div>
            ) : <Empty icon="cart" title="No orders yet" text="Publish a funnel and share the link — orders will show up here in real time." />}
          </Panel>
          )}
        </>
      )}
    </Layout>
  );
}
