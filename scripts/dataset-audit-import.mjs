import { buildCatalog, publicUrl } from './catalog-import.mjs';

export const auditLabels = {
  header_checked: 'Format headers checked', file_set_only: '3D files listed; check incomplete',
  conversion_needed: 'Conversion needed', camera_only: 'Camera-only model',
  no_native_assets: 'No native 3D assets found', unavailable: 'Source unavailable',
  unverified: 'Further verification needed', audit_error: 'Further verification needed',
  viewer_checked: 'Sample opened in viewer',
};
const formatNames = { colmap: 'COLMAP', point_cloud_ply: 'XYZ point-cloud PLY', gaussian_ply: 'Gaussian PLY', spz: 'SPZ', sog: 'SOG',
  spz_v4: 'SPZ version 4', zstd_wrapped_splat: 'Zstandard-compressed splat', camera_metadata: 'Camera metadata',
  camera_only: 'COLMAP cameras and poses', geometry_conversion: 'Geometry requiring conversion', splat_extension_only: 'SPZ/SOG filename; payload unverified' };
export const formatName = value => formatNames[value] || value;

/** The outer download route must work as well as a contained format header. */
export function openingRequirement(result) {
  if (result.gated || result.delivery === 'gated') return { status: 'access_required',
    summary: 'Files require source access and cannot be downloaded anonymously. Obtain access and download the files on Hugging Face, then attempt local import. Direct gated loading and file compatibility are not established by this catalog.' };
  const archive = (result.probes || []).find(probe => probe.url === result.loadUrl && Number.isSafeInteger(probe.members));
  if (archive?.completeDirectory && archive.modelCount === 0 && result.level === 'header_checked' && !(result.formats || []).includes('colmap')) {
    return { status: 'extraction_required', summary: 'Supported-format headers were found inside the selected sample archive, which has no complete COLMAP model. The released viewer cannot open this archive directly. Extract the appropriate model file and attempt standalone import; other collection files, cameras, photos and masks remain unverified.' };
  }
  if (result.viewerImport?.status === 'failed' && !result.viewerImport.decoderError) return { status: 'load_failed',
    summary: 'The exact sampled source failed to import in the released viewer. See the recorded error; a successful byte read does not establish a working load.' };
  return undefined;
}

export function requiredProbeUrls(result) {
  if (result.loadUrl && !result.loadUrl.includes('/tree/')) {
    const exact = result.probes.find(probe => probe.url === result.loadUrl);
    if (exact) return [publicUrl(exact.url)];
  }
  return [...new Set(result.probes.filter(probe => probe.url).map(probe => publicUrl(probe.url)))];
}

function summary(result) {
  const formats = (result.formats || []).map(formatName).join(', ');
  if (result.level === 'header_checked') return `${formats} identified from original source headers. Complete scene parsing and rendering remain unverified.`;
  if (result.level === 'file_set_only') return '3D filenames are present, but the current source checks did not establish a readable, valid format header.';
  if (result.level === 'conversion_needed') return result.formats?.includes('zstd_wrapped_splat')
    ? 'The .spz file contains a Zstandard wrapper instead of a standard SPZ header. Decompress and identify the payload before opening it.'
    : `${formats || 'Source data'} requires conversion or a compatible importer; native loading in the released viewer is not established.`;
  if (result.level === 'camera_only') return 'Camera calibration and pose filenames are present without a complete geometry file set. Camera and photo loading needs a compatible importer.';
  if (result.level === 'no_native_assets') return result.detail || 'No native model was identified in the inspected source files. A reconstruction or conversion is needed.';
  if (result.level === 'unavailable') return 'The public repository metadata is unavailable. The source may have moved, become private, or been removed.';
  return 'A native model has not been established. Uninspected archives, packed data, custom camera schemas or external assets may need further checks.';
}

