import { CATALOG_PAGE_SIZE, accessLabel, datasetPath, providerLabel } from '../shared/catalog';
import type { CatalogEntry, CatalogFact, CatalogSnapshot, CatalogSummary } from '../shared/catalog';
import { escapeHtml as escape, intro, page } from './pages';
import type { HubLocation } from './pages';

const location: HubLocation = { origin: 'https://colmapview.opsiclear.com', path: '/hub', base: 'https://colmapview.opsiclear.com/hub', local: false };
const number = (value: number) => value.toLocaleString('en-US');
const factList = (facts: CatalogFact[]) => `<dl class="dataset-facts">${facts.map(fact => `<div><dt>${escape(fact.label)}</dt><dd>${fact.url
  ? `<a href="${escape(fact.url)}" rel="noreferrer">${escape(fact.value)}</a>` : escape(fact.value)}</dd></div>`).join('')}</dl>`;
const tags = (entry: CatalogSummary) => `<p class="dataset-tags"><span class="dataset-tag">${escape(providerLabel(entry.provider))}</span>`
  + `<span class="dataset-tag">${escape(entry.statusLabel)}</span>${entry.testOrFixture ? '<span class="dataset-tag">Test / demo</span>' : ''}</p>`;

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
  const audits = entry.audits.map(audit => {
    const name = audit.sourceUrl ? decodeURIComponent(new URL(audit.sourceUrl).pathname.split('/').filter(part => part && part !== 'content').at(-1) || audit.sourceId) : audit.sourceId;
    return `<details class="dataset-audit"><summary>${escape(name)} · checked ${escape(audit.checkedAt)}</summary>`
      + (audit.scope === 'collection' ? '<p class="note">Another file in the same source collection; these checks do not certify this entry’s scene.</p>' : '')
      + (audit.sourceUrl ? `<p><a href="${escape(audit.sourceUrl)}" rel="noreferrer">Inspected source ↗</a></p>` : '')
      + factList(audit.facts) + '</details>';
  }).join('');
  return page(location, entry.title,
    '<p class="dataset-back"><a href="/hub/datasets/">← All datasets</a></p>'
    + intro(entry.title, entry.description, tags(entry))
    + `<div class="actions">${actions}</div>`
    + '<section class="dataset-section"><h2>Dataset information</h2>'
    + factList([{ label: 'Source', value: providerLabel(entry.provider) }, { label: 'Access', value: accessLabel(entry.access) },
      { label: 'License (source metadata)', value: entry.license }, { label: 'Recorded formats', value: entry.formats.join(' · ') || 'Not established' },
      { label: 'Scan date', value: entry.checkedAt }, ...entry.facts]) + '</section>'
    + '<section class="dataset-section"><h2>Loading evidence</h2><p class="note">Checks cover the recorded files and samples. Inclusion does not certify every scene or image. Source access and license terms apply.</p>'
    + (audits || '<p>No additional dataset loading audit is recorded for this entry.</p>') + '</section>',
    social(`${location.origin}${datasetPath(entry)}`, entry.title, entry.description));
}

export function catalogIndexPage(snapshot: CatalogSnapshot, pageNumber = 1): string {
  const total = snapshot.entries.length;
  const pages = Math.max(1, Math.ceil(total / CATALOG_PAGE_SIZE));
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pages) throw new Error('Invalid catalog page');
  const selected = snapshot.entries.slice((pageNumber - 1) * CATALOG_PAGE_SIZE, pageNumber * CATALOG_PAGE_SIZE);
  const options = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b, 'en')).map(value => `<option value="${escape(value)}">${escape(value)}</option>`).join('');
  const pagePath = (value: number) => value <= 1 ? '/hub/datasets/' : `/hub/datasets/page-${value}`;
  const description = `${number(snapshot.importSummary.hfEntries)} Hugging Face repositories and ${number(snapshot.importSummary.publicEntries)} public scene or subset entries.`
    + (snapshot.importSummary.additionalAuditEntries ? ` Includes ${number(snapshot.importSummary.additionalAuditEntries)} additional audited sources.` : '');
  return page(location, 'Public datasets', '<div class="catalog-index">' + intro('Public datasets', description)
    + '<p class="note">Browse source links, reported licenses, formats and sampled loading checks. The surveys were recorded in October 2026.</p>'
    + `<form id="catalog-search" class="catalog-filters" role="search" data-page="${pageNumber}">`
    + '<label class="catalog-query">Search datasets<input type="search" name="q" placeholder="Dataset, format, license…" disabled></label>'
    + '<label>Source<select name="provider" disabled><option value="">All sources</option><option value="huggingface">Hugging Face</option><option value="public">Public sources</option></select></label>'
    + `<label>License<select name="license" disabled><option value="">All licenses</option>${options(snapshot.entries.map(entry => entry.license))}</select></label>`
    + `<label>Evidence<select name="status" disabled><option value="">All evidence levels</option>${options(snapshot.entries.map(entry => entry.statusLabel))}</select></label>`
    + '<button type="reset" class="button" disabled>Reset</button></form><noscript><p class="note">Search requires JavaScript. Browse the dataset pages below.</p></noscript>'
    + `<p id="catalog-count" class="catalog-count" role="status" tabindex="-1">${number(total)} entries · page ${pageNumber} of ${pages}</p>`
    + `<div id="catalog-results" class="dataset-grid">${selected.map(catalogCard).join('')}</div>`
    + '<nav class="catalog-pagination" aria-label="Dataset pages">'
    + `<a class="button" id="catalog-prev" href="${pagePath(pageNumber - 1)}"${pageNumber === 1 ? ' hidden' : ''}>Previous</a>`
    + `<span id="catalog-page">Page ${pageNumber} of ${pages}</span>`
    + `<a class="button" id="catalog-next" href="${pagePath(pageNumber + 1)}"${pageNumber === pages ? ' hidden' : ''}>Next</a></nav>`
    + '<p class="note catalog-download"><a href="/hub/datasets/catalog.json" download>Download catalog metadata (JSON)</a></p></div>',
    social(`${location.base}/datasets/`, 'Public datasets', description) + '<script type="module" src="/hub/assets/catalog.js"></script>');
}
