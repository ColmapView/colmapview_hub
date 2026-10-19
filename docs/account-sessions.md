# Account session service

`src/worker/auth/` serves `/auth/*` on the custom viewer origin. This is separate from public Hub cards, link lookup guards and the LINKS R2 bucket. `AccountSession` is a SQLite Durable Object per random signed browser ID; it stores only encrypted credentials/transactions plus expiry and revision metadata. Credentials expire after at most 30 days and are removed by an alarm. The cookie contains an ID and signature, never credentials or user profiles.

## Provisioning

1. Register the exact Google callback `https://colmapview.opsiclear.com/auth/google/callback` on the existing production Web client. Keep its JavaScript origin and existing Drive/Picker configuration. The frontend and backend Google client IDs must match. Declare `openid`, `drive.file`, and the optional `drive.install`; no broad Drive scope is needed.
2. Register a confidential Hugging Face application with `https://colmapview.opsiclear.com/auth/hf/callback`. Permit `openid profile read-repos contribute-repos`. Keep existing public clients/callbacks for browser-only deployments. Confirm actual refresh-token issuance and renewal; the implementation also supports access-only connections, which expire without renewal.
3. Set the public IDs in `AUTH_GOOGLE_CLIENT_ID` and `AUTH_HF_CLIENT_ID`. Generate a unique cryptographically random 32-byte base64url `AUTH_KEY` (43 characters). Install it and the corresponding `AUTH_GOOGLE_CLIENT_SECRET` and `AUTH_HF_CLIENT_SECRET` using Wrangler secrets. Never commit values, print them in test output, or expose them to frontend builds. Changing `AUTH_KEY` invalidates cookies and prevents decryption of existing records; treat rotation as forced reconnection.
4. Deploy with `AUTH_ENABLED=false`. The `v3-account-sessions` migration creates ACCOUNT_SESSIONS; it does not alter public link data. Deploy the viewer and updated privacy disclosure before setting `AUTH_ENABLED=true`. Missing provider credentials leave that provider disabled; bucket persistence requires only the enabled service and encryption key.
5. Verify `/auth/session` is uncacheable, sets no cookie for an anonymous check, and reports only configured capabilities. Verify both real OAuth clients, Drive account matching/Open with, reload/new-tab restoration, renewal, cancellation and Disconnect. Test a bucket with a disposable scoped key and explicit Remember choice, and confirm object transfers bypass this Worker. Record real-provider checks separately from mocked tests.

`AUTH_ENABLED=false` is the rollback switch. Keep the Durable Object binding/class/migration so existing objects can expire. Current provider access tokens and bucket presigned URLs cannot be recalled by deleting a server record; use provider revocation if required. Clearing the browser cookie does not immediately delete its unreachable encrypted object, which expires normally. No cross-browser account lookup or administrative token export is provided.

## API boundaries

- `GET /auth/session`: capabilities and noncredential connection metadata; no anonymous state creation.
- `POST /auth/{google|hf}/connect`: browser-bound PKCE authorization URL and transaction ID; popup or full-page return.
- `GET /auth/{google|hf}/callback`: single-use state/code validation and verified identity; a same-origin notification or redirect contains status only.
- `POST /auth/{google|hf}/token`: short-lived access token for a specific purpose/optional Google subject; refresh credentials stay encrypted on the server.
- `POST /auth/{google|hf}/cancel`: cancels the exact transaction, including a late callback, without deleting a newer attempt.
- `POST /auth/bucket/connect`: explicit `remember:true`, validated bucket config and credentials.
- `POST /auth/bucket/sign`: fixed-root object/list/multipart signing, no external fetch; 120-second signatures. Read-only connections cannot sign writes or bucket-administration operations.
- `POST /auth/bucket/enable-uploads`: explicit `confirm:true` permits object writes; it starts no upload.
- `POST /auth/{google|hf|bucket|all}/disconnect`: deletes server-side connection records. `all` also expires the cookie.

All POSTs require the exact configured Origin, same-origin Fetch Metadata when present, a JSON body and `X-ColmapView-Session: 1`. Auth routes have no CORS allowance and no shared caching. They do not use Hub lookup miss cooldowns. Only fixed provider endpoints are fetched; submitted dataset/bucket URLs are never fetched. Provider response bodies and callbacks must not enter logs. `observability.logs.invocation_logs=false` avoids automatic Worker invocation URLs while keeping explicit Hub error logs available.

See the viewer's `docs/account-sessions.md` for client behavior, disclosure and limitations. Run `npm run check` and relevant browser tests. New auth suites use generated fixture identities and keys; no real provider credentials are required. Local browser integration needs a separate test OAuth app/callback configuration; never weaken production origin checks to run a mock locally.
