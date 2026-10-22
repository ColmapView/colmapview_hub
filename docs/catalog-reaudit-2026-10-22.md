# Catalog repeat audit — October 22, 2026

The production Hub 0.10.8 catalog has **4,559 named scene entries across 144 source collections**. Its generation is `10c271423b8cd6a22102a87dad32d166a2f77494077be213febd82bcfa24f19e`. Copies across repositories are separate entries; this is not a count of every COLMAP dataset on the internet.

## Checked coverage

- Reconciled every published scene's identity, launch availability, camera/pose/point counts, available-data labels and photo status against the index totals. All 4,127 positive point counts have matching point-cloud labels; all 432 zero counts keep that label absent. Other geometry has separate roles.
- Validated all **2,591 retained immutable manifests** against the released viewer 0.20.4 schemas, with no missing or invalid manifests. Every body hash matches the preceding complete manifest audit.
- Checked all **2,763 scene previews / 2,479 distinct JPEGs** locally for full decoding, recorded dimensions, content hashes, the 64 KiB limit and absent EXIF. All 2,479 production responses returned JPEG bodies with the expected SHA-256, ETag and `nosniff`. Chromium fetched all 190 metadata packs and decoded every preview at its recorded dimensions without an image failure.
- Confirmed that every published scene with checked photographs has a preview. The remaining **1,796** placeholders consist of 1,686 scoped photo non-listings, 78 publisher/source photo exclusions and 32 unresolved photo associations. These counts describe photo evidence, not whether the camera/model launch works.
- Reconciled all current zero-point selections with the pinned component, native-parse, geometry-export and auxiliary-array receipts. Reused source checks retain their scope and revision; the repeat pass does not claim new complete imports or exports of every model.

The [32 photo-review entries](https://colmapview.opsiclear.com/hub/datasets/?photos=review_required) remain explicit rather than receiving a preview from another scene:

| Scenes | Source | Missing evidence |
| ---: | --- | --- |
| 16 | zhaoshiwen/blur-slam-bpn-data | Exact original-photo association for the selected ablation/ground-truth models. |
| 12 | LeeXiangNO1/DyNativeGaussian_sequence | Published renders do not establish original captures or their frame/camera mapping. |
| 1 | lishenyu/Plant3D, plant_001 | Similarly named dense images have different dimensions and no matching dense registered poses. |
| 1 | nnuochen/RGBT-Scenes-raw2temp-inferno-p0-98-filtered, RotaryKiln | No loose original photographs in the complete selected scope. |
| 2 | qizhangslam and slam-e2e ScanNet snapshots | Published visualizations do not establish that the registered input photographs are included. |

## Zero-point findings

| Scenes | Disposition |
| ---: | --- |
| 400 | No supplied static cloud listed in the complete checked scene scope, including all 200 WildCity scenes. Separate depth maps do not become synthetic sparse points. |
| 27 | A checked selected Gaussian frame loads as a separate render layer; the COLMAP sparse-point count remains zero. |
| 3 | Source mesh geometry exists; mesh vertices are not reported as sparse reconstruction points. |
| 2 | Inspected camera/pose/flow containers contain no static XYZ geometry in the checked non-depth scope. |

The [current zero-point receipt](../data/zero-point-reaudit-2026-10-22.json.gz) records all 432 scene identities, evidence keys and scoped findings. Earlier 63 recovered selections now have positive counts and are outside this zero-count total; their source/export receipts remain in the [October 20 audit](zero-point-audit-2026-10-20.md).

## Fixes

The offline zero-point command previously stopped at the 138 WildCity scenes added after the historical component audit. It now combines historical receipts with [current additions](../data/scene-component-additions.json.gz). A refreshed receipt can replace only the same source, revision, scene kind, path, archive and selected files. Regression checks reject changed models, duplicate scene identities and invalid source ordinals. Original dated reports remain intact.

The preview documentation now describes both supported crop policies: 2,762 square crops and one full-frame aspect-fit preview. No catalog entry, source selection, launch URL, thumbnail, calibration, pose or point value changed in this pass.

## Reproduction and limits

Run `python -m scripts.audit.audit_zero_point_scenes` after building the same-generation index and packs. Default inputs are `data/scene-component-audit.json.gz` and `data/scene-component-additions.json.gz`. Repeat `--prior <report>` to choose another sequence of scoped reports explicitly. Inventory-only output leaves geometry exports and auxiliary inspections conservative; pass independent `--exports` and `--confirmations` to reuse those checks. The 27 Gaussian export verifications and two auxiliary confirmations used here are retained in the linked current receipt, under each scene's `verification` and `confirmation` fields.

Four published source collections still have incomplete collection-wide discovery: ALC901/DL3DV-10K-3dgs, yinyue27/RefRef_additional, JiaJinrang/PanoWorld and turandai/gaussian-surfels-dtu. Their qualified individual selections do not establish that every collection scene has been discovered. The [earlier discovery audit](catalog-followup-audit-2026-10-22.md) records full-import coverage and byte-budget retries. The three known AstroVision decoder failures remain withheld. Full photo exports, unresolved alternative calibrations, video/timeline support and real Safari checks retain their existing separate limits.

Chromium also reports the existing blocked Cloudflare analytics beacon: automatic injection conflicts with the Hub's `script-src 'self'` policy. This did not prevent catalog browsing or image decoding; the policy was not relaxed for analytics in this dataset audit.

Validation passed: the full core check (89 catalog tests, 232 Worker tests, type/lint/style checks and build), all 161 Python tests after the final change, 24 photograph/content browser tests, all manifest schemas and the production thumbnail checks above.
