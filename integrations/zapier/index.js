// FunnelHive for Zapier: API-key auth, REST-hook triggers (subscribe / unsubscribe through /api/v1/hooks, with
// polling lists for samples) and actions on the public API.
const base = () => (process.env.FUNNELHIVE_URL || 'https://app.funnelhive.in').replace(/\/$/, '');

const authentication = {
  type: 'custom',
  fields: [{ key: 'apiKey', label: 'API key', required: true, helpText: 'FunnelHive → Settings → API & integrations → Create API key (full access).' }],
  test: { url: '{{process.env.FUNNELHIVE_URL}}/api/v1/me' },
  connectionLabel: '{{json.business}}',
};
const addKey = (request, z, bundle) => { request.headers.Authorization = `Bearer ${bundle.authData.apiKey}`; return request; };
const check = (response) => { if (response.status >= 400) throw new Error((response.json && response.json.error) || `FunnelHive error ${response.status}`); return response; };

// one REST-hook trigger per event
const hookTrigger = (key, noun, label, event, list, sample) => ({
  key, noun,
  display: { label, description: `Triggers instantly: ${label}.` },
  operation: {
    type: 'hook',
    performSubscribe: async (z, bundle) => (await z.request({ url: `${base()}/api/v1/hooks`, method: 'POST', body: { url: bundle.targetUrl, event } })).json,
    performUnsubscribe: async (z, bundle) => (await z.request({ url: `${base()}/api/v1/hooks/${bundle.subscribeData.id}`, method: 'DELETE' })).json,
    perform: (z, bundle) => [{ id: bundle.cleanedRequest.id, event: bundle.cleanedRequest.event, ...bundle.cleanedRequest.data }],
    performList: async (z) => (await z.request({ url: `${base()}/api/v1/${list}`, params: { limit: 3 } })).json.map((x) => ({ id: x.id || x.key, ...x })),
    sample,
  },
});

const triggers = [
  hookTrigger('new_lead', 'Lead', 'New Lead', 'lead.created', 'leads', { id: 'abc123', email: 'priya@example.com', name: 'Priya Sharma', phone: '+919876543210', funnel: 'Yoga Masterclass', source: 'instagram' }),
  hookTrigger('new_order', 'Order', 'New Order', 'order.created', 'orders', { id: 'ord123', email: 'priya@example.com', name: 'Priya Sharma', total: 1999, currency: 'INR', status: 'paid' }),
  hookTrigger('order_refunded', 'Order', 'Order Refunded', 'order.refunded', 'orders', { id: 'ord123', total: 0, status: 'refunded' }),
  hookTrigger('order_shipped', 'Order', 'Order Shipped', 'order.shipped', 'orders', { id: 'ord123', courier: 'Delhivery', tracking: 'AWB123' }),
  hookTrigger('payment_failed', 'Order', 'Membership or Instalment Payment Failed', 'order.payment_failed', 'orders', { id: 'ord123', email: 'priya@example.com' }),
  hookTrigger('new_booking', 'Booking', 'New Booking', 'booking.created', 'bookings', { id: 'bk123', email: 'priya@example.com', start: 1791500000000, status: 'confirmed' }),
  hookTrigger('booking_cancelled', 'Booking', 'Booking Cancelled', 'booking.cancelled', 'bookings', { id: 'bk123', status: 'cancelled' }),
  hookTrigger('webinar_registration', 'Registration', 'Webinar Registration', 'webinar.registered', 'leads', { id: 'reg123', email: 'priya@example.com', webinar: 'Masterclass' }),
];

// hidden triggers that fill the dropdowns
const dropdown = (key, path, pick) => ({ key, noun: key, display: { label: key, description: key, hidden: true }, operation: { perform: async (z) => pick((await z.request({ url: `${base()}${path}` })).json) } });
triggers.push(
  dropdown('automations', '/api/automations', (d) => (d.automations || d).map((a) => ({ id: a.id, name: a.name }))),
  dropdown('products', '/api/products', (d) => (d.products || d).map((p) => ({ id: p.id, name: p.name }))),
);

const creates = [
  {
    key: 'contact', noun: 'Contact',
    display: { label: 'Create or Update Contact', description: 'Adds a contact (or updates one) and adds tags — tag automations start for new tags.' },
    operation: {
      inputFields: [{ key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' }, { key: 'name', label: 'Name' }, { key: 'tags', label: 'Tags', list: true }],
      perform: async (z, bundle) => (await z.request({ url: `${base()}/api/v1/contacts`, method: 'POST', body: bundle.inputData })).json,
      sample: { key: 'priya@example.com', created: true, tags: ['vip'] },
    },
  },
  {
    key: 'enroll', noun: 'Enrolment',
    display: { label: 'Start an Automation for a Contact', description: 'Puts someone into one of your automations.' },
    operation: {
      inputFields: [{ key: 'automationId', label: 'Automation', required: true, dynamic: 'automations.id.name' }, { key: 'email', label: 'Email', required: true }, { key: 'name', label: 'Name' }, { key: 'phone', label: 'Phone' }],
      perform: async (z, bundle) => { const { automationId, ...who } = bundle.inputData; return (await z.request({ url: `${base()}/api/automations/${automationId}/enroll`, method: 'POST', body: who })).json; },
      sample: { ok: true },
    },
  },
  {
    key: 'grant', noun: 'Access',
    display: { label: 'Give Access to a Product', description: 'Gives someone a product (course, download…) and emails their library link.' },
    operation: {
      inputFields: [{ key: 'productId', label: 'Product', required: true, dynamic: 'products.id.name' }, { key: 'email', label: 'Email', required: true }, { key: 'name', label: 'Name' }],
      perform: async (z, bundle) => { const { productId, ...who } = bundle.inputData; return (await z.request({ url: `${base()}/api/products/${productId}/grant`, method: 'POST', body: who })).json; },
      sample: { ok: true },
    },
  },
];

module.exports = {
  version: require('./package.json').version,
  platformVersion: require('zapier-platform-core').version,
  authentication,
  beforeRequest: [addKey],
  afterResponse: [check],
  triggers: Object.fromEntries(triggers.map((t) => [t.key, t])),
  creates: Object.fromEntries(creates.map((c) => [c.key, c])),
};
