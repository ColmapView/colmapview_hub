import { initializeHubUsage } from './hub-usage';
import { ANALYTICS_CONSENT_REVISION as POLICY_VERSION } from '../shared/analytics-consent';

const MEASUREMENT_ID = 'G-7K5H83SEMY';
const DISABLE_KEY = `ga-disable-${MEASUREMENT_ID}` as const;
const CHOICE_KEY = 'colmapview-hub-analytics-v1';
const CHOICE_AGE = 180 * 24 * 60 * 60 * 1000;
const COOKIE_PREFIX = 'cvh';
const COOKIE_PATH = '/hub/datasets';
type Choice = { choice: 'allow' | 'decline'; updatedAt: number; signals: number };
type Gtag = (...args: unknown[]) => void;
type AnalyticsWindow = Window & { [DISABLE_KEY]?: boolean; dataLayer?: unknown[] };

function savedChoice(): Choice | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(CHOICE_KEY) ?? 'null');
    const age = Date.now() - saved?.updatedAt;
    if (typeof saved?.updatedAt !== 'number' || age < 0 || age >= CHOICE_AGE) return;
    // Keep refusals, but cookieless allowances cannot authorize analytics cookies.
    if (saved.choice === 'decline') return { choice: 'decline', updatedAt: saved.updatedAt, signals: 0 };
    if (saved.choice === 'allow' && saved.policyVersion === POLICY_VERSION
      && Number.isInteger(saved.signals) && saved.signals >= 0 && saved.signals <= 3) return saved;
  } catch { /* Unavailable or malformed storage never grants permission. */ }
}

const privacySignals = () => (navigator.doNotTrack === '1' ? 1 : 0)
  | ((navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true ? 2 : 0);
const newSignal = (choice: Choice) => (privacySignals() & ~choice.signals) !== 0;
const permitted = (choice: Choice | undefined): choice is Choice => choice?.choice === 'allow' && !newSignal(choice);

function storeChoice(choice: Choice['choice']): void {
  localStorage.setItem(CHOICE_KEY, JSON.stringify({ choice, updatedAt: Date.now(), policyVersion: POLICY_VERSION, signals: privacySignals() }));
}

function clearAnalyticsCookies(): void {
  for (const name of [`${COOKIE_PREFIX}_ga`, `${COOKIE_PREFIX}_ga_${MEASUREMENT_ID.slice(2)}`]) {
    // Cover both explicit-domain and host-only cookies; leave other site data alone.
    for (const domain of ['', `; Domain=${location.hostname}`]) {
      try { document.cookie = `${name}=; Max-Age=0; Path=${COOKIE_PATH}${domain}; SameSite=Lax; Secure`; }
      catch { /* A browser that blocks cookie writes may require clearing site data. */ }
    }
  }
}

/** Catalog traffic only: never initialize on share/manage pages or local previews. */
export function initializeAnalytics(): void {
  if (document.documentElement.dataset.hubPublicCatalog !== 'true'
    || location.origin !== 'https://colmapview.opsiclear.com') return;

  const panel = document.querySelector<HTMLElement>('#analytics-choice');
  const settings = document.querySelector<HTMLButtonElement>('#analytics-settings');
  const allow = document.querySelector<HTMLButtonElement>('#analytics-allow');
  const decline = document.querySelector<HTMLButtonElement>('#analytics-decline');
  const status = document.querySelector<HTMLElement>('#analytics-status');
  const close = document.querySelector<HTMLButtonElement>('#analytics-close');
  if (!panel || !settings || !allow || !decline || !status || !close) return;
  if (panel.dataset.analyticsConsentVersion !== String(POLICY_VERSION)) {
    // A cached older notice can load a newer script during deployment.
    clearAnalyticsCookies();
    return;
  }

  const analytics = window as AnalyticsWindow;
  let started = false;
  let gtag: Gtag | undefined;
  let expiry: number | undefined;
  const stop = () => {
    analytics[DISABLE_KEY] = true;
    clearAnalyticsCookies();
  };
  const show = (open: boolean, focus = false) => {
    panel.hidden = !open;
    settings.hidden = open;
    settings.setAttribute('aria-expanded', String(open));
    const signals = privacySignals();
    const name = signals & 2 ? 'Global Privacy Control' : 'Do Not Track';
    const active = started && permitted(savedChoice()) && !analytics[DISABLE_KEY];
    status.textContent = signals
      ? active ? `Analytics allowed here; ${name} remains on.` : `${name} is on. Analytics stays off unless you allow it here.`
      : active ? 'Analytics is on.' : '';
    if (focus) (open ? decline : settings).focus();
  };
  const reconcile = () => {
    let choice = savedChoice();
    if (choice?.choice === 'allow' && newSignal(choice)) {
      try { storeChoice('decline'); choice = savedChoice(); }
      catch {
        stop();
        show(true);
        status.textContent = 'Analytics stopped. Clear site data to keep it off; your browser could not save this choice.';
        return;
      }
    }
    const allowed = permitted(choice);
    if (!allowed) clearAnalyticsCookies();
    if (started && !allowed) {
      // Stop queued measurement and discard the tag and its existing listeners.
      stop();
      location.reload();
      return;
    }
    if (permitted(choice) && !started) {
      started = true;
      gtag = loadAnalytics(choice);
      initializeHubUsage((name, parameters) => {
        if (permitted(savedChoice()) && !analytics[DISABLE_KEY]) gtag?.('event', name, parameters);
      });
    }
    clearTimeout(expiry);
    if (choice) expiry = window.setTimeout(reconcile, Math.min(2_147_483_647, Math.max(1, choice.updatedAt + CHOICE_AGE - Date.now())));
    show(choice === undefined && privacySignals() === 0);
  };
  const choose = (choice: Choice['choice']) => {
    try { storeChoice(choice); }
    catch {
      if (choice === 'decline') {
        stop();
        status.textContent = 'Analytics stopped. Clear site data to keep it off; your browser could not save this choice.';
      } else status.textContent = started
        ? 'Your browser could not save this choice. Your current analytics setting is unchanged.'
        : 'Your browser could not save this choice. Analytics stays off.';
      return;
    }
    if (choice === 'allow' && analytics[DISABLE_KEY]) { location.reload(); return; }
    reconcile();
    if (choice === 'allow') gtag?.('event', 'consent_granted', { consent_revision: POLICY_VERSION });
    settings.focus();
  };
  settings.hidden = false;
  settings.onclick = () => show(panel.hidden, true);
  close.onclick = () => show(false, true);
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); show(false, true); }
  });
  allow.onclick = () => choose('allow');
  decline.onclick = () => choose('decline');
  window.addEventListener('storage', event => {
    if (event.key === CHOICE_KEY || event.key === null) reconcile();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) reconcile(); });
  window.addEventListener('pageshow', reconcile);
  reconcile();
}

