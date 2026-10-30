# Spatial Hub

The companion service for [ColmapView](https://github.com/ColmapView/Colmapview.github.io): a catalog of pinned public scene datasets and preview cards for links created by the viewer's upload flow.

[Open the Hub on OpsiClear](https://colmapview.opsiclear.com/hub/) or [GitHub Pages](https://colmapview.github.io/hub/). Both galleries use the same frontend and live public catalog. A Cloudflare Worker owns the shared backend (`/hub`, `/hub/*`, `/s`, `/s/*` on OpsiClear); the viewer and GitHub frontend are deployed separately. Catalog builds use committed evidence. Public submissions use bot checks and bounded anonymous verification on fixed provider hosts; arbitrary submitted hosts are never fetched. User provider tokens and bucket keys stay in the viewer tab. Legacy `/auth/*` routes only report the retired service; see [credential-service retirement](docs/account-sessions.md).

Share links use `/s/RoughhewnBiplane` and serve the viewer at that address, including saved view settings. The address stays short through loading and reloads. Existing `/hub/<id>` links continue to work. Non-navigation fetches retain social preview metadata; image previews and delete links keep their own routes. Private datasets still require access in the viewer. The creation API adds `shareUrl` for updated viewers and keeps its legacy `url` and `managementPath` fields compatible with older viewers.

Every curated scene uses the same `/s/AdjectiveNoun` naming style in its card, metadata and Copy link action. Names are randomly assigned once and reserved against upload collisions. Old `/s/d/<code>` links keep working. See the [catalog guide](docs/catalog.md) for routing and interface details.

## Development

Use Node.js 24 with npm, and Python 3.11 or later. Run commands from this repository's root.

```sh
npm ci
npm run dev
```

Open `http://localhost:5201/hub/`. Development uses local D1/Durable Object state and public fixture word lists. The launcher creates `.dev.vars` from the example only when the file does not exist. See the [development guide](docs/development.md) for environment overrides, tests and shared styles.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Build local assets and start the Hub |
| `npm run check:code` | Fast type, lint and pinned stylesheet checks |
| `npm run check` | Code checks, offline regression suites and build dry run |
| `npm run test:deployment` | Offline asset-retention and deployment contract checks |
| `npm run test:browser` | Browser integration checks; install Chromium first |
| `npm run build:assets` | Rebuild browser assets and the public catalog offline |
| `npm run catalog:import -- --viewer-root PATH` | Refresh metadata from the local survey inputs |
| `npm run deploy` | Build, retain live frontend assets, prepare public catalog rows and deploy; see the operations guide |

CI runs `npm run check`, `npm run test:browser` and a redacted secret scan of the complete Git history. CI has read-only repository access and no production deployment credentials. Individual suites and audit commands are documented below.

## Project map

| Directory | Responsibility |
| --- | --- |
| `src/worker/` | Routes, validation, private card records and lookup protection |
| `src/client/` | Browser controls, asynchronous catalog browsing and theme |
| `src/shared/` | Runtime-neutral models, catalog logic and HTML helpers |
| `scripts/build/` | Deployable client and catalog asset builds |
| `scripts/deploy/` | Verify and retain live frontend assets before upload |
| `scripts/catalog/` | Offline catalog imports, projections and publication policy |
| `scripts/audit/` | Operator source audits, inventory preparation and preview preparation |
| `scripts/lib/` | Shared command helpers |
| `tests/` | Worker, JavaScript and Python regression checks and shared fixtures |
| `e2e/` | Browser integration checks |
| `data/` | Committed catalog inputs, evidence and licensed previews |
| `public/` | Hand-maintained static assets and ignored generated output |

## Documentation

- [Development and architecture](docs/development.md): setup, dependency boundaries and validation.
- [Public dataset catalog](docs/catalog.md): scenes, browsing, evidence and compatibility contracts.
- [Catalog inputs and refresh](data/README.md): qualification limits and operator commands.
- [Share links and lookup protection](docs/sharing.md): records, IDs, management and privacy behavior.
- [Share on Hub](docs/publication.md): public opt-ins, verification, anti-bot setup and operator review.
- [Production setup](docs/operations.md): bindings, secrets, deployment and post-deploy checks.
- [Credential-service retirement](docs/account-sessions.md): compatibility responses, permanent saved-connection deletion and rollout checks.
- [Security](SECURITY.md): private vulnerability reports, production boundaries and source-publication checks.

## License

The Hub source is [AGPL-3.0](LICENSE), with the attribution terms in [NOTICE](NOTICE), matching ColmapView. Catalog evidence, previews, fonts and upstream datasets retain their own licenses and attribution; this code license does not grant rights to those materials.
