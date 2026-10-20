# Selected temporal frames, 2026-10-20

All 47 camera scenes at the pinned [danceNet3D revision](https://huggingface.co/datasets/nyuvideolab/danceNet3D/tree/5ecd1b71d0c13b176dbdbe358b940624759d678f) have a checked static preview. Twenty select complete first regular TAR/Zstandard point members (1,872,683 XYZ/RGB points); the other 27 select one original Gaussian ZIP member (799,402 Gaussians). Each selection passed local browser import, visible rendering, sharing, actual COLMAP download and complete independent PyCOLMAP reads. Publication/live checks are recorded separately.

Cameras, IDs, calibration and poses are unchanged. Every exported XYZ/RGB value matches its original PLY. Visibility lists do not become COLMAP observations. Gaussian models use the publisher equation COLMAP position = released position + (0, 1.5, 1.3), applied only to the Gaussian layer; their sparse-point count stays zero. A projection sanity check reports every camera and permits outlier Gaussians outside individual views (ToeTaps worst-view fraction 0.504, median 0.915); the source declaration establishes the world alignment.

Each chosen frame belongs to its session manifest, and every registered camera name matches the sequence camera list. The TAR choice is the first regular member in archive order, which can be frame 0000242 rather than the earliest chronological frame. Selected members are complete and SHA-256 checked. Prefix reads use 4–8 MiB; ZIP/ZIP64 reads cover the index and selected payload. Whole-archive hashes are publisher LFS declarations, not claims that multi-gigabyte sequences were downloaded.

The sources provide H.265 recordings rather than loose registered photographs. These launches disable photo inference, retain camera models and selected geometry, and leave video decoding, playback, later TAR frames and mask-frame association outside the supported scope. Masks and other Gaussian/point sequences remain recorded as source assets. No additional video codec or depth support was added.

The [inspection receipt](../data/zero-point-temporal-inspection.json.gz) retains pinned camera/session/README hashes, archive/member/prefix receipts and source/export comparisons. The [per-scene policy](../data/scene-manifests.json) binds exact selections and saved views to viewer 0.19.10. Confirmed pinned source facts can be reused while their selection/evidence hashes match; live delivery is checked separately.

| Named motion scene | Selected frame | Camera poses | XYZ points | Gaussians |
| --- | --- | ---: | ---: | ---: |
| [s4/3PointStep](https://colmapview.opsiclear.com/hub/datasets/open/data-b41ab2a34430b23d25428e3c) | 0000001 | 29 | 0 | 18,280 |
| [s4/BartSimpson](https://colmapview.opsiclear.com/hub/datasets/open/data-fcc991de25ac4227dcba86a0) | 0000001 | 29 | 0 | 19,630 |
| [s4/BizMarkie](https://colmapview.opsiclear.com/hub/datasets/open/data-e459f56a50132184083b480e) | 0000001 | 29 | 0 | 17,802 |
| [s4/HouseFootwork](https://colmapview.opsiclear.com/hub/datasets/open/data-ebc089e808b20c73bbbfa268) | 0000242 | 29 | 62,455 | 0 |
| [s4/HouseFootworkAdvanced](https://colmapview.opsiclear.com/hub/datasets/open/data-946cb86e7239a1326d4d69a5) | 0000001 | 29 | 0 | 19,345 |
| [s4/RoboCop](https://colmapview.opsiclear.com/hub/datasets/open/data-09270003aae7613a59e0012e) | 0000001 | 29 | 0 | 20,515 |
| [s4/RunningMan](https://colmapview.opsiclear.com/hub/datasets/open/data-3f4ea10c23177e52d5d3eebe) | 0000001 | 29 | 0 | 21,030 |
| [s4/TheRooftop](https://colmapview.opsiclear.com/hub/datasets/open/data-7e05161666e90ef42adc5365) | 0000001 | 29 | 0 | 22,794 |
| [s4/ToeTaps](https://colmapview.opsiclear.com/hub/datasets/open/data-70fd5029af4aa2c5f21b5d1a) | 0000001 | 29 | 0 | 14,605 |
| [s4/WuTang](https://colmapview.opsiclear.com/hub/datasets/open/data-4e9110f9b55037af1fd01ed8) | 0000001 | 29 | 0 | 24,746 |
| [s5/AttitudePromenade](https://colmapview.opsiclear.com/hub/datasets/open/data-426796cd7b4bfc85275919cf) | 0000001 | 29 | 0 | 62,263 |
| [s5/BasicSuzieQ](https://colmapview.opsiclear.com/hub/datasets/open/data-a0b816ed7ed2c09a395445bb) | 0000001 | 29 | 0 | 26,110 |
| [s5/BigKicks](https://colmapview.opsiclear.com/hub/datasets/open/data-79c1324121bf7c7e99377c6f) | 0000001 | 29 | 0 | 64,584 |
| [s5/BourreeTurns](https://colmapview.opsiclear.com/hub/datasets/open/data-381ee1543ef9754acfb284ed) | 0000242 | 29 | 94,498 | 0 |
| [s5/BourreeTurns2](https://colmapview.opsiclear.com/hub/datasets/open/data-a825a8330cf4781a9f95673c) | 0000001 | 29 | 0 | 28,441 |
| [s5/Chacha](https://colmapview.opsiclear.com/hub/datasets/open/data-8518ab16a7871af4e2205be0) | 0000001 | 29 | 0 | 23,985 |
| [s5/ComboSeated](https://colmapview.opsiclear.com/hub/datasets/open/data-f76c61950fb4c21f6a6b3eb7) | 0000001 | 29 | 90,523 | 0 |
| [s5/DoubleSpiral](https://colmapview.opsiclear.com/hub/datasets/open/data-cb8c4407e8eaa6e3c700edb3) | 0000001 | 29 | 0 | 25,398 |
| [s5/Flair](https://colmapview.opsiclear.com/hub/datasets/open/data-374473095d879223fe39a504) | 0000001 | 29 | 0 | 23,608 |
| [s5/Jumping](https://colmapview.opsiclear.com/hub/datasets/open/data-bbd77fe34ce2d2eaa34e3c6a) | 0000001 | 29 | 0 | 30,426 |
| [s5/Pirouettes](https://colmapview.opsiclear.com/hub/datasets/open/data-58d70c4d569087094efe49da) | 0000001 | 29 | 0 | 26,149 |
| [s5/Portdebras](https://colmapview.opsiclear.com/hub/datasets/open/data-c8e8d872eddc307fefc4678b) | 0000001 | 29 | 0 | 16,756 |
| [s5/PortdebrasSeated](https://colmapview.opsiclear.com/hub/datasets/open/data-98bfa26a3e6e33aa5fd08025) | 0000001 | 29 | 93,629 | 0 |
| [s5/RonDeJambeAtere](https://colmapview.opsiclear.com/hub/datasets/open/data-481e36ea529385884986725b) | 0000242 | 29 | 116,840 | 0 |
| [s5/RonDeJambeAtere2](https://colmapview.opsiclear.com/hub/datasets/open/data-3aa9d4f5a6c4373e8314329a) | 0000001 | 29 | 0 | 28,065 |
| [s5/RonDeJambeInAir](https://colmapview.opsiclear.com/hub/datasets/open/data-8d232566ce568b891b273a33) | 0000242 | 29 | 104,398 | 0 |
| [s5/SalsaTurns](https://colmapview.opsiclear.com/hub/datasets/open/data-6d6b5268fe321fcec524d1af) | 0000242 | 29 | 85,820 | 0 |
| [s5/Shoulders](https://colmapview.opsiclear.com/hub/datasets/open/data-67a158e8d2da4ac17f61bfac) | 0000242 | 29 | 82,277 | 0 |
| [s5/ShouldersSeated](https://colmapview.opsiclear.com/hub/datasets/open/data-ff11836c542109b795dc7c2a) | 0000001 | 29 | 87,514 | 0 |
| [s5/SonBasic](https://colmapview.opsiclear.com/hub/datasets/open/data-391222458c54dfef906fe3c9) | 0000001 | 29 | 0 | 24,810 |
| [s5/SonBasicSeated](https://colmapview.opsiclear.com/hub/datasets/open/data-29099a5cc0b30c207d048df4) | 0000001 | 29 | 87,450 | 0 |
| [s5/Turns](https://colmapview.opsiclear.com/hub/datasets/open/data-1248a3bfefd5e565a7dc39c5) | 0000242 | 29 | 84,988 | 0 |
| [s5/Twists](https://colmapview.opsiclear.com/hub/datasets/open/data-c408cffed23d17f99985b083) | 0000242 | 29 | 80,041 | 0 |
| [s6/BiancaGolden_Breathing](https://colmapview.opsiclear.com/hub/datasets/open/data-ec5c4e2f45ce178fdb9aeaf2) | 0000001 | 28 | 0 | 31,903 |
| [s6/BiancaGolden_Chimee](https://colmapview.opsiclear.com/hub/datasets/open/data-e100fa8d3285c0656b691fe9) | 0000001 | 28 | 0 | 23,954 |
| [s6/BiancaGolden_CircleTurns](https://colmapview.opsiclear.com/hub/datasets/open/data-7c9df9c037a0f555d9c817ab) | 0000001 | 28 | 0 | 45,170 |
| [s6/BiancaGolden_DropTurn](https://colmapview.opsiclear.com/hub/datasets/open/data-92781a1b85a9d67cd728e6c3) | 0000242 | 28 | 88,117 | 0 |
| [s6/BiancaGolden_GrandPlies](https://colmapview.opsiclear.com/hub/datasets/open/data-689d89596d92765a6fe34ee6) | 0000001 | 28 | 0 | 33,367 |
| [s6/BiancaGolden_Ocho](https://colmapview.opsiclear.com/hub/datasets/open/data-7ab128e89d676305e079e729) | 0000242 | 28 | 99,649 | 0 |
| [s6/BiancaGolden_Portedbras](https://colmapview.opsiclear.com/hub/datasets/open/data-ee5c0babffcc717dc45efd7a) | 0000242 | 28 | 100,150 | 0 |
| [s6/BiancaGolden_ReleasetoFloor](https://colmapview.opsiclear.com/hub/datasets/open/data-618551ab9ed12a4638387be8) | 0000242 | 28 | 123,779 | 0 |
| [s6/BiancaGolden_RollDown](https://colmapview.opsiclear.com/hub/datasets/open/data-a437d5e1978a657545ed2fc4) | 0000242 | 28 | 94,127 | 0 |
| [s6/BiancaGolden_SalsaBasic](https://colmapview.opsiclear.com/hub/datasets/open/data-bc1344eaf826b6bec4e0d1c5) | 0000001 | 28 | 0 | 27,298 |
| [s6/BiancaGolden_StyleArms](https://colmapview.opsiclear.com/hub/datasets/open/data-516602b0e33fc582b8141136) | 0000242 | 28 | 87,241 | 0 |
| [s6/BiancaGolden_Swings](https://colmapview.opsiclear.com/hub/datasets/open/data-73286b712cc2d3655ffbf7c6) | 0000242 | 28 | 110,509 | 0 |
| [s6/BiancaGolden_SyncopatedGroove](https://colmapview.opsiclear.com/hub/datasets/open/data-f3bc0d8859f1d1c1aa20af0d) | 0000242 | 28 | 98,678 | 0 |
| [s6/RobertRubama_RussiaCostume](https://colmapview.opsiclear.com/hub/datasets/open/data-f2fb02d49ef81b679d771cd7) | 0000001 | 28 | 0 | 78,368 |

Reproduce the offline export checks with `python -m scripts.audit.verify_temporal_scene_exports --root <prepared-receipt-directory> --phase browser` (NumPy, plyfile and PyCOLMAP). The prepared directory contains original member payloads, URL-hash metadata cache, candidate reviews, browser receipts and UI-downloaded ZIPs. It performs no network reads.
