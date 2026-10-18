# Changelog

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
