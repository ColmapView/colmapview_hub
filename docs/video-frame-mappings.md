# Generic video frame mappings

The viewer's v5 manifest maps each exact registered name to a source video and a
zero-based presentation-frame index, or an explicit source timestamp. Its
[format and cache rules](https://github.com/ColmapView/Colmapview.github.io/blob/main/docs/dataset-manifests.md)
are the runtime contract. Publication evidence is a separate schema in
`data/video-frame-mappings.json`; legacy DanceNet receipts and manifests remain in
`data/video-frame-routing.json.gz` and are not rewritten.
Generic evidence also accepts timestamp-only v4 manifests; its own schema version
does not change the runtime selector contract.

Generic receipts bind model file paths, byte sizes and digests to the exact native
selection. They retain the complete registered-name/calibration inventory, source
video metadata, explicit bindings and independent pixel samples. Every declared
source needs a pixel sample; partial mapping coverage is counted and labeled.
Samples do not certify every frame or complete image export. Video digests from
Hugging Face LFS are publisher declarations, not whole-video download claims.

`mappedImages`, `registeredImages` and `videoSources` have different meanings.
For example, campus_nlp has 285 registered views from six recordings; it is not
285 videos or one synchronized exposure. Its poses retain their own selected
source times. Existing calibration, feature-integrity and export warnings remain
independent of imagery availability. The Worker serves the curated metadata and
manifests; it never downloads or decodes videos.

## Capture type and temporal selection

The catalog's **Video capture** label is reviewed separately from `temporalScope`.
`captureType: synchronized_multiview` identifies a synchronized multi-view capture;
`moving_camera` identifies recordings with camera trajectories, including a single
fly-through or several moving recordings in one reconstruction. Moving cameras can
also be part of a rig; this label alone does not assert synchronization or the
number of physical devices. Missing generic classifications display **Not classified**;
the older DanceNet3D receipt already has a fixed synchronized multi-view contract.
Never infer capture type from video count, file extensions, frame selectors or
COLMAP camera-model count: one calibration can be shared by many moving poses.

The October 25 expansion covers 59 published scenes with video-frame mappings:

| Capture evidence | Scenes | Registered views | Source recordings | Temporal selection |
| --- | ---: | ---: | ---: | --- |
| DanceNet3D synchronized multi-view | 47 | 1,349 | 1,349 | One geometry snapshot; matching frame from each camera |
| MBZUAI Campus moving camera | 12 | 3,923 mapped views | 19 distinct recordings, reused across scenes | One selected source frame per mapped pose; four complete and eight partial scene mappings |

The [Campus audit](campus-video-mappings-2026-10-25.md) distinguishes complete and
partial coverage, repeated source frames and unresolved capture correspondences.
Full recording playback has a separate 256 MiB per-source limit. These Campus
recordings exceed it; their matched still frames remain available
through bounded range reads.

DanceNet3D's [pinned publisher description](https://huggingface.co/datasets/nyuvideolab/danceNet3D/blob/5ecd1b71d0c13b176dbdbe358b940624759d678f/README.md)
documents synchronized cameras. The original NLP classification was checked against all
285 native camera centers in the [pinned poses](https://huggingface.co/datasets/sebothetramp/MBZUAI-Campus/blob/4c18714ad982888d453ec88e2dc335f8dce5928d/reconstructions/scenes/campus_nlp/0/images.bin)
(SHA-256 `eca686d9f4c8eef1087cdfc8b67fcc94450a21b1efa71e2a7d76b0948679a011`).
Each recording has 20–55 distinct registered positions, so six recordings must not
be described as six fixed camera poses or one single video. Synchronization between
these recordings is not established by the frame mapping.
New Campus receipts retain distinct native camera-center counts per mapped source
in `captureEvidence`; calibration count alone never establishes capture type.

This is catalog evidence, not an extra runtime manifest field. The viewer's v4/v5
bindings already support both layouts: multiple videos can supply one snapshot,
and one video can supply many posed views. Individual playback does not animate
camera poses or synchronize recordings. Stills and exports retain their explicit
matched frames. The table covers published video bindings, not every dataset
originally captured on video or every upstream video file.

## Authoring

Run these operator commands from the Hub repository root with the viewer checkout
available at `../colmap-webview` (or set `--viewer-root` explicitly).

`scripts/audit/compile-video-frame-manifest.mjs` compiles a `model` manifest plus
`videos` and `images` tables. Video IDs are an authoring convenience only. The
emitted manifest contains explicit URLs, sizes and selectors for every mapped
registered name. Compilation makes no network requests and cannot certify pixels.

```sh
node scripts/audit/compile-video-frame-manifest.mjs --input mapping.json --output scene.manifest.json --viewer-root ../colmap-webview
```

Still images, metrics, dataset exports and provider uploads use these fixed frame
selections. Individual playback starts there, and seeking keeps saved images
unchanged. Source recordings stay at their original host. Sources over the 256 MiB
playback limit can still supply ranged matched frames; the viewer disables Video
and explains the limit.

The MBZUAI operator adapter reads the pinned native model and video indices:

```sh
node scripts/audit/prepare-mbzuai-video-frames.mjs --model reconstructions/scenes/campus_knowledge_center/0 --viewer-root ../colmap-webview --cache .tmp/mbzuai-video-cache --scratch .tmp/knowledge-center
```

It streams and hashes the complete native files, retaining only compact pose
headers and calibration. Large observations, point payloads and full videos are
not cached. Interrupted native reads resume at the exact consumed offset; complete
SHA-256 and Git/LFS identities still have to match.

The adapter reproduces the publisher's two-fps resampling, the counter continuing
across sorted camera folders within each capture, and native filename templates.
The video track's EOF also limits the extraction count: longer audio must not add
an image and shift later camera numbers. Source frame zero must not be inferred from JPEG
number zero. Native FFmpeg independently applies the fps filter to bounded,
source-time-restored keyframe groups for first/middle/last registered samples in
each source. Only source-wide reviewed capture recipes are eligible: the current
script contradicts several archived models, and a small subset fitting its numeric
range is insufficient. Capture-folder aliases and conflicting filename suffixes
are not guessed. `--allow-partial` retains independently verified captures while
counting every unmapped native name. Failed preparations remove earlier drafts.
`--metadata-only` prepares a draft
without independent references and cannot qualify catalog activation.

Browser checks compare software-decoded samples against those references at native
camera dimensions with `createImageBitmap(..., { colorSpaceConversion: 'none' })`.
This compares decoded RGBA values, independent of FFmpeg PNG display-profile
differences and hardware chroma interpolation. Record the decode path, comparison
method, PNG hashes and maximum/mean channel differences; the current
acceptance limits are 3 and 0.75 respectively. Source selectors must still pass
name, calibration, range-size and duration checks. Record only public evidence,
never local reference paths, credentials, browser sessions or private URLs.

Save the complete passing result as `video-pixels.json` beside `prepared.json`,
including its exact `viewerCommit`, `checkedAt`, `total`, and all `samples`, then:

```sh
python -m scripts.audit.record_video_frame_mapping --viewer-root ../colmap-webview --scratch .tmp/knowledge-center
```

The recorder requires a committed viewer runtime and verifies the exact reference
sample set before updating the mapping and the reusable photo decision together.

Before activating a policy, commit and record the exact checked viewer runtime,
run the viewer/Hub checks and manifest compatibility checks, then deploy the viewer
supporting v5 before releasing the new Hub links. Clean builds reproduce both the
base model asset and the new content-addressed video manifest. Existing immutable
assets remain available.
