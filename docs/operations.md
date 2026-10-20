# Production setup

Authenticate Wrangler with the Cloudflare account that owns the `opsiclear.com` zone. The account ID is set in `wrangler.jsonc`. Deployments need access to Workers routes, R2 and Durable Objects.

This revision retires remembered connections. Before its first deployment, follow the [credential-service retirement runbook](account-sessions.md): migration `v4-remove-account-sessions` permanently deletes saved auth records and needs explicit rollout approval. The local revision is prepared; production has not yet been changed.

1. Create the private R2 bucket `colmapview-hub`. Don't enable an R2 public URL or custom domain.
2. Set `HUB_KEY` with `npx wrangler secret put HUB_KEY`: 32 cryptographically random bytes, encoded as unpadded base64url. Never put it in source, public assets or GitHub output.
3. Prepare and upload the immutable private dictionary configuration from its private folder:

```sh
node scripts/prepare-wordlists.mjs /absolute/private/dictionary-folder
npx wrangler r2 object put colmapview-hub/internal/wordlists-v1.json --remote --file /absolute/private/dictionary-folder/wordlists-v1.json
```

4. Optional: add a Transform Rule that sets `X-Hub-Verified-Bot` for Cloudflare's verified bots on `/hub/*` and `/s/*`, then run `npx wrangler secret put VERIFIED_BOT_TOKEN` with the same value. Also optional: a WAF rate-limiting rule covering both prefixes.
5. Run the checks, then `npm run deploy`.
   - Migration `v2` replaces the `ClientGuard` class with `LookupGuard` and deletes the old per-client storage, so active cooldowns reset once.
   - After deploying, check that `/hub/styles.css` returns 200 with an `ETag` and `X-Content-Type-Options: nosniff`, and that `/hub/<id>`, `/hub/<id>/preview.jpg`, `/hub/manage/<id>` and `/hub/api/links` still reach the Worker.
   - Browser navigations to `/s/<id>` and legacy `/hub/<id>` return a 307 redirect to the stored viewer URL. Check `/s/<id>/preview.jpg` too. Non-navigation metadata requests return the social preview page. Both namespaces use the same record and cooldown checks.
   - Check the viewer root and that `/hub/` opens `/hub/datasets/` when listings are off. Old collection URLs should redirect to the matching scene filter.
   - Check `/auth/session` without a cookie: it must be uncacheable, create no cookie and report every capability disabled. Old connection/token/signing endpoints must return 410. Follow the retirement runbook for namespace deletion and unused-secret cleanup.
   - Deploy the Hub before releasing a viewer that sends `access`.

WordNet's source license is preserved inside the private configuration. License information attached to a dataset link comes from its creator; the Hub neither infers nor grants dataset rights.
