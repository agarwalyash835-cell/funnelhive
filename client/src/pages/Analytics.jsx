import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { Layout, Panel, Icon, Empty, RangePicker, inr, num, ago, downloadCSV, loadFailed } from '../ui';
import { Kpis, TrendPanel, OfferMix, Sources, Campaigns } from './Dashboard';
import { StepIcon } from '../blockIcons';

const pct = (a, b) => (b ? +((a / b) * 100).toFixed(1) : 0);

const POP_TRIGGER = { exit: 'Leaving the page', delay: 'After a delay', scroll: 'Scrolling down', click: 'A button click', load: 'Page load' };

export default function Analytics() {
  const { id } = useParams();
  const [days, setDays] = useState(30);
  const [d, setD] = useState(null);
  const [f, setF] = useState(null);
  useEffect(() => { api(`/funnels/${id}/analytics?days=${days}`).then(setD).catch(loadFailed); }, [id, days]);
  useEffect(() => { api(`/funnels/${id}`).then(setF).catch(loadFailed); }, [id]);
  const top = d ? Math.max(1, ...d.steps.map((s) => s.views)) : 1;
  const offerSteps = d?.steps.filter((s) => s.type === 'upsell' || s.type === 'downsell') || [];
  const abSteps = d?.steps.filter((s) => s.ab) || [];
  const popSteps = d?.steps.filter((s) => s.popups?.length) || [];
  const quizzes = d?.steps.flatMap((s) => (s.quizzes || []).map((qz) => ({ ...qz, page: s.name }))) || [];

  return (
    <Layout title={f ? f.name : 'Analytics'} subtitle="Funnel analytics" actions={<>
      <RangePicker value={days} onChange={setDays} />
      <Link className="btn ghost" to={`/funnels/${id}`}><Icon name="edit" size={16} /> Edit funnel</Link>
    </>}>
      {!d ? <div className="skeleton" /> : (
        <>
          <Kpis data={d} />
          <div className="grid-2-1">
            <TrendPanel data={d} />
            <Panel title="Offer performance">
              <div className="mini-kpis">
                <div><b>{d.bumpRate}%</b><small>order-bump take rate</small></div>
                {offerSteps.map((s) => <div key={s.id}><b>{pct(s.conversions, s.views)}%</b><small>{s.name} take rate</small></div>)}
              </div>
              <OfferMix byKind={d.byKind} />
            </Panel>
          </div>
          <Panel title="Funnel flow" actions={<span className="muted sm">Visitors reaching each step · conversion to the next action</span>}>
            {!d.steps.some((s) => s.views) ? <Empty icon="chart" title="No visits yet" text="Publish the funnel and share the link. Every view, click and sale shows up here." /> : (
              <div className="flowbars">
                {d.steps.map((s, i) => (
                  <div className="fb" key={s.id}>
                    <div className="fb-name"><span><StepIcon type={s.type} size={16} /></span><div><b>{s.name}</b><small>{s.type}</small></div></div>
                    <div className="fb-track"><div style={{ width: `${(s.views / top) * 100}%` }}><span>{num(s.views)}</span></div></div>
                    <div className="fb-rate">{s.type === 'thankyou' ? <small>end</small> : <><b>{pct(s.conversions, s.views)}%</b><small>{num(s.conversions)} converted</small></>}</div>
                    {i < d.steps.length - 1 && <div className="fb-drop">↓ {s.views ? `${Math.max(0, 100 - pct(d.steps[i + 1].views, s.views)).toFixed(0)}% drop-off` : ''}</div>}
                  </div>
                ))}
              </div>
            )}
          </Panel>
          {abSteps.length > 0 && (
            <Panel title="A/B split tests" pad={false}>
              <table className="tbl">
                <thead><tr><th>Step</th><th>Variant</th><th className="r">Visitors</th><th className="r">Conversions</th><th className="r">Conv. rate</th><th>Result</th></tr></thead>
                <tbody>{abSteps.flatMap((s) => {
                  const r = s.ab.result;
                  const verdict = r.status === 'collecting'
                    ? <span className="muted sm">Collecting data — need 100+ visitors & 10+ conversions per variant</span>
                    : r.winner
                      ? <span className="pill ok">Variant {r.winner} wins · {r.confidence}% confidence{r.uplift != null && ` · ${r.uplift > 0 ? '+' : ''}${r.uplift}% vs A`}</span>
                      : <span className="muted sm">No clear winner yet · {r.confidence}% confidence (need 95%) — keep the test running</span>;
                  return ['A', 'B'].map((v) => (
                    <tr key={s.id + v}><td>{v === 'A' && <b>{s.name}</b>}</td><td><span className={`pill ${r.winner === v ? 'ok' : ''}`}>{v}</span></td><td className="r">{num(s.ab[v].views)}</td><td className="r">{num(s.ab[v].conversions)}</td><td className="r strong">{v === 'A' ? r.rateA : r.rateB}%</td><td>{v === 'A' && verdict}</td></tr>
                  ));
                })}</tbody>
              </table>
            </Panel>
          )}
          {popSteps.length > 0 && (
            <Panel title="Pop-ups" pad={false} actions={<span className="muted sm">Times shown · sign-ups from the pop-up</span>}>
              <table className="tbl">
                <thead><tr><th>Pop-up</th><th>Page</th><th>Opens on</th><th className="r">Shown</th><th className="r">People</th><th className="r">Sign-ups</th><th className="r">Rate</th></tr></thead>
                <tbody>{popSteps.flatMap((s) => s.popups.map((p) => (
                  <tr key={s.id + p.id}><td><b>{p.name}</b></td><td>{s.name}</td><td className="muted">{POP_TRIGGER[p.trigger] || p.trigger}</td><td className="r">{num(p.views)}</td><td className="r">{num(p.visitors)}</td><td className="r">{num(p.signups)}</td><td className="r strong">{p.views ? `${p.rate}%` : '—'}</td></tr>
                )))}</tbody>
              </table>
            </Panel>
          )}
          {quizzes.map((qz) => <QuizReport key={qz.id} qz={qz} />)}
          <Panel title="Ad campaigns" pad={false}><Campaigns rows={d.campaigns} /></Panel>
          <div className="grid-1-1">
            <Panel title="Traffic sources" pad={false}><Sources rows={d.sources} /></Panel>
            <Panel title="Recent leads" pad={false} actions={d.leads.length > 0 && <button className="btn ghost sm" onClick={() => downloadCSV('leads.csv', d.leads.map(({ email, name, phone, source, at }) => ({ email, name, phone, source, date: new Date(at).toISOString() })))}><Icon name="download" size={15} /> CSV</button>}>
              {d.leads.length ? (
                <table className="tbl compact"><thead><tr><th>Contact</th><th>Source</th><th className="r">When</th></tr></thead>
                  <tbody>{d.leads.slice(0, 8).map((l) => <tr key={l.id}><td><b>{l.name || '—'}</b><small className="sub-t">{l.email}</small></td><td><span className="src">{l.source}</span></td><td className="r muted">{ago(l.at)}</td></tr>)}</tbody></table>
              ) : <Empty icon="users" title="No leads yet" />}
            </Panel>
          </div>
          <Panel title="Recent orders" pad={false}>
            {d.orders.length ? (
              <table className="tbl"><thead><tr><th>Customer</th><th>Items</th><th>Coupon</th><th className="r">Total</th><th className="r">When</th></tr></thead>
                <tbody>{d.orders.slice(0, 12).map((o) => <tr key={o.id}><td><b>{o.name || '—'}</b><small className="sub-t">{o.email}</small></td><td className="items">{o.items.map((i, k) => <span key={k} className={`it k-${i.kind}`}>{i.kind === 'main' ? i.name : i.kind}</span>)}</td><td>{o.coupon ? <span className="pill">{o.coupon}</span> : <span className="muted">—</span>}</td><td className="r strong">{inr(o.total)}</td><td className="r muted">{ago(o.at)}</td></tr>)}</tbody></table>
            ) : <Empty icon="cart" title="No orders yet" />}
          </Panel>
        </>
      )}
    </Layout>
  );
}

