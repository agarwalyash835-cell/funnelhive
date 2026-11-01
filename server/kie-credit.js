// The platform's kie.ai balance running out. Every AI feature (Hive, funnel writing, images, Studio) stops at once, so:
// sellers see a plain "paused" message (never the vendor, never "busy"), and the platform admins get one notification
// an hour telling them to top up. Loaded lazily from the AI callers, so it can't create an import cycle.
export const isOutOfCredit = (status, body) => status === 402 || body?.code === 402 || /credits? insufficient|insufficient (credit|balance)|top up/i.test(String(body?.msg || body?.error?.message || ''));
export const PAUSED = 'AI is paused for a moment — we’ve been told and are sorting it out. Please try again a little later.';
let lastAlert = 0;
export async function outOfCredit(where) {
  console.error(`kie.ai balance is empty (${where}) — every AI feature is paused until it's topped up`);
  if (Date.now() - lastAlert < 3600000) return;
  lastAlert = Date.now();
  try {
    const [{ allAdmins }, { notify }] = await Promise.all([import('./admin-guard.js'), import('./notify.js')]);
    for (const a of allAdmins()) notify(a.id, { kind: 'payment_failed', title: 'AI balance is empty — top up kie.ai', body: `Hive, AI images, funnel writing and Studio are paused for every seller until the kie.ai balance is topped up (first seen in ${where}).`, link: '/admin' });
  } catch (e) { console.error('balance alert failed', e.message); }
}
