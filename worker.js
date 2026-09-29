const CACHE_KEY = new Request(
  "https://facebook-followers-cache.internal/combined-v7"
);

const CACHE_TTL = 14400; // 4 hours

export default {
  async fetch(request, env, ctx) {
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
      const facebookQuery = `
        mutation GetFacebookFollowers {
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

      const fbResponse = await fetch(
        `https://production-sfo.browserless.io/stealth/bql?token=${encodeURIComponent(env.BROWSERLESS_API_KEY)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: facebookQuery })
        }
      );

      const fbData = await fbResponse.json();
      const facebookText = fbData?.data?.text?.text || "";
      const match = facebookText.match(/([\d,.]+(?:[KMB])?)\s+followers/i);
      if (fbResponse.ok && match) facebookFollowers = match[1];
    } catch (error) {
      console.error("Facebook followers error:", error);
    }

    try {
      const instagramQuery = `
        mutation GetInstagramFollowers {
          goto(
            url: "https://www.instagram.com/sheejaeapen/"
            waitUntil: domContentLoaded
          ) {
            status
          }

          text(selector: "body", visible: true) {
            text
          }

          profileHtml: html(selector: "body") {
            html
          }
        }
      `;

      const igResponse = await fetch(
        `https://production-sfo.browserless.io/stealth/bql?token=${encodeURIComponent(env.BROWSERLESS_API_KEY)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: instagramQuery })
        }
      );

      const igData = await igResponse.json();
      const instagramText = igData?.data?.text?.text || "";
      const instagramHtml = igData?.data?.profileHtml?.html || "";
      const instagramProfile = `${instagramText} ${instagramHtml}`;
      const match = instagramProfile.match(/([\d,.]+(?:[KMB])?)\s+followers/i);
      const embeddedCount = instagramHtml.match(
        /(?:"edge_followed_by"\s*:\s*\{\s*"count"|"followers_count")\s*:\s*(\d+)/i
      );
      if (igResponse.ok && match) instagramFollowers = match[1];
      else if (igResponse.ok && embeddedCount) instagramFollowers = embeddedCount[1];
      else console.log("Instagram scrape did not find a count:", JSON.stringify({
        status: igResponse.status,
        errors: igData?.errors,
        text: instagramText.slice(0, 600),
        html: instagramHtml.slice(0, 1200)
      }));
    } catch (error) {
      console.error("Instagram followers error:", error);
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
