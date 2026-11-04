// Studio → a Reel's presenter (server studio/presenter.js): which scenes are a person speaking the line to camera
// (testimonial, UGC, a founder — lip-synced to the voiceover in any language), and whose face it is: an invented person
// drawn for each scene, one of the seller's Studio images, or their own photo — never a celebrity. Shows the preview and
// what the presenter scenes cost before anything is made. Self-contained: <PresenterPicker reel={reel} onChange={setReel} />
// (onChange gets the updated Reel from the server).
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { Icon, toast } from '../../ui';

const EDITABLE = ['script_ready', 'storyboard_ready'];
const STYLES = [['testimonial', 'Testimonial'], ['ugc', 'UGC'], ['founder', 'Founder']];
const toDataUrl = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
const box = { border: '1px solid var(--c-line)', borderRadius: 14, padding: 14, background: 'var(--c-surface)', display: 'grid', gap: 12 };
const thumb = (on) => ({ width: 56, height: 72, objectFit: 'cover', borderRadius: 10, border: `2px solid ${on ? 'var(--c-ink)' : 'var(--c-line)'}`, padding: 0, cursor: 'pointer', background: 'var(--c-surface-2)' });

export default function PresenterPicker({ reel, onChange }) {
  const [busy, setBusy] = useState(false);
  const [images, setImages] = useState(null);
  const file = useRef(null);
  const editable = EDITABLE.includes(reel?.status);
  const shots = reel?.script?.shots || [];
  const on = shots.map((s) => s.type === 'presenter');
  const face = reel?.presenter?.image || null;
  const cost = reel?.cost?.presenter || null;

  // the seller's ready Studio images, to pick an invented person they already made
  useEffect(() => {
    if (!editable || images) return;
    api('/studio').then((d) => setImages((d.assets || []).filter((a) => a.kind === 'image' && a.url && ['ready', 'needs_review'].includes(a.status)).slice(0, 12))).catch(() => setImages([]));
  }, [editable, images]);

  const save = async (body) => {
    setBusy(true);
    try { onChange?.(await api(`/studio/reels/${reel.id}/presenter`, 'POST', body)); } catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  const toggle = (i) => save({ scenes: on.map((x, k) => (k === i ? !x : x)).flatMap((x, k) => (x ? [k] : [])) });
  const upload = async (f) => {
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) return toast('Pick a photo under 10 MB');
    setBusy(true);
    try { const r = await api('/uploads', 'POST', { type: f.type, data: await toDataUrl(f) }); await save({ face: { image: r.url } }); } catch (e) { toast(e.message); setBusy(false); }
  };

  if (!reel?.script) return null;
  return (
    <div style={box}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="mic" />
        <strong>Presenter</strong>
        <span style={{ color: 'var(--c-ink-3)', fontSize: 13 }}>A person speaks your voiceover to the camera, lips in sync</span>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {STYLES.map(([id, name]) => (
          <button key={id} type="button" className={`sx-chip${(reel.presenter?.style || '') === id ? ' on' : ''}`} disabled={!editable || busy} onClick={() => save({ style: id })}>{name}</button>
        ))}
      </div>

      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Scenes with the presenter talking</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {shots.map((s, i) => (
            <button key={i} type="button" className={`sx-chip${on[i] ? ' on' : ''}`} disabled={!editable || busy} onClick={() => toggle(i)} title={reel.script.lines?.[i] || s.image}>
              Scene {i + 1}{on[i] ? ' · talking' : ''}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Who presents</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" style={{ ...thumb(!face), display: 'grid', placeItems: 'center', fontSize: 11, color: 'var(--c-ink-2)' }} disabled={!editable || busy} onClick={() => save({ face: null })} title="An invented person, drawn for each scene">
            <Icon name="sparkles" size={16} />
          </button>
          {(images || []).map((a) => (
            <button key={a.id} type="button" style={thumb(face === a.url)} disabled={!editable || busy} onClick={() => save({ face: { imageId: a.id } })} title={a.prompt}>
              <img src={a.poster || a.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8 }} />
            </button>
          ))}
          {face && !(images || []).some((a) => a.url === face) && <img src={face} alt="Your presenter" style={thumb(true)} />}
          <button type="button" className="btn ghost sm" disabled={!editable || busy} onClick={() => file.current?.click()}><Icon name="image" size={14} /> Your own photo</button>
          <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        <div style={{ color: 'var(--c-ink-3)', fontSize: 12, marginTop: 6 }}>
          {face ? 'This face speaks every talking scene. A clear, front-facing, chest-up photo works best.' : 'An invented person is drawn for each talking scene.'} Only you or an invented person — never a celebrity or someone else’s photo.
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, borderTop: '1px solid var(--c-line)', paddingTop: 10 }}>
        <span>{cost ? `${cost.scenes} talking scene${cost.scenes === 1 ? '' : 's'} · ${cost.model} · ${cost.perSecond} credits a second` : 'No talking scenes'}</span>
        <strong>{cost ? `about ${cost.credits} credits` : '—'}</strong>
      </div>
      {!editable && <div style={{ color: 'var(--c-ink-3)', fontSize: 12 }}>The presenter is set before the Reel is made.</div>}
    </div>
  );
}
export { PresenterPicker };
