# FunnelHive — AI sales funnel builder, sold as SaaS (React + Node.js)

A FlexiFunnels-style platform for Indian businesses: describe your business in one line and get a complete
funnel (landing → checkout with order bump → one-click upsell → downsell → thank-you with cross-sells).
It runs as a subscription business: public landing & pricing pages, a free trial, ₹1,499/month or ₹14,999/year
through Razorpay Subscriptions, GST invoices, and an admin panel for the owner.

## Requirements
Node.js **24** (22.13+ works; uses the built-in SQLite module). No database server needed.

## Develop
```bash
npm run install:all
cp server/.env.example server/.env   # optional — see the comments in that file
npm run dev                          # app http://localhost:5173 · API :4000
```
Without an Anthropic key everything still works: generation picks the closest of 53 templates and
personalises name/price/city/audience from your prompt, and the chat assistant understands structural
commands ("add an upsell and a downsell", "make it dark", "add FAQ").
If `npm install` in `client/` fails with an esbuild ENOENT error on Windows, move the project to a short path (e.g. `C:\funnelhive`).

## Test
```bash
npm test        # 113 tests: API, billing, admin, cluster, automations, CRM, AI, security, SSR…
```
The server-rendering tests run when the client has been built (`npm run build`).

## Production
```bash
npm run build   # React app + server-render bundle
npm start       # serves everything on PORT (default 4000)
```
Or with Docker: `docker compose up -d` (data persists in the `funnelhive-data` volume).
Put it behind HTTPS and set `APP_URL` to the public address. The included Caddy setup does HTTPS for the app
**and** every seller's custom domain automatically:
```bash
APP_DOMAIN=app.yourbrand.in ACME_EMAIL=you@yourbrand.in docker compose --profile https up -d
```
(`deploy/Caddyfile`; certificates for seller domains are only issued after FunnelHive has verified them.)

### AI
Set `KIE_API_KEY` (kie.ai) in `server/.env`; `KIE_MODEL` picks the model (default `deepseek-v4-1-flash`). Every AI request
includes the closest template from the library as a complete example plus one example of every block, so generated
funnels follow the templates' structure and quality. Results are validated (known blocks, hero, checkout), retried once,
and fall back to the closest template if the AI fails. Without a key, an offline template-based assistant is used.

### Hive AI and MCP
**Hive AI** (sidebar) builds funnels by chat: complete funnels, page sections, design, coupons, pipelines and
automations, with a live preview. It uses native tool calling, so it needs `KIE_API_KEY` with a tool-capable
`KIE_MODEL` (DeepSeek, GPT or Kimi). The same 25 tools are served over **MCP** at `POST /mcp` (Streamable HTTP,
JSON-RPC). Create a token in Settings → Hive AI · MCP access; Claude Desktop config:
`{"mcpServers":{"funnelhive":{"command":"npx","args":["-y","mcp-remote","https://your-app/mcp","--header","Authorization: Bearer ffmcp_…"]}}}`.
Tools act through the platform's own API as the token's owner, so every validation and quality check applies.

### Email, WhatsApp, custom domains
- **Email**: each seller connects their own SMTP (Gmail/Workspace, Zoho, Hostinger, Brevo, SES, SendGrid…) in
  Settings → Email sending; `SMTP_*` / `RESEND_API_KEY` in `.env` is the server-wide fallback. Passwords are encrypted.
- **WhatsApp**: Meta WhatsApp Cloud API — Phone number ID + permanent access token in Settings. Automated messages
  use Meta-approved templates; plain text only reaches people who messaged in the last 24 hours.
- **Custom domains**: Settings → Custom domains. The seller adds a TXT record (ownership) and a CNAME to `APP_URL`'s
  host (or an A record to `SERVER_IP`); FunnelHive re-checks DNS automatically and then serves the funnel there.

### Payments for sellers
- **Razorpay** (₹, UPI, cards, netbanking): Settings → Payments. Payment plans ("3 × ₹10,999") and memberships
  (monthly / yearly) use Razorpay **Subscriptions** — enable it in the seller's Razorpay account and add the webhook with
  `payment.captured`, `order.paid`, `refund.processed` and all `subscription.*` events.
- **Stripe** (USD, EUR, GBP, AUD, CAD, SGD, AED; Apple / Google Pay): Settings → Payments → Stripe (publishable + secret
  key, webhook signing secret). A checkout priced in a foreign currency charges through Stripe; upsells reuse the saved
  card in one click. Revenue is reported in rupees at `FX_RATES` (e.g. `USD:84,EUR:91`).
- **Cash on Delivery** and shipping are set per checkout; Orders exports a courier-ready CSV.

### Google Calendar (bookings)
Set `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (same Google Cloud project as sign-in), enable the **Google Calendar
API**, and add `https://<APP_URL>/api/google/calendar/callback` as an authorised redirect URI. Sellers connect in
Bookings → Calendars: busy times block slots and every booking is added with a Google Meet link.

