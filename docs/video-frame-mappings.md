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
node scripts/audit/prepare-mbzuai-video-frames.mjs --viewer-root ../colmap-webview --scratch .tmp/mbzuai-video-frames-20261024
```

It reproduces the publisher's two-fps resampling, per-camera global counters and
the native filename template. Source frame zero must not be inferred from JPEG
number zero. Native FFmpeg independently applies the fps filter to bounded,
source-time-restored keyframe groups for first/middle/last registered samples in
each source. Full source videos are not cached. `--metadata-only` prepares a draft
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
python -m scripts.audit.record_video_frame_mapping --viewer-root ../colmap-webview --scratch .tmp/mbzuai-video-frames-20261024
```

The recorder requires a committed viewer runtime and verifies the exact reference
sample set before updating the mapping and the reusable photo decision together.

Before activating a policy, commit and record the exact checked viewer runtime,
run the viewer/Hub checks and manifest compatibility checks, then deploy the viewer
supporting v5 before releasing the new Hub links. Clean builds reproduce both the
base model asset and the new content-addressed video manifest. Existing immutable
assets remain available.
