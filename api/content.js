/* ============================================================
   GET /api/content: the text/colour edits saved from /admin, read
   by every visitor's page load (see the <head> script in index.html).

   Vercel's edge keeps a copy and always answers from it straight away,
   refreshing it in the background (stale-while-revalidate), so a visit
   never waits on a sleeping function or the database. Right after a save
   the first request may still get the previous copy (the admin page makes
   that request itself, so visitors get the new one). Any failure answers 503 (never cached) and the page
   simply keeps the text and colours written in index.html.
   ============================================================ */

const { redisConfig } = require("./_lib/redis");
const { readContent, normalizeContent } = require("./_lib/content");

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "Method not allowed." });
  }

  // Browsers must always re-check (stale-while-revalidate in Cache-Control
  // would also apply to them, showing the old version once after a save);
  // only Vercel's edge keeps a short-lived copy.
  res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");

  if (!redisConfig().ok) {
    // not set up yet: the published page is the content
    res.setHeader("Vercel-CDN-Cache-Control", "max-age=60");
    return res.status(200).json(normalizeContent(null));
  }

  try {
    const { data } = await readContent();
    res.setHeader("Vercel-CDN-Cache-Control", "max-age=5, stale-while-revalidate=604800");
    return res.status(200).json(data);
  } catch (err) {
    console.error("GET /api/content failed:", err.code || "", err.message);
    res.setHeader("Cache-Control", "no-store");
    return res.status(503).json({ error: "Content temporarily unavailable." });
  }
};
