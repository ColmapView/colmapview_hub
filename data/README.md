# Dataset catalog

`catalog.json` is the production input for source collection metadata, reported licenses and dated audit evidence. `individual-datasets.json` and `individual-datasets/*.json.gz` preserve the model and scene identities used by the main browser. Generated HTML, metadata packs, search indexes and downloadable JSON are rebuilt under `public/hub/datasets/` and are ignored by Git.

Import the existing local research files with:

```powershell
npm run catalog:import -- --viewer-root C:/Users/HEQ/Projects/colmap_webview/colmap-webview
```

The importer reads the HF search inventory, broader public catalog and dataset loading notes specified in `scripts/import-catalog.mjs`. It records each input's SHA-256, row count and survey date. It performs no network requests and does not download images or dataset contents.

One source record in `catalog.json` represents an HF repository or a public scene/subset/variant. These source records remain available through the collection browser and their original detail URLs. Search matches with no supported 3D evidence and inspection errors are excluded. Gated sources, conversion candidates, fixtures and incomplete checks remain labeled. Additional audited sources are retained even when they were not in the browser-readable public catalog. Audits of another file in the same Zenodo collection are identified as collection-level evidence.

Source IDs derive from stable source identities. Individual IDs hash the source identity, model kind, archive identity and model path, independently of revisions, counts and scan dates. Refreshing metadata preserves existing URLs. The normal build and deploy commands rebuild all catalog assets. Individual pagination and filters work without JavaScript; the browser enhancement requests one results page at a time from the same-origin read-only catalog endpoint.

Reviewed false positives remain in the catalog with an explicit **Not loadable in ColmapView** label and the inspection evidence. Record these findings in `catalog-reviews.json`; the importer reapplies them and removes any viewer link. Each review must match the imported repository revision. If that revision changes, import stops until the finding is checked again. A repository name containing “Replica” or another 3D dataset name does not establish that it includes a reconstruction.

Licenses are copied from the recorded source metadata. Missing or unconfirmed terms stay explicit; the Hub does not infer permission or license the underlying datasets. Source metadata and audit receipts are not complete render certifications. Browser transport failures and format conversions remain separate from access and licensing.

`licenseCategory` adds three source-derived groups to every collection and individual entry: `commercial` (Commercial use), `non-commercial` (Non-commercial / NC), and `not-specified` (Not specified). Exact reported licenses remain unchanged. The shared rules in `src/shared/license-categories.ts` recognize complete identifiers; they do not search arbitrary text for words such as MIT or commercial. Multiple recorded licenses must all map to the same category; a missing, unknown or conflicting component stays unresolved. Code licenses reported by a repository do not independently establish rights to every underlying image, model or third-party asset.

