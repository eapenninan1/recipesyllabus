export default {
  async fetch(request, env) {

    const corsHeaders = {
      "Access-Control-Allow-Origin": "https://eapenninan1.github.io",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
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

      const query = `
        mutation GetFollowers {
          goto(
            url: "https://www.facebook.com/sheeja.eapen"
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
        return new Response(
          JSON.stringify({
            error: "Browserless request failed",
            details: result
          }),
          {
            status: 502,
            headers: corsHeaders
          }
        );
      }

      const pageText =
        result?.data?.pageText?.text || "";

      const match = pageText.match(
        /([\d,.]+(?:[KMB])?)\s+followers/i
      );

      if (!match) {
        return new Response(
          JSON.stringify({
            error: "Follower count not found"
          }),
          {
            status: 404,
            headers: corsHeaders
          }
        );
      }

      return new Response(
        JSON.stringify({
          followers: match[1]
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
