# Source feature-link safeguards — October 22, 2026

The [observation audit](catalog-observation-audit-2026-10-22.md) found inconsistent native feature/point links in 25 NewtPhys/DL3DV scenes. The viewer now detects these relationships, warns on the committed scene, suppresses feature matching and blocks COLMAP export. Cameras and point geometry remain viewable, and PLY export remains available. The Hub exposes the exact review on the affected cards and detail pages.

These are local changes. Viewer commit `a1b4ad6a93fb2bc3de60efd54eda6409243d7989` follows `7e1419ddcf697977a5cef48137aaf2543be21929`; the Hub baseline is `7b829e5`. No push, release tag or deployment was performed.

The [validation receipt](../data/catalog-source-integrity-fixes-2026-10-22.json.gz) has SHA-256 `e78605eddfc454b6ae408e37183b8605f76e50e4e44fdae763d7262ebe113ee7`. It reuses the immutable source audit at SHA-256 `6705d7a628aeb4878287c927852c70df521373fa332ab88bfeee5c61382158e1`; no additional provider reads were needed.

## Viewer behavior

The authoritative reconstruction owner checks track target bounds, missing images, point-ID agreement, duplicate feature targets, repeated point/image tracks, reciprocal image observations and nonfinite tracked coordinates. Original uint64 IDs are compared without converting them to JavaScript numbers. Unassociated observations retain their original indices and coordinates, including nonfinite coordinates.

Original binary observations are visited directly from retained bytes or bounded Blob reads without populating the lazy WASM observation cache. Packed track indices are processed in image batches. Validation runs on load and after image deletion; transforms and camera changes preserve the relationship result. An unavailable check also blocks native export.

Binary, text and ZIP downloads, packages with photographs/masks, and upload preparation use the same guard. Invalid sources cannot bypass it through the legacy in-memory export path. PLY contains point geometry without feature tracks. A source warning is replaced when a new scene commits, cleared for valid scenes and on clear, and left alone by failed loads. Dismissing it does not cause edits to show it again. The image-detail match view also rejects a stale selection from an untrusted graph.

## Hub review scope

`sourceIntegrityReview` is tied to the pinned native scene and exact image/point file paths. It records the original audit digest, read sizes, byte hashes and whether the evidence covers complete models or bounded samples. Builds reject malformed reviews and changed file identities.

- Four scenes retain complete original-model failures confirmed by independent PyCOLMAP reading.
- Twenty scenes retain directly checked point-to-feature target mismatches from bounded original-file samples.
- One scene retains 436 checked observations without reciprocal point tracks, also from bounded samples.

The status is **Feature links need review**. Geometry loading stays enabled. Native counts and photo evidence remain separate from feature-link validity. Other scenes in the 56-model source collection are not certified clean by the absence of a review.

## Validation and preservation

| Check | Result |
| --- | --- |
| Viewer lint, application/test types and production build | Passed |
| Viewer unit suite | 670 files, 6,638 tests passed |
| Hub types, lint, styles, asset build and Worker dry run | Passed |
| Hub catalog / Python / Worker tests | 91 / 169 / 236 passed |
| Hub catalog browser suite | 29 passed |
| Actual native browser imports | Four original invalid models and three independently accepted diagnostic copies; no page exceptions |
| Original invalid graphs | 1,271,977 track references checked; conflict totals match the earlier complete-file audit |
| Invalid export UI | No ZIP download; explanatory error shown; PLY remains available |
| Valid browser ZIP exports | Three accepted by PyCOLMAP 4.2.1 |
| Valid export comparison | 1,335,628 observations and 1,014,838 track references compared; point IDs/tracks, camera bytes and pose values preserved |
| Scene/source totals | 4,559 scenes and 144 sources unchanged |
| Launch JSON bodies | All 2,610 manifests and 80 saved states byte-identical |

Exactly 25 scene review records change. All other scene fields, source counts, launch URLs, selected files, previews, photo evidence and existing calibration reviews are unchanged. Catalog generation is `042cb88c73ae070b7f7aea44437ced73796b4bf6d6847352f22213a33f001755`.

The three positive diagnostic copies are local test fixtures, not published replacements. Original source files remain untouched; all 12 complete original file hashes were rechecked. The ambiguous fourth model is not automatically renumbered. This closes the application validation/export gaps without guessing source IDs or coordinates. Calibration, original-photo alignment and other scientific validity still have their separately documented scopes. Existing native WASM float32 observation/XYZ/error export precision is unchanged.

Reproduction programs, browser screenshots, downloaded test ZIPs and detailed logs remain in `.tmp/source-integrity-fixes-20261022/` in the Hub and viewer worktrees. Durable unit tests cover synthetic reciprocal and broken graphs, original index preservation, export/upload guards, matching, scoped warning lifecycle and policy evidence. Run `npm run check` in each repository, `npm run typecheck:tests` in the viewer, and `npm run test:browser -- e2e/catalog-access.spec.ts` in the Hub.
