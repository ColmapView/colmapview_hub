/** Old viewers fall back to provider-native sign-in; no request body or credential is read. */
export function retiredAuthRoute(request: Request): Response {
  const sessionCheck = request.method === 'GET' && new URL(request.url).pathname === '/auth/session';
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Pragma': 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  });
  const cookieName = '__Host-colmapview_session';
  if ((request.headers.get('Cookie') ?? '').split(';').some(part => part.trim().startsWith(`${cookieName}=`))) {
    headers.set('Set-Cookie', `${cookieName}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`);
  }
  return Response.json(sessionCheck
    ? { capabilities: { google: false, hf: false, bucket: false }, accounts: [], bucket: null, expiresAt: 0 }
    : { error: 'Reload ColmapView, then reconnect. Connections now stay in your browser.' },
  { status: sessionCheck ? 200 : 410, headers });
}
