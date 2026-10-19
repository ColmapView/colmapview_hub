import { createHash } from 'node:crypto';

/** CSV with quoted commas/newlines, escaped quotes, UTF-8 BOM and CRLF records. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false, closed = false;
  const endField = () => { row.push(field); field = ''; closed = false; };
  const endRow = () => { endField(); if (row.some(value => value !== '')) rows.push(row); row = []; };
  text = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character !== '"') field += character;
      else if (text[index + 1] === '"') { field += '"'; index++; }
      else { quoted = false; closed = true; }
    } else if (character === ',') endField();
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index++;
      endRow();
    } else if (character === '"' && !field && !closed) quoted = true;
    else {
      if (closed || character === '"') throw new Error('Invalid CSV quoting');
      field += character;
    }
  }
  if (quoted) throw new Error('Unterminated CSV field');
  if (field || row.length || closed) endRow();
  const columns = rows.shift();
  if (!columns?.length || columns.some(column => !column) || new Set(columns).size !== columns.length) throw new Error('Invalid CSV columns');
  return rows.map((values, index) => {
    if (values.length !== columns.length) throw new Error(`CSV row ${index + 2} has ${values.length} values; expected ${columns.length}`);
    return Object.fromEntries(columns.map((column, columnIndex) => [column, values[columnIndex]]));
  });
}

const excluded = new Set(['no_supported_3d_evidence', 'inspection_error']);
const ready = new Set(['direct_colmap', 'direct_gaussian_splat', 'direct_ply_point_cloud', 'archive_colmap_verified', 'archive_gaussian_verified', 'archive_ply_verified']);
const credentials = /^(?:access_token|refresh_token|token|sig|signature|secret_access_key|aws_secret_access_key|awsaccesskeyid|x-amz-(?:signature|credential|security-token)|x-goog-(?:signature|credential))$/i;

export function publicUrl(value) {
  if (!value?.trim()) return undefined;
  const url = new URL(value.trim());
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
    || [...url.searchParams.keys(), ...new URLSearchParams(url.hash.slice(1)).keys()].some(key => credentials.test(key))
    || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.href.length > 32768) {
    throw new Error('Catalog URLs must be public HTTP(S) URLs without credentials');
  }
  return url.href;
}

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Preserve reviewed false positives without letting a later import restore a viewer link. */
export function applyCatalogReviews(snapshot, reviews) {
  const seen = new Set();
  for (const review of reviews) {
    const entry = snapshot.entries.find(entry => entry.sourceId === review.sourceId);
    if (!entry || seen.has(review.sourceId)) throw new Error(`Unknown or duplicate catalog review: ${review.sourceId}`);
    seen.add(review.sourceId);
    if (!review.revision || entry.facts.find(fact => fact.label === 'Pinned revision')?.value !== review.revision) {
      throw new Error(`Catalog review revision changed; recheck ${review.sourceId}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(review.checkedAt) || !review.description?.trim()
      || !Array.isArray(review.formats) || !review.formats.every(format => typeof format === 'string')
      || !Array.isArray(review.facts) || !review.facts.length) throw new Error('Invalid catalog review');
    const sourceUrl = publicUrl(review.sourceUrl);
    if (!sourceUrl) throw new Error('Catalog review requires its evidence URL');
    const reviewedFacts = review.facts.map(fact => {
      if (!fact.label?.trim() || !fact.value?.trim()) throw new Error('Invalid catalog review fact');
      return { label: fact.label, value: fact.value, ...(fact.url ? { url: publicUrl(fact.url) } : {}) };
    });
    entry.status = 'unsupported_content';
    entry.statusLabel = 'Not loadable in ColmapView';
    entry.description = review.description;
    entry.formats = review.formats;
    entry.checkedAt = review.checkedAt;
    if (entry.verification) entry.verification.summary = review.description;
    delete entry.viewerUrl;
    entry.audits.push({ sourceId: `review:${review.sourceId}:${review.revision}`, sourceUrl,
      checkedAt: review.checkedAt, scope: 'source', facts: reviewedFacts });
  }
  return snapshot;
}

function stableId(sourceId) {
  const slug = sourceId.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64).replace(/-$/, '') || 'dataset';
  return `${slug}-${sha256(sourceId).slice(0, 12)}`;
}

/** Retain explicitly reviewed source metadata that the older research filters omitted. */
export function applySceneSourceOverrides(snapshot, policy) {
  if (policy.schemaVersion !== 1 || !Array.isArray(policy.additions) || !Array.isArray(policy.publicScenes)) {
    throw new Error('Invalid scene source overrides');
  }
  const seen = new Set();
  for (const addition of policy.additions) {
    const revision = addition.facts?.find(fact => fact.label === 'Pinned revision')?.value;
    if (addition.provider !== 'huggingface' || !/^hf:[^/]+\/.+/.test(addition.sourceId) || seen.has(addition.sourceId)
      || addition.id !== stableId(addition.sourceId) || addition.access !== 'public' || !/^[a-f0-9]{40}$/.test(revision || '')
      || publicUrl(addition.sourceUrl) !== `https://huggingface.co/datasets/${addition.sourceId.slice(3)}`
      || !publicUrl(addition.dataUrl) || !addition.title || !addition.license || !addition.description
      || !Array.isArray(addition.formats) || !Array.isArray(addition.audits)
      || ['viewerUrl', 'candidateViewerUrl', 'openUrl', 'modelManifest'].some(key => key in addition)) {
      throw new Error('Invalid reviewed source addition');
    }
    seen.add(addition.sourceId);
    const existing = snapshot.entries.find(entry => entry.sourceId === addition.sourceId);
    if (existing) {
      if (existing.id !== addition.id || existing.facts.find(fact => fact.label === 'Pinned revision')?.value !== revision) {
        throw new Error(`Reviewed source addition changed; recheck ${addition.sourceId}`);
      }
    } else snapshot.entries.push(structuredClone(addition));
  }
  for (const selection of policy.publicScenes) {
    const entry = snapshot.entries.find(entry => entry.sourceId === selection.sourceId);
    if (!entry || entry.provider !== 'public' || seen.has(selection.sourceId)
      || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(selection.revision || '') || !selection.loadUrl?.startsWith('https://')
      || publicUrl(selection.loadUrl) !== selection.loadUrl) throw new Error('Invalid reviewed public scene source');
    seen.add(selection.sourceId);
    entry.dataUrl = selection.loadUrl;
    entry.facts = entry.facts.filter(fact => fact.label !== 'Pinned revision');
    entry.facts.push({ label: 'Pinned revision', value: selection.revision });
  }
  snapshot.importSummary.hfEntries = snapshot.entries.filter(entry => entry.provider === 'huggingface').length;
  return snapshot;
}

function facts(row, labels) {
  return Object.entries(labels).flatMap(([key, label]) => {
    const value = row[key]?.trim();
    return value ? [{ label, value: value === 'True' ? 'Yes' : value === 'False' ? 'No' : value,
      ...(/_url$/.test(key) && /^https?:\/\//i.test(value) ? { url: publicUrl(value) } : {}) }] : [];
  });
}

const auditLabels = {
  source_kind: 'Inspected source type', access: 'Recorded access',
  complete_model_records: 'Complete model records listed', camera_only_records: 'Camera-only records listed',
  rgb_files_listed: 'RGB files listed', mask_files_listed: 'Mask files listed',
  representative_pairs_checked: 'Representative model/media pairs checked', all_sampled_paths_match: 'Pairs with all sampled paths matching',
  unmatched_sample_pairs: 'Pairs with unmatched sampled paths', ambiguous_sample_pairs: 'Pairs with ambiguous matches',
  metadata_read_failures_or_custom_format: 'Metadata failures or custom formats',
  original_model_dirs_verified_in_both_browsers: 'Original model directories checked in both browsers',
  current_sampled_layouts_auto_bound: 'Sampled layouts bound automatically',
  current_sampled_layouts_offer_selection: 'Sampled layouts offering photo selection',
  current_sampled_layouts_unresolved: 'Sampled layouts still unresolved',
  camera_only_pairs_structurally_discovered: 'Camera-only pairs discovered structurally',
  full_original_camera_only_model_browser_checked: 'Full original camera-only model checked in browser',
  camera_only_checked_pose_count: 'Camera-only poses checked',
  camera_only_full_model_photo_path_matches: 'Camera-only model photo paths matched',
  original_complete_rgb_camera_only_scene_browser_checked: 'Complete original RGB camera-only scene checked',
  qualification_limit: 'Scope of this check', recovery_notes: 'Loading notes',
};

const hfLabels = {
  id: 'Repository', revision: 'Pinned revision', last_modified: 'Repository updated at scan',
  model_count: 'Complete COLMAP models listed', archive_verified_model_count: 'Models found in sampled ZIPs',
  image_file_count: 'Image files listed in repository', archive_count: 'Archives listed',
  ply_file_count: 'PLY files listed', splat_file_count: 'Other splat files listed',
  geometry_file_count: 'Other geometry files listed', geometry_extensions: 'Other geometry formats',
  example_model_directory: 'Example model directory', example_archive: 'Example archive',
  sampled_archive_size_bytes: 'Sampled archive size in bytes', example_point_count: 'Sample model point count',
  confidence: 'Evidence level', colmap_probe_state: 'Sampled COLMAP header check',
  access_note: 'Access notes', likes: 'Hugging Face likes at scan', downloads: 'Hugging Face downloads at scan',
};

const publicLabels = {
  collection: 'Collection', scene: 'Scene or subset', variant: 'Variant',
  colmap_model_directory: 'COLMAP model directory', camera_metadata_path: 'Camera metadata path',
  source_registered_images: 'Registered image count', source_sparse_points_header: 'Source point count from header',
  source_camera_records: 'Source camera records', supplied_full_resolution_rgb_files: 'Full-resolution RGB files listed',
  supplied_rgb_files: 'RGB files listed', supplied_mask_files: 'Mask files listed',
  matching_rgb_references: 'Matching RGB references', mask_route: 'Mask information', export_route: 'Recorded export route',
  browser_get_both_origins: 'Browser GET from both viewer origins', browser_range_both_origins: 'Browser range checks',
  validation_tier: 'Validation level', validation: 'Validation evidence', notes: 'Source notes',
  usage_condition: 'Usage conditions', browser_delivery_status_2026_10_14: 'Browser delivery check (2026-10-14)',
  browser_delivery_note_2026_10_14: 'Browser delivery notes (2026-10-14)',
  data_url: 'Original dataset URL', camera_url: 'Camera metadata URL', pose_url: 'Pose metadata URL', points_url: 'Point metadata URL',
  image_base_url: 'RGB base URL', image_url: 'Sample image URL', browser_checked_urls_2026_10_14: 'Browser-tested file URLs (2026-10-14)',
};

const titleStatus = status => ready.has(status) ? status.startsWith('archive_') ? 'Sampled archive checked' : 'Format identified'
  : status.includes('conversion') ? 'Conversion needed' : status === 'camera_only_missing_geometry' ? 'Camera-only model' : 'Further verification needed';

function urlIdentity(value) {
  const url = new URL(publicUrl(value));
  if (url.hostname === 'storage.googleapis.com') {
    const api = /^\/storage\/v1\/b\/([^/]+)\/o\/(.+)$/.exec(url.pathname);
    const path = api ? `${api[1]}/${decodeURIComponent(api[2])}` : decodeURIComponent(url.pathname.slice(1));
    return `gcs:${path}`;
  }
  return url.href;
}

function collectionIdentity(value) {
  if (!value) return undefined;
  const url = new URL(publicUrl(value));
  const record = url.hostname === 'zenodo.org' && /^\/(?:api\/)?records\/(\d+)(?:\/|$)/.exec(url.pathname);
  return record ? `zenodo:${record[1]}` : undefined;
}

function auditsFor(rows, entryUrls = []) {
  return rows.map(row => ({ sourceId: row.source_id, ...(publicUrl(row.url) ? { sourceUrl: publicUrl(row.url) } : {}),
    checkedAt: '2026-10-15', scope: entryUrls.length && !entryUrls.includes(urlIdentity(row.url)) ? 'collection' : 'source', facts: facts(row, auditLabels) }));
}

function viewerLink(value) {
  const url = new URL(publicUrl(value));
  if (!['https://colmapview.github.io', 'https://colmapview.opsiclear.com'].includes(url.origin)) throw new Error('Unexpected viewer URL in catalog');
  const source = publicUrl(url.searchParams.get('url'));
  if (!source) throw new Error('Viewer link has no dataset URL');
  // The GitHub root redirect does not retain query parameters. Use the production viewer directly.
  return `https://colmapview.opsiclear.com/${url.search}${url.hash}`;
}

export function buildCatalog({ hfRows, publicRows, auditRows, sources }) {
  const entries = [];
  const usedAudits = new Set();
  for (const row of hfRows) {
    if (excluded.has(row.status)) continue;
    if (!row.id || !row.status || !row.dataset_url) throw new Error('HF catalog is missing required fields');
    const related = auditRows.filter(audit => audit.dataset === row.id);
    related.forEach(audit => usedAudits.add(audit.source_id));
    const sourceId = `hf:${row.id}`;
    entries.push({ id: stableId(sourceId), sourceId, provider: 'huggingface', title: row.id,
      sourceUrl: publicUrl(row.dataset_url), ...(publicUrl(row.load_url) ? { dataUrl: publicUrl(row.load_url) } : {}),
      ...(ready.has(row.status) && row.viewer_url ? { viewerUrl: viewerLink(row.viewer_url) } : {}),
      license: row.license?.trim() && row.license !== 'not specified' ? row.license.trim() : 'Not specified',
      access: row.gated === 'False' || row.gated === 'false' ? 'public' : row.gated ? 'gated' : 'unknown',
      status: row.status, statusLabel: titleStatus(row.status), formats: (row.asset_kinds || '').split(' | ').filter(Boolean),
      description: row.evidence || 'Public repository identified in the dataset survey.',
      checkedAt: '2026-10-13', testOrFixture: row.test_or_fixture?.toLowerCase() === 'true',
      facts: facts(row, hfLabels), audits: auditsFor(related),
    });
  }
  for (const row of publicRows) {
    if (!row.collection || !row.scene || !row.source_url || !row.data_url) throw new Error('Public catalog is missing required fields');
    const sourceId = `public:${JSON.stringify([row.collection, row.scene, row.variant || ''])}`;
    const title = `${row.collection} — ${row.scene}${row.variant ? ` (${row.variant})` : ''}`;
    const urls = [row.data_url, row.current_checked_load_url].filter(Boolean).map(urlIdentity);
    const collections = [row.source_url, row.data_url].map(collectionIdentity).filter(Boolean);
    const related = auditRows.filter(audit => !audit.source_kind.startsWith('hf-') && (urls.includes(urlIdentity(audit.url))
      || (collectionIdentity(audit.url) && collections.includes(collectionIdentity(audit.url)))));
    related.forEach(audit => usedAudits.add(audit.source_id));
    const delivery = row.browser_delivery_status_2026_10_14 || '';
    const native = /^native COLMAP/i.test(row.export_route || '');
    entries.push({ id: stableId(sourceId), sourceId, provider: 'public', title,
      sourceUrl: publicUrl(row.source_url), dataUrl: publicUrl(row.current_checked_load_url || row.data_url),
      license: row.data_license?.trim() || 'Not specified',
      access: /(?:custom|click-through|agreement)/i.test(`${row.data_license} ${row.usage_condition}`) ? 'terms' : 'public',
      status: /blocked|fail|unavailable|unverified/i.test(delivery) ? 'delivery_issue' : native ? 'native_colmap_source' : 'source_sample_checked',
      statusLabel: /blocked|fail|unavailable|unverified/i.test(delivery) ? 'Delivery issue recorded' : native ? 'Native COLMAP source' : 'Source sample checked',
      formats: [row.export_route || 'See source metadata'],
      description: row.validation_tier || row.validation || 'Public scene or subset recorded in the dataset survey.',
      checkedAt: delivery ? '2026-10-14' : '2026-10-13', testOrFixture: false,
      facts: facts(row, publicLabels), audits: auditsFor(related, urls),
    });
  }
  // Preserve audited sources outside the browser-readable catalog as explicitly qualified entries.
  // In particular, a metadata record must not disappear merely because its browser delivery failed.
  const extraAudits = auditRows.filter(audit => !usedAudits.has(audit.source_id));
  for (const audit of extraAudits) {
    const sourceUrl = publicUrl(audit.url);
    const url = new URL(sourceUrl);
    const filename = decodeURIComponent(url.pathname.split('/').filter(part => part && part !== 'content').at(-1) || audit.dataset);
    const title = `${filename.replace(/\.(?:zip|tar|gz)$/i, '').replace(/_/g, ' ')} — ${url.hostname}`;
    const sourceId = `audit:${audit.source_id}`;
    entries.push({ id: stableId(sourceId), sourceId, provider: 'public', title, sourceUrl, dataUrl: sourceUrl,
      license: 'Not specified', access: audit.access === 'access_required' ? 'gated' : 'public',
      status: 'audit_only_source', statusLabel: 'Additional audited source', formats: ['See loading evidence'],
      description: audit.qualification_limit || 'Source included in the dataset loading audit.', checkedAt: '2026-10-15', testOrFixture: false,
      facts: [], audits: auditsFor([audit]) });
    usedAudits.add(audit.source_id);
  }
  const ids = new Set(), sourceIds = new Set();
  for (const entry of entries) {
    if (ids.has(entry.id) || sourceIds.has(entry.sourceId)) throw new Error(`Duplicate catalog entry: ${entry.sourceId}`);
    ids.add(entry.id); sourceIds.add(entry.sourceId);
  }
  entries.sort((a, b) => a.title.localeCompare(b.title, 'en'));
  return { schemaVersion: 1, sources, entries,
    importSummary: { hfCandidates: hfRows.length, hfEntries: entries.filter(entry => entry.provider === 'huggingface').length,
      publicEntries: publicRows.length, additionalAuditEntries: extraAudits.length, auditRows: auditRows.length, linkedAuditRows: usedAudits.size,
      unlinkedAuditSourceIds: auditRows.filter(audit => !usedAudits.has(audit.source_id)).map(audit => audit.source_id) } };
}
