# Gaussian companion audit — October 25, 2026

The audit reviewed the pinned source inventories behind all **4,559 published
scenes in 144 collections**. It links **2,564 distinct Gaussian files** through
**4,619 scene-to-file bindings in 696 scenes**. Shared-camera references can offer
the same model, so bindings are not distinct models. Scene IDs, share names,
source pins, native camera counts, sparse points and earlier export receipts stay
unchanged. The new camera-dataset v2 wrapper requires **viewer 0.25.0**; native
COLMAP manifests retain their existing versions.
Viewer 0.25.1 also distinguishes repeated filenames with the shortest unique
trainer, seed or time suffix in the picker.
Distinct files here means pinned source URLs; mirrored content is not
deduplicated by a complete payload hash.

The checked assets include Gaussian PLY, raw SPLAT and SOG. PLY classification
uses the viewer's parser; raw SPLAT checks total 32-byte record length and bounded
sampled position/scale records; SOG checks its ZIP metadata and declared count.
All linked assets have pinned URLs, byte counts, format-prefix digests and public
CORS evidence. The fresh PLY pass checked 2,087 headers without failures, reusing
6,578 earlier pinned checks; 26 additional SPLAT/SOG probes passed. These are
format and association checks, not full downloads, complete pixel comparisons or
new COLMAP-export certification for every model.

## Association rules and limits

- Geometry follows the selected reconstruction hierarchy. A shared photo folder
  cannot assign geometry to a different reconstruction variant.
- GS-Pool matches capture, instance and joint/anchored world. `solve/t1` and
  `solve/t2` receive their corresponding time only. Change subsets remain labeled
  separately from whole-scene alternatives.
- D3DGS and DyNative sequences select their first published Gaussian frame.
  Other time samples stay inventoried rather than being merged into a static scene.
- Training iterations, trainers, levels of detail and source formats are separate
  choices. Their Gaussian counts are never added to sparse-point counts or summed
  as one model. The existing viewer budgets keep multiple and large models lazy.
- Four alternate GaussianEditor SPLAT exports match 48, 48, 1,321 and 1,263
  distinct float32 XYZ records from the corresponding native-scene Gaussian PLY
  prefixes. Bounded, hashed one-MiB samples establish the shared world without
  claiming identical edited geometry. 168 zero-vertex files remain explicitly
  empty and never become selectable models.
- Clean and poisoned Poison-3DGS selections receive their own outputs, including
  geometry stored inside scene file maps. Other algorithm variants stay separate.
  A compressed PLY in `promc/reconstruction-scenes/lawn-tree` still
  requires conversion. Unassociated objects and scenes absent from the published
  catalog remain inventory evidence rather than new cards or guessed links.

The planner reconciles standalone inventory items, every scene's embedded file
map and all previously checked Gaussian badges. All checked Gaussian badges now
have an explicit companion binding or an existing selected Gaussian geometry
frame (27 scenes). The 20 archive-only presence records retain their earlier
scope; a selected XYZ frame does not certify other archive members as Gaussians.

`/s/OcularBell` keeps its 100 NeRF camera poses, photos and zero native sparse
points, and adds `trained/mic.ply` (13,059 Gaussians). A complete source-byte digest
and independent projection into six original photo alpha masks establish the
identity alignment: weighted silhouette coverage is 99.71%, versus 57.98% for the
next best proper axis rotation. The PLY's axis comment alone is not an alignment
instruction.

## Evidence and rerunning

- `data/gaussian-link-audit.json.gz`: every scene outcome and every inventoried
  geometry asset, including rejected variants, other frames and unowned assets.
- `data/gaussian-routing.json.gz`: sealed exact model selections, original launch
  bodies, selected companions and format receipts. Builds fail if source pins,
  model files or the existing media launch changes without re-audit.
- `scripts/audit/plan_splat_links.py`: offline candidate ownership inventory.
- `scripts/audit/check-splat-link-headers.mjs`: resumable, bounded public PLY reads.
- `scripts/audit/check-raw-splat-links.mjs`: bounded SPLAT/SOG checks.
- `scripts/audit/check-splat-position-associations.mjs`: exact sampled XYZ
  fingerprints for alternate exports, with both prefix digests retained.
- `scripts/audit/prepare-splat-links.mjs`: derive launches with the viewer's real
  discovery/schema helpers; preserve original media paths and model files.
- `python -m scripts.audit.record_splat_links --audit-dir PATH`: validate and seal
  the prepared audit. Inspect the prepared associations before recording them.

The October 25 operator scripts use `.tmp/splat-link-audit-20261025` and the sibling
viewer checkout. Network work is explicit and separate from ordinary builds.
`npm run catalog:manifests -- --viewer-root ../colmap-webview` checks all emitted
manifest schemas and body checksums offline. `--load` performs a separate,
budgeted real-browser load audit; it must not be represented as completed by a
schema/header-only pass. New cards still require the normal catalog qualification.

## Release verification

Hub **0.16.0** is deployed as Worker version
`c476d360-f45d-4735-a782-8900e5acb963`; viewer **0.25.1** is live on the custom
host, its Pages origin and GitHub Pages `/latest/`. Both release CI runs passed.
The [production receipt](../data/gaussian-links-release-2026-10-25.json.gz) records:

- All **2,564** selected Gaussian files passed fresh anonymous availability,
  exact-size and CORS checks, including the reused pinned format receipts.
- Every one of the **696** changed manifests matched its published checksum,
  declared sources and open redirect. **713** grouped production checks passed,
  including short-address viewer shells, CSS headers, legacy upload routes and
  the retired credential service. The create API was checked with its supported
  OPTIONS/POST contract; its unsupported GET correctly returns 404.
- All **3,455** retained/generated manifest schemas passed; the complete local
  suite passed 99 Node, 187 Python and 267 Worker tests, all 95 Hub browser tests
  and three manifest-runner tests.
- A real OcularBell load retained **100 camera poses, zero sparse points and
  13,059 decoded Gaussians**, with its published manifest bytes and short address
  verified. The production model was also visually confirmed in Chromium.

These checks do not claim a complete download/render or full photo export of
every other Gaussian model or every frame in a temporal sequence.
