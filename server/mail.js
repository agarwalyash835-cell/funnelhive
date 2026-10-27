// Transactional email. Uses the platform's provider when one is set (Admin → Email sending: Mailercloud or Resend, or
// MAILERCLOUD_API_KEY / RESEND_API_KEY); otherwise logs the message to the server console so links (verification,
// password reset) still work in development.
import { sendEmail, platformMailer, platformSend, mailFrom } from './messaging.js';

export const mailEnabled = () => !!(platformMailer() || process.env.SMTP_HOST);

export async function sendMail({ to, subject, text, html }) {
  if (process.env.SMTP_HOST) { const r = await sendEmail(null, { to, subject, text }); return { sent: r.status === 'sent' }; }
  const mailer = platformMailer();
  if (!mailer) {
    // in production the message (it may hold a sign-in or reset link) never goes to the logs
    if (process.env.NODE_ENV === 'production') { console.log(`📧 email not configured — "${subject}" was not sent. To help someone sign in, use Admin → Sellers → Reset link`); return { logged: false }; }
    console.log(`\n📧 [email not configured — printing instead]\nTo: ${to}\nSubject: ${subject}\n${text}\n`);
    return { logged: true };
  }
  await platformSend(mailer, { from: mailFrom(), to, subject, text, html: html || `<p>${text.replace(/\n/g, '<br>')}</p>` });
  return { sent: true };
}

export const appUrl = (req) => process.env.APP_URL || `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers.host}`;
