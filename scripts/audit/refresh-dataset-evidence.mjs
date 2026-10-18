/** Merge exact public receipts without transferring model/file proof to siblings. */
import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { formatName, requiredProbeUrls } from '../catalog/dataset-audit-import.mjs';

const { values } = parseArgs({ options: { receipts: { type: 'string' }, samples: { type: 'string' }, out: { type: 'string', default: 'data/dataset-audit.json' } } });
if (!values.receipts || !values.samples) throw new Error('--receipts and --samples must name the public audit receipt directories');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const audit = await json('data/dataset-audit.json');
const browser = await json(resolve(values.receipts, 'browser-audit.json'));
const access = await json(resolve(values.receipts, 'gated-access.json'));
const samples = await json(resolve(values.samples, 'viewer-samples.json'));
const plans = await json(resolve(values.samples, 'sample-plan.json'));
const members = await json(resolve(values.samples, 'archive-member-samples.json'));
const memberReceipts = await json(resolve(values.samples, 'archive-member-receipts.json'));
if (browser.origin !== 'https://colmapview.opsiclear.com' || browser.completed !== browser.total || access.completed !== access.planned) throw new Error('Incomplete or unexpected-origin public receipt set');
const bySource = new Map(audit.results.map(row => [row.sourceId, row]));
const browserByUrl = new Map(browser.results.map(row => [row.url, row]));
const planBySource = new Map(plans.map(row => [row.sourceId, row]));
if (bySource.size !== audit.results.length || browserByUrl.size !== browser.results.length || planBySource.size !== plans.length) throw new Error('Duplicate evidence identities');
const current = samples.results.filter(row => !row.supersededByCorrectedManifest);
if (new Set(current.map(row => row.sourceId)).size !== plans.length || current.length !== plans.length) throw new Error('Sample coverage is incomplete or duplicated');
const counts = { directSamples: 0, directPassed: 0, directFailed: 0, modelFileChecks: 0, extractedMembers: 0, accessChecks: 0 };
for (const result of audit.results) {
  const required = requiredProbeUrls(result);
  const checks = required.map(url => browserByUrl.get(url)).filter(Boolean);
  result.requiredUrls = required;
  result.browserChecks = checks.map(check => ({ url: check.url, delivery: check.delivery, checkedAt: check.checkedAt,
    ...(check.prefix ? { prefixStatus: check.prefix.status } : {}), ...(check.tail ? { tailStatus: check.tail.status } : {}) }));
  if (required.length && checks.length === required.length && checks.every(check => check.delivery === 'browser_readable')) result.delivery = 'browser_readable';
  else if (checks.some(check => check.delivery !== 'browser_readable')) result.delivery = checks.find(check => check.delivery !== 'browser_readable').delivery;
}
for (const check of access.results) {
  const result = bySource.get(check.sourceId);
  if (!result || result.revision !== check.revision || !check.url.startsWith(`https://huggingface.co/datasets/${check.sourceId.slice(3)}/resolve/${check.revision}/`)) throw new Error('Access receipt does not match its source revision');
  result.accessChecks = [{ url: check.url, path: check.path, status: check.status, checkedAt: check.checkedAt,
    ...(check.errorCode ? { errorCode: check.errorCode } : {}), scope: check.scope }];
  if ([401, 403].includes(check.status) && check.errorCode === 'GatedRepo') result.delivery = 'gated';
  counts.accessChecks++;
}
for (const sample of current) {
  const result = bySource.get(sample.sourceId);
  const plan = planBySource.get(sample.sourceId);
  if (!result || !plan || sample.sourceUrl !== result.loadUrl || plan.sourceUrl !== result.loadUrl) throw new Error('Viewer sample does not match the selected original source');
  if (!sample.viewer?.includes(`version ${audit.viewerVersion}`)) throw new Error('Viewer receipt has a different compatibility target');
  if (sample.status === 'passed' && (!sample.imported || !sample.canvasCount || sample.pageErrors?.length)) throw new Error('Weak viewer pass');
  if (sample.status === 'passed' && plan.formats.some(format => ['gaussian_ply', 'spz', 'sog'].includes(format)) && !sample.decoderValidated) throw new Error('Missing decoder validation');
  if (plan.manifest) {
    if (!plan.manifest.skipImages || sample.status !== 'passed') throw new Error('Unqualified controlled native model import');
    const expected = new Set(result.probes.map(probe => probe.url));
    const urls = Object.values(plan.manifest.files).map(path => `${plan.manifest.baseUrl.replace(/\/$/, '')}/${path}`);
    if (urls.length !== 3 || urls.some(url => !expected.has(url))) throw new Error('Controlled manifest differs from original sampled model files');
    result.modelFileImport = { sourceUrl: sample.sourceUrl, checkedAt: sample.checkedAt, status: sample.status,
      scope: 'Original native model files imported through a controlled model-only manifest. The ordinary source/tree loading route, source RGB, masks and export were not tested by this check.', files: urls };
    counts.modelFileChecks++;
    continue;
  }
  if (plan.url !== result.loadUrl) throw new Error('Controlled or indirect URL cannot certify an original direct load');
  const viewerImport = { sourceId: sample.sourceId, sourceUrl: sample.sourceUrl, importUrl: sample.sourceUrl, formats: sample.formats,
    checkedAt: sample.checkedAt, status: sample.status, imported: sample.imported, canvasCount: sample.canvasCount,
    scope: 'Exact original sampled asset tested in the released browser UI; source cameras, other models, photos, masks and export remain unverified.',
    ...(sample.decoderValidated !== undefined ? { decoderValidated: sample.decoderValidated } : {}), ...(sample.error ? { error: sample.error } : {}) };
  result.viewerImport = viewerImport;
  if (sample.status === 'passed') result.summary = `${result.formats.map(formatName).join(', ')} sample opened in ColmapView ${audit.viewerVersion}. Other source models, cameras, photos, masks and exports remain unverified.`;
  counts.directSamples++;
  if (sample.status === 'passed') counts.directPassed++; else counts.directFailed++;
}
for (const member of members.results) {
  const result = bySource.get(member.sourceId);
  const receipt = memberReceipts.find(row => row.sourceId === member.sourceId);
  if (!result || !receipt || member.status !== 'passed' || receipt.sourceUrl !== result.loadUrl || !/^[a-f0-9]{64}$/.test(receipt.memberSha256)) throw new Error('Unqualified extracted-member receipt');
  const archive = result.probes.find(probe => probe.url === receipt.sourceUrl);
  if (!archive?.probes?.some(probe => probe.path === receipt.memberPath)) throw new Error('Extracted member is not the original sampled header path');
  result.extractedMemberImport = { path: receipt.memberPath, sourceUrl: receipt.sourceUrl, checkedAt: member.checkedAt, status: member.status,
    sha256: receipt.memberSha256, bytes: receipt.memberBytes,
    scope: 'Unmodified extracted member bytes imported through a controlled same-origin response. This is not a live member URL or successful direct archive import.' };
  counts.extractedMembers++;
}
const checkedAt = new Date().toISOString();
audit.browserCoverage = { completed: browser.completed, total: browser.total };
audit.evidenceRefresh = { checkedAt, scope: 'Fresh anonymous browser transport and gated-file access checks; retained dated exact-asset, model-only and extracted-member import receipts. Source metadata and untested models keep their original qualification.',
  origin: browser.origin, ...counts, browserUrls: browser.total };
const output = resolve(values.out);
await writeFile(`${output}.tmp`, JSON.stringify(audit, null, 2) + '\n');
await rename(`${output}.tmp`, output);
console.log(JSON.stringify({ sources: audit.results.length, ...audit.evidenceRefresh }));
