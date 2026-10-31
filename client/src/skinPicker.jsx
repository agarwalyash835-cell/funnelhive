// Choose the dashboard's skin (skins.js): a miniature of each, and picking one repaints the app behind the dialog
// at once — Keep saves it (your own pick, or with onPick: the agency's default for its clients), Cancel puts back
// the one you had.
import { useState } from 'react';
import { SKIN_LIST, applySkin, currentSkin } from './skins';
import { t } from './appI18n';

// a tiny dashboard drawn in the skin's own colours and layout
export function SkinThumb({ s }) {
  const [bg, surface, accent, ink] = s.sw;
  return (
    <span className={`sk-thumb lay-${s.layout}`} style={{ '--k-bg': bg, '--k-surface': surface, '--k-accent': accent, '--k-ink': ink }} aria-hidden="true">
      <i className="sk-nav">{[0, 1, 2, 3].map((n) => <b key={n} className={n === 0 ? 'on' : ''} />)}</i>
      <i className="sk-body"><b className="sk-h" /><span className="sk-cards"><b /><b /><b /></span><b className="sk-wide" /></i>
      {s.dock && <i className="sk-dock" />}
    </span>
  );
}

// value: the skin chosen now ('' = the default); onPick(id): instead of trying it on this app, report the choice
export default function SkinPicker({ value, onPick, onClose, title }) {
  const before = currentSkin();
  const [pick, setPick] = useState(value || before);
  const choose = (id) => { setPick(id); if (!onPick) applySkin(id); };
  const cancel = () => { if (!onPick) applySkin(before); onClose(); };
  return (
    <div className="sk-picker">
      <p className="hint top">{title || t('Pick how your dashboard looks. It changes right away so you can see it — press Keep to save it for your login.')}</p>
      <div className="sk-grid" role="radiogroup" aria-label={t('Skins')}>
        {SKIN_LIST.map((s) => (
          <button type="button" key={s.id} role="radio" aria-checked={pick === s.id} className={`sk-card${pick === s.id ? ' on' : ''}`} onClick={() => choose(s.id)}>
            <SkinThumb s={s} />
            <b>{t(s.name)}</b>
            <small>{t(s.blurb)}</small>
          </button>
        ))}
      </div>
      <div className="row end">
        <button type="button" className="btn ghost" onClick={cancel}>{t('Cancel')}</button>
        <button type="button" className="btn primary" onClick={() => { (onPick || (() => {}))(pick); onClose(pick); }}>{t('Keep')}</button>
      </div>
    </div>
  );
}
