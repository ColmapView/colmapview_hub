# Photo loading decisions retained on October 19

The catalog has 5,576 named scenes. The revision-bound log retains 5,544 confirmed
findings and leaves 32 photo associations unresolved. Reuse the confirmed facts
at their recorded scope; a named sample does not qualify every image or an export.

Run `npm run catalog:photo-plan -- --output .tmp/photo-work.json` before new
source reads. The command uses local records only and rejects incomplete catalog
builds. A revision or selected-file change queues a new check. Changes to loader
logic should first use the retained source bytes for offline regression checks.

| Confirmed case | Result and remaining scope |
| --- | --- |
| 478 MegaUnScene scenes | Version 2 manifests attach each scene's own ZIP. Exact sample names, dimensions and browser range receipts are retained. Members load lazily. |
| 38 Fastmap scenes | Version 2 manifests strip the capture prefix and mount the scene's own TAR photographs. Another 21 samples have confirmed calibration mismatches and keep their camera/model launch. |
| Dynamic Maps intersection sample | The text parser preserves 896 poses despite omitted empty observation rows. The manifest binds all 896 names under sibling `images/`, including three names also duplicated under `assets/`. The original-photo folder is selected explicitly. One photograph was decoded; complete photo export remains separate. |
| ALC901 DL3DV example | The documented `images_8` layout resolves all 319 paths. Pixel intrinsics scale by 1/8; poses and distortion stay unchanged. PyCOLMAP 4.0.3 independently checked every resulting calibration and pose. One source photo decoded in Chromium; the export qualification remains model-only. |
| Seven TwinWorld test models | All 21 registered test names are absent from the complete pinned photograph inventory. Repeating basename searches cannot supply them. |
| 83 recording-based scenes | The pinned sources contain videos/VRS recordings, without loose source raster photographs. Frames require extraction and camera/frame association. |
| 78 publisher omissions | Original input photos are excluded by the recorded publisher evidence. Camera/model loading remains supported. |
| 189 native photo/calibration samples | The sampled photograph exists but does not match the selected calibration dimensions. A verified resize, crop or undistortion policy is required. Do not guess intrinsics or repeat the same sample. |

The 32 unresolved associations are 16 blur-slam-bpn models, 12
DyNativeGaussian_sequence models, Plant3D `plant_001`, RGBT `RotaryKiln`, and one
PRISM3D snapshot in each of the qizhangslam and slam-e2e repositories. Similar
basenames, rendered outputs and alternate camera models do not establish a
correct original-photo association. The existing camera/model links remain.

The reusable records are in
[`photo-audit-decisions.json.gz`](../data/photo-audit-decisions.json.gz).
Representative runtime receipts are in
[`photo-loader-checks.json`](../data/photo-loader-checks.json). Real Chromium
checks loaded ZIP and TAR scenes with gallery photos, Dynamic Maps with 896
poses, and the 319-pose Nerfstudio scene. The archive check caught and fixed a
fetch-lifetime bug: lazy photo requests must outlive the initial model-load
claim. Cancellation, reset and replacement still close the owned reader.

Offline publication checks covered all 5,576 launch gates and summaries and all
2,018 active manifests. All 1,501 previous manifest URLs, 1,246 previous photo
routing receipts and 2,266 previous previews remain intact. Existing complete
photo/export qualifications are preserved. No source network reads were needed
for those regression checks.

The streaming statistics audit now also preserves consecutive camera-only
headers. An offline replay read 232 complete cached pose files (7.65 GB),
validated their original hashes and preserved every prior count. The separate
Dynamic Maps file returns 896. These receipts are retained in
[`native-count-replay.json.gz`](../data/native-count-replay.json.gz); the source
files were not fetched again.

Viewer 0.19.2 and Hub 0.8.3 are published. The release CI passed 317 viewer
browser cases and 48 Hub browser cases. Live checks confirmed the catalog
generation, 5,544 reusable decisions, 32 unresolved associations, manifest
hashes/CORS/ETags, scene detail links and redirects, and the 320x234 full-frame
preview. The [publication receipt](../data/photo-release-verification-2026-10-19.json)
records the deployed commits and Worker version. These confirmed publication
checks do not need another run for the same deployed artifacts.
