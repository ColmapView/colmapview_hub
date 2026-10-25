import { accessLabel, catalogSummary, datasetPath, datasetFilterValue, deliveryLabel, providerLabel } from '../shared/catalog';
import type { CatalogEntry, CatalogFact, CatalogSnapshot, CatalogSummary } from '../shared/catalog';
import { licenseCategory, LICENSE_CATEGORY_LABELS } from '../shared/license-categories';
import { escapeHtml as escape, intro, page } from './pages';
import { catalogCardHtml as catalogCard } from '../shared/catalog-card';
import { photoLabel } from '../shared/scene-photos';
import type { PhotoStatus } from '../shared/scene-photos';
import { sceneContentsHtml, sceneStatisticsHtml, sceneThumbnailHtml } from '../shared/scene-contents';
import { datasetSharePath } from '../shared/dataset-share';
export { catalogCard };
import type { HubLocation } from './pages';

const location: HubLocation = { origin: 'https://colmapview.opsiclear.com', path: '/hub', base: 'https://colmapview.opsiclear.com/hub', local: false };
const number = (value: number) => value.toLocaleString('en-US');
const factList = (facts: CatalogFact[]) => `<dl class="dataset-facts">${facts.map(fact => `<div><dt>${escape(fact.label)}</dt><dd>${fact.url
  ? `<a href="${escape(fact.url)}" rel="noreferrer">${escape(fact.value)}</a>` : escape(fact.value)}</dd></div>`).join('')}</dl>`;
const tags = (entry: CatalogSummary) => `<p class="dataset-tags">${entry.dataset ? `<a class="dataset-tag" href="/hub/datasets/?dataset=${encodeURIComponent(datasetFilterValue(entry))}">Collection: ${escape(entry.dataset.label)}</a>` : ''}`
  + `${entry.itemKind ? `<span class="dataset-tag">${escape(entry.itemKind)}</span>` : ''}<span class="dataset-tag">${escape(providerLabel(entry.provider))}</span>`
  + `<span class="dataset-tag dataset-license-category">License: ${LICENSE_CATEGORY_LABELS[licenseCategory(entry)]}</span>`
  + `<span class="dataset-tag">${escape(entry.statusLabel)}</span>${entry.photoStatus ? `<span class="dataset-tag">${escape(photoLabel(entry.photoStatus))}</span>` : ''}${entry.delivery ? `<span class="dataset-tag">${escape(deliveryLabel(entry.delivery))}</span>` : ''}${entry.testOrFixture ? '<span class="dataset-tag">Test / demo</span>' : ''}</p>`;

function social(url: string, title: string, description: string): string {
  return `<link rel="canonical" href="${escape(url)}"><meta property="og:type" content="website"><meta property="og:url" content="${escape(url)}">`
    + `<meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta name="twitter:card" content="summary">`;
}

