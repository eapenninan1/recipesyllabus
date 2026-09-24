const SITE_DOMAIN = "recipesyllabus.in";
const SITE_URL = `https://${SITE_DOMAIN}`;

window.RECIPE_SYLLABUS_CONFIG = Object.freeze({
  DOMAIN: SITE_DOMAIN,
  BASE_URL: SITE_URL
});

window.siteUrl = function siteUrl(path = "") {
  const cleanPath = String(path).replace(/^\/+/, "");
  return new URL(cleanPath, `${SITE_URL}/`).href;
};
