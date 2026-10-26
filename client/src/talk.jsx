import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './api';
import { Icon, toast } from './ui';

// Talk to Hive AI: for sellers who'd rather speak than type, in their own language. Tap the orb, speak, and Hive AI
// answers out loud. The server's Sarvam does the listening (11 Indian languages, detected) and the voice; without it
// the browser's own speech recognition and voice are used. The orb follows your voice while listening, and the
// reply's voice while speaking.
const BROWSER_STT = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
const LABEL = { idle: 'Tap the orb and speak', listening: 'Listening… tap when you’re done', thinking: 'Thinking…', speaking: 'Speaking — tap to stop' };
const NATIVE = { 'en-IN': 'English', 'hi-IN': 'हिन्दी', 'bn-IN': 'বাংলা', 'ta-IN': 'தமிழ்', 'te-IN': 'తెలుగు', 'mr-IN': 'मराठी', 'gu-IN': 'ગુજરાતી', 'kn-IN': 'ಕನ್ನಡ', 'ml-IN': 'മലയാളം', 'pa-IN': 'ਪੰਜਾਬੀ', 'od-IN': 'ଓଡ଼ିଆ' };
const keep = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* private mode */ } return null; };

export function TalkToHive() {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [lang, setLang] = useState(() => keep('ff_talk_lang') || 'auto');
  const [state, setState] = useState('idle');
  const [turns, setTurns] = useState([]);
  const [work, setWork] = useState('');
  const orb = useRef(), stopRef = useRef(null), thread = useRef(null), audio = useRef(null), box = useRef();
  useEffect(() => { if (open && !cfg) Promise.all([api('/talk').catch(() => ({ sarvam: false, languages: [] })), api('/hive/status').catch(() => ({}))]).then(([t, h]) => setCfg({ ...t, ready: h.ready !== false })); }, [open, cfg]);
  useEffect(() => { box.current && (box.current.scrollTop = box.current.scrollHeight); }, [turns, work]);
  useEffect(() => () => { stopRef.current?.(true); audio.current?.pause(); window.speechSynthesis?.cancel(); }, []);
  // the orb's size follows a sound level (0–1)
  const level = (v) => orb.current?.style.setProperty('--lvl', Math.min(1, v).toFixed(3));
  const meter = (stream) => {
    const ctx = new (window.AudioContext || window.webkitAudioContext)(), an = ctx.createAnalyser();
    an.fftSize = 512; ctx.createMediaStreamSource(stream).connect(an);
    const data = new Uint8Array(an.fftSize);
    let raf, quietSince = 0, heard = false;
    const tick = () => {
      an.getByteTimeDomainData(data);
      let sum = 0; for (const x of data) sum += ((x - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / data.length);
      level(rms * 4);
      // stop by itself after 1.6 s of quiet, once they've said something
      if (rms > 0.04) { heard = true; quietSince = 0; } else if (heard) { quietSince ||= Date.now(); if (Date.now() - quietSince > 1600) { stopRef.current?.(); return; } }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { cancelAnimationFrame(raf); ctx.close().catch(() => {}); level(0); };
  };
  const listen = async () => {
    if (!cfg?.ready) return toast('Hive AI isn’t switched on yet');
    audio.current?.pause(); window.speechSynthesis?.cancel();
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch { return toast('Allow the microphone to talk to Hive AI'); }
    const unmeter = meter(stream);
    setState('listening');
    const done = (text, detected) => { unmeter(); stream.getTracks().forEach((t) => t.stop()); stopRef.current = null; if (text?.trim()) think(text.trim(), detected); else setState('idle'); };
    const max = setTimeout(() => stopRef.current?.(), 60000);
    if (cfg.sarvam) {
      const type = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'].find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';
      const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined), parts = [];
      let cancelled = false;
      rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
      rec.onstop = async () => {
        clearTimeout(max);
        if (cancelled) return done('');
        setState('thinking'); setWork('Understanding…');
        try {
          const blob = new Blob(parts, { type: rec.mimeType || 'audio/webm' });
          const r = await fetch('/api/talk/listen', { method: 'POST', headers: { 'Content-Type': blob.type.split(';')[0], Authorization: `Bearer ${localStorage.getItem('ff_token')}` }, body: blob });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error);
          setWork('');
          done(j.text, j.language);
        } catch (e) { toast(e.message || 'I didn’t catch that'); setWork(''); done(''); }
      };
      rec.start();
      stopRef.current = (cancel) => { cancelled = !!cancel; if (rec.state !== 'inactive') rec.stop(); };
    } else if (BROWSER_STT) {
      const rec = new BROWSER_STT();
      rec.lang = lang === 'auto' ? (navigator.language?.includes('-') ? navigator.language : 'en-IN') : lang;
      rec.interimResults = true;
      let text = '';
      rec.onresult = (e) => { text = [...e.results].map((x) => x[0].transcript).join(' '); setWork(text); };
      rec.onerror = (e) => { if (e.error !== 'aborted' && e.error !== 'no-speech') toast(`Couldn’t listen: ${e.error}`); };
      rec.onend = () => { clearTimeout(max); setWork(''); done(text, rec.lang); };
      rec.start();
      stopRef.current = (cancel) => { if (cancel) text = ''; rec.stop(); };
    } else { unmeter(); stream.getTracks().forEach((t) => t.stop()); clearTimeout(max); toast('This browser can’t listen — try Chrome, or type to Hive AI'); setState('idle'); }
  };
  // their words → Hive AI (the usual chat, told to answer briefly in their language) → spoken back
  const think = async (text, detected) => {
    const spokenIn = lang !== 'auto' ? lang : detected && NATIVE[detected] ? detected : 'en-IN';
    setTurns((t) => [...t, { me: true, text }]);
    setState('thinking'); setWork('Thinking…');
    let reply = '';
    try {
      const res = await fetch('/api/hive/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('ff_token')}` }, body: JSON.stringify({ message: text, threadId: thread.current, voice: spokenIn }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Hive AI is unavailable right now');
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          if (!chunk.startsWith('data: ')) continue;
          const ev = JSON.parse(chunk.slice(6));
          if (ev.type === 'thread') thread.current = ev.threadId;
          else if (ev.type === 'tool' && ev.status === 'running') setWork(ev.label || 'Working on it…');
          else if (ev.type === 'reply') reply = ev.text;
          else if (ev.type === 'error') throw new Error(ev.error);
        }
      }
    } catch (e) { reply = e.message; }
    setWork('');
    setTurns((t) => [...t, { text: reply }]);
    say(reply, spokenIn);
  };
  const say = async (text, language) => {
    const plain = String(text || '').replace(/[*_~`#>|]/g, '').replace(/https?:\/\/\S+/g, '').trim();
    if (!plain) return setState('idle');
    setState('speaking');
    const end = () => { level(0); setState('idle'); };
    if (cfg?.sarvam) {
      try {
        const r = await fetch('/api/talk/speak', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('ff_token')}` }, body: JSON.stringify({ text: plain, language }) });
        if (!r.ok) throw new Error();
        const a = new Audio(URL.createObjectURL(await r.blob()));
        audio.current = a;
        // the orb pulses with the voice
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)(), an = ctx.createAnalyser(), data = new Uint8Array(256);
          ctx.createMediaElementSource(a).connect(an); an.connect(ctx.destination);
          let raf; const tick = () => { an.getByteTimeDomainData(data); let s = 0; for (const x of data) s += ((x - 128) / 128) ** 2; level(Math.sqrt(s / data.length) * 4); raf = requestAnimationFrame(tick); }; tick();
          a.onended = a.onpause = () => { cancelAnimationFrame(raf); ctx.close().catch(() => {}); end(); };
        } catch { a.onended = a.onpause = end; }
        await a.play();
        return;
      } catch { /* the browser's voice instead */ }
    }
    if (!window.speechSynthesis) return end();
    const u = new SpeechSynthesisUtterance(plain);
    u.lang = language; u.rate = 1;
    const v = window.speechSynthesis.getVoices().find((x) => x.lang?.replace('_', '-').toLowerCase().startsWith(language.slice(0, 2)));
    if (v) u.voice = v;
    let raf; const wobble = () => { level(0.25 + Math.random() * 0.35); raf = setTimeout(wobble, 120); }; wobble();
    u.onend = u.onerror = () => { clearTimeout(raf); end(); };
    window.speechSynthesis.speak(u);
  };
  const tap = () => {
    if (state === 'listening') return stopRef.current?.();
    if (state === 'speaking') { audio.current?.pause(); window.speechSynthesis?.cancel(); return setState('idle'); }
    if (state === 'idle') listen();
  };
  const close = () => { stopRef.current?.(true); audio.current?.pause(); window.speechSynthesis?.cancel(); setState('idle'); setOpen(false); };
  return (
    <>
      {!open && <button className="tk-fab" onClick={() => setOpen(true)} aria-label="Talk to Hive AI" title="Talk to Hive AI — in your language"><span className="tk-fab-orb" /><Icon name="mic" size={20} /><span className="tk-fab-l">Talk to Hive AI</span></button>}
      {open && (
        <div className="tk-panel" role="dialog" aria-label="Talk to Hive AI">
          <div className="tk-head">
            <b>Talk to Hive AI</b>
            <select value={lang} onChange={(e) => { setLang(e.target.value); keep('ff_talk_lang', e.target.value); }} aria-label="Language">
              <option value="auto">{cfg?.sarvam ? 'Any language (detects it)' : 'My language'}</option>
              {Object.entries(NATIVE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <button className="icon-btn" onClick={close} aria-label="Close"><Icon name="x" size={16} /></button>
          </div>
          <div className="tk-chat" ref={box}>
            {!turns.length && <p className="tk-hint">Ask anything, in your language — “इस हफ्ते कितनी बिक्री हुई?”, “Make a webinar funnel for my yoga class”, “Kal ki bookings batao”.</p>}
            {turns.map((x, i) => <p key={i} className={`tk-turn ${x.me ? 'me' : ''}`}>{x.text}</p>)}
            {work && <p className="tk-turn work">{work}</p>}
          </div>
          <button ref={orb} className={`tk-orb ${state}`} onClick={tap} disabled={state === 'thinking' || !cfg} aria-label={LABEL[state]}>
            <i /><i /><i /><span className="tk-core"><Icon name={state === 'speaking' ? 'x' : 'mic'} size={26} /></span>
          </button>
          <p className="tk-state">{!cfg ? 'Getting ready…' : cfg.ready ? LABEL[state] : 'Hive AI isn’t switched on yet'}</p>
          <div className="tk-foot"><Link to={thread.current ? '/hive' : '/hive'}>Open the full chat</Link>{!cfg?.sarvam && cfg && <span>Using your browser’s voice</span>}</div>
        </div>
      )}
    </>
  );
}