export function catalogEntryPage(entry: CatalogEntry, analytics = true): string {
  const share = entry.shareName ? datasetSharePath(entry.id, entry.shareName) : undefined;
  const action = (label: string, href: string, primary = false) => `<a class="button${primary ? ' button-primary' : ''}" href="${escape(href)}"${primary ? ' data-analytics-open' : ''} target="_blank" rel="noopener noreferrer">${label}<span aria-hidden="true"> ↗</span></a>`;
  const gated = entry.access === 'gated' || entry.verification?.delivery === 'gated';
  const blocked = gated || Boolean(entry.verification?.opening);
  const viewerUrl = !blocked && entry.viewerUrl ? share || entry.viewerUrl : undefined;
  const candidateViewerUrl = !blocked && entry.candidateViewerUrl ? share || entry.candidateViewerUrl : undefined;
  const dataLabel = entry.verification?.opening?.status === 'extraction_required' ? 'Download archive' : 'Dataset URL';
  const actions = action(gated ? 'Get source access' : entry.sourceUrl === entry.dataUrl ? dataLabel : 'Source', entry.sourceUrl)
    + (!gated && entry.dataUrl && entry.dataUrl !== entry.sourceUrl ? action(dataLabel, entry.dataUrl) : '')
    + (viewerUrl ? action('Try in ColmapView', viewerUrl, true) : '');
  const individualAction = candidateViewerUrl ? action('Try listed model (unchecked)', candidateViewerUrl) : '';
  const audits = entry.audits.map(audit => {
    const name = audit.sourceUrl ? decodeURIComponent(new URL(audit.sourceUrl).pathname.split('/').filter(part => part && part !== 'content').at(-1) || audit.sourceId) : audit.sourceId;
    return `<details class="dataset-audit"><summary>${escape(name)} · checked ${escape(audit.checkedAt)}</summary>`
      + (audit.scope === 'collection' ? '<p class="note">Another file in the same source collection; these checks do not certify this entry’s scene.</p>' : '')
      + (audit.sourceUrl ? `<p><a href="${escape(audit.sourceUrl)}" rel="noreferrer">Inspected source ↗</a></p>` : '')
      + factList(audit.facts) + '</details>';
  }).join('');
  const preview = sceneThumbnailHtml(entry);
  return page(location, entry.title,
    '<p class="dataset-back"><a href="/hub/datasets/">← All datasets</a></p>'
    + `<div class="dataset-overview${preview ? ' dataset-overview-has-preview' : ''}" data-entry-id="${escape(entry.id)}">`
    + (preview ? `<div class="dataset-overview-preview">${preview}</div>` : '')
    + '<div class="dataset-overview-content">'
    + intro(entry.title, entry.description, tags(catalogSummary(entry)))
    + sceneContentsHtml(entry.availableData) + sceneStatisticsHtml(entry.sceneStats)
    + `<div class="actions">${actions}${individualAction}${datasetSharePath(entry.id, entry.shareName) ? `<button type="button" class="button" data-copy-dataset-link="${datasetSharePath(entry.id, entry.shareName)}">Copy link</button><span class="note" data-copy-status role="status"></span>` : ''}</div>`
    + (entry.dataset ? `<p class="note">Part of <a href="/hub/datasets/?dataset=${encodeURIComponent(datasetFilterValue(catalogSummary(entry)))}">${escape(entry.dataset.label)}</a>.</p>`
      : `<p class="note"><a href="/hub/datasets/?dataset=${encodeURIComponent(entry.id)}">Browse this dataset’s named scenes</a>.</p>`)
    + '</div></div>'
    + (entry.verification ? '<section class="dataset-section"><h2>Loading status</h2>'
      + factList([{ label: 'Loading qualification', value: entry.statusLabel }, { label: 'Download delivery', value: deliveryLabel(entry.verification.delivery) },
        ...(entry.verification.opening ? [{ label: 'Opening this entry', value: entry.verification.opening.summary }] : []),
        { label: 'Check scope', value: entry.verification.scope }, { label: 'Released viewer', value: entry.verification.viewerVersion }])
      + (!viewerUrl ? `<p class="note">${escape(gated
        ? 'Files require access on Hugging Face. Obtain access and download them there, then attempt local import. Direct gated loading and file compatibility have not been verified.'
        : entry.verification.opening ? entry.verification.opening.summary : candidateViewerUrl
        ? 'The model link is based on the source file listing. Its format, browser access and complete loading need individual checks.'
        : entry.verification.level === 'supported_scenes_available'
        ? 'Browse this collection’s published named scenes. Model compatibility, photograph availability and full-export evidence are recorded separately.'
        : entry.provider === 'public' && entry.verification.level === 'header_checked'
        ? 'Download and extract the source archive, then open this entry’s model or scene folder in ColmapView. The loading evidence identifies the inspected files.'
          : 'Use the source link for the original files. The evidence below records the conversion, missing assets or checks needed before opening this source in ColmapView.')}</p>` : '')
      + '</section>' : '')
    + '<section class="dataset-section"><h2>Dataset information</h2>'
    + factList([{ label: 'Source', value: providerLabel(entry.provider) }, { label: 'Access', value: accessLabel(entry.access) },
      { label: 'License category', value: LICENSE_CATEGORY_LABELS[licenseCategory(entry)] },
      { label: 'License (source metadata)', value: entry.license }, { label: 'Recorded formats', value: entry.formats.join(' · ') || 'Not established' },
      { label: 'Scan date', value: entry.checkedAt }, ...entry.facts]) + '</section>'
    + '<section class="dataset-section"><h2>Loading evidence</h2><p class="note">Checks cover the recorded files and samples. Inclusion does not certify every scene or image. Source access and license terms apply.</p>'
    + (audits || '<p>No additional dataset loading audit is recorded for this entry.</p>') + '</section>',
    social(`${location.origin}${!analytics && share ? share : datasetPath(entry)}`, entry.title, entry.description), analytics);
}

