# Dataset catalog

The current catalog contains **4,070 scene entries from 144 source records**. ScanNetPoseRefine initialization/refinement pairs now have one card per capture, while all 1,513 historical initialization IDs retain their exact models. Copies across repositories remain separate. [Catalog documentation](../docs/catalog.md#per-manifest-loading-checks) describes the per-manifest schema and live-loading checks; generated `index.json` and `photo-audit.json` supply current totals.

The [October 20 zero-point audit](../docs/zero-point-audit-2026-10-20.md) covers 357 original zero-point selections. [zero-point-audit.json.gz](zero-point-audit.json.gz) records 63 point recoveries with 16,202,532 points/vertices and 27 loaded Gaussian frames; its remaining 267 cases have scoped absence, auxiliary-array or mesh findings. All 47 temporal archive launches are implemented and have their own dated production receipts below. Confirmed scoped findings can be reused at the same pin and evidence key.

[zero-point-sibling-live-verification.json.gz](zero-point-sibling-live-verification.json.gz) records all 28 latest published imports and actual COLMAP downloads in Hub 0.9.13 / viewer 0.19.9, independently matched to pinned source bytes, with the deployed generation and HTTP checks.

[zero-point-sibling-inspection.json.gz](zero-point-sibling-inspection.json.gz) records the 28 latest same-world cloud/native-track associations, reference receipts and independent complete COLMAP reads, plus the separate temporal archive worklist.

[zero-point-live-verification.json.gz](zero-point-live-verification.json.gz) records seven production browser imports through the published Hub, decoded photographs, retained share sources, actual COLMAP downloads and independent source comparisons. It pins viewer 0.19.9, Hub 0.9.12 and the tested catalog generation; it does not claim full browser imports of every catalog scene.

`catalog.json` is the production input for source collection metadata, reported licenses and dated audit evidence. `individual-datasets.json` and `individual-datasets/*.json.gz` preserve the research file/model inventory. The public browser projects that inventory into named scene datasets. Generated HTML, scene metadata packs, search indexes and downloadable JSON are rebuilt under `public/hub/datasets/` and are ignored by Git.

## Coverage follow-up

The October 18 follow-up publishes **5,579 scenes from 147 collections**, adding 342 scenes while retaining all 5,237 previous scene records. [coverage-review.json](coverage-review.json) records the disposition of all 439 earlier candidates: 305 camera-only candidates, 39 omitted HF camera/RGB shortlist sources and 95 public research entries. It is a review ledger; entries marked `blocked` or `qualification_pending` are excluded from the supported Hub catalog.

The additions comprise 303 native camera/pose models without point files, one newly discovered complete AstroVision model, 34 HF camera-metadata scenes and four public scenes. Fresh model-folder enumeration found AstroVision's previously omitted `points3D.bin`: that scene has 766 poses, two camera definitions and 89,440 points. Camera-only models require checked point-file absence and report zero points without pretending an empty point file was downloaded.

`scene-source-overrides.json` preserves the recovered DTU source metadata and the four exact public launch targets during `catalog:import`. It does not create source-wide viewer actions or qualify scene layouts. The separate native/export receipts still control publication, and changed source identities or revisions require a recheck.

All 846 distinct native model/photo-sample URLs passed anonymous browser reads from the production viewer origin. Complete camera definitions, pose samples, count headers and complete text totals were checked separately. All eight source families passed representative actual viewer imports. Exactly 237 calibration-matched native photo prefixes now use content-addressed launch manifests with explicit pinned files and image roots. Their same-origin base prevents HF discovery from selecting another reconstruction. Prefix receipts establish a registered photo sample, not a complete image inventory or all-photo export.

The initial 37 camera-metadata scenes passed actual ColmapView 0.17.7 imports and model-only ZIP exports, followed by independent PyCOLMAP/NumPy comparisons of every exported calibration and pose against the complete original metadata. This covers NeRF transforms, LLFF camera arrays, DTU camera projection NPZ, OpenMVG and OpenSfM. Metadata filenames now also include `cameras.json`, `reconstruction*.json`, `sfm_data.json` and `bundle.out`; discovery alone never grants publication. DTU inverse-matrix sidecars are not extra cameras, and no depth/normal payloads are needed.

The NL3D follow-up replaces its camera-only receipt and adds seven sibling scenes. All eight original pinned `transforms.json` URLs loaded and rendered with their scene-local `points_gt.ply` in a local production build of viewer 0.19.3 (`ba4d99866a7ec2817767a7c254157fb54449ad7c`). Independent checks matched all 400 calibrations/poses and all 721,835 XYZ values, default white colors, IDs and empty tracks in the actual browser ZIPs. `companionPointCloud` binds each positive point count to a required source-byte receipt and `pointValues` check. XYZ coordinates retain the saved camera world frame; no observations are invented. The offline camera export verifier accepts per-scene reference-photo headers and companion PLY receipts; it performs no network reads. Each scene retains sampled-photo evidence, rather than claiming full RGB export. Release this viewer code before publishing the prepared catalog; no new preview images are included.

The public additions are Instant-NGP Fox, OpenMVG SceauxCastle, OpenSfM Berlin and MegaScenes Arc de Berà component 0. GitHub metadata URLs use exact commits. Mutable public native URLs are bound to a SHA-256 source snapshot and an immutable manifest, with receipts for every original model file. MegaScenes' eight camera definitions, 15 poses, 2,321 points, 79,173 observations and 10,272 track references passed an independent export comparison. Native point positions/errors retain the viewer's documented float32 precision; this is not lossless float64 export. Public URL transport and original-photo export remain separate evidence.

`colmap_model` receipts never become `colmap_images` receipts. The 20 existing complete original-photo exports retain their stronger tier. Falcary's selected metadata references 200 frames but its complete RGB folder supplies 100; the viewer exports exactly those 100 original frame IDs, and the card reports partial photos. Fox retains its known 50-of-67 photo coverage. Two new scenes retain a media-path/resolution setup label, 64 retain association-review labels and three have unestablished photo inventories. Sixteen new scenes have attributed previews under their recorded commercial-use licenses.

Six HF candidates remain blocked: one native 404, one camera-keyed OpenIllumination dictionary, one SparseCraft projection with unrepresentable skew and three e-nerf mirrors whose frame 84 exceeds the current rotation tolerance (orthogonality error 2.8511653648468846e-5 versus 1e-5). These are exact exclusions; no pose or skew was silently repaired. All 95 public research entries have a recorded disposition. Anonymous browser reads failed for five download URLs (NeuMan, Tanks and Temples/Deep Blending, two Middlebury archives and On-the-Go). The remaining 86 public research entries need exact scene selection and current model-export qualification; a collection ZIP must not become several scene cards that all open its first model. Bundler Kermit specifically needs an authoritative ordered `list.txt` or `images.txt` to associate cameras with photographs; filename sorting does not establish that mapping.

The repeatable metadata/model comparison is offline and requires NumPy, Pillow and PyCOLMAP:

```sh
python -m scripts.audit.verify_camera_model_exports --dir PATH_TO_LOCAL_RECEIPTS --frame-coverage PATH_TO_OPTIONAL_FRAME_COVERAGE_JSON
```

The directory contains `model-browser-results.json`, complete `model-source/<scene-id>.bin` responses, `exports/<scene-id>.zip`, `reference-photos.json` and its original photo headers. Source and export byte sizes/hashes must match the browser receipts. Optional frame coverage maps scene IDs to the exact complete RGB-folder listing path/hash, pinned API URL, browser receipt and selected original frame IDs. The verifier recomputes that selection and exits unsuccessfully if any exported scene fails. Downloads, browser logs and raw audit reports stay under `.tmp/`; normal builds and the Worker perform no source fetches.

## Photograph availability and path policies

`scene-photos.json.gz` is a compact, curated projection of the per-scene image/path audits, covering all published scenes at their exact source revision and selected model file paths. `scripts/catalog/scene_photos.py` rejects revision/file drift, duplicate scenes, unscoped incomplete inventories, unsupported photo claims and invalid coverage counts. A bounded incomplete inventory can establish an exact registered sample only with its prefix hash, browser receipt and explicit calibration-dimension result; unknown inventory remains `not_checked`. Full published coverage is required by this input; an unaudited new scene must receive an explicit availability review. Photo evidence never changes model launch eligibility or upgrades a bounded header check into a complete scene/export check. Independently verified camera-and-photo exports keep their stronger proof.

The underlying pass checked all 5,239 then-published scenes in 105 repositories, complete pinned inventory evidence, 339 complete camera/pose metadata pairs through the current native media binder, 22,417 CSV mapping targets, 2,982 Waymo V2 JSON mapping targets and 478 companion image ZIP indexes containing 61,459 image members. New production-origin browser reads covered 172 photo URLs and all 478 ZIP tails: 106 photos decoded, 66 were deferred by the pixel/byte bounds, and no attempted read or pixel decode failed. Same-pin browser receipts from earlier that day cover other existing samples. Complete model, all-photo and export checks remain separate. Raw receipts, source bytes and generated research reports stay in ignored local audit folders.

Two complete Eiffel Tower `images.bin` downloads match the publisher's LFS hashes but truncate after seven and five complete records out of 1,107 declared images. Their exact paths, sizes and hashes are retained in `scene-exclusions.json`; their first readable record cannot restore publication. The other 5,237 records remain camera/model scenes, including those without photographs.

Photo policies keep exact model files separate from media scopes; honor `image_mapping.csv`; record future `mapping.json` rebasing for Waymo V2; identify companion `images.zip` members; and require explicit image/mask/modality roles. They do not borrow another scene's same-name frames or substitute undistorted photos for a distorted model by filename. A scene with partial or missing photos retains model-only loading. Current generic HF listing pagination has an equivalent-slash-encoding gap in 53 audited scopes; an audit-only canonical-pagination reader established their complete inventories. No viewer implementation change is implied by these Hub records.

Generated public output includes per-scene photo facts in the metadata packs, a `photos` search facet, `/hub/datasets/individual/photo-audit.csv` and `/hub/datasets/individual/photo-audit.json`. The Worker reads only fixed same-origin catalog assets; it performs no photo/source requests. Refreshing the canonical inventory requires checking photo reviews against the new pin, not copying an older source-wide sample to new scenes.

The `scene0736_00_gtpose_shared/sparse/0` follow-up at revision `1e07d6d9f9f0ddd23c55eea3649107bc5a6bc698` establishes 1 camera definition, 737 poses and 49,379 points by parsing all three text model files. Eighteen text models in this repository now have complete-file counts; the original bounded header samples could not establish their totals. `native-layouts.json.gz` stores each count audit with the exact model paths, file sizes, SHA-256 hashes and viewer parser revision. Other uncounted text models retain Unknown; complete parsing of an oversized model is deferred. These checks establish model statistics, not complete rendering or photo exports.

All 49,379 points in this ground-truth model have empty observation tracks. The viewer's default minimum track length of 2 hides them; set it to 0 to display these points. Empty tracks do not mean an empty point file.

The `alexmkwizu/colmap-testing-dataset` follow-up at revision `511152c3b9cd20ecda698e1ed1559c341ee777ab` adds complete native-parser counts for all seven published scenes. `kicker/dslr_calibration_jpg` has 1 camera definition, 31 poses and 15,897 points. Its THIN_PRISM_FISHEYE camera uses 6048 x 4032 distorted DSLR photographs. Viewer 0.17.1 finds all 31 registered `dslr_images/*.JPG` originals below `kicker/images` from both the calibration-folder and parent Kicker URLs; all originals pass full browser decoding. Viewer 0.17.2 streams its complete 414,603,162-byte image ZIP, containing 407,323,548 photo bytes. Independent Python ZIP reads validate all photo CRCs and SHA-256 hashes against the pinned LFS objects. Native parser comparisons preserve intrinsics, poses, names, observations and every point field, with zero coordinate difference. The distorted model retains its original JPG representation. This added export evidence applies only to Kicker; other ETH3D scenes retain their existing qualification and photo evidence.

The publisher's `data/i2slam_trigsplat_gt/scene0736_00_manifest.json` identifies that exact model and `data/evssm_deblurred_i2slam/scene0736_00`. All 737 registered names appear in the pinned image directory; the first image passed a production-origin browser read and pixel decode at 1296 × 968, matching the shared camera. These are deblurred RGB images. The raw ScanNet directory mentioned by the manifest is not included in the selected scene. The current model URL discovers 0/737 photos because its scene scope excludes the sibling image directory. The photo review records the association manifest and required image root as `path_policy_required`; it does not silently substitute the processed images or claim a complete original-photo export.

Import the existing local research files with:

```powershell
npm run catalog:import -- --viewer-root C:/Users/HEQ/Projects/colmap_webview/colmap-webview
```

The importer reads the HF search inventory, broader public catalog and dataset loading notes specified in `scripts/catalog/import-catalog.mjs`. It records each input's SHA-256, row count and survey date. It performs no network requests and does not download images or dataset contents.

One source record in `catalog.json` represents an HF repository or a public scene/subset/variant. Published source records remain available through the collection browser and their original detail URLs. Search matches with no supported 3D evidence and inspection errors are excluded. Conversion candidates, fixtures and incomplete checks remain labeled. Additional audited sources are retained even when they were not in the browser-readable public catalog. Audits of another file in the same Zenodo collection are identified as collection-level evidence.

The build excludes gated/access-required sources using both catalog and audit evidence. `scripts/catalog/catalog-publication.mjs` filters the public collection pages, catalog downloads and audit download; the individual index builder applies the same policy, with shared policy fixtures for both implementations. An access restriction in either input excludes the source even if the other input is stale. Generated pages, source assets, model IDs, search postings and facets are rebuilt without those identities. Removed detail URLs return 404. The Worker response cache uses the current catalog generation before looking up a cached page or search result.

Source IDs derive from stable source identities. Individual IDs hash the source identity, model kind, archive identity and model path, independently of revisions, counts and scan dates. Refreshing metadata preserves existing URLs. The normal build and deploy commands rebuild all catalog assets. Individual pagination and filters work without JavaScript; the browser enhancement requests one results page at a time from the same-origin read-only catalog endpoint.

Reviewed false positives remain in the catalog with an explicit **Not loadable in ColmapView** label and the inspection evidence. Record these findings in `catalog-reviews.json`; the importer reapplies them and removes any viewer link. Each review must match the imported repository revision. If that revision changes, import stops until the finding is checked again. A repository name containing “Replica” or another 3D dataset name does not establish that it includes a reconstruction.

Licenses are copied from the recorded source metadata. Missing or unconfirmed terms stay explicit; the Hub does not infer permission or license the underlying datasets. Source metadata and audit receipts are not complete render certifications. Browser transport failures and format conversions remain separate from access and licensing.

`licenseCategory` adds three source-derived groups to every collection and individual entry: `commercial` (Commercial use), `non-commercial` (Non-commercial / NC), and `not-specified` (Not specified). Exact reported licenses remain unchanged. The shared rules in `src/shared/license-categories.ts` recognize complete identifiers; they do not search arbitrary text for words such as MIT or commercial. Multiple recorded licenses must all map to the same category; a missing, unknown or conflicting component stays unresolved. Code licenses reported by a repository do not independently establish rights to every underlying image, model or third-party asset.

The rules follow the [Creative Commons license descriptions](https://creativecommons.org/cc-licenses/) and [CC0 terms](https://creativecommons.org/publicdomain/zero/1.0/), the [Open Source Initiative's commercial-use explanation](https://opensource.org/faq), [ODbL](https://opendatacommons.org/licenses/odbl/summary/), [ODC-By](https://opendatacommons.org/licenses/by/summary/), [CDLA Permissive 2.0](https://spdx.org/licenses/CDLA-Permissive-2.0.html), [Etalab's Open Licence](https://github.com/etalab/licence-ouverte/blob/master/open-licence.md), [CreativeML OpenRAIL-M](https://huggingface.co/spaces/CompVis/stable-diffusion-license/blob/main/license.txt), [FAIR Noncommercial Research](https://huggingface.co/facebook/fair-noncommercial-research-license/blob/main/LICENSE), and the [Niantic dataset agreement](https://nianticspatial.com/research/map-free/dataset), reviewed October 16, 2026. Commercial use remains subject to each license's conditions, including share-alike or acceptable-use restrictions where applicable.

`apple-amlr` stays unresolved: this identifier alone does not establish which Apple terms and asset scope apply. The [current ARKitScenes license](https://github.com/apple/ARKitScenes/blob/main/LICENSE) includes both a non-commercial grant and conditional commercial terms. The public JB3D string records CC BY plus an author `LICENSE-DATA.md`; its additional terms have not been independently reconciled. Generic `cc`, `other`, `unknown`, missing and unconfirmed license strings also remain Not specified.

Run `npm run catalog:licenses` to refresh the committed snapshot from these offline rules, or use the normal catalog importer, which applies them last. The snapshot records the rule file's SHA-256 and category provenance. Builds reject stale classifications. Category filtering composes with the existing exact-license, dataset, evidence and delivery filters; individual model counts are preserved.

`scene-contents.json.gz` records exact pinned scene identities, scoped mask inventories, companion model header evidence and optional preview provenance. `scripts/catalog/scene_contents.py` rejects source/model drift, guessed Gaussian PLY classifications, changed preview hashes and missing provenance. Builds copy only referenced, hash-named JPEGs from `data/scene-thumbnails/` to fixed same-origin assets. Scene cards list available data separately from full loading evidence. Empty COLMAP point sets do not claim a point cloud, and pose metadata never counts as photographs.

Previews are 320 × 320 center-square crops of checked scene photographs. Operator preparation runs separately from builds using `python -m scripts.audit.prepare_scene_contents --plan <reviewed-plan.json>` and Pillow; plans must use pinned public Hugging Face file URLs. `python -m scripts.audit.prepare_scene_previews --scratch .tmp/scene-previews` fills missing previews from existing checked photo evidence, preserves existing crops and supports exact public sample URLs and bounded companion ZIP reads. Its optional `--archive-credits <publisher-images.csv>` retains per-photo terms and artists for MegaUnScene. Source hashes, original paths, known attribution, recorded image terms and crop disclosure follow the preview. Preview generation covers every license category, including non-commercial and unspecified terms, without changing license labels or model/photo loading evidence. Model-only scenes stay published.

Cards without a prepared thumbnail use a neutral placeholder. “No photo” applies only to established absence; “No preview” covers unverified or inaccessible photos.

## Named scene datasets and labels

The main browser counts scene entries within each source and archive. A scene needs a reconstruction set, camera-metadata layout, an existing paired scene record or an explicitly named public capture. A standalone mesh, point-cloud or splat filename does not establish a scene. Only scenes with eligible viewer launches are published; collections with no such scenes are excluded from pages, search and public downloads.

The current projection includes all 259 NGS scenes and 11 ArmGS captures. Native camera/model compatibility does not depend on photographs. `images.bin`/`images.txt` contains registered pose records; actual original image files and masks have separate availability and loading evidence. Current totals are above; the October 17–18 counts elsewhere in this file describe their dated audit snapshots.

`native-layouts.json.gz` retains scoped per-model compatibility inputs, including separately checked initialization and refinement variants, grouped by source and pinned revision. Each tuple stores the scene path, exact required model files, camera/pose/point totals when available, photo evidence, check date and positive camera/pose sample flags. Samples from text models establish records independently from their complete-file count audits. Original bounded camera/image/point reads and their model CORS response headers passed. This does not establish all-camera validity, full rendering, all photographs or a complete export. Revision and required-path changes fail the build until rechecked. The file began with the October 17 native scene preflight audit and includes subsequent reviews; original detailed runtime receipts remain local.

The three entries in `verified-scenes.json` retain stronger full camera-and-photo export evidence: example-colmap-glomap (2 photos), BMVS basketball (3 photos), and PanoWorld panorama_0000 (6 photos, no point cloud). Full export validation is an optional evidence tier. Its absence does not reject native model scenes. These exact source URLs loaded in deployed ColmapView 0.17.0 and exported all registered original photographs; independent PyCOLMAP, original-photo hashes, calibration and pose comparisons passed.

Qualification remains scoped to exact scene identities and source revisions. Source access restrictions, required model failures and the negative reviews in `scene-exclusions.json` still apply. The negative file records 71 unavailable Perry astrovision models and 16 unsupported DyOmni spherical-camera models. A publisher RGB exclusion changes photo availability rather than rejecting the camera/model. Standalone PLY, mesh or splat imports cannot qualify a camera scene. Archive scene inventories need their own route/content qualification; this change does not invent archive members or complete pending MegaDepth-X enumeration.

To add native layout evidence, inspect the exact pinned model files, supported camera/pose record samples and anonymous model byte/CORS responses. Record photos independently: a successfully read matching sample, publisher-declared absence, unknown availability, or ambiguous paths. To earn the complete-export tier, import the original scene URL in the deployed viewer, download COLMAP + original images, independently read it with PyCOLMAP, and compare every original photo hash plus calibration/poses. Record the exact required paths, launch URL, viewer build and export checksum in `verified-scenes.json`. Model compatibility never depends on completing that stronger check.
The ArmGS Waymo follow-up groups 36 native model directories into 11 named captures. Binary/text triangulated copies and empty `known_pose_model` seeds stay inside the scene; triangulated geometry is the primary model. The pinned source audit explicitly associates the centered validation coordinate variant with the same capture. Such aliases require established source and target roots in the same archive and are not inferred from a repeated basename. The original triangulated sample loaded with one camera, 149 posed image records and 25,299 points. Its README explicitly excludes original/resized RGB throughout the repository; PNG masks are separate assets. Scene cards retain this exclusion even without an exact import check, and the reported custom non-commercial license name is preserved. Model-only loading does not qualify COLMAP + original images or image/mask packages.

The underlying ungated research inventory contains 1,445,057 file/model records across 974 sources; those are asset inventory counts, not datasets. The complete research inputs retain 2,158,157 records, 2,113 source records and the 5,697-source audit. Public source metadata separates `sceneSummary` from `assetInventorySummary`. The main index and search API declare `unit: "named_scene"`.

Each scene carries a dataset label, source collection, scene path, reported source license and its own evidence level. Labels default to the HF repository name or public collection name. `dataset-labels.json` provides reviewed names for sources whose download filename is unclear. The Dataset filter and the label on each card lead to related scenes. Public scene/source records with the same label are grouped in that filter; their individual source identities, license metadata and checks remain separate. HF collections stay scoped to their repository.

A co-located COLMAP camera/image/point file set identifies a scene. Reconstructions under the same scene's `sparse/0`, `sparse/1`, etc. are retained as variants inside one card. Camera train/validation/test metadata is grouped by scene folder, including conventional split folders when the layout establishes a shared scene. Companion assets are attached to their nearest established scene within the same archive. Repository-root reconstructions claim only conventional companions. Different captures and archive containers remain separate; copies across repositories have not been globally deduplicated.

Explicit `sparse/init` and `sparse/refined_aligned` pairs are grouped only after each selection has independently qualified. The refined model supplies the card's counters and launch. Static `variants/` shards preserve the initialization records for historical lookups, outside browse totals and search postings. Every build compares card summaries, all facet postings, source ranges and aggregate counts, and checks every retained variant's loading eligibility.

`scripts/catalog/scene_datasets.py` performs this projection without changing canonical research inputs. Detail pages show up to 32 source asset links, preserving primary native model files first. The total asset count and any truncation remain explicit; remaining files are available through the source scene folder. Photographs and masks need separate enumeration and loading checks. Scene boundaries are metadata evidence, not complete render certifications.

The NGS research inventory identifies **259 named scene datasets**. Its inventory has 260 COLMAP file sets plus one Gaussian-pair record: `objects/scan_20250410_110806` contains both `sparse/0` and `sparse/1` and the pair, which belong to one scene. All variants and Gaussian assets remain inside that scene. A pinned directory walk visited 783 model directories and deliberately omitted 518 photograph/mask/depth/video directories, bypassing the earlier 100,000-sibling cap. The source metadata records 260 COLMAP models and 518 companion PLY files. The walk establishes filenames and grouping; it does not qualify every model or image for loading.

Previously aggregated public archives are split too: NeuMan has six reconstruction entries, Tanks and Temples / Deep Blending has four, the VolSDF DTU archive has fifteen camera-metadata entries, and On-the-go has twelve camera-metadata entries. The individual entries record their extraction paths. Archive-directory evidence does not certify their complete decoding or rendering.

The compressed canonical listing for each source stores tuples of `[kind, path, files-or-null, containing-archive-or-null]`, with the source revision, coverage and SHA-256 in the registry. The original source audit is inherited as collection-level evidence. These historical research checks remain scoped to their exact sampled files and do not establish publication eligibility. Exact native layout/access evidence or stronger complete-scene evidence can qualify public scenes. Missing photographs do not disqualify native camera/model layouts. Collection pages expose the qualified scenes and do not inherit historical sample viewer links. Unqualified archive scenes and native folders without the required layout/access evidence remain in offline research inputs.

The follow-up initially qualified **713,100 gated entries** as access required; the publication policy now removes all of them and their **255 source collection records** from the public Hub. Their audit evidence stays in the repository. A listed filename is not a readable payload. The checked `akashskypatel/NeurCross-Labels` airplane PLY returns HTTP 401 `GatedRepo`; the 112 gated sources with an exact recorded file candidate all return HTTP 401 anonymously. The viewer's private-repository sign-in does not establish gated-file support.

Twenty-nine exact positive archive-header items (seven native file sets and 22 PLY files) supplement 29 canonical research listings. Source revisions and original tuples remain intact. The scene projection publishes identified scene anchors; standalone archive members remain research/source evidence and do not create cards. The preparation step reapplies these positive paths from the source audit. `python -m scripts.catalog.sampled_individuals` can apply the supplement without a new provider walk.

Thirty-eight ungated research source listings remain incomplete (51 in the full research inventory), and uninspected/nested archives may contain additional scenes. The scene index separately counts incomplete sources that have identified scenes. No aggregate collection is silently counted as one scene when its scenes have not been identified. The public survey's already named scene/subset entries retain their identities. File-only detail URLs are removed from the scene namespace; retained primary scene IDs and collection URLs remain stable.

To regenerate the canonical individual listings from the saved metadata, then rebuild:

```powershell
python -m scripts.audit.prepare_individual_datasets --metadata PATH_TO_FULL_AUDIT/metadata --old-inventory PATH_TO_HF_SCAN/all-candidates.json --refresh-model-source OpsiClear/NGS
python -m scripts.audit.prepare_public_individuals
npm run catalog:import -- --viewer-root PATH_TO_VIEWER
npm run build:assets
```

The public-archive command reads ZIP central directories with bounded anonymous ranges and preserves resumable receipts under `.tmp/`. The HF command reads the saved public metadata; its optional pinned model-directory refresh reads provider metadata only. Neither opens photographs or generates previews. Future fresh source/revision audits must refresh the individual listing too; mismatched revisions stop the import/build.

The offline build uses Python 3.11+ to create metadata packs, ID shards, delta-compressed search posting lists, filter facets and source metadata. The Worker reads only fixed keys through the same-origin `CATALOG_ASSETS` binding, bounded to 5 MiB per asset. It never fetches dataset URLs, enumerates R2 records or writes a catalog entry at runtime. Search accepts up to six words and renders 24 entries per page. The catalog uses the existing static-asset storage and has no database.

The browse UI progressively appends the next 24 records with Load more. Metadata is rendered from the same escaped card template on the server and in the browser. `openUrl` points to a checked viewer URL or `/hub/datasets/open/data-…`; the latter resolves the exact individual record and redirects to its existing checked or eligible native-model link. Known failures, gated files and uninspected archives receive a metadata link. This routing changes neither compatibility evidence nor the source license. Public model redirects remain separate from private Hub record lookups.

## Scene statistics audit

Statistics belong to the selected exact model, not a collection sample, a companion PLY or a sibling binary/text export. Binary counts come from their native headers. Complete text-file audits use the viewer's committed parsers and count unique parsed camera, image and point IDs. Declared comment totals, the largest ID and the number of physical lines are not substitutes; image records have an observation line that can be empty.

```powershell
npm run catalog:counts -- --viewer-root PATH_TO_CLEAN_VIEWER --apply
npm run build:assets
```

Only already reviewed, public, revision-pinned native source files with missing text totals are requested. Without `--apply`, policy data stays unchanged. `--source hf:owner/repo` narrows the audit, `--scratch PATH` selects local receipts/cache, and `--max-file-mib 1024` sets the complete-file download cap. Network errors, absent CORS headers, truncated responses, invalid UTF-8 or unsupported schemas leave the affected totals unknown and make the command exit nonzero. Rerunning resumes completed policy counts and checksum-validated local downloads. Builds and the Worker make no provider requests.

The streaming reader retains record IDs but discards point objects and tracks between bounded native-parser batches. It reuses the original schema window, preserves image/observation framing, supports PhoMo text and deduplicates IDs exactly like the viewer. `--self-test` compares streaming identities with complete native parsing before any provider requests. The normal catalog checks cover chunk boundaries, CRLF, blank observation lines, duplicate IDs, mixed binary/text audits and confirmed empty point sets.

`recordChecks.countAudit` records the exact viewer commit, check date and each completely parsed text file's path, byte length, SHA-256 and total. Mixed models can audit just the text role while retaining binary header evidence for other roles. Per-file evidence is revision- and path-bound and must match the saved totals. It does not upgrade model compatibility, photograph coverage, pixel validation or complete-export evidence. Unknown totals are retained when a complete read cannot be established.

## Explicit scene manifest audit

`scene-manifests.json` records the October 18 complete checks for 17 explicit v1 scene manifests, using viewer 0.17.5. The original 16 checks use commit `9d068ec97ad9015c584b8b3953a84e382430fd5d`; the Expo follow-up uses `4b44561e4533ef0bfbfb186c93c43020ce9e87b7`, which contains that runtime. The manifest builder keeps camera/pose files and all media at their original pinned Hugging Face revision. It selects a separate XYZ PLY only when the native point file is empty and the companion's coordinate frame has been checked. The saved settings include a zero minimum track length and a reviewed overview. Native evidence stays unchanged; Hub statistics describe the selected launch representation.

| Source and named captures | Variants | Poses per variant | Points per variant | Photos / masks |
| --- | ---: | ---: | ---: | --- |
| `Wuuu3511/bmvs_sparse_dtu2`: basketball | 2 | 3 | 350,710 | 3 / 3 |
| bear | 2 | 3 | 340,440 | 3 / 3 |
| bread | 2 | 3 | 326,806 | 3 / 3 |
| camera | 2 | 3 | 359,250 | 3 / 3 |
| clock | 2 | 3 | 220,844 | 3 / 3 |
| cow | 2 | 3 | 303,922 | 3 / 3 |
| dog | 2 | 3 | 399,842 | 3 / 3 |
| `zhaoshiwen/blur-slam-bpn-data`: `scene0024_01`, `scene0024_01_abl3` | 2 | 227 | 4,449,654 | 227 / 0 |
| `alandpn/expo_mcm-ufrn`: original root model | 1 | 81 | 49,817 | 81 / 0 |

All 17 imported in a real Chromium viewer and submitted their complete point sets to WebGL: 577 posed photo instances and 13,552,753 points in total. Every registered photo binding was checked; original RGB and mask pixels decoded at the calibration dimensions. Foreground overview captures and native camera projection checks establish the recorded scene association. The two blur-slam variants have identical camera, pose and PLY byte hashes; the second manifest explicitly binds the first representation's original photos. This also resolves its former association-review status. Mask roles remain unknown, so these receipts qualify COLMAP + images exports and mask display, not feature-mask exports.

`scripts/audit/verify_scene_manifest_exports.py` independently reads the downloaded viewer ZIPs with PyCOLMAP 4.0.3. It checks the complete model, all point coordinates and RGB bytes, generated untracked point IDs or preserved native IDs/tracks, original camera calibration, pose matrices, observation references, every original photograph hash, dimensions and orientation. It reads only an existing URL-hash cache and never fetches or publishes. The audit caught and fixed a PLY parser defect that turned integer color channels of `1` into `255`; the corrected exports preserve every source color channel.

Expo's root manifest prevents normal folder discovery from selecting the unrelated nested `sparse/0` variant (148 poses and 55,023 points). Its 81-camera, 49,817-point native model retains all 548,374 observations, 344,424 track references and original photo hashes. Native point coordinates/errors may round to float32 in the existing viewer export; the independent check requires each component to equal its source float64 or its exact float32 rounding. This scene's maximum measured coordinate change is 0.0000016558184157133837 source units; observation coordinates are unchanged. These checks do not claim lossless native float64 export.

To update coverage, prepare an explicit scene selection with exact native file receipts, the selected points receipt, registered photo/mask mappings and a saved viewer state. Perform anonymous browser imports and exports, then run the independent check in an environment containing NumPy, Pillow and PyCOLMAP:

```sh
python -m scripts.audit.verify_scene_manifest_exports --scenes data/scene-manifests.json --browser-reports PATH_TO_BROWSER_RECEIPTS --exports PATH_TO_VIEWER_ZIPS --cache PATH_TO_PINNED_SOURCE_CACHE --output .tmp/manifest-export-check.json
```

The cache names each complete immutable source response `SHA256(source_url).bin`. Each ZIP is named with its `data-…` scene identity. Browser receipt logs start with `### Result` followed by JSON containing `id`, `status: "passed"`, `pointDrawCount`, `photoCount`, `maskCount`, and an empty `errors` array. Retain screenshots and detailed transport/renderer receipts locally. Camera/cloud alignment still needs review; the independent file checker cannot infer semantic alignment or mask roles.

Copy only passing, selection-bound receipts into `scene-manifests.json`; `selection_digest()` in `scripts/catalog/scene_manifests.py` computes the binding. `npm run build:catalog` generates the manifests, settings, launch targets and statistics together. `npm run test:python`, `npm run check` and `npm run test:browser` check the policy gates and public routes. The manifest/settings CORS rules must not overlap: duplicate wildcard CORS values are rejected by browsers. Changing a selection requires a fresh check; a nonempty tracked native cloud cannot be silently replaced by unrelated PLY vertex IDs. The initial manifest release changed 16 scenes and left 5,221 records identical. The later whole-catalog corrections change only Expo and 11 DTU mask inventories relative to Hub 0.7.21, retaining the original 16 manifests byte-for-byte and leaving 5,225 other scene records identical.

## Whole-catalog audit

The October 18 audit covers all 5,237 published scenes and 105 public collections, using exact pinned source revisions. It verifies native file identity, published counts, current viewer path selection, repository access, photograph policies, listed media samples, thumbnails and companion image ZIP range access. All 5,236 native camera calibration files were completely parsed with the released viewer parsers; larger pose/point bodies were checked through bounded reads, count headers and minimum record-size bounds. Prior complete text-count receipts remain authoritative where a prefix cannot establish a total.

The initial pass made 19,576 distinct production-origin browser asset reads, all readable after 72 throttled requests recovered on retry. Separate real-browser probes passed all 105 repository access APIs and 104 representative native-folder listing APIs. All 219 Hub API pages and 105 source-metadata documents passed after the catalog pack correction. Raw source responses, browser receipts, per-scene CSV/JSON reports and screenshots stay in ignored `.tmp/all-hub-scenes-20261018/`; builds perform no network audit.

Three issues were corrected:

- Large catalog metadata packs caused intermittent Worker resource-limit responses during pagination. Packs now contain 24 scenes, with the largest approximately 90 KB, instead of up to 2,048 scenes and several megabytes. Hub 0.7.21 deployed this fix without changing any scene record.
- The Expo root URL selected the nested reconstruction. Its new explicit manifest passes complete rendering, original-photo decoding and an independent COLMAP + images export comparison described above.
- Eleven `Y1ue/DTU` mask inventories counted AppleDouble metadata sidecars and advertised `._*.png` samples. Complete pinned mask-folder listings establish 614 real images, replacing the old 1,099-file counts; 485 sidecars are excluded. All 11 replacement PNG samples were read completely and checked at 1600 × 1200. The importer and publication policy now reject filesystem metadata samples before reusing cached preparation results. Mask alignment remains unverified.

Twenty scenes have complete camera-and-photo export evidence; all-entry path, calibration, header and browser-access checks are a different scope. The audit did not download every large reconstruction, parse every observation/track or decode every photo in all scenes. The 147 scenes requiring media-path configuration, 478 requiring separate image ZIPs and 40 requiring association review retain those labels. Missing photographs remain valid model-only cases.

## Full inventory audit

The repository's `dataset-audit.json` preserves the assessment of all 5,602 original HF candidates and 95 public scene/source entries, including rejected matches. Its dated source evidence includes 839 distinct recorded browser-check URLs and 150 original sample import receipts. The current public audit download retains only sources with published, eligible scenes and recomputes its own summary; the complete research input stays in the repository. The full browser follow-up examined additional candidate URLs that were not retained as required-source checks.

The October 16 refresh identified native-format headers in 589 HF sources and 42 public entries; some belong to members of archives that cannot be opened directly. Twelve HF sources were newly qualified relative to the old ready-format list; six of those had been excluded from the Hub. Twenty-seven former ready-format claims require additional qualification. The research source collection catalog contains 2,113 records after recovery; access filtering previously published 1,858 records, before the stricter scene publication policy above. That qualification follow-up removed 101 unsuitable PLY/splat-only archive viewer links, leaving 489 checked collection sample links in the research snapshot. All 102 selected archives with positive contained headers but no complete native model have extraction requirements, including one that already lacked a viewer link. Those extraction-only cases are now excluded from the public Hub.

Retained same-day receipts cover **150 distinct original asset/source-route tests: 142 passed and eight failed**. The recent bounded run contributes 141 original asset tests (136 passes and five PLY-only ZIP failures); overlaps with the earlier 14 tests are deduplicated. Thirty-four original native models also imported through controlled model-only manifests; their normal tree/source route, photos, masks and exports were not tested by those checks. All five original extracted PLY members from the rejected ZIPs imported through controlled same-origin responses, which does not qualify a live member URL or the original ZIP. These evidence types remain separate in the committed receipt and cards.

The browser follow-up rechecks **1,376 exact URLs: 1,368 readable, five failed requests, three unverified archive ranges**. Its 112 gated-source access probes are additional anonymous server checks, not browser passes. Source metadata and header checks keep their original timestamps; `evidenceRefresh` records follow-up dates and scope. No previews, protected payloads, provider credentials or private share-link records were accessed.

The audit separates file listings, original format headers, source access, browser transport and actual viewer imports. That historical audit targeted ColmapView 0.16.14. Current publication uses the exact-scene eligibility gates above and exposes qualified viewer links. A loose public COLMAP model can use a generated manifest with relative paths; a virtual directory prefix is not treated as a downloadable object. Multi-scene public archives retain scene-specific extraction instructions. Format evidence does not certify full-scene loading, camera/photo correspondence or requested COLMAP + images + masks exports.

The audit receipt includes every excluded source's identity, so another refresh can start from the committed file rather than relying on `.tmp/`. A fresh output directory makes new requests; the same output directory resumes its existing dated receipts:

```powershell
python -m scripts.audit.dataset_audit --inventory data/dataset-audit.json --out .tmp/audit-refresh --phase metadata --use-existing-hf-auth
python -m scripts.audit.dataset_audit --inventory data/dataset-audit.json --out .tmp/audit-refresh --phase probe
python -m scripts.audit.dataset_audit --catalog data/catalog.json --out .tmp/audit-refresh --phase public
node scripts/audit/build-audit-browser-plan.mjs --dir .tmp/audit-refresh
```

The optional existing HF token is used only on exact public metadata API endpoints, with redirects disabled. Asset probes remain anonymous. Private content and dataset scripts are never read or executed. Metadata responses, archive directories and decompression prefixes are bounded; rate-limit windows and request deadlines are respected. A negative archive conclusion requires a complete repository listing and all listed archives to have been inspected without unresolved nesting. Native-header evidence is representative, not every model's full parse or a render certification.

For browser receipts, open an `@playwright/cli` session named `dataset-audit` at the production viewer origin from `.tmp/`, then run `node scripts/audit/run-audit-browser.mjs --dir .tmp/audit-refresh --cli PATH_TO_INSTALLED_PLAYWRIGHT_CLI_JS`. It uses bounded browser prefix reads and exact archive tails. Optional UI sample receipts use `scripts/audit/run-audit-samples.mjs` with a local `sample-plan.json`. Finish with `node scripts/audit/finalize-dataset-audit.mjs --dir .tmp/audit-refresh --viewer-version VERSION`, then rerun the catalog import above. The importer reapplies the committed audit and manual reviews, preserving entry URLs and preventing older CSV claims from restoring unchecked viewer links.

Raw HTTP caches, browser logs, screenshots and runtime files stay under `.tmp/`. The committed receipt contains public source identities, pinned revisions, checked URLs and qualified findings. Repository license metadata does not independently establish permissions for underlying assets; public catalog license evidence retains its original provenance.

To merge the qualified follow-up receipts without confusing their scopes:

```powershell
node scripts/audit/refresh-dataset-evidence.mjs --receipts PATH_TO_BROWSER_AND_ACCESS_RECEIPTS --samples PATH_TO_BOUNDED_VIEWER_SAMPLES
python -m scripts.catalog.sampled_individuals
npm run catalog:import -- --viewer-root PATH_TO_VIEWER
npm run check
npm run test:browser
```

The merge requires complete browser/access receipt sets, exact source/revision and file matches, and decoder validation for passed Gaussian/SPZ/SOG samples. Controlled native manifests remain `modelFileImport` evidence; controlled extracted members remain `extractedMemberImport` evidence. Neither can promote a live ordinary source URL to a passing import. Public archive download links remain available for extraction when anonymous byte access is established; they are separate from viewer actions.

### Missing component audit — October 19, 2026

`scene-component-audit.json.gz` records all 25,204 initially missing role checks for 5,579 scenes and 147 source collections, including pinned scope receipts, candidate paths, header checks and decoded browser photo samples. It is an operator-curated, dated snapshot. `python -m scripts.catalog.component_audit` exports it as `public/hub/datasets/individual/component-audit.csv` and copies the full compressed evidence. Normal builds run that offline export; they do not refresh source data. The CSV contains candidate counts and a few examples, while the JSON retains full candidate paths. See [the methodology, corrections and remaining findings](../docs/scene-component-audit-2026-10-19.md).

The initial corresponding content/photo policies recovered 357 missing role labels across 275 scenes, including 18 matching browser-decoded photographs and their previews. Archive member evidence records `archiveMember` and `archiveFormat`; it proves component presence without promoting an archive to a combined scene import. Three newly inaccessible public models are retained as failures in `scene-exclusions.json`. The follow-up brings the public catalog to 5,576 scenes, 144 collections and 2,266 previews. Its 20 complete photo-export qualifications, existing model selections and selected-scene statistics remain unchanged.

### Photo-routing manifest audit

The initial `photo-routing.json.gz` cohort contains 1,246 revision-bound photo-routing reviews and 188 unresolved calibration/image-dimension findings. The continuation below adds Dynamic Maps as the 1,247th inventory route. These are independent of the stronger `scene-manifests.json` export receipts. Publication validates each selection digest, exact model files, source revision, original launch, sample photo hash/dimensions, model response hashes and complete physical inventories. Existing hashed manifests and full-scene selections cannot be replaced by this tier. The build and Worker make no source requests.

An operator prepares an input JSON with `schemaVersion: 1` and `scenes`. Each scene has its exact source/kind/path/files/revision, original `sourceViewerUrl`, original scene `scope`, `registered` count (or null), checked `sample` (path/name/hash/width/height), complete inventory flag and physical media candidates. Keep `modelMediaCandidates` as well as `mediaCandidates`: the model's masks and neighboring model anchors must remain available when a sibling photo collection is selected. `photos` and `masks` preserve curated source roles. A reviewed `photoCollection` or `mediaDeclared` authorizes an explicit sibling association; it must not be inferred from a repeated basename alone.

`modelReceipts.cameras/images` reference local cached byte files and record their exact public pinned URL/path, byte length, source length, entire-file flag and SHA-256. Calibration must be complete. Bounded binary responses supply only complete pose headers; text prefixes omit unfinished lines. Optional `companions` contain complete, browser-readable source CSV/JSON text and its pinned transport receipts. Every source mapping target must occur in the scene's pinned physical inventory. Authoritative CSV/JSON associations for later names remain in the manifest even when those native pose records were outside the inspected prefix; their source hashes are recorded separately.

```powershell
node scripts/audit/audit-photo-routing.mjs --viewer-root PATH_TO_CLEAN_VIEWER --input .tmp/photo-routing/input.json --output .tmp/photo-routing/reviews.json --scratch .tmp/photo-routing
```

The audit refuses uncommitted viewer dependencies and makes no network requests. It uses the committed viewer's manifest schema, model-file selector and media binder, checking photo/mask paths and mask roles with no selection prompt **for the inspected records**. Source model/point parsing retains its prior evidence. It writes reviews and explicit failure reasons without changing the catalog. Review those outputs and encode the complete JSON as `photo-routing.json.gz` with deterministic gzip (`mtime=0`) before running the normal build/check/browser commands. Do not edit a reviewed selection and recompute its digest manually; rerun the audit. Changed original launch URLs, pins, files, sample bytes or statistics invalidate publication.

The public `photo-audit.csv` has one row per published scene. `launchRouting` distinguishes full-scene, inventory and prefix manifests from native discovery, importer routes, companion archives and absent associations. It also exposes the manifest URL, listed photo count, declared mapping count, inspected/matched name counts, complete-name flag and remaining routing issue. Routing evidence establishes paths and a calibrated sample; it does not establish every photo's bytes, full projection/alignment, every mask's semantics or COLMAP + images export.
## Reusable photo audit decisions

See [the retained decisions and remaining cases](../docs/photo-audit-decisions-2026-10-19.md)
and [`photo-loader-checks.json`](photo-loader-checks.json) for representative
runtime receipts. The offline planner rejects an incomplete catalog snapshot.
`photo-source-metadata.json.gz` retains ten publisher-document receipts and
relevant factual fields for the unresolved associations. Their unchanged source
references and counts do not need another fetch; camera/photo association and
representation checks remain separate work.

`photo-audit-decisions.json.gz` records the immutable source revision, exact model
selection, decision, receipt digests, checked date, evidence scope and next action
for each published entry. The decision digest binds those fields. Reuse applies
only to the recorded facts: a sampled image or bounded name check never becomes
a complete photograph, alignment or export check.

Run `npm run catalog:photo-plan -- --output .tmp/photo-work.json` before preparing
new source reads. It performs no network requests. Confirmed facts with the same
revision and selected files are retained; new selections and unresolved
associations are queued. A source revision or file-selection change invalidates
reuse. New loader rules should first use the cached source/model receipts for
offline regression checks, rather than downloading established samples again.
The public photo-audit CSV includes the decision, reuse state, scope and next
action for every entry.

`native-count-replay.json.gz` records an offline replay of 232 complete cached
pose-text files after fixing the streaming statistics counter for omitted
observation rows. Every previous count is preserved, and the Dynamic Maps
camera-only file counts 896 poses. Source hashes, revisions and the counter's
normalized source hash bind the replay. It used zero source network requests.

The October 19 continuation retains 5,544 confirmed decisions and queues 32
unresolved associations. Git revisions and already verified public content
snapshots retain their own identities. The retained facts include publisher omissions, complete scoped
non-listings, video-only delivery, rejected calibration samples and partial
photograph sets. Videos need frame extraction and association; resized or cropped
images need a verified representation policy. These outcomes do not disqualify
an otherwise usable camera/reconstruction model.

`companion-media-routing.json.gz` applies version 2 manifests to 478 MegaUnScene
ZIPs and 38 Fastmap TARs. Every route retains the exact native model, pinned
archive size, capture-prefix mapping, original photograph/calibration receipts
and a binding check against viewer 0.19.2. The viewer indexes members and reads
images lazily with validated byte ranges; cancellation, replacement and reset
close the owned readers. Twenty-one other Fastmap samples retain their recorded
calibration mismatch and model-only launch. Archive sample checks do not certify
all archive members or a full export.

The Dynamic Maps camera-only export omits empty observation lines. The corrected
reader preserves 896 poses instead of 448, and an explicit photo manifest binds
all 896 names in sibling `images/`. Its new 320x234 preview retains the complete
frame; existing preview bytes are preserved. ALC901's checked `images_8` import
rescales focal lengths and principal points by 1/8 while preserving poses and
distortion. All 319 resulting calibrations and poses passed PyCOLMAP 4.0.3, and a
source photograph decoded in the browser. The existing model-only export tier
remains separate from full original-photograph export.

The [zero-point audit](../docs/zero-point-audit-2026-10-20.md) closes the checked
static/sibling bindings, auxiliary follow-ups and all 47 temporal scene launches.
scene-manifests.json retains 98 selections: the earlier 51 receipts plus 20 XYZ
and 27 Gaussian archive frames. The [frame list](../docs/temporal-frame-selections-2026-10-20.md)
names every selected time and source. zero-point-temporal-inspection.json.gz
records complete member hashes, bounded prefix/ZIP receipts, source metadata,
browser rendering and independent complete COLMAP export checks. Whole archive
hashes are publisher LFS declarations, not full-download claims.

The ledger contains 63 point recoveries (16,202,532 points/vertices) and 27 loaded
Gaussian frames with zero native sparse points. Its remaining 267 cases are scoped
non-listings, inspected non-XYZ camera/flow arrays or meshes. The auxiliary and
sibling inspection receipts retain their original pins; unchanged confirmed facts
need no repeat source audit. Berlin keeps its original tracks and complete photos.

zero-point-temporal-live-verification.json.gz records all 47 production launches,
actual source range-body extraction, UI downloads and complete independent COLMAP
reads against viewer 0.19.10 / Hub 0.9.14. Its catalog comparison preserves all
5,583 identities, all older manifests and 5,536 unchanged launch records.