The rules follow the [Creative Commons license descriptions](https://creativecommons.org/cc-licenses/) and [CC0 terms](https://creativecommons.org/publicdomain/zero/1.0/), the [Open Source Initiative's commercial-use explanation](https://opensource.org/faq), [ODbL](https://opendatacommons.org/licenses/odbl/summary/), [ODC-By](https://opendatacommons.org/licenses/by/summary/), [CDLA Permissive 2.0](https://spdx.org/licenses/CDLA-Permissive-2.0.html), [Etalab's Open Licence](https://github.com/etalab/licence-ouverte/blob/master/open-licence.md), [CreativeML OpenRAIL-M](https://huggingface.co/spaces/CompVis/stable-diffusion-license/blob/main/license.txt), [FAIR Noncommercial Research](https://huggingface.co/facebook/fair-noncommercial-research-license/blob/main/LICENSE), and the [Niantic dataset agreement](https://nianticspatial.com/research/map-free/dataset), reviewed October 16, 2026. Commercial use remains subject to each license's conditions, including share-alike or acceptable-use restrictions where applicable.

`apple-amlr` stays unresolved: this identifier alone does not establish which Apple terms and asset scope apply. The [current ARKitScenes license](https://github.com/apple/ARKitScenes/blob/main/LICENSE) includes both a non-commercial grant and conditional commercial terms. The public JB3D string records CC BY plus an author `LICENSE-DATA.md`; its additional terms have not been independently reconciled. Generic `cc`, `other`, `unknown`, missing and unconfirmed license strings also remain Not specified.

Run `npm run catalog:licenses` to refresh the committed snapshot from these offline rules, or use the normal catalog importer, which applies them last. The snapshot records the rule file's SHA-256 and category provenance. Builds reject stale classifications. Category filtering composes with the existing exact-license, dataset, evidence and delivery filters; individual model counts are preserved.

No preview or source image is embedded or fetched by these catalog pages. Preview support can be added to the metadata and renderer later.

## Individual models and dataset labels

The October 16 individual inventory contains **2,158,128 model/scene entries** from **1,075 source records with identified items**. These are listed file/model identities, not a count of unique physical scenes or successful viewer loads. A large share consists of geometry, PLY files and camera metadata whose compatibility still needs individual checks. The 2,113 source collection records and the 5,697-source audit remain separate counts.

Each entry carries a dataset label, source collection, exact model path, reported source license and its own evidence level. Labels default to the HF repository name or public collection name. `dataset-labels.json` provides reviewed names for sources whose download filename is unclear. The Dataset filter and the label on each card lead to related entries. Public scene/source records with the same label are grouped in that filter; their individual source identities, license metadata and checks remain separate. HF collections stay scoped to their repository.

A co-located COLMAP camera/image/point file set is one entry. Binary/text copies do not become separate models. Clearly named companion PLY components, including NGS inside/surface Gaussians, stay with their unique reconstruction. A paired inside/surface Gaussian scene without COLMAP is also one entry. Unrelated models and ambiguous reconstruction roots remain separate. Standalone models and camera-metadata inputs retain individual identities. Different captures, model variants and copies across repositories have not been globally deduplicated.

NGS now has **261 scene entries**: 260 complete COLMAP file sets and one paired Gaussian-only scene. A pinned directory walk visited 783 model directories and deliberately omitted 518 photograph/mask/depth/video directories, bypassing the earlier 100,000-sibling cap. The source metadata now records 260 COLMAP models and 518 companion PLY files. The walk establishes filenames and grouping; it does not qualify every model or image for loading.

Previously aggregated public archives are split too: NeuMan has six reconstruction entries, Tanks and Temples / Deep Blending has four, the VolSDF DTU archive has fifteen camera-metadata entries, and On-the-go has twelve camera-metadata entries. The individual entries record their extraction paths. Archive-directory evidence does not certify their complete decoding or rendering.

The compressed canonical listing for each source stores tuples of `[kind, path, files-or-null, containing-archive-or-null]`, with the source revision, coverage and SHA-256 in the registry. The original source audit is inherited as collection-level evidence. The individual browser has 429 checked viewer links, retained only for exact sampled models or companion files. Other plausibly native models offer an explicitly unchecked trial link. Known decoder failures retain their conversion status. Multi-model archives record extraction paths; collection pages keep their historical archive sample links and evidence.

Fifty-one source listings remain incomplete, and uninspected/nested archives may contain additional models. No aggregate collection is silently counted as one scene when its individual models have not been identified. The public source survey's already named scene/subset entries retain their identities.

To regenerate the canonical individual listings from the saved metadata, then rebuild:

```powershell
python scripts/prepare_individual_datasets.py --metadata PATH_TO_FULL_AUDIT/metadata --old-inventory PATH_TO_HF_SCAN/all-candidates.json --refresh-model-source OpsiClear/NGS
python scripts/prepare_public_individuals.py
npm run catalog:import -- --viewer-root PATH_TO_VIEWER
npm run build:assets
```

The public-archive command reads ZIP central directories with bounded anonymous ranges and preserves resumable receipts under `.tmp/`. The HF command reads the saved public metadata; its optional pinned model-directory refresh reads provider metadata only. Neither opens photographs or generates previews. Future fresh source/revision audits must refresh the individual listing too; mismatched revisions stop the import/build.

The offline build uses Python 3.11+ to create metadata packs, ID shards, delta-compressed search posting lists, filter facets and source metadata. The Worker reads only fixed keys through the same-origin `CATALOG_ASSETS` binding, bounded to 5 MiB per asset. It never fetches dataset URLs, enumerates R2 records or writes a catalog entry at runtime. Search accepts up to six words and renders 24 entries per page. The catalog uses the existing static-asset storage and has no database.

## Full inventory audit

`dataset-audit.json` preserves the assessment of all 5,602 original HF candidates and 95 public scene/source entries, including rejected matches. The October 16 refresh identified compatible native headers in 589 HF sources and 42 public entries. Twelve HF sources were newly qualified relative to the old ready-format list; six of those had been excluded from the Hub. Twenty-seven former ready-format claims now require additional qualification. The source collection catalog contains 2,113 records after recovery, with 590 checked sample links. Fourteen actual viewer samples were tested: eleven passed; three newer SPZ wrappers failed decoding and retain conversion labels.

The audit separates file listings, original format headers, source access, browser transport and actual viewer imports. The released compatibility target is ColmapView 0.16.14. A checked source-collection viewer action requires native headers and successful browser reads for its exact sample. Individual entries additionally offer explicitly unchecked trial links where appropriate. A loose public COLMAP model can use a generated manifest with relative paths; a virtual directory prefix is not treated as a downloadable object. Multi-scene public archives retain scene-specific extraction instructions.

The audit receipt includes every excluded source's identity, so another refresh can start from the committed file rather than relying on `.tmp/`. A fresh output directory makes new requests; the same output directory resumes its existing dated receipts:

```powershell
python scripts/dataset_audit.py --inventory data/dataset-audit.json --out .tmp/audit-refresh --phase metadata --use-existing-hf-auth
python scripts/dataset_audit.py --inventory data/dataset-audit.json --out .tmp/audit-refresh --phase probe
python scripts/dataset_audit.py --catalog data/catalog.json --out .tmp/audit-refresh --phase public
node scripts/build-audit-browser-plan.mjs --dir .tmp/audit-refresh
```

The optional existing HF token is used only on exact public metadata API endpoints, with redirects disabled. Asset probes remain anonymous. Private content and dataset scripts are never read or executed. Metadata responses, archive directories and decompression prefixes are bounded; rate-limit windows and request deadlines are respected. A negative archive conclusion requires a complete repository listing and all listed archives to have been inspected without unresolved nesting. Native-header evidence is representative, not every model's full parse or a render certification.

For browser receipts, open an `@playwright/cli` session named `dataset-audit` at the production viewer origin from `.tmp/`, then run `node scripts/run-audit-browser.mjs --dir .tmp/audit-refresh --cli PATH_TO_INSTALLED_PLAYWRIGHT_CLI_JS`. It uses bounded browser prefix reads and exact archive tails. Optional UI sample receipts use `scripts/run-audit-samples.mjs` with a local `sample-plan.json`. Finish with `node scripts/finalize-dataset-audit.mjs --dir .tmp/audit-refresh --viewer-version VERSION`, then rerun the catalog import above. The importer reapplies the committed audit and manual reviews, preserving entry URLs and preventing older CSV claims from restoring unchecked viewer links.

Raw HTTP caches, browser logs, screenshots and runtime files stay under `.tmp/`. The committed receipt contains public source identities, pinned revisions, checked URLs and qualified findings. Repository license metadata does not independently establish permissions for underlying assets; public catalog license evidence retains its original provenance.
