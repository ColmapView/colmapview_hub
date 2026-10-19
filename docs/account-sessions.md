# Credential-service retirement

This revision removes the remembered-connection service. Google and Hugging Face authentication and bucket signing run directly in the viewer tab. The Worker has no credential store, provider token exchange or S3 signer. Public Hub cards and the catalog continue to use their existing storage and routes.

## Compatibility behavior

`GET /auth/session` returns all provider capabilities disabled, no accounts, no bucket and zero expiry. Other `/auth/*` requests return 410 with a reconnect message. Neither response reads a credential body, opens old session storage or fetches a provider. Responses have `no-store`, no-referrer and no CORS allowance. A supplied legacy session cookie is expired; anonymous checks set no cookie. Keep invocation URL logging disabled so an obsolete callback does not enter automatic application logs.

## Permanent migration

`v4-remove-account-sessions` deletes the `AccountSession` Durable Object class and its namespace, including encrypted credentials and pending sign-in transactions. The binding and class code are removed. Historical migrations remain in order. Cloudflare documents that a deleted namespace's data is permanently removed: [Durable Object migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/). Do not deploy this migration until the user approves the concrete rollout and permanent saved-connection deletion.

The migration does not delete `LookupGuard`, Hub cards, catalog files, the LINKS R2 bucket or any user-owned provider dataset. Code rollback cannot restore erased saved connections. Users reconnect through the browser flow.

## Rollout

**Status:** local revision prepared; no live deletion or credential-service retirement has been performed by this work.

1. Pass `npm run check` in both repositories and the focused browser flows. Review the viewer/policy changes and this migration together. Verify the custom frontend uses the existing public HF OAuth client and browser callback; no confidential server app is needed.
2. Obtain final approval for the rollout and irreversible saved-connection deletion. Deploy this Hub revision with `npm run deploy`; confirm Cloudflare accepts migration `v4-remove-account-sessions`. Older viewers already fall back to browser authentication when `/auth/session` reports disabled capabilities; open tabs using the retired service may need to reload.
3. Remove only the obsolete Worker secrets `AUTH_KEY`, `AUTH_GOOGLE_CLIENT_SECRET` and `AUTH_HF_CLIENT_SECRET` using Wrangler. These removals update the live Worker configuration. Never remove `HUB_KEY` or `VERIFIED_BOT_TOKEN`; do not print credential values.
4. Verify `/auth/session` reports all capabilities disabled with no anonymous cookie and that old token/connect/signing callbacks return 410. Confirm the deployed binding inventory no longer includes `ACCOUNT_SESSIONS` and only the three obsolete auth secret names have been removed. Namespace deletion success must be verified from the deployment migration, not inferred from the disabled endpoint alone.
5. Publish the browser-only viewer and revised privacy policy. Check `/hub/styles.css` (200 and ETag), the landing/catalog, card, preview, manage, API and `/s/` redirects. Check private Drive Open with and save/reopen, private HF load/publish, and a disposable scoped bucket upload/download. Confirm no new viewer `/auth/` calls, no credentials in shared links or browser storage, and explicit reconnect after reload/expiry. Record real-provider checks separately from fixtures.

Do not remove the public Google client or Drive UI registration: browser sign-in, Picker and Open with still use it. Old server callback registrations and the separate confidential HF app can be retired separately after verifying the browser registration. Provider authorization grants are not automatically revoked by deleting our storage; users can revoke them in provider settings.

## Historical evidence

The remembered service was checked on October 19, 2026 with Hub 0.8.2 and viewer 0.19.1. The [dated viewer receipt](https://github.com/ColmapView/Colmapview.github.io/blob/main/docs/account-sessions.md#live-checks--2026-10-19) records those checks and disposable-resource cleanup. It is not validation of this browser-only revision or proof that production data has been erased.
