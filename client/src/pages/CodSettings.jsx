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
    try { setS(await api('/settings/cod', 'PUT', { confirm: s.confirm, hours: Number(s.hours) || 24, pinMode: s.pinMode, pins: s.pins, noCod: s.noCod, maxCod: Number(s.maxCod) || 0, blockAfter: Number(s.blockAfter) || 0 })); toast(t('Settings saved')); } catch (e) { toast(e.message); }
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
        <p className="hint">{t('Partial prepaid (a token paid online, the rest on delivery) isn’t available yet.')}</p>
        <button className="btn primary" disabled={busy} onClick={save}>{busy ? t('Saving…') : t('Save')}</button>
      </div>
    </Panel>
  );
}
