# Production setup

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

## Moving legacy share records to D1

`node scripts/audit/migrate-links-to-d1.mjs --remote` inventories the detached legacy bucket without changing it. Add `--apply` for create-only import and verification of record contents, exact preview bytes and private naming configuration. `--verify` checks without inserting. A successful full pass also saves a private, Git-ignored ETag/checksum snapshot. Add `--incremental` for catch-up: unchanged source ETags reuse that verified source evidence while every database row is rechecked against its checksum. New sources are read and verified in full; missing or altered rows stop cutover. Counts and aggregate byte totals are saved under `.tmp/`; record contents and private dictionaries are not printed. Curated static assets stay in the normal build.

Before the final copy, briefly pause link creation, publication and deletion while keeping existing reads available. Allow already-running writes to finish, rerun the import and verification, and deploy the D1 Worker. Keep the old bucket untouched and unbound for rollback; do not delete it as part of this migration. After cutover, new links exist only in D1, so rolling back to an old R2-only Worker requires reconciling post-cutover changes first. D1 migrations are append-only and must be applied before deploying code that needs them.
