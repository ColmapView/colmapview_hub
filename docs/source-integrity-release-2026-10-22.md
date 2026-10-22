# Source-integrity release verification — October 22, 2026

Hub **0.10.12** and viewer **0.20.6** are deployed. This is the production follow-up to the [local source-integrity safeguards](catalog-source-integrity-fixes-2026-10-22.md) and [calibration corrections](catalog-calibration-fixes-2026-10-22.md). The [machine-readable receipt](../data/catalog-source-integrity-release-2026-10-22.json.gz) has SHA-256 `7152c20f5e7c5978aa0b4bd48d77999e97386a959018c1a974fe7f619af7a050`. Earlier audit receipts remain unchanged.

| Deployment | Exact identity |
| --- | --- |
| Hub release | [`v0.10.12`](https://github.com/ColmapView/colmapview_hub/releases/tag/v0.10.12), source `4d0537d6d14fe432bcdf7ae4a1b8511b6b85ba6a` |
| Worker version | `83f00deb-8c62-489a-8334-0755869f612b` |
| Published catalog generation | `ead2be387738bad1f4ff93d7e43b5638ee925732b6617497ef68ece3ad57f8b6` |
| Viewer release | [`v0.20.6`](https://github.com/ColmapView/Colmapview.github.io/releases/tag/v0.20.6), source `64a72ed0ae44cd70b7ea4877ffa04fde11a24dac` |

The viewer release workflow passed its code/unit, artifact and Chromium gates before uploading: 6,638 unit tests and 335 Chromium checks passed; 22 optional source-fixture checks were skipped. Its own live checks passed against the prepared artifact manifests. Independent follow-up reads matched the source SHA, version, profile, HTML digest and public entry scripts at the [custom viewer](https://colmapview.opsiclear.com/), [GitHub latest](https://colmapview.github.io/latest/) and [versioned GitHub viewer](https://colmapview.github.io/v0.20.6/). The Google Drive account control is present on the custom host and absent on GitHub. All 2,610 manifest schemas also passed against the release source with zero invalid or missing files. A real-worker regression passed original-observation reads beyond a 2 GiB offset.

On both production hosts, the unchanged failing native model `data-228a2d5da2df0ef10b25feb1` loaded through the public file-drop workflow, displayed the integrity warning, blocked ZIP export with an explanation and still downloaded its 32,438-point PLY. Replacing it with the previously accepted local diagnostic fixture cleared the warning and enabled ZIP download. Both downloaded models were accepted independently by PyCOLMAP 4.2.1 with one camera, 333 registered poses and 32,438 points. All three native model bodies exactly matched the previously compared fixture, reusing its 287,979 observation and 253,371 track-reference comparisons. No page exceptions occurred. The diagnostic fixture is test data, not a published repair.

The Hub checks matched all 36 affected production metadata packs byte-for-byte against the release build: 25 source-integrity reviews (four complete-model and 21 bounded-sample scopes), nine calibration reviews and 210 native photo-resolution differences. The whole catalog has 211 resolution-difference flags, including one pre-existing non-native camera-scene case. All 4,559 scenes, 144 source records, 2,610 manifests and 80 saved-state bodies are retained. CSS returned 200 with an ETag; catalog/detail, API, preview, management, direct-view and legacy share routes passed. The production detail page showed the complete-model warning and retained its direct viewer link.

No provider credentials, user records, policy dates or authentication service were changed. `/auth/session` remained uncacheable, set no cookie, returned no accounts or bucket and reported all retired server-auth capabilities disabled. Existing browser-only provider authentication remains unchanged.

These checks confirm the deployed safeguards and scoped catalog metadata. They do not repair upstream feature links or certify every model, calibration, photo alignment or complete photograph export. The retained audit documents describe those scientific and sampling limits. Test files, browser screenshots and complete operational logs remain in ignored local `.tmp/source-integrity-fixes-20261022/` directories.
