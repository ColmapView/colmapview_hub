# Public dataset catalog

The Hub is a photo gallery: each tile has a single-line scene caption and, when
verified, a small **Gaussians** label. Source, content roles and licence appear on
hover or keyboard focus. The image opens the viewer directly; the corner info
button opens full metadata and camera/point statistics. Touch devices keep that
button visible. Shared-on-Hub photos use the same layout.

Video scenes use cached JPEG previews from their exact reviewed frame mappings.
The preview may be the first frame or a later selected frame; it must match the
manifest's source, registered camera and timestamp or frame index. Browsing the
Hub loads only the same-origin JPEG, never the video. Content-hashed previews
use immutable browser caching; catalog metadata continues to revalidate. The offline operator command
`node scripts/audit/prepare-video-previews.mjs --apply` reads bounded keyframe
groups and records immutable previews with their media-receipt provenance.

The Gaussian label means Gaussian data has verified format evidence and a viewer
binding. It stays visible without hovering. PLY is a container format: ordinary point clouds and meshes keep their
own labels. Listed, archive-only and conversion-required assets do not receive an
availability note. Unverified listings and archives say “Gaussian candidates.”
The catalog build checks Gaussian bindings against the pinned
classification audit; a `.ply` filename alone is insufficient. Filters and data
badges use “Gaussians”; the existing `splats` API/filter key stays compatible.

The browse page has one sticky toolbar for search and collection selection.
Licence, ordering and other filters live in More filters. On narrow
screens collection selection also moves into More filters, retaining values and
form submission. The menu starts closed and highlights active filters. A fixed
bottom bar shows the result range, loading status,
shuffle/reset, catalog information, the viewer link and appearance. Full count
descriptions remain available to assistive technology. Catalog information and
extra filters close with Escape or an outside click; reading catalog information
pauses automatic appends. Catalog information contains counts, the current
selection and a short description; operator audit and raw-data download links
are omitted. Audit records remain available for maintenance. Return anchors
account for both bars. Policy links and
Analytics settings remain in the ordinary page footer.

Every curated scene has a readable `/s/AdjectiveNoun` URL. Names are independently
random and assigned once in `data/catalog-share-names.json`. The operator allocator
conditionally reserves each `links/<name>.json` key against upload collisions;
these small records contain only a public dataset ID and creation time. They have
no upload ownership, management key, provider credentials or duplicate image data.
Cards, full metadata and Copy link use the reserved name. The optional tenth
field in built scene rows carries it to the API and asynchronous card renderer.
Shared on Hub submissions retain their existing `/s/<id>` addresses and copy
controls. Clipboard failures reveal a selectable link.

Curated short URLs resolve bounded, current built catalog assets. Browser
navigations (GET/HEAD with a document destination or navigate mode) receive the
native viewer document with inert startup data and keep the short address.
Entries without an allowed launch resolve
to their metadata. Non-navigation requests receive social metadata without
analytics, with `Vary: Sec-Fetch-Dest, Sec-Fetch-Mode`. Removed entries return 404.
The short namespace uses the normal lookup cooldown; cross-site embeds and
prefetches are rejected before reading assets or spending misses. Its IDs are
case-sensitive for legacy codes. Readable names follow the upload namespace's
case handling. Old `/s/d/<code>` URLs still resolve the complete 12-byte scene ID
from built assets, without a redirect or a new record. No public API can create,
overwrite or manage curated name reservations, and they accept no submitted URL.
Existing `/hub/datasets/open/<id>` launch and API contracts stay compatible.

The Worker fetches only the fixed operator-owned Pages app shell, with an 8-second
timeout and a 128 KiB bound, and never forwards visitor credentials. It requires
the viewer's launch capability marker, escapes the JSON data, and preserves
the viewer's browser security and referrer policies. These personalized documents
are uncacheable and contain no analytics. Source files and provider sign-in stay
in the normal viewer/browser flow. Embeds continue to use the ordinary viewer URL
because cross-site subresources cannot look up protected short links.

