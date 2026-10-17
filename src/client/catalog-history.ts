export type CatalogHistoryMode = 'replace' | 'push' | 'typing';

/** Keep one history entry for a text edit, and one for each explicit filter change. */
export function catalogHistory(form: HTMLFormElement) {
  let typingUrl: string | undefined;
  let session = 0;
  const finishTyping = () => { typingUrl = undefined; session++; };
  form.addEventListener('focusin', finishTyping);
  form.addEventListener('focusout', finishTyping);
  addEventListener('popstate', finishTyping);
  return {
    prepare(mode: CatalogHistoryMode = 'replace') {
      const editSession = session;
      return (url: string) => {
        const current = location.pathname + location.search;
        const typing = mode === 'typing' && editSession === session;
        const replace = mode === 'replace' || typing && typingUrl === current;
        if (!typing) finishTyping();
        if (url === current) return;
        if (replace) history.replaceState(null, '', url);
        else history.pushState(null, '', url);
        if (typing) typingUrl = url;
      };
    },
  };
}
