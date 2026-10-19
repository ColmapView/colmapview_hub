# Scene component audit — October 19, 2026

All **5,579 previously published scenes** were checked for each missing available-data role: **25,204 role checks across 147 source collections**. Cameras were already present in every scene. Depth data is outside this audit.

Download the [per-scene findings CSV](https://colmapview.opsiclear.com/hub/datasets/individual/component-audit.csv) or [full pinned evidence snapshot](https://colmapview.opsiclear.com/hub/datasets/individual/component-audit.json.gz). The latter is also stored in [data/scene-component-audit.json.gz](../data/scene-component-audit.json.gz). The downloads appear under the Hub's additional coverage information. They are a dated audit, not a promise that every source file fully renders or exports.

## Corrections

The audit recovered **357 omitted labels across 275 scenes**:

| Data | Recovered scene labels |
| --- | ---: |
| Images | 18 |
| Point clouds | 34 |
| Splats | 174 |
| Masks | 88 |
| Meshes | 33 |
| Other 3D model assets | 10 |

The 18 recovered photo samples have decoded pixels, matching source SHA-256 hashes in an anonymous browser at the viewer origin, and registered-name bindings checked with the released **0.17.7** media resolver. Each has a prepared preview. Eight ETH3D representations have complete registered-name path coverage; the other two have 39/45 and 30/31 matches. Redwoods2 mirrors and TAAHM have matching later images in bounded pose prefixes; those counts remain lower bounds. Stream3D has 232/316 matched paths and a 1920×1080 photo sample against 3840×2160 calibration; its resize/calibration requirement is preserved. These checks do not certify every photograph or full scene export.

Archive evidence includes 47 DanceNet3D splat ZIPs, 47 mask TAR.ZST files and 20 supplied point-cloud TAR.ZST files. Their indexed members or bounded decoded prefixes establish presence. Labels say **archive** and the information panel records the container and sampled member. The launch links retain their existing native camera selection; these companion assets are not silently attached. The [pinned publisher instructions](https://huggingface.co/datasets/nyuvideolab/danceNet3D/blob/5ecd1b71d0c13b176dbdbe358b940624759d678f/README.md) describe an additional translation for splat alignment.

A publication bug also erased separately verified point clouds, masks, splats or archived photos when an explicit launch manifest omitted them. Inventory labels now survive that narrower selection. The manifest's selected counts, file hashes, media mappings and export qualifications remain separate.

Three historical `opsiclear-admin` sources returned **HTTP 401** for both the pinned repository listing and a required original camera file. Their cards are withdrawn through `scene-exclusions.json`; their old evidence is retained. The Hub now publishes **5,576 scenes from 144 collections**, with **2,205 photo previews**. Existing retained scene IDs, camera/model selections, launch URLs, statistics and previews are preserved. The 20 scenes with complete photo-export evidence retain that stronger scope.

## How absence was assessed

The online scan read 1,817 Hugging Face API pages containing 1,494,422 file entries at the exact catalog revisions. All 143 Hugging Face sources were attempted. Complete selected-scene scopes were used for previously capped repositories; three inaccessible sources remain failures rather than empty inventories. The four other public sources were checked through pinned GitHub trees or public MegaScenes component listings. SceauxCastle's external image repository was resolved to its current commit separately from the pinned reconstruction.

Scene ownership protects other named captures and calibration variants. Existing sibling-media scopes and reviewed parallel layouts are considered, including `cameras/<scene>` beside estimator outputs, Replica's `GTmesh/<scene>`, and DanceNet3D's separate model archives. A repository-level file or repeated basename alone cannot establish its association with a selected scene.

The audit made 6,610 loose 3D asset probes: 6,566 classified headers, 28 unclassified headers and 16 formats without a supported header check. Every D3DGS estimator/scene stream has first/last frame samples; its other frames are not represented as individually checked. All 155 additional mask/archive probes passed their stated pixel or header checks. PLYs are classified by properties and elements, not their extension or filename. Multiple companion PLYs are considered, and masks, depth, renders and filesystem sidecars are separated from source photographs.

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

In particular, Fastmap's separate image TARs, source-image TARs for dynamic sequences, and unmatched Plant3D/TV-scene photographs still need association or extraction work. A completed inventory audit does not resolve those loading policies. The remaining findings are preserved rather than silently relabeled as “no data.”

The compact CSV shows counts and a few candidate examples. The compressed JSON retains every candidate path, source revision, scope receipt and probe receipt used here. Non-listing concerns recognizable loose assets; embedded alpha masks, arbitrary arrays and other uninspected encodings are not exhaustively decoded. Header/CORS evidence establishes presence or transport; rendering, coordinate alignment, original-photo coverage and COLMAP export require their own checks.

Normal builds perform no network audit. `python -m scripts.catalog.component_audit` exports the curated snapshot; it does not refresh source listings or upgrade evidence. The pure finding rules and manifest/component validation have regression tests.
