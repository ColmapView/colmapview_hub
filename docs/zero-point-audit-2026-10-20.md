# Zero-point scenes, 2026-10-20

The audit covers all **357 effective zero-point scenes in 45 collections** from generation 8aed9dd7761e4e91fc6b77a72809fbef47c74f38369231e9eb651470ecffcd8c. Fifteen scenes now select **9,336,828 verified source points/vertices**. All five static cloud bindings and all three auxiliary-container follow-ups from the first pass are resolved. Unknown counts were excluded. Sixteen already working native/XYZ manifests and the previous OpenMVG repair are preserved.

The [readable scene list](zero-point-scenes-2026-10-20.md) links every audited scene. The [evidence ledger](../data/zero-point-audit.json.gz) retains exact revisions, selections, source hashes and independent export results. The [auxiliary inspection](../data/zero-point-auxiliary-inspection.json.gz) records array shapes and byte-range receipts. Confirmed facts can be reused at unchanged pins and evidence keys without a global source scan.

Viewer **0.19.9** and Hub **0.9.12** are deployed. The [production verification receipt](../data/zero-point-live-verification.json.gz) records all six new selections and Berlin loading through their published Hub links, visible geometry, decoded photographs, retained share sources and successful COLMAP downloads. Independent checks matched all 7,382,230 newly selected vertices, calibration/poses, the cloth photographs and Berlin's source observations and three original JPEGs. Reopening the cloth share link retained its four synchronized views and selected vertex frame. Catalog regression checks preserved all 5,583 scene identities, previews, masks and splats; 5,577 launch routes are unchanged.

## Closed loading gaps

| Collection / selected scene | Points | Verified selection |
| --- | ---: | --- |
| Poison-3DGS — ARKit 42446517 / multi3 | 983,145 | Same-folder points3D.ply; existing multi3/images/ prefix retained. |
| Poison-3DGS — ARKit 47895549 / multi3 | 601,496 | Same-folder points3D.ply; existing multi3/images/ prefix retained. |
| Poison-3DGS — drjohnson / multi3 | 1,051,142 | Same-folder PLY; retain feature coordinates and disconnect 338,032 references to the absent original point table. |
| ALC901/DL3DV-10K-3dgs | 69,532 | Explicit 3dgs_output/input.ply and cloud-only world transform. All 319 source 3DGS camera poses agree, maximum delta 8.9e-16. Existing images_8 routing and 1/8 pixel calibration remain intact. |
| turandai/gaussian-surfels-bmvs — cow | 4,674,767 | gt_pts.ply already uses the normalized world reconstructed from world_mat × scale_mat. Source BMVS evaluation compares ground truth directly in this frame. No inverse scale is applied twice. |
| Cloth-splatters — TOWEL_00_00, frame 0 | 2,148 | trajectory.npz array pos, frame 0, with metadata indices [0,23,46,69]: four views at time zero. All vertices project within all four photos and onto their foreground. All four original PNGs survived export unchanged. |

These six selections add **7,382,230 vertices**. Actual browser imports, point draw calls, original calibration/poses, every XYZ/RGB value and untracked COLMAP exports were checked. PLY vertex numbers do not identify original COLMAP landmarks; unrelated source image references must never be joined to them. Native COLMAP observations remain unchanged when a native point table is selected. Native image prefixes retain sample-level evidence rather than claiming complete photo exports.

Camera metadata manifests now declare nonstandard cloud paths, cloud-to-camera-world similarities, or bounded numeric NPZ vertex frames with matching NeRF view subsets. This does not merge time sequences into one static cloud. Mesh faces, Gaussian properties, object/pickle arrays, ambiguous selections and invalid transforms are rejected.

## OpenSfM observations and framing

Berlin retains **1,430 XYZ/RGB landmarks**, **3,082 reciprocal landmark observations**, **137 untriangulated 2D features**, and all three original JPEGs. The native tracks_example.csv sidecar is imported. Its 204,020 bytes have SHA-256 a523dea2c86a6527484cbbae907c2092201bbd225c71b429c7b3e10788eb3b1e. Independent checks compare point IDs and pixel centers, recompute reprojection errors and reject altered observations. The earlier JSON-only zero-observation export remains historical evidence, superseded for the current launch.

