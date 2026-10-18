# Changelog

## 0.7.18 — 2026-10-18

- Make Reset clear the dataset search and all saved filters even when JavaScript is unavailable. Keep asynchronous resets and browser history when scripts run, with a standard link for opening the unfiltered catalog in another tab.

## 0.7.17 — 2026-10-18

- Remove the redundant Delivery and Viewer link dropdowns. Every published scene has a viewer link, and current delivery groups match the Evidence filter.
- Preserve saved filter URLs and API behavior, including asynchronous pagination, Reset, browser history and server-rendered pages. Display saved criteria when an older link uses the retired controls.

## 0.7.16 — 2026-10-18

- Record Kicker's complete streamed COLMAP and original-photo export: all 31 photographs match pinned publisher hashes, and calibration, poses, observations and points are unchanged.
- Remove the obsolete Kicker package-limit notice. Preserve the selected models and evidence levels of every other scene.

## 0.7.15 — 2026-10-17

- Replace outdated image-setup notices for 57 ETH3D calibration records after checking all 2,003 registered names against the viewer's sibling-photo policy.
- Record all 31 Kicker originals loading and decoding, with unchanged model export. Keep full-scene export qualification separate and disclose the existing 256 MiB image-package limit.

## 0.7.14 — 2026-10-17

- Establish complete camera, pose and point totals for all seven pinned scenes in `alexmkwizu/colmap-testing-dataset`.
- Verify all 31 Kicker photo filenames and a full-resolution browser-decoded JPG. Record that the calibration-folder and parent-folder URLs still miss these sibling images, keeping the scene labeled as requiring image setup.

## 0.7.13 — 2026-10-17

- Fill previously unknown camera, pose and point totals for 18 pinned blur-slam text reconstructions using complete native-parser reads, with exact file hashes and independent photo evidence.
- Record the publisher manifest linking `scene0736_00_gtpose_shared` to 737 sibling EVSSM-deblurred RGB images. All registered names are listed and a browser-decoded sample matches the camera dimensions; the existing model URL still needs explicit image setup.
- Give cards without an eligible thumbnail a consistent placeholder, distinguishing missing photographs from an unavailable preview.

## 0.7.12 — 2026-10-17

- Open the scene browser directly from the Hub. Remove the separate landing page, collection browser, old pagination pages and collection detail HTML; redirect saved collection URLs to the matching scene filter.
- Keep one asynchronous browser with a clearly labeled Collection filter. Preserve scene details, source metadata, manifests, share cards and management links.
- Remove the retired collection search client and landing styles, and correct the audit page's preview wording.

## 0.7.11 — 2026-10-17

- Replace storage-path headings with scene names and distinguishing context. Keep canonical paths and viewer destinations in metadata.
- Use consistent secondary text for collection names, available data and camera/point counts. Move photo credits and license links into Info, and remove the crop label from the card.

## 0.7.10 — 2026-10-17

- Keep scene metadata readable and scrollable on short desktop and mobile screens. Connect side panels to their cards so hovering into the details keeps them open, and avoid repeated layout measurements while a panel is already open.
- Show actionable search-validation messages and retain retry guidance for temporary failures.
- Use one shared UI version for browser assets, page templates and response caches, and update the catalog documentation for licensed previews.

## 0.7.9 — 2026-10-17

- Simplify scene cards to a preview, title, collection name, compact available-data list and two main counters for posed cameras and 3D points.
- Keep camera-model totals, photo-check wording, source licenses and loading evidence in the Info panel. Preserve visible photo attribution, zero/unknown counts and existing viewer links.

## 0.7.8 — 2026-10-17

- Show camera pose, camera model and 3D point totals directly on every scene card and scene detail page. Counts describe the selected reconstruction; shared camera definitions, absent photographs and companion geometry remain separate.
- Preserve confirmed zero point sets and display Unknown for totals that have not been established by the audit.

## 0.7.7 — 2026-10-17

- Show available images, cameras, point clouds, splats, masks and other scene models beneath every scene card, distinguishing checked content, listed files, partial photos, required setup and separate image ZIPs.
- Add small square previews from the first available registered image for commercially licensed scenes. Serve prepared JPEGs from the Hub with original image credits, image-specific licenses and crop disclosure. Unknown and non-commercial image terms do not receive previews.
- Keep exact scene ownership, model-only loading and existing viewer destinations. Confirm Gaussian PLY properties before labeling a companion model as splats; keep masks separate from photographs.

## 0.7.6 — 2026-10-17

- Publish pinned photograph availability and path policies for every scene, with visible card labels, a photograph filter and per-scene details. Keep complete-export checks separate from samples, partial photos and future media configuration.
- Add public photo audit totals and a CSV covering all 5,237 published scenes across 105 collections, including checked CSV/JSON mappings and companion image ZIP requirements.
- Exclude two publisher-truncated Eiffel Tower models whose complete files match the published hashes but fail native pose parsing. Preserve usable model-only scenes, all 259 NGS scenes and 11 original ArmGS captures.

## 0.7.5 — 2026-10-17

- Restore exact pinned native camera/model layouts with optional photographs, keeping full original-photo export checks as a stronger evidence tier.
- Preserve browser Back and Forward filter state.

## 0.7.4 — 2026-10-17

- Add exact scene identities and independent evidence for three complete camera-and-photo exports.

## 0.7.3 — 2026-10-17

- Remove 28 scene entries whose launch opened one companion PLY instead of the scene dataset, retaining 5,239 scenes across 105 collections.
- Keep companion-file import evidence separate from scene launch qualification and block it from becoming a dataset action.

## 0.7.2 — 2026-10-17

- Describe the filtered catalog accurately and invalidate cached templates and client asset URLs.

## 0.7.1 — 2026-10-17

- Remove unsupported, nonopening, inaccessible and extraction-only cases from scene browsing, collections and public metadata; retain 5,267 viewer-eligible scenes across 133 collections.
- Exclude 87 additional pinned models with unavailable files or unsupported spherical cameras, and require a new review when their source revision changes.
- Preserve scene identities, loading evidence and working model/mask-only launches while keeping the complete research inventory offline.

## 0.7.0 — 2026-10-17

- Show one card per named scene, grouping camera splits, reconstruction variants and companion assets. Standalone model files remain inside collection evidence.
- Publish 20,092 named scenes across 331 source collections, with source-only, extraction and load-check states kept explicit. Exclude access-restricted sources from public browsing and downloads.
- Invalidate stale catalog responses by inventory generation and UI version while preserving search recovery, metadata controls and upload share links.
- Share the scene-opening eligibility check between cards and viewer redirects.
- Allow browser checks to use a separate local port.
