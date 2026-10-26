# Photograph availability review — October 26, 2026

Reviewed every one of the **1,718 photo-negative entries** in the 4,559-scene,
144-source catalog. Complete anonymous trees at the selected commits cover
**268,732 files in 307 pages across 17 sources**. Publisher metadata and retained
exact-name, calibration and source-mapping receipts distinguish originals from
masks, depth, renders and different image representations.

The [machine-readable receipt](../data/photo-negative-audit-2026-10-26.json.gz)
binds every checked scene to its revision, selected files, inventory digest,
previous evidence and classification. It retains per-page hashes and public
request URLs. No provider credentials or restricted photograph bytes are stored.

## Corrections

**37 classifications changed:** 23 need image association, and 14 explicitly omit
or withhold originals. The other 1,681 retain their scoped findings.

| Entries | Result after review |
| ---: | --- |
| 10 | Oxford Day-and-Night supplies processed photographs in TAR.GZ archives. Exact archive-member and rectified-camera association remains unverified. |
| 13 | MBZUAI Campus has source recordings, but missing streams, ambiguous offsets or unresolved capture identity prevent complete camera/frame association. |
| 95 | Original photos are omitted or withheld for the selected model, including six N3DV benchmark rigs, seven TwinWorld final-test scenes and one copied DL3DV model newly classified here. |
| 1,600 | Matching photographs are absent from the selected pinned source or representation. This does not establish that photographs do not exist elsewhere. |

The Hub now says **Photos need mapping** for the 23 association cases and **No
matching photos found** for scoped non-findings. A missing thumbnail says **No
preview**, independently of photo availability. Unmapped video/archive evidence
cannot qualify absent photos, a checked sample or a ready companion archive.

## Source coverage

| Source | Entries | Finding |
| --- | ---: | --- |
| Bluefish2333/ScannetPoseRefine | 1,513 | Models and metadata only; no photos, recordings or photo archives in this pin. Original ScanNet access is separate. |
| astra-vision/newtphys_dl3dv | 56 | Originals omitted from this snapshot. All 56 capture hashes have separate official DL3DV 4K archives. |
| boazkg/gs-pool-paslcd | 41 | Original solve photos omitted; available undistorted photos belong to other camera models. |
| chien90190/Splannequin | 20 | The card describes extracted frames, but none is supplied in the complete pinned tree. |
| boazkg/gs-pool-cl-splats | 16 | Publisher explicitly excludes original CL-Splats photos. Supplied rasters are masks, annotations or outputs. |
| sebothetramp/MBZUAI-Campus | 14 | Thirteen recording associations unresolved; one copied DL3DV model omits its 322 original 4K frames. |
| Dororo99/Ours_Waymo_ArmGS | 11 | Publisher excludes original/resized RGB and raw records; supplied PNGs are masks. |
| active-vision-lab/oxford-day-and-night | 10 | Rectified image archives and recordings exist; exact imagery routing is unverified. |
| Dororo99/Ours-V2_nuscenes_ArmGS | 10 | Publisher excludes original RGB; supplied PNGs are sky masks. |
| LeeXiangNO1/DyNativeGaussian_sequence | 9 | No selected N3DV/MeetRoom original representation. Renders and flythroughs do not replace camera photos; other captures' TARs do not establish a mapping. |
| Zqlin/TwinWorld_Datasets | 7 | Final-test photos deliberately withheld; all 21 registered names absent from the complete tree. |
| ChenJJ123/d3dgs-benchmark | 6 | Captured N3DV images explicitly excluded; model and Gaussian outputs remain available. |
| amelnikov/HorizonGS_Park_street_only_COLMAP | 1 | Eight-file model/database/configuration snapshot; no source imagery. |
| lishenyu/Plant3D | 1 | Two selected 640 × 480 originals absent. Same-name dense photos have different calibration/dimensions. |
| nnuochen/RGBT-Scenes-raw2temp-inferno-p0-98-filtered | 1 | RotaryKiln RGB absent from this pin; an external publisher ZIP has a verified association, with browser delivery still separate. |
| qizhangslam/prism3d-scannet-original7k-fixedk-20260926-public | 1 | Original input representation omitted; evaluation renders are not replacements. |
| slam-e2e/prism3d-scannet-original7k-fixedk-20260926 | 1 | Same source-input limitation in this separate snapshot. |

The GS-Pool PASLCD metadata summary stops at 100,000 files. Full pagination
returned **195,605** files; all 95,605 additional paths are under `members/` and
contain further outputs rather than omitted `inputs/` files. The truncated
summary was not accepted as absence evidence.

The publisher's pinned NewtPhys download code identifies the original DL3DV
repositories. Public metadata at DL3DV 4K revision
`fd16cc2b2f4c79b69368e422d8c4552453f866eb` contains archives for all 56 NewtPhys
captures and the copied Campus capture. Access requires accepting DL3DV's terms.
Capture IDs identify candidate originals; they do not verify exact processing,
camera calibration or pixels for these derived models.

## Scope and reproduction

All scene identities, native counts, source commits, model launches, verified
image/video mappings and immutable manifests are preserved. Positive photo
selections were outside this repeat pass. The exact-name/calibration findings in
the [October 22 mapping review](catalog-source-mapping-2026-10-22.md) and complete
native inventories in the [Campus mapping receipt](../data/campus-video-mapping-audit-2026-10-25.json.gz)
are reused at the same selected files rather than claiming fresh pixel checks.

Reproduce each inventory from its pinned tree URL, following every `rel="next"`
link until absent; retain response hashes and sort file paths before hashing
their compact UTF-8 JSON array. Compare selected registered names and calibration
receipts before attaching photographs. Do not substitute masks, rendered views,
different captures or undistorted imagery with incompatible cameras.

`npm run check` validates projection, evidence and manifests offline. The photo
planner (`npm run catalog:photo-plan -- --output .tmp/photo-plan.json`) reuses
confirmed facts at their exact revision and selected files. Neither normal
builds nor the Worker refetch sources, bypass access restrictions or claim a
complete photograph/export check from this inventory review.

Validation passed: type/lint/pinned-style checks, 109 catalog tests, 191 Python
tests, the D1 recovery integration test, 279 Worker tests, the production build
and all 102 Chromium browser cases. All 3,477 referenced manifest schemas are
valid, with none missing; all 3,557 retained immutable manifest files are
byte-identical to the preceding build. The rebuilt catalog retains 4,559 scenes,
144 sources and 2,840 scene previews using 2,534 distinct attributed JPEGs.
