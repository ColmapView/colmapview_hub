/** Compatibility documents only. Keep retired navigation on the current host. */
const old = new URL(location.href);
const metadata = /^\/hub\/datasets\/entry(?:\/|\/index\.html)?$/.test(old.pathname);
const target = new URL(metadata ? '/hub/entry/' : '/hub/', old.origin);
const fields = metadata ? ['id', 'viewerHost'] : ['q', 'dataset', 'licenseCategory', 'sort', 'kind', 'provider', 'license',
  'status', 'photos', 'data', 'delivery', 'viewer', 'viewerHost', 'seed', 'page'];
for (const name of fields) {
  const value = old.searchParams.get(name);
  if (value) target.searchParams.set(name, value);
}
if (['#shared-datasets', '#main'].includes(old.hash)) target.hash = old.hash;
location.replace(target.href);
