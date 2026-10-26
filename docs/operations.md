# Production setup

The gallery is served on both OpsiClear and GitHub Pages. `npm run build:assets` exports public HTML and matching content-hashed scripts/styles under `/hub/assets/github/`, with a committed-source manifest. Builds are offline. Keep the older hashed assets available so each frontend can deploy independently without mixing templates and bundles. The GitHub frontend reads the current public catalog APIs with credentials omitted and uses OpsiClear for public assets and licensed fonts. Search, metadata, pagination and Back stay on the selected frontend; dataset launches select its matching viewer. Private records, secrets and naming configuration are never exported.

After a Hub UI/backend release, run the viewer repository's **Deploy GitHub Hub frontend** workflow (also checked hourly). It downloads only fixed public export paths, verifies committed-source metadata and exact hashes, tests the gallery with read-only permissions, then publishes only `/hub` in a separate write-permission job. No Cloudflare or cross-repository secret is required. Unchanged exports create no Pages commit. Viewer root releases preserve these gallery pages. See [dual-host deployment](https://github.com/ColmapView/Colmapview.github.io/blob/main/docs/dual-hosting.md).

For release exports, commit the Hub changes, then run `npm run build:github` from that clean checkout before `npm run deploy`. The downloader rejects dirty-source exports. Check the public `/hub/assets/github/site.json`, `/hub/datasets/api/index` and curated `/hub/datasets/api/entry/data-…` routes. API CORS allows the fixed viewer origins; public bundles and fonts allow anonymous cross-origin reads. The optional `preview=inline` public feed returns bounded JPEGs only after fresh checks of verified public opt-ins. Unlisted/private preview lookup protections remain unchanged.

Keep `assets.html_handling` set to `none`: export downloads must return exact `.html` files without redirects. The HTTP browser check verifies this through the asset service, including body hashes and CORS. The Worker preserves the existing `/hub/datasets/audit` aliases with an explicit redirect to `audit.html`.

Authenticate Wrangler with the Cloudflare account that owns the `opsiclear.com` zone. The account ID is set in `wrangler.jsonc`. Deployments need access to Workers routes, D1 and Durable Objects.

The remembered-connection service was retired on October 20, 2026 after approval. The [retirement runbook](account-sessions.md) records namespace-deletion and secret-removal checks. Preserve this migration and the browser-only contract when deploying or rolling back; public Hub cards and the catalog remain available.

1. Create D1 with `npx wrangler d1 create colmapview-hub`, set its `HUB_DB` binding/ID in `wrangler.jsonc`, then run `npx wrangler d1 migrations apply colmapview-hub --remote`. Existing deployments retain their configured database ID. No R2 binding or public database endpoint is used.
2. Set `HUB_KEY` with `npx wrangler secret put HUB_KEY`: 32 cryptographically random bytes, encoded as unpadded base64url. Never put it in source, public assets or GitHub output.
3. Prepare and store the immutable private dictionary configuration from its private folder:

```sh
node scripts/prepare-wordlists.mjs /absolute/private/dictionary-folder
node scripts/set-wordlists.mjs --remote --file /absolute/private/dictionary-folder/wordlists-v1.json
```

4. Optional: add a Transform Rule that sets `X-Hub-Verified-Bot` for Cloudflare's verified bots on `/hub/*` and `/s/*`, then run `npx wrangler secret put VERIFIED_BOT_TOKEN` with the same value. Also optional: a WAF rate-limiting rule covering both prefixes.
5. Run the checks, then `npm run deploy`.
   - Migration `v2` replaces the `ClientGuard` class with `LookupGuard` and deletes the old per-client storage, so active cooldowns reset once.
   - After deploying, check that `/hub/styles.css` returns 200 with an `ETag` and `X-Content-Type-Options: nosniff`, and that `/hub/<id>`, `/hub/<id>/preview.jpg`, `/hub/manage/<id>` and `/hub/api/links` still reach the Worker. The create API is POST-only: a GET returns 404. Use its allowed-origin OPTIONS preflight or an invalid empty POST (which must fail validation without creating a record) for a read-only smoke check.
   - Browser navigations to `/s/<id>`, `/s/d/<code>` and legacy `/hub/<id>` return the native viewer document with HTTP 200 and no `Location` header. Verify that the address stays short after loading and reloading. Check `/s/<id>/preview.jpg` too. Non-navigation metadata requests return the social preview page. Both namespaces use the same record and cooldown checks.
   - Before enabling native short-address launches, deploy viewer 0.24.2 or later to the custom host. `HUB_VIEWER_ORIGIN` points only at its operator-owned Pages origin (`https://colmapview-opsiclear.pages.dev`). Verify the app shell's `colmapview-hub-launch` capability marker and root-absolute asset paths. The Hub rejects old or unavailable shells with 503 rather than opening an empty viewer or expanding the URL. Keep the custom host and Pages origin on the same viewer release.
   - Check the viewer root and that `/hub/` opens `/hub/datasets/` when listings are off. Old collection URLs should redirect to the matching scene filter.
   - Check `/auth/session` without a cookie: it must be uncacheable, create no cookie and report every capability disabled. Old connection/token/signing endpoints must return 410. Follow the retirement runbook for namespace deletion and unused-secret cleanup.
   - Deploy the Hub before releasing a viewer that sends `access`.

