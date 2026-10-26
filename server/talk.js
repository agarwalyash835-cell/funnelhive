// Talking to Hive AI from the dashboard, for sellers who'd rather speak than type — in their own language.
// The browser records; Sarvam turns it into text (11 Indian languages, auto-detected) and reads the reply back
// with a natural voice. Without Sarvam the browser's own speech recognition and voice are used instead.
// The words themselves go to Hive AI's normal chat (/api/hive/chat), which is told to answer in that language.
import express from 'express';
import { sarvamReady, transcribe, speak, LANGUAGES } from './sarvam.js';

export function registerTalk(app, { auth, rateLimit, isTest }) {
  const limiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 20, key: (req) => req.user?.id || req.ip, message: 'Too many voice requests — please wait a minute.' });
  app.get('/api/talk', auth, (req, res) => res.json({ sarvam: sarvamReady(), languages: Object.entries(LANGUAGES).map(([code, name]) => ({ code, name })) }));
  // a recording (webm / ogg / wav, up to about a minute) → its words and language
  app.post('/api/talk/listen', auth, limiter, express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '6mb' }), async (req, res) => {
    if (!sarvamReady()) return res.status(501).json({ error: 'Speech isn’t set up on the server' });
    const buf = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buf || buf.length < 1000) return res.status(400).json({ error: 'I didn’t catch that — hold the button and speak' });
    const mime = String(req.headers['content-type'] || 'audio/webm').split(';')[0];
    try {
      const r = await transcribe(buf, mime, mime.includes('ogg') ? 'voice.ogg' : mime.includes('wav') ? 'voice.wav' : 'voice.webm');
      res.json({ text: r.text, language: LANGUAGES[r.language] ? r.language : '' });
    } catch (e) { res.status(502).json({ error: e.message }); }
  });
  // a reply read aloud
  app.post('/api/talk/speak', auth, limiter, async (req, res) => {
    if (!sarvamReady()) return res.status(501).json({ error: 'Speech isn’t set up on the server' });
    const text = String(req.body?.text || '').replace(/[*_~`#>]/g, '').replace(/https?:\/\/\S+/g, '').trim();
    if (!text) return res.status(400).json({ error: 'Nothing to say' });
    try { res.set({ 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' }).send(await speak(text, String(req.body?.language || 'en-IN'))); } catch (e) { res.status(502).json({ error: e.message }); }
  });
}
