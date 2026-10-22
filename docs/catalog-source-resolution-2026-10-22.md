# Catalog source resolution — October 22, 2026

Follow-up: the [source mapping review](catalog-source-mapping-2026-10-22.md) resolves Dunhuang through its archive text metadata and finds RotaryKiln's matching original ZIP. This document and its receipt retain the earlier 0.10.10 audit snapshot; its Dunhuang limitation is superseded by that review.

This follow-up addresses the 32 unconfirmed photograph associations and four incomplete published collection inventories in the [preceding repeat audit](catalog-reaudit-2026-10-22.md). Eighteen scenes gain exact photo routing and attributed previews. Thirteen others have confirmed, scoped source omissions. Dunhuang remains open because the available source archive has different calibration and poses.

The catalog retains **4,559 scenes across 144 sources**. All existing scene IDs, selected native files and camera/pose/point counts are preserved. Only the 18 recovered photo launches change. All 2,591 previous immutable manifest bodies remain byte-identical; 18 new manifests bring the retained total to 2,609. There are now 2,781 scene previews using 2,482 distinct JPEGs. Three new JPEG bodies contain checked source photographs with source terms/credits and no original EXIF.

## Recovered photographs

Sixteen `zhaoshiwen/blur-slam-bpn-data` ablation/ground-truth models now attach their exact `data/evssm_deblurred_i2slam/<scene>/` directory. Pinned source manifests, `project.ini`, and the publisher's preparation scripts identify this representation; complete native camera/pose comparisons agree. All **5,917 registered names** occur in the declared directories. Four distinct originals decoded in anonymous Chromium at the exact 1296 × 968 camera dimensions. These are EVSSM-deblurred training inputs; raw ScanNet inputs are a separate representation.

The publisher's [ground-truth preparation script](https://huggingface.co/zhaoshiwen/blur-slam-bpn-code/blob/d8cdb94b955b3647353df0c6f5fcca7d68afb129/scripts/build_i2slam_gtpose_scenes.py) and [color variant](https://huggingface.co/zhaoshiwen/blur-slam-bpn-code/blob/d8cdb94b955b3647353df0c6f5fcca7d68afb129/scripts/build_i2slam_gtpose_scenes_evssmcolor.py) are pinned independently. Their Git blob IDs and complete body hashes are retained in the receipt. These public source files were inspected as text, not executed.

`LeeXiangNO1/DyNativeGaussian_sequence` VRU_dg4 and VRU_gz now attach **frame000000** from their own source TARs. Both archived camera and pose files match the selected native files byte for byte, and all 34 registered names per scene occur in that frame. These checks establish capture identity rather than relying on repeated `cam00.png` filenames.

| Source TAR | Original bytes | Complete first-frame prefix |
| --- | ---: | ---: |
| `source_img/VRU_dg4.tar` | 25,348,495,360 | 100,589,056 |
| `source_img/VRU_gz.tar` | 46,526,023,680 | 165,040,640 |

Viewer 0.20.5 adds optional `mediaArchives[].indexBytes` for a checked plain-TAR prefix. The value must be positive, 512-byte aligned and within the declared original archive size. Indexing stops at that boundary; photographs are read lazily through validated ranges against the **original** total size and stable file identity. Later frames remain outside this launch. Hub routing additionally requires exact source/model receipts and a supported viewer version. ZIPs and existing unbounded archive manifests retain their behavior.

All 18 new manifest selections passed complete native imports, exact count comparisons and canvas checks in Chromium against viewer commit `2196486c078c26ff851a51a6e503dd0186311221`. The loaded viewer also retrieved and decoded all **68 VRU originals** plus one registered photograph per Blur scene: **84 photo reads** with exact camera dimensions and checked sample hashes. This does not establish complete Blur photo pixels or full exports.

Pre-publication checks serve the exact locally built immutable manifest bodies while all source model and photograph requests go anonymously to pinned provider URLs. Public asset delivery is checked separately after deployment; staged delivery is explicitly identified in the receipt.

## Source limitations

| Scenes | Source | Confirmed scope and next requirement |
| ---: | --- | --- |
| 9 | DyNativeGaussian MeetRoom/N3DV | Complete selected scopes have native models and no loose original photographs. Other imagery is rendered output or camera-motion demonstrations; all 12 source TAR names and first capture headers name other captures. A publisher-supported original capture/frame mapping is needed. This is not a full-content audit of every unrelated TAR. |
| 1 | Plant3D `plant_001/sparse/0` | The two registered 640 × 480 originals are absent from the complete color directory. Same-name dense images are 566 × 424 and 523 × 392 and are absent from the dense pose model. Original RGB or a verified undistortion/calibration mapping is needed. |
| 1 | RGBT RotaryKiln | Its complete pinned scope contains nine model/depth-metadata files, with no photographs, video or source archive. |
| 2 | PRISM3D ScanNet snapshots | All 436 PNGs per mirror are result renders. Pinned uploader allowlists omit original input RGB while retaining provenance and model snapshots. Matching original ScanNet inputs require separate access and terms. |
| 1 | DyNativeGaussian Dunhuang | The candidate Pair TAR has different camera/pose bytes. Comparisons by all 60 exact registered names give up to 6.605954 world units of camera-center difference and 91.233024° of quaternion-sign-invariant rotation difference, with no coordinate alignment applied. The separate Single_f14 export also differs in camera centers and focal lengths. Obtain the exact publisher capture/frame association before attaching either archive. |