### Agencies, teams, API, privacy
- **Teams**: Settings → Team (admin, marketer, sales, viewer). `TEAM_MAX` (default 25).
- **Agency plan**: Admin → Plan & settings sets its price and how many client accounts it includes. Agencies manage
  client accounts from **Agency**, white-label the app (name, logo, colour, their own app domain — pointed at this
  server; HTTPS comes from the same Caddy on-demand TLS check), copy / share / export funnels and send client reports.
- **Public API & Zapier**: Settings → API & integrations (keys); reference at `/developers`. The Zapier app is in
  `integrations/zapier` (`zapier push`); Pabbly / Make / n8n use the REST API and REST hooks directly.
- **Privacy (DPDP)**: Settings → Privacy & policies — consent banner, consent box on forms, generated Privacy / Terms /
  Refund / Contact pages at `/legal/<seller>/…`, erasing a contact on request.
- **Ad spend**: Settings → Ad spend & ROAS — Meta synced daily (Marketing API token), Google Ads by CSV.

## Selling it (SaaS)
1. Put your login email in `ADMIN_EMAILS` (server/.env), sign up with it and verify the email — the **Admin** item
   appears in the sidebar.
2. **Admin → Plan & settings**: prices (default ₹1,499/month, ₹14,999/year), trial length (14 days), AI credits,
   company name / GSTIN / state for invoices, and your Razorpay Key ID + Secret. In Razorpay, enable **Subscriptions**
   and add the webhook `https://<your app>/api/billing/webhook` with the `subscription.*` events and the same secret.
