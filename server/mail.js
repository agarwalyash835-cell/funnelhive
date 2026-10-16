// Transactional email. Uses Resend when RESEND_API_KEY is set; otherwise logs the message
// to the server console so links (verification, password reset) still work in development.
const FROM = process.env.MAIL_FROM || 'FunnelHive <no-reply@funnelhive.app>';

import { sendEmail } from './messaging.js';

export const mailEnabled = () => !!(process.env.RESEND_API_KEY || process.env.SMTP_HOST);

export async function sendMail({ to, subject, text, html }) {
  if (process.env.SMTP_HOST) { const r = await sendEmail(null, { to, subject, text }); return { sent: r.status === 'sent' }; }
  if (!process.env.RESEND_API_KEY) {
    // in production the message (it may hold a sign-in or reset link) never goes to the logs
    if (process.env.NODE_ENV === 'production') { console.log(`📧 email not configured — "${subject}" was not sent. To help someone sign in, use Admin → Sellers → Reset link`); return { logged: false }; }
    console.log(`\n📧 [email not configured — printing instead]\nTo: ${to}\nSubject: ${subject}\n${text}\n`);
    return { logged: true };
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to, subject, text, html: html || `<p>${text.replace(/\n/g, '<br>')}</p>` }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`Email provider error ${r.status}`);
  return { sent: true };
}

export const appUrl = (req) => process.env.APP_URL || `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers.host}`;
