import { CATALOG_PAGE_SIZE, accessLabel, catalogSummary, datasetPath, datasetFilterValue, deliveryLabel, providerLabel } from '../shared/catalog';
import type { CatalogEntry, CatalogFact, CatalogSnapshot, CatalogSummary } from '../shared/catalog';
import { escapeHtml as escape, intro, page } from './pages';
import type { HubLocation } from './pages';

const location: HubLocation = { origin: 'https://colmapview.opsiclear.com', path: '/hub', base: 'https://colmapview.opsiclear.com/hub', local: false };
const number = (value: number) => value.toLocaleString('en-US');
const factList = (facts: CatalogFact[]) => `<dl class="dataset-facts">${facts.map(fact => `<div><dt>${escape(fact.label)}</dt><dd>${fact.url
  ? `<a href="${escape(fact.url)}" rel="noreferrer">${escape(fact.value)}</a>` : escape(fact.value)}</dd></div>`).join('')}</dl>`;
const tags = (entry: CatalogSummary) => `<p class="dataset-tags">${entry.dataset ? `<a class="dataset-tag" href="/hub/datasets/?dataset=${encodeURIComponent(datasetFilterValue(entry))}">Dataset: ${escape(entry.dataset.label)}</a>` : ''}`
  + `${entry.itemKind ? `<span class="dataset-tag">${escape(entry.itemKind)}</span>` : ''}<span class="dataset-tag">${escape(providerLabel(entry.provider))}</span>`
  + `<span class="dataset-tag">${escape(entry.statusLabel)}</span>${entry.delivery ? `<span class="dataset-tag">${escape(deliveryLabel(entry.delivery))}</span>` : ''}${entry.testOrFixture ? '<span class="dataset-tag">Test / demo</span>' : ''}</p>`;

export function catalogCard(entry: CatalogSummary): string {
  return `<article class="card dataset-card"><h2><a href="${datasetPath(entry)}">${escape(entry.title)}</a></h2>${tags(entry)}`
    + `<p>${escape(entry.description)}</p><p class="meta">${escape(accessLabel(entry.access))}</p>`
    + `<p class="meta"><strong>License:</strong> ${escape(entry.license)}</p></article>`;
}

function social(url: string, title: string, description: string): string {
  return `<link rel="canonical" href="${escape(url)}"><meta property="og:type" content="website"><meta property="og:url" content="${escape(url)}">`
    + `<meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta name="twitter:card" content="summary">`;
}

