# Development and architecture

Use Node.js 24 with npm and Python 3.11 or later. All commands run from the repository root. JavaScript dependencies are locked in `package-lock.json`; install them with `npm ci`.

## Local development

```sh
npm ci
npm run dev
```

Open `http://localhost:5201/hub/`. `scripts/dev.mjs` applies local D1 migrations, seeds public fixture word lists in local D1 and starts Wrangler with local Durable Object state. It copies `.dev.vars.example` only when `.dev.vars` does not exist. Production credentials and private dictionaries are unnecessary.

The local server explicitly disables remote bindings and uses an ephemeral inspector port, so separate worktrees can run without sharing a debugger port. Set `HUB_DEV_PORT` or `HUB_E2E_PORT` to give their HTTP servers separate ports too.

The launcher seeds committed public name reservations into local D1 alongside
the public test word lists. It uses Wrangler's local binding proxy with remote
bindings explicitly disabled; it does not need production dictionaries or access.

The viewer authenticates directly with providers and signs bucket requests in the browser. The Worker stores no user credentials and needs no provider secrets. Legacy `/auth/*` routes are inert compatibility responses; see [credential-service retirement](account-sessions.md). Ordinary catalog development needs only the public local Hub test key, not Google or HF credentials.

To connect a local viewer, run it with `VITE_HUB_BASE_URL=http://localhost:5201/hub`. A local Hub accepts loopback origins and viewer URLs.

Short-address navigations use the custom production app shell configured by
`HUB_VIEWER_ORIGIN`; their assets load from the Hub host's viewer root. Browser
tests instead start an explicit local HTML fixture, with no external app fetch.
Set `HUB_VIEWER_ORIGIN` when launching the dev script to override the shell with
an HTTP loopback origin. A full local viewer still needs its root/assets served on
the same origin as the Hub share path; the fixture checks the document contract,
while the viewer repository's browser tests exercise actual dataset loading.

GitHub's **Explore Hub** link adds `viewerHost=github` to the catalog URL. The
Hub carries that fixed choice through forms, asynchronous results, pagination,
reset, metadata and published cards. Their viewer navigations redirect to
`https://colmapview.github.io/latest/`, preserving the exact dataset parameters
and saved-view fragment. Existing explicitly versioned GitHub targets are retained.
Direct visits without the hint keep the existing viewer document at the short
address. Canonical copied links and source/preview URLs are unchanged. This hint
creates no cookie, credential or saved user preference; arbitrary return URLs are
not accepted. Rendered metadata caches include the destination to avoid serving
another destination's links or validators. Google Drive remains subject to the
selected viewer's existing explicit custom-host handoff.

| Environment variable | Use |
| --- | --- |
| `HUB_DEV_PORT` | Change the development server's default port, 5201 |
| `HUB_E2E_PORT` | Choose a separate port for browser tests; their server starts automatically |
| `HUB_VIEWER_ORIGIN` | Override the app-shell origin for local development; production accepts only the configured Pages project |
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
| `npm run check:code` | Worker, client and browser-test TypeScript; JavaScript/TypeScript lint; pinned stylesheet |
| `npm run test:catalog` | JavaScript catalog policy, rendering, search and count regressions |
| `npm run test:python` | Python scene projection and evidence validation |
| `npm test` | Worker routes, D1 records and real SQLite Durable Object runtime |
| `npm run test:backup` | Large-setting and binary-preview recovery in local D1, including refusal to overwrite existing state |
| `npm run build` | Offline assets and a Wrangler deployment dry run |
| `npm run test:browser` | Catalog, share-card, management, theme and static asset flows |

D1 schema changes live in `migrations/`. Runtime access is centralized in `src/worker/storage.ts`; operator tools use the same SQL repository through an authenticated Wrangler binding proxy. Metadata and preview deletion is one row operation. Public feeds query the verified listing index without loading preview blobs. Tests apply the real migrations to local D1, including atomic reservations and review promotion.

The browser suite starts its own isolated local server and storage. Viewer frames are intercepted so the suite checks the integration contract without rendering complete remote datasets. Tests use public fixtures; keep raw audit receipts and runtime state under `.tmp/`.

