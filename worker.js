const CACHE_KEY = new Request(
  "https://facebook-followers-cache.internal/combined-v14"
);

// Recipe Syllabus Page ID shown in Meta's Page access authorization screen.
const META_PAGE_ID = "1412091325311256";

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
      }).toString();
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
      }).toString();
      const tokenResponse = await fetch(tokenUrl);
      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok || !tokenData.access_token) return new Response("Could not complete Facebook authorization.", { status: 502 });
      const permissionsUrl = new URL("https://graph.facebook.com/v25.0/me/permissions");
      permissionsUrl.search = new URLSearchParams({ access_token: tokenData.access_token }).toString();
      const permissionsResponse = await fetch(permissionsUrl);
      const permissionsData = permissionsResponse.ok ? await permissionsResponse.json() : {};
      const grantedPermissions = (permissionsData.data || [])
        .filter(item => item.status === "granted")
        .map(item => item.permission);
      console.info("Meta granted permissions:", grantedPermissions);
      const pagesUrl = new URL("https://graph.facebook.com/v25.0/me/accounts");
      pagesUrl.search = new URLSearchParams({
        fields: "id,name,access_token,followers_count,instagram_business_account{id,username,followers_count}",
        access_token: tokenData.access_token
      }).toString();
      const pagesResponse = await fetch(pagesUrl);
      const pagesData = await pagesResponse.json();
      let page = (pagesData.data || []).find(item => item.instagram_business_account?.id && item.access_token);
      if (!pagesResponse.ok) {
        const graphError = pagesData.error || {};
        console.error("Meta Page lookup failed:", {
          status: pagesResponse.status,
          code: graphError.code ?? null,
          subcode: graphError.error_subcode ?? null,
          message: graphError.message ?? "No error message returned"
        });
        return new Response(
          `Meta could not list your Pages (HTTP ${pagesResponse.status}${graphError.code ? `, error ${graphError.code}` : ""}). Check the Worker logs for details, then verify Page access and granted permissions.`,
          { status: 502 }
        );
      }
      let directLookupStatus = null;
      let directLookupError = null;
      if (!page) {
        // Some Business Portfolio Pages are omitted from /me/accounts even after
        // the user grants the Page. Query the selected Page ID directly.
        const directPageUrl = new URL(`https://graph.facebook.com/v25.0/${META_PAGE_ID}`);
        directPageUrl.search = new URLSearchParams({
          fields: "id,name,access_token,followers_count,instagram_business_account{id,username,followers_count}",
          access_token: tokenData.access_token
        }).toString();
        const directPageResponse = await fetch(directPageUrl);
        const directPageData = await directPageResponse.json();
        directLookupStatus = directPageResponse.status;
        directLookupError = directPageData.error?.message ?? null;
        if (directPageResponse.ok && directPageData.access_token && directPageData.instagram_business_account?.id) {
          page = directPageData;
        }
      }
      if (!page) {
        const pages = pagesData.data || [];
        console.error("Meta Page lookup found no linked Instagram professional account:", {
          pageCount: pages.length,
          directLookupStatus,
          directLookupError,
          pages: pages.map(item => ({
            name: item.name ?? null,
            hasPageAccessToken: Boolean(item.access_token),
            hasInstagramBusinessAccount: Boolean(item.instagram_business_account?.id)
          }))
        });
        return new Response(
          `Meta returned ${pages.length} Page(s). Direct lookup of the selected Page returned HTTP ${directLookupStatus}${directLookupError ? `: ${directLookupError}` : ""}. Granted permissions: ${grantedPermissions.join(", ") || "none reported"}.`,
          { status: 400 }
        );
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

    let facebookProfileFollowers = null;
    let facebookPageFollowers = null;
    let instagramFollowers = null;

    try {
      if (!env.BROWSERLESS_API_KEY) {
        console.error("Facebook profile follower lookup skipped: BROWSERLESS_API_KEY is not configured.");
      } else {
        const facebookQuery = `
          mutation GetFacebookProfileFollowers {
            goto(
              url: "https://www.facebook.com/sheeja.eapen"
              waitUntil: domContentLoaded
            ) {
              status
            }
            text(selector: "body", visible: true) {
              text
            }
          }
        `;
        const browserlessUrl = new URL("https://production-sfo.browserless.io/stealth/bql");
        browserlessUrl.searchParams.set("token", env.BROWSERLESS_API_KEY);
        const browserlessResponse = await fetch(browserlessUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: facebookQuery })
        });
        const browserlessData = await browserlessResponse.json();
        const profileText = browserlessData?.data?.text?.text || "";
        const followerMatch = profileText.match(/([\d,.]+(?:\s?[KMB])?)\s+followers\b/i);
        if (browserlessResponse.ok && !browserlessData.errors && followerMatch) {
          facebookProfileFollowers = followerMatch[1].replace(/\s+/g, "");
        } else {
          console.error("Facebook profile follower count was not found in the Browserless response.", {
            status: browserlessResponse.status,
            hasErrors: Boolean(browserlessData.errors),
            textLength: profileText.length
          });
        }
      }
    } catch (error) {
      console.error("Facebook profile follower lookup error:", error);
    }

    try {
      const connected = env.SOCIAL_KV && JSON.parse(await env.SOCIAL_KV.get("social:meta") || "null");
      if (connected?.pageAccessToken && connected?.pageId) {
        const fbUrl = new URL(`https://graph.facebook.com/v25.0/${connected.pageId}`);
        fbUrl.search = new URLSearchParams({ fields: "followers_count", access_token: connected.pageAccessToken }).toString();
        const igUrl = new URL(`https://graph.facebook.com/v25.0/${connected.instagramId}`);
        igUrl.search = new URLSearchParams({ fields: "followers_count", access_token: connected.pageAccessToken }).toString();
        const [fbResponse, igResponse] = await Promise.all([fetch(fbUrl), fetch(igUrl)]);
        const [fbData, igData] = await Promise.all([fbResponse.json(), igResponse.json()]);
        if (fbResponse.ok) facebookPageFollowers = fbData.followers_count ?? null;
        if (igResponse.ok) instagramFollowers = igData.followers_count ?? null;
      }
    } catch (error) {
      console.error("Facebook Page/Instagram follower stats error:", error);
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
      // Keep the existing website field mapped to the personal Facebook profile.
      facebookFollowers: facebookProfileFollowers,
      facebookPageFollowers,
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
