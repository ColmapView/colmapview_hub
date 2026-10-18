/** Import one bounded source through the real released viewer UI. */
export async function auditViewerSample(page, item) {
  const pageErrors = [];
  const onError = error => pageErrors.push(error.message);
  const fileName = decodeURIComponent(new URL(item.url).pathname.split('/').at(-1));
  const splat = item.formats.some(format => ['gaussian_ply', 'spz', 'spz_v4', 'sog', 'zstd_wrapped_splat'].includes(format));
  let validated = false;
  let decodeFailure = '';
  const onConsole = message => {
    const text = message.text();
    if ((text.includes('[Splats] Validated') || text.includes('[WebGPU Splats] Loaded')) && text.includes(fileName)) validated = true;
    if (text.includes('[Splats] Failed to load') && text.includes(fileName)) decodeFailure = text.slice(0, 400);
  };
  page.on('pageerror', onError);
  page.on('console', onConsole);
  const target = `https://colmapview.opsiclear.com/?url=${encodeURIComponent(item.url)}`;
  const result = { sourceId: item.id, sourceUrl: item.originalSourceUrl || item.url, importUrl: item.url, formats: item.formats, checkedAt: new Date().toISOString(),
    scope: 'Original sampled files tested in the released browser UI; splat success requires decoder validation. Other models, source photos and masks are unverified.' };
  try {
    await page.goto(target);
    await page.waitForFunction(() => {
      const exporter = document.querySelector('button[aria-label="Export"]');
      return exporter && !exporter.disabled || /(?:URL Load Failed|Failed to load|Loading failed|Could not load)/i.test(document.body.innerText);
    }, undefined, { timeout: 105000 });
    result.imported = await page.locator('button[aria-label="Export"]').count() > 0
      && await page.locator('button[aria-label="Export"]').isEnabled();
    result.canvasCount = await page.locator('canvas').count();
    if (splat && result.imported) {
      const deadline = Date.now() + 60000;
      while (!validated && !decodeFailure && Date.now() < deadline) await page.waitForTimeout(100);
      result.decoderValidated = validated;
      if (decodeFailure) result.decoderError = decodeFailure;
    }
    result.viewer = await page.locator('button[aria-label^="About ColmapView"]').getAttribute('aria-label').catch(() => null);
    result.status = decodeFailure || pageErrors.length || !result.imported ? 'failed'
      : splat && !validated ? 'inconclusive' : result.canvasCount > 0 ? 'passed' : 'inconclusive';
    if (result.status !== 'passed') result.message = (await page.locator('body').innerText()).slice(-1800);
    result.pageErrors = pageErrors;
  } catch (error) {
    result.status = 'inconclusive';
    result.message = error.message.slice(0, 300);
  } finally {
    page.off('pageerror', onError);
    page.off('console', onConsole);
  }
  return result;
}
