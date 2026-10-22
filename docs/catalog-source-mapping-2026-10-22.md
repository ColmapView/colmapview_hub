# Source photograph mapping follow-up — October 22, 2026

The [previous source-resolution audit](catalog-source-resolution-2026-10-22.md) rejected Dunhuang after comparing its archive binary models. A complete review of the parallel text models establishes the correct association. Dunhuang is resolved without changing its native calibration, poses, observations or points. RotaryKiln also has a verified external source mapping; browser delivery is checked separately from that result.

## Dunhuang: exact text-model association

At `LeeXiangNO1/DyNativeGaussian_sequence` revision `40381cfe756e8e4cafcffcf599e586655792213f`, the correct photographs are in:

```text
source_img/Dance_Dunhuang_Pair_1080.tar
  Dance_Dunhuang_Pair_1080/frame000000/images/cam00.png … cam59.png
```

This TAR contains inconsistent binary and text camera/pose representations. Its `cameras.txt` and `images.txt` are byte-identical to the text files alongside the selected native model. Parsing them with the released viewer establishes agreement with **every field** in the selected native binary files: 60 cameras, 60 registered images and 134,788 observations. The maximum numerical difference is 1.39 × 10⁻¹⁷. All 62,556 native point-track references are reciprocal, covering 11,115 points.

The archive binary camera/pose files differ in all 60 records and are excluded. No estimated world transform, camera permutation or calibration replacement is needed. The separate Single_f14 export is not used.

| Checked text file | SHA-256 |
| --- | --- |
| `cameras.txt` | `f882985fc309607a188bb02cae34a17b4a0f07943db40c860d08107dd3567d96` |
| `images.txt` | `e588e5b0161b73cc397069f6ec119da53fc8b2f3bd1686786d6cb6694e1abd1f` |

The launch retains the existing native binary camera, image and point files. Only the verified first-frame images are mounted. Viewer 0.20.5 indexes the complete 52,564,992-byte TAR prefix against the original 11,167,590,400-byte archive size. All **60 original photographs** passed reads and image decoding through the actual viewer dataset manager, with exact 1920 × 1080 camera dimensions. Full native import produces 60 cameras, 60 images and 11,115 points.

The [PKU-DyMVHumans publisher](https://github.com/zhengxyun/PKU-DyMVHumans/blob/702c8d511e63faf58c76e7d0dd9a0cbd7db5b585/README.md) describes the capture formats and restricts redistribution. This change hosts no new photograph or preview. The browser reads photographs directly from the existing pinned publisher TAR. Archive routing now accepts an exact decoded original-photo receipt independently of a hosted thumbnail; an incomplete or mismatched receipt still fails validation.

## Other source metadata

| Scenes | Source | Verified result |
| ---: | --- | --- |
| 1 | RotaryKiln | The [original RGBT publisher](https://github.com/chen-hangyu/Thermal-Gaussian-main/blob/292c87be2ad3bac3ddf6dfa068bd3efc5d202668/README.md) links a public Drive folder. Its `RGBT-Scenes.zip` contains `RGBT-Scenes/RotaryKiln/rgb/train/` and `rgb/test/`. The archived binary calibration and all 106 poses/249,818 observations agree exactly with the selected Hugging Face text model. Every registered filename has one matching RGB member. This resolves source association; direct browser delivery has a separate CORS limit. |
| 6 | N3DV | The [original release](https://github.com/facebookresearch/Neural_3D_Video/blob/6fac4d2be34c0f7cca92dde7f5ece17a8b478d04/README.md) documents synchronized videos, omitted stream IDs and sorted `poses_bounds.npy` ordering. Those rules identify original streams, but do not establish these exports' exact extracted/undistorted photo bytes. |
| 3 | MeetRoom | [StreamRF](https://github.com/AlgoHunt/StreamRF/blob/be8d2b800ce5ee9aa2e46f2efef4c9959478efcc/README.md) and [Swift4D](https://github.com/WuJH2001/Swift4d/blob/5cc270897a4af2e6148b1951d2721bdc286a6e4d/README.md) provide original-data and processed-pose sources. The conversion recipe describes frame-zero calibration, copied camera parameters and COLMAP undistortion. It is provenance, not an exact pixel/calibration receipt for the selected exports. |
| 2 | PRISM3D ScanNet mirrors | Their pinned `input/adapter_receipt.json` documents the 400 source indices, original Drive file IDs, byte sizes and SHA-256 values, plus the pose-row relation and resizing. The selected snapshot references `000000.png`-style names at 160 × 120; its original source photographs are a different representation. No replacement is attached without verifying the exact resize, naming and calibration binding. |
| 1 | Plant3D | The source `project.ini` identifies the `color` input. The [publisher's reconstruction script](https://github.com/yixnhuang/multiview-recon/blob/87aab62458d2e1bffa1717958b621692aabd2376/utils/run_colmap_full.sh) explains dense-image undistortion. Neither recovers the two absent 640 × 480 originals or supplies an exact supported mapping from the differently sized dense images to this sparse model. |

Current upstream branches were checked independently. DyNativeGaussian's latest main changes trajectory timing, not the selected native models or source TAR. `from_LD` and `main_Deprecated` preserve the same relevant text metadata; changing branches is unnecessary.

The [machine-readable receipt](../data/catalog-source-mapping-audit-2026-10-22.json.gz) retains source pins, metadata body hashes, complete-model comparisons and scoped browser evidence. Source mapping, browser delivery, decoded photographs, complete exports and temporal playback remain separate results. Twelve scenes still lack a verified photo representation for their selected native model; RotaryKiln has a verified mapping with delivery pending. The catalog retains 4,559 scene identities across 144 sources, 2,781 previews and every earlier immutable manifest; the Dunhuang launch adds one manifest, bringing the total to 2,610.

Checks pass 89 catalog, 165 Python and 236 Worker tests, plus type/lint/style checks and the production build. All 2,610 manifest schemas validate. The 71 existing browser cases are covered: 70 passed initially; a stale aggregate assertion required a nonempty unresolved category after the last such scene was resolved. The corrected aggregate case and extended Dunhuang archive case pass their focused rerun. No source model or provider response is mocked in the recorded photo reads; only the unpublished manifest body is staged locally before deployment.

Hub 0.10.11 is deployed. All 190 public metadata pack bodies match the verified build; the new manifest's full bytes, CORS headers, direct launch and changed detail pages pass live checks. The public Dunhuang launch imports 60 cameras, 60 poses and 11,115 points in viewer 0.20.5, renders the scene and decodes 22 gallery thumbnails. These production checks are recorded separately from the 60 complete original-photo reads.
