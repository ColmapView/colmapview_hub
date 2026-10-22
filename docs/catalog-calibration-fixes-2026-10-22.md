# Camera calibration corrections and validation, October 22

This follow-up fixes the viewer defect and clarifies the metadata findings from the [count and calibration review](catalog-anomaly-audit-2026-10-22.md). It records local validation before release; the subsequent [production verification](source-integrity-release-2026-10-22.md) records deployment of Hub 0.10.12 and viewer 0.20.6. The [machine-readable receipt](../data/catalog-calibration-fixes-2026-10-22.json.gz) records the exact scene IDs, source revisions, camera hashes, comparisons and test scope.

## Viewer correction

Viewer commit `7e1419ddcf697977a5cef48137aaf2543be21929` accepts finite, nonzero signed focal components. Image-plane extents and offsets preserve their signs so the texture still projects onto the original COLMAP pixels. Framing and invisible instance hit bounds use positive magnitudes. Source intrinsics, poses and point coordinates remain unchanged; zero and nonfinite focal components remain rejected.

All **21,453 signed calibration records in 68 AstroVision scenes** passed a replay through the patched helpers. The check projected 536,325 actual Three.js plane vertices/UVs back onto their original pixels, with maximum error **0.0000384 pixels**, and checked framing, positive hit bounds and unchanged camera values. These are repeated source calibration records across overlapping scenes, not a count of distinct physical cameras.

Chromium also loaded both complete pinned original models below, decoded their selected original photographs, and rendered raw, full-frame and cropped image planes. Inspection used explicit zoom because these telescope images have narrow fields of view. Both signed axes were covered, shader materials appeared in both undistortion modes, and no page exceptions occurred.

| Scene | Camera definitions | Registered poses | Native points |
| --- | ---: | ---: | ---: |
| `clusters/train/orex_bennu/00000024` | 300 | 300 | 126,867 |
| `segments/rosetta_lutetia/sbmt` | 40 | 40 | 349,430 |

## Hub metadata corrections

Nine exact native selections now expose **Calibration needs review** in their cards and retain a dated, camera-file-bound review in their details. Six are suspect: four YouTube calibrations and the two PRISM mirrors. Three have unresolved focal-component ratios above 2:1. Their original numbers are retained because the source evidence does not establish a physically justified replacement. A successful import/export comparison remains visible separately; it does not establish physical calibration.

All **210 known native photo-resolution differences** now carry explicit sample width/height, camera width/height, the exact camera-file digest, and a false dimension-match flag. Cards disclose the resolution mapping limit, and details show the two resolutions and unverified alignment. Existing source-specific path/archive restrictions remain. A contradictory dimension claim or a mismatching sample combined with a complete-photo-export claim fails the offline build.

The earlier 30 multi-calibration lookup limits are resolved. Exact registered-name lookups match all 30 photo samples to cameras with matching dimensions. Seven complete pose files were freshly read and matched their existing complete-file hashes; the other lookups reused retained source bodies. The native photo sample comparison therefore covers **2,736 samples: 2,526 matching resolutions and 210 differences**. Dimensions alone do not prove a resize/crop mapping, all-image alignment, or complete export.

## Preserved catalog and tests

The rebuilt generation is `e3cd6257a816fb06c73694250ac42ffe77bb74a586c73b2640030bf3dc7b7be2`. All **4,559 scene entries and 144 collections** remain. An exact before/after comparison preserves IDs, selections, native/verified counts, launch URLs, previews, content roles and photo availability states. All **2,610 manifest bodies and 80 viewer-state JSON files** are byte-identical: 2,690 launch JSON assets in total.

- Viewer `npm run check`: lint, typecheck, **668 unit files / 6,623 tests**, and production build passed. Three existing Chromium context-menu checks passed; signed-bound raycasting also has focused unit coverage.
- Hub `npm run check`: code/style checks, **90 catalog, 167 Python and 236 Worker tests**, offline asset construction, all 4,559 launch contracts and Wrangler dry run passed.
- Hub browser suite: 70 checks passed on the full run. The remaining test's old assumption that every verified export shares one status label was updated to preserve export evidence alongside calibration warnings, and that check passed on its focused rerun.

This validation does not claim complete browser imports of all catalog scenes, complete image exports, or corrections to upstream scientific calibration.
