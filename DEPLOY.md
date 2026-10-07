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

Update later: copy the new files over, then run the same `docker compose … up -d --build` again. Data (database,
uploads, daily backups) lives in the `funnelhive-data` Docker volume and survives updates.

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

See `server/.env.example` for every option and `README.md` for features.
