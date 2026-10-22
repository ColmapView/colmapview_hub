# Scene previews and WildCity points — October 22, 2026

Hub 0.10.8 prepares 496 missing previews from previously checked photographs: 138 WildCity, 348 AstroVision, seven NL3D and three nerf-gs-datasets scenes. These are all published scenes with an eligible checked loose-photo sample and no preview at the 0.10.7 baseline. The three withheld AstroVision native-decoder failures are excluded. Scenes without a qualified photograph keep their scoped photo-availability labels.

The [machine-readable audit](../data/scene-preview-points-audit-2026-10-22.json.gz) retains each photograph URL, revision, source SHA-256 and generated JPEG identity. New previews are 320 × 320 center crops under 64 KiB, with original EXIF removed. Prepared assets are served from the Hub; catalog browsing makes no image-provider requests. A thumbnail establishes a decoded sample, while complete photograph and export coverage remains separate.

## WildCity geometry

The complete pinned inventory at `6d1be815f55fa4ac900e464b53510cc282b05c29` contains 356,296 paths. All 400 original `cameras.txt` and `images.txt` bodies match their Git blob IDs and were parsed completely using viewer 0.20.4's native text parsers. Every one of the 200 scenes has 50 camera definitions and 50 poses, with no triangulated point references. All 10,000 registered photograph paths occur in that inventory.

No native `points3D` file, auxiliary static cloud, Gaussian cloud, mesh, numeric geometry container or geometry archive is supplied in this pinned repository. Each scene does supply 50 `depth.exr` depth maps and 50 `mask.png` sky masks. The Hub lists the masks and records depth availability; it preserves the original zero-point count. No geometry is synthesized from depth, and the masks receive no new COLMAP feature-mask or automatic loading qualification. Original calibrations, poses, source selections and immutable manifests remain unchanged.

For `wildcity/Scene91/colmap`, this means 50 camera poses, zero supplied points and a preview from its checked `Cam_000/light_000.png`. Its photograph is 512 × 512 and its new preview is 320 × 320.

## WildCity image credits

The pinned `README.md`, `scene_city_mapping.csv` and `license.csv` all match their original Git blob IDs. The publisher maps all 200 scenes to nine cities and lists 139 source models and their authors. Its README declares CC BY 4.0, CC BY-NC 4.0 or CC BY-SA 4.0 per city; the model-credit CSV retains the individual component terms, including CC0 assets.

All 200 WildCity previews, including the 62 existing previews, now carry the relevant city's declared image terms, a Creative Commons terms link, the dataset credit and its asset-author names. The collection-wide `other` license tag and `Not specified` aggregate category retain their existing scope; image terms are recorded separately. For Scene91's city4, the declared image terms are CC BY 4.0. The audit preserves the complete publisher credits and source hashes.
