/* ============================================================
   /api/admin/content  (requires an admin session)
     GET  the saved content, uncached: { data, updatedAt }
     PUT  replace it: { data, baseUpdatedAt }
          baseUpdatedAt is the updatedAt the editor started from;
          if the row changed since (another tab saved), answers 409
          rather than silently overwriting that save.
   ============================================================ */

const { getSession, sameOrigin, readJsonBody } = require("../_lib/auth");
const { readContent, writeContent, normalizeContent } = require("../_lib/content");

const MAX_BODY_CHARS = 400000;

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (!getSession(req)) {
    return res.status(401).json({ error: "Your session has expired. Log in again.", code: "unauthenticated" });
  }

  try {
    if (req.method === "GET") {
      return res.status(200).json(await readContent());
    }

    if (req.method === "PUT") {
      if (!sameOrigin(req)) return res.status(403).json({ error: "Bad origin." });

      const body = readJsonBody(req);
      if (!body || typeof body.data !== "object") {
        return res.status(400).json({ error: "Nothing to save." });
      }
      if (JSON.stringify(body.data).length > MAX_BODY_CHARS) {
        return res.status(413).json({ error: "That's too much content to save in one go." });
      }

      const current = await readContent();
      if (body.baseUpdatedAt !== undefined && current.updatedAt && body.baseUpdatedAt !== current.updatedAt) {
        return res.status(409).json({
          error: "The content was changed somewhere else (another tab?) since you opened it. Reload to get the latest, then redo your edits.",
          code: "conflict",
        });
      }

      const saved = await writeContent(normalizeContent(body.data));
      return res.status(200).json(saved);
    }

    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ error: "Method not allowed." });
  } catch (err) {
    console.error("/api/admin/content failed:", err.code || "", err.message);
    return res.status(502).json({
      error:
        err.code === "redis_not_configured"
          ? "The database isn't connected. Add Upstash Redis to the Vercel project, then redeploy."
          : "Couldn't reach the database. Try again in a moment.",
      code: err.code || "db_error",
    });
  }
};
