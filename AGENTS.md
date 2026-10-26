# ColmapView Hub

This project stores ColmapView share links and small JPEG previews. Keep the Worker, browser client, and tests small and separate. Do not add a database or framework without a concrete need.

- `src/worker/` contains routing, validation, private D1 record access, and the `LookupGuard` Durable Object.
- `src/client/` contains browser-only play and delete controls. Thumbnail preparation belongs to the viewer.
- `src/shared/` contains runtime-neutral models, catalog rules and HTML helpers. Keep imports between client and Worker code out of this layer; ESLint enforces these boundaries.
- `scripts/build/` creates deployable assets. `scripts/catalog/` contains offline import and publication rules. `scripts/audit/` contains operator preparation and network audits; normal builds must not run them. Python commands use `python -m scripts.<package>.<module>` from the repository root, with package-relative imports instead of modifying `sys.path`.
- `public/hub/` contains static files served without the Worker. A new file outside `assets/` and `fonts/` also needs a `!/hub/…` entry in wrangler.jsonc's `run_worker_first`; otherwise the Worker answers it with a 404 or counts it as a miss. `colmapview.css` is a copy of the viewer's `public/policy.css`; change it only by copying the viewer's file and updating both pinned hashes (see docs/development.md).
- `tests/` contains Workers runtime tests; `e2e/` contains browser checks.
- Use `.tmp/` for local reports and scratch files. Never commit private dictionaries, `.dev.vars`, credentials, or generated runtime state.
- Use Web Crypto for IDs and management secrets. Never fetch arbitrary submitted dataset or image URLs on the server. Public publication may check bounded, anonymous Hugging Face metadata and COLMAP headers on fixed provider hosts, with each redirect checked; curated manifests use the asset binding. Other sources require operator review.
- All lookup routes must honor the same three-distinct-miss cooldown, including previews, the manage page and HEAD requests. There are two exceptions only: cross-site subresource requests and cross-site prefetches get a plain 404 before any lookup, and requests carrying the secret verified-bot token get 30 misses. Do not exempt crawlers by User-Agent.
- Readable IDs are independently random, never derived from the dataset URL. Short names are only for public data. Keep the legacy `HUB_LISTINGS_ENABLED` gallery off. The catalog's Shared on Hub feed scans only explicit opt-ins with server verification. Publication stays off unless `HUB_PUBLICATIONS_ENABLED` and real Turnstile keys are configured; never enumerate unlisted links or pending reviews.
- Link creation belongs to ColmapView's upload flow. Do not add a standalone submission or dataset upload form to the Hub.
- Curated names are operator-reserved `kind: catalog` records pointing only to built public dataset IDs. Keep their committed name registry stable, reserve keys conditionally in the upload namespace, and never give them upload ownership or enumerate unlisted records.
- `npm run check:code` runs the fast type/lint/style checks. `npm run check` also runs the JavaScript, Python and Worker suites and builds the assets, matching CI. Run it and relevant browser tests before pushing. Preserve existing changes and use two-space TypeScript indentation.
