# ColmapView Hub

This project stores unlisted ColmapView links and small JPEG previews. Keep the Worker, browser client, and tests small and separate. Do not add a database or framework without a concrete need.

- `src/worker/` contains routing, validation, private R2 record access, and the Durable Object lookup guard.
- `src/client/` contains browser-only play and management controls. Thumbnail preparation belongs to the viewer.
- `public/` contains static styles and generated client assets.
- `tests/` contains Workers runtime tests; `e2e/` contains browser checks.
- Use `.tmp/` for local reports and scratch files. Never commit private dictionaries, `.dev.vars`, credentials, or generated runtime state.
- Use Web Crypto for IDs and management secrets. Never fetch submitted dataset or image URLs on the server.
- All lookup routes must honor the same three-distinct-miss cooldown, including previews and HEAD requests. Do not exempt crawlers by User-Agent.
- Readable IDs are independently random, never derived from the dataset URL. The homepage lists only explicit public opt-ins; never enumerate unlisted links or expose storage browsing.
- Link creation belongs to ColmapView's upload flow. Do not add a standalone submission or dataset upload form to the Hub.
- Run `npm run check` and relevant browser tests before pushing. Preserve existing changes and use two-space TypeScript indentation.
