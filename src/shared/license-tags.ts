import { LICENSE_CATEGORY_LABELS, type LicenseCategory } from './license-categories';

/** Presentation only: full custom or unresolved terms remain in Info. */
export function licenseTagLabel(license: string, category: LicenseCategory): string {
  return category === 'not-specified' ? 'License unspecified' : `${LICENSE_CATEGORY_LABELS[category]} · ${license}`;
}
