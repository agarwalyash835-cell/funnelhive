# Deploying FunnelHive

Everything needed is in this folder. `server/.env` already holds your kie.ai key — keep this folder private.

## Option A — Docker (recommended, any Linux VPS)

1. Get an Ubuntu 22.04/24.04 server (2 GB RAM is enough) and point a DNS **A record** for `app.yourbrand.in` to its IP.
2. Install Docker:
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
3. Copy this folder to the server (from your PC):
   ```bash
   scp -r FunnelHive root@SERVER_IP:/opt/
   ```
4. On the server, edit `/opt/FunnelHive/server/.env` and set at least:
   ```
   APP_URL=https://app.yourbrand.in
   SERVER_IP=SERVER_IP
   JWT_SECRET=<any long random string>
   ADMIN_EMAILS=you@yourbrand.in
   SMTP_HOST=… SMTP_USER=… SMTP_PASS=…   (or RESEND_API_KEY=…) so emails go out
   ```
5. Start it with automatic HTTPS (app + sellers' custom domains):
   ```bash
   cd /opt/FunnelHive
   APP_DOMAIN=app.yourbrand.in ACME_EMAIL=you@yourbrand.in docker compose --profile https up -d --build
   ```
6. Open `https://app.yourbrand.in`, sign up with the `ADMIN_EMAILS` address and verify it — the **Admin** menu appears.
7. In **Admin → Plan & settings** add your company/GST details and your Razorpay keys, and in Razorpay add the webhook
   `https://app.yourbrand.in/api/billing/webhook` (events `subscription.*`). Sellers can now sign up and subscribe.

The app uses every CPU core (up to 4) automatically. For 1000 active sellers start with 4 vCPU / 8 GB (we measured 390 requests/second with zero errors on a 4-core machine); 2 vCPU / 4 GB is fine for the first few hundred.

Data (database, uploads, backups) lives in the `funnelhive-data` Docker volume and survives updates.

### Updating (with automatic rollback)

From your PC, send the new code and run `server/scripts/deploy.sh` **on the server** with a version label (the git
short sha):
```bash
SHA=$(git rev-parse --short HEAD)
git archive --format=tar.gz -o /tmp/fh.tgz HEAD
scp /tmp/fh.tgz root@SERVER_IP:/tmp/fh.tgz
ssh root@SERVER_IP "cd /opt/FunnelHive && tar xzf /tmp/fh.tgz && bash server/scripts/deploy.sh $SHA"
```
`deploy.sh <sha>` builds the image `funnelhive:<sha>` while the running app keeps serving, makes it
`funnelhive:current` (the one it replaces becomes `funnelhive:previous`), recreates only the app container (Caddy
keeps running and retries for up to 30 s during the few-second swap, so visitors wait instead of seeing a 502) and
waits for `/api/health`. If the new version isn't healthy within 90 s it switches back to the previous image by
itself and prints the new version's last log lines.
- `bash server/scripts/deploy.sh rollback` — go back to the previous version by hand (run it again to undo).
- `bash server/scripts/deploy.sh status` — which images are current / previous, and the app's health.

A plain `docker compose --profile https up -d --build` still works (it builds and runs `funnelhive:current`), it
just has no rollback. On `docker stop` / a deploy the app stops taking new requests, lets the ones in flight finish
(up to ~10 s) and flushes the database before it exits.

### Monitoring and backups
- **Uptime monitor** (e.g. UptimeRobot, free): watch `https://app.yourbrand.in/api/health` (app + database +
  background jobs + disk), `/api/health/backups` (503 when no fresh local / off-site backup, or the weekly restore
  drill failed) and `/api/health/disk` (503 when the data disk has less than 5% or 1 GB free).
- **Error reports (Sentry, free plan):** sign up at sentry.io → *Create project* → **Node.js** → open *Settings →
  Client Keys (DSN)* and copy the DSN into `server/.env` as `SENTRY_DSN=https://…@o….ingest.sentry.io/…`, then
  redeploy. Server errors, crashes and unhandled rejections are reported (stack, route, user id — never request
  bodies, headers or cookies; emails / phone numbers / tokens are masked) and the browser app reports with the same
  DSN (`SENTRY_DSN_PUBLIC` sends browser errors to a separate project instead).
- **Backups** run every hour (skipped when nothing changed), one file per day: the last 7 days on the server
  (`/data/backups`) and, with file storage set up, 90 days encrypted off-site. Once a week the newest off-site
  backup is downloaded, decrypted and checked (integrity, tables, row counts) — the result shows in Admin → Overview.
  `node server/scripts/restore-drill.mjs --bucket` runs the full drill by hand (it also boots the app on the copy).
- Container logs rotate (5 × 10 MB per container), so they can't fill the disk.

## Option B — plain Node.js (no Docker)

Needs Node.js 24 (22.13+ works).
```bash
cd FunnelHive
npm ci --prefix server --omit=dev
npm start                      # http://localhost:4000
```
The client is already built (`client/dist`, `client/dist-ssr`). After changing client code, rebuild with
`npm ci --prefix client && npm run build`. Put Caddy or Nginx in front for HTTPS (see `deploy/Caddyfile`), and keep
it running with `pm2 start "npm start" --name funnelhive` or a systemd service.

## Optional settings (`server/.env`)
- `SMTP_*` or `RESEND_API_KEY` — account emails (verify / reset password). Sellers add their own SMTP in Settings.
- WhatsApp and Razorpay keys are added per seller in Settings, not here.
- `CDN_URL` — serve uploaded images through a CDN.
- `ENCRYPTION_KEY` — the key stored secrets (sellers' SMTP passwords, WhatsApp tokens, payment keys) and off-site
  backups (`backups/funnelhive-YYYY-MM-DD.db.enc`, AES-256-GCM) are encrypted with. Without it the JWT secret is used,
  so changing `JWT_SECRET` later would make them unreadable. If the server has been running without it, set
  `ENCRYPTION_KEY` to the **current** `JWT_SECRET` value (or the contents of `.jwt-secret` in the data folder) — a new
  random value would break the secrets already saved. Keep a copy of it somewhere safe: an off-site backup can't be
  restored without it. The app warns at start-up when it isn't set.
- `PAGES_URL` — serve live funnel pages from their own domain, e.g. `https://pages.yourbrand.in`, so buyers' pages
  never share the dashboard's origin (logins, cookies, reputation). Without it pages are at `https://app…/f/<slug>`
  and the app warns at start-up. To set it up:
  1. DNS: an **A record** for `pages.yourbrand.in` → your server's IP.
  2. Caddy: add a site for it in `deploy/Caddyfile` (above the `https://` catch-all), then restart Caddy:
     ```
     pages.yourbrand.in {
     	encode zstd gzip
     	reverse_proxy funnelhive:4000 {
     		lb_try_duration 30s
     		lb_try_interval 500ms
     	}
     }
     ```
  3. `server/.env`: `PAGES_URL=https://pages.yourbrand.in`, then restart the app. Existing `/f/…` links on the app
     address keep working.

## Security notes
- **Admin panel:** platform admins must turn on 2-step verification (Settings → Security) before **Admin** opens.
- Sessions last 14 days and slide while in use; Settings → Security lists each signed-in device and can sign them out.
- With email not configured, production logs never show sign-in or reset links. To help a seller, open
  **Admin → Sellers → (seller) → Create password-reset link** (valid 1 hour, works once, written to the audit log).

See `server/.env.example` for every option and `README.md` for features.
