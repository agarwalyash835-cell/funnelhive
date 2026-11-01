// Studio → a Reel (server studio/reels.js): edit and approve the script, watch the shots and voiceover lines being made
// and checked, then play, download and change the finished video (caption style, sizes, a line, a shot).
import { useState } from 'react';
import { api } from '../api';
import { Modal, Icon, toast, promptDialog } from '../ui';

const STAGE = { script_ready: 'Script ready — check it and approve', producing: 'Making the shots and voiceover…', editing: 'Putting it together…', ready: 'Ready', needs_review: 'Ready — needs a look', failed: 'Couldn’t be finished' };
const STEP = { queued: 'Queued', rendering: 'Rendering', checking: 'Checking', ready: 'Done', needs_review: 'Needs a look', failed: 'Failed' };
const SIZES = [['9:16', 'Reels / Shorts'], ['1:1', 'Square'], ['4:5', 'Feed'], ['16:9', 'Wide']];

export function ReelView({ r, styles, onClose, onChange }) {
  const [s, setS] = useState(r.script);
  const [size, setSize] = useState(Object.keys(r.outputs || {})[0] || '9:16');
  const [busy, setBusy] = useState(false);
  const act = async (fn, msg) => { setBusy(true); try { await fn(); if (msg) toast(msg); onChange(); } catch (e) { toast(e.message); } setBusy(false); };
  const editing = r.status === 'script_ready';
  const made = ['ready', 'needs_review', 'failed'].includes(r.status);
  const setLine = (i, text) => setS({ ...s, lines: s.lines.map((l, j) => (j === i ? text : l)) });
  const setShot = (i, p) => setS({ ...s, shots: s.shots.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const change = (body, msg) => act(() => api(`/studio/reels/${r.id}`, 'PUT', body), msg);
  const reword = async (i) => { const text = await promptDialog({ title: `Line ${i + 1}`, label: 'New words', value: r.lines[i].text }); if (text && text !== r.lines[i].text) change({ lines: [{ i, text }] }, 'That line will be spoken again, then the Reel re-edited'); };
  const redoShot = async (i) => { const note = await promptDialog({ title: `Redo shot ${i + 1}`, text: 'What should change? (optional)', label: 'Change', value: '' }); if (note !== null && note !== undefined) change({ shots: [{ i, note }] }, 'Redoing that shot, then re-editing'); };

  return (
    <Modal title={r.title} onClose={onClose} width={900}>
      <div className="m-body rl">
        <p className={`rl-stage st-${r.status}`}><b>{STAGE[r.status] || r.status}</b>{r.error ? ` — ${r.error}` : ''}</p>
        {r.issues?.length > 0 && <ul className="st-issues">{r.issues.map((x) => <li key={x}>{x}</li>)}</ul>}

        {made && r.outputs && (
          <div className="rl-out">
            <video key={r.outputs[size]} src={r.outputs[size]} poster={r.poster || undefined} controls playsInline style={{ aspectRatio: size.replace(':', ' / ') }} />
            <div className="rl-side">
              <span className="seg sm">{Object.keys(r.outputs).map((k) => <button key={k} type="button" className={size === k ? 'on' : ''} onClick={() => setSize(k)}>{k}</button>)}</span>
              <a className="btn ghost sm" href={r.outputs[size]} download><Icon name="download" size={13} /> Download {size}</a>
              <button className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(r.links?.[size] || ''); toast('Link copied — paste it in your ad, or ask Hive to put it in an ad'); }}><Icon name="link" size={13} /> Copy link for ads</button>
              <label>Captions<select value={r.captions?.style || 'none'} disabled={busy} onChange={(e) => change({ captions: e.target.value === 'none' ? null : { style: e.target.value } }, 'Re-editing with the new captions')}>{styles.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}<option value="none">No captions</option></select></label>
              <div className="rl-sizes"><span className="muted sm">Sizes</span>{SIZES.map(([k, l]) => { const on = r.sizes.includes(k); return <label key={k} className="row"><input type="checkbox" checked={on} disabled={busy || (on && r.sizes.length === 1)} onChange={() => change({ sizes: on ? r.sizes.filter((x) => x !== k) : [...r.sizes, k] }, 'Re-editing in those sizes')} />{k} · {l}</label>; })}</div>
            </div>
          </div>
        )}

        <h4 className="pt-h4">Voiceover</h4>
        <ol className="rl-lines">{(editing ? s.lines : r.lines.map((l) => l.text)).map((text, i) => {
          const l = r.lines[i];
          return (
            <li key={i}>
              {editing ? <textarea rows={2} maxLength={220} value={text} onChange={(e) => setLine(i, e.target.value)} /> : <span>{text}</span>}
              {!editing && l && <small className="muted">{l.url ? (l.check && !l.check.ok ? `⚠ ${l.check.issues.join('; ')}` : '✓ checked') : l.error ? `⚠ ${l.error}` : l.tries ? `redoing (try ${l.tries + 1})…` : 'waiting…'}</small>}
              {!editing && l?.url && <audio src={l.url} controls preload="none" />}
              {made && <button className="btn ghost sm" disabled={busy} onClick={() => reword(i)}>Reword</button>}
            </li>
          );
        })}</ol>

        <h4 className="pt-h4">Shots</h4>
        <div className="rl-shots">{(editing ? s.shots : r.shots).map((x, i) => {
          const sh = r.shots?.[i], step = sh?.clip?.status || sh?.image?.status;
          return (
            <div key={i} className="rl-shot">
              {!editing && (sh?.clip?.url ? <video src={sh.clip.url} poster={sh.clip.poster || undefined} muted playsInline controls preload="none" /> : sh?.image?.url ? <img src={sh.image.url} alt="" /> : <span className="spin dark" />)}
              {editing ? (
                <>
                  <label>Picture<textarea rows={2} maxLength={600} value={x.image} onChange={(e) => setShot(i, { image: e.target.value })} /></label>
                  <label>Movement<input maxLength={300} value={x.motion} onChange={(e) => setShot(i, { motion: e.target.value })} /></label>
                </>
              ) : <small className="muted">Shot {i + 1} · {STEP[step] || 'Queued'}{sh?.clip?.issues?.length ? ` — ${sh.clip.issues.join('; ')}` : ''}</small>}
              {made && <button className="btn ghost sm" disabled={busy} onClick={() => redoShot(i)}>Redo shot</button>}
            </div>
          );
        })}</div>

        <h4 className="pt-h4">Closing card</h4>
        {editing ? (
          <div className="form2">
            {[['headline', 'Headline', 40], ['offer', 'Offer / price', 40], ['cta', 'Call to action', 30]].map(([k, l, n]) => <label key={k} className="fld"><span>{l}</span><input maxLength={n} value={s.endCard?.[k] || ''} onChange={(e) => setS({ ...s, endCard: { ...s.endCard, [k]: e.target.value } })} /></label>)}
          </div>
        ) : <p className="sm">{[r.script.endCard?.headline, r.script.endCard?.offer, r.script.endCard?.cta].filter(Boolean).join(' · ') || 'None'}</p>}

        {editing && (
          <div className="m-foot">
            <button className="btn ghost" disabled={busy} onClick={() => act(() => api(`/studio/reels/${r.id}/script`, 'PUT', { script: s }), 'Script saved')}>Save script</button>
            <button className="btn primary" disabled={busy} onClick={() => act(() => api(`/studio/reels/${r.id}/approve`, 'POST', { script: s }), 'Making your Reel — this takes several minutes')}><Icon name="play" size={14} /> Approve and make it</button>
          </div>
        )}
      </div>
    </Modal>
  );
}
