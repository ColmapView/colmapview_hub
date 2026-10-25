# Changelog

## Unreleased

## 0.12.6 — 2026-10-24

- Report a failed analytics-choice write accurately when a previous allowance is already active. Failed withdrawal still stops measurement and explains how to clear the saved allowance. Refresh the client cache version for returning browsers.

## 0.12.5 — 2026-10-24

- Require explicit opt-in before loading Google Analytics or sending any measurement. Provide equally prominent Allow and Decline controls, footer settings for withdrawal, a 180-day browser-only choice and cross-tab updates. Invalid or unavailable storage and browser privacy signals grant no permission.
- Keep opted-in measurement cookieless, advertising off, and query strings, fragments and referrers excluded. Withdrawal reloads the page to remove the running tag.
- Record the bundled IBM Plex Sans copyright and OFL location in NOTICE.

## 0.12.4 — 2026-10-24

- Measure visits to public catalog browse and scene metadata pages with the existing Google Analytics property. Keep analytics/ad storage denied, advertising features off and measured URLs free of query strings, fragments and referrers; honor Do Not Track and Global Privacy Control. Share/manage, API and local preview pages do not initialize analytics.

## 0.12.3 — 2026-10-24

- Publish the Hub source under AGPLv3 with its attribution notice, a visible source link and a security policy. Dataset, preview and dependency licenses remain separate.
- Scan complete Git history in CI using a pinned, checksum-verified Gitleaks binary with redacted output. Retain read-only workflow permissions and disable persisted checkout credentials.

## 0.12.2 — 2026-10-24

- Use Images and Matched video frames consistently in filters, cards and metadata, retaining existing URL/API parameters. Partial video coverage is labeled as camera imagery, and video mappings no longer display an inferred repository-root media scope.
- Clarify source time versus geometry frame IDs, and update the current manifest and authoring guides. Refresh the UI cache version so returning browsers receive the new wording.

## 0.12.1 — 2026-10-24

- Validate the independent MBZUAI feature-integrity receipt alongside the earlier immutable relationship audit. This supersedes 0.12.0 before deployment; the frame mappings and runtime behavior are unchanged.

## 0.12.0 — 2026-10-24

- Publish generic, model-bound video frame mappings with separate mapped-view and unique-source counts. Retain legacy DanceNet evidence and all immutable manifests; imagery does not establish native model export integrity.
- Add explicit-frame authoring and an MBZUAI adapter for the publisher's resampling and global image counters. New v5 launches require viewer 0.23.0 or newer.
- Restore campus_nlp imagery with 285 explicit frame selections from six pinned source videos, checked against 18 independent decoded samples. Preserve the native model's existing feature-integrity warnings.

## 0.11.2 — 2026-10-24

- Restore DanceNet3D's declared 30 fps capture speed for individual camera playback, retaining encoded timestamps for matched stills and selected geometry. Apply the timing only to the reviewed source revision and README; preserve existing immutable manifest URLs.
- Regenerate the original video manifests during clean builds so previously shared URLs remain available alongside capture-speed playback.

## 0.11.1 — 2026-10-23

- Keep browser-test startup compatible with quiet CI by using HTTP readiness there, while preserving the Windows ready-banner check and development-port protection.

## 0.11.0 — 2026-10-23

- Bind 1,349 per-camera videos across all 47 danceNet3D scenes to matching static frames in viewer 0.21.1. Preserve native models, selected geometry, old immutable manifests, and separate model/export evidence.
- Label derived video imagery, expose accurate frame-routing audit coverage and validate the additive manifest against its pinned model and browser sample receipts.
- Wait for the local Worker to finish starting before browser checks, and reject occupied development ports before seeding test storage.

## 0.10.18 — 2026-10-23

- Use consistent icon controls for appearance, navigation, search, shuffle, reset and closing metadata. Keep tooltips, accessible names, keyboard operation and full touch targets; fit the phone header on one row.
- Cycle appearance through Dark, Light and System while preserving saved preferences, system changes and cross-tab updates.

