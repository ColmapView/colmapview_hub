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
