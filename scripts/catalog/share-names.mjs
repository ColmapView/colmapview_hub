/** Public catalog aliases reserve the same keys as upload shares. Never overwrite a collision. */
export const namePattern = /^[A-Z][a-z]{2,13}[A-Z][a-z]{2,13}$/;
export const datasetPattern = /^data-[a-f0-9]{24}$/;

export function validateNames(value) {
  if (value.schemaVersion !== 1 || !value.names || typeof value.names !== 'object' || Array.isArray(value.names)) throw new Error('Invalid catalog name registry');
  const used = new Set();
  for (const [id, name] of Object.entries(value.names)) {
    if (!datasetPattern.test(id) || typeof name !== 'string' || !namePattern.test(name) || used.has(name.toLowerCase())) throw new Error('Invalid or duplicated catalog name');
    used.add(name.toLowerCase());
  }
  return value.names;
}

export async function reserveCatalogName(bucket, datasetId, nextName) {
  if (!datasetPattern.test(datasetId)) throw new Error('Invalid public dataset ID');
  for (let attempt = 0; attempt < 64; attempt++) {
    const id = await nextName();
    if (!namePattern.test(id)) throw new Error('Invalid catalog name candidate');
    const value = { schemaVersion: 1, kind: 'catalog', id, datasetId, createdAt: new Date().toISOString() };
    if (await bucket.put(`links/${id}.json`, JSON.stringify(value), {
      onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' },
    })) return id;
  }
  throw new Error('Could not reserve a free catalog name');
}