## 0.10.17 — 2026-10-23

- Extend the gallery to the page edges and place readable titles, collection labels and counts over the bottom of each photograph. Keep fewer columns, direct opening, hover metadata and full touch targets.

## 0.10.16 — 2026-10-23

- Fill each gallery frame edge to edge, matching the caption width. Use three columns on regular desktops, four on wide screens, two on tablets and one on phones. Keep uncropped previews on dataset detail pages.

## 0.10.15 — 2026-10-22

- Enlarge gallery previews and reduce desktop columns, with four columns at 1280 px. Blend captions into the page by removing card borders and backgrounds, while preserving photo proportions, hover metadata and touch controls.

## 0.10.14 — 2026-10-22

- Preserve the full 44 px metadata-button target in touch layouts by correcting its flex basis. Verify tapping the metadata drawer with touch emulation in the browser suite.

## 0.10.13 — 2026-10-22

- Bring the Hub closer to the viewer with a compact search toolbar, full-width photo grid and two-column phone layout. Show content and license details on hover or keyboard focus while keeping the complete metadata drawer available.
- Keep scene labels, camera/point counts and source-review warnings visible. Group dataset previews, summaries and opening actions, and preserve each preview's aspect ratio.
- Keep asynchronous search, scrolling and return navigation. Make local development use local bindings and independent inspector ports for concurrent worktrees.

## 0.10.12 — 2026-10-22

- Flag 25 scenes with inconsistent source feature links: four complete-model findings and 21 bounded-sample findings. Preserve direct viewer links, original files and native camera/point counts.
- Expose nine source-calibration reviews and structured evidence for all 210 known native photo-resolution differences. Resolve the 30 earlier multi-calibration photo lookups against their exact camera dimensions.
- Record the count, calibration and observation audits and their verification limits. Preserve all 4,559 scenes across 144 sources, 2,610 manifests and 80 saved-state bodies.

## 0.10.11 — 2026-10-22

- Restore all 60 Dunhuang photographs through the exact first-frame text-model association. Check every camera, pose and 134,788 observations against the unchanged native binary model, plus all 11,115 points' reciprocal tracks. Exclude the archive's inconsistent binary representation.
- Allow an exact decoded archive-photo receipt to bind a scene without hosting a preview, preserving source terms and keeping photographs at the publisher. Validate calibration, registered names and source hashes independently of thumbnail publication.
- Record RotaryKiln's verified original ZIP mapping and distinguish it from browser delivery. Preserve 4,559 scenes across 144 sources and all earlier immutable manifests; Dunhuang adds the 2,610th manifest.
- Correct the archive badge hint so automatically attached photographs are not described as requiring extraction. Let photo-statistics browser checks accept resolved categories with zero scenes.

## 0.10.10 — 2026-10-22

- Bound shuffled catalog pages to four simultaneous metadata-pack reads and retain only requested scene rows. Decode bounded JSON incrementally and release owned body readers, reducing temporary buffers and retained neighboring records.
- Preserve scene order, repeated ordinals, metadata byte limits and all existing catalog selections. Add reader regression coverage for UTF-8 chunk boundaries, oversized stream cancellation and bounded concurrent reads.

## 0.10.9 — 2026-10-22

- Attach exact source photographs and attributed previews to 16 Blur-SLAM ablation/ground-truth scenes and two VRU captures. Check all 5,917 Blur photo names, byte-identical VRU source models and every photograph in both selected VRU frames.
- Support checked first-frame TAR prefixes in curated media routing, requiring viewer 0.20.5 and preserving the original archive size for range validation. Keep native model selections and all previous immutable manifests.
- Complete all four remaining published collection inventories at their existing pins. Keep newly found raw research candidates separate from qualified scene cards and preserve ALC901's exact export-checked selection when nested metadata anchors appear.
- Record 13 scoped source-photo omissions and Dunhuang's remaining source calibration/pose mismatch with explicit next actions. Publish 4,559 scenes across 144 sources, with 2,781 previews and 2,609 retained manifests.

