# Campus imagery correspondence audit — October 25, 2026

The Hub adds verified video imagery and cached matching-frame previews to eleven
existing MBZUAI Campus entries. No dataset IDs, short names, native geometry or
export qualification change. Existing campus_nlp and DanceNet3D evidence stays
unchanged. The viewer already supports these explicit v5 frame bindings.

`/s/AblazeDowntown` is `campus_knowledge_center/0`: all 291 registered views map to
six pinned recordings. Its 44,515 native sparse points remain unchanged. Eighteen
first/middle/last samples passed independent native FFmpeg versus browser software
decoder RGBA comparisons at the native 2704 × 2028 calibration.

The complete source review covers all 26 native models at revision
`4c18714ad982888d453ec88e2dc335f8dce5928d`, including 29,518 registered-name records.
Repeated names across combined reconstructions are counted as model records,
not additional unique photographs.

| Current Campus coverage | Scenes | Meaning |
| --- | ---: | --- |
| Complete frame correspondence | 4 | Existing NLP, Knowledge Center, current Core, and the three-pose Entrance model |
| Partial frame correspondence | 8 | Entrance views in its larger model and seven combined reconstructions; every unmapped name remains counted |
| Correspondence unresolved | 14 | No supported, independently verified mapping for that exact native selection |

The twelve mapped scenes contain 3,923 view bindings to nineteen distinct source
recordings. Eleven improved scenes add 3,638 bindings; repeated scene references
reuse the same source/frame/reference pixel evidence. The Hub has 59 video-mapped
scenes in total, including 47 existing DanceNet3D scenes. This does not count every
upstream video or claim every model view now has an image.

## Why some recordings remain unlinked

The [publisher's archived-artifact metadata](https://huggingface.co/datasets/sebothetramp/MBZUAI-Campus/blob/4c18714ad982888d453ec88e2dc335f8dce5928d/reconstructions/ARCHIVE_METADATA.json)
explicitly excludes extracted frames and feature databases. The current extraction
script is not a reliable recipe for every retained model:

- Hydro Connection, Knowledge Center Front and NLP Boulevard contain native
  numbers outside the current trimmed extraction ranges. A subset lying inside a
  range does not establish its frame correspondence.
- Several archived Core references use a different folder/suffix/numbering
  convention from the published current Core recording. Hydro, Palms and Medium
  captures also lack an established association to the available source folders.
- The 1K model uses 3840 × 2160 PNG references; the recordings linked here are
  2704 × 2028. Other clips cannot be assigned to that model from repository
  membership alone.
- The `mid_library`/`mid-library` spelling difference alone does not establish
  video and extraction correspondence.

The adapter therefore admits only the source-wide reviewed Core, Entrance,
Knowledge Center and NLP conventions. Remaining captures need original extraction
metadata or equivalent correspondence evidence before pixel checks can qualify
them. No first-frame placeholders are substituted for missing associations.

The related ten Oxford Day and Night entries also remain unlinked. All five native
text camera files specify `SIMPLE_PINHOLE 1408 1408 690 703.5 703.5`.
The [publisher](https://huggingface.co/datasets/active-vision-lab/oxford-day-and-night/blob/cbd9537ca5f70efca53912fc08adbc189ea66da2/README.md)
provides original Aria videos and rectified still-image TAR.GZ archives. Original
video pixels need lens rectification and exact session/timestamp associations;
the rectified archives need verified native-name routing. This is a mapping gap,
not evidence that photographs are absent upstream.

## Evidence and validation

The [compact audit receipt](../data/campus-video-mapping-audit-2026-10-25.json.gz)
records complete native file hashes, all-name inventory digests, namespace bounds,
coverage and the Oxford source/calibration checks. Selection-bound remaining work
is retained in `data/photo-audit-decisions.json.gz`. Generic mapping receipts retain
the exact source, selector, reference hash, viewer commit and pixel differences.

Native observation and point payloads were streamed and discarded; complete model
hashes were checked against pinned Git/LFS identities. This does not certify every
feature observation, model export or video pixel. Cached JPEGs use reviewed matching
frames, with their source and mapping receipts preserved. Gallery browsing reads
these static previews and makes no provider video requests.

Hub checks cover offline policies/builds, capture labels, all Knowledge Center
bindings, cached gallery imagery and launch manifests. Live verification checks
the changed manifests/previews and the Knowledge Center viewer after deployment.
