// Same preference, default and palettes as ColmapView's src/theme/uiTheme.ts.
// This tiny blocking bundle applies the preference before the first paint.
(() => {
  const key = 'colmap-viewer-theme';
  const media = matchMedia('(prefers-color-scheme: light)');
  const labels = { dark: 'Dark', light: 'Light', system: 'System' };
  const next = { dark: 'light', light: 'system', system: 'dark' } as const;
  let preference: keyof typeof next = 'dark';
  const read = () => {
    try { const value = localStorage.getItem(key); return value === 'light' || value === 'system' ? value : 'dark'; }
    catch { return 'dark'; }
  };
  const apply = () => {
    document.documentElement.dataset.uiTheme = preference === 'system' ? media.matches ? 'light' : 'dark' : preference;
    const control = document.querySelector<HTMLButtonElement>('#hub-theme');
    if (control) {
      control.dataset.theme = preference;
      control.title = `Appearance: ${labels[preference]}. Switch to ${labels[next[preference]]}.`;
      control.setAttribute('aria-label', control.title);
      for (const image of control.querySelectorAll<HTMLElement>('[data-theme-icon]')) image.hidden = image.dataset.themeIcon !== preference;
    }
  };
  preference = read();
  apply();
  media.addEventListener('change', apply);
  addEventListener('storage', event => {
    if (event.key === key || event.key === null) { preference = read(); apply(); }
  });
  addEventListener('DOMContentLoaded', () => {
    const control = document.querySelector<HTMLButtonElement>('#hub-theme');
    if (!control) return;
    control.disabled = false;
    apply();
    control.addEventListener('click', () => {
      preference = next[preference];
      try { localStorage.setItem(key, preference); } catch { /* Keep the session preference. */ }
      apply();
    });
  }, { once: true });
})();
export {};
