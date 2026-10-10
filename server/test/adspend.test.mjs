// Ad spend and ROAS: Meta spend synced from the Marketing API (fake), a Google Ads CSV export, matched to UTM campaigns
// in the dashboard report (spend, ROAS, cost per lead / sale), re-imports replacing rather than doubling.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register } from './helpers.mjs';

const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
let meta, srv, api, T, f;
before(async () => {
  meta = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (!req.url.includes('access_token=EAAgood')) { res.writeHead(400); return res.end(JSON.stringify({ error: { message: 'Invalid OAuth access token' } })); }
    if (req.url.includes('/insights')) return res.end(JSON.stringify({ data: [{ date_start: today, campaign_name: 'Diwali Sale', spend: '1000.50', account_currency: 'INR' }, { date_start: today, campaign_name: 'Brand Awareness', spend: '300', account_currency: 'INR' }] }));
    res.end(JSON.stringify({ id: 'act_123456', name: 'My ads', currency: 'INR' }));
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ META_GRAPH_URL: `http://127.0.0.1:${meta.address().port}` });
  api = srv.api;
  T = (await register(api)).token;
  f = (await api('/templates/coding/use', 'POST', {}, T)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
  let co = f.steps.find((s) => s.type === 'checkout');
  const attr = { utm_source: 'facebook', utm_medium: 'paid', utm_campaign: 'diwali-sale' };
  await api(`/public/${f.slug}/lead`, 'POST', { stepId: f.steps[0].id, email: 'a@x.in', attr });
  // a real sale (reports leave out test orders): Cash on Delivery, marked paid once collected
  const steps = f.steps.map((s) => (s.id !== co.id ? s : { ...s, blocks: s.blocks.map((b) => (b.type === 'checkout' ? { ...b, props: { ...b.props, cod: true } } : b)) }));
  f = (await api(`/funnels/${f.id}`, 'PUT', { steps }, T)).data;
  co = f.steps.find((s) => s.type === 'checkout');
  const sale = (await api(`/public/${f.slug}/cod`, 'POST', { stepId: co.id, email: 'a@x.in', name: 'A', phone: '9876543210', attr })).data;
  assert.equal(sale.provider, 'cod', JSON.stringify(sale));
  const id = sale.id || sale.orderId || sale.order?.id;
  assert.equal((await api(`/orders/${id}/cod`, 'POST', { action: 'paid' }, T)).status, 200);
});
after(async () => { await srv.stop(); meta.close(); });

test('Meta: the token is checked, spend synced, matched to the UTM campaign with ROAS', async () => {
  assert.equal((await api('/adspend/meta', 'PUT', { account: '123456', token: 'EAAbad' }, T)).status, 400);
  const ok = (await api('/adspend/meta', 'PUT', { account: 'act_123456', token: 'EAAgood' }, T)).data;
  assert.equal(ok.rows, 2);
  const ov = (await api('/analytics/overview?days=7', 'GET', null, T)).data;
  const row = ov.campaigns.find((c) => c.campaign === 'diwali-sale');
  assert.equal(row.spend, 1001);
  const price = f.steps.find((s) => s.type === 'checkout').blocks.find((b) => b.type === 'checkout').props.price;
  assert.equal(row.roas, Math.round((price / 1000.5) * 100) / 100);
  assert.equal(row.cpl, 1001);
  assert.ok(ov.campaigns.some((c) => c.campaign === 'Brand Awareness' && c.unmatched), 'spend without sales still shows');
  assert.equal(Math.round(ov.adSpend), 1301);
  // syncing again replaces, never doubles
  await api('/adspend/meta/sync', 'POST', {}, T);
  assert.equal(Math.round((await api('/analytics/overview?days=7', 'GET', null, T)).data.adSpend), 1301);
});

test('Google Ads CSV: parsed, matched, replaced on re-upload; bad files explained', async () => {
  const csv = `Campaign report\nDay,Campaign,Clicks,Cost\n${today},DIWALI SALE,40,"2,000.00"\n${today},Search - Brand,10,150\nTotal,,50,2150`;
  assert.equal((await api('/adspend/csv', 'POST', { platform: 'google', csv }, T)).data.rows, 2);
  await api('/adspend/csv', 'POST', { platform: 'google', csv }, T);
  const row = (await api('/analytics/overview?days=7', 'GET', null, T)).data.campaigns.find((c) => c.campaign === 'diwali-sale');
  assert.equal(row.spend, 3001, 'Meta + Google, the re-upload replaced its own day');
  assert.deepEqual(row.platforms.sort(), ['google', 'meta']);
  assert.equal((await api('/adspend/csv', 'POST', { csv: 'a,b\n1,2' }, T)).status, 400);
  assert.equal((await api('/adspend/google', 'DELETE', null, T)).data.deleted, 2);
});
