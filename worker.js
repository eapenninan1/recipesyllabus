const CACHE_KEY = new Request(
  "https://facebook-followers-cache.internal/combined-v9"
);

const CACHE_TTL = 14400; // 4 hours

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Start Facebook Login. The callback discovers the linked Page and Instagram
    // professional account, then stores the Page token server-side in KV.
    if (url.pathname === "/connect/facebook") {
      if (!env.META_APP_ID || !env.OAUTH_REDIRECT_URI || !env.SOCIAL_KV) {
        return new Response("Meta OAuth is not configured. Set META_APP_ID, OAUTH_REDIRECT_URI and SOCIAL_KV.", { status: 503 });
      }
      const state = crypto.randomUUID();
      await env.SOCIAL_KV.put(`oauth:${state}`, "1", { expirationTtl: 600 });
      const authorize = new URL("https://www.facebook.com/v25.0/dialog/oauth");
      authorize.search = new URLSearchParams({
        client_id: env.META_APP_ID,
        redirect_uri: env.OAUTH_REDIRECT_URI,
        state,
        response_type: "code",
        scope: "pages_show_list,pages_read_engagement,instagram_basic"
      });
      return Response.redirect(authorize.toString(), 302);
    }

    if (url.pathname === "/connect/facebook/callback") {
      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      if (!state || !env.SOCIAL_KV || !(await env.SOCIAL_KV.get(`oauth:${state}`))) {
        return new Response("Invalid or expired Facebook authorization. Start again at /connect/facebook.", { status: 400 });
      }
      await env.SOCIAL_KV.delete(`oauth:${state}`);
      if (url.searchParams.has("error")) return new Response("Facebook authorization was cancelled.", { status: 400 });
      if (!code || !env.META_APP_SECRET) return new Response("Meta authorization is incomplete. Check the Worker app secret and reconnect.", { status: 400 });
      const tokenUrl = new URL("https://graph.facebook.com/v25.0/oauth/access_token");
      tokenUrl.search = new URLSearchParams({
        client_id: env.META_APP_ID,
        client_secret: env.META_APP_SECRET,
        redirect_uri: env.OAUTH_REDIRECT_URI,
        code
      });
      const tokenResponse = await fetch(tokenUrl);
      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok || !tokenData.access_token) return new Response("Could not complete Facebook authorization.", { status: 502 });
      const pagesUrl = new URL("https://graph.facebook.com/v25.0/me/accounts");
      pagesUrl.search = new URLSearchParams({
        fields: "id,name,access_token,fan_count,instagram_business_account{id,username,followers_count}",
        access_token: tokenData.access_token
      });
      const pagesResponse = await fetch(pagesUrl);
      const pagesData = await pagesResponse.json();
      const page = (pagesData.data || []).find(item => item.instagram_business_account?.id && item.access_token);
      if (!pagesResponse.ok || !page) {
        return new Response("No Facebook Page linked to an Instagram professional account was found. Check account linking and granted permissions, then reconnect.", { status: 400 });
      }
      await env.SOCIAL_KV.put("social:meta", JSON.stringify({
        pageId: page.id,
        pageName: page.name,
        pageAccessToken: page.access_token,
        instagramId: page.instagram_business_account.id,
        updatedAt: new Date().toISOString()
      }));
      await caches.default.delete(CACHE_KEY);
      return new Response("Facebook and Instagram connected. Follower statistics will update on the next request.", {
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }

    const allowedOrigins = [
      "https://recipesyllabus.in",
      "https://www.recipesyllabus.in",
      "https://eapenninan1.github.io"
    ];

    const requestOrigin = request.headers.get("Origin");
    const allowedOrigin = allowedOrigins.includes(requestOrigin)
      ? requestOrigin
      : "https://recipesyllabus.in";

    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Vary": "Origin"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders,
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    if (request.method !== "GET") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: corsHeaders
      });
    }

    const cache = caches.default;
    const cached = await cache.match(CACHE_KEY);

    if (cached) {
      const data = await cached.json();
      return new Response(JSON.stringify({ ...data, cached: true }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${CACHE_TTL}`
        }
      });
    }

    let facebookFollowers = null;
    let instagramFollowers = null;

    try {
      const connected = env.SOCIAL_KV && JSON.parse(await env.SOCIAL_KV.get("social:meta") || "null");
      if (connected?.pageAccessToken && connected?.pageId) {
        const fbUrl = new URL(`https://graph.facebook.com/v25.0/${connected.pageId}`);
        fbUrl.search = new URLSearchParams({ fields: "fan_count", access_token: connected.pageAccessToken });
        const igUrl = new URL(`https://graph.facebook.com/v25.0/${connected.instagramId}`);
        igUrl.search = new URLSearchParams({ fields: "followers_count", access_token: connected.pageAccessToken });
        const [fbResponse, igResponse] = await Promise.all([fetch(fbUrl), fetch(igUrl)]);
        const [fbData, igData] = await Promise.all([fbResponse.json(), igResponse.json()]);
        if (fbResponse.ok) facebookFollowers = fbData.fan_count ?? null;
        if (igResponse.ok) instagramFollowers = igData.followers_count ?? null;
      }
    } catch (error) {
      console.error("Meta follower stats error:", error);
    }

    let youtubeSubscribers = null;
    let youtubeViews = null;
    let youtubeVideos = null;
    let youtubeTitle = null;
    let youtubeChannelId = null;

    try {
      const youtubeURL =
        "https://www.googleapis.com/youtube/v3/channels" +
        "?part=snippet,statistics" +
        "&forHandle=%40RecipeSyllabus" +
        `&key=${encodeURIComponent(env.YOUTUBE_API_KEY)}`;

      const ytResponse = await fetch(youtubeURL);
      const ytData = await ytResponse.json();

      if (ytResponse.ok && ytData.items?.length > 0) {
        const channel = ytData.items[0];
        const statistics = channel.statistics || {};
        const snippet = channel.snippet || {};

        youtubeChannelId = channel.id || null;
        youtubeTitle = snippet.title || null;
        youtubeSubscribers = Number(statistics.subscriberCount || 0);
        youtubeViews = Number(statistics.viewCount || 0);
        youtubeVideos = Number(statistics.videoCount || 0);
      }
    } catch (error) {
      console.error("YouTube stats error:", error);
    }

    const result = {
      facebookFollowers,
      instagramFollowers,
      youtubeSubscribers,
      youtubeViews,
      youtubeVideos,
      youtubeTitle,
      youtubeChannelId
    };

    const response = new Response(JSON.stringify(result), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${CACHE_TTL}`
      }
    });

    const cacheResponse = new Response(JSON.stringify(result), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${CACHE_TTL}`
      }
    });

    ctx.waitUntil(cache.put(CACHE_KEY, cacheResponse));
    return response;
  }
};
