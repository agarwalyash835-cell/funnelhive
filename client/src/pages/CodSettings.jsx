import { useEffect, useState } from 'react';
import { api } from '../api';
import { Panel, toast } from '../ui';
import { t } from '../appI18n';
import '../cod.css';

// Settings → Cash on Delivery: confirmation, PIN codes and risk rules (server/cod.js). All off by default.
export function CodPanel() {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/settings/cod').then(setS).catch(() => setS(false)); }, []);
  if (!s) return null;
  const set = (p) => setS({ ...s, ...p });
  const save = async () => {
    setBusy(true);
    try { setS(await api('/settings/cod', 'PUT', { confirm: s.confirm, hours: Number(s.hours) || 24, pinMode: s.pinMode, pins: s.pins, noCod: s.noCod, maxCod: Number(s.maxCod) || 0, blockAfter: Number(s.blockAfter) || 0, prepaid: { mode: s.prepaid.mode, value: Number(s.prepaid.value) || 0, min: Number(s.prepaid.min) || 0 }, refusal: s.refusal, skipConfirm: s.skipConfirm })); toast(t('Settings saved')); } catch (e) { toast(e.message); }
    setBusy(false);
  };
  // a CSV of "pincode, cod" rows: every PIN code joins the list; "no" in the second column means no COD there
  const csv = async (file) => {
    if (!file) return;
    const text = await file.text();
    const pins = [], noCod = [];
    for (const line of text.split(/\r?\n/)) {
      const [pin, cod] = line.split(/[,;\t]/).map((x) => (x || '').trim());
      if (!/^[1-9][0-9x*-]{1,12}$/i.test(pin || '')) continue; // the header and blank lines
      pins.push(pin);
      if (/^(n|no|0|false|prepaid)/i.test(cod || '')) noCod.push(pin);
    }
    if (!pins.length) return toast(t('No PIN codes found in that file'));
    set({ pins: [s.pins, ...pins].filter(Boolean).join('\n'), noCod: [s.noCod, ...noCod].filter(Boolean).join('\n'), pinMode: s.pinMode === 'off' ? 'allow' : s.pinMode });
    toast(t('{n} PIN codes added — press Save', { n: pins.length }));
  };
  return (
    <Panel title={t('Cash on Delivery')}>
      <div className="cod-set">
        <label className="fcheck"><input type="checkbox" checked={s.confirm} onChange={(e) => set({ confirm: e.target.checked })} /><span><b>{t('Ask buyers to confirm COD orders')}</b><small className="muted"> · {t('WhatsApp (YES / NO reply or buttons) or email, with a confirm / cancel link')}</small></span></label>
        {s.confirm && <div className="cod-row"><label>{t('Mark “no reply” after')} <input type="number" min={1} max={168} value={s.hours} onChange={(e) => set({ hours: e.target.value })} /> {t('hours')}</label>
          {!s.confirmReady && <p className="hint">{t('The WhatsApp template “Cash on Delivery confirmation” isn’t approved yet (Settings → WhatsApp → set up templates). Until then buyers get buttons if they wrote to you in the last 24 hours, or an email.')}</p>}</div>}

        <h4>{t('Where you deliver')}</h4>
        <div className="seg cod-seg">{[['off', 'All India'], ['allow', 'Only these PIN codes'], ['except', 'All India except these']].map(([v, l]) => <button key={v} type="button" className={s.pinMode === v ? 'on' : ''} onClick={() => set({ pinMode: v })}>{t(l)}</button>)}</div>
        {s.pinMode !== 'off' && <textarea rows={4} value={s.pins} onChange={(e) => set({ pins: e.target.value })} placeholder={t('One per line or comma: 302017, 302xxx (prefix), 560001-560099 (range)')} />}
        <label className="cod-full">{t('No Cash on Delivery at these PIN codes')} <small className="muted">· {t('buyers there pay online')}</small><textarea rows={2} value={s.noCod} onChange={(e) => set({ noCod: e.target.value })} placeholder="194xxx, 744101" /></label>
        <label className="cod-csv">{t('Upload a CSV')} <small className="muted">· {t('columns: pincode, cod (yes / no)')}</small><input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => { csv(e.target.files?.[0]); e.target.value = ''; }} /></label>

        <h4>{t('Risk rules')}</h4>
        <div className="cod-row">
          <label>{t('Maximum COD order value (₹)')} <input type="number" min={0} value={s.maxCod || ''} placeholder={t('no limit')} onChange={(e) => set({ maxCod: e.target.value })} /></label>
          <label>{t('No COD for a number with')} <input type="number" min={0} max={20} value={s.blockAfter || ''} placeholder="0" onChange={(e) => set({ blockAfter: e.target.value })} /> {t('earlier unconfirmed / cancelled / returned COD orders (0 = off)')}</label>
        </div>

        <h4>{t('Advance to confirm (partial prepaid)')}</h4>
        <div className="seg cod-seg">{[['off', 'Off'], ['flat', 'Fixed amount'], ['percent', 'Percentage']].map(([v, l]) => <button key={v} type="button" className={s.prepaid.mode === v ? 'on' : ''} onClick={() => set({ prepaid: { ...s.prepaid, mode: v } })}>{t(l)}</button>)}</div>
        {s.prepaid.mode !== 'off' && <>
          <div className="cod-row">
            {s.prepaid.mode === 'flat'
              ? <label>{t('Advance (₹)')} <input type="number" min={1} value={s.prepaid.value || ''} placeholder="99" onChange={(e) => set({ prepaid: { ...s.prepaid, value: e.target.value } })} /></label>
              : <><label>{t('Advance (% of the order)')} <input type="number" min={1} max={99} value={s.prepaid.value || ''} placeholder="10" onChange={(e) => set({ prepaid: { ...s.prepaid, value: e.target.value } })} /></label>
                <label>{t('At least (₹)')} <input type="number" min={0} value={s.prepaid.min || ''} placeholder="49" onChange={(e) => set({ prepaid: { ...s.prepaid, min: e.target.value } })} /></label></>}
          </div>
          <label className="cod-full">{t('If the buyer refuses the delivery or cancels')}
            <select value={s.refusal} onChange={(e) => set({ refusal: e.target.value })}>
              <option value="refund">{t('Refund the advance automatically')}</option>
              <option value="keep">{t('Keep it as a non-refundable booking fee')}</option>
            </select></label>
          {s.refusal === 'keep' && <p className="hint">{t('Buyers must tick that the advance is non-refundable before they pay. A kept booking fee may attract GST — check with your CA. If you cancel an order yourself, the advance is always refunded.')}</p>}
          <label className="fcheck"><input type="checkbox" checked={s.skipConfirm} onChange={(e) => set({ skipConfirm: e.target.checked })} /><span><b>{t('Orders with the advance paid count as confirmed')}</b><small className="muted"> · {t('no confirmation message for them')}</small></span></label>
          <p className="hint">{t('Buyers who choose COD pay the advance online (Razorpay or Stripe) and the rest on delivery; the courier collects only the rest. Needs online payments connected — without them COD works as before. One GST invoice for the full value is issued on delivery.')}</p>
        </>}
        <button className="btn primary" disabled={busy} onClick={save}>{busy ? t('Saving…') : t('Save')}</button>
      </div>
    </Panel>
  );
}