- Reconcile all 432 current zero-point scenes with pinned scope receipts, including the 138 recent WildCity additions. Let the offline audit combine refreshed reports while rejecting changed model identities.
- Recheck every published scene's photo/point metadata and all 2,479 thumbnail assets, including live bytes and browser decoding. Record the remaining photo-association and discovery limits separately from successful checks.

## 0.10.8 — 2026-10-22

- Fill 496 missing scene previews from checked source photographs: 138 WildCity, 348 AstroVision, seven NL3D and three nerf-gs-datasets scenes. Retain existing previews and keep unsupported models excluded.
- Verify every WildCity camera/pose file and the complete pinned inventory. All 200 scenes have 50 poses and no supplied point-cloud file; depth maps remain separate from sparse points. Add the 50 listed sky masks per scene without changing viewer selections or feature-mask semantics.
- Attribute all 200 WildCity previews using the publisher's scene-to-city map, model credits and reported image terms. Strip original EXIF from new previews and serve them from the Hub.

## 0.10.7 — 2026-10-22

- Complete pinned discovery for four previously capped repositories. Add 138 WildCity camera/pose scenes and three nerf-gs-datasets reconstructions after exact-manifest imports and count checks pass, bringing the catalog to 4,559 scenes across 144 sources.
- Disable mismatched truck photographs while preserving its original calibration, poses and points. Recheck Trevi photo routing after discovering its companion PLY; preserve existing immutable manifest bytes.
- Record rejected camera metadata and large-manifest loading outcomes separately from qualified scenes. Checkpoint complete metadata directories so interrupted operator scans can resume safely.
- Refresh source-detail totals and listing coverage from the current pinned inventory on every build, including cached projections. Keep original media-scan counts explicitly labeled.

## 0.10.6 — 2026-10-21

- Withhold AstroVision Dione, Rhea and Tethys scene cards after complete downloads aborted in the native decoder. Preserve their original immutable manifests, complete discovery and explicit failure evidence.
- Publish 420 AstroVision scenes and 4,418 catalog entries across 144 sources. Record full-source loading coverage separately from header and sampled-media checks.
- Pin manifest validation to viewer 0.20.4, including the verified Itokawa large-file import fix. Complete full-model loading coverage for all 423 source reconstructions: 420 pass and three confirmed decoder failures remain withheld. Verify the production Itokawa import and every retained manifest asset/published direct launch.

## 0.10.5 — 2026-10-21

- Complete AstroVision discovery at its existing source revision: 423 reconstructions, including 351 omitted cluster/mission scenes. Publish exact photo/mask manifests while preserving all prior scene links and previews.
- Audit every AstroVision model's calibration, native prefixes, browser access and decoded registered photo/mask sample; retain full-loading coverage separately.
- Allow checked original-photo receipts to qualify photo routing without generating a Hub thumbnail. Keep incomplete registered-name checks explicitly scoped.

## 0.10.4 — 2026-10-20

- Count 4,070 scene entries across 144 sources by grouping 1,513 ScanNetPoseRefine initialization/refinement pairs. Preserve exact original selections at every historical variant link.
- Keep Gaussian scene filters and all source, photo, component and evidence totals consistent with the actual cards; fail builds on disagreements.
- Validate every generated manifest against the released viewer and add resumable Chromium loading tests with parsed count comparisons, bounded transfers and explicit coverage receipts.
- Respect provider quota-reset headers during loading sweeps and retain byte-budget exclusions without treating either as a failed dataset qualification.

## 0.10.3 — 2026-10-20

- Keep catalog notes and their audit links stationary when an in-flight scene page finishes loading. Resume automatic loading when the notes close.
- Preserve browser screenshots and traces in CI for failed navigation checks.

## 0.10.2 — 2026-10-20

- Require an explicitly selected Hugging Face COLMAP file to exist before approving a public Hub submission.
- Verify exact folder selections without trailing slashes and paths with encoded spaces, preserving those selections in pinned viewer links.

## 0.10.1 — 2026-10-20

