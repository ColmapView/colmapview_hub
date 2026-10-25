const MEASUREMENT_ID = 'G-7K5H83SEMY';
const DISABLE_KEY = `ga-disable-${MEASUREMENT_ID}` as const;
const CHOICE_KEY = 'colmapview-hub-analytics-v1';
const CHOICE_AGE = 180 * 24 * 60 * 60 * 1000;

function savedChoice(): 'allow' | 'decline' | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(CHOICE_KEY) ?? 'null');
    const age = Date.now() - saved?.updatedAt;
    if (typeof saved?.updatedAt === 'number' && age >= 0 && age < CHOICE_AGE
      && (saved.choice === 'allow' || saved.choice === 'decline')) return saved.choice;
  } catch { /* Unavailable or malformed storage never grants permission. */ }
}

const privacySignal = () => navigator.doNotTrack === '1'
  || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;

/** Catalog traffic only: never initialize on share/manage pages or local previews. */
export function initializeAnalytics(): void {
  if (document.documentElement.dataset.hubPublicCatalog !== 'true'
    || location.origin !== 'https://colmapview.opsiclear.com') return;

  const panel = document.querySelector<HTMLElement>('#analytics-choice');
  const settings = document.querySelector<HTMLButtonElement>('#analytics-settings');
  const allow = document.querySelector<HTMLButtonElement>('#analytics-allow');
  const decline = document.querySelector<HTMLButtonElement>('#analytics-decline');
  const status = document.querySelector<HTMLElement>('#analytics-status');
  if (!panel || !settings || !allow || !decline || !status) return;

  let started = false;
  const show = (open: boolean, focus = false) => {
    panel.hidden = !open;
    settings.setAttribute('aria-expanded', String(open));
    allow.disabled = privacySignal();
    status.textContent = privacySignal() ? 'Analytics is off because your browser sends a privacy signal.' : '';
    if (focus) (open ? decline : settings).focus();
  };
  const reconcile = () => {
    const choice = savedChoice();
    const permitted = choice === 'allow' && !privacySignal();
    if (started && !permitted) {
      // Stop queued measurement and discard the loaded tag when permission ends.
      // Removing its script element alone would leave Google's listeners running.
      (window as Window & { [DISABLE_KEY]?: boolean })[DISABLE_KEY] = true;
      location.reload();
      return;
    }
    if (permitted && !started) {
      started = true;
      loadAnalytics();
    }
    show(choice === undefined && !privacySignal());
  };
  const choose = (choice: 'allow' | 'decline') => {
    try {
      localStorage.setItem(CHOICE_KEY, JSON.stringify({ choice, updatedAt: Date.now() }));
    } catch {
      if (choice === 'decline' && started) {
        (window as Window & { [DISABLE_KEY]?: boolean })[DISABLE_KEY] = true;
        status.textContent = 'Analytics is disabled for this page. Clear this site’s data to remove the saved allowance; your browser could not update it.';
      } else status.textContent = 'Your browser could not save this choice. Analytics stays off.';
      return;
    }
    if (choice === 'allow' && (window as Window & { [DISABLE_KEY]?: boolean })[DISABLE_KEY]) {
      location.reload();
      return;
    }
    reconcile();
    settings.focus();
  };
  settings.hidden = false;
  settings.onclick = () => show(panel.hidden, true);
  allow.onclick = () => { if (!privacySignal()) choose('allow'); };
  decline.onclick = () => choose('decline');
  window.addEventListener('storage', event => {
    if (event.key === CHOICE_KEY || event.key === null) reconcile();
  });
  // Recheck expiry and privacy signals when returning to a long-open catalog tab.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) reconcile(); });
  window.addEventListener('pageshow', reconcile);
  reconcile();
}

/** No Google script, command queue or measurement request exists before opt-in. */
function loadAnalytics(): void {
  const analytics = window as Window & { dataLayer?: unknown[] };
  const dataLayer = analytics.dataLayer ??= [];
  const gtag: (...args: unknown[]) => void = function () {
    // Google's command queue uses Arguments objects, rather than event arrays.
    // eslint-disable-next-line prefer-rest-params
    dataLayer.push(arguments);
  };
  // Denied storage keeps measurement cookieless; advertising features stay off.
  gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied',
    ad_user_data: 'denied', ad_personalization: 'denied' });
  gtag('set', 'ads_data_redaction', true);
  gtag('js', new Date());
  gtag('config', MEASUREMENT_ID, { send_page_view: false, allow_google_signals: false,
    allow_ad_personalization_signals: false, ignore_referrer: true,
    page_location: location.origin + location.pathname, page_referrer: '', page_title: 'ColmapView Hub' });
  gtag('event', 'page_view', { send_to: MEASUREMENT_ID });

  const script = document.createElement('script');
  script.async = true;
  script.referrerPolicy = 'no-referrer';
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.append(script);
}