export function makeDatasetAudit(hfReport, publicReport, browserReport, viewerVersion, viewerReport = { results: [] }) {
  const browserByUrl = new Map(browserReport.results.map(result => [result.url, result]));
  const viewerBySource = new Map(viewerReport.results.map(result => [result.sourceId, result]));
  const records = [...hfReport.results, ...publicReport.results].map(result => {
    const viewerImport = viewerBySource.get(result.sourceId);
    const verifiedImport = viewerImport && (viewerImport.sourceUrl === result.loadUrl || result.probes.some(probe => probe.url === viewerImport.sourceUrl)) ? viewerImport : undefined;
    if (verifiedImport?.status === 'failed' && verifiedImport.decoderError) {
      result = { ...result, level: 'conversion_needed' };
    }
    if (verifiedImport?.status === 'passed' && result.level !== 'header_checked') {
      result = { ...result, level: 'viewer_checked', loadUrl: result.loadUrl || verifiedImport.sourceUrl };
    }
    const required = requiredProbeUrls(result);
    const checks = required.map(url => browserByUrl.get(url));
    let delivery = result.delivery || 'not_tested';
    if (required.length && checks.every(check => check?.delivery === 'browser_readable')) delivery = 'browser_readable';
    else if (checks.some(check => check && check.delivery !== 'browser_readable')) {
      delivery = checks.find(check => check && check.delivery !== 'browser_readable').delivery;
    } else if (delivery === 'not_tested' && result.probes.some(probe => probe.url)) delivery = 'server_readable';
    const scope = result.level === 'header_checked'
      ? 'Representative original format headers or SOG metadata; no full-scene render certification. Other models, photos and masks are not qualified by this sample.'
      : result.allArchivesInspected ? 'All listed archive directories inspected; no image previews created.'
        : 'Current public file listing and bounded source samples. Uninspected files and archives remain unverified.';
    return { ...result, delivery, requiredUrls: required,
      summary: verifiedImport?.status === 'failed' && verifiedImport.decoderError
        ? `The sampled file failed decoding in ColmapView ${viewerVersion}. Convert it to a compatible Gaussian PLY or legacy SPZ before opening it.`
        : verifiedImport?.status === 'passed'
        ? `${(result.formats || []).map(formatName).join(', ')} sample opened in ColmapView ${viewerVersion}. Other models, source photos and masks remain unverified.`
        : summary(result), scope,
      ...(verifiedImport ? { viewerImport: verifiedImport } : {}),
      browserChecks: checks.filter(Boolean).map(check => ({ url: check.url, delivery: check.delivery, checkedAt: check.checkedAt,
        ...(check.prefix ? { prefixStatus: check.prefix.status } : {}), ...(check.tail ? { tailStatus: check.tail.status } : {}) })) };
  });
  return { schemaVersion: 1, checkedAt: new Date().toISOString(), viewerVersion, origin: browserReport.origin,
    scope: 'Every previously included or rejected Hugging Face candidate and all public catalog entries. Format, access, browser transport and complete rendering are separate checks.',
    results: records.sort((a, b) => a.sourceId.localeCompare(b.sourceId, 'en')) };
}

function license(value) {
  return (Array.isArray(value) ? value.filter(item => typeof item === 'string').join(' | ') : typeof value === 'string' ? value.trim() : '') || 'Not specified';
}

