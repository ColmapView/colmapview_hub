const MEASUREMENT_ID = 'G-7K5H83SEMY';

/** Catalog traffic only: never initialize on share/manage pages or local previews. */
export function initializeAnalytics(): void {
  if (document.documentElement.dataset.hubPublicCatalog !== 'true'
    || location.origin !== 'https://colmapview.opsiclear.com'
    || navigator.doNotTrack === '1'
    || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return;

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
