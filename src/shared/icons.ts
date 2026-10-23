const shapes = {
  datasets: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  viewer: '<path d="m12 3 9 5v8l-9 5-9-5V8l9-5Zm0 10 9-5M12 13 3 8m9 5v8"/>',
  dark: '<path d="M20.9 13a9 9 0 0 1-9.9-9.9A9 9 0 1 0 20.9 13Z"/>',
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  system: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8m-4-4v4"/>',
  reset: '<path d="M3 11a9 9 0 1 1 2.7 6.4M3 4v7h7"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  shuffle: '<path d="M3 6h3c5 0 7 12 12 12h3M3 18h3c2 0 3.5-2 5-4.5M13 10.5C14.5 8 16 6 18 6h3m-4-4 4 4-4 4m0 4 4 4-4 4"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
} as const;

/** Decorative, trusted icons; each owning control supplies its accessible name. */
export function icon(name: keyof typeof shapes): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${shapes[name]}</svg>`;
}
