# FunnelHive on Zapier

A ready-to-publish Zapier integration built on FunnelHive's public API (API keys + REST hooks).

## Publish it (once, by the FunnelHive team)
1. `npm i -g zapier-platform-cli` and `zapier login`
2. In this folder: `npm install`
3. `zapier register "FunnelHive"` (first time only)
4. `zapier env:set 1.0.0 FUNNELHIVE_URL=https://app.yourdomain.in`
5. `zapier push`, test it in the Zap editor, then invite users or submit it for the public directory.

Sellers connect it with an API key from **Settings → API & integrations** (full access).

## What it does
- **Instant triggers:** New Lead, New Order, Order Refunded, Order Shipped, Membership/Instalment Payment Failed, New Booking, Booking Cancelled, Webinar Registration
- **Actions:** Create or Update Contact (with tags — tag automations run), Start an Automation for a Contact, Give Access to a Product

Pabbly Connect, Make and n8n don't need an app: use their HTTP / webhook modules with the same API (in-app reference at `/developers`).