// a quiz: how many start, where people drop off, and which results they get
function QuizReport({ qz }) {
  const top = Math.max(1, qz.started);
  const outTotal = Math.max(1, qz.finished);
  return (
    <Panel title={`Quiz · ${String(qz.title).replace(/\*/g, '')}`} actions={<span className="muted sm">{qz.page} · {num(qz.started)} started · {num(qz.finished)} finished ({qz.rate}%)</span>}>
      <div className="quiz-rep">
        <div>
          <h4>Drop-off by question</h4>
          {qz.questions.map((x, i) => {
            const prev = i ? qz.questions[i - 1].answered : qz.started;
            const lost = prev ? Math.max(0, Math.round(((prev - x.answered) / prev) * 100)) : 0;
            return (
              <div className="qr-row" key={i}>
                <span className="qr-l" title={x.q}>Q{i + 1}. {x.q}</span>
                <span className="qr-bar"><i style={{ width: `${Math.round((x.answered / top) * 100)}%` }} /></span>
                <span className="qr-n">{num(x.answered)}{i > 0 || qz.started ? <small className={lost >= 25 ? 'bad-t' : 'muted'}> −{lost}%</small> : null}</span>
              </div>
            );
          })}
          <div className="qr-row"><span className="qr-l"><b>Gave their details</b></span><span className="qr-bar"><i className="ok" style={{ width: `${Math.round((qz.finished / top) * 100)}%` }} /></span><span className="qr-n">{num(qz.finished)}</span></div>
        </div>
        <div>
          <h4>Results</h4>
          {qz.outcomes.map((o, i) => (
            <div className="qr-row" key={i}><span className="qr-l">{o.title}</span><span className="qr-bar"><i className="alt" style={{ width: `${Math.round((o.n / outTotal) * 100)}%` }} /></span><span className="qr-n">{num(o.n)} <small className="muted">{Math.round((o.n / outTotal) * 100)}%</small></span></div>
          ))}
        </div>
      </div>
    </Panel>
  );
}
