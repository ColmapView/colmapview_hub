# Changelog

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