export function catalogEntryPage(entry: CatalogEntry): string {
  const action = (label: string, href: string, primary = false) => `<a class="button${primary ? ' button-primary' : ''}" href="${escape(href)}" target="_blank" rel="noopener noreferrer">${label}<span aria-hidden="true"> ↗</span></a>`;
  const actions = action(entry.sourceUrl === entry.dataUrl ? 'Dataset URL' : 'Source', entry.sourceUrl)
    + (entry.dataUrl && entry.dataUrl !== entry.sourceUrl ? action('Dataset URL', entry.dataUrl) : '')
    + (entry.viewerUrl ? action('Try in ColmapView', entry.viewerUrl, true) : '');
  const individualAction = entry.candidateViewerUrl ? action('Try listed model (unchecked)', entry.candidateViewerUrl) : '';
  const audits = entry.audits.map(audit => {
    const name = audit.sourceUrl ? decodeURIComponent(new URL(audit.sourceUrl).pathname.split('/').filter(part => part && part !== 'content').at(-1) || audit.sourceId) : audit.sourceId;
    return `<details class="dataset-audit"><summary>${escape(name)} · checked ${escape(audit.checkedAt)}</summary>`
      + (audit.scope === 'collection' ? '<p class="note">Another file in the same source collection; these checks do not certify this entry’s scene.</p>' : '')
      + (audit.sourceUrl ? `<p><a href="${escape(audit.sourceUrl)}" rel="noreferrer">Inspected source ↗</a></p>` : '')
      + factList(audit.facts) + '</details>';
  }).join('');
  return page(location, entry.title,
    '<p class="dataset-back"><a href="/hub/datasets/">← All datasets</a></p>'
    + intro(entry.title, entry.description, tags(catalogSummary(entry)))
    + `<div class="actions">${actions}${individualAction}</div>`
    + (entry.dataset ? `<p class="note">Part of <a href="/hub/datasets/?dataset=${encodeURIComponent(datasetFilterValue(catalogSummary(entry)))}">${escape(entry.dataset.label)}</a>. <a href="/hub/datasets/${entry.dataset.id}">Collection information</a>.</p>`
      : `<p class="note"><a href="/hub/datasets/?dataset=${encodeURIComponent(entry.id)}">Browse this dataset’s individual models and scenes</a>.</p>`)
    + (entry.verification ? '<section class="dataset-section"><h2>Loading status</h2>'
      + factList([{ label: 'Format evidence', value: entry.statusLabel }, { label: 'Download delivery', value: deliveryLabel(entry.verification.delivery) },
        { label: 'Check scope', value: entry.verification.scope }, { label: 'Released viewer', value: entry.verification.viewerVersion }])
      + (!entry.viewerUrl ? `<p class="note">${escape(entry.candidateViewerUrl
        ? 'The model link is based on the source file listing. Its format, browser access and complete loading need individual checks.'
        : entry.provider === 'public' && entry.verification.level === 'header_checked'
        ? 'Download and extract the source archive, then open this entry’s model or scene folder in ColmapView. The loading evidence identifies the inspected files.'
        : entry.verification.delivery === 'gated' ? 'Obtain access from the source and sign in to Hugging Face in ColmapView. The source’s file format still needs the checks recorded below.'
          : 'Use the source link for the original files. The evidence below records the conversion, missing assets or checks needed before opening this source in ColmapView.')}</p>` : '')
      + '</section>' : '')
    + '<section class="dataset-section"><h2>Dataset information</h2>'
    + factList([{ label: 'Source', value: providerLabel(entry.provider) }, { label: 'Access', value: accessLabel(entry.access) },
      { label: 'License (source metadata)', value: entry.license }, { label: 'Recorded formats', value: entry.formats.join(' · ') || 'Not established' },
      { label: 'Scan date', value: entry.checkedAt }, ...entry.facts]) + '</section>'
    + '<section class="dataset-section"><h2>Loading evidence</h2><p class="note">Checks cover the recorded files and samples. Inclusion does not certify every scene or image. Source access and license terms apply.</p>'
    + (audits || '<p>No additional dataset loading audit is recorded for this entry.</p>') + '</section>',
    social(`${location.origin}${datasetPath(entry)}`, entry.title, entry.description));
}

