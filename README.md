# ColmapView Hub

A small companion to [ColmapView](https://github.com/ColmapView/Colmapview.github.io). It saves a viewer link, its metadata and a thumbnail for every upload made from ColmapView, and shows them as a card. Data anyone can open without signing in gets a short name such as `HappyTree`, unless it is listed in the gallery; a listed link gets a long `-L` name such as `HappyTree-Lq3ZfK0aB7xLmP2Ws`. Everything else gets an unguessable name such as `HappyTree-q3ZfK0aB7xLmP2Ws`. There is no standalone submission or dataset upload form on the Hub.

Cards provide an X/Twitter large-image preview. Public cards have a Play 3D button that loads the viewer only on a click; private cards link to the viewer instead, because signing in inside an iframe is unreliable. The gallery of listed results is off unless `HUB_LISTINGS_ENABLED` is `true`; while it is off, `/hub/` shows a short landing page.

Target address: `https://colmapview.opsiclear.com/hub/`. A separate Cloudflare Worker owns only `/hub` and `/hub/*`; the Pages viewer and its other routes stay separate. Cloudflare serves the client assets, fonts, catalog metadata shards, collection pages, stylesheets and favicon directly from `public/hub/`. The individual model browser and detail routes run in the Worker. That folder, the routes, `run_worker_first` and `public/_headers` must all match `HUB_PATH`.

## Public dataset catalog

`/hub/datasets/` shows one card per named scene dataset. Reconstruction folders, camera metadata and named public captures establish scene identities. Camera train/validation/test metadata, reconstruction variants and companion assets stay inside their scene. Standalone PLY, STL, OBJ and other model filenames do not create cards. Filters cover dataset, scene type, source, license, evidence, browser delivery and checked viewer links. Images remain deferred; catalog pages make no image or provider requests.

The source snapshot lives in `data/catalog.json`; `data/individual-datasets.json` and its checksummed, compressed source listings preserve individual model identities. Python 3.11+ is required for the offline index build. `npm run catalog:import -- --viewer-root PATH` refreshes the collection metadata and reapplies the pinned individual listing. See [data/README.md](data/README.md) for refresh commands and qualification limits. The normal dev, check and deploy commands build static metadata packs and compact search posting lists. The Worker reads bounded same-origin assets through `CATALOG_ASSETS`, rendering one requested page or model. The browser fetches only the current results page.

Cards and filters distinguish **Commercial use**, **Non-commercial (NC)** and **Not specified** using reported source license metadata. Individual entries inherit their source category and retain the exact license string. Missing, custom, conflicting or unclear terms remain Not specified. Conditions such as attribution, share-alike, acceptable-use restrictions and asset-specific licenses still apply. `npm run catalog:licenses` refreshes these categories without the original survey CSVs.

Hub pages use the viewer's compact controls, neutral palettes and shared `colmap-viewer-theme` preference (Dark, Light or System). The catalog fills the available width. Cards expose metadata on hover, keyboard focus or the touch info button; Escape dismisses it. Metadata adapts to scrolling and viewport changes, closing when its card leaves the screen. A primary click opens a verified camera-and-photo scene through a same-origin redirect. Gated, extraction-only, unsupported, known-failed, geometry-only and unverified scenes are excluded from public browsing and metadata. Listed COLMAP files, readable headers and successful companion-file imports do not qualify a scene. Opening a scene resolves fixed catalog assets only; the Worker never downloads source data.

Search replaces results asynchronously. Filter changes support browser Back and Forward; text changes in the same editing session share one history entry. Load more appends 24 entries while retaining the current filters and results. Aborted or late responses cannot replace a newer search; failed appends retain the previous entries and offer a retry. Failed searches label the retained entries as previous results. Collection search downloads can be retried without reloading, preserving filters and the requested page. A changed catalog generation refreshes the first results page before mixing inventories. Server-rendered filters, model links and pagination remain available without JavaScript. Additional filters, coverage notes and metadata downloads are folded away from the main browsing view.

Published collection URLs remain available under `/hub/datasets/collections` and their original detail paths. Scene URLs use `/hub/datasets/entry/data-…`, with identity derived from the source and scene path independently of scan dates or revisions. `/hub/datasets/`, `/hub/datasets/entry/*` and `/hub/datasets/api/*` must reach the Worker; `run_worker_first` excludes only the fixed static catalog prefixes. These routes and generated asset names must stay aligned.

The public Hub includes only collections with at least one verified camera-and-photo scene. Its **3 source collection records** remain separate from the scene catalog. Complete file inventories stay in `data/` for research; file counts are not dataset counts. `data/verified-scenes.json` records exact pinned scene identities, original photograph hashes, reviewed export checksums and complete import/export checks. Changed revisions, scene identities, required file paths or launch targets fail the build until rechecked. The pinned negative reviews in `data/scene-exclusions.json` and source access/RGB exclusions still apply. Collection pages cannot inherit an unqualified sample viewer link. Response caches include the catalog generation and UI version, so removed file pages and old templates cannot return from an older Worker cache. Public catalog responses require browser revalidation and disable outer CDN caching; the Worker retains a separate five-minute internal cache. Bump the UI version in asset URLs and `individual-routes.ts` together when changing rendered templates or client assets.

The current scene catalog has **3 verified named scenes from 3 source collections**: the native `example-colmap-glomap` reconstruction, native BMVS basketball reconstruction, and PanoWorld `panorama_0000` camera-and-image scene. All registered original photographs, camera calibration and poses passed independent checks on actual deployed-viewer COLMAP + images exports. PanoWorld has no point cloud. Masks, other variants and sibling scenes remain unqualified. Download the current evidence from `/hub/datasets/individual/verified-scenes.json`.

The research inventory retains archive extraction requirements and import/delivery failures, but those cases are not published as datasets. Sample imports, model-only manifest checks and extracted-file checks retain separate scopes. See [the qualification audit](data/README.md#full-inventory-audit) and the public `/hub/datasets/audit` page.

These are operator-curated public source entries. Upload share links retain their existing preview, ownership and listing behavior. The dataset catalog never enumerates private R2 link records.

## What is stored

One JSON object per link in a private R2 bucket:
- the viewer URL, including its camera and settings fragment;
- the title, description, optional license name and URL, and an asset summary;
- a base64 JPEG preview;
- the creation time and ownership hashes;
- `access: "private"`, on private links only.

The viewer crops its preview to fill 600 × 315 and keeps it under 64 KiB. The Hub rejects JPEGs that carry EXIF (APP1) or comment segments. `og:image` is an ordinary public HTTPS JPEG endpoint, cached for five minutes.

The asset summary counts images, points, masks and Gaussian splats; cards show the nonzero counts. Records are read tolerantly: a page needs only a title, an http(s) viewer URL and a preview, so records written by older Hubs keep rendering.

The Hub has no dataset payloads, provider credentials, accounts, database, storage browser or sitemap. Catalog search covers only published dataset metadata. The server never fetches submitted dataset URLs. X receives a thumbnail card for upload share links, not an inline WebGL player.

Anyone with a link can read its card, and publicly disclosed links can be collected. Dataset storage permissions still apply. Deletion removes the record and any listing together; external social-card caches may keep previews they already fetched, and `preview.jpg` is served with `max-age=300`, so browsers and shared caches may keep a fetched preview for up to five minutes. With listings on, gallery pages are cached for a minute. A deletion clears the cached first page in the data center that handled it; a deleted listing can stay for up to a minute in other data centers and on later pages, and a browser may keep a page it already fetched for another minute.

## IDs and ownership

**Public, unlisted requests** (no `access`, or `access: "public"`):
- They try sixteen deterministic HMAC word-pair candidates, with create-only R2 writes, so no write replaces another owner's record.
- Every candidate is checked for this owner's record before a vacancy is used, so retries keep the same name even after an earlier collision is deleted.
- When all sixteen are taken, the Hub answers 409.

**Private requests** get one long name from the `link:` HMAC domain. That is the scheme unlisted links used before word pairs, and those legacy links keep resolving.

**Listed links** get one long name from the `listed-link:` domain, with an `-L` suffix, in the `listed/` namespace. The gallery scans only `listed/`.

**Word lists:**
- The 4,096-adjective and 8,192-noun dictionaries give 33,554,432 short names (about 25 bits).
- They are private server configuration in `internal/wordlists-v1.json`, never in Git or client assets. Each isolate keeps them once read.
- Short names are only for data that is public anyway, and the lookup cooldown remains essential.

**Management key:**
- The browser generates a 256-bit management key before submitting.
- Its hash is stored. The raw key stays in the browser and in the private delete link's fragment (`/hub/manage/<id>#<key>`).
- A retry with the same key and content is idempotent; changed content answers 409.
- Keep `HUB_KEY` and the version-1 dictionaries stable so retries stay deterministic.

## Lookup guard

**The three-miss rule:**
- Three different missing or malformed names in ten minutes block a client for ten minutes.
- Duplicate page, preview and HEAD misses count once, and so do letter-case variants of one name.
- Names typed in another letter case resolve through the word lists and redirect with 308. Unused and invalid word pairs behave identically.
- Every lookup surface uses the same guard, including the manage page and deletion. A known name with a wrong key fails with the same status, body and strike as an unknown one.
- Each client gets 20 creation attempts per hour; an attempt from an allowed origin counts even if the Hub then rejects it.
- Refusals (429) are sent no sooner than half a second after the request arrived, so their timing normally doesn't show whether a guessed name exists (a record read slower than half a second can).

**Keying and storage:**
- Clients are keyed by an HMAC of their IPv4 address or their IPv6 /64 network. IPv4-mapped addresses count as IPv4, and no raw IP is stored.
- Shared networks share the cooldown, and changing networks bypasses it.
- The guard keeps one small value in a SQLite Durable Object's synchronous KV store, and only while something is pending.
- The guard's alarm deletes that value at most an hour after the client's last miss or creation. A client that only finds links stores nothing.

**Two exceptions to the three-miss rule, neither based on the User-Agent:**
- Another site embedding a preview or card sends `Sec-Fetch-Site: cross-site` with a `Sec-Fetch-Dest` other than `document`. Cross-site prefetches (`Sec-Purpose: prefetch`) are treated the same way, so another site's embeds and prefetches cannot spend a visitor's misses. Such a request gets a plain 404, with no lookup and no strike. `/api/` is exempt.
- If the optional secret `VERIFIED_BOT_TOKEN` is set, a request carrying it in `X-Hub-Verified-Bot` may make 30 misses per ten minutes, still per network. A Cloudflare Transform Rule adds that header for verified bots.

Creation and deletion accept the Hub's own origin and the two viewer origins. Loopback origins and loopback viewer URLs are accepted only when the Hub itself runs on loopback.

## Look

Hub pages use ColmapView's public-page design.
- `public/hub/colmapview.css` is a byte-for-byte copy of the viewer's `public/policy.css`. Its IBM Plex Sans font and license are in `public/hub/fonts/`.
- `public/hub/styles.css` adds only the Hub's own parts.
- `npm run check` runs `scripts/check-colmapview-css.mjs`, which compares the copy's SHA-256 with a pinned value. The viewer's `src/theme/policyCssCopy.test.ts` pins the same value.
- To update the copy, copy the viewer's file, then change the hash in both places.

## Development

```sh
npm ci
npm run dev
```

Open `http://localhost:5201/hub/`.
- Development uses local R2 and Durable Object state and public fixture word lists. Private dictionaries and production credentials are not needed.
- The dev launcher copies `.dev.vars.example` only when `.dev.vars` doesn't exist yet.
- To create links from a local viewer, run it with `VITE_HUB_BASE_URL=http://localhost:5201/hub`. A local Hub accepts loopback origins and viewer URLs.

```sh
npm run check
npx playwright install chromium
npm run test:browser
```

Workers tests run against the real Workers, R2 and SQLite Durable Object runtime. Browser checks create records through the API; display, play and delete cards; and check the look in both color schemes. The viewer frame is intercepted, so they test the integration contract rather than rendering a full dataset.

## Production setup

Authenticate Wrangler with the Cloudflare account that owns the `opsiclear.com` zone. The account ID is set in `wrangler.jsonc`. Deployments need access to Workers routes, R2 and Durable Objects.

1. Create the private R2 bucket `colmapview-hub`. Don't enable an R2 public URL or custom domain.
2. Set `HUB_KEY` with `npx wrangler secret put HUB_KEY`: 32 cryptographically random bytes, encoded as unpadded base64url. Never put it in source, public assets or GitHub output.
3. Prepare and upload the immutable private dictionary configuration from its private folder:

```sh
node scripts/prepare-wordlists.mjs /absolute/private/dictionary-folder
npx wrangler r2 object put colmapview-hub/internal/wordlists-v1.json --remote --file /absolute/private/dictionary-folder/wordlists-v1.json
```

4. Optional: add a Transform Rule that sets `X-Hub-Verified-Bot` for Cloudflare's verified bots on `/hub/*`, then run `npx wrangler secret put VERIFIED_BOT_TOKEN` with the same value. Also optional: a WAF rate-limiting rule for `/hub/*`.
5. Run the checks, then `npm run deploy`.
   - Migration `v2` replaces the `ClientGuard` class with `LookupGuard` and deletes the old per-client storage, so active cooldowns reset once.
   - After deploying, check that `/hub/styles.css` returns 200 with an `ETag` and `X-Content-Type-Options: nosniff`, and that `/hub/<id>`, `/hub/<id>/preview.jpg`, `/hub/manage/<id>` and `/hub/api/links` still reach the Worker.
   - Check the viewer root and `/hub/` separately.
   - Deploy the Hub before releasing a viewer that sends `access`.

WordNet's source license is preserved inside the private configuration. License information attached to a dataset link comes from its creator; the Hub neither infers nor grants dataset rights.
