# Dataset count and calibration review — October 22, 2026

The review covers all **4,559 published scene entries across 144 source collections** in Hub 0.10.11, generation `d11109b976d53df16024df9e6d2d2f890f1d3a70971a422d54d7f2a5ed19129c`, against viewer 0.20.5 (`2196486c078c26ff851a51a6e503dd0186311221`). It finds no count mismatch in the tested comparisons, but identifies six suspect source calibrations, three unresolved pixel-aspect outliers, and a viewer limitation affecting valid signed camera intrinsics in 68 AstroVision entries. Known photograph-resolution differences remain a separate qualification limit.

This is a review receipt. It changes no catalog selection, source value or deployed code. The [machine-readable evidence](../data/catalog-anomaly-audit-2026-10-22.json.gz) retains every scene's selected counts, exact source URLs, revisions, read sizes and hashes, candidate dispositions, complete targeted-model checks and projection samples.

## Findings that need action

### Viewer: signed intrinsics produce a zero-sized image plane

**68 AstroVision entries** contain original, nonzero signed focal components. These are not automatically invalid cameras. In 18 affected scenes, 2,647 matched original observations reproject using the unchanged source calibration with maximum error **5.48 × 10⁻⁷ pixels**. Replacing focal signs with their absolute values raises the sampled median errors to 205–941 pixels.

The released viewer's [`getFrustumPlaneSize`](https://github.com/ColmapView/Colmapview.github.io/blob/2196486c078c26ff851a51a6e503dd0186311221/src/components/viewer3d/cameraFrustumGeometry.ts#L165) rejects nonpositive focal components. [`getAutoAdjustedFov`](https://github.com/ColmapView/Colmapview.github.io/blob/2196486c078c26ff851a51a6e503dd0186311221/src/components/viewer3d/cameraFrustumViewModel.ts#L117) has the same restriction. Executing these exact helpers with an unchanged source camera produces plane width/height `0` and automatic FOV `null`. This reproduces a viewer geometry/framing gap, independently of whether the source photograph can download or appear in the gallery. It does not establish that all other rendering paths fail.

