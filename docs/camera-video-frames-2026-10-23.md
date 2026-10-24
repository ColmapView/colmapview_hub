# Camera video frames, 2026-10-23

Viewer 0.21.1 adds version 4 manifests with exact registered-name → video URL,
byte length and presentation timestamp bindings. The 47 pinned danceNet3D scene
launches now bind 1,349 camera videos to the same static times as their existing
selected geometry. Scene identities, model files, calibration, poses, geometry,
saved views, licenses and old immutable manifests are retained. The catalog stays
at 4,559 named scenes across 144 sources. No new Hub thumbnails are generated.

The timestamp comes from the selected frame's position in the publisher's ordered
`frame_ids`, using its declared 1 fps encoding. It is not the numeric frame ID
minus one: BiancaGolden_Ocho frame `0000242` is sample 240 because a source frame
was dropped. Every registered name matches the native pose file, publisher camera
list and complete pinned video listing. Camera dimensions come from the unchanged
native calibration, including sequences whose session metadata omits dimensions.

Individual playback uses the pinned README's declared 30 fps capture rate through
`playbackRate: 30`. The viewer retimes a local copy of the encoded packets before
playback; it never changes the source timestamp used for stills or geometry.
This requires the camera-playback viewer update; deploy it before these new Hub
manifests. Existing immutable manifests retain their original encoded-clock timing.

One video per scene passed a real Chromium range read, complete packet-index/rate
check and matching-frame PNG decode at the camera resolution. The receipt includes
its PNG hash. Source video hashes are publisher LFS declarations, not claims that
whole videos were downloaded. Other camera pixels and full photo exports remain
separate checks. Original loose photographs are not supplied: the `video_frames`
label means browser-derived frames, rather than original-photo export verification.

The [BiancaGolden_Ocho export receipt](../data/video-frame-export-check.json)
records a complete COLMAP + images export: 28 PNG frames,
28 unchanged calibrations and poses, and 99,649 selected XYZ points. Independent
PyCOLMAP reads found zero calibration or pose deltas. Camera 0028's software-decoded
pixels matched an independent native FFmpeg reference exactly. Native decoding and
forced software decoding passed synthetic red/green timestamp tests; the software
path also passed all three built deployment profiles without cross-origin isolation.
Independent reference frames check open-GOP B-frame boundaries and the final frame,
including the software decoder's recovery and presentation ordering.
All 47 source samples also passed with native decoding explicitly disabled.
Real Safari was unavailable, so this is not a Safari compatibility receipt.

The loader owns asynchronous reads, request sharing, cancellation, priority,
64 MiB decoded-frame eviction, and scene disposal. The Hub records associations and
evidence offline; its Worker never fetches or decodes source videos. MP4/WebM demuxing
uses bounded range reads. Native decoding is preferred; unsupported codecs use a
lazy, single-thread FFmpeg.wasm Worker. Only one bounded keyframe group enters the
Worker, which terminates after each extraction. This release supports matching still
frames; synchronized playback and archived masks remain separate capabilities.

`data/video-frame-routing.json.gz` contains the additive media receipts. Its
`baseManifest` binds the unchanged model-only evidence in `scene-manifests.json`.
The new body-hashed v4 manifest becomes the Hub's launch URL; old assets remain
unchanged. The runtime validates both the model receipt and the video layer before
offering direct opening. Audit CSV rows use `video_frames_manifest` and expose frame
count/timestamp separately from listed original-photo counts. Reusable photo
decisions reference the new receipt and retain earlier inventory evidence.

Operators prepare exact selections with:

```sh
node scripts/audit/prepare-dancenet-video-frames.mjs --scratch .tmp/camera-video-20261023
```

Preparation caches bounded public metadata/native responses, validates their earlier
pinned hashes and writes `prepared.json`. Complete the browser sample step against
the clean viewer runtime: read each first bound video's packet count/rate, decode its
timestamp through `decodeVideoFrame`, and record PNG bytes/hash/dimensions in
`video-pixels.json`. It has `schemaVersion: 1` and one `scenes` row per ID with
`status: passed`, `checkedAt` and `sample` (name/sourcePath/timestamp/width/height/
bytes/sha256/codec/duration/packetCount/averagePacketRate/averageBitrate). Failed or
absent rows must not activate a scene. Then record and validate the completed audit:

```sh
python -m scripts.audit.record_video_frames --viewer-root PATH_TO_CLEAN_VIEWER --scratch .tmp/camera-video-20261023
npm run check
npm run catalog:manifests -- --viewer-root PATH_TO_CLEAN_VIEWER
npm run test:browser
```

Recording requires committed viewer source and dependencies. Normal builds read
committed receipts and make no provider requests. Roll out the viewer before
activating v4 Hub launches.
