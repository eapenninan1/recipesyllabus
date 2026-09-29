# recipesyllabus

## Connect Facebook and Instagram follower stats

The Cloudflare Worker uses Meta's Graph API for follower statistics. Instagram must be a Creator or Business account linked to a Facebook Page.

1. Configure a Meta app with Facebook Login and Instagram Graph API. Add `https://facebook-followers-api.eapenninan1.workers.dev/connect/facebook/callback` as a valid OAuth redirect URI.
2. Request `pages_show_list`, `pages_read_engagement`, and `instagram_basic`. Grant access to the Facebook user who manages the linked Page, and complete any Meta app review required for your usage.
3. Create a Cloudflare KV namespace. Replace the placeholder namespace ID and Meta app ID in `wrangler.toml`. Set the app secret with `npx wrangler secret put META_APP_SECRET`.
4. Deploy the Worker, then open `https://facebook-followers-api.eapenninan1.workers.dev/connect/facebook` and authorize the Page.

The callback stores the Page access token in KV. The stats response uses the Page `fan_count` and linked Instagram `followers_count`. Reconnect from the same URL if access is revoked. Statistics are cached for four hours.
