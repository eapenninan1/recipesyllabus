export default {
  async fetch(request, env) {

    const allowedOrigins = new Set([
      "https://recipesyllabus.in",
      "https://www.recipesyllabus.in",
      "https://eapenninan1.github.io"
    ]);
    const requestOrigin = request.headers.get("Origin");

    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigins.has(requestOrigin)
        ? requestOrigin
        : "https://recipesyllabus.in",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
      "Content-Type": "application/json"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    if (request.method !== "GET") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        {
          status: 405,
          headers: corsHeaders
        }
      );
    }

    try {

      const getProfileText = async (url) => {
        const query = `
        mutation GetProfile {
          goto(
            url: "${url}"
            waitUntil: domContentLoaded
          ) {
            status
          }

          pageText: text(selector: "body", visible: true) {
            text
          }
        }
      `;

      const browserlessResponse = await fetch(
        "https://production-sfo.browserless.io/chromium/bql?token=" +
        encodeURIComponent(env.BROWSERLESS_API_KEY),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            query: query
          })
        }
      );

        const result = await browserlessResponse.json();

        if (!browserlessResponse.ok || result.errors) {
          throw new Error("Browserless request failed for " + url);
        }

        return result?.data?.pageText?.text || "";
      };

      const [facebookText, instagramText] = await Promise.all([
        getProfileText("https://www.facebook.com/sheeja.eapen"),
        getProfileText("https://www.instagram.com/sheejaeapen/")
      ]);

      const getFollowerCount = (pageText) => {
        const match = pageText.match(/([\d,.]+(?:[KMB])?)\s+followers/i);
        return match ? match[1] : null;
      };

      const facebookFollowers = getFollowerCount(facebookText);
      const instagramFollowers = getFollowerCount(instagramText);

      if (!facebookFollowers && !instagramFollowers) {
        return new Response(
          JSON.stringify({
            error: "Facebook and Instagram follower counts not found"
          }),
          {
            status: 404,
            headers: corsHeaders
          }
        );
      }

      return new Response(
        JSON.stringify({
          facebookFollowers,
          instagramFollowers
        }),
        {
          status: 200,
          headers: corsHeaders
        }
      );

    } catch (error) {

      return new Response(
        JSON.stringify({
          error: error.message
        }),
        {
          status: 500,
          headers: corsHeaders
        }
      );
    }
  }
};
