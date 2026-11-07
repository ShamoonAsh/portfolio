/* ============================================================
   GET /api/resume: what the "Download Resume" button links to.
   Sends the PDF uploaded in /admin as a download, or redirects to
   the PDF in the repo when none has been uploaded (or Redis is
   unreachable), so the button always downloads something.
   ============================================================ */

const { redisConfig } = require("./_lib/redis");
const { FALLBACK_PATH, DOWNLOAD_NAME, readResumeFile } = require("./_lib/resume");

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "Method not allowed." });
  }

  // Never cached: a new upload must be what the very next click gets.
  res.setHeader("Cache-Control", "no-store");

  if (redisConfig().ok) {
    try {
      const pdf = await readResumeFile();
      if (pdf) {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", 'attachment; filename="' + DOWNLOAD_NAME + '"');
        res.setHeader("Content-Length", String(pdf.length));
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.statusCode = 200;
        return res.end(req.method === "HEAD" ? undefined : pdf);
      }
    } catch (err) {
      console.error("GET /api/resume: falling back to the repo PDF.", err.code || "", err.message);
    }
  }

  res.setHeader("Location", FALLBACK_PATH);
  res.statusCode = 302;
  return res.end();
};
