# Same-scene sibling point bindings, 2026-10-20

This batch closes 28 zero-point launches using 4,993,021 existing source points. Each launch was tested in released viewer 0.19.9, rendered, shared and exported through the browser. Complete exports passed PyCOLMAP and independent source comparisons. All 63 exported original photos kept their bytes; 45 masks decoded and retained their existing unknown role. No depth files were used.

Sources stay pinned in [scene-manifests.json](../data/scene-manifests.json); the compact [inspection ledger](../data/zero-point-sibling-inspection.json.gz) records each association. Seven TwinWorld final-test splits have no public photographs, as documented by their publisher.

| Scene / model | Points | Photos | Masks | Association |
| --- | ---: | ---: | ---: | --- |
| [Wuuu3511/bmvs_sparse_dtu2 / large_overlap/basketball/dense/colmap_workspace/sparse_seed](https://colmapview.opsiclear.com/hub/datasets/open/data-62e132c2f7617c37913a0b05) | 350,710 | 3 | 3 | All source poses match exactly; untracked XYZ |
| [Wuuu3511/bmvs_sparse_dtu2 / large_overlap/basketball/dense/sparse_calibrated](https://colmapview.opsiclear.com/hub/datasets/open/data-27517eeb8f75afa392061c68) | 350,710 | 3 | 3 | All source poses match exactly; untracked XYZ |
| [Wuuu3511/bmvs_sparse_dtu2 / large_overlap/bear/dense/colmap_workspace/sparse_seed](https://colmapview.opsiclear.com/hub/datasets/open/data-a5566bf470510dd671a288b8) | 340,440 | 3 | 3 | All source poses match exactly; untracked XYZ |
| [Wuuu3511/bmvs_sparse_dtu2 / large_overlap/bear/dense/sparse_calibrated](https://colmapview.opsiclear.com/hub/datasets/open/data-755d27d418ac7f6883d94788) | 340,440 | 3 | 3 | All source poses match exactly; untracked XYZ |
| [Wuuu3511/bmvs_sparse_dtu2 / large_overlap/bread/dense/colmap_workspace/sparse_seed](https://colmapview.opsiclear.com/hub/datasets/open/data-3f96d2d3beee25e0bbfd53c9) | 326,806 | 3 | 3 | All source poses match exactly; untracked XYZ |
| [Wuuu3511/bmvs_sparse_dtu2 / large_overlap/bread/dense/sparse_calibrated](https://colmapview.opsiclear.com/hub/datasets/open/data-94182469eff91112b82a45e7) | 326,806 | 3 | 3 | All source poses match exactly; untracked XYZ |
| [Wuuu3511/bmvs_sparse_dtu2 / large_overlap/camera/dense/colmap_workspace/sparse_seed](https://colmapview.opsiclear.com/hub/datasets/open/data-b93f75d0a07dd8b1a4f73987) | 359,250 | 3 | 3 | All source poses match exactly; untracked XYZ |
| [Wuuu3511/bmvs_sparse_dtu2 / large_overlap/camera/dense/sparse_calibrated](https://colmapview.opsiclear.com/hub/datasets/open/data-15fffe6e9efcbf8d5073efcd) | 359,250 | 3 | 3 | All source poses match exactly; untracked XYZ |
| [Wuuu3511/bmvs_sparse_dtu2 / large_overlap/clock/dense/colmap_workspace/sparse_seed](https://colmapview.opsiclear.com/hub/datasets/open/data-db762a235852d78bdb7888bc) | 220,844 | 3 | 3 | All source poses match exactly; untracked XYZ |
| [Wuuu3511/bmvs_sparse_dtu2 / large_overlap/clock/dense/sparse_calibrated](https://colmapview.opsiclear.com/hub/datasets/open/data-a29001c258975880cbc4b680) | 220,844 | 3 | 3 | All source poses match exactly; untracked XYZ |
| [Wuuu3511/bmvs_sparse_dtu2 / large_overlap/cow/dense/colmap_workspace/sparse_seed](https://colmapview.opsiclear.com/hub/datasets/open/data-e85d555331ebbd39c80e8972) | 303,922 | 3 | 3 | All source poses match exactly; untracked XYZ |
| [Wuuu3511/bmvs_sparse_dtu2 / large_overlap/cow/dense/sparse_calibrated](https://colmapview.opsiclear.com/hub/datasets/open/data-a5e66a55087ae8e47e23ae33) | 303,922 | 3 | 3 | All source poses match exactly; untracked XYZ |
| [Wuuu3511/bmvs_sparse_dtu2 / large_overlap/dog/dense/colmap_workspace/sparse_seed](https://colmapview.opsiclear.com/hub/datasets/open/data-0a32005d7839cb40c9b6a481) | 399,842 | 3 | 3 | All source poses match exactly; untracked XYZ |
| [Wuuu3511/bmvs_sparse_dtu2 / large_overlap/dog/dense/sparse_calibrated](https://colmapview.opsiclear.com/hub/datasets/open/data-1a563d3a51aae91c0dfd2a28) | 399,842 | 3 | 3 | All source poses match exactly; untracked XYZ |
| [Zqlin/TwinWorld_Datasets / Data_Goldcoast/scene_009/test/sparse/0](https://colmapview.opsiclear.com/hub/datasets/open/data-02fd82ee6918facd73ae7d7b) | 28,530 | 3 | 0 | Publisher joint train/test world; identical calibration |
| [Zqlin/TwinWorld_Datasets / Data_Goldcoast/scene_010/test/sparse/0](https://colmapview.opsiclear.com/hub/datasets/open/data-403f39c6246435b022b7d851) | 29,122 | 3 | 0 | Publisher joint train/test world; identical calibration |
| [Zqlin/TwinWorld_Datasets / Data_Goldcoast/scene_011/test/sparse/0](https://colmapview.opsiclear.com/hub/datasets/open/data-3cd6f98a8d36118b7c6e9498) | 32,328 | 0 | 0 | Publisher joint train/test world; identical calibration |
| [Zqlin/TwinWorld_Datasets / Data_Goldcoast/scene_012/test/sparse/0](https://colmapview.opsiclear.com/hub/datasets/open/data-377e0a542ea2403670222d81) | 15,883 | 0 | 0 | Publisher joint train/test world; identical calibration |
| [Zqlin/TwinWorld_Datasets / Data_TUM/scene_000/test/sparse/0](https://colmapview.opsiclear.com/hub/datasets/open/data-e81e7563dd42632ac258fb4e) | 27,949 | 3 | 0 | Publisher joint train/test world; identical calibration |
| [Zqlin/TwinWorld_Datasets / Data_TUM/scene_001/test/sparse/0](https://colmapview.opsiclear.com/hub/datasets/open/data-f4950a28235651b9faf72ac8) | 17,925 | 3 | 0 | Publisher joint train/test world; identical calibration |
| [Zqlin/TwinWorld_Datasets / Data_TUM/scene_002/test/sparse/0](https://colmapview.opsiclear.com/hub/datasets/open/data-bbe61c620f78d116c237ea28) | 44,849 | 3 | 0 | Publisher joint train/test world; identical calibration |
| [Zqlin/TwinWorld_Datasets / Data_TUM/scene_003/test/sparse/0](https://colmapview.opsiclear.com/hub/datasets/open/data-c9c9f644e066bc3c2e201a4b) | 35,806 | 3 | 0 | Publisher joint train/test world; identical calibration |
| [Zqlin/TwinWorld_Datasets / Data_TUM/scene_004/test/sparse/0](https://colmapview.opsiclear.com/hub/datasets/open/data-dd1fc3913ce256b5c5063f13) | 27,066 | 0 | 0 | Publisher joint train/test world; identical calibration |
| [Zqlin/TwinWorld_Datasets / Data_TUM/scene_005/test/sparse/0](https://colmapview.opsiclear.com/hub/datasets/open/data-0e170fad789f490bb38c0d20) | 42,979 | 0 | 0 | Publisher joint train/test world; identical calibration |
| [Zqlin/TwinWorld_Datasets / Data_TUM/scene_006/test/sparse/0](https://colmapview.opsiclear.com/hub/datasets/open/data-c4b9e1f77a89ce6e2b7d4004) | 21,107 | 0 | 0 | Publisher joint train/test world; identical calibration |
| [Zqlin/TwinWorld_Datasets / Data_TUM/scene_007/test/sparse/0](https://colmapview.opsiclear.com/hub/datasets/open/data-a210bdde101a45494b789f2b) | 23,323 | 0 | 0 | Publisher joint train/test world; identical calibration |
| [Zqlin/TwinWorld_Datasets / Data_TUM/scene_008/test/sparse/0](https://colmapview.opsiclear.com/hub/datasets/open/data-eea2a9fb97bbf2fe6e9c6ace) | 39,520 | 0 | 0 | Publisher joint train/test world; identical calibration |
| [Wuuu3511/bmvs_sparse_dtu2 / large_overlap/doll/dense/colmap_workspace/sparse_seed](https://colmapview.opsiclear.com/hub/datasets/open/data-1ace528de1ed12b923db4910) | 3,006 | 3 | 3 | Identical cameras, poses and IDs; preserve native tracks |

TwinWorld association: [pinned publisher documentation](https://huggingface.co/datasets/Zqlin/TwinWorld_Datasets/blob/8d5dfff84ca57f985f27b7ffaf38203e7297cc2e/README.md). Original target camera/pose receipts remain separate from the selected cloud or native-observation source. PLY bindings create no synthetic landmark observations.

Remaining temporal work: 20 DanceNet3D TAR/Zstandard point sequences and 47 Gaussian ZIP sequences require explicit frame selection; splats require the publisher-declared translation into the camera world. Their static sparse point count is still zero.
