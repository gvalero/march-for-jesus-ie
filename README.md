# March for Jesus Dublin

Static website for [marchforjesus.ie](https://marchforjesus.ie) — March for Jesus Dublin, 26th September 2026.

## Tech Stack

- Static HTML, CSS, JavaScript
- Google Fonts (Playfair Display + Inter)
- Hosted on Cloudflare Workers (assets), sister site of Belfast (`.co.uk`)

## Local Development

Open `index.html` in a browser. No build tools required.

## Deployment

This site is deployed via **Cloudflare Workers**. Pushing to `main` triggers the GitHub Actions workflow (`.github/workflows/deploy.yml`), which runs the Worker unit tests and then `wrangler deploy` against the root `wrangler.jsonc`. The site Worker is named `mfj-ie-mailerlite-proxy` (do not rename to the Belfast `mfj-*` name — it would overwrite the live Belfast Worker).

Required repository secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

### Merch Worker deployment

The merch checkout Worker uses Cloudflare D1 migrations. When a change includes files in `worker/migrations/`, apply the remote D1 migrations before deploying the Worker code:

1. `cd worker`
2. `wrangler d1 migrations apply mfj_ie_merch_orders --remote --config wrangler.merch.toml`
3. `wrangler deploy --config wrangler.merch.toml`

For order confirmation emails, the Worker also requires Microsoft Graph mail permissions for `MERCH_CONFIRMATION_SENDER` (`information@marchforjesus.ie` — an M365 mailbox in the `allnations.ie` tenant).

### Custom Domain Setup

`marchforjesus.ie` is registered at Letshost.ie. Once the site is tested on `*.workers.dev`, move the zone to Cloudflare, attach the custom domain to the site Worker, and switch the Letshost nameservers to Cloudflare. (Renew the domain before its 2026-09-04 expiry.)

## Adding Photos

Replace the placeholder files in `images/` with real JPG/PNG photos. Update the `src` attributes in `index.html` accordingly.
