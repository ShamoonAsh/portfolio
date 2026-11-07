/* ============================================================
   /api/admin/share  (requires an admin session)
     GET  { banner: null | { size, updatedAt } }
     PUT  { dataBase64 }  upload the banner drawn in the editor (JPEG)
   ============================================================ */

const { getSession, sameOrigin, readJsonBody } = require("../_lib/auth");
const { MAX_BYTES, readShareMeta, saveShareImage } = require("../_lib/share");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (!getSession(req)) {
    return res.status(401).json({ error: "Your session has expired. Log in again.", code: "unauthenticated" });
  }
  if (req.method !== "GET" && !sameOrigin(req)) {
    return res.status(403).json({ error: "Bad origin." });
  }

  try {
    if (req.method === "GET") {
      return res.status(200).json({ banner: await readShareMeta() });
    }

    if (req.method === "PUT") {
      const body = readJsonBody(req);
      const b64 = body && typeof body.dataBase64 === "string" ? body.dataBase64.replace(/^data:[^,]*,/, "") : "";
      if (!b64) return res.status(400).json({ error: "No image received." });
      const buffer = Buffer.from(b64, "base64");
      if (buffer.length > MAX_BYTES) return res.status(413).json({ error: "The banner image is too large." });
      // JPEG files start FF D8 FF
      if (buffer.length < 3 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
        return res.status(400).json({ error: "The banner must be a JPEG." });
      }
      return res.status(200).json({ banner: await saveShareImage(buffer) });
    }

    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ error: "Method not allowed." });
  } catch (err) {
    console.error("/api/admin/share failed:", err.code || "", err.message);
    return res.status(502).json({ error: "Couldn't reach the database. Try again in a moment.", code: err.code || "db_error" });
  }
};
