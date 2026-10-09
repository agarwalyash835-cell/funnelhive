import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, fmtDate } from '../api';
import { Icon } from '../ui';

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// ₹1,499 → "One thousand four hundred ninety-nine rupees only" (Indian numbering)
export function inWords(n) {
  const a = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const b = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const two = (x) => (x < 20 ? a[x] : `${b[Math.floor(x / 10)]}${x % 10 ? `-${a[x % 10]}` : ''}`);
  const three = (x) => (x >= 100 ? `${a[Math.floor(x / 100)]} hundred${x % 100 ? ` ${two(x % 100)}` : ''}` : two(x));
  let r = Math.floor(n), out = [];
  for (const [v, w] of [[1e7, 'crore'], [1e5, 'lakh'], [1e3, 'thousand']]) if (r >= v) { out.push(`${three(Math.floor(r / v))} ${w}`); r %= v; }
  if (r) out.push(three(r));
  const p = Math.round((n - Math.floor(n)) * 100);
  const s = `${out.join(' ') || 'zero'} rupees${p ? ` and ${two(p)} paise` : ''} only`;
  return s[0].toUpperCase() + s.slice(1);
}

export default function Invoice({ admin }) {
  const { id } = useParams();
  const [i, setI] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api(`${admin ? '/admin' : '/billing'}/invoices/${id}`).then(setI).catch((e) => setErr(e.message)); }, [id, admin]);
  if (err) return <div className="inv-page"><p className="err">{err}</p></div>;
  if (!i) return <div className="inv-page"><div className="skeleton" /></div>;
  const c = i.company || {}, t = i.billedTo || {};
  const intra = i.cgst > 0;
  return (
    <div className="inv-page">
      <div className="inv-tools no-print">
        <Link className="btn ghost sm" to={admin ? '/admin?tab=invoices' : '/billing'}><Icon name="chevron" className="flip" size={15} /> Back</Link>
        <button className="btn primary sm" onClick={() => window.print()}><Icon name="download" size={15} /> Download PDF / Print</button>
      </div>
      <article className="invoice">
        <header className="inv-h">
          <div><h1>{i.registered ? 'Tax Invoice' : 'Invoice'}</h1><p className="muted">{i.number}</p></div>
          <div className="inv-from"><b>{c.name || i.brand}</b>{c.address && <span>{c.address}</span>}{c.state && <span>{c.state}{c.stateCode ? ` (${c.stateCode})` : ''}</span>}{c.gstin && <span>GSTIN: {c.gstin}</span>}{c.email && <span>{c.email}</span>}</div>
        </header>
        <section className="inv-meta">
          <div><small>Billed to</small><b>{t.name}</b><span>{t.email}</span>{t.address && <span>{t.address}</span>}{t.state && <span>{t.state}{t.stateCode ? ` (${t.stateCode})` : ''}</span>}{t.gstin && <span>GSTIN: {t.gstin}</span>}</div>
          <div><small>Invoice date</small><b>{fmtDate(i.at)}</b><small>Period</small><span>{fmtDate(i.period?.from)} – {fmtDate(i.period?.to)}</span>{i.registered && <><small>Place of supply</small><span>{t.state || '—'}</span></>}{i.paymentId && <><small>Payment</small><span className="mono">{i.paymentId}</span></>}</div>
        </section>
        <table className="inv-t">
          <thead><tr><th>Description</th>{i.registered && <th>SAC</th>}<th className="r">Amount</th></tr></thead>
          <tbody><tr><td>{i.item}</td>{i.registered && <td>998314</td>}<td className="r">{money(i.taxable)}</td></tr></tbody>
          <tfoot>
            {i.registered && (intra ? <>
              <tr><td colSpan={2}>CGST @ {i.rate / 2}%</td><td className="r">{money(i.cgst)}</td></tr>
              <tr><td colSpan={2}>SGST @ {i.rate / 2}%</td><td className="r">{money(i.sgst)}</td></tr>
            </> : <tr><td colSpan={2}>IGST @ {i.rate}%</td><td className="r">{money(i.igst)}</td></tr>)}
            <tr className="tot"><td colSpan={i.registered ? 2 : 1}>Total paid</td><td className="r">{money(i.total)}</td></tr>
          </tfoot>
        </table>
        <p className="inv-words">{inWords(i.total)}</p>
        <footer className="inv-f">{i.registered ? 'This is a computer-generated invoice and does not need a signature.' : 'GST is not charged: the supplier is not registered under GST.'} · Paid via Razorpay</footer>
      </article>
    </div>
  );
}
