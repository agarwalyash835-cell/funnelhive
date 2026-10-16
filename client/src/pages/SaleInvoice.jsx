// A GST invoice (or credit note) a seller issued to a buyer — opened from the buyer's email or library.
import { Fragment, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { inWords } from './Invoice';

const SYM = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AUD: 'A$', CAD: 'C$', SGD: 'S$', AED: 'AED ' };
let CUR = 'INR';
const money = (n) => `${SYM[CUR] || `${CUR} `}${Number(n || 0).toLocaleString(CUR === 'INR' ? 'en-IN' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (t) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export default function SaleInvoice() {
  const { id } = useParams();
  const [qs] = useSearchParams();
  const [i, setI] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    fetch(`/api/public/invoices/${id}?k=${encodeURIComponent(qs.get('k') || '')}`).then(async (r) => { const d = await r.json(); r.ok ? setI(d) : setErr(d.error || 'Invoice not found'); });
  }, [id]);
  useEffect(() => { if (i) document.title = `${i.type === 'credit' ? 'Credit note' : 'Invoice'} ${i.number}`; }, [i]);
  if (err) return <div className="inv-page"><p className="err">{err}</p></div>;
  if (!i) return <div className="inv-page"><div className="skeleton" /></div>;
  CUR = i.currency || 'INR';
  const s = i.seller || {}, b = i.billedTo || {};
  const credit = i.type === 'credit';
  const cols = i.registered ? 4 : 1;
  // tax per rate (invoices from before per-line rates: one rate for the whole invoice)
  const rates = i.rates || [{ rate: i.rate, taxable: i.taxable, cgst: i.cgst, sgst: i.sgst, igst: i.igst }];
  return (
    <div className="inv-page">
      <div className="inv-tools no-print"><span /><button className="btn primary sm" onClick={() => window.print()}>Download PDF / Print</button></div>
      <article className="invoice">
        <header className="inv-h">
          <div><h1>{credit ? 'Credit Note' : i.registered ? 'Tax Invoice' : 'Invoice'}</h1><p className="muted">{i.number}</p>{credit && i.against && <p className="muted sm">Against invoice {i.against}</p>}</div>
          <div className="inv-from"><b>{s.name}</b>{s.address && <span>{s.address}</span>}{s.state && <span>{s.state}{s.stateCode ? ` (${s.stateCode})` : ''}</span>}{s.gstin && <span>GSTIN: {s.gstin}</span>}{s.email && <span>{s.email}</span>}</div>
        </header>
        <section className="inv-meta">
          <div><small>Billed to</small><b>{b.name || b.email}</b>{b.name && b.person && b.person !== b.name && <span>Attn: {b.person}</span>}{b.email && <span>{b.email}</span>}{b.phone && <span>{b.phone}</span>}{b.gstin && <span>GSTIN: {b.gstin}</span>}{b.state && <span>{b.state}{b.stateCode ? ` (${b.stateCode})` : ''}</span>}</div>
          <div><small>{credit ? 'Date' : 'Invoice date'}</small><b>{day(i.at)}</b>{i.registered && <><small>Place of supply</small><span>{i.placeOfSupply || '—'}</span></>}{i.paymentId && <><small>Payment</small><span className="mono">{i.paymentId}</span></>}</div>
        </section>
        <table className="inv-t">
          <thead><tr><th>Description</th>{i.registered && <><th>HSN/SAC</th><th className="r">GST</th><th className="r">Taxable value</th></>}<th className="r">Amount</th></tr></thead>
          <tbody>{i.items.map((l, k) => <tr key={k}><td>{l.name}</td>{i.registered && <><td>{l.sac}</td><td className="r">{l.rate ?? i.rate}%</td><td className="r">{money(l.taxable)}</td></>}<td className="r">{money(l.amount)}</td></tr>)}</tbody>
          <tfoot>
            {i.registered && <tr><td colSpan={cols}>Taxable value</td><td className="r">{money(i.taxable)}</td></tr>}
            {i.registered && rates.map((r) => (i.intra ? <Fragment key={r.rate}>
              <tr><td colSpan={cols}>CGST @ {r.rate / 2}%{rates.length > 1 ? ` on ${money(r.taxable)}` : ''}</td><td className="r">{money(r.cgst)}</td></tr>
              <tr><td colSpan={cols}>SGST @ {r.rate / 2}%{rates.length > 1 ? ` on ${money(r.taxable)}` : ''}</td><td className="r">{money(r.sgst)}</td></tr>
            </Fragment> : <tr key={r.rate}><td colSpan={cols}>IGST @ {r.rate}%{rates.length > 1 ? ` on ${money(r.taxable)}` : ''}</td><td className="r">{money(r.igst)}</td></tr>))}
            <tr className="tot"><td colSpan={cols}>{credit ? 'Total refunded' : 'Total paid'}</td><td className="r">{money(i.total)}</td></tr>
          </tfoot>
        </table>
        {CUR === 'INR' ? <p className="inv-words">{inWords(i.total)}</p> : <p className="inv-words">Amounts in {CUR}{i.fx ? ` · ≈ ₹${Math.round(i.total * i.fx).toLocaleString('en-IN')} at ₹${i.fx}/${CUR}` : ''}</p>}
        {i.export && <p className="inv-words">{i.lut ? 'Supply meant for export under LUT without payment of IGST.' : 'Export of services with payment of IGST.'}</p>}
        <footer className="inv-f">{i.registered ? 'This is a computer-generated document and does not need a signature.' : 'GST is not charged: the supplier is not registered under GST.'}</footer>
      </article>
    </div>
  );
}
