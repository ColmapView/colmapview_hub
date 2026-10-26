# Share on Hub

The viewer offers **Share on Hub** for a loaded remote dataset or a completed public upload. This is a separate opt-in from an automatic, unlisted upload share link. The form explicitly discloses that its dataset link, title, description and preview will become publicly discoverable. It has no provider login or upload form of its own.

`POST /hub/api/publications` requires an allowed viewer origin, JSON within the existing request/preview limits, explicit listing consent and a valid Turnstile response. The existing creation quota covers this endpoint too: 20 attempts per hour per hashed IPv4/IPv6 network, before challenge or source requests. Siteverify must return success for the submitting hostname and `hub-publication` action. Expired, reused, mismatched or unavailable challenges cannot publish. Challenge responses are not stored or logged.

## Verification and storage

- HTTPS sources must have no embedded credentials, secret query parameters, literal IPs or local hostnames. Normal viewer/source/license validation remains mandatory. Client-supplied verification is rejected.
- An exact immutable curated manifest path is checked through `CATALOG_ASSETS`, with a 256 KiB JSON cap.
- Hugging Face repositories must be anonymously public and ungated. Verification reads bounded provider metadata and the first 256 bytes of matching native `cameras.bin` and `images.bin` files. An explicitly selected COLMAP file must exist in that inventory; folder links retain their exact decoded path and are normalized with a trailing slash. It checks counts and first-record fields, then pins the viewer source to the checked commit. Only `huggingface.co` and provider `.hf.co` redirects are allowed, with a hop cap and shared timeout. No provider token or cookie is sent.
- Drive, buckets, other hosts and formats requiring complete parsing go to operator review. The server never fetches those arbitrary URLs. Header checks do not prove complete loading, all photos, ownership or license rights; metadata describes the narrower evidence.

Verified submissions return 201 and enter `listed/`. Pending submissions return 202 and remain solely in `pending-publications/`, without a public card or redirect. D1 rows contain metadata, a separate binary JPEG, creation time, ownership/fingerprint hashes and the verification or review reason. They contain no provider credentials, raw management key or challenge response. Pending records remain until an operator approves or rejects them; there is no automatic expiry yet. Removal requests use info@opsiclear.com and the published link or submission ID.

`GET /hub/api/publications` enumerates only explicit public listings carrying server verification. It queries the verified public index and returns four metadata records with a namespace-scoped keyset cursor, without reading preview blobs or returning ownership fields. Browser responses are uncacheable; an edge copy lasts five seconds. Deletions can therefore remain in an already fetched feed for up to five seconds; JPEG caches can last five minutes. A newly published first page is purged in the handling data center. The `HUB_PUBLICATION_READS` binding limits feed requests to 60 per minute per hashed network at each Cloudflare location; it is an abuse/cost guard, not a global quota. The curated catalog and existing unlisted/private records are not scanned.

## Production setup

1. In the account owning `colmapview-hub`, create a managed Turnstile widget restricted to `colmapview.opsiclear.com` and `colmapview.github.io`. Keep pre-clearance off. Local testing uses a separate local widget or Cloudflare test keys.
2. Set the public `HUB_TURNSTILE_SITE_KEY` configuration and store `HUB_TURNSTILE_SECRET` using `npx wrangler secret put HUB_TURNSTILE_SECRET`. Never put the secret in a `VITE_` variable, Git, browser assets or logs.
3. Keep `HUB_LISTINGS_ENABLED=false`. Set `HUB_PUBLICATIONS_ENABLED=true` only after real keys are installed. The config API otherwise reports disabled, and submissions fail closed. Dummy Turnstile secrets are refused on production hosts.
4. Deploy the Hub, then the viewer. Check `/hub/api/publications/config` from both viewer hosts, complete a real widget, and confirm 201 for a verified public model, 202 for a review-only source and rejection for a failed/replayed challenge. Check the new card's direct viewer link and metadata, and regression-check ordinary share links and private uploads. Remove only test records afterward.

The script is loaded from Cloudflare only when the publication form opens. Server validation follows [Cloudflare's Siteverify guidance](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/). Edge request limits follow [the Workers Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/). Account/zone WAF rules are a separate operational layer; this change does not claim to configure them.

## Operator review

The CLI uses the operator's Wrangler authentication. It defaults to local storage; production always requires `--remote`. Inspect a pending record:

```sh
node scripts/review-publication.mjs --id HappyTree-Lq3ZfK0aB7xLmP2Ws --remote
```

Check the source anonymously, verify it contains the intended scene and load that exact source in the released viewer. Check the supplied title, description, license and preview for abuse or private information. Approval atomically moves the validated record into `listed/` with a `manual_review` receipt and removes its pending copy:

```sh
node scripts/review-publication.mjs --id HappyTree-Lq3ZfK0aB7xLmP2Ws --remote --approve --checked-public --checked-format
node scripts/review-publication.mjs --id HappyTree-Lq3ZfK0aB7xLmP2Ws --remote --reject
```

Choose one action. Reject removes only that pending submission. For local rehearsals, omit `--remote` and optionally set `--persist-to PATH`. Review does not change the source provider's permissions or license.