- Use the Workers-supported manual redirect mode for Turnstile verification, rejecting redirects without forwarding the secret. Verify the request options in the real Workers test runtime.

## 0.10.0 — 2026-10-20

- Add opt-in public Hub submissions with managed Turnstile protection, request limits and bounded anonymous source verification. Keep unsupported sources pending operator review and existing upload share links unlisted.
- Show verified community entries in an asynchronous catalog feed with direct viewer links and concise metadata.

## 0.9.14 — 2026-10-20

- Open all 47 danceNet3D motion scenes with their original cameras and one explicitly labelled source frame: 20 XYZ frames with 1,872,683 points and 27 Gaussian frames with 799,402 Gaussians.
- Publish version 3 geometry manifests only after complete member integrity, frame membership, camera-world alignment, browser rendering and independent COLMAP export checks. Keep sparse points separate from splats and leave video-only photographs unbound.
- Retain all earlier source receipts and catalogue identities. The zero-point ledger now distinguishes loaded Gaussian frames, scoped absence, auxiliary camera/flow data and meshes.

## 0.9.13 — 2026-10-20

- Bind 28 verified sibling sources: 15 BMVS models and 13 TwinWorld test splits, adding 4,993,021 points with original poses, photographs and masks.
- Require pinned world associations, preserve native tracks for the identical doll model, and reject publication when any generated launch differs from runtime eligibility.

## 0.9.12 — 2026-10-20

- Close all five static cloud bindings from the zero-point audit, retaining checked photo prefixes and explicit camera-world transforms. Add a synchronized four-view, 2,148-vertex preview of the cloth trajectory's first frame.
- Record 7,382,230 newly selected source vertices, source-feature disconnection for untracked PLY, and OpenSfM Berlin's real 3,082 landmark observations, 137 untriangulated features and three original RGB exports.
- Confirm the HDR flow and DTU camera container scopes, retain their pinned receipts, and reuse these facts without repeated source audits. Keep dynamic archives, meshes and other reconstruction variants distinct from static point counts.

## 0.9.11 — 2026-10-20

- Audit all 357 scenes with an effective zero-point count. Correct nine source-verified exports containing 1,954,598 points, including OpenSfM Berlin and eight NeRF companion clouds. Keep missing data, unselected clouds, meshes, other model variants and animated geometry distinct in the dated per-scene ledger.
- Independently verify embedded OpenSfM XYZ/RGB and reject fabricated observations or reprojection errors.

## 0.9.10 — 2026-10-20

- Correct the OpenMVG SceauxCastle scene's verified point count to 6,586 after importing its embedded landmarks and 22,564 observations. Independently verify OpenMVG point values and reciprocal image tracks while retaining companion PLY verification for NeRF scenes.

## 0.9.9 — 2026-10-20

- Remove the remembered-connection service and permanently delete its saved credentials. Keep public Hub cards, R2 records, catalogs and share links.
- Reject credential-bearing variants in dataset and license links, and check browser-test types.
- Preserve the latest full-width grid, source links, shuffle history and return navigation.
- Qualify all eight NL3D camera scenes with their XYZ clouds and exact point-source evidence, replacing the old zero-point receipt and adding seven missing entries.

## 0.9.8 — 2026-10-19

- Retain the selected scene as the return anchor when deferred layout moves it outside the viewport just before navigation, bringing it into view on Back.

## 0.9.7 — 2026-10-19

- Keep shuffle seeds in browser history instead of the visible URL, retaining separate visits and Shuffle history, stable scrolling and Back navigation, and fresh ordering on refresh.

## 0.9.6 — 2026-10-19

- Align card headings, previews and summary rows; keep data labels and camera/point values together so wrapping stays consistent across the grid.

## 0.9.5 — 2026-10-19

- Randomize new feed visits and page refreshes, preserving active filters and stable scrolling and Back navigation. Keep explicit seeded API pages reproducible without caching one-off random responses.

## 0.9.4 — 2026-10-19

