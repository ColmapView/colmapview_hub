# Credential-service retirement

This revision removes the remembered-connection service. Google and Hugging Face authentication and bucket signing run directly in the viewer tab. The Worker has no credential store, provider token exchange or S3 signer. Public Hub cards and the catalog continue to use their existing storage and routes.

## Compatibility behavior

`GET /auth/session` returns all provider capabilities disabled, no accounts, no bucket and zero expiry. Other `/auth/*` requests return 410 with a reconnect message. Neither response reads a credential body, opens old session storage or fetches a provider. Responses have `no-store`, no-referrer and no CORS allowance. A supplied legacy session cookie is expired; anonymous checks set no cookie. Keep invocation URL logging disabled so an obsolete callback does not enter automatic application logs.

## Permanent migration

The approved `v4-remove-account-sessions` migration permanently deleted the `AccountSession` Durable Object class and its namespace, including encrypted credentials and pending sign-in transactions. Its binding and class code are removed; historical migrations remain in order. See [Durable Object migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/).

The migration does not delete `LookupGuard`, Hub cards, catalog files, the LINKS R2 bucket or any user-owned provider dataset. Code rollback cannot restore erased saved connections. Users reconnect through the browser flow.

## Completed rollout — October 20, 2026

**Status — October 20, 2026:** approved and deployed. Migration `v4-remove-account-sessions` was accepted in Worker version `cf64e178-65bd-48b2-8a2e-1845fbe72dc9`. Cloudflare's namespace inventory showed `AccountSession` before deployment and only `LookupGuard` afterward. The `ACCOUNT_SESSIONS` binding and auth variables are absent. `AUTH_KEY`, `AUTH_GOOGLE_CLIENT_SECRET` and `AUTH_HF_CLIENT_SECRET` were removed; the existing `HUB_KEY` remains. Anonymous `/auth/session` reports disabled server capabilities with no cookie.

Viewer **0.19.3** (source `8f7ed97`) was verified live on the custom host, GitHub latest and its versioned URL after the [release workflow](https://github.com/ColmapView/Colmapview.github.io/actions/runs/39370199310) passed. Hub **0.9.9** (source `c8170bb`, Worker version `155ebf07-f433-45f4-88c8-eeb14a1cb1be`) then published all eight verified NL3D scenes. Their counts, metadata and direct-open redirects passed live checks. A synthetic share passed create/card/redirect/preview/manage/CSS checks and was removed afterward. Public cards, catalog files and the R2 bucket were preserved.

Both obsolete confidential HF connection apps were deleted at the provider. The original public browser app remains without a client secret and retains the custom/GitHub callbacks. Live private HF sign-in, ZIP loading, expected reconnect after reload and a second load passed. The Google server secret created October 19 was subsequently disabled and deleted at Google, and `/auth/google/callback` was removed from the client. The save and reopened settings confirmed the production JavaScript origin and original browser client were retained; the Drive UI registration was preserved. Google notes that credential changes can take five minutes to a few hours to propagate. Removing Worker secrets alone does not establish provider revocation. Real-provider Drive save/Open with, HF publishing and bucket-transfer checks were not repeated for viewer 0.19.3; compiled browser fixtures passed.

Follow-up checks against released viewer **0.19.5** (source `c37d0116`) matched the custom/latest/versioned/dev manifests and HTML hashes, retained the disabled server-auth responses and confirmed the live Hub still has no credential binding or provider OAuth secrets. Its only Durable Object class remains `LookupGuard`.

The viewer's [October 20 browser-only receipt](https://github.com/ColmapView/Colmapview.github.io/blob/main/docs/account-sessions.md#live-checks--2026-10-20) owns the detailed Drive save/Open with, private HF publication, R2 transfer, thumbnail and cleanup evidence for viewer 0.19.5. Real Safari remains unverified; small fixture transfers do not establish large multipart-transfer or interrupted-upload resumption coverage.

## Future deployments and rollback

Follow [operations](operations.md) for routine deployments. Preserve the retirement migration and browser-only contract when rolling back. Older viewers fall back to browser authentication when `/auth/session` reports disabled capabilities; an open tab using the retired service may need a reload. Keep `HUB_KEY` and any configured `VERIFIED_BOT_TOKEN`.

Keep the active public Google and HF browser clients, Drive UI registration and browser callbacks. Both custom `/hf-callback` paths require `Cache-Control: no-store, no-transform`; the callback's no-referrer policy and in-memory PKCE verifier remain in place. GitHub Pages controls its own HTTP caching.

Removing a Worker secret alone does not revoke historical copies at the provider. Deleting only an HF app secret converts it to a public client; both unused confidential server apps were deleted. See [HF public apps](https://huggingface.co/docs/hub/oauth#public-oauth-apps-no-secret), [Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/) and [Worker versions](https://developers.cloudflare.com/workers/versions-and-deployments/).

Provider authorization grants, issued access tokens and user-owned bucket keys are not automatically revoked by deleting our storage. Users can revoke them in provider settings; rotate credentials there if a leak is suspected. No leak has been established by these checks. Deleting the account namespace does not imply hosting-wide log or cache erasure.

## Historical evidence

The remembered service was checked on October 19, 2026 with Hub 0.8.2 and viewer 0.19.1. The [dated viewer receipt](https://github.com/ColmapView/Colmapview.github.io/blob/main/docs/account-sessions.md#live-checks--2026-10-19) records those checks and disposable-resource cleanup. It is not validation of this browser-only revision or proof that production data has been erased.
