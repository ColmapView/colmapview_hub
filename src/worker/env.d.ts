/** Optional secret for verified bots; set with `wrangler secret put VERIFIED_BOT_TOKEN` (see README). */
interface Env {
  VERIFIED_BOT_TOKEN?: string;
}
