# Development and architecture

Use Node.js 24 with npm and Python 3.11 or later. All commands run from the repository root. JavaScript dependencies are locked in `package-lock.json`; install them with `npm ci`.

## Local development

```sh
npm ci
npm run dev
```

Open `http://localhost:5201/hub/`. `scripts/dev.mjs` seeds public fixture word lists in local R2 and starts Wrangler with local Durable Object state. It copies `.dev.vars.example` only when `.dev.vars` does not exist. Production credentials and private dictionaries are unnecessary.

The same Worker can host the custom viewer's optional [account session service](account-sessions.md). It uses separate encrypted Durable Object records and starts disabled. Provider secrets belong only to the Worker, never the Hub client or viewer build.

To connect a local viewer, run it with `VITE_HUB_BASE_URL=http://localhost:5201/hub`. A local Hub accepts loopback origins and viewer URLs.

| Environment variable | Use |
| --- | --- |
| `HUB_DEV_PORT` | Change the development server's default port, 5201 |
| `HUB_E2E_PORT` | Choose a separate port for browser tests; their server starts automatically |
| `PYTHON` | Override the Python executable used by builds and tests |

Without `PYTHON`, commands use `python` on Windows and `python3` elsewhere. Set it to an executable name or full path, without shell flags. `scripts/lib/python.mjs` owns this selection; `scripts/run-python.mjs` is its command-line entry point.

## Validation

```sh
npm run check
npx playwright install chromium
npm run test:browser
```

`check` is the same core validation used by CI. It includes both languages and the deployable asset build. Use the smaller commands while iterating:

| Command | Scope |
| --- | --- |
| `npm run check:code` | TypeScript, JavaScript/TypeScript lint and pinned stylesheet |
| `npm run test:catalog` | JavaScript catalog policy, rendering, search and count regressions |
| `npm run test:python` | Python scene projection and evidence validation |
| `npm test` | Worker routes, R2 records and real SQLite Durable Object runtime |
| `npm run build` | Offline assets and a Wrangler deployment dry run |
| `npm run test:browser` | Catalog, share-card, management, theme and static asset flows |

The browser suite starts its own isolated local server and storage. Viewer frames are intercepted so the suite checks the integration contract without rendering complete remote datasets. Tests use public fixtures; keep raw audit receipts and runtime state under `.tmp/`.

## Dependency boundaries

The existing application layers have distinct jobs:

- `src/client/` owns browser state, DOM events and asynchronous browsing. It may import shared code.
- `src/worker/` owns HTTP routing, validation, R2 records and lookup protection. It may import shared code.
- `src/shared/` owns models, pure catalog rules and HTML string helpers. It must work in both runtimes.

ESLint rejects imports between client and Worker modules and server platform imports in shared code. Shared modules compile under both TypeScript configurations. Avoid adding barrel files or new abstractions solely to hide those boundaries.

Tooling is organized by task:

- `scripts/build/` explicitly builds the browser bundles, then projects committed inputs into public catalog assets. It performs no provider audits or image downloads.
- `scripts/catalog/` contains the offline JavaScript/Python rules used by imports, builds and policy tests.
- `scripts/audit/` contains operator commands that may read source providers, produce audit receipts or prepare canonical inputs. Run them separately using the [catalog refresh instructions](../data/README.md).

Python tools are packages. Invoke a command as `python -m scripts.audit.dataset_audit --help`, rather than executing a nested `.py` file by path. Internal modules use package-relative imports; tests import those packages normally. Existing npm command names remain the stable entry points for builds and catalog tasks.

## Catalog changes

The data pipeline is committed inputs → exact scene qualification → metadata packs and search postings → Worker page/API → asynchronous browser results. Build orchestration lives in `scripts/build/catalog.mjs`; the Python projection lives in `scripts/catalog/build_individual_catalog.py`.

Keep public routes, metadata schemas and scene identities stable when moving implementation files. The internal `individual` name remains in established source names and `/hub/datasets/individual/` asset URLs. It describes the scene projection; renaming a directory must not rename its public routes.

Metadata packs contain 24 scene records, matching an unfiltered results page. Larger packs previously made an ordinary request decode several megabytes of unrelated evidence and intermittently exceed the Worker's resource limits. The reader accepts bounded positive pack sizes up to the legacy 2,048-record layout; record lookup and pagination use the index's declared size. Keep the pack reader bounded and verify pagination across packs when changing this layout.

Search postings iterate sorted tokens so Python hash randomization cannot reorder index files between builds. The catalog generation includes the projection and policy source bytes to invalidate caches when those rules change.

Evidence, photograph availability, licensing and complete export proof have separate meanings. Use the existing publication fixtures across JavaScript and Python when changing qualification rules. See [catalog behavior](catalog.md) and [input evidence](../data/README.md) before refreshing data.

Generated assets under `public/hub/assets/` and `public/hub/datasets/` are Git-ignored. Do not edit them directly or commit local reports, credentials, private word lists or generated runtime state.

## Shared styles

Hub pages use ColmapView's public-page design. `public/hub/colmapview.css` is a byte-for-byte copy of the viewer's `public/policy.css`; its IBM Plex Sans font and license live in `public/hub/fonts/`. `public/hub/styles.css` adds Hub-specific styles.

`scripts/check-colmapview-css.mjs` verifies the pinned SHA-256 as part of `check:code`. The viewer's `src/theme/policyCssCopy.test.ts` pins the same value. To update the copy, copy the viewer's file and update both hashes together.

New static files outside `/hub/assets/` and `/hub/fonts/` need a matching negative entry in `wrangler.jsonc`'s `run_worker_first`, or the Worker will treat the request as a lookup. Keep static paths, routes, `HUB_PATH` and `public/_headers` aligned. See [production setup](operations.md) for deployment checks.
