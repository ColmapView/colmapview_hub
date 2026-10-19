/** Photo path evidence is independent of whole-model parsing and export checks. */
export interface PhotoRoutingEvidence {
  url: string;
  sha256: string;
  listedPhotos: number;
  mappedNames: number;
  nameCheck: { inspected: number; matched: number; registered: number | null; complete: boolean; ambiguous: number };
  checkedAt: string;
  viewerVersion: string;
  viewerCommit: string;
}

const count = (value: unknown, minimum = 0): value is number => typeof value === 'number'
  && Number.isSafeInteger(value) && value >= minimum;

export function isPhotoRoutingEvidence(value: unknown): value is PhotoRoutingEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as PhotoRoutingEvidence, check = item.nameCheck;
  return typeof item.sha256 === 'string' && /^[a-f0-9]{64}$/.test(item.sha256)
    && item.url === `https://colmapview.opsiclear.com/hub/datasets/individual/manifests/${item.sha256}.manifest.json`
    && count(item.listedPhotos, 1) && count(item.mappedNames, 1) && Boolean(check)
    && count(check?.inspected, 1) && count(check?.matched, 1) && check.matched <= check.inspected
    && item.mappedNames >= check.matched && count(check.ambiguous) && check.ambiguous <= check.inspected - check.matched
    && (check.registered === null || count(check.registered, check.inspected))
    && typeof check.complete === 'boolean' && check.complete === (check.registered === check.inspected)
    && typeof item.viewerCommit === 'string' && /^[a-f0-9]{40}$/.test(item.viewerCommit)
    && typeof item.viewerVersion === 'string' && /^\d+\.\d+\.\d+$/.test(item.viewerVersion)
    && typeof item.checkedAt === 'string' && Number.isFinite(Date.parse(item.checkedAt));
}

export function photoRoutingUrlMatches(viewerUrl: string | undefined, evidence: Pick<PhotoRoutingEvidence, 'url'>): boolean {
  try {
    const url = new URL(viewerUrl ?? '');
    return url.origin === 'https://colmapview.opsiclear.com' && url.pathname === '/' && !url.hash
      && [...url.searchParams].length === 1 && url.searchParams.get('url') === evidence.url;
  } catch { return false; }
}
