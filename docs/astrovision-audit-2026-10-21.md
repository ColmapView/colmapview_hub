# AstroVision discovery and manifest audit — October 21, 2026

The complete pinned source contains **423 native COLMAP reconstructions**: 206
cluster selections and 217 mission segments. The Hub previously listed 72 cluster
selections. The 351 additions include
`segments/haya_itokawa/20050909_20051119`. Twelve standalone shape PLYs remain in
the research inventory; they do not create extra camera-scene cards.

The source revision is `43af772130675058f894824d50cbe2b390315061`. It is unchanged
from the earlier inventory. The omission came from incomplete recursive discovery,
not newly uploaded files. Directory traversal now exhausts pagination at each
model directory, accepts HF's equivalent encoded repository-slash links, rejects
links outside that exact directory/revision and records deliberately omitted
media directories. Depth maps remain outside the photograph inventory.

The audit visited 458 model/metadata directories and separately enumerated all 846
scene-owned photo/mask directories. All 423 calibrations were read completely;
pose/point counts, first records and minimum complete-file sizes were checked
against the pinned source metadata. Anonymous Chromium reads from the production
viewer origin matched every checked model response hash. One registered original
photograph and its same-name mask decoded for each reconstruction and matched the
sample's camera dimensions.

Each of the 351 new manifest selections passed the released viewer's schema,
model selection and photo/mask binder without a collection prompt. Physical
inventories are complete; native registered-name checks remain bounded. Only one
new reconstruction had every registered name inside its bounded pose response.
No stronger full-model or photograph-export tier is inferred from these checks.

Existing scene identities, model counts, launch URLs, thumbnails and immutable
manifest bodies are preserved. New entries do not require thumbnails: their
original photo hash, decoded dimensions and browser receipt bind the routing
review independently. The public catalog now contains **4,418 scene entries from
144 source records**, including 420 AstroVision cards. Copies across source
repositories remain separate.

The Itokawa segment declares one camera model, 560 registered poses and 396,245
points. Its selected native files total 2,895,221,423 bytes before photographs.
Across the source, native models total 72,500,640,345 bytes; the largest individual
pose file is 5,490,849,273 bytes. Header and media-routing checks do not establish
that these largest models fit every browser's memory limits.

Viewer **0.20.4** fixes the Itokawa import's single-buffer limit with a bounded
pose index and original observation reads in the browser worker. Exact dense
track statistics replace redundant pairwise Map updates when a bounded bitset
calculation is cheaper. The source files, calibrations, poses, point counts and
observation IDs are preserved. In a temporary regular Chromium profile, Itokawa
loaded its original 1 camera model, 560 poses and 396,245 points in 98.7 seconds.
The deployed 0.20.4 production viewer also loaded that exact immutable selection
through its public Hub redirect in 248 seconds, without browser exceptions.
The preceding attempt parsed the model but timed out computing statistics at 600
seconds. Private-context Blob storage failures retain a separate resource scope;
these results do not certify every photograph, alignment or complete large export.

Both complete bounded sweeps attempted all 423 original manifests, first with
viewer 0.20.2 and again with the fixed 0.20.3 runtime: **352 full model imports
passed and 71 exceeded the 256 MiB transfer limit** in each sweep. The release
0.20.4 changes only version/changelog metadata and Node 22 test interoperability
from that rerun; its parser, download, worker and statistics code is unchanged.

Higher-budget retries completed the remaining coverage. The Itokawa run plus all
67 other previously byte-limited published selections passed in temporary regular
Chromium profiles. Across all 423 reconstructions, **420 full imports passed and
three aborted in the native decoder**. Every published AstroVision scene now has
a successful full-import receipt with matching original source and camera, pose
and point counts. A byte-budget stop is never counted as a successful import.

`segments/cas_dione/opus`, `segments/cas_rhea/opus` and
`segments/cas_tethys/opus` completed their original 4.98–7.36 GB downloads but
aborted before committing a reconstruction (viewer 0.20.3, temporary regular
profiles, 8 GiB transfer budget, 600 s deadline). Their exact failure cause remains
unclassified. Their cards are withheld; immutable manifests and all audit evidence
remain available. These failures are separate from photo routing or HTTP access.

All 423 retained production manifest bodies passed hash, CORS and ETag checks.
All 420 published direct-open routes returned the exact viewer selection, the
catalog reported 4,418 entries and 144 sources, and the catalog landing redirect
and stylesheet passed separate serving checks. Individual attempt generations,
viewer revisions, byte budgets and browser contexts remain in the receipt.

The durable public evidence is
[`data/astrovision-audit-2026-10-21.json.gz`](../data/astrovision-audit-2026-10-21.json.gz).
It retains source-directory receipts, exact file selections, native response
hashes/sizes, sampled decoded media, inventory digests and manifest identities.
Full loading attempts and resource exclusions retain their own scope in that
receipt. Every model's photographs, mask semantics/alignment and complete exports
have not been exhaustively checked.

For a prepared, complete pinned model-directory listing:

```sh
python -m scripts.audit.audit_native_layouts --listing LISTING.json.gz --scratch .tmp/native-audit --media
node scripts/audit/audit-native-transport.mjs --plan .tmp/native-audit/plan.json --out .tmp/native-transport --resume
```

These operator commands read bounded public metadata/native prefixes and media
samples. They retain local caches, honor provider quotas and never execute source
scripts. Normal builds and the Worker perform no source audits. Existing
`audit-photo-routing.mjs` prepares selection-bound routing reviews offline;
`catalog:manifests --source hf:travisdriver/astrovision-data --load` separately
tests original deployed manifests through the real viewer.