export function catalogIndexPage(snapshot: CatalogSnapshot, pageNumber = 1, collections = false): string {
  const total = snapshot.entries.length;
  const pages = Math.max(1, Math.ceil(total / CATALOG_PAGE_SIZE));
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pages) throw new Error('Invalid catalog page');
  const selected = snapshot.entries.slice((pageNumber - 1) * CATALOG_PAGE_SIZE, pageNumber * CATALOG_PAGE_SIZE);
  const options = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b, 'en')).map(value => `<option value="${escape(value)}">${escape(value)}</option>`).join('');
  const pagePath = (value: number) => value <= 1 ? (collections ? '/hub/datasets/collections' : '/hub/datasets/') : `/hub/datasets/${collections ? 'collection-' : ''}page-${value}`;
  const description = `${number(snapshot.importSummary.hfEntries)} Hugging Face repositories and ${number(snapshot.importSummary.publicEntries)} public scene or subset entries.`
    + (snapshot.importSummary.additionalAuditEntries ? ` Includes ${number(snapshot.importSummary.additionalAuditEntries)} additional audited sources.` : '');
  return page(location, collections ? 'Dataset collections' : 'Public datasets', '<div class="catalog-index">' + intro(collections ? 'Dataset collections' : 'Public datasets', description)
    + (collections ? '<p class="note"><a href="/hub/datasets/">Browse individual models and scenes</a>. Collection pages retain source-wide metadata and audit history.</p>' : '')
    + '<p class="note">Browse source links, reported licenses, formats and sampled loading checks. The surveys were recorded in October 2026.</p>'
    + (snapshot.auditSummary ? `<p class="note">Rechecked ${number(snapshot.auditSummary.sourcesAudited)} sources on ${escape(snapshot.auditSummary.checkedAt)}, including previously rejected candidates. Format checks and browser reads are recorded separately. <a href="/hub/datasets/audit">Read the audit</a>.</p>` : '')
    + `<form id="catalog-search" class="catalog-filters" role="search" data-page="${pageNumber}"${collections ? ' data-collections="true"' : ''}>`
    + '<label class="catalog-query">Search datasets<input type="search" name="q" placeholder="Dataset, format, license…" disabled></label>'
    + '<label>Source<select name="provider" aria-label="Source" disabled><option value="">All sources</option><option value="huggingface">Hugging Face</option><option value="public">Public sources</option></select></label>'
    + `<label>License<select name="license" aria-label="License" disabled><option value="">All licenses</option>${options(snapshot.entries.map(entry => entry.license))}</select></label>`
    + `<label>Evidence<select name="status" aria-label="Evidence" disabled><option value="">All evidence levels</option>${options(snapshot.entries.map(entry => entry.statusLabel))}</select></label>`
    + `<label>Delivery<select name="delivery" aria-label="Delivery" disabled><option value="">All delivery results</option>${[...new Set(snapshot.entries.map(entry => entry.verification?.delivery).filter((value): value is string => Boolean(value)))].sort().map(value => `<option value="${escape(value)}">${escape(deliveryLabel(value))}</option>`).join('')}</select></label>`
    + '<label>Viewer link<select name="viewer" aria-label="Viewer link" disabled><option value="">All sources</option><option value="available">Checked sample link</option></select></label>'
    + '<button type="reset" class="button" disabled>Reset</button></form><noscript><p class="note">Search requires JavaScript. Browse the dataset pages below.</p></noscript>'
    + `<p id="catalog-count" class="catalog-count" role="status" tabindex="-1">${number(total)} entries · page ${pageNumber} of ${pages}</p>`
    + `<div id="catalog-results" class="dataset-grid">${selected.map(entry => catalogCard(catalogSummary(entry))).join('')}</div>`
    + '<nav class="catalog-pagination" aria-label="Dataset pages">'
    + `<a class="button" id="catalog-prev" href="${pagePath(pageNumber - 1)}"${pageNumber === 1 ? ' hidden' : ''}>Previous</a>`
    + `<span id="catalog-page">Page ${pageNumber} of ${pages}</span>`
    + `<a class="button" id="catalog-next" href="${pagePath(pageNumber + 1)}"${pageNumber === pages ? ' hidden' : ''}>Next</a></nav>`
    + '<p class="note catalog-download"><a href="/hub/datasets/catalog.json" download>Download catalog metadata (JSON)</a></p></div>',
    social(`${location.base}/datasets/`, 'Public datasets', description) + '<script type="module" src="/hub/assets/catalog.js"></script>');
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
    + '<section class="dataset-section"><h2>Format evidence</h2>'
    + factList(Object.entries(audit.levels).map(([level, count]) => ({ label: status(level), value: number(count) }))) + '</section>'
    + '<section class="dataset-section"><h2>Download delivery</h2>'
    + factList(Object.entries(audit.delivery).map(([delivery, count]) => ({ label: deliveryLabel(delivery), value: number(count) }))) + '</section>'
    + '<section class="dataset-section"><h2>What was checked</h2>'
    + '<p>Every repository in the saved Hugging Face search inventory was revisited, including previously excluded matches. The public scene and source entries were also rechecked. Current public metadata, reported repository licenses, file arrangements and bounded format samples are recorded.</p>'
    + '<p>COLMAP checks inspect representative camera, pose and point headers. PLY checks inspect vertex properties and counts. SPZ checks inspect the compression wrapper and format header. SOG checks inspect metadata and referenced property filenames. ZIP checks inspect complete central directories within a 16 MiB metadata budget and sample contained model headers.</p>'
    + '<p>One source can contain many models and archives. Direct checks sample one COLMAP model or up to three 3D files. Large collections sample up to three ZIPs; smaller collections examine up to eight, stopping when a native sample is established or the time budget expires. A negative archive finding requires every listed archive to be inspected without unresolved nested archives. Incomplete listings, access errors and unknown schemas stay qualified.</p>'
    + '<p>Browser reads use anonymous requests from the production viewer origin. Archive checks include an exact tail range. A successful browser read establishes access to those bytes; a header check establishes sampled format evidence. Complete scene parsing, GPU rendering, every photograph and mask, and licensing of underlying assets require separate evidence.</p>'
    + '<p>No dataset previews were generated. Reported licenses remain separate from technical compatibility.</p>'
    + '<p><a href="/hub/datasets/dataset-audit.json" download>Download all audit records (JSON)</a></p></section>',
    social(`${location.base}/datasets/audit`, 'Dataset audit', `${number(audit.sourcesAudited)} sources assessed with separate format and delivery evidence.`));
}
