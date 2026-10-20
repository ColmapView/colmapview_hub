export type CatalogHistoryMode = 'replace' | 'push' | 'typing';

/** Keep one history entry for a text edit, and one for each explicit filter change. */
export function catalogHistory(form: HTMLFormElement) {
  const feedSeed = (): string | undefined => {
    const value: unknown = history.state?.colmapviewFeedSeed;
    return typeof value === 'string' && /^[a-f0-9]{8,32}$/.test(value) ? value : undefined;
  };
  let typingUrl: string | undefined;
  let session = 0;
  const finishTyping = () => { typingUrl = undefined; session++; };
  form.addEventListener('focusin', finishTyping);
  form.addEventListener('focusout', finishTyping);
  addEventListener('popstate', finishTyping);
  return {
    feedSeed,
    prepare(mode: CatalogHistoryMode = 'replace') {
      const editSession = session;
      return (url: string, seed?: string) => {
        const current = location.pathname + location.search;
        const typing = mode === 'typing' && editSession === session;
        const replace = mode === 'replace' || typing && typingUrl === current;
        if (!typing) finishTyping();
        if (url === current && seed === feedSeed()) return;
        const state = { ...history.state };
        if (seed) state.colmapviewFeedSeed = seed;
        else delete state.colmapviewFeedSeed;
        if (replace) history.replaceState(state, '', url);
        else history.pushState(state, '', url);
        if (typing) typingUrl = url;
      };
    },
  };
}
