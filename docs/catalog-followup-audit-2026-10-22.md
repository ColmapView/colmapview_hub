# Catalog follow-up audit — October 22, 2026

The catalog adds **141 verified native scenes**, reaching **4,559 named scene entries across 144 source records**. The additions are 138 WildCity camera/pose scenes and the trex, truck and vegetation reconstructions in nerf-gs-datasets. Every new immutable manifest passed a complete Chromium import in viewer 0.20.4 (`79315be5f556115bca59c89afce4f0c181617ef2`), with exact camera, pose and point counts and a rendering canvas. No new Hub thumbnails were generated.

The machine-readable [audit receipts](../data/catalog-followup-audit-2026-10-22.json.gz) preserve source identities, discovery evidence, sampled media, immutable manifest checksums, original browser attempts and their separate outcomes. Ordinary builds remain offline.

## Discovery and counts

| Source | Previous native models | Complete native models | Published scenes before | Published scenes now |
| --- | ---: | ---: | ---: | ---: |
| boazkg/gs-pool-paslcd | 201 | 201 | 121 | 121 |
| rishitdagli/nerf-gs-datasets | 61 | 64 | 61 | 64 |
| WalkerCH/stream3d | 16 | 16 | 16 | 16 |
| yutofurutani/WildCity | 62 | 200 | 62 | 200 |

Each enumeration used the exact existing 40-character catalog commit. Anonymous Git fetches used `--depth=1 --filter=blob:none`; a complete recursive `git ls-tree -r -z --full-tree COMMIT` supplied paths and object IDs without downloading photographs or model bodies. The receipt records each root tree ID and the SHA-256 of the complete NUL-delimited tree output. Completed paginated directory responses are also checkpointed independently; partial pages never become complete-cache entries.

Source detail files and the catalog snapshot now refresh inventory totals and coverage from the same pinned registry on every build. Older image, archive and other-splat counts are labeled as source-scan observations. The projection generation includes the source-metadata writers so their changes invalidate cached metadata.

All previous inventory rows in these sources remain present and unchanged. The complete inventories add 2,115 research records, reaching 2,160,548 file/model records across 2,018 HF inventories. Geometry files and metadata documents do not each become a Hub scene. Existing scene-boundary grouping projects gs-pool's 201 native file sets into 121 named scenes. Other source inventories and archive coverage retain their existing limitations.

## Model and photograph evidence

The 141 manifests were staged without new browse cards, fetched as their original public assets, imported completely, and compared against independently recorded native counts before publication. Camera-only WildCity scenes retain zero points and checked native point-file absence. Complete text parsing counted 6,900 camera definitions and 6,900 poses across the 138 additions.

All 6,900 registered WildCity photo paths occur in the complete pinned tree. One photograph per scene decoded in anonymous Chromium and matched its calibration. The trex and vegetation scenes also passed matching registered-photo samples; their remaining filename and pixel coverage is scoped separately. All 141 new sample photographs, including truck's incompatible sample, had EXIF orientation 1 and exact browser/source hash matches. These checks do not certify every photograph, mask or complete image export.

Truck's available photograph is 979 × 543 while its original camera calibration is 1958 × 1085. Its explicit manifest uses `skipImages: true`, keeping all original calibration, pose, observation and point data. The card reports the photo issue. No guessed resizing or photo association is published.

The expanded inventory also reveals `trevi-fountain/trevi-fountain.ply`. Trevi's existing source calibration/pose prefixes, decoded photo sample and released-loader photo bindings passed a fresh check. Its immutable manifest bytes and selected native model remain unchanged; the PLY is an additional listed asset, with no newly asserted world-coordinate or point-export association. Existing scene IDs and launch selections are retained.

## Unsupported camera metadata

All 1,143 camera metadata documents in these four complete inventories were read at their pinned URLs. Git blob hashes matched 1,125 documents directly; the other 18 were independently matched to their original Git LFS pointer sizes and SHA-256 values.

The 1,030 GSO keyed intrinsics/extrinsics dictionaries in stream3d are unrecognized by the released viewer's camera-schema detectors. Their research records are retained. The 30 GSO30 `transforms.json` candidates were each fetched and attempted in Chromium. Every one was rejected with `frames[0].fl_x conflicts with the global value.` Their 3,000 `frame_*.png` references are also absent from their listed metadata folders; other `model/*.png` files need a verified association. These candidates have explicit negative reviews and are excluded from supported Hub browsing. Original source metadata and calibration are preserved.

## Loading coverage and limits

All 42 non-AstroVision cases that reached the earlier audit's byte budget now pass complete immutable-manifest imports with matching native counts and a rendering canvas in viewer 0.20.4. Retries used an 8 GiB transfer budget, temporary regular browser profiles and longer deadlines. The receipt retains each original attempt, current result and superseded timeout; a budget stop or timeout never counts as a pass. The three already withheld AstroVision decoder failures remain separate from these cases.

Trevi is a substantial performance limitation despite its passing result: its final import took 1,901,903 ms (about 32 minutes), transferred 904,014,487 bytes, and matched 3,191 camera definitions, 3,191 poses and 580,673 points. Earlier attempts reached their deadlines while displaying `Computing statistics...` after native parsing. This result establishes a complete import in the tested environment; photographs and exports retain their separate coverage limits.

Native imports and scoped photo checks do not establish complete RGB or mask export. Collection-reported licenses remain the source of the Hub's license categories. Source copies across repositories are counted separately; the catalog is a list of qualified named scenes, not a claim of globally unique real-world captures.

## Deployed verification

Hub 0.10.7 publishes generation `4847fd62c99ad264acd7a3e7c42a3d7875167c947d2254fa604405e30ec3fd8d`. A complete live sweep checked all 2,591 immutable manifest bodies against local SHA-256 values, HTTP 200 responses, ETags and CORS headers. All 6,072 launch routes (4,559 current scenes and 1,513 retained historical variants) redirect to their exact recorded viewer selections. All 144 source metadata responses match the refreshed local projection. The paginated API returned each of the 4,559 scene IDs exactly once, with matching counts, labels and reported license categories; all 141 new metadata pages opened. `/hub/` reaches the catalog and `/hub/styles.css` returns 200 with an ETag.

Production browser checks loaded trex, truck and WildCity Scene155 through both `colmapview.opsiclear.com` and the GitHub Pages root. All six reconstructed and rendered in released viewer 0.20.4 without page errors. Native production count logs matched trex and truck; WildCity's exact counts are established by its separate complete manifest import.

The live Hub browser also appended all 200 WildCity cards without duplicates or replacing earlier cards. Truck's card displays 251 poses and 137,414 points, keeps its direct launch link, and exposes the photograph dimension limitation in its metadata. These browsing checks caused no provider requests or page errors; the new card has no thumbnail.

These checks exposed a GitHub Pages root launcher that discarded the dataset query. The root now preserves the encoded query and view fragment when forwarding to `/latest/`. Its focused browser checks also retain existing share-link handling and unrelated 404 behavior. Root publication changed only `index.html` and `share-redirect.js`; production and `/latest/` viewer runtime artifacts remain 0.20.4. The audit receipts include the source and Pages commits, published asset hashes and separate runtime identities.
