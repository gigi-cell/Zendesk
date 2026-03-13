# CAPGOWN AI Customer Service Agent

This project turns your CAPGOWN customer service pipeline into a Zendesk-connected AI workflow.

## What it does

- Receives Zendesk ticket webhooks on `/webhook/zendesk`
- Exposes a browser test portal on `/portal`
- Classifies each inquiry into CAPGOWN support categories
- Assigns ticket priority
- Drafts a customer reply
- Keeps Zendesk in draft-only mode by default so agents review before sending
- Provides a Zendesk sidebar app that lets agents review drafts inside Zendesk

## Core files

- `server.js`: Express backend for webhook handling and sidebar analysis
- `openai.js`: OpenAI Responses API integration with structured JSON output
- `policies.js`: CAPGOWN policy definitions and auto-reply rules
- `zendesk.js`: Zendesk ticket update logic
- `assets/index.html`: Zendesk sidebar app UI
- `assets/portal.html`: browser testing portal
- `manifest.json`: Zendesk app manifest
- `CAPGOWN_DOC_AUDIT.md`: audit notes from the master doc and linked subdocs
- `Dockerfile`: container deployment entrypoint

## Environment variables

Copy `.env.example` and set:

- `OPENAI_API_KEY`
- `OPENAI_MODEL` (default is `gpt-5-mini`)
- `ZENDESK_SUBDOMAIN`
- `ZENDESK_EMAIL`
- `ZENDESK_API_TOKEN`
- `ZENDESK_WEBHOOK_SECRET`
- `DRAFT_ONLY_MODE` (`true` recommended and now the default behavior)
- `AUTO_REPLY_ALL` (`false` recommended to start)

## Suggested deployment flow

1. Deploy the backend on a Node 18+ host such as Railway, Render, or Fly.
2. Set the environment variables on that host.
3. Open `https://your-domain.com/portal` to test the agent with sample or pasted CAPGOWN tickets.
4. In Zendesk, create a webhook pointing to `https://your-domain.com/webhook/zendesk`.
5. In Zendesk, package/install the app using this `manifest.json` and set `webhook_url` to your backend base URL such as `https://your-domain.com`.
6. Start with webhook-driven draft generation plus human review.
7. Keep `DRAFT_ONLY_MODE=true` unless you explicitly want to experiment with autonomous sending later.

## Vercel

This repo can also be used on Vercel.

1. Import the repo into Vercel.
2. Set the same environment variables listed above.
3. Deploy.
4. Open `/portal.html` on the deployed domain to test the browser portal.
5. Point Zendesk webhooks at `/webhook/zendesk` and the sidebar backend setting at the Vercel base URL.

## CAPGOWN categories implemented

- Exchange
- Shipping
- Sizing
- Order Update
- Return
- Refund/Cancellation
- Out of Stock
- Rental
- Rental Keeper
- Invoice/Receipt
- Gender Neutral Inquiry
- Tax Exemption
- Missing Garment Bag
- No Local Office
- Pre-Order
- Fraud Alert
- Hood/Piping Verification
- International Delivery

## Notes

- The Zendesk sidebar now calls your backend instead of exposing a model API key in the browser.
- The `/portal` page is a safe testing surface that does not write back to Zendesk.
- The portal is also copied into `public/portal.html` so it can be served cleanly on Vercel.
- The repo includes a `Dockerfile`, so this can be deployed on any Docker-friendly host.
- The CAPGOWN policy audit is documented in `CAPGOWN_DOC_AUDIT.md`.
- Zendesk is now draft-only by default.
- The current environment did not have Node installed, so runtime execution was not tested locally here.
