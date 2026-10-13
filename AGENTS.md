# ColmapView Hub

This project stores unlisted ColmapView links and small JPEG previews. Keep the Worker, browser client, and tests small and separate. Do not add a database or framework without a concrete need.

- `src/worker/` contains routing, validation, private R2 record access, and the Durable Object lookup guard.
- `src/client/` contains browser-only thumbnail preparation and form/play controls.
- `public/` contains static styles and generated client assets.
- `tests/` contains Workers runtime tests; `e2e/` contains browser checks.
- Use `.tmp/` for local reports and scratch files. Never commit private dictionaries, `.dev.vars`, credentials, or generated runtime state.
- Use Web Crypto for IDs and management secrets. Never fetch submitted dataset or image URLs on the server.
- All lookup routes must honor the same three-distinct-miss cooldown, including previews and HEAD requests. Do not exempt crawlers by User-Agent.
- Readable IDs are independently random, never derived from the dataset URL. No public listing, search, sitemap, or storage browsing.
- Run `npm run check` and relevant browser tests before pushing. Preserve existing changes and use two-space TypeScript indentation.
