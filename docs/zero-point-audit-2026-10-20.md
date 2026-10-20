# Zero-point scenes, 2026-10-20

The audit covered all **357 effective zero-point scenes in 45 collections** in catalog generation `8aed9dd7761e4e91fc6b77a72809fbef47c74f38369231e9eb651470ecffcd8c`. Unknown counts were excluded. Sixteen other originally empty COLMAP models already use checked XYZ manifests; their selected point counts are nonzero and they were not failures in this pass. The previous OpenMVG repair is also retained.

The [complete per-scene ledger](../data/zero-point-audit.json.gz) records exact revisions, selected files, inventory receipts, checked scopes, source hashes and independent export results. It distinguishes source geometry from geometry selected by the current launch link. Confirmed results can be reused while their evidence keys and source bytes match; unresolved bindings and auxiliary containers remain explicit follow-ups.

## Recovered geometry

| Collection / scene | Points | Correction |
| --- | ---: | --- |
| OpenSfM Berlin | 1,430 | Import embedded `points` XYZ/RGB. Fix the native worker's rejection of null buffers for empty tracks. |
| HaoqinHong/Physics-Informed-Deformable-Gaussian-Splatting — dry_ice | 100,000 | Refresh the old export receipt; the current loader selects `points3d.ply`. |
| jayinnn/Skyfall-GS-datasets — JAX_004 | 35,355 | Refresh the receipt for `points3D.ply`. |
| pkupig/dadr_splatting-dataset | 100,000 | Refresh the receipt for `points3d.ply`. |
| SimeonOA/GrowSplat-Dataset — quinoa/20221031 | 16,315 | Follow the declared `ply_file_path`. |
| uild42/gate-gsplat-assets — left_scene/mocap_processed | 28,634 | Follow the declared `sparse_pc.ply`. |
| yaguchi27/EV_hw1_nerf_synthetic — lego | 100,000 | Refresh the receipt for `points3d.ply`. |
| MikolajZ/eks_data — data/mic | 786,432 | Refresh the receipt for `sparse_pc.ply`. |
| MikolajZ/eks_demo_data — data/ficus | 786,432 | Refresh the receipt for `sparse_pc.ply`. |

All nine model exports passed independent PyCOLMAP comparisons: **1,954,598 points**, original camera calibration and poses, and source XYZ/RGB. Embedded OpenSfM coordinates retain the existing viewer's float32 export precision. The selected JSON/PLY files contain no feature observations; none were fabricated. Berlin also lists `tracks_example.csv` at this pin (204,020 bytes, Git blob `04f8ffbc9e4a6d855bb1cec2228500ad0599b630`); that optional observation sidecar is not imported by the JSON loader. This is a remaining feature gap, not missing source data. Photograph evidence remains separate from model export evidence.

The Berlin cloud and all three photographs were also rendered, and the three original JPEG byte hashes survived export unchanged. The existing reset view frames camera centers, so geometry ahead of a tight camera cluster can initially fall outside the viewport; zooming out reveals it. This is a framing limitation, separate from a zero model count. Empty observation tracks also require a zero track threshold; imported OpenSfM geometry now sets that initial threshold explicitly.

## Remaining zero counts

| Scenes | Finding | Meaning |
| ---: | --- | --- |
| 262 | No point source listed in the checked scene scope | Complete pinned scope inventory checked. This does not establish global absence elsewhere in the collection. |
| 28 | Another reconstruction contains geometry | Fifteen BMVS seed/calibration models and thirteen TwinWorld test models remain separate from other reconstruction/training variants. Their selected point counts are correctly zero. |
| 47 | danceNet3D geometry sequences in separate archives | Static COLMAP cameras, time-indexed splats and point-cloud archives are distinct. Frame selection and alignment require their own support. |
| 5 | Static cloud needs an explicit binding | Three Poison-3DGS models omit their same-folder `points3D.ply` from their photo-prefix launch manifests. ALC901 has a nested `3dgs_output/input.ply`; BMVS surfels has `cow/gt_pts.ply` beside DTU matrices. File existence is confirmed; camera-world association/export for these selections is not. |
| 3 | Mesh available | ExtremeOcc-3D, AniGen and the anonymous ACMMM Lego example contain meshes. Mesh vertex counts are not published as sparse point counts. |
| 3 | Auxiliary container review | Cloth trajectory NPZ, HDR-NSFF flow NPY/NPZ and DTU camera NPZ are not loose static clouds. Their uninspected auxiliary payloads prevent an absolute absence claim. |

The five unbound static clouds are recorded as loading gaps, not as missing source data. Preserve the existing image prefix when adding a cloud selection. The nested Nerfstudio cloud and DTU ground-truth cloud also require explicit frame/scale checks; filename proximity alone is insufficient.

## Reproducing the offline audit

`python -m scripts.audit.audit_zero_point_scenes` audits current generated packs against the pinned component ledger without network requests. For this dated snapshot, `--index`, `--rows` and `--exports` selected the same-generation baseline and the nine independently verified browser exports. Every baseline zero scene has a finding; repeated complete source audits are unnecessary when the confirmed evidence has not changed.