3. Sellers sign up from the landing page (`/`), get the trial, and subscribe in **Plan & billing** (card or UPI Autopay).
   Every charge produces a GST invoice (CGST+SGST or IGST by the seller's state); Admin → Invoices exports a CSV for filing.
4. When a trial or subscription ends the account becomes read-only, automations pause, and live pages go offline after a
   grace period (all adjustable). Admins can extend trials, give free access, suspend, set AI credits, log in as a seller
   (audited) and delete accounts. Sellers can export their data and delete their account themselves.
5. Review the policy pages (`/terms`, `/privacy`, `/refunds`, `/contact`) with your lawyer — Razorpay asks for them.

## Scale
Optional infrastructure settings (server/.env):
- `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_PUBLIC_URL` — any S3-compatible bucket
  (Cloudflare R2, AWS S3, Backblaze B2, Spaces, MinIO): backups are copied off the server (set a lifecycle rule on
  `backups/`), images are served from the bucket / CDN, product files are delivered by 5-minute signed links.
- `PAGES_URL` — live funnel pages on their own domain (e.g. `https://pages.yourbrand.in`), apart from the dashboard.
- `METRICS_TOKEN` — Prometheus metrics at `/metrics` and queue details at `/api/health?detail=1` (Bearer token).
  `/api/health` returns 503 when the database or the background jobs stop.
- `SENTRY_DSN` — server errors go to Sentry. `LOG_REQUESTS=1` — one JSON log line per request.
- `BROADCAST_SHARED_DAILY` (default 300) — daily broadcast-email cap for sellers on the shared mail server.
- `EVENTS_RAW_DAYS` (default 90) — page views are kept one row each for this long, then folded into daily totals per
  funnel / step / source / A-B variant (in each seller's time zone) and deleted, so the database stops growing with
  traffic. Reports give the same numbers; unique visitors on days older than the window become the sum of daily uniques.
  `EVENTS_KEEP_DAYS` (default 400) — how long the daily totals are kept.

Each record is stored on its own with indexed columns; reports are aggregated inside SQLite. `npm start` runs one app
process per CPU core (max 4, `WEB_CONCURRENCY`); one of them runs background jobs, and automation steps / webhooks are
claimed so nothing is sent twice. Measured on a 4-core laptop with 1000 sellers, 10,000 funnels and 2 million page
views: **390 requests/s, 0 errors** (live pages 2–4 ms each). Re-measured on 8 Oct 2026 on an 8-core laptop also running
the load generator: 294 requests/s of mixed traffic, 0 errors; single requests take 4–16 ms. Page views are written in
one batch per second per process (`EVENTS_FLUSH_MS`). Reproduce with `server/scripts/seed-load.mjs` +
`server/scripts/loadtest.mjs`. Beyond one server (tens of thousands of sellers), move to Postgres and a job queue.

## Data, backups, security
- SQLite database at `DATA_DIR/funnelhive.db` (WAL journal; older databases and `data.json` are upgraded automatically on start).
- Online backups every 6 hours to `DATA_DIR/backups` (one per day, last 7 kept; Admin → Back up now); uploads in `DATA_DIR/uploads`. Copy backups off the server too.
- Sessions are signed with `JWT_SECRET` (auto-generated and stored if unset); password changes/resets sign out other devices.
- Rate limits on login, public endpoints and AI; same-origin CORS; security headers; optional TOTP 2-step login.
- Email verification and password reset links are emailed via Resend when `RESEND_API_KEY` is set, otherwise printed in the server log.
- Webhooks are signed (`X-FunnelHive-Signature: t=…,v1=HMAC_SHA256(secret, t + "." + body)`) and retried with backoff.

## Features
- **AI**: Hive AI builds funnels end to end by chat (also over MCP) · one-line funnel generation with a template quality
  gate · conversational editor chat (applies real changes, undoable) · monthly AI credits per seller
- **Builder**: drag & drop sections from a 28-block library, drag to reorder sections & steps,
  desktop/tablet/mobile preview, undo/redo (Ctrl+Z / Ctrl+Y), inspector for every field,
  funnel flow map with accept/decline branches, 6 visual styles + colour palettes, step SEO
- **Selling**: checkout with order bump, coupons, UPI/cards UI, abandoned-checkout capture,
  one-click upsells & downsells (accepting skips the downsell), one-click cross-sells on the thank-you page
- **Digital products**: files (streamed uploads, private storage), links and courses (lessons, modules, drip, progress)
  attached to checkout / bump / upsell / cross-sell / free opt-ins; delivered only after a verified payment; buyer library
  with expiring signed downloads, download limits, access duration, manual grant / revoke / link reset, lost-link recovery
- **GST invoices & refunds**: per-payment invoices (CGST+SGST / IGST, buyer GSTIN at checkout), credit notes, GST CSV;
  refunds through Razorpay (or synced from the Razorpay dashboard) remove access and net out of every report
- **Optimisation**: A/B split tests per step (traffic split, sticky assignment, winner promotion),
  FOMO kit (hello bar, countdowns, live viewers, stock bar, social-proof popups, exit popup, sticky bar, WhatsApp)
- **Analytics**: dashboard KPIs with period deltas & sparklines, revenue/orders/leads/visitors chart,
  revenue by offer type, traffic sources (UTM/referrer), per-funnel step drop-off, bump & upsell take rates, A/B results
- **CRM**: contacts with full timelines, pipelines (kanban), custom fields, bulk actions, orders, abandoned carts, CSV export
- **Automations**: triggers (sign-up, purchase, cart, stage, tag, date, webhook), waits, email & WhatsApp, if/else, A/B
  split, open/click tracking, version history
- **SaaS**: landing & pricing pages, trial, Razorpay Subscriptions, GST invoices, admin panel, data export & account deletion
- **Integrations**: Meta Pixel + GA4 (PageView, ViewContent, Lead, InitiateCheckout, AddPaymentInfo, Purchase) plus server-side
  Meta Conversions API + GA4 Measurement Protocol with shared event ids; UTM / fbclid / gclid on every lead and order and a
  campaigns report; webhooks (lead.created, order.created/updated/refunded),
  payment provider keys (Razorpay/Stripe/Cashfree/PhonePe), custom domain instructions
- **Templates**: 53 India-focused funnels (5 steps for paid offers), 15+ sections per landing page
- **Onboarding**: 3-step empty state, setup checklist, one-click demo data

## Layout
- `server/index.js` REST API, analytics, public runtime · `server/ai.js` AI (kie.ai / Anthropic) + quality gate (`quality.js`) · `server/hive.js` Hive AI + MCP · `server/razorpay.js` payments ·
  `server/crm.js` contacts, pipelines, timeline · `server/automations.js` automation engine · `server/messaging.js`
  email (SMTP/Resend) + WhatsApp Cloud API · `server/domains.js` custom domains · `server/webhooks.js` signed webhooks ·
  `server/actions.js` funnel-edit actions + offline command parser · `server/templates.js` / `template-kit.js` template library ·
  `server/db.js` storage · `server/analytics.js` reports · `server/billing.js` subscriptions & invoices · `server/platform.js` platform settings ·
  `server/products.js` digital products & buyer library · `server/sales.js` GST invoices & refunds · `server/tracking.js` attribution & server-side conversions ·
  `server/admin.js` admin API · `server/account.js` export/delete · `server/start.js` cluster entry
- `client/src/blocks.jsx` section renderer (shared by editor and live pages) · `client/src/pages/*` app screens ·
  `client/src/ui.jsx` app shell & components · `client/src/charts.jsx` SVG charts

## Before going live
- Do one real end-to-end test with Razorpay **test** keys: subscribe as a seller, check the invoice, then switch to live keys.
- Sellers' own checkouts: Razorpay (Orders API + signature check + webhook) is built in; test one purchase with test keys.
- Set SMTP (or Resend) so sign-up, password-reset, trial-ending and payment-failed emails go out.
- Have the Terms, Privacy and Refund pages reviewed; fill in your company details in Admin so they show correctly.