`typecheck` covers the Worker and runtime tests, the browser client, and the Playwright tests and configuration in separate TypeScript projects. The browser-test project extends the client configuration with Node types for the test runner.

## Dependency boundaries

The existing application layers have distinct jobs:

- `src/client/` owns browser state, DOM events and asynchronous browsing. It may import shared code.
- `src/worker/` owns HTTP routing, validation, D1 records and lookup protection. It may import shared code.
- `src/shared/` owns models, pure catalog rules and HTML string helpers. It must work in both runtimes.

ESLint rejects imports between client and Worker modules and server platform imports in shared code. Shared modules compile under the Worker and client configurations. Avoid adding barrel files or new abstractions solely to hide those boundaries.

Tooling is organized by task:

- `scripts/build/` explicitly builds the browser bundles, then projects committed inputs into public catalog assets. It performs no provider audits or image downloads.
- `scripts/catalog/` contains the offline JavaScript/Python rules used by imports, builds and policy tests.
- `scripts/audit/` contains operator commands that may read source providers, produce audit receipts or prepare canonical inputs. Run them separately using the [catalog refresh instructions](../data/README.md).

Python tools are packages. Invoke a command as `python -m scripts.audit.dataset_audit --help`, rather than executing a nested `.py` file by path. Internal modules use package-relative imports; tests import those packages normally. Existing npm command names remain the stable entry points for builds and catalog tasks.

## Catalog changes

The [scene discovery feed](discovery-feed.md) documents ranking, seeded random
selection, first-catalogued dates, scrolling and return navigation.

[Video frame mappings](video-frame-mappings.md) documents explicit source-frame
authoring, independent pixel evidence, and viewer-before-catalog rollout.

The data pipeline is committed inputs → exact scene qualification → metadata packs and search postings → Worker page/API → asynchronous browser results. Build orchestration lives in `scripts/build/catalog.mjs`; the Python projection lives in `scripts/catalog/build_individual_catalog.py`.

Keep public routes, metadata schemas and scene identities stable when moving implementation files. The internal `individual` name remains in established source names and `/hub/datasets/individual/` asset URLs. It describes the scene projection; renaming a directory must not rename its public routes.

Metadata packs contain 24 scene records, matching an unfiltered results page. Larger packs previously made an ordinary request decode several megabytes of unrelated evidence and intermittently exceed the Worker's resource limits. The reader accepts bounded positive pack sizes up to the legacy 2,048-record layout; record lookup and pagination use the index's declared size. Keep the pack reader bounded and verify pagination across packs when changing this layout.

Search postings iterate sorted tokens so Python hash randomization cannot reorder index files between builds. The catalog generation includes the projection and policy source bytes to invalidate caches when those rules change.

The build refreshes source-detail inventory facts from the pinned registry even when the Python scene projection is cached. Source-detail JSON and the catalog snapshot share those refreshed facts. Media counts from the original source scan retain that scope; model enumeration does not upgrade them into new photograph checks. Source-metadata writers participate in the generation hash.

Evidence, photograph availability, licensing and complete export proof have separate meanings. Use the existing publication fixtures across JavaScript and Python when changing qualification rules. See [catalog behavior](catalog.md) and [input evidence](../data/README.md) before refreshing data.

Generated assets under `public/hub/assets/` and `public/hub/datasets/` are Git-ignored. Do not edit them directly or commit local reports, credentials, private word lists or generated runtime state.

## Shared styles

Hub pages use ColmapView's public-page design. `public/hub/colmapview.css` is a byte-for-byte copy of the viewer's `public/policy.css`; its IBM Plex Sans font and license live in `public/hub/fonts/`. `public/hub/styles.css` adds Hub-specific styles.

`scripts/check-colmapview-css.mjs` verifies the pinned SHA-256 as part of `check:code`. The viewer's `src/theme/policyCssCopy.test.ts` pins the same value. To update the copy, copy the viewer's file and update both hashes together.

New static files outside `/hub/assets/` and `/hub/fonts/` need a matching negative entry in `wrangler.jsonc`'s `run_worker_first`, or the Worker will treat the request as a lookup. Keep static paths, routes, `HUB_PATH` and `public/_headers` aligned. See [production setup](operations.md) for deployment checks.
