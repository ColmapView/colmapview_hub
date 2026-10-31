# StandardSowbelly calibration review

The `StandardSowbelly` share selects `inputs/Pots/Instance_1/anchored/undistorted/test/sparse`
from `boazkg/gs-pool-paslcd`, pinned to `8344b8bc14828d2f8badb77717be954b75ccf534`.
The [diagnostic receipt](../data/standard-sowbelly-calibration-2026-10-30.json)
records the native file hashes, all-pose reprojection results and sampled photo comparisons.

## Finding

Follow-up confirms a **source photo-version mismatch**, rather than an error in
the viewer's pose or image-plane calculations. The original native evidence retains
its calibration warning. A reviewed catalog launch replacement now selects the
matching source pair as “Photo source corrected.” It is prepared locally and
requires deployment.

The single PINHOLE calibration has dimensions 4019 × 2262, focal lengths
1618.053070495433 and 1616.0156927355772, and principal point
(1999.0052225814475, 1125.005300353357). Its principal point is approximately
10.495 pixels left and 5.995 pixels above the image center. A noncentral principal
point is valid in general; this offset alone is not evidence of a defect.

Independent projection of all 72,671 linked observations across 25 poses gives
median error 1.437 pixels and 95th-percentile error 3.167 pixels. This establishes
internal geometry/feature-coordinate consistency, not alignment with image pixels.
For the 3,503 observations in `Inst_1_test_IMG_E2660.JPG`, the actual viewer
`getImageWorldPose` and `getFrustumPlaneSize` calculations agree with independent
COLMAP projection within 1.02e-12 pixels at viewer commit
`4fcc1584068cdacd386c77c81ef300f184d1763b`.

Four original photographs (E2658, E2660, E2688 and E2718) decode at the expected
resolution. Sampling native point colors at stored feature coordinates gives
consistently better agreement after an image-coordinate shift of approximately
(+10, +6) pixels. Independent comparisons of normalized image patches at shared
observations also improve with a (+10.5, +6) shift across all six photo pairs.
Patch comparison is diagnostic, not a bundle adjustment; its discrete candidate
shifts do not establish an exact replacement calibration. Point-color agreement
alone would also be insufficient because color extraction could be biased.

## Scope and safe follow-up

Original source bytes and immutable manifests are preserved. The replacement
selects the original solve and matching photos, preserving poses, point coordinates
and short names. Changing just the principal point
would break the current geometry-to-feature-coordinate agreement. A proposed repair
must verify the actual image mapping and update calibration and observations
consistently, then repeat projection, image alignment and export checks.

The source's reference calibration differs from the test calibration. The reference
undistorted image dimensions are 3998 × 2250 with principal point (1999, 1125);
the pre-undistortion test solve has OPENCV dimensions 4000 × 2252. These are
different image/calibration pairs and cannot replace the selected files directly.
No global rule to center principal points is justified.

## Matching source recovered

The original PASLCD model binds the 4021 × 2264 version of E2660 to camera 2
(principal point 2010.5, 1132). GS-Pool's pre-undistortion test solve instead
expects a 4000 × 2252 OPENCV camera. The matching photograph is in
`PASLCD_online.zip`, pinned to PASLCD revision
`aef858feb483dd81104fbb5232a8c98fbf4d3fcc`, under
`PASLCD/Instance_1/Pots/inference_scene/images/`.

All 25 registered names occur in that archive and all 25 bounded JPEG header
reads report 4000 × 2252. Four complete originals were decoded and compared:
their point-color comparisons now have the best sampled offset at (0, 0).
Independently warping the larger original with the published camera reproduces
the current undistorted photo with mean absolute channel error 0.766/255,
confirming which photo version was used upstream.

The [matching-source manifest example](examples/pots-instance-1-matched-photos.manifest.json)
uses GS-Pool's original OPENCV camera and pose files, the current 29,815-point
file, and lazy archive reads for the matching original photos. All 25 poses are
bit-for-bit identical between the two GS-Pool image files. All 29,815 retained
point IDs and positions occur unchanged in the original solve. The 24 existing
Gaussian candidates remain listed; their geometry was not verified here.

A browser check loaded the exact example in the production viewer, selected
COLMAP-only viewing and decoded all 16 visible archive thumbnails without
uncaught page errors.
The same manifest is selected by the offline catalog repair policy; this is not
a complete export receipt. The public site keeps its previous launch until deployment.
The original solve also contains 21,502 additional
untracked points; the example retains the existing scene's point selection.

The original solve has 413 observations where one point sees two features of the
same image. The receipt records the warning these caused at the time. COLMAP's
track merging (`Reconstruction::MergePoints3D`) writes such tracks and its reader
accepts them, so they are not an inconsistency. Since October 31, 2026 the viewer
accepts them as well: its feature-link check finds the selected file set valid
(72,671 tracks, no issues), and COLMAP export is not blocked.

## Catalog integration

`data/source-pair-repairs.json` binds the original scene selection and viewer URL,
the complete audit receipt digest and the replacement manifest. The offline builder
requires unchanged poses and point coordinates, all registered photo names and
dimensions, successful browser reads and sampled zero-offset alignment. It also
compares the old and new point-file URL and every Gaussian candidate before
applying the replacement. The Worker performs no new source ingestion.

The original photo routing remains available in the evidence chain, but its
superseded photo calibration is hidden from the active metadata panel. The panel
shows the matching archive, sample scope and corrected manifest. Existing immutable manifests remain available for old links.

The sample covers four photographs, not every pixel of all 25 photos. None of
the 24 linked Gaussian variants was geometrically verified in this check; t1/t2,
trainer and seed comparisons remain separate. Source point error fields contain
the sentinel -1, so the viewer's displayed 0.000-pixel error is not evidence of
perfect alignment. The independently computed residual above is the relevant value.