/** Coarse acquisition categories only: never forward a referrer URL or its text. */
function acquisition(): Record<string, string> {
  if (!document.referrer) return {};
  try {
    const source = new URL(document.referrer);
    if (source.origin === location.origin) return {};
    const sources: Record<string, [string, string]> = {
      'www.google.com': ['google', 'organic'], 'www.bing.com': ['bing', 'organic'],
      'duckduckgo.com': ['duckduckgo', 'organic'], 'github.com': ['github', 'referral'],
      'huggingface.co': ['huggingface', 'referral'], 'colmapview.github.io': ['viewer', 'referral'],
    };
    const [campaign_source, campaign_medium] = sources[source.hostname] ?? ['other', 'referral'];
    return { campaign_source, campaign_medium };
  } catch { return {}; }
}

/** No Google queue, script, cookie or measurement request exists before opt-in. */
function loadAnalytics(choice: Choice): Gtag {
  const dataLayer = (window as AnalyticsWindow).dataLayer ??= [];
  const gtag: Gtag = function () {
    // Google's command queue uses Arguments objects, rather than event arrays.
    // eslint-disable-next-line prefer-rest-params
    dataLayer.push(arguments);
  };
  gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied',
    ad_user_data: 'denied', ad_personalization: 'denied' });
  gtag('consent', 'update', { analytics_storage: 'granted' });
  gtag('set', 'ads_data_redaction', true);
  gtag('set', 'url_passthrough', false);
  gtag('set', 'linker', { domains: [], accept_incoming: false, decorate_forms: false });
  gtag('js', new Date());
  gtag('config', MEASUREMENT_ID, { send_page_view: false, allow_google_signals: false,
    allow_ad_personalization_signals: false, ignore_referrer: true,
    page_location: location.origin + location.pathname, page_referrer: '', page_title: 'ColmapView Hub',
    cookie_prefix: COOKIE_PREFIX, cookie_domain: location.hostname, cookie_path: COOKIE_PATH,
    cookie_expires: Math.max(1, Math.floor((choice.updatedAt + CHOICE_AGE - Date.now()) / 1000)),
    cookie_update: false, cookie_flags: 'SameSite=Lax;Secure', consent_revision: POLICY_VERSION,
    ...acquisition() });
  gtag('event', 'page_view', { send_to: MEASUREMENT_ID });

  const script = document.createElement('script');
  script.async = true;
  script.referrerPolicy = 'no-referrer';
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.append(script);
  return gtag;
}
