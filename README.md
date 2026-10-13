# ColmapView Hub

A small companion to [ColmapView](https://github.com/ColmapView/Colmapview.github.io): save an unlisted viewer link, its metadata, and a thumbnail. The card page provides an X/Twitter large-image preview and a Play 3D button that loads the existing viewer only on a click.

Target address: `https://colmapview.opsiclear.com/hub/`. A separate Cloudflare Worker owns only `/hub` and `/hub/*`; the existing Pages viewer and its other routes remain separate. The origin and base path are configurable for a future subdomain.

## What is stored

One JSON object in a private R2 bucket per link: the viewer URL (including its camera/settings fragment), title, description, optional supplied license information, a base64 JPEG, creation time, and ownership hashes. The client prepares a 600 × 315 JPEG around 70% quality, preserving aspect ratio against a dark background and reducing quality if needed to fit 64 KiB. Canvas re-encoding removes source image metadata. `og:image` uses an ordinary public HTTPS JPEG endpoint, not a data URL.

No dataset files, provider credentials, accounts, database, directory, search, or sitemap. The server never fetches submitted dataset URLs. Play 3D embeds the existing viewer; storage access and sign-in remain the viewer's responsibility. X receives a thumbnail card, not an inline WebGL player.

Links are **unlisted, not authenticated**. Anyone with a link can read its metadata and preview; publicly disclosed links can be collected. Existing dataset storage permissions still apply. Deletion removes the Hub's complete record; external social-card caches may retain previously fetched previews.

## IDs and ownership

IDs combine an adjective and noun with a 96-bit suffix, independently of the source URL or title. The real 4,096-adjective and 8,192-noun dictionaries are private server configuration in `internal/wordlists-v1.json`, never Git or client assets. Private word lists alone are not an enumeration defense.

A browser generates a 256-bit management key before submitting. Its hash is stored; the raw key stays in the browser and in the private management link's URL fragment. Save that link to delete the record later. Creation retries with the same key and content are idempotent; concurrent writes cannot replace an existing record. Keep `HUB_KEY` and the version-1 dictionary configuration stable for deterministic creation retries.

Three different missing/malformed IDs in ten minutes produce a ten-minute cooldown for that client IP. Duplicate page/image/HEAD failures count once. All lookup surfaces honor the same guard; known IDs with incorrect deletion keys fail identically to unknown IDs. IPs are HMAC-keyed before actor routing; no raw IP is stored in application state. Shared IPs share the cooldown, and changing IPs bypasses an IP guard. There is no User-Agent exemption and no CAPTCHA on card/image reads. Creation requires server-validated Turnstile and is limited to 20 attempts per hour per IP.

## Development

```sh
npm ci
npm run dev
```

Open `http://localhost:5201/hub/`. Development uses explicitly local R2/DO state, public fixture word lists, and official Turnstile test keys. Private dictionaries and production credentials are not needed. The dev launcher copies `.dev.vars.example` only if `.dev.vars` does not already exist.

```sh
npm run check
npx playwright install chromium
npm run test:browser
```

Workers tests execute against the actual Workers/R2/SQLite Durable Object runtime. Browser checks create, display, play, and delete local records at desktop and phone sizes. The browser Turnstile script is stubbed with a documented dummy token; the local backend uses Cloudflare's official test verification endpoint. The viewer frame is intercepted in the browser test, so it tests the integration contract rather than rendering a full dataset. No production dataset storage is used.

## Production setup

Authenticate Wrangler with the Cloudflare account that owns the `opsiclear.com` zone and set `CLOUDFLARE_ACCOUNT_ID` to that account before provisioning or deploying. The account must have access to Workers routes, R2, Durable Objects, and Turnstile.

1. Create the private R2 bucket `colmapview-hub`. Do not enable an R2 public URL or custom domain.
2. Create a Turnstile widget restricted to `colmapview.opsiclear.com` (and `colmapview.github.io` if creation will later be integrated there). Set its public site key in `wrangler.jsonc`.
3. Configure `HUB_KEY` as 32 cryptographically random bytes encoded as unpadded base64url, and `TURNSTILE_SECRET_KEY` through `wrangler secret put`. Never put either in source, public assets, or GitHub output.
4. Prepare and upload the immutable private dictionary configuration from its private folder:

```sh
node scripts/prepare-wordlists.mjs /absolute/private/dictionary-folder
npx wrangler r2 object put colmapview-hub/internal/wordlists-v1.json --remote --file /absolute/private/dictionary-folder/wordlists-v1.json
```

5. Run the checks, then `npm run deploy`. The two exact Worker routes in `wrangler.jsonc` mount only the Hub path. Verify the existing viewer root and `/hub/` independently.

WordNet's source license is preserved inside the private configuration. License information attached to a dataset link is supplied by its creator; the Hub does not infer or grant dataset rights.
