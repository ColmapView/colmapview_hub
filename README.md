# ColmapView Hub

The companion service for [ColmapView](https://github.com/ColmapView/Colmapview.github.io): a catalog of pinned public scene datasets and preview cards for links created by the viewer's upload flow.

[Open the Hub](https://colmapview.opsiclear.com/hub/). A Cloudflare Worker owns `/hub` and `/hub/*`; the viewer is deployed separately. Catalog builds use committed evidence. The Worker reads bounded same-origin metadata and never downloads submitted dataset URLs.

## Development

Use Node.js 24 with npm, and Python 3.11 or later. Run commands from this repository's root.

```sh
npm ci
npm run dev
```

Open `http://localhost:5201/hub/`. Development uses local R2/Durable Object state and public fixture word lists. The launcher creates `.dev.vars` from the example only when the file does not exist. See the [development guide](docs/development.md) for environment overrides, tests and shared styles.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Build local assets and start the Hub |
| `npm run check:code` | Fast type, lint and pinned stylesheet checks |
| `npm run check` | Code checks, catalog/Python/Worker tests and build dry run |
| `npm run test:browser` | Browser integration checks; install Chromium first |
| `npm run build:assets` | Rebuild browser assets and the public catalog offline |
| `npm run catalog:import -- --viewer-root PATH` | Refresh metadata from the local survey inputs |
| `npm run deploy` | Build assets and deploy the Hub; see the operations guide |

CI runs `npm run check` and `npm run test:browser`. Individual suites and audit commands are documented below.

## Project map

| Directory | Responsibility |
| --- | --- |
| `src/worker/` | Routes, validation, private records and lookup protection |
| `src/client/` | Browser controls, asynchronous catalog browsing and theme |
| `src/shared/` | Runtime-neutral models, catalog logic and HTML helpers |
| `scripts/build/` | Deployable client and catalog asset builds |
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
- [Production setup](docs/operations.md): bindings, secrets, deployment and post-deploy checks.