The hosted browse and scene metadata pages use Google Analytics web stream
`G-7K5H83SEMY`, used historically by viewer releases through v0.15.4.
Measurement starts only after explicit opt-in to analytics cookies (consent revision 2).
Before opt-in, no Google tag or measurement request is loaded. “Allow analytics”
uses the standard primary button style; “No thanks” remains clearly visible beside
it with the same text size and one-click action. The prompt appears on the first visit
without a valid saved choice; both allowance and refusal keep it hidden on later visits.
Analytics settings is an ordinary footer control that reopens the choice, with no
floating button. Choosing or closing the prompt preserves the page's scroll position.
Closing the panel or pressing Escape does not grant consent or change a saved choice.
The browser stores the choice, time, `policyVersion: 2` and a two-bit privacy-signal
snapshot in `colmapview-hub-analytics-v1` for 180 days. Earlier refusals are kept;
earlier cookieless allowances require fresh consent. Missing, expired, malformed,
unknown-revision or unavailable permission grants no access. Withdrawal disables
measurement, deletes this integration's cookies and reloads to discard the tag.
Expiry has an active deadline; storage changes and returning to a tab also recheck.
The notice and browser initializer share `ANALYTICS_CONSENT_REVISION`. An older
cached notice paired with a newer script cannot initialize analytics or authorize
cookies; it clears this integration's cookies and waits for a current page.

After consent, `analytics_storage` is granted. Advertising storage, advertising
user-data use and personalization remain denied; Google signals and automatic
enhanced measurement stay off. `cvh_ga` and `cvh_ga_7K5H83SEMY` are restricted to
the current host and `/hub/datasets`, use Secure/SameSite=Lax, do not refresh on
visits and expire no later than the existing 180-day permission. There is no
application account/user ID. Choice records stay in the browser; the Worker does
not store them or cookie identifiers. Consent revision 2 accompanies measurements;
an explicit Allow queues `consent_granted` as additional evidence of the interface.

The measured page location contains only the public catalog path. Query strings,
fragments and full referrer URLs are excluded. URL passthrough and cross-domain
linker import/decoration are explicitly disabled. Acquisition uses only a fixed
referral category (Google, Bing, DuckDuckGo, GitHub, Hugging Face, viewer or other).
Do Not Track and Global Privacy Control keep analytics off and suppress the
automatic prompt by default. The visitor can explicitly allow only this analytics
in settings while a signal is present; advertising stays off. A newly detected
signal absent from that permission withdraws it, and removing the signal does not
restore consent. This is a site-specific analytics choice, not an opt-in to sale,
cross-site advertising or all future purposes.
Local previews, share/manage pages, APIs and the viewer
do not initialize it. The public privacy policy describes Google's processing.
Keep Enhanced measurement disabled in this stream's Google Analytics settings:
its automatic search/link events can collect query values or destination URLs
independently of the configured page location. The Hub sends its page view
explicitly; validate the real collection request when changing tag settings.

`src/client/hub-usage.ts` measures trusted clicks and committed search/filter
actions only after permission. Search edits (`catalog_search`) and submissions
(`catalog_search_submit`) have separate event names to avoid counting a committed
search twice. It reports dataset opens, metadata/link opens,
shuffle/reset/pagination, appearance changes and one 90% scroll event per page.
Dataset IDs must match the curated `data-[a-f0-9]{24}` format; shared-link IDs,
text, hrefs, search terms and filter values are never sent. Filter names and their
active state are bounded. Google supplies ordinary session/engagement measurement
after cookie consent. Do not replace this with automatic form/search/link capture.

Use event-scoped custom dimensions for `dataset_id`, `filter_name`, `filter_active`
and `consent_revision` when these parameters are needed in custom reports. They do
not require publishing any source URL or visitor account identity.

The public privacy policy must deploy before this consent revision is enabled.
Google's processing terms were already accepted; its official DPF record showed
EU/UK/Swiss participation active in the October 25, 2026 check. These technical
controls are not a blanket legal certification; the operator must maintain its
purpose/retention justification, rights process and applicable transfer arrangements.

The October 24, 2026 production check also confirmed Google signals and
user-provided collection off, existing processing terms accepted, and email
redaction on. URL query redaction is enabled for `url`, `q`, `state`, `code`,
`access_token`, `token`, `key`, `config`, `userid`, `authuser`, `resourcekey`,
`returnto`, `redirect_uri`, `id_token` and `refresh_token`. This is an additional
safeguard for cached older tags; it does not replace prior opt-in or clean URLs.
The owner chose to keep retention unchanged: event data 2 months, user data
14 months, and resets on new activity on. Google products/services sharing and
business recommendations were off; aggregate modeling contributions and technical
support access were on and were left unchanged. Recheck these dated account
settings separately from the browser integration when changing data practices.

