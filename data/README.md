# Dataset catalog

`catalog.json` is the production input for the Hub's public dataset pages. It contains normalized public source metadata, reported licenses and dated audit evidence. Generated HTML, the search index and downloadable JSON are rebuilt under `public/hub/datasets/` and are ignored by Git.

Import the existing local research files with:

```powershell
npm run catalog:import -- --viewer-root C:/Users/HEQ/Projects/colmap_webview/colmap-webview
```

The importer reads the HF search inventory, broader public catalog and dataset loading notes specified in `scripts/import-catalog.mjs`. It records each input's SHA-256, row count and survey date. It performs no network requests and does not download images or dataset contents.

One entry represents an HF repository or a public scene/subset/variant. Search matches with no supported 3D evidence and inspection errors are excluded. Gated sources, conversion candidates, fixtures and incomplete checks remain labeled. Additional audited sources are retained even when they were not in the browser-readable public catalog. Audits of another file in the same Zenodo collection are identified as collection-level evidence.

Entry IDs derive from stable source identities. Refreshing counts, licenses and loading evidence preserves their URLs. The normal build and deploy commands rebuild all catalog assets. Pagination works without JavaScript; search and filters use a compact same-origin metadata index.

Reviewed false positives remain in the catalog with an explicit **Not loadable in ColmapView** label and the inspection evidence. Record these findings in `catalog-reviews.json`; the importer reapplies them and removes any viewer link. Each review must match the imported repository revision. If that revision changes, import stops until the finding is checked again. A repository name containing “Replica” or another 3D dataset name does not establish that it includes a reconstruction.

Licenses are copied from the recorded source metadata. Missing or unconfirmed terms stay explicit; the Hub does not infer permission or license the underlying datasets. Source metadata and audit receipts are not complete render certifications. Browser transport failures and format conversions remain separate from access and licensing.

No preview or source image is embedded or fetched by these catalog pages. Preview support can be added to the metadata and renderer later.

## Full inventory audit

`dataset-audit.json` preserves the assessment of all 5,602 original HF candidates and 95 public scene/source entries, including rejected matches. The October 16 refresh identified compatible native headers in 589 HF sources and 42 public entries. Twelve HF sources were newly qualified relative to the old ready-format list; six of those had been excluded from the Hub. Twenty-seven former ready-format claims now require additional qualification. The public catalog contains 2,113 entries after recovery, with 590 checked viewer links. Fourteen actual viewer samples were tested: eleven passed; three newer SPZ wrappers failed decoding and retain conversion labels.

The audit separates file listings, original format headers, source access, browser transport and actual viewer imports. The released compatibility target is ColmapView 0.16.14. Only exact HF samples with native headers and successful browser reads receive a viewer action. A loose public COLMAP model can use a generated manifest with relative paths; a virtual directory prefix is not treated as a downloadable object. Multi-scene public archives retain scene-specific extraction instructions.

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