- Give missing-photo previews the full card preview space and add the original publisher link to scene information panels, including automatically loaded cards.

## 0.9.3 — 2026-10-19

- Use a full-width responsive scene grid with up to four columns, retaining uncropped previews, ranked suggestions, automatic loading and return navigation.

## 0.9.2 — 2026-10-19

- Restore the selected scene after deferred card layout settles, with explicit navigation anchors and manual history restoration. Cancel positioning as soon as the user interacts.

## 0.9.1 — 2026-10-19

- Keep an open scene information panel connected while a pending search completes, retaining its links and restoring keyboard focus when the new results appear.
- Verify photo credits against the selected scene's recorded license across different seeded orderings.

## 0.9.0 — 2026-10-19

- Add Discover, collection-balanced Random and New to Hub feeds with stable seeded pagination and filter-preserving shuffle.
- Preserve model-only and camera-only eligibility; rank existing model evidence, keeping unknown performance and popularity neutral.
- Record first-catalogued dates independently of audit dates and preserve them across refreshes and reappearing scene identities.
- Add a vertical scene stream with automatic loading, explicit retry/end states, data-type filtering and bounded return-navigation restoration.
- Retain uncropped previews, statistics, metadata panels and server-rendered pagination without JavaScript.

## 0.8.3 — 2026-10-19

- Attach 478 MegaUnScene ZIPs and 38 calibrated Fastmap TARs to their exact native models through viewer 0.19.2 companion manifests, retaining original source receipts and export tiers.
- Correct Dynamic Maps to 896 poses, bind all sibling photographs and add a full-frame preview. Verify ALC901's images_8 import and all 319 resized calibrations/poses independently.
- Record 5,544 reusable photo decisions and queue 32 unresolved associations. Key reuse to the exact source revision/content snapshot and selected files; expose the scope and next action in the audit CSV.
- Confirm the absent TwinWorld test photographs and video-only delivery separately from path-mapping failures. Preserve existing model selections, original-photo exports and preview bytes.
- Keep the streaming statistics audit consistent with camera-only text parsing; replay 232 cached pose files without new source requests or changes to their recorded counts.
- Display full-frame preview thumbnails at their intrinsic aspect ratio.

## 0.8.2 — 2026-10-19

- Enable remembered connections after registering both production OAuth callbacks and verifying private Drive and R2 loads, HF publishing, and real Google/HF token renewal.
- Reject authorization-provider redirects explicitly using workerd's supported manual mode. Validate real Worker request options in provider tests.
- Use the providers' supported form authentication for code exchange and renewal, fixing HF refresh rejection with Basic authentication.

## 0.8.1 — 2026-10-19

- Add pinned photo-inventory manifests for 1,246 native scenes, preserving all 255 existing manifest launches, model selections, statistics, previews and export qualifications.
- Keep sibling photographs and model-side masks in independent scopes. Retain complete source name mappings and protect neighboring reconstructions, calibration variants and auxiliary image roles.
- Check complete registered-name inventories for 425 scenes and bounded prefixes for 821 others through released viewer 0.17.7. Keep photo routing separate from complete scene/export evidence.
- Include launch manifests and inspected-name coverage in every scene's photo-audit CSV row. Preserve earlier stronger checks and record 188 calibration/image-dimension mismatches without removing usable models.
- Retain the account service's disabled activation setting from 0.8.0.

## 0.8.0 — 2026-10-19

- Add an optional `/auth/*` session service for the custom viewer, separate from public Hub cards. Store browser-bound connection credentials encrypted in SQLite Durable Objects for at most 30 days.
- Use authorization-code PKCE and verified Google/Hugging Face identities, serialized token renewal, exact-attempt cancellation and server-side disconnection.
- Sign bounded bucket object/list/multipart requests without receiving dataset contents or returning saved secrets. Bucket persistence requires an explicit remember choice; saved read-only connections require an explicit upload upgrade.
- Keep the service disabled until provider callbacks, Worker secrets and the viewer privacy update are configured.
- Limit connection starts before creating stored sessions, with a clear retry response, while leaving restoration, token renewal and file transfers outside that allowance.

