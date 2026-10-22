# Zero-point scenes, 2026-10-20

The audit covers all **357 effective zero-point scenes in 45 collections** from generation 8aed9dd7761e4e91fc6b77a72809fbef47c74f38369231e9eb651470ecffcd8c. Sixty-three scenes now select **16,202,532 verified source points/vertices**. Another 27 scenes load checked Gaussian frames while correctly retaining zero native sparse points. The latest pass resolves all 47 temporal scene launches through explicit frame selections. Unknown counts were excluded. Earlier native/XYZ manifests and the previous OpenMVG repair are preserved.

The [readable scene list](zero-point-scenes-2026-10-20.md) links every audited scene. The [evidence ledger](../data/zero-point-audit.json.gz) retains exact revisions, selections, source hashes and independent export results. The [auxiliary inspection](../data/zero-point-auxiliary-inspection.json.gz) records array shapes and byte-range receipts. Confirmed facts can be reused at unchanged pins and evidence keys without a global source scan.

The earlier viewer **0.19.9** / Hub **0.9.12** deployment is retained in the [production verification receipt](../data/zero-point-live-verification.json.gz). It records all six then-new selections and Berlin loading through their published Hub links, visible geometry, decoded photographs, retained share sources and successful COLMAP downloads. Independent checks matched all 7,382,230 newly selected vertices, calibration/poses, the cloth photographs and Berlin's source observations and three original JPEGs. Reopening the cloth share link retained its four synchronized views and selected vertex frame. That catalog comparison preserved all 5,583 scene identities, previews, masks and splats, with 5,577 launch routes unchanged.

The 28 sibling fixes are now deployed in **Hub 0.9.13** and were rechecked through every published launch using viewer **0.19.9**. The [production sibling receipt](../data/zero-point-sibling-live-verification.json.gz) records all 28 visible imports, retained share sources, actual downloads and independent complete COLMAP reads. Every card count and manifest matched the deployed generation. Hub landing and CSS/ETag revalidation passed.

## Same-scene sibling bindings

The [per-scene binding list](sibling-point-bindings-2026-10-20.md) records 15 BMVS and 13 TwinWorld fixes. Every selection loaded in released viewer 0.19.9, drew its geometry, retained its manifest when shared and exported through the UI. PyCOLMAP read every complete exported model; independent source comparisons checked every XYZ/RGB value, calibration and pose, plus 63 original photographs. All 45 declared masks decoded in the browser. Masks retain their existing unknown semantic role; this pass does not claim feature-mask export.

Fourteen BMVS seed/calibration variants share exactly the cloud model poses. The doll seed has the same camera and image IDs, calibration and poses as its native reconstruction (maximum pose component difference 4.45e-16); its originally empty feature table can therefore use the native observations and 3,006 native landmarks without inventing tracks. TwinWorld explicitly documents a joint train/test reconstruction world, and all 13 test calibrations match their train models. Seven final-test splits intentionally withhold photos; they retain cameras and the scene cloud.

The [sibling inspection receipt](../data/zero-point-sibling-inspection.json.gz) preserves pinned camera/reference files, publisher declaration, numerical associations and full-model export proofs. Unproved sibling paths, nonempty native models, different camera identities and ignored native point transforms are rejected by publication validation.

## Selected temporal geometry

The [47-scene frame list](temporal-frame-selections-2026-10-20.md) records every danceNet3D selection. Twenty complete first regular TAR/Zstandard members add **1,872,683 XYZ/RGB points**; 27 Gaussian ZIP/ZIP64 members add **799,402 Gaussians** as separate render layers. All imported, visibly rendered, shared and exported in viewer 0.19.10. Every complete COLMAP export passed PyCOLMAP; every XYZ/RGB value, calibration and pose matched the source. Gaussian member hashes and GPU-decoded counts matched, using the publisher's exact cloud-only translation (0, 1.5, 1.3).

The [temporal inspection receipt](../data/zero-point-temporal-inspection.json.gz) retains complete selected-member and prefix hashes, publisher LFS archive identities, session frame membership, camera-name matching and numerical world checks. The browser reads a bounded prefix or the ZIP index and selected payload, rather than entire multi-gigabyte sequences. The first TAR member can be frame 0000242, so the Hub names the actual selected frame. Source photographs exist as H.265 recordings; these launches do not infer nonexistent PNGs, decode videos, merge times or attach unrelated archived masks. Source mask and alternate geometry inventories remain intact.

Viewer **0.19.10** and Hub **0.9.14** are deployed. The [production temporal receipt](../data/zero-point-temporal-live-verification.json.gz) records all 47 public launches, visible geometry, actual source byte ranges, retained share settings and UI exports. Independent TAR/ZIP extraction from those browser response bodies matched every complete original member, and PyCOLMAP reread every complete export. Cards, manifests, saved overviews, landing and CSS/ETag checks matched the published generation. All 5,583 scene IDs and the earlier 51 manifests are retained; the other 5,536 launch records remain byte-for-byte equal.

## Previously closed loading gaps

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
| 27 | A checked Gaussian frame now loads with the original cameras and the publisher's world translation. These are Gaussians, so the native sparse-point count correctly stays zero. Other times, video decoding and mask-frame extraction remain separate capabilities. |
| 3 | Mesh geometry exists. Mesh vertices are not reported as sparse reconstruction points. |

These **294 remaining zeros** comprise 262 scoped non-listings, two inspected non-XYZ auxiliary scopes, three mesh-only scenes and 27 loaded Gaussian frames. No static companion or sibling association remains unresolved in this audit. Usable cameras/poses still qualify without photographs or sparse points. Existing masks, splats, previews, original links, other variants and scene identities are retained. Complete timeline/video support is outside the selected-frame launch scope.

## Reproduction

This is the October 20 snapshot. The [October 22 repeat audit](catalog-reaudit-2026-10-22.md) covers all 432 zero-point selections in the later 4,559-scene catalog, including 138 additional WildCity scenes. The default command now combines this historical component inventory with `data/scene-component-additions.json.gz`; repeated `--prior` arguments select other scoped reports explicitly. Independent export and auxiliary confirmations remain separate inputs.

The offline command "python -m scripts.audit.audit_zero_point_scenes" summarizes same-generation packs and pinned component receipts. Optional --exports adds independent recoveries; --confirmations reuses auxiliary inspections only when the evidence key and revision match. Its sourceNetworkReads: 0 describes the summary step, not historical source inspections.

"python -m scripts.audit.verify_companion_scene_exports --scene <scene-id> --browser <browser-results.json> --exports <zip-directory> --cache <url-hash-cache> --output <results.json>" verifies selected scene manifests offline with NumPy, Pillow and PyCOLMAP. It compares large point streams in chunks, camera calibration/poses, retained feature coordinates, synchronized frame selection, source world associations and original photo hashes. Source bytes and browser exports remain local operator receipts; compact evidence is published. OpenSfM sidecars are checked by verify_camera_model_exports and verify_opensfm_tracks.

Source conventions were checked against [OpenSfM pixel normalization](https://github.com/mapillary/OpenSfM/blob/92381be43cd93ca91e7ef903733a0482440028dd/opensfm/features.py), [native track serialization](https://github.com/mapillary/OpenSfM/blob/92381be43cd93ca91e7ef903733a0482440028dd/opensfm/src/map/src/tracks_manager.cc), [Gaussian Surfels camera matrices](https://github.com/turandai/gaussian_surfels/blob/main/scene/dataset_readers.py), and [BMVS evaluation](https://github.com/turandai/gaussian_surfels/blob/main/eval.py).
