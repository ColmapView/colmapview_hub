# Incremental observation audit — October 22, 2026

This pass reuses the [previous verification](catalog-calibration-fixes-2026-10-22.md) and checks new observation/track relationships and saved-state compatibility. Runtime code and catalog selections are unchanged. Baselines are Hub commit `26471ae83217fa06194d8354fd834e44d85bd737`, viewer `7e1419ddcf697977a5cef48137aaf2543be21929`, and generation `e3cd6257a816fb06c73694250ac42ffe77bb74a586c73b2640030bf3dc7b7be2`.

The [receipt](../data/catalog-observation-audit-2026-10-22.json.gz) records original source identities, exact sample bounds/hashes, all affected IDs and independent complete-file results. An executed inspection notebook and checking programs are retained locally at `.tmp/catalog-delta-audit-20261022/audit.ipynb`.

## High: source point IDs disagree with feature associations

At [`astra-vision/newtphys_dl3dv`, pin `4adffef603489eb153d68da077958f73142308e0`](https://huggingface.co/datasets/astra-vision/newtphys_dl3dv/tree/4adffef603489eb153d68da077958f73142308e0), four complete original reconstructions fail **PyCOLMAP 4.2.1** reading. Every downloaded file matches its pinned Hugging Face Git blob or LFS object identity and the earlier retained prefix. This confirms a source-file inconsistency rather than a stale local response or a count discrepancy.

| Scene | Published entry | Poses | Points | Wrong point-track targets in complete source |
| --- | --- | ---: | ---: | ---: |
| `1K/7851c27e…` | `data-c17e6904352bed2dad4694dd` | 344 | 95,092 | 451,895 |
| `1K/cc75e9d8…` | `data-951113a1d843579b2e256a7e` | 310 | 55,827 | 257,087 |
| `2K/5d981062…` | `data-9739f5f504748a466406a9bb` | 331 | 55,295 | 309,572 |
| `3K/a09c4897…` | `data-228a2d5da2df0ef10b25feb1` | 333 | 32,438 | 253,371 |

Each has one camera definition. Complete native counts agree with the catalog; those verified totals are not the defect. A point's track names an image/feature whose saved point ID differs. For example, one source track for point `10` targets a feature naming point `6`. The independent reader rejects this with `point2D.point3D_id == point3D_id` failure.

The four complete triples total **64,696,508 bytes**. Full parsing checks **1,271,977 track references**, of which **1,271,925** name a different point in their target image observation. Source IDs are recoverable through a unique track-derived bijection in three models. On diagnostic copies, changing only the point-record IDs makes all three readable by PyCOLMAP with unchanged counts, cameras, poses, point XYZ/colors/errors and track arrays. The original downloads remain untouched.

The fourth model (`cc75e9d8…`) also has seven ID collisions and 12 point records whose tracks include unassociated observations. It was not rewritten. A universal offset or blind renumbering is not supported.

The collection has **56 published scenes**. Rather than downloading its remaining approximately 4.5 GB of native data, the audit adds bounded reads for the other 52 models: **104 source ranges / 16,228,072 bytes**. Twenty further scenes have directly checked point-track targets with different observation IDs: all **2,530 inspected targets** disagree. One additional scene has missing observation-to-track reciprocals and large residuals in its sampled joins, without a reverse target to the first image inside the retained point prefix. Thus **25 scene entries have inconsistent sampled or complete associations**: four complete failures, 20 additional direct target failures, and one additional reciprocal-link finding. The receipt distinguishes these evidence scopes; the remaining scenes are not certified clean.

Small residuals and plausible calibration cannot validate mismatched IDs. In the added joined samples, the affected-scene median residuals range from approximately 74 to 983 pixels. These are source relationship findings, not evidence that all calibration values or point positions should be replaced.

## High: the viewer does not warn, and an exported model retains the inconsistency

Chromium loaded all four complete pinned triples through the actual current viewer. Camera, pose and point counts match the source, with no page exceptions or load error. These checks use an exact model manifest and intentionally skip photographs, so they isolate model parsing from photo delivery.

The actual UI download for `data-228a2d5da2df0ef10b25feb1` produces a **4,955,813-byte COLMAP ZIP**. PyCOLMAP rejects its complete extracted model with the same `6` versus `10` association failure. Semantic comparison finds **zero changed observation point IDs and zero changed track arrays**. The inconsistency predates the viewer and survives its export; this is a validation/warning gap, not evidence that the exporter introduced the bad IDs. The documented float32 native-export coordinate/error precision is carried forward separately.

The smallest useful follow-up is a native graph consistency check that distinguishes usable camera/point display from trustworthy feature tracks and complete COLMAP export. The Hub should expose an exact source-integrity review for confirmed selections; loader/export UI should make the inconsistency visible. Repair should be explicit and independently checked. Do not guess coordinates, discard an entire source collection, or apply the three clean diagnostic remaps to the fourth ambiguous model.

## New checks that pass or do not establish a defect

- All **80 referenced viewer-state JSON files** parse with the current viewer, retain every supplied supported setting, and round-trip through the actual YAML serializer/parser. Saved quaternion norms and orbit distances also pass the scoped checks. No new saved-state compatibility issue is found.
- The new broad sample examines **1,861,047 first-image observations in 3,663 native scenes**, excluding the previous 80 projection-sample scenes. Original point-prefix joins yield **205,304 projection comparisons across 1,681 scenes**. Cameras/counts already verified by the previous pass are reused as inputs. Unjoined prefixes and unsupported projection families do not become passes.
- Seven sampled scenes contain **317 nonfinite 2D coordinates**, all with the unassociated `-1` point ID. There are zero nonfinite tracked coordinates in those samples. These observations do not establish corrupted reconstructed points or invalid camera poses and are not added to the actionable source findings.

## Scope carried forward

The prior count/grouping, complete-camera, camera-document, manifest-schema, signed-focal, photo-dimension and unchanged-runtime repository checks are not repeated. Their receipt hashes and scopes are referenced in the new receipt. The catalog still contains 4,559 scenes across 144 source records; this audit does not publish, exclude, relabel or repair them.

The new relationship sample covers five perspective camera families. Other projection models, unsampled images/points, original-photo alignment, complete RGB exports and all-model scientific validation remain outside this pass. Known upstream calibration/photo-representation findings retain their earlier scopes. Thirty-two expanded source scenes have no directly cross-checkable first-image track target in these prefixes. One has the separate observation-to-track finding; the other 31 remain unclassified by this relationship check. Lack of a target is not proof of a valid graph.