## 0.7.25 — 2026-10-19

- Generate scene previews across every license category, including non-commercial and unspecified terms. Preserve reported source/image licenses, attribution and source hashes.
- Add 1,167 missing scene previews, bringing published coverage to all 2,190 scenes with established photographs. Preserve the 1,023 existing published previews and every scene's model/photo loading evidence.
- Add resumable offline preparation for direct public images, companion ZIP members and larger source photos.

## 0.7.24 — 2026-10-19

- Open dataset metadata in a side panel only when the info button is activated. Remove hover and focus-triggered popups.
- Add a persistent close button, backdrop dismissal, Escape handling and keyboard focus return. Keep the panel within the viewport with independently scrolling content on small screens.

## 0.7.23 — 2026-10-18

- Add 342 qualified scenes, bringing the Hub to 5,579 scenes across 147 collections. Support native camera/pose pairs without point files and independently checked camera-metadata model exports, with photo availability recorded separately.
- Bind 237 newly checked native photo prefixes to exact model files. Add pinned public Fox, OpenMVG and OpenSfM examples and an explicit MegaScenes component manifest, including independently checked native point/observation/track export.
- Recover the missing AstroVision point file and a DTU camera-NPZ source. Broaden camera-metadata filename discovery, retain partial-frame and media-setup labels, and add 16 licensed scene previews.
- Preserve every previous scene record and saved manifest. Record all 439 earlier candidates in a coverage ledger, exclude six failed HF cases and retain 91 unqualified public research entries outside the supported catalog. Add policy regression cases and a repeatable offline camera-model export verifier.

## 0.7.22 — 2026-10-18

- Bind the Expo root scene to its exact 81-camera, 49,817-point model and 81 original photographs through a checked manifest. The bare repository URL previously selected a different 148-camera nested reconstruction. Independent COLMAP export checks preserve calibration, poses, observation references, tracks, point IDs and colors, and every original photo hash; native point positions/errors retain the viewer's documented float32 precision.
- Correct 11 DTU mask samples and counts using complete pinned folder listings. Exclude 485 macOS sidecars from those counts and reject filesystem metadata as future content/preparation samples.
- Audit all 5,237 scene entries and 105 collections, including deployed API pagination, the viewer's actual path resolver, browser source reads and complete camera calibration parsing. Keep complete scene export proof distinct from bounded model/asset checks.

## 0.7.21 — 2026-10-18

- Prevent intermittent Worker resource-limit errors during catalog browsing by publishing 24-scene metadata packs instead of parsing 2,048 unrelated scenes for a page or model. Keep existing index layouts readable and preserve scene identities, counts, evidence and launch targets.
- Cover small-pack pagination, final partial pages and invalid pack sizes with Worker regression tests. The audit caught HTTP 503 resource-limit responses on previously cold catalog API pages.

- Organize build, offline catalog and operator audit tools into task folders. Use Python package imports and one interpreter launcher for builds and regression checks; keep existing npm entry points.
- Include Python tests in the shared local/CI check, lint JavaScript tooling, enforce application import boundaries and provide a fast `check:code` command.
- Make search-index token ordering deterministic and add focused contributor, catalog, sharing and operations guides linked from a shorter README.

## 0.7.19 — 2026-10-18

- Fill 731 missing camera-model, pose and point totals across 258 pinned native models, including all five Oxford Day and Night text exports. Keble College has 1,020 poses, one camera model and 1,667,969 points.
- Add a repeatable offline complete-file count audit using the committed viewer parsers with bounded batches, exact file hashes, duplicate-ID handling, image/observation framing and PhoMo schemas. Mixed binary/text models retain per-file evidence.
- Keep scene identities, viewer links, licenses, photograph policies and qualification levels intact. Add regression coverage for complete statistics, mixed layouts and confirmed empty point sets.
- All 5,237 published scenes now have model and pose/point totals. Remove point-cloud labels from 15 newly confirmed empty native point sets.

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