Example: [`clusters/test/orex_bennu/00000007`](https://huggingface.co/datasets/travisdriver/astrovision-data/tree/43af772130675058f894824d50cbe2b390315061/clusters/test/orex_bennu/00000007), camera 647: 1024 × 1024, `fx=14727.867989003502`, `fy=-14726.490932658`, `cx=cy=512`.

The fix belongs in viewer projection/plane/UV/framing handling, with original-observation and browser regression checks. Taking absolute values in the dataset or manifest would alter the scientific projection and is not a fix. The complete affected-ID list is in `candidateDecisions` in the receipt.

### Source calibration: four YouTube reconstructions

At [`fantasticoven/youtube-colmap`, revision `63d96b4a560df2495b6cf6b2971c344b2dc90fd4`](https://huggingface.co/datasets/fantasticoven/youtube-colmap/tree/63d96b4a560df2495b6cf6b2971c344b2dc90fd4), these original `SIMPLE_PINHOLE` values need a units/calibration/degeneracy review:

| Scene | Poses | Points | Focal range, pixels |
| --- | ---: | ---: | --- |
| `job_4/scene_18/sparse/0` | 4 | 95 | 0.300–0.302 |
| `job_5/scene_31/sparse/0` | 3 | 0 | −0.01436 to −0.01433 |
| `job_5/scene_32/sparse/0` | 11 | 3,930 | −119,148,968 to 662,291,169 |
| `job_7/scene_13/sparse/0` | 4 | 4,994 | 23,755 to 1,368,326 |

All four use 1280-pixel-wide photographs. The review downloaded and parsed **all 12 original native model files**, totaling 3,368,192 bytes. Every published count matches; poses/points are finite and all **23,423** nonempty track/observation references are reciprocal. The zero-point scene really has no reconstructed points. These are suspect calibration values, not fake counts or malformed-file findings. Low stored reprojection errors in the nonempty models do not establish a physically reliable reconstruction.

Retain the original values and request/check the publisher's calibration convention or reconstruction result. Do not guess a focal conversion, manufacture points, or reject an entire collection from these four cases.

### Source metadata: two PRISM mirrors disagree about resize scale

The selected `scene0736_00/run/provenance/scannet_colmap_snapshot` has dimensions **160 × 120**, but `cx=163.406509399`, `cy=120.400009155`, `fx=290.86126709`, `fy=291.198486328` in both mirrors:

- [`qizhangslam/prism3d-scannet-original7k-fixedk-20260926-public`](https://huggingface.co/datasets/qizhangslam/prism3d-scannet-original7k-fixedk-20260926-public/tree/da52b03420bda77e8474c71894a5cd0b9f1f760b/scene0736_00/run), pin `da52b03420bda77e8474c71894a5cd0b9f1f760b`.
- [`slam-e2e/prism3d-scannet-original7k-fixedk-20260926`](https://huggingface.co/datasets/slam-e2e/prism3d-scannet-original7k-fixedk-20260926/tree/d4de84269780fc4ab8839182b3df04f6a8b613ac/scene0736_00/run), pin `d4de84269780fc4ab8839182b3df04f6a8b613ac`.

An off-frame principal point alone is not proof of an error. Here, the accompanying `adapter_receipt.json` also declares 1296 × 968 sensor images, 640 × 480 method RGB, training scale 4 and explicit resize factors that do not reproduce the selected snapshot's intrinsics. The formal evaluation receipt records another training K. This is a concrete inconsistency between the published representations; the missing original-image/crop mapping prevents choosing a scientifically justified replacement. The source hashes and relevant metadata receipts are retained in the audit.

Obtain an exact publisher-supported image representation and calibration mapping before attaching photographs or qualifying full photo export. Camera/pose loading remains independently usable.

### Three pixel-aspect outliers remain unverified

These positive, finite source calibrations have `max(|fx/fy|, |fy/fx|) > 2`:

| Source / scene | fx | fy |
| --- | ---: | ---: |
| `pablovela5620/example-colmap-glomap` / `colmap/sparse/0` | 2649.8805 | 504.5091 |
| `waynechu1109/splat` / `station_3/data/colmap/sparse/0` | 1136.9168 | 546.8296 |
| `zeroframe/sample_3d_objects` / `bollard_black_square_no_parking/colmap/sparse/0` | 3078.3000 | 1440.9941 |

Anisotropic resizing, cropping, non-square pixels or unstable calibration could explain these values. The heuristic does not establish which explanation applies. Exact scene IDs, pins and camera-file hashes are retained; no correction or exclusion is applied.

## Existing photograph-resolution limits confirmed

For 2,736 native scene samples with retained decoded-photo dimensions, this pass can compare 2,706 to a matching pose or uniform calibration dimensions: **2,496 match and 210 differ**. Thirty multi-calibration samples require further exact pose-name lookup and are not silently counted as matching.

Of the 210 differences, **150 fit uniform resizing within one-pixel rounding**; this is a dimension-based candidate, not proof that the photo was only resized. **60 do not fit that rule** and need crop, undistortion or representation metadata. The latter include 21 Fastmap, 21 Soneva corals, 12 PlanarGS mirror entries, three Plant, two Confident Splatting and one 360-USID entry.

These differences were already disclosed in the retained photo notes/summaries. Their current availability states are 160 `sample_checked`, 29 `path_policy_required` and 21 `companion_archive`. A successful image read/decode or a hosted thumbnail does not certify calibration alignment or a complete COLMAP-with-images export. Uniformly resized textures can still display correctly when normalized projection is preserved; crops and undistortion require their own mapping. This review does not reclassify all 210 as broken datasets.

The separate [source mapping follow-up](catalog-source-mapping-2026-10-22.md) covers missing originals, Dunhuang's resolved text-model association and RotaryKiln's original-archive CORS limitation. Those cases and the resolution differences above are different evidence scopes.

## Suspicious-looking values that are explained

- All three Bennu `ocams_recon*` models retain **1,599 calibration definitions**, while their pose headers declare 1,401, 429 and 257 registered images. Complete calibration parsing confirms 1,599 records. Unused definitions are legal; camera models are not photographs or physical-device counts. [COLMAP's format definition](https://colmap.github.io/format.html) describes the per-image camera reference and distinguishes IDs from counts.
- Five AstroVision spacecraft scenes use focal lengths above 100 image widths. All five pass **617** original-observation projection samples, maximum error **2.13 × 10⁻⁸ pixels**. Narrow telescope fields of view must not be filtered using terrestrial-camera expectations.
- Skyfall-GS JAX_004 has long focal lengths and off-frame principal points in all nine source cameras. Its [publisher paper](https://arxiv.org/html/2510.15869v4) and [preprocessing project](https://github.com/jayin92/SatelliteSfM) describe RPC-to-perspective satellite approximation. The source values are retained; an off-frame-center heuristic does not establish corruption.
- Great E-NeRF's selected metadata contains 200 poses but only 100 have photographs in the recorded complete pinned listing. Its published 100-pose import is correct and retains an explicit 100-missing-RGB receipt.
- A point error of **−1** means uncomputed in [COLMAP's `Point3D::HasError`](https://github.com/colmap/colmap/blob/main/src/colmap/scene/point3d.h). The scan encounters this sentinel in 127 scene prefixes; it is not a measured negative error.
- The **432 selected zero-point scenes** retain their [separate source-scope dispositions](catalog-reaudit-2026-10-22.md). Gaussian frames, meshes and depth maps are not silently counted as static sparse points.

## Coverage and limits

| Check | Coverage / result |
| --- | --- |
| Published scene counts, source totals and content-count agreement | 4,559 entries / 144 sources; no invalid counts or mismatches found |
| Duplicate scene identity / same-source native metadata selection | None found; cross-repository mirrors remain separate catalog entries |
| Complete native calibration files | 4,514 selections, 176,143 calibration records; all parse and agree with reported native camera counts |
| Other selected camera documents | 45 complete JSON/NPY/NPZ documents through the actual viewer normalizers; all parse; documented selection/partial-RGB differences retained |
| Native pose and point record sanity | 43,732 pose records and 503,711 point records from available complete files/prefixes; no nonfinite values, malformed record bounds or checked missing-camera references found |
| Binary pose/point count headers | 7,820 exact source-header comparisons; no mismatches |
| Retained immutable manifests | 2,610 schemas checked; zero invalid or missing |

The pass reuses checksummed pinned anonymous receipts and adds 523 bounded native reads, 45 complete selected camera-document reads/reuses and the four targeted complete YouTube models. All source values remain unchanged. The 84 scene identities that triggered count/calibration heuristics each have a disposition; the 210 photo-resolution cases are recorded separately and can overlap them.

Calibration plausibility, source metadata, complete model parsing, browser rendering, original-photo alignment and full export are separate checks. This pass does not render every scene, download every point cloud or inspect every photograph. A count matching a binary header is evidence about that declared source table, not a complete scientific validation of its contents. Research inventory totals and globally unique scene counts are not substituted for the 4,559 published entries.
