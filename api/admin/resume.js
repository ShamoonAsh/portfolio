/* ============================================================
   /api/admin/resume  (requires an admin session)
     GET     { uploaded: null | { size, originalName, uploadedAt } }
     POST    upload a new PDF: { name, dataBase64 }  (max 3MB)
     DELETE  remove the upload; the button goes back to the repo PDF

   Uploads take effect immediately. They are not part of the
   editor's Save button.
   ============================================================ */

const { getSession, sameOrigin, readJsonBody } = require("../_lib/auth");
const { MAX_BYTES, readResumeMeta, saveResume, deleteResume } = require("../_lib/resume");

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
      return res.status(200).json({ uploaded: await readResumeMeta() });
    }

    if (req.method === "POST") {
      const body = readJsonBody(req);
      const b64 = body && typeof body.dataBase64 === "string" ? body.dataBase64.replace(/^data:[^,]*,/, "") : "";
      if (!b64) return res.status(400).json({ error: "No file received." });

      const buffer = Buffer.from(b64, "base64");
      if (buffer.length > MAX_BYTES) {
        return res.status(413).json({ error: "That PDF is over 3 MB. Export a smaller one and try again." });
      }
      // a real PDF starts with "%PDF-"; the extension and MIME type prove nothing
      if (buffer.length < 5 || buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
        return res.status(400).json({ error: "That file isn't a PDF." });
      }

      const meta = await saveResume(buffer, body.name);
      return res.status(200).json({ uploaded: meta });
    }

    if (req.method === "DELETE") {
      await deleteResume();
      return res.status(200).json({ uploaded: null });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed." });
  } catch (err) {
    console.error("/api/admin/resume failed:", err.code || "", err.message);
    const tooBig = /max.*(request|size)|too large/i.test(err.message || "");
    return res.status(502).json({
      error: tooBig
        ? "The database rejected a file that size. Try a smaller PDF."
        : "Couldn't reach the database. Try again in a moment.",
      code: err.code || "db_error",
    });
  }
};
