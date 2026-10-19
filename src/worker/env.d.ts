/** Optional services must not make a disabled deployment require their secrets. */
interface OptionalSecrets {
  VERIFIED_BOT_TOKEN?: string;
  AUTH_KEY?: string;
  AUTH_GOOGLE_CLIENT_SECRET?: string;
  AUTH_HF_CLIENT_SECRET?: string;
}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Merge optional secret types into Wrangler's generated interface.
interface Env extends OptionalSecrets {}
declare namespace Cloudflare {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- cloudflare:workers imports this generated interface.
  interface Env extends OptionalSecrets {}
}
