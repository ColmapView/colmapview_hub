# Gallery CPU budget, November 5, 2026

Cloudflare's free Workers limit is 10 ms of CPU per invocation. The account's
usage email reported at least 1,000 CPU-limit events in 24 hours. A read-only
analytics query covering November 4–5 returned 21,787 successful invocations,
7 disconnected clients and 8,592 resource-limit errors for `colmapview-hub`.
An error-only live tail captured eight `exceededCpu` events on `GET /hub/` in
45 seconds, all returning 503. The aggregate resource-limit category can include
other resource limits; the live sample identifies CPU on the gallery route.

The previous homepage chose a fresh seed, read and parsed the catalog and feed
order, queried D1 summaries, rendered the complete filter UI and 24 cards, then
hashed the HTML. Fresh requests bypassed the rendered-response cache. The public
index endpoint also parsed and serialized an already-built JSON asset.

The homepage now streams one of two offline-built gallery shells. The browser
uses the existing asynchronous gallery flow for search, filters, shuffle and
pagination. The two shells retain the OpsiClear/GitHub viewer choice. The index
endpoint streams the original built JSON and its validator. Both routes retain
the existing security, consent, CORS and HEAD behavior. No database schema,
credential handling, publication guard or billing setting changes.

The correctness review added two failure-path safeguards: the backend gallery
starts without waiting on optional index refreshes, and saved filter values remain
selected even when the shell or refreshed index lacks an option. GitHub's index
refresh is time-bounded; a failed refresh loads fresh scene results rather than
restoring a snapshot whose generation could not be checked. Unused asset streams
are cancelled for HEAD and conditional responses.

## Local comparison

Actual before/after route code was bundled with esbuild and run in Node 24 on
Windows against the built public assets and an in-memory D1 summary fixture.
Each measurement aggregates CPU over 500 requests after five warm-up requests;
aggregation avoids Windows' coarse per-request CPU timer resolution. Response
consumption is included. Disk contents were cached in memory. This isolates local
code cost and does not reproduce Cloudflare's hardware, cold isolates or network.

| Endpoint | Before mean CPU | After mean CPU | D1 queries after |
| --- | ---: | ---: | ---: |
| Homepage | 4.904 ms | 0.094 ms | 0 |
| Public index | 1.436 ms | 0.188 ms | 0 |

The scene search API is unchanged; its measured mean was about 1.1–1.3 ms in the
same fixture. Local timings do not establish production CPU headroom. After
deployment, repeat the live tail and check resource-limit outcomes and successful
page loads. The local comparison and post-deployment samples are retained in
the ignored `.tmp/cf-usage/` directory.

## Production observation, November 7

A read-only `workersInvocationsAdaptive` query for `colmapview-hub` covering
November 6 at 05:56:24 UTC through November 7 at 05:56:24 UTC returned 4,007
successful requests and zero errors. No resource-limit outcome appeared in
that 24-hour response. This is an aggregate observation of the deployed
optimization, not a measurement of per-route CPU time or a guarantee against
future failures. The sanitized response is retained locally as
`.tmp/cf-usage/worker-outcomes-24h-2026-11-07.json`.

The follow-up keeps scene requests scoped to saved collection IDs without
creating options for unknown or excluded collections. Valid source-specific
aliases can be confirmed by the existing scene response even if index refresh
fails. Both gallery hosts explicitly require JavaScript; their fallback text
retains viewer and policy links without promising server-rendered pagination.
The homepage continues streaming its built HTML without D1 queries or runtime
catalog parsing.
