# Scene component audit — October 19, 2026

All **5,579 previously published scenes** were checked for each missing available-data role: **25,204 role checks across 147 source collections**. Cameras were already present in every scene. Depth data is outside this audit.

Download the [per-scene findings CSV](https://colmapview.opsiclear.com/hub/datasets/individual/component-audit.csv) or [full pinned evidence snapshot](https://colmapview.opsiclear.com/hub/datasets/individual/component-audit.json.gz). The latter is also stored in [data/scene-component-audit.json.gz](../data/scene-component-audit.json.gz). The downloads appear under the Hub's additional coverage information. They are a dated audit, not a promise that every source file fully renders or exports.

## Corrections

Two passes recovered **419 omitted labels across 335 scenes**: 357 in the initial pass and 62 in the follow-up. One empty geometry label was removed, and one generic geometry label was replaced with a specific splat label requiring conversion.

| Data | Recovered scene labels |
| --- | ---: |
| Images | 79 |
| Point clouds | 34 |
| Splats | 175 |
| Masks | 88 |
| Meshes | 33 |
| Other 3D model assets | 10 |

The initial 18 recovered photo samples have decoded pixels, matching source SHA-256 hashes in an anonymous browser at the viewer origin, and registered-name bindings checked with the released **0.17.7** media resolver. Each has a prepared preview. Eight ETH3D representations have complete registered-name path coverage; the other two have 39/45 and 30/31 matches. Redwoods2 mirrors and TAAHM have matching later images in bounded pose prefixes; those counts remain lower bounds. Stream3D has 232/316 matched paths and a 1920×1080 photo sample against 3840×2160 calibration; its resize/calibration requirement is preserved. These checks do not certify every photograph or full scene export.

Archive evidence includes 47 DanceNet3D splat ZIPs, 47 mask TAR.ZST files and 20 supplied point-cloud TAR.ZST files. Their indexed members or bounded decoded prefixes establish presence. Labels say **archive** and the information panel records the container and sampled member. The launch links retain their existing native camera selection; these companion assets are not silently attached. The [pinned publisher instructions](https://huggingface.co/datasets/nyuvideolab/danceNet3D/blob/5ecd1b71d0c13b176dbdbe358b940624759d678f/README.md) describe an additional translation for splat alignment.

A publication bug also erased separately verified point clouds, masks, splats or archived photos when an explicit launch manifest omitted them. Inventory labels now survive that narrower selection. The manifest's selected counts, file hashes, media mappings and export qualifications remain separate.

Three historical `opsiclear-admin` sources returned **HTTP 401** for both the pinned repository listing and a required original camera file. Their cards are withdrawn through `scene-exclusions.json`; their old evidence is retained. The Hub now publishes **5,576 scenes from 144 collections**, with **2,266 photo previews**. Existing retained scene IDs, camera/model selections, launch URLs, statistics and previews are preserved. The 20 scenes with complete photo-export evidence retain that stronger scope.

## How absence was assessed

The online scan read 1,817 Hugging Face API pages containing 1,494,422 file entries at the exact catalog revisions. All 143 Hugging Face sources were attempted. Complete selected-scene scopes were used for previously capped repositories; three inaccessible sources remain failures rather than empty inventories. The four other public sources were checked through pinned GitHub trees or public MegaScenes component listings. SceauxCastle's external image repository was resolved to its current commit separately from the pinned reconstruction.

Scene ownership protects other named captures and calibration variants. Existing sibling-media scopes and reviewed parallel layouts are considered, including `cameras/<scene>` beside estimator outputs, Replica's `GTmesh/<scene>`, and DanceNet3D's separate model archives. A repository-level file or repeated basename alone cannot establish its association with a selected scene.

The audit made 6,610 loose 3D asset probes: 6,593 classified headers, one verified empty PLY and 16 formats without a supported header check. Every D3DGS estimator/scene stream has first/last frame samples; its other frames are not represented as individually checked. All 155 additional mask/archive probes passed their stated pixel or header checks. PLYs are classified by properties and elements, not their extension or filename. Multiple companion PLYs are considered, and masks, depth, renders and filesystem sidecars are separated from source photographs.

## Remaining findings

The CSV records the result for every initially missing role:

| Finding | Meaning |
| --- | --- |
| `recovered` | Verified positive evidence now supplies the missing inventory label. |
| `not_listed_in_checked_scope` | No qualifying loose asset was listed in the recorded complete pinned scope. This is not a global absence claim. |
| `container_review` | Archives, array containers or videos remain relevant; uninspected members/extracted frames are not treated as absent. |
| `photo_association_review` | Raster files exist, but their selected-camera association has not been established. |
| `scene_association_review` | Relevant assets outside the established owner need an explicit association. |
| `asset_header_review` | A candidate format/header is unclassified or uninspected. |
| `source_inaccessible` | Public source access failed. |
| `specific_geometry_already_present` | The generic “3D models” category is unnecessary because points, splats or meshes already identify the data. |

Fastmap's sampled photo TARs and later TV-scene photos are now verified as described below. Other source-image packages for dynamic sequences and Plant3D's alternate calibrations still need association or extraction work. A completed inventory audit does not certify projection or combined scene export. The remaining findings are preserved rather than silently relabeled as “no data.”

The compact CSV shows counts and a few candidate examples. The compressed JSON retains every candidate path, source revision, scope receipt and probe receipt used here. Non-listing concerns recognizable loose assets; embedded alpha masks, arbitrary arrays and other uninspected encodings are not exhaustively decoded. Header/CORS evidence establishes presence or transport; rendering, coordinate alignment, original-photo coverage and COLMAP export require their own checks.

Normal builds perform no network audit. `python -m scripts.catalog.component_audit` exports the curated snapshot; it does not refresh source listings or upgrade evidence. The pure finding rules and manifest/component validation have regression tests.


## Archive and calibration follow-up

The second pass recovered **61 additional photo labels and previews**: all **59 published Fastmap scenes** have a decoded photograph in a separate, matching TAR; **ELR-apartment** and **Friends-joey_apartment** have matching later loose photographs. No new standalone-file cards were created.

For each Fastmap scene, the pinned TAR member header and the first 64 KiB of the photo (or its complete bytes when smaller) passed anonymous browser range reads and matching SHA-256 checks from the viewer origin. The complete sampled photograph decoded during preparation and its full hash is bound to the preview. Archive member counts are lower bounds, not complete image inventories. The model link still opens its native reconstruction and does not attach the TAR. The [pinned publisher instructions](https://huggingface.co/datasets/whc/fastmap_sfm/blob/d8253c18abfd0fd73d95ec089d3f7ecdb0df2bf7/README.md) associate the image packages with these named captures.

Fastmap image paths need an explicit extraction rule: remove the named capture prefix; for ETH3D also restore the registered `dslr_images_undistorted/` directory. All **21 Tanks and Temples samples have photo dimensions that differ from the selected calibration**. The information page records that extraction and renaming alone do not establish correct projection; original calibration and required undistortion still need verification. Matching dimensions in the other 38 samples also do not certify full alignment or export. Photograph-specific terms are recorded as not specified rather than inferred from the wrapper repository's MIT metadata.

The two TV samples passed full-photo browser reads, SHA-256 and pixel checks, and the released **0.17.7** native media resolver bound each automatically. ELR's matching image occurs in a prefix of **74/5,493** pose headers; Friends' in **21/1,485**. Both retain partial-photo status. These and four earlier bounded samples now display inspected-prefix counts separately from total registered poses.

The PLY header check now accepts trailing spaces and normal whitespace, checks scalar/list types, and keeps face properties separate from vertices. It reclassified **26 valid colored point clouds** whose vertex-count lines had trailing spaces; their native cloud labels and selected statistics were already present. The packed **lawn-tree** PLY is Gaussian splat data, identified using the [published PlayCanvas schema](https://github.com/playcanvas/splat-transform/blob/b6424a5b3b929695fbaafe738a995adb1240d675/src/lib/readers/decompress-ply.ts). Its label requires conversion to standard Gaussian PLY for the current viewer. It is not attached to the camera launch. Plant3D's empty `plant_000/dense/meshed-poisson.ply` has zero vertices and faces, so it no longer contributes a geometry badge.

Minimum binary payload sizes were checked for **6,544 PLY files** against their pinned file sizes and HTTP range totals, with no obvious truncation found. This verifies a lower bound, not every payload value. A separate scan found no Gaussian-like property sets hidden among the files previously classified as ordinary point clouds.

Plant3D's `plant_001/sparse/0` remains unresolved for photographs: its two registered SIMPLE_RADIAL cameras are 640×480, while the similarly named dense photos are 566×424 and 523×392. Neither name occurs among the 13 supplied dense pose records, and the original color folder lacks these two registered names. Basenames alone cannot justify combining those files with the selected calibration.

Regression verification preserves all **5,576 scene IDs**, all **144 published collections**, selected model files, launch URLs, native camera/point statistics, all **2,205 existing previews**, and the **20 complete photo exports**. The new total is **2,266 scene previews**. New tests cover TAR checksums, GNU/PAX names, symlink rejection, range bounds, photo hashes, prefix counts, compressed splat conversion labels, and both existing ZIP and new TAR browser flows. The compressed audit snapshot retains the full follow-up receipts and remaining findings.