[Video manifests](video-frame-mappings.md) add matched images on demand. Version 5
selects zero-based presentation-frame indices or source timestamps; the viewer
resolves these before playback, export or publication. The campus_nlp mapping
binds 285 registered views to six recordings, with 18 independently checked
samples. The 47 DanceNet3D scenes retain their immutable v4 timestamp manifests.
Cards and metadata distinguish **Moving camera** from **Synchronized multi-view**;
capture evidence and temporal selection are [separate properties](video-frame-mappings.md#capture-type-and-temporal-selection).
Video imagery has separate mapping and sample evidence; it does not establish a
complete image export or repair native feature links.

NeRF-style camera scenes may include a verified companion XYZ PLY. The loader owns association, parsing, display and COLMAP export; Hub records the exact point source and independently checked export counts. Source inventory and header counts remain separate from imported counts. A nonempty NeRF-style camera-metadata receipt requires the selected PLY's browser-readable byte hash and an independent point-value check.

The OpenMVG SceauxCastle sample stores 6,586 landmarks and 22,564 observations inside `sfm_data.json`. Viewer 0.19.4 imports them alongside its 11 posed photos, replacing the former camera-only import. The exact source metadata and browser-exported model pass independent point-ID, coordinate, observation, reciprocal-track, calibration and pose checks. Geometry and error comparisons allow the existing WASM export's float32 representation; photos retain their original bytes. All 11 originals also passed a separate complete image-export and browser CORS check. The model-only receipt remains separate from photo evidence, and this confirmed result supersedes the previous zero-point receipt.

The NL3D synthetic composite sample has eight scene entries, with 400 posed views and 721,835 imported points, checked against viewer 0.19.3 commit `ba4d99866a7ec2817767a7c254157fb54449ad7c`. All eight pinned metadata URLs loaded, rendered and exported in the local production build. Independent PyCOLMAP/NumPy checks compared every calibration, camera pose and point. Each scene has one decoded original-photo sample; full RGB export and mesh/mask loading remain separate checks. These entries require viewer 0.19.3 or newer. Existing preview and license labels are retained; no new previews were generated.

`/hub/datasets/` shows one card per named scene dataset. Reconstruction folders, camera metadata and named public captures establish scene identities. Camera train/validation/test metadata, reconstruction variants and companion assets stay inside their scene. Standalone PLY, STL, OBJ and other model filenames do not create cards. Filters cover collection, scene type, source, license, evidence and image availability. The Delivery and Viewer link controls are retired because they duplicate Evidence and the published-scene eligibility rule. Saved URLs still retain those criteria through pagination and history; API filters and detailed evidence remain available. Prepared previews are served from the Hub; browsing makes no provider requests.

The source snapshot lives in `data/catalog.json`; `data/individual-datasets.json` and its checksummed, compressed source listings preserve individual model identities. Python 3.11+ is required for the offline index build. `npm run catalog:import -- --viewer-root PATH` refreshes the collection metadata and reapplies the pinned individual listing. See [data/README.md](../data/README.md) for refresh commands and qualification limits. The normal dev, check and deploy commands build static metadata packs and compact search posting lists. The Worker reads bounded same-origin assets through `CATALOG_ASSETS`, rendering one requested page or model. The browser fetches only the current results page.

Cards and filters distinguish **Commercial use**, **Non-commercial (NC)** and **Not specified** using reported source license metadata. Individual entries inherit their source category and retain the exact license string. Missing, custom, conflicting or unclear terms remain Not specified. Conditions such as attribution, share-alike, acceptable-use restrictions and asset-specific licenses still apply. `npm run catalog:licenses` refreshes these categories without the original survey CSVs.

Hub pages use the viewer's compact controls, neutral palettes and shared `colmap-viewer-theme` preference (Dark, Light or System). The catalog fills the available width with an edge-to-edge photo grid: three columns on regular desktops, four at 1600 px and wider, two at 1100 px and narrower, and one at 640 px and narrower. Captions sit over a subtle dark gradient at the bottom of each photograph. Source-review warnings stay visible. Gallery images fill their tiles and crop without stretching. Dataset detail pages retain uncropped previews and group the preview, summary and opening actions together.

Appearance, header navigation, search, shuffle, reset and metadata close use consistent icon controls with tooltips and accessible names. The appearance button cycles Dark → Light → System, retains the shared saved preference and follows system/cross-tab changes. Icon controls keep 44 px touch targets, and the phone header fits on one row.

The info button opens dataset metadata in a side panel with a close button, Escape/backdrop dismissal and keyboard focus return. The panel opens only on activation; its header stays visible while long content scrolls inside the viewport. A primary click opens a camera/model scene at its short viewer address. Native camera/pose/point layouts require exact pinned file sets with bounded header and CORS-response checks; full camera-and-photo exports form a stronger optional evidence tier. Missing photographs do not exclude a usable reconstruction. Gated, extraction-only, unsupported, known-failed and standalone geometry entries are excluded. Opening a scene resolves fixed catalog assets and the operator-owned app shell only; the Worker never downloads source data.

Search replaces results asynchronously. The Collection filter selects source datasets within the same browser. Filter changes support browser Back and Forward; text changes in the same editing session share one history entry. Load more appends 24 entries while retaining the current filters and results. Aborted or late responses cannot replace a newer search; failed appends retain the previous entries and offer a retry. Failed searches label the retained entries as previous results. A changed catalog generation refreshes the first results page before mixing inventories. Reset clears every filter, including saved criteria from retired controls, with or without JavaScript. Server-rendered filters, model links and pagination remain available without JavaScript. Additional filters, coverage notes and metadata downloads are folded away from the main browsing view.

The old collection browser, pagination aliases and collection detail HTML are removed. Their saved URLs redirect to `/hub/datasets/`, preserving filters and selecting the original published collection. Old collection page numbers reset because they counted sources instead of scenes. Removed or restricted sources remain unavailable. Source metadata and manifest downloads remain available. Scene URLs use `/hub/datasets/entry/data-…`, with identity derived from the source and scene path independently of scan dates or revisions. The build removes previous generated collection HTML and the obsolete collection client asset, so they cannot shadow redirects. Browser, scene, API and redirect routes must reach the Worker; `run_worker_first` excludes only the fixed static catalog prefixes. These routes and generated asset names must stay aligned.

The public Hub includes only collections with published camera/model scenes. Its **144 source collection records** remain separate from scene cards. `data/native-layouts.json.gz` records reviewed pinned native COLMAP layouts with checked camera/pose samples, model header reads and model CORS responses. Text-model totals are established separately by reading the complete exact files with the viewer's native parsers; a prefix or sibling model never supplies their totals. `data/verified-scenes.json` records three separately verified complete camera-and-photo exports. Revisions and required model paths must still match the canonical inventory. `data/scene-exclusions.json` retains known failures. Neither absent RGB nor optional masks prevent model-only loading. Collection pages cannot inherit an unrelated sample viewer link. Complete inventories remain in `data/` for research.

The October 21 count review published **4,070 scene entries from 144 source records**: 4,024 native COLMAP camera/reconstruction scenes and 46 imported/public camera scenes. The earlier 5,583 count included 1,513 extra initialization variants in ScanNetPoseRefine. Each `scene…/sparse/init` and `scene…/sparse/refined_aligned` pair now has one card opening the refined model. Old variant IDs retain their original launch and evidence through bounded static variant shards; they do not inflate collection, feed, photo or type totals. Copies across different repositories have not been globally deduplicated, so “scene entries” does not claim globally unique physical captures. All 259 NGS scenes and 11 original ArmGS captures remain available. Two publisher-truncated Eiffel Tower models are excluded even though their first records are readable. The generated [published index](https://colmapview.opsiclear.com/hub/datasets/individual/index.json) supplies current totals as the catalog changes.

The subsequent [AstroVision audit](astrovision-audit-2026-10-21.md) discovers 351 omitted reconstructions at the unchanged source pin and publishes 348 of them, reaching **4,418 scene entries across 144 sources**. All 423 AstroVision models have exact immutable manifests. Three confirmed native-decoder failures are withheld, leaving 420 source cards with successful full model imports; native-header, media-routing and full-loading checks retain separate scopes. The preceding 4,070 entries and immutable manifests are preserved.

Every build compares all card summaries with source ranges, type/evidence/delivery/photo/content totals and every facet posting. Selected Gaussian frames count as Gaussian scenes in both cards and filters. Camera and point counters describe the selected model, never the sum of initialization and refinement copies.

Available-data totals overlap: a COLMAP scene may also include photographs, masks, meshes or Gaussian assets. Scene types follow the selected launch. The manifest audit reports explicitly selected Gaussian frames separately from optional clouds decoded alongside COLMAP models.

`data/scene-photos.json.gz` records pinned photograph evidence. Separate video mapping receipts describe derived frames. The Images filter covers source photos, matched video frames, partial coverage, setup requirements, separate image ZIPs, absent originals and unresolved associations. It retains the `photos` URL/API parameter for existing links. Detail pages retain checked folders, exact mappings, registered-name coverage and pixel-sample scope. A sample does not certify every image or complete export. Missing images do not disable model-only loading.

The viewer 0.17.1 ETH3D follow-up checks all 2,003 registered photo paths across 57 calibration records in four pinned repositories. These links discover sibling photos automatically and keep distorted/undistorted variants separate. Kicker additionally passes browser reads and full image decoding for all 31 originals. Viewer 0.17.2 exports its complete 414,603,162-byte image ZIP: independent Python ZIP reads verify all photo CRCs and SHA-256 hashes against the pinned publisher LFS objects, and native parser comparisons preserve model calibration, poses, observations and points. Other scenes retain their existing evidence level.

Scene cards also list available images, cameras, point clouds, splats, masks and other 3D models. Pinned `scene-contents.json.gz` adds scoped inventories and companion-header evidence. Listed masks do not imply checked alignment; an unknown PLY is never guessed to be Gaussian splats. Small 320 × 320 JPEG previews use checked scene photos across every license category. Previews are same-origin static assets with recorded source/image terms, known credits and a square-crop notice. Generating a preview does not change the dataset's license category. Browsing makes no requests to image providers. A photo preview does not imply that the scene link automatically attaches photos from a separate archive or a folder requiring setup.

Companion photo evidence supports indexed ZIPs and sampled uncompressed TARs. TAR evidence binds one regular member's name, header/data offsets, size and full source SHA-256 to the pinned scene. Browser range reads check the header and photograph prefix; pixel decoding and preview generation check the complete sampled photograph separately. Partial TAR inventories say “at least” and never become complete-photo export evidence. Camera dimension mismatches and required extraction/name changes remain visible. The preview reader validates TAR checksums, bounded GNU/PAX metadata, exact member identity and photo hash without extracting filesystem paths.

PLY header preparation accepts normal spacing and CRLF, validates typed vertex properties and distinguishes empty output from unknown geometry. Packed chunk/vertex Gaussian PLY is labeled as splats requiring conversion to standard Gaussian PLY for the current viewer; its presence does not attach it to a camera-only launch. Bounded pose-name samples record both the inspected prefix size and the full registered count, so partial name checks are not presented as complete coverage.

Scene cards show two primary counters: **Cameras** (registered camera poses) and **Points** (3D points in the selected scene). The Info panel retains shared camera-model totals, photo-check status, source licenses and loading evidence; scene details show all three totals. Camera poses count registered posed views even when original photographs are absent; camera models count shared intrinsic definitions. A checked explicit manifest supplies its selected point count; the original native count remains separate in the evidence. Complete-scene counts otherwise take precedence over bounded-header counts. Confirmed empty point sets show `0`; unestablished totals show `Unknown`. Collection-wide samples never supply another scene's totals. Available-data labels and required photo attribution remain visible on the card.

Run `npm run catalog:counts -- --viewer-root PATH_TO_CLEAN_VIEWER --apply` to fill missing native text counts. The offline command streams complete public pinned files into a local cache, counts unique records through the committed viewer parsers, and saves per-file hashes, byte lengths and the viewer commit. It handles missing count comments, duplicate IDs, blank image-observation lines, PhoMo schemas and mixed binary/text models. Large point tracks are discarded between bounded parser batches. It preserves existing totals, photo policies and qualification levels; a count audit is not full reconstruction, photo or export validation. Without `--apply`, it only writes local receipts. Failures remain unknown and produce a nonzero exit status. See [the data notes](../data/README.md#scene-statistics-audit) for options and limits.

Current photo and component totals are generated from the published scene projection, rather than copied into documentation. Download every scene's availability, launch-manifest URL, inspected-name scope and remaining routing issue at `/hub/datasets/individual/photo-audit.csv`; totals are at `/hub/datasets/individual/photo-audit.json` and `index.json`. Historical full-export receipts remain in `data/verified-scenes.json` and `data/scene-manifests.json`; their exact selections and dates remain distinct from current browser loading tests.

Two VRU captures additionally use checked complete first-frame TAR prefixes with
viewer 0.20.5's optional `mediaArchives[].indexBytes`. The original archive size
still validates every HTTP range; only the selected prefix is indexed. Source
camera/pose files match the native models byte for byte. The
[source-resolution audit](catalog-source-resolution-2026-10-22.md) records the
frame boundaries, all registered photo checks and remaining source limitations.

### Per-manifest loading checks

`npm run catalog:manifests -- --viewer-root PATH_TO_COMMITTED_VIEWER` validates every generated and retained manifest against that viewer's actual Zod schemas. It also checks referenced asset existence, evidence checksums and agreement between entries sharing a manifest. Selection-digest filenames and content-digest filenames are both supported. The local report is `.tmp/manifest-audit/plan.json`; this is schema/evidence validation, not a successful browser load.

Add `--load --resume` to open every manifest in Chromium through the real viewer URL loader. The command starts an isolated local Vite server from the committed viewer checkout, fetches the original manifest and source files with browser CORS rules, verifies the manifest body, waits for import completion, and compares parsed camera models, registered poses and points with every associated card. A canvas is required; selected Gaussian frames must also pass their decoder and match the declared Gaussian count. Each attempt appends a receipt to `loads.jsonl`, and `summary.json` distinguishes passes, failures, inconclusive attempts, byte-budget exclusions and untested files. Distinct manifest URLs count separately even when their JSON bytes match. Resume reuses successful results for the same viewer commit and catalog generation. Documented byte-budget exclusions remain unverified until the budget is raised or `--retry-budget` is requested; other failed/inconclusive attempts are retried. Unknown counts are not guessed; zero remains an exact assertion. Photographs, masks and full exports require their separate audits.

HTTP 429 responses pause the shared loading queue according to `Retry-After` or the provider's `RateLimit` reset header, with a five-minute fallback. Cooldown receipts survive cancellation. A throttled import is inconclusive and gets up to three attempts, respecting cooldowns between them; repeated throttling stops the run with remaining manifests explicitly untested. An operator sweep never converts a temporary quota error into a dataset exclusion. Successful imports with optional throttled probes still retain their successful count checks while respecting the cooldown before further requests.

Use `--manifest HASH.manifest.json`, `--source hf:owner/repo`, `--offset N` or `--limit N` for focused runs, or `--shard 1/4` for disjoint batches. Defaults are two browsers, 256 MiB of external response bytes per manifest and a 120-second load timeout; `--jobs`, `--max-mib`, `--timeout-ms` and `--scratch` are explicit overrides. HEAD metadata for a lazy archive does not spend its entire container size as response bytes. Large-data exclusions, provider errors and timeouts are never passes. Do not remove or upgrade publication evidence merely because a bounded operator run could not complete. Normal asset builds remain offline. CI checks every manifest against the pinned released viewer; the separate manual manifest-audit workflow performs live loads in four disjoint shards and retains receipts. Update the viewer tag in both workflows when adopting a newer loader contract.

The receipt includes both whole-plan coverage and `selected` coverage for the requested range or shard. The command exits successfully only when every selected manifest has a current passing receipt. Recovered retries can pass; retained byte-budget exclusions and provider-stopped, unattempted targets keep the run incomplete.

Use `--disk-profile --jobs 1` for a large-data check in a temporary regular Chromium profile. Private contexts can exhaust their Blob memory quota even when a regular browser can spill the same public data to disk. The command creates its own empty profile below the audit scratch directory, records the context type, closes it and removes only that verified temporary path. It never opens a user's Chrome profile. Default sweeps retain isolated private contexts and bounded transfers. Failed attempts also retain their last progress stage and bounded, URL-query-redacted import diagnostics.

CI also runs `npm run test:manifest-runner` with `COLMAPVIEW_AUDIT_VIEWER_ROOT` set to that checkout. These integration checks start a quiet CI server with an empty shard, verify that it releases its port, keep a resumed budget exclusion incomplete, and reject an occupied developer port before making requests. They require Chromium but download no source datasets.

The manual workflow accepts optional source and manifest-filename inputs, so a reported link can be reproduced independently of the full sweep.

The [October 21 loading receipt](../data/manifest-loading-audit-2026-10-21.json.gz) records **2,038 passing manifest loads and 61 byte-budget exclusions**, with no count mismatches or unresolved loader failures. All 2,099 files passed schema/evidence checks and were attempted: 2,075 currently referenced manifests and 24 retained assets. Native/importer routes without manifests are outside this sweep. The receipt pins viewer 0.20.2, each manifest body hash, source URL, expected counts and individual attempts. All 27 explicitly selected Gaussian frames decoded and matched their combined 799,402 declared Gaussians; optional clouds remain separate.

The [full Linux Chromium run](https://github.com/ColmapView/colmapview_hub/actions/runs/39540193574) used 256 MiB and 120 seconds per manifest. Its nine timeouts passed focused Windows Chromium retries with a 180-second deadline. Before combining environments, every manifest body hash, URL and count reference was compared; differing catalog generations reflect source line endings. The 61 over-budget cases remain unverified by this sweep. The manual workflow reports failure for incomplete coverage, while the standard offline and browser CI checks pass. Full photograph, mask and export checks retain their separate scopes.

### Photo routing manifests

The initial `data/photo-routing.json.gz` cohort added explicit v1 photo inventories for **1,246 native scenes** against released viewer **0.17.7**, bringing manifest launches to **1,501**. The continuation below added one native photo inventory and 516 companion archive manifests, bringing that audit snapshot to **2,018**. Later point/frame selections have their own receipts; the per-manifest plan enumerates current and retained assets. Other scenes retain their native/importer routes, archive requirements or unresolved associations. A photo-routing manifest does not upgrade native model parsing, point counts or export evidence.

The offline audit uses complete pinned inventories, full calibration files and complete or bounded pose-name metadata. It checks the sampled photo's source hash and camera dimensions, then passes the exact manifest selection through the released manifest schema, file-selection loader and native photo/mask binder. All 425 complete name inventories were inspected; 414 have every name bound. The remaining 821 scenes have bounded name samples, not complete-name coverage. Uninspected names from complete authoritative CSV/JSON mappings remain declared without becoming inspected native records. Masks beside the model survive independent photo-folder selection; mask roles and checked bindings are preserved. Inferred media cannot borrow a neighboring reconstruction, and depth maps/renders remain outside photo inventories.

The 188 other audited native photo cases have sampled image dimensions that differ from the selected camera calibration. Their existing model URLs are retained; the information panel and CSV record the mismatch. The continuation attaches checked companion archives automatically; the remaining archive calibration mismatches retain their model launch. Photographs remain optional for a qualifying camera/model scene. See [the audit input and refresh contract](../data/README.md#photo-routing-manifest-audit).

### Explicit scene manifests

`scripts/catalog/scene_manifests.py` generates existing v1 manifests and saved JSON settings below `/hub/datasets/individual/manifests/`. It reads only curated receipts; neither the build helper nor the Worker downloads source data. The immutable manifest selection includes the exact pinned cameras, poses, selected native/XYZ points, registered photo mappings and mask mappings. Both manifests and settings have static CORS responses. Previously shared hashed assets are retained, and missing or corrupt current assets invalidate the build cache.

`data/scene-manifests.json` qualifies 14 `Wuuu3511/bmvs_sparse_dtu2` variants, two `zhaoshiwen/blur-slam-bpn-data` variants and the `alandpn/expo_mcm-ufrn` root scene. Together they load 577 posed photo instances and 13,552,753 points. The BMVS scenes additionally bind 42 mask instances. Every original photo matches its camera resolution and survives COLMAP package export byte-for-byte. Independent PyCOLMAP reads check calibration, poses, point colors and observation references. XYZ PLY positions survive exactly; Expo's native positions and errors retain their source values or exact float32 rounding. Masks have checked bytes and dimensions but unknown semantic roles; they display in the viewer and are not qualified as COLMAP feature masks.

Seven BMVS `sparse_mast3r` variants use exact sibling `dense/images` and `dense/mask` mappings. The second blur-slam variant uses the checked `i2slam_da3/scene0024_01/images` photos: its camera, pose and point files are byte-identical to that representation. The receipt retains both source camera/pose hashes rather than inferring an association from basenames.

The Expo manifest binds the original root model (81 poses, 49,817 points and 81 photos). Its bare repository URL previously selected a different 148-pose reconstruction under `sparse/0`. The manifest preserves the nonempty native cloud, IDs, tracks and observation references.

The selection digest binds file receipts, media mappings, counts and the saved overview. Changed revisions, native paths, incomplete checks or mismatched counts fail the build. An XYZ companion can replace only an empty native point set; nonempty native points and observation IDs must stay intact. See [the manifest audit notes](../data/README.md#explicit-scene-manifest-audit) for verification and update instructions. Release viewer **0.17.5 or later before deploying these Hub links**, because older saved-settings validation discards the zero track threshold needed by untracked XYZ points.

The October 18 whole-catalog audit checks every published scene's exact pinned model paths, statistics, launch selection and browser access. It also completely parses all 5,236 native calibration files and checks all 105 repository access APIs. Complete rendering, every photograph and COLMAP + images exports are established for 20 scenes; bounded model/header and sampled-media checks for the remaining entries do not imply complete exports. Eleven `Y1ue/DTU` mask inventories now exclude 485 macOS metadata sidecars, use real PNG samples and retain their unverified alignment status. The corresponding release changes only Expo and those 11 mask records; the other 5,225 scene records and the original 16 manifest selections remain unchanged. See [the audit scope and findings](../data/README.md#whole-catalog-audit).

Response caches include the catalog generation and UI version. Public catalog responses require browser revalidation and disable outer CDN caching; the Worker keeps a separate five-minute internal cache. Bump `HUB_UI_VERSION` in [src/shared/ui-version.ts](../src/shared/ui-version.ts) when changing templates or client assets; asset URLs and cache keys use the same constant.

The research inventory retains archive extraction requirements and import/delivery failures, but those cases are not published as datasets. Sample imports, model-only manifest checks and extracted-file checks retain separate scopes. See [the qualification audit](../data/README.md#full-inventory-audit) and the public `/hub/datasets/audit` page.

These are operator-curated public source entries. A separate **Shared on Hub** section loads explicit public submissions asynchronously, four at a time, using the same card and metadata styles. Its feed includes only server-verified records in `listed/`; it never enumerates private links, unlisted links or pending submissions. Curated search and filters retain their existing scope. Community verification is described in [Share on Hub](publication.md); it does not inherit the curated catalog's stronger evidence tiers.

### Missing component audit — October 19, 2026

The [component audit](scene-component-audit-2026-10-19.md) covers every initially missing role across all 5,579 prior scene cards. Two passes recovered 419 omitted labels across 335 scenes, including 79 photo labels/previews, and removed one empty geometry badge. All 59 published Fastmap scenes have sampled TAR photo evidence; 21 require calibration or undistortion review. A packed Gaussian PLY is identified as splats requiring conversion. Three sources returned HTTP 401 for required files, leaving 5,576 scenes in 144 collections, with 2,266 previews at that audit snapshot. The later NL3D verification adds seven scenes. The dated CSV and compressed full evidence are downloadable under additional coverage information. Checked scoped non-listing, uninspected containers, unclassified headers and unresolved associations remain distinct. Available-data labels describe scene inventory; a narrower launch manifest no longer erases independently verified companions. Archived components carry an archive label and an exact sampled member in the information panel.

### Confirmed facts and automatic archive media

The revision-bound decision log retains 5,551 confirmed outcomes, including all eight NL3D photo samples, and queues 32 unresolved associations. Run `npm run catalog:photo-plan -- --output .tmp/photo-work.json` before preparing new source reads. Existing inventories, photo samples, calibration mismatches and known omissions retain their original evidence scope; unchanged confirmed facts do not need another source scan. The CSV includes the decision, reuse scope and next action.

Version 2 companion manifests require viewer 0.19.2 or newer. That cohort added 478 MegaUnScene ZIP routes, 38 calibrated Fastmap TAR routes and one complete 896-name Dynamic Maps photo route, reaching 2,018 manifest launches at that snapshot. Twenty-one Fastmap TAR samples retain their calibration mismatch. The archive routes preserve model selection, statistics, masks, previews and export tiers. Their named-photo and calibration receipts are reused; full archive/photo coverage remains separate.

Dynamic Maps now records 896 poses instead of 448 and has a complete-frame preview. ALC901 uses the checked images_8 resize, with all 319 resulting calibrations and poses independently read through PyCOLMAP. Existing full original-photo exports remain unchanged. See `data/README.md` for the decision and replay contract.
