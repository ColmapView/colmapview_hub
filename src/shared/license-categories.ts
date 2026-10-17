export const LICENSE_CATEGORIES = ['commercial', 'non-commercial', 'not-specified'] as const;
export type LicenseCategory = typeof LICENSE_CATEGORIES[number];
export const LICENSE_CATEGORY_LABELS: Record<LicenseCategory, string> = {
  commercial: 'Commercial use', 'non-commercial': 'Non-commercial (NC)', 'not-specified': 'Not specified',
};
export const LICENSE_CATEGORY_NOTE = 'Categories summarize reported source licenses; conditions and asset-specific terms still apply. “Not specified” includes missing, custom or unclear terms.';

// Exact identifiers only: a license for code or a substring in custom terms
// does not establish the dataset's permissions. See data/README.md for sources.
const commercial = new Set([
  'afl-3.0', 'agpl-3.0', 'apache-2.0', 'artistic-2.0', 'bsd-2-clause', 'bsd-3-clause', 'bsd-3-clause-clear',
  'cc-by-2.0', 'cc-by-3.0', 'cc-by-4.0', 'cc-by-sa-3.0', 'cc-by-sa-4.0', 'cc0-1.0',
  'cdla-permissive-2.0', 'creativeml-openrail-m', 'etalab-2.0', 'gpl-2.0', 'gpl-3.0', 'mit', 'odbl', 'odc-by', 'wtfpl',
]);
const nonCommercial = new Set([
  'cc-by-nc-3.0', 'cc-by-nc-4.0', 'cc-by-nc-nd-4.0', 'cc-by-nc-sa-3.0', 'cc-by-nc-sa-4.0',
  'fair-noncommercial-research-license',
  'waymo-dataset-license-non-commercial',
  'custom niantic non-commercial dataset agreement; file format itself is plain text/jpeg',
]);

export function classifyLicense(license: string): LicenseCategory {
  const value = license.trim().toLowerCase();
  // This public survey records both CC BY and an additional author file whose
  // scope has not been resolved. Keep it, apple-amlr and other custom terms open.
  const parts = value.split('|').map(part => part.trim());
  if (parts.every(part => commercial.has(part))) return 'commercial';
  if (parts.every(part => nonCommercial.has(part))) return 'non-commercial';
  // Mixed, unrecognized and incomplete identifiers never imply permission.
  return 'not-specified';
}

export const licenseCategory = (entry: { license: string; licenseCategory?: LicenseCategory }): LicenseCategory =>
  entry.licenseCategory ?? classifyLicense(entry.license);
