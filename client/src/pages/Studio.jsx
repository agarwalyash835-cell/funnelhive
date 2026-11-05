// Studio: AI images, video clips and finished Reels for ads and pages (server studio/), as one creative workspace:
//   left    the creative director — Hive's chat, kept to Studio and told what's on the canvas (studio/DirectorChat)
//   centre  the canvas — the work as a masonry gallery with the prompt bar under it (studio/MakeWorkspace), or an open
//           Reel as its storyboard with the timeline under it (studio/ReelWorkspace)
//   right   the inspector — tier, model, frame, resolution, what it costs, the check before spending, the memory
// Under 1100px the director folds away behind a button; under 900px the three become tabs. New features plug in
// through studio/extensions (a mode, an inspector panel, a scene type, a concept bar) — see that file.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Layout, Icon, Empty, toast } from '../ui';
import { StudioMemory } from './StudioMemory';
import { DirectorChat } from './studio/DirectorChat';
import { MakeWorkspace } from './studio/MakeWorkspace';
import { ReelWorkspace } from './studio/ReelWorkspace';
import { ACTIVE } from './studio/shared';
import { studioExtensions, extOf } from './studio/extensions';
import '../studio.css';

const PREFS = 'ff_studio_prefs', UI = 'ff_studio_ui';
const read = (k) => { try { const p = JSON.parse(localStorage.getItem(k) || '{}'); return p && typeof p === 'object' ? p : {}; } catch { return {}; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const MODES = [['image', 'image', 'Image'], ['clip', 'play', 'Clip'], ['reel', 'wand', 'Reel']];

export default function Studio({ extensions = studioExtensions() }) {
  const [d, setD] = useState(null);
  const [mode, setMode] = useState(() => read(UI).mode || 'image');
  // the composer opens with this browser's last settings (never the words or pictures)
  const [v, setV] = useState(() => ({ prompt: '', tier: 'standard', res: '', aspect: '1:1', count: 1, ref: '', sourceId: '', seconds: 5, lang: 'en', length: 30, voice: '', captions: 'pop', sizes: ['9:16'], logo: '', ...read(PREFS) }));
  const [open, setOpen] = useState(() => new URLSearchParams(location.search).get('reel')); // a Reel's id
  const [memory, setMemory] = useState(false);
  const [chat, setChat] = useState(() => read(UI).chat !== false); // the director's column (wide screens)
  const [sheet, setSheet] = useState(false); // the director over the canvas (mid-size screens)
  const [pane, setPane] = useState('canvas'); // phones: director | canvas | settings
  // what the seller has pointed at on the canvas — the director's "this": { id, kind, target, label, url }
  const [selected, setSelected] = useState(null);
  const [, tick] = useState(0);
  const seenRef = useRef(null); // ids that were still being made at the last look
  const load = () => api('/studio').then((x) => {
    // something finished while the seller waited: say so (and on the tab, if they're elsewhere)
    const was = seenRef.current, now = new Set((x.assets || []).filter((a) => ACTIVE.includes(a.status)).map((a) => a.id));
    if (was) for (const a of x.assets || []) if (was.has(a.id) && !now.has(a.id) && !a.reelId) {
      const what = a.kind === 'reel' ? `Your Reel “${a.title}”` : a.kind === 'clip' ? 'Your clip' : 'Your image';
      toast(a.status === 'failed' ? `${what} couldn’t be made — open it to retry` : a.status === 'needs_review' ? `${what} is ready — have a look` : `${what} is ready`);
      if (document.hidden) document.title = `● ${document.title.replace(/^● /, '')}`;
    }
    seenRef.current = now; setD(x);
  }).catch(() => setD(false));
  useEffect(() => {
    load();
    const back = () => { document.title = document.title.replace(/^● /, ''); };
    const changed = () => load(); // an edit from the viewer (StudioViewer studioChanged)
    document.addEventListener('visibilitychange', back); window.addEventListener('ff:studio-changed', changed);
    return () => { document.removeEventListener('visibilitychange', back); window.removeEventListener('ff:studio-changed', changed); };
  }, []);
  // a new Reel (or none) open: what was pointed at belongs to the last one
  useEffect(() => { setSelected(open ? { id: open, kind: 'reel', target: 'reel', label: 'The whole Reel' } : null); }, [open]);
  useEffect(() => { write(PREFS, { tier: v.tier, vmodel: v.vmodel, imodel: v.imodel, res: v.res, aspect: v.aspect, count: v.count, seconds: v.seconds, lang: v.lang, length: v.length, voice: v.voice, captions: v.captions, sizes: v.sizes }); }, [v.tier, v.vmodel, v.imodel, v.res, v.aspect, v.count, v.seconds, v.lang, v.length, v.voice, v.captions, v.sizes.join()]);
  useEffect(() => { write(UI, { mode, chat }); }, [mode, chat]);
  const live = !!d?.assets?.some((a) => ACTIVE.includes(a.status));
  // while something renders: look again every few seconds, and keep the timers moving
  useEffect(() => { if (!live) return undefined; const p = setInterval(load, 4000), t = setInterval(() => tick((n) => n + 1), 1000); return () => { clearInterval(p); clearInterval(t); }; }, [live]);
  // the open Reel in the address, so a link (or the back button) brings it back
  useEffect(() => { const u = new URL(location.href); if (open) u.searchParams.set('reel', open); else u.searchParams.delete('reel'); history.replaceState(history.state, '', u); }, [open]);

  if (d === false) return <Layout title="Studio"><Empty icon="wand" title="Studio didn’t load" text="Reload the page to try again." /></Layout>;
  if (!d) return <Layout title="Studio" wide><div className="sxw sxw-loading" aria-busy="true"><div className="sxw-chat"><i /><i /><i /></div><div className="sxw-stage"><span /><span /><span /><span /><span /><span /></div><div className="sxw-inspect"><i /><i /><i /></div></div></Layout>;
  if (!d.on) return <Layout title="Studio" subtitle="AI images, video clips and Reels for your ads and pages"><Empty icon="wand" title="Studio isn’t on for your account yet" text="Studio makes product photos, scenes, short video clips and finished Reels for your ads, each one checked for quality before you see it. Ask us to switch it on." /></Layout>;

  const assets = d.assets || [];
  const reel = open && assets.find((a) => a.id === open && a.kind === 'reel');
  // set the composer; a second argument switches mode too (Animate on an image → a clip from it)
  const set = (p, m) => { setV((x) => ({ ...x, ...p })); if (m) changeMode(m); };
  const changeMode = (k) => { setMode(k); setOpen(null); setSelected(null); setPane('canvas'); setV((x) => ({ ...x, aspect: k === 'image' ? (x.aspect === '9:16' ? '1:1' : x.aspect) : k === 'clip' ? (x.aspect === '1:1' ? '9:16' : x.aspect) : x.aspect })); };
  const modeExts = extOf(extensions, 'mode', d);
  const modeExt = modeExts.find((x) => x.id === mode);
  const openReel = (id) => { setOpen(id); setPane('canvas'); };

  return (
    <Layout title="Studio" subtitle="Images, clips and Reels for your ads — planned with you, checked before you spend" wide
      actions={<>
        <div className="sxw-modes" role="tablist" aria-label="What to make">
          {[...MODES, ...modeExts.map((x) => [x.id, x.icon || 'layout', x.label])].map(([k, ic, l]) => <button key={k} type="button" role="tab" aria-selected={!reel && mode === k} className={!reel && mode === k ? 'on' : ''} onClick={() => changeMode(k)}><Icon name={ic} size={15} />{l}</button>)}
        </div>
        <button type="button" className={`btn ghost sxw-chatbtn${chat ? '' : ' show'}`} aria-pressed={sheet} onClick={() => (matchMedia('(max-width: 1100px)').matches ? setSheet((x) => !x) : setChat(true))}><Icon name="sparkles" size={15} /> Director</button>
      </>}>
      <div className={`sxw${chat ? '' : ' no-chat'}${sheet ? ' sheet' : ''} pane-${pane}${reel ? ' has-reel' : ''}`}>
        <aside className="sxw-chat" aria-label="Creative director">
          <DirectorChat reel={reel || null} mode={mode} selected={selected} onUnselect={() => setSelected(reel ? { id: reel.id, kind: 'reel', target: 'reel', label: 'The whole Reel' } : null)} onActivity={load} onCollapse={() => { setChat(false); setSheet(false); }} />
        </aside>
        {reel ? <ReelWorkspace key={reel.id} r={reel} d={d} onChange={load} onClose={() => setOpen(null)} extensions={extensions} openMemory={() => setMemory(true)} selected={selected} onSelect={setSelected} />
          : modeExt ? <><main className="sxw-stage"><modeExt.Stage d={d} assets={assets} load={load} openAsset={openReel} /></main><aside className="sxw-inspect">{modeExt.Inspector ? <modeExt.Inspector d={d} load={load} /> : null}</aside></>
            : <MakeWorkspace d={d} mode={MODES.some(([k]) => k === mode) ? mode : 'image'} v={v} set={set} assets={assets} load={load} onOpenReel={openReel} openMemory={() => setMemory(true)} extensions={extensions}
              onSelect={(a) => setSelected(a && ['image', 'clip'].includes(a.kind) ? { id: a.id, kind: a.kind, target: a.kind, label: `This ${a.kind}`, url: a.poster || a.url } : null)} />}
        <nav className="sxw-tabs" aria-label="Panels">
          {[['chat', 'sparkles', 'Director'], ['canvas', reel ? 'play' : 'image', reel ? 'Storyboard' : 'Canvas'], ['inspect', 'settings', 'Settings']].map(([k, ic, l]) => <button key={k} type="button" className={pane === k ? 'on' : ''} aria-pressed={pane === k} onClick={() => setPane(k)}><Icon name={ic} size={16} />{l}</button>)}
        </nav>
      </div>
      {memory && <StudioMemory d={d} onClose={() => setMemory(false)} />}
    </Layout>
  );
}