The first 13 cases become reusable facts only at their exact source revision and selected files. Dunhuang retains `review_required`, a negative comparison receipt and a concrete next action. No rendered output substitutes for an original photograph, calibration is not guessed, and no points are synthesized. Photo availability does not remove a valid camera/model scene.

## Completed discovery

Anonymous Git inventories cover every path at each existing pinned commit. Root Git tree IDs and complete tree-output SHA-256 values are retained in the [machine-readable receipt](../data/catalog-source-resolution-audit-2026-10-22.json.gz).

| Collection | Complete file paths | Raw research items |
| --- | ---: | ---: |
| ALC901/DL3DV-10K-3dgs | 175,751 | 2,027 |
| yinyue27/RefRef_additional | 149,168 | 658, including two retained earlier archive records |
| JiaJinrang/PanoWorld | 998,926 | 39,822 |
| turandai/gaussian-surfels-dtu | 2,581 | 15 |

All 39,822 PanoWorld transforms documents pass the actual viewer NeRF normalizer, with 238,932 cameras/poses and referenced photo paths present in the pinned tree. Metadata Git blob hashes are checked. This is format/numeric/path validation, not 39,822 complete browser imports, decoded photo sets or qualified exports. Other selected source documents pass Git blob or LFS size/hash checks. The research inventory gains 37,337 raw items, reaching 2,197,885; these are not additional published scene cards.

ALC901's expanded inventory exposes a nested camera anchor that would otherwise regroup previously selected assets. An explicit `sceneSelections` entry retains its exact existing export-qualified model/files. The offline builder rejects missing or changed export receipts, lost source files, changed native roles, missing metadata anchors, duplicate selections and truncated asset inventories. New candidates retain separate qualification requirements.

## Validation and limits

The full Hub check passes 89 catalog, 163 Python and 236 Worker tests plus type/lint/style checks and the production build. Viewer checks pass 6,609 unit tests, the production build and all 102 supported-path browser cases; one initial pre-mount timeout passed its focused rerun. Viewer CI additionally passes 335 browser tests with 22 conditional skips.

The production 0.10.9 sweep checked all 2,609 manifest response bodies against their retained hashes, all 190 metadata packs, all 4,559 API entries across 190 pages, all 32 changed direct/metadata routes, four completed-source metadata records and three new preview bodies. All 18 newly published manifest URLs also passed complete native imports and exact count comparisons. Production gallery samples decoded in both viewer hosts; the GitHub Pages root preserves the manifest URL when redirecting to `/latest/`. Initial release verification timed out while GitHub Pages was still publishing; the unchanged release passed its retry after publication.

## Metadata reader bounds

A subsequent production browser request returned Cloudflare's 1102 resource-limit page. It did not recur in 24 follow-up public GETs; eight captured traces reported successful outcomes. The original failure was not captured in a trace, so its exact CPU/memory cause remains unclassified.

Hub 0.10.10 reduces catalog request memory pressure independently of that diagnosis. Pack reads run in batches of at most four, and only requested scene rows remain retained after each pack is decoded. JSON decoding keeps the existing five-MiB byte limit, preserves split UTF-8 characters and releases the owned reader. A failed batch settles its owned reads before returning and does not schedule later packs.

Four fixed-seed queries against the complete real catalog produce identical page JSON before and after the change. The broad queries previously started 8, 15 or 21 pack reads together; the revised reader caps these at four. Targeted tests cover ordering, repeated ordinals, oversized streams, UTF-8 boundaries, cleanup and failed batches. These checks establish the reader bounds; they do not prove a cause for the earlier one-off platform error or constitute a full traffic load test.

The deployed 0.10.10 reader returns all four golden API pages unchanged. A final eight-request sequential probe and 16-request concurrent probe return 200 responses without resource-limit pages. An earlier concurrent probe encountered a client transport reset; all captured Worker executions succeeded, and the final concurrent probe passed on every first attempt. CI passes the complete Hub check and browser suite. Three new preview JPEGs decode at 320 × 320 in the live Hub; 42 visible gallery thumbnails decode across the two production viewer hosts. Deployment identities and scoped results are retained in the machine-readable receipt.

The three known AstroVision decoder failures remain withheld. Earlier alternative-calibration cases, full exports, temporal playback and real Safari checks retain their existing limits. This follow-up does not claim complete pixel/export coverage of every catalog scene.