export function catalogAuditPage(snapshot: CatalogSnapshot): string {
  const audit = snapshot.auditSummary;
  if (!audit) throw new Error('Dataset audit summary is missing');
  const levelLabels: Record<string, string> = { header_checked: 'Representative native format headers checked', viewer_checked: 'Additional samples opened in the viewer',
    file_set_only: '3D filenames; header checks incomplete', conversion_needed: 'Conversion or compatible importer needed',
    camera_only: 'Camera filenames without a complete geometry file set', no_native_assets: 'No native assets found in inspected files',
    unavailable: 'Public source metadata unavailable', unverified: 'Further verification needed', audit_error: 'Audit incomplete' };
  const status = (level: string) => levelLabels[level] || level.replace(/_/g, ' ');
  return page(location, 'Dataset audit', '<p class="dataset-back"><a href="/hub/datasets/">← All datasets</a></p>'
    + intro('Dataset audit', `${number(audit.sourcesAudited)} sources assessed on ${audit.checkedAt}, including previously supported and rejected inventory records.`)
    + `<p>${number(snapshot.sceneSummary?.entries || 0)} named scenes are published with scoped model/layout evidence. Original photographs are optional. Complete camera-and-photo export checks form a separate evidence tier: <a href="/hub/datasets/individual/verified-scenes.json" download>Download verified scene checks (JSON)</a>. Historical source research below retains its own scope and dates.</p>`
    + (snapshot.photoAudit ? '<section class="dataset-section"><h2>Image availability</h2>'
      + `<p>${number(snapshot.photoAudit.scenes)} published scenes assessed on ${escape(snapshot.photoAudit.checkedAt.slice(0, 10))}. Known truncated models are excluded. Photos remain optional for supported camera models.</p>`
      + factList(Object.entries(snapshot.photoAudit.photos).map(([status, count]) => ({ label: photoLabel(status as PhotoStatus), value: number(count) })))
      + '<p>Source photos and matched video frames have separate coverage and pixel checks. A sample does not establish every image or complete loading. Model, image and mask evidence remain separate.</p>'
      + '<p><a href="/hub/datasets/individual/photo-audit.csv" download>Download every scene’s photo availability and path policy (CSV)</a> · <a href="/hub/datasets/individual/photo-audit.json" download>Photo audit totals (JSON)</a></p></section>' : '')
    + '<section class="dataset-section"><h2>Format evidence</h2>'
    + factList(Object.entries(audit.levels).map(([level, count]) => ({ label: status(level), value: number(count) }))) + '</section>'
    + '<section class="dataset-section"><h2>Download delivery</h2>'
    + factList(Object.entries(audit.delivery).map(([delivery, count]) => ({ label: deliveryLabel(delivery), value: number(count) }))) + '</section>'
    + (audit.evidenceRefresh ? '<section class="dataset-section"><h2>Access and loading follow-up</h2>'
      + `<p>Evidence recorded through ${escape(audit.evidenceRefresh.checkedAt.slice(0, 10))}. Totals cover the published audit records; each check retains its original date. Import receipts cover the exact recorded samples.</p>`
      + factList([{ label: 'Browser asset URLs checked', value: number(audit.evidenceRefresh.browserUrls) },
        { label: 'Gated-source file access probes', value: number(audit.evidenceRefresh.accessChecks) },
        { label: 'Original sampled asset imports', value: `${number(audit.evidenceRefresh.directSamples)} tested; ${number(audit.evidenceRefresh.directPassed)} passed; ${number(audit.evidenceRefresh.directFailed)} failed` },
        { label: 'Native model files imported through controlled manifests', value: `${number(audit.evidenceRefresh.modelFileChecks)}; ordinary source links, RGB and masks not tested by these checks` },
        { label: 'Original extracted members imported', value: `${number(audit.evidenceRefresh.extractedMembers)}; direct archive loading remains separate` }])
      + '<p>Access-restricted sources are excluded from the public Hub and this download. PLY or splat headers inside a ZIP do not establish that the viewer can open the archive. Archive entries retain extraction requirements, with no checked viewer action.</p></section>' : '')
    + '<section class="dataset-section"><h2>What was checked</h2>'
    + '<p>Every repository in the saved Hugging Face search inventory was revisited, including previously excluded matches. The public scene and source entries were also rechecked. Current public metadata, reported repository licenses, file arrangements and bounded format samples are recorded.</p>'
    + '<p>COLMAP checks inspect representative camera, pose and point headers. PLY checks inspect vertex properties and counts. SPZ checks inspect the compression wrapper and format header. SOG checks inspect metadata and referenced property filenames. ZIP checks inspect complete central directories within a 16 MiB metadata budget and sample contained model headers.</p>'
    + '<p>One source can contain many models and archives. Direct checks sample one COLMAP model or up to three 3D files. Large collections sample up to three ZIPs; smaller collections examine up to eight, stopping when a native sample is established or the time budget expires. A negative archive finding requires every listed archive to be inspected without unresolved nested archives. Incomplete listings, access errors and unknown schemas stay qualified.</p>'
    + '<p>Browser reads use anonymous requests from the production viewer origin. Archive checks include an exact tail range. A successful browser read establishes access to those bytes; a header check establishes sampled format evidence. Complete scene parsing, GPU rendering, every photograph and mask, and licensing of underlying assets require separate evidence.</p>'
    + '<p>Current scene previews require eligible source and image licenses. A preview does not establish complete photograph coverage. Reported licenses remain separate from technical compatibility.</p>'
    + '<p><a href="/hub/datasets/dataset-audit.json" download>Download public audit records (JSON)</a></p></section>',
    social(`${location.base}/datasets/audit`, 'Dataset audit', `${number(audit.sourcesAudited)} sources assessed with separate format and delivery evidence.`));
}
