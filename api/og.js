/* ============================================================
   GET /api/og: the link-preview banner (og:image / twitter:image).
   Serves the banner generated in /admin, or og-default.jpg from the
   repo until one exists (or when Redis is unreachable). Always a real
   JPEG response, never a redirect: some link-preview crawlers don't
   follow redirects for images.
   ============================================================ */

const fs = require("fs");
const path = require("path");
const { redisConfig } = require("./_lib/redis");
const { readShareImage } = require("./_lib/share");

// listed under includeFiles in vercel.json so it ships with the function
const FALLBACK = path.join(__dirname, "..", "og-default.jpg");

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "Method not allowed." });
  }

  let img = null;
  if (redisConfig().ok) {
    try {
      img = await readShareImage();
    } catch (err) {
      console.error("GET /api/og: using the default banner.", err.code || "", err.message);
    }
  }
  if (!img) {
    try {
      img = fs.readFileSync(FALLBACK);
    } catch {
      return res.status(404).json({ error: "No banner." });
    }
  }

  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Content-Length", String(img.length));
  // crawlers may keep it an hour; Vercel's edge refreshes every minute so a
  // new banner is picked up quickly by anyone fetching fresh
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.setHeader("Vercel-CDN-Cache-Control", "max-age=60, stale-while-revalidate=86400");
  res.statusCode = 200;
  return res.end(req.method === "HEAD" ? undefined : img);
};
