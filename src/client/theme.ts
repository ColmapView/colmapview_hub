// Same preference, default and palettes as ColmapView's src/theme/uiTheme.ts.
// This tiny blocking bundle applies the preference before the first paint.
(() => {
  const key = 'colmap-viewer-theme';
  const media = matchMedia('(prefers-color-scheme: light)');
  let preference = 'dark';
  const read = () => {
    try { const value = localStorage.getItem(key); return value === 'light' || value === 'system' ? value : 'dark'; }
    catch { return 'dark'; }
  };
  const apply = () => {
    document.documentElement.dataset.uiTheme = preference === 'system' ? media.matches ? 'light' : 'dark' : preference;
    const control = document.querySelector<HTMLSelectElement>('#hub-theme');
    if (control) control.value = preference;
  };
  preference = read();
  apply();
  media.addEventListener('change', apply);
  addEventListener('storage', event => {
    if (event.key === key || event.key === null) { preference = read(); apply(); }
  });
  addEventListener('DOMContentLoaded', () => {
    const control = document.querySelector<HTMLSelectElement>('#hub-theme');
    if (!control) return;
    control.disabled = false;
    control.value = preference;
    control.addEventListener('change', () => {
      preference = ['light', 'system'].includes(control.value) ? control.value : 'dark';
      try { localStorage.setItem(key, preference); } catch { /* Keep the session preference. */ }
      apply();
    });
  }, { once: true });
})();
export {};
