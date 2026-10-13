# ColmapView Hub

A small companion to [ColmapView](https://github.com/ColmapView/Colmapview.github.io): save a viewer link, its metadata, and a thumbnail after a public upload. ColmapView automatically shortens public Hugging Face and shared Drive links, and checks bucket uploads without credentials before shortening them. Private uploads keep their original viewer link and send nothing to the Hub. Select **List on Hub** separately to show a public result in the gallery; listing defaults to off. There is no standalone submission or dataset upload form on the Hub.

The card page provides an X/Twitter large-image preview and a Play 3D button that loads the existing viewer only on a click. The homepage shows only creators' explicit listings.

Target address: `https://colmapview.opsiclear.com/hub/`. A separate Cloudflare Worker owns only `/hub` and `/hub/*`; the existing Pages viewer and its other routes remain separate. The origin and base path are configurable for a future subdomain.

## What is stored

One JSON object in a private R2 bucket per link: the viewer URL (including its camera/settings fragment), title, description, optional supplied license information, a base64 JPEG, creation time, and ownership hashes. The client prepares a 600 × 315 JPEG around 70% quality, preserving aspect ratio against a dark background and reducing quality if needed to fit 64 KiB. Canvas re-encoding removes source image metadata. `og:image` uses an ordinary public HTTPS JPEG endpoint, not a data URL.

New uploads also include a small `assets` summary: folder or ZIP format, original or JPEG image encoding, counts of COLMAP files, cameras, points, images, masks, and Gaussian splats, and whether viewer settings and a dataset cover are present. Counts come from the actual prepared upload inventory and survive ZIP packaging and retries. The result card, gallery, and social-card description show the available asset types. Earlier links without a summary remain valid and show no guessed counts. No per-file list or additional storage index is needed.

No dataset files, provider credentials, accounts, database, storage browser, search, or sitemap. The server never fetches submitted dataset URLs. Play 3D embeds the existing viewer; storage access and sign-in remain the viewer's responsibility. X receives a thumbnail card, not an inline WebGL player.

Links are **unlisted by default, not authenticated**. Anyone with a link can read its metadata and preview; publicly disclosed links can be collected. Opted-in listings appear in the gallery. Existing dataset storage permissions still apply. Deletion removes the Hub's complete record and its listing together; external social-card caches may retain previously fetched previews.

## IDs and ownership

IDs combine an adjective and noun with a 96-bit suffix, independently of the source URL or title. Listed links use an extra `L` before the suffix and a separate HMAC domain. They reside in the `listed/` R2 namespace; unlisted links remain in `links/`. The gallery scans only `listed/`, reading bounded titles from object metadata. A listing and its complete record share one conditional R2 write, so there is no separate index to become stale. IDs from the two namespaces cannot be derived from one another.

The real 4,096-adjective and 8,192-noun dictionaries are private server configuration in `internal/wordlists-v1.json`, never Git or client assets. Private word lists alone are not an enumeration defense.

A browser generates a 256-bit management key before submitting. Its hash is stored; the raw key stays in the browser and in the private management link's URL fragment. Save that link to delete the record later. Creation retries with the same key and content are idempotent; concurrent writes cannot replace an existing record. Keep `HUB_KEY` and the version-1 dictionary configuration stable for deterministic creation retries.

Three different missing/malformed IDs in ten minutes produce a ten-minute cooldown for that client IP. Duplicate page/image/HEAD failures count once. All lookup surfaces honor the same guard, including the gallery; known IDs with incorrect deletion keys fail identically to unknown IDs. IPs are HMAC-keyed before actor routing; no raw IP is stored in application state. Shared IPs share the cooldown, and changing IPs bypasses an IP guard. There is no User-Agent exemption or human verification. Creation is limited to 20 attempts per hour per IP. Creation and deletion accept only the configured Hub/viewer origins and loopback development origins.

## Development

```sh
npm ci
npm run dev
```

Open `http://localhost:5201/hub/`. Development uses explicitly local R2/DO state and public fixture word lists. Private dictionaries and production credentials are not needed. The dev launcher copies `.dev.vars.example` only if `.dev.vars` does not already exist. Create links through the API for isolated Hub tests, or use ColmapView's upload dialogs for the complete flow.

```sh
npm run check
npx playwright install chromium
npm run test:browser
```

Workers tests execute against the actual Workers/R2/SQLite Durable Object runtime. Browser checks create records through the API, display cards and opted-in listings, play, and delete local records at desktop and phone sizes. The viewer frame is intercepted in the browser test, so it tests the integration contract rather than rendering a full dataset. No production dataset storage is used.

## Production setup

Authenticate Wrangler with the Cloudflare account that owns the `opsiclear.com` zone. The account ID is set in `wrangler.jsonc`; deployments require access to Workers routes, R2, and Durable Objects.

1. Create the private R2 bucket `colmapview-hub`. Do not enable an R2 public URL or custom domain.
2. Configure `HUB_KEY` as 32 cryptographically random bytes encoded as unpadded base64url through `wrangler secret put`. Never put it in source, public assets, or GitHub output.
3. Prepare and upload the immutable private dictionary configuration from its private folder:

```sh
node scripts/prepare-wordlists.mjs /absolute/private/dictionary-folder
npx wrangler r2 object put colmapview-hub/internal/wordlists-v1.json --remote --file /absolute/private/dictionary-folder/wordlists-v1.json
```

4. Run the checks, then `npm run deploy`. The two exact Worker routes in `wrangler.jsonc` mount only the Hub path. Verify the existing viewer root and `/hub/` independently.

WordNet's source license is preserved inside the private configuration. License information attached to a dataset link is supplied by its creator; the Hub does not infer or grant dataset rights.
