# Scene discovery feed

The Hub presents one card per qualified named scene in a full-width responsive
grid: three columns on desktop, four on wide screens, two on tablets and one on
phones. Automatic scrolling retains the same ranked ordering across rows. Dataset
payloads remain in their original locations; scrolling reads public catalog
metadata and local preview assets only. Existing launch manifests, evidence,
licensing, statistics, photograph paths and access checks retain their meanings.

## Selection and ranking

1. Apply search, collection, provider, license, evidence, scene type, photo and
   available-data filters before ranking. Use the existing scene publication and
   `canOpenIndividual` checks. Missing photographs or zero native points do not
   disqualify a scene.
2. Rank model confidence in three tiers: complete checked scene/model export;
   native model checks with browser-readable delivery; native model checks with
   checked CORS headers. Model-only and photo exports receive the same model
   confidence. Preview availability is a small tie breaker within a tier.
3. Discover uses six ranked, three random and one newly catalogued selection in
   each ten positions. Every lane shares one used set. Camera counts, point
   counts, audit dates and external downloads are not quality scores.
4. Balance exposure across collections. Group public source records with the same
   published collection label. Prefer at most two scenes per collection in a
   rolling twenty-item window, and separate adjacent collections. Relax these
   preferences when filtered collections are exhausted. A single-collection
   search must still reach every matching scene.
5. Random chooses among collections with the least exposure, using seeded random
   tie breaks, then an unselected scene in the chosen collection. This prevents
   ScannetPoseRefine's 3,026 scenes from overwhelming smaller collections.
6. New to Hub sorts recorded first-catalogued days newest first, with collection
   diversity within a day. Unknown dates follow known dates. This is not a claim
   about the dataset's creation or publication date.

Performance and popularity are neutral until reliable measurements exist. No
tracking service, preference profile, recommendation model or database is added.
Distinct known scene IDs are not repeated in an ordering. Cross-provider mirrors
are not guessed to be identical; canonical mirror associations require evidence.

## Publication history

`data/scene-discovery-history.json.gz` records the first-catalogued date of each
stable scene ID. Existing scenes share the October 19, 2026 tracking baseline.
Subsequent evidence refreshes, changed ordinals, removals and reappearances retain
their original dates. A normal build never writes publication-history inputs or
uses the current clock to manufacture new dates.

After building a changed, reviewed scene catalog, record newly qualified scenes:

```sh
npm run build:catalog
npm run catalog:discovery -- --date YYYY-MM-DD
npm run build:catalog
```

Commit the updated history with the release. The command rejects incomplete
catalogs, duplicate IDs and future dates. Its second run adds no entries. Scenes
without a recorded date remain eligible and receive neutral novelty.

The Python projection writes a compact `feed.json` of evidence tier, preview flag
and first-catalogued day, indexed by scene ordinal. The index, feed and all other
catalog assets share the existing catalog generation. Generation hashing includes
history and discovery projection source bytes. The Worker validates this asset
before ranking, then reads only the selected page's bounded metadata packs.

## Stable ordering and scrolling

The API accepts `sort=discover|random|new` and an optional 8–32 lowercase hex `seed`.
An unseeded initial request generates a fresh cryptographic seed and bypasses the
response cache. Responses return the actual selection in `feed: {mode, seed}`.
API requests and server-rendered fallback forms and pagination carry that seed.
Shuffle generates a fresh
cryptographic seed while preserving the active mode and filters. The seed is
ordering state, not a user identifier. Search responses revalidate against both
the current catalog generation and the UI release key. The browser keeps the visit's
seed in history state, leaving only filters in the visible URL. API requests and
the no-JavaScript pagination fallback still carry the seed. Existing seeded links
are accepted and cleaned after loading. Separate visits and Shuffle entries have
independent return snapshots even when their visible URLs match. Refresh
starts a new feed at the first page with a fresh seed, preserving the active filters.
Copying the visible URL shares its filters and starts a fresh ordering when opened.

The browser appends 24 scenes when a sentinel approaches the viewport. It keeps
manual Load more/Retry controls and server-rendered Previous/Next links for
disabled JavaScript, missing observers and failed requests. The end is explicit;
the feed never cycles silently. An automatic request failure pauses automatic
loading until an explicit retry. Stale responses, duplicate cards, wrong page
numbers and mismatched feed selections cannot append to the current ordering.
A catalog-generation change starts a fresh first page rather than mixing versions.
If a search completes while a scene information panel is open, defer replacing
its cards until the panel closes so its links and keyboard interaction stay usable.
Automatic loading also pauses while catalog notes are open. An in-flight page
waits for the notes to close before inserting cards, keeping the audit links stationary.

Preview images are lazy loaded, uncropped and dimensioned. Offscreen cards defer
layout with `content-visibility`; full 3D scenes are opened only through a viewer
link. Existing information buttons keep metadata in a dialog panel.
Empty previews retain the full card preview space. Information panels link to the
recorded original source page for both server-rendered and appended scene cards.
Cards reserve two title lines and two data-label lines, expanding the latter when
needed. Each data label stays together and camera/point statistics use two columns.
Preview frames fill the remaining row space while photographs retain their proportions.

Return navigation uses a bounded, per-tab session cache of public summaries and
the visible scene anchor. It retains at most 240 contiguous scenes per saved view,
three views and one million serialized characters, restoring the same scene and
offset when returning from the viewer. Refresh starts a new ordering. Longer
sessions restore a window around the visible scene with Previous navigation for earlier pages.
The feed records the selected card, owns browser scroll restoration, waits for
font and deferred card layout to settle, and cancels positioning on user input.
Blocked storage does not prevent browsing. Nothing is uploaded or retained as a
cross-session viewing profile, and an obsolete generation's cache is ignored.

## Verification

Regression coverage checks deterministic permutations, nonoverlapping pages,
different seeds, dominant-collection diversity, chronological ordering, unknown
dates, single-collection exhaustion, camera-only eligibility, composed filters,
invalid inputs, stale discovery assets and publication-date persistence.

Browser coverage checks automatic append, shuffle/filter preservation, bounded
retry behavior, duplicate rejection, viewer return restoration and refresh reshuffling, disabled
storage/observers, finite results and existing metadata panels. Existing catalog,
access-control, share-link and auth-retirement compatibility suites remain required.