Initial/reset bounds include the camera trajectory and central point extents. A bounded sample of up to 8,192 vertices and 1st–99th coordinate percentiles keeps distant outliers from shrinking the subject. Point-only scenes retain their full bounds. Source geometry is unchanged, and saved dataset views retain precedence. The new native manifests have checked overviews. Viewer 0.19.9 includes this correction and retains the explicit manifest when sharing a scene. The 0.19.6 and 0.19.7 candidates were cancelled before deployment. The 0.19.8 candidate was blocked by browser checks; 0.19.9 corrects their view and hover preconditions without weakening assertions.

## Earlier recovered scenes

The first pass also corrected eight NeRF companion-cloud receipts: dry_ice (100,000), Skyfall JAX_004 (35,355), dadr_splatting (100,000), GrowSplat quinoa/20221031 (16,315), gate-gsplat left_scene (28,634), synthetic Lego (100,000), eks_data mic (786,432), and eks_demo_data ficus (786,432). With Berlin, these account for the earlier **1,954,598 points**. Their pinned source facts are retained without repeated downloads.

## Correct remaining zero counts

| Scenes | Confirmed disposition |
| ---: | --- |
| 262 | No static point source listed in the complete checked scene scope. This is scoped evidence, not collection-wide absence. |
| 2 | Auxiliary scope has no static XYZ. All 70 HDR flow NPZ indexes contain only two-channel flow and masks, both NPY sequences contain 2D flow, and poses_bounds.npy is a camera array. DTU scan24/cameras.npz contains 294 camera/scale/inverse matrices. Thirty-six depth arrays were excluded under the requested non-depth scope. |
| 28 | Other reconstruction/training variants have geometry; selected BMVS seed/calibration and TwinWorld held-out models remain separate. |
| 47 | danceNet3D geometry uses separate time-indexed archives, including multi-gigabyte TAR/Zstandard sequences. Static COLMAP launches do not attach arbitrary temporal frames. Archive timeline loading remains a separate unsupported feature. |
| 3 | Mesh geometry exists. Mesh vertices are not reported as sparse reconstruction points. |

These **342 remaining zeros** are explained rather than unresolved static-path failures. Usable cameras/poses still qualify without photographs or sparse points. Existing masks, splats, previews, original links, other variants and scene identities are retained.

## Reproduction

The offline command "python -m scripts.audit.audit_zero_point_scenes" summarizes same-generation packs and pinned component receipts. Optional --exports adds independent recoveries; --confirmations reuses auxiliary inspections only when the evidence key and revision match. Its sourceNetworkReads: 0 describes the summary step, not historical source inspections.

"python -m scripts.audit.verify_companion_scene_exports --scene <scene-id> --browser <browser-results.json> --exports <zip-directory> --cache <url-hash-cache> --output <results.json>" verifies selected scene manifests offline with NumPy, Pillow and PyCOLMAP. It compares large point streams in chunks, camera calibration/poses, retained feature coordinates, synchronized frame selection, source world associations and original photo hashes. Source bytes and browser exports remain local operator receipts; compact evidence is published. OpenSfM sidecars are checked by verify_camera_model_exports and verify_opensfm_tracks.

Source conventions were checked against [OpenSfM pixel normalization](https://github.com/mapillary/OpenSfM/blob/92381be43cd93ca91e7ef903733a0482440028dd/opensfm/features.py), [native track serialization](https://github.com/mapillary/OpenSfM/blob/92381be43cd93ca91e7ef903733a0482440028dd/opensfm/src/map/src/tracks_manager.cc), [Gaussian Surfels camera matrices](https://github.com/turandai/gaussian_surfels/blob/main/scene/dataset_readers.py), and [BMVS evaluation](https://github.com/turandai/gaussian_surfels/blob/main/eval.py).