export function applyDatasetAudit(snapshot, audit, hfRows = []) {
  if (audit.schemaVersion !== 1 || !Array.isArray(audit.results)) throw new Error('Invalid dataset audit');
  const bySource = new Map(audit.results.map(result => [result.sourceId, result]));
  if (bySource.size !== audit.results.length) throw new Error('Duplicate dataset audit source');
  const existing = new Set(snapshot.entries.map(entry => entry.sourceId));
  for (const row of hfRows) {
    const sourceId = `hf:${row.id}`;
    const result = bySource.get(sourceId);
    if (!existing.has(sourceId) && result?.level === 'header_checked' && result.loadUrl) {
      const recovered = buildCatalog({ hfRows: [{ ...row, status: 'direct_colmap', revision: result.revision,
        load_url: result.loadUrl, viewer_url: '', evidence: result.summary }], publicRows: [], auditRows: [], sources: [] });
      snapshot.entries.push(recovered.entries[0]);
      existing.add(sourceId);
    }
  }
  for (const entry of snapshot.entries) {
    const result = bySource.get(entry.sourceId);
    if (!result) throw new Error(`Dataset audit is missing ${entry.sourceId}`);
    const checkedAt = result.checkedAt.slice(0, 10);
    const opening = openingRequirement({ ...result, gated: result.gated ?? (entry.access === 'gated') });
    entry.verification = { level: result.level, delivery: result.delivery, checkedAt, summary: result.summary, scope: result.scope,
      ...(opening ? { opening } : {}),
      ...(result.sourceImages ? { sourceImages: result.sourceImages } : {}),
      viewerVersion: audit.viewerVersion };
    entry.status = `audited_${result.level}`;
    entry.statusLabel = auditLabels[result.level] || 'Further verification needed';
    if (result.viewerImport?.status === 'passed') entry.statusLabel = 'Sample opened in viewer';
    if (result.sourceImages?.status === 'not_included') entry.statusLabel = result.viewerImport?.status === 'passed'
      ? 'Model checked; RGB not included' : 'RGB not included; load unverified';
    if (opening) entry.statusLabel = { access_required: 'Access required', extraction_required: 'Extract archive before loading', load_failed: 'Sample failed to load' }[opening.status];
    entry.description = opening?.summary || result.summary;
    entry.checkedAt = checkedAt;
    if (result.formats?.length) entry.formats = result.formats.map(formatName);
    if ('license' in result) entry.license = license(result.license);
    if ('gated' in result) entry.access = result.gated ? 'gated' : 'public';
    const revision = entry.facts.find(fact => fact.label === 'Pinned revision');
    if (revision && result.revision) revision.value = result.revision;
    for (const [key, label] of [['modelCount', 'Complete COLMAP models listed'], ['archiveCount', 'Archives listed'], ['plyCount', 'PLY files listed']]) {
      const fact = entry.facts.find(fact => fact.label === label);
      if (fact && Number.isSafeInteger(result[key])) fact.value = String(result[key]);
    }
    delete entry.viewerUrl;
    delete entry.modelManifest;
    // Only offer links whose exact native sample passed anonymous reads in the viewer's origin.
    // Public archive scene entries keep their extraction instructions: one archive can contain many scenes.
    if (entry.access !== 'gated' && entry.provider === 'huggingface' && ['header_checked', 'viewer_checked'].includes(result.level) && result.delivery === 'browser_readable' && result.loadUrl) {
      const source = publicUrl(result.loadUrl);
      entry.dataUrl = source;
      if (!opening && result.viewerImport?.status !== 'failed') entry.viewerUrl = `https://colmapview.opsiclear.com/?url=${encodeURIComponent(source)}`;
    }
    if (!opening && entry.access !== 'gated' && entry.provider === 'public' && result.level === 'header_checked' && result.delivery === 'browser_readable'
      && result.loadUrl?.endsWith('/') && result.formats.includes('colmap')) {
      const base = new URL(publicUrl(result.loadUrl)).origin + '/';
      const native = result.probes.filter(probe => probe.path && probe.url);
      const relative = value => {
        const url = new URL(publicUrl(value));
        if (url.origin + '/' !== base) throw new Error('Loose model manifest must keep its assets on the inspected source origin');
        return decodeURIComponent(url.pathname.slice(1)) + url.search;
      };
      const files = Object.fromEntries(native.map(probe => [probe.path.toLowerCase().startsWith('points3d') ? 'points3D' : probe.path.split('.')[0], relative(probe.url)]));
      if (files.cameras && files.images && files.points3D) {
        const images = entry.facts.find(fact => fact.label === 'RGB base URL')?.value;
        entry.modelManifest = { version: 1, baseUrl: base, files,
          ...(images ? { imagesPath: relative(images) } : {}) };
        entry.dataUrl = `https://colmapview.opsiclear.com/hub/datasets/${entry.id}.manifest.json`;
        entry.viewerUrl = `https://colmapview.opsiclear.com/?url=${encodeURIComponent(entry.dataUrl)}`;
      }
    }
    const facts = [{ label: 'Result', value: result.summary }, { label: 'Scope', value: result.scope }];
    if (opening) facts.push({ label: 'Opening this source', value: opening.summary });
    if (result.viewerImport) facts.push({ label: 'Released viewer import', value: `${result.viewerImport.status}; ${result.viewerImport.scope}` });
    if (result.viewerImport?.error) facts.push({ label: 'Import error', value: result.viewerImport.error });
    if (result.modelFileImport) facts.push({ label: 'Model files only', value: `${result.modelFileImport.status}; ${result.modelFileImport.scope}` });
    if (result.extractedMemberImport) facts.push({ label: 'Extracted member import', value: `${result.extractedMemberImport.path}: ${result.extractedMemberImport.status}; ${result.extractedMemberImport.scope}` });
    for (const check of result.accessChecks || []) facts.push({ label: 'Anonymous file access', value: `HTTP ${check.status}${check.errorCode ? ` ${check.errorCode}` : ''}; checked ${check.checkedAt}`, url: publicUrl(check.url) });
    if (result.viewerImport?.decoderError) facts.push({ label: 'Decoder result', value: result.viewerImport.decoderError });
    if (result.detail) facts.push({ label: 'Recorded finding', value: result.detail });
    if (result.sourceImages) facts.push({ label: 'Source RGB', value: result.sourceImages.summary, url: publicUrl(result.sourceImages.sourceUrl) });
    if (result.licenseMetadata) facts.push({ label: 'Reported custom license', value: `${result.licenseMetadata.identifier}; ${result.licenseMetadata.name}`, url: publicUrl(result.licenseMetadata.sourceUrl) });
    if (result.listingComplete === false) facts.push({ label: 'Listing scope', value: `The source listing reached ${result.fileCount} files; completeness was not established in this bounded check.` });
    facts.push({ label: 'License evidence', value: entry.provider === 'huggingface'
      ? 'Reported by current public repository metadata. Coverage of underlying source assets was not independently verified.'
      : 'Recorded by the public-source catalog in October 2026. Source terms were not requalified by this format and delivery audit.' });
    if (result.revision) facts.push({ label: 'Inspected revision', value: result.revision });
    for (const probe of result.probes) {
      if (!probe.url) continue;
      const parts = [probe.path || probe.modelDirectory || 'Source sample'];
      if (probe.format) parts.push(formatName(probe.format));
      if (probe.records !== undefined) parts.push(`${probe.records} records in the header`);
      if (probe.vertices !== undefined) parts.push(`${probe.vertices} vertices in the header`);
      if (probe.members !== undefined) parts.push(`${probe.members} archive entries`);
      if (probe.sizeBytes) parts.push(`${probe.sizeBytes} bytes`);
      facts.push({ label: 'Inspected file', value: parts.join(' · '), url: publicUrl(probe.url) });
    }
    for (const issue of result.issues) facts.push({ label: 'Check limitation', value: `${issue.path ? `${issue.path}: ` : ''}${issue.error}` });
    for (const check of result.browserChecks) facts.push({ label: 'Browser read', value: `${check.delivery}${check.prefixStatus ? `; prefix HTTP ${check.prefixStatus}` : ''}${check.tailStatus ? `; tail HTTP ${check.tailStatus}` : ''}`, url: publicUrl(check.url) });
    entry.audits.push({ sourceId: `catalog-audit:${entry.sourceId}`, checkedAt, scope: 'source', facts });
  }
  snapshot.importSummary.hfEntries = snapshot.entries.filter(entry => entry.provider === 'huggingface').length;
  const counts = key => Object.fromEntries([...new Set(audit.results.map(result => result[key]))].map(value => [value, audit.results.filter(result => result[key] === value).length]));
  snapshot.auditSummary = { checkedAt: audit.checkedAt.slice(0, 10), sourcesAudited: audit.results.length, levels: counts('level'), delivery: counts('delivery'),
    ...(audit.evidenceRefresh ? { evidenceRefresh: audit.evidenceRefresh } : {}) };
  const rank = entry => entry.statusLabel === 'Sample opened in viewer' ? 0 : entry.viewerUrl ? 1 : entry.verification.level === 'header_checked' ? 2 : entry.verification.level === 'no_native_assets' || entry.verification.level === 'unavailable' ? 4 : 3;
  snapshot.entries.sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title, 'en'));
  return snapshot;
}
