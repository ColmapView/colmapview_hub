# Share links and lookup protection

A small companion to [ColmapView](https://github.com/ColmapView/Colmapview.github.io). It saves a viewer link, its metadata and a thumbnail for every upload made from ColmapView, and shows them as a card. Data anyone can open without signing in gets a short name such as `HappyTree`, unless it is listed in the gallery; a listed link gets a long `-L` name such as `HappyTree-Lq3ZfK0aB7xLmP2Ws`. Everything else gets an unguessable name such as `HappyTree-q3ZfK0aB7xLmP2Ws`. There is no standalone submission or dataset upload form on the Hub.

Cards provide an X/Twitter large-image preview. Public cards have a Play 3D button that loads the viewer only on a click; private cards link to the viewer instead, because signing in inside an iframe is unreliable. The gallery of listed results is off unless `HUB_LISTINGS_ENABLED` is `true`; while it is off, `/hub/` opens the dataset browser directly.

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