WordNet's source license is preserved inside the private configuration. License information attached to a dataset link comes from its creator; the Hub neither infers nor grants dataset rights.

## Curated dataset names

`npm run catalog:names` refreshes qualified scene IDs offline and reports missing
names. With the existing Wrangler account, run `npm run catalog:names -- --apply`
to reserve missing adjective/noun pairs, then `npm run catalog:names -- --verify`
to check exact assigned keys. The allocator uses the existing private naming
configuration only in process memory, samples with Web Crypto, and never lists
unlisted records. Conditional SQL inserts share the upload namespace, so an existing
upload or concurrent reservation cannot be overwritten. No new credential is
created.

Commit `data/catalog-share-names.json` with the catalog change, run the checks and
deploy. Builds reject published scenes without their matching committed name.
Names are assigned once, independently of source URLs, and retained if a scene is
removed. Do not recycle or rename them. The resumable allocation journal stays in
`.tmp/`; a failed run preserves its completed reservations and can be rerun.
Curated alias records contain a dataset ID and timestamp, with no upload owner,
management secret, source credential or duplicated preview. Public APIs cannot
create or delete these reservations. The old dataset-code routes keep working.

Public community submissions use a separate rollout. Production enables `HUB_PUBLICATIONS_ENABLED` with a managed Turnstile widget restricted to the two viewer hosts; keep `HUB_LISTINGS_ENABLED=false`. A missing Turnstile secret disables submissions. Follow [the publication setup and review runbook](publication.md), then test one verified listing, one pending source and one rejected challenge. Deploy the Hub before releasing the viewer button. Existing share links and the curated catalog do not depend on this flag.

## D1 backups and recovery

The migration completed on October 26, 2026. The former `colmapview-hub` R2 bucket and its 4,569 objects (855,131 bytes) were deleted after approval. A private SQL export was restored and verified against all 4,569 migrated records and all nine preview JPEGs. The one-time R2 importer and its binding configuration have been removed. Roll back only to a D1-compatible Worker; R2-only versions cannot serve this deployment.

Create backups outside the repository:

```sh
npx wrangler d1 export colmapview-hub --remote --output /secure/path/hub.sql
```

Exports contain unlisted link metadata, preview bytes, ownership hashes and private naming configuration. Keep them private and out of Git, public artifacts and support tickets. They contain no provider credentials or Cloudflare secret bindings. Keep `HUB_KEY` stable and retain its separately managed secret.

Use only trusted operator exports. Rehearse restoration in a new local state directory:

```sh
node scripts/restore-hub-backup.mjs --file /secure/path/hub.sql --persist-to .tmp/hub-restore-new
```

The restore tool parses the export with Node.js 24's SQLite support, applies local migrations, and copies application rows with bound parameters. This avoids D1's SQL-statement length limit for large settings and legacy preview literals. It preserves binary JPEGs and refuses existing local state. A successful rehearsal checks both table counts; the retirement rehearsal also compared every restored value with the original export.

For a fresh remote recovery database, configure its `HUB_DB` ID in `wrangler.jsonc`, apply the migrations, then run the same restore command with `--remote` instead of `--persist-to`. The tool checks both application tables before writing and refuses nonempty databases. It never merges an old backup into a running Hub. After an interrupted restore, use another empty recovery database. Use [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) for in-place point-in-time recovery.
